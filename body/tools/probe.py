#!/usr/bin/env python3
"""Probe the health app in headless Chrome.

usage: verify.py [--shot out.png] [--js "expression"] [--steps steps.py] [--w 1440] [--h 1000]
The default steps take the organs layer out, then split it into systems, then screenshot.
"""
import base64, json, subprocess, sys, time, urllib.request, os
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = int(os.environ.get("CDP_PORT", "10801"))
URL = os.environ.get("APP_URL", "http://127.0.0.1:8770/body/index.html")

args = sys.argv[1:]
def arg(name, default=None):
    return args[args.index(name) + 1] if name in args else default

W = int(arg("--w", "1440")); H = int(arg("--h", "1000"))
SCALE = float(arg("--scale", "2"))
SHOT = arg("--shot")
JS = arg("--js")
STEPS = arg("--steps")
MODE = arg("--mode", "split")          # split | merged | plain
PORT = int(arg("--port", str(PORT)))

proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
                         f"--user-data-dir=/tmp/kgchrome-{PORT}", f"--window-size={W},{H}",
                         f"--force-device-scale-factor={SCALE}", "--hide-scrollbars", "about:blank"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(120):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1).read(); break
    except Exception:
        time.sleep(0.3)
req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/new?about:blank", method="PUT")
tab = json.loads(urllib.request.urlopen(req).read())
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=120)
seq = [0]; errors = []

def cmd(method, **params):
    seq[0] += 1
    ws.send(json.dumps({"id": seq[0], "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("method") == "Runtime.exceptionThrown":
            d = msg["params"]["exceptionDetails"]
            errors.append(str(d.get("exception", {}).get("description"))[:220])
        if msg.get("id") == seq[0]:
            return msg

def js(expr):
    r = cmd("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
    if "exceptionDetails" in r.get("result", {}):
        return "ERR " + str(r["result"]["exceptionDetails"].get("exception", {}).get("description"))[:220]
    return r["result"]["result"].get("value")

def shot(path):
    cmd("Page.bringToFront"); time.sleep(0.7)
    s = cmd("Page.captureScreenshot", format="png")
    open(path, "wb").write(base64.b64decode(s["result"]["data"]))
    print("shot", path)

cmd("Runtime.enable"); cmd("Page.enable")
cmd("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=SCALE, mobile=False)
cmd("Page.navigate", url=f"{URL}?cb={time.time()*1000:.0f}")
ready = False
for _ in range(240):
    if js("!!(window.__ready && window.__ready())"):
        ready = True; break
    time.sleep(0.3)
print("ready:", ready, "| js errors:", len(errors))
for e in errors[:3]:
    print("  ERR", e)

if MODE == "merged":
    js("document.querySelector('.row[data-layer=\"organs\"]').click()"); time.sleep(1.0)
elif MODE == "split":
    js("document.querySelector('.row[data-layer=\"organs\"]').click()"); time.sleep(1.0)
    js("select('organs')"); time.sleep(0.5)
    js("document.querySelectorAll('#npActs button')[0].click()"); time.sleep(3.2)
    js("select(null)"); time.sleep(2.2)

if STEPS:
    exec(open(STEPS).read())

if JS:
    print(js(JS))
if SHOT:
    shot(SHOT)
ws.close(); proc.terminate()
