"""Click everything, ten times, and say what broke.

The app has no test hooks beyond the ones it uses itself (select, toggleLayer, openAll,
buildLegend, layout, selectAnalysis), so this drives those same entry points the DOM
calls, plus real mouse clicks on the canvas. Every round checks the invariants that the
last three bugs violated: the camera stays close, labels belong to nodes and die with
them, no NaN in the graph, counts stay put.
"""
import base64, json, subprocess, sys, time, urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = "http://127.0.0.1:8770/body/index.html"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 10601
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 10


def start():
    p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
                          f"--user-data-dir=/tmp/kgstress-{PORT}", "--window-size=1440,1000",
                          "--force-device-scale-factor=1", "--hide-scrollbars", "about:blank"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1).read()
            break
        except Exception:
            time.sleep(0.3)
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/new?about:blank", method="PUT")
    t = json.loads(urllib.request.urlopen(req).read())
    ws = websocket.create_connection(t["webSocketDebuggerUrl"], timeout=120)
    return p, ws


def session(ws):
    n = [0]
    errors = []

    def cmd(m, **k):
        n[0] += 1
        ws.send(json.dumps({"id": n[0], "method": m, "params": k}))
        while True:
            r = json.loads(ws.recv())
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                errors.append(str(d.get("exception", {}).get("description") or d.get("text"))[:300])
            if r.get("id") == n[0]:
                return r

    def js(expr):
        r = cmd("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        res = r.get("result", {})
        if "exceptionDetails" in res:
            d = res["exceptionDetails"]
            return "ERR " + str(d.get("exception", {}).get("description") or d.get("text"))[:300]
        return res.get("result", {}).get("value")

    return cmd, js, errors


def shot(cmd, path):
    cmd("Page.bringToFront")
    time.sleep(0.3)
    s = cmd("Page.captureScreenshot", format="png")
    open(path, "wb").write(base64.b64decode(s["result"]["data"]))


INVARIANTS = r"""
(() => {
  const bad = [];
  const num = v => Number.isFinite(v);
  const camD = camera.position.distanceTo(controls.target);
  if (camD > 6.8) bad.push("camera " + camD.toFixed(2) + " units away");
  const nan = [...organNodes.map(o => o.node), ...partNodes.map(p => p.node)]
    .filter(o => !num(o.position.x) || !num(o.position.y) || !num(o.position.z));
  if (nan.length) bad.push(nan.length + " node(s) with a NaN position");
  const labels = [...document.querySelectorAll(".alabel")];
  if (labels.length !== ANALYSES.length) bad.push(labels.length + " labels for " + ANALYSES.length + " analyses");
  const orphans = labels.filter(l => !l.isConnected);
  if (orphans.length) bad.push(orphans.length + " detached label(s)");
  const visible = labels.filter(l => +l.style.opacity > 0.05);
  if (visible.length > ANALYSES.length) bad.push("more visible labels than analyses");
  const panel = document.getElementById("node");
  if (!panel.hidden && !document.getElementById("npTitle").textContent.trim()) bad.push("open panel with no title");
  if (organNodes.length !== new Set(organNodes.map(o => o.key)).size) bad.push("duplicate organ nodes");
  const sel = state.sel;
  if (sel && !objectForSel(sel)) bad.push("selected key resolves to nothing: " + sel);
  return bad;
})()
"""

ACTIONS = r"""
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  // every legend row: the eye first, then the row itself
  for (const row of [...document.querySelectorAll("#rows .row")]) {
    row.querySelectorAll(".eye").forEach(e => e.click());
    row.click();
    await sleep(120);
    row.click();
    await sleep(120);
  }
  // every system node, its panel, and every button in it
  const keys = [...new Set([...organNodes.map(o => o.key), "organs"])];
  for (const k of keys) {
    select(k); await sleep(90);
    for (const b of [...document.querySelectorAll("#npActs button")]) { b.click(); await sleep(120); }
  }
  // every analysis, through its card
  for (const a of ANALYSES) { selectAnalysis(a); await sleep(90); }
  // and the empty canvas
  select(null); await sleep(60);
  return out;
})()
"""


def main():
    p, ws = start()
    cmd, js, errors = session(ws)
    cmd("Runtime.enable")
    cmd("Page.enable")
    cmd("Emulation.setDeviceMetricsOverride", width=1440, height=1000, deviceScaleFactor=1, mobile=False)
    cmd("Page.navigate", url=URL + "?cb=%d" % (time.time() * 1000))
    time.sleep(3)
    for _ in range(200):
        if js("window.__ready && window.__ready()"):
            break
        time.sleep(0.3)

    fails = []
    for r in range(1, ROUNDS + 1):
        res = js(ACTIONS)
        if isinstance(res, str) and res.startswith("ERR"):
            fails.append(f"round {r}: actions threw {res}")
        time.sleep(0.6)
        bad = js(INVARIANTS)
        if isinstance(bad, str):
            fails.append(f"round {r}: invariant check threw {bad}")
        elif bad:
            fails.append(f"round {r}: " + "; ".join(bad))
        if r in (1, ROUNDS):
            shot(cmd, f"/tmp/stress_{r}.png")

    # the real mouse path, not just the programmatic one
    for x, y in [(720, 500), (720, 300), (500, 700), (900, 500)]:
        cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
        cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
        time.sleep(0.2)

    bad = js(INVARIANTS)
    if isinstance(bad, str):
        fails.append("after mouse clicks: " + bad)
    elif bad:
        fails.append("after mouse clicks: " + "; ".join(bad))

    print("rounds:", ROUNDS)
    print("js exceptions:", len(errors))
    for e in errors[:5]:
        print("   ", e)
    print("failures:", len(fails))
    for f in fails[:12]:
        print("  -", f)
    ws.close()
    p.terminate()
    return 1 if (fails or errors) else 0


if __name__ == "__main__":
    sys.exit(main())
