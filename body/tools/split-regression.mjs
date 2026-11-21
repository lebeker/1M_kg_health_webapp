#!/usr/bin/env node
/*
 * T24 — the split path, end to end, deterministically.
 *
 * "Split into systems" has shipped broken twice (HANDOVER.md, LIST OF PROBLEMS 1 and 5) and no
 * test covered it (LIST OF ISSUES 2): the acceptance scripts check selection, panel, timeline and
 * visibility, but nothing asserted that the split really produces six systems, that every edge
 * starts and ends on a node, or that the camera frames what the split put on screen.
 *
 * How: the page is served by the local HTTP server and fetched from it, so a missing file or a
 * wrong path fails here instead of looking like a broken page. Its own scripts (three.js, the
 * vendored loader and controls, d3-force-3d) are fetched from the same server, the real GLBs are
 * parsed by the real GLTFLoader, and the page's inline script runs in a Node VM. Renderer, DOM and
 * orbit controls are adapters, as in viewer-regression.test.mjs: this is not a WebGL render, it is
 * the state the browser draws from. The browser itself is exercised by the agentic e2e harness
 * (scripts/e2e), which is local by design; this file is the deterministic half.
 *
 * The server's liveness is checked with curl before anything is fetched. A dead
 * `python3 -m http.server 8770` has been mistaken for a broken page before (LIST OF ISSUES 4), so a
 * dead server exits 2 with an instruction, never as a failed assertion.
 *
 *   bun run test:split
 *   node body/tools/split-regression.mjs --port 8771 --root .neg   # run it on another tree
 *
 * Exit 0 pass, 1 the split is wrong, 2 no server.
 */
import {spawn, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import vm from "node:vm";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = name => argv.includes(`--${name}`);

const port = Number(arg("port", "8770"));
const root = path.resolve(REPO, arg("root", "."));
const pageUrl = arg("url", `http://127.0.0.1:${port}/body/index.html`);
const noStart = flag("no-start");
const loadTimeout = Number(arg("load-timeout", "240000"));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- the server: curl first, page second ---------------- */

function curl(url) {
  const r = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", url],
    {encoding: "utf8"});
  if (r.error || r.status !== 0) return null;
  return Number(r.stdout.trim());
}

async function fetchOrDie(url, what) {
  const status = curl(url);
  if (status !== 200) {
    throw new ServerError(`curl says ${what} is ${status === null ? "unreachable" : `HTTP ${status}`}: ${url}`);
  }
  const page = await fetch(url);
  if (!page.ok) throw new Error(`${what}: HTTP ${page.status} after curl said 200`);
  const body = await page.text();
  return {status: page.status, type: page.headers.get("content-type") || "", body};
}

class ServerError extends Error {}

let server = null;
async function ensureServer() {
  let status = curl(pageUrl);
  if (status === 200) return;
  if (noStart) throw new ServerError(`server is dead (curl ${status ?? "failed"}): ${pageUrl}`);
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    {cwd: root, stdio: "ignore"});
  server = child;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    status = curl(pageUrl);
    if (status === 200) return;
    if (child.exitCode !== null) break;
  }
  throw new ServerError(`started python3 -m http.server ${port} in ${root}, but curl still cannot reach ${pageUrl}`);
}

/* ---------------- the DOM adapter ---------------- */

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}

class Node2 {
  constructor(tag = "div") {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this.listeners = {};
    this.onclick = null;
    this.hidden = false;
    this.textContent = "";
    this.className = "";
    this._html = "";
    this.parent = null;
  }
  set innerHTML(v) { this._html = String(v); if (v === "") this.children = []; }
  get innerHTML() { return this._html; }
  set cssText(v) { this.style.cssText = v; }
  get cssText() { return this.style.cssText || ""; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parent = null; return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  blur() {}
  click() { if (this.onclick) this.onclick({target: {closest: () => null}, currentTarget: this}); }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0}; }
  getContext(kind) {
    if (kind !== "2d") return null;
    return {
      createRadialGradient: () => ({addColorStop() {}}),
      fillRect() {}, fillStyle: null, globalAlpha: 1, drawImage() {}, clearRect() {}
    };
  }
}

class FakeImage {
  constructor() {
    this.width = 2;
    this.height = 2;
    this.listeners = {};
    this.crossOrigin = null;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  set src(value) {
    this._src = value;
    // three's ImageLoader waits for the load event; nothing here needs pixels
    queueMicrotask(() => (this.listeners.load || []).forEach(fn => fn.call(this, {type: "load", target: this})));
  }
  get src() { return this._src; }
}

function makeDocument() {
  const byId = new Map();
  const doc = {
    getElementById(id) {
      if (!byId.has(id)) { const el = new Node2(id === "stage" ? "div" : "div"); el.id = id; byId.set(id, el); }
      return byId.get(id);
    },
    createElement(tag) { return String(tag).toLowerCase() === "img" ? new FakeImage() : new Node2(tag); },
    createElementNS(_ns, tag) { return String(tag).toLowerCase() === "img" ? new FakeImage() : new Node2(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: new Node2("body"),
    documentElement: new Node2("html")
  };
  return doc;
}

/* ---------------- the page, over the server ---------------- */

const LIBS = ["lib/three.min.js", "lib/GLTFLoader.js", "lib/OrbitControls.js",
  "lib/d3-dispatch.min.js", "lib/d3-quadtree.min.js", "lib/d3-octree.min.js",
  "lib/d3-timer.min.js", "lib/d3-force-3d.min.js"];

async function loadPage() {
  const page = await fetchOrDie(pageUrl, "the page");
  if (!/text\/html/.test(page.type)) throw new Error(`page is served as "${page.type}", not text/html`);
  if (!/<canvas id="stage"|id="stage"/.test(page.body)) throw new Error("served page has no #stage: it is not the body viewer");

  const libs = {};
  for (const rel of LIBS) {
    const url = new URL(rel, pageUrl).href;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`served page asks for ${rel}, server answered HTTP ${r.status}`);
    libs[rel] = await r.text();
  }

  const inline = page.body.match(/<script>\s*([\s\S]*?)<\/script>/);
  if (!inline) throw new Error("served page has no inline script");
  return {html: page.body, code: inline[1], libs};
}

/* ---------------- the app in a VM ---------------- */

function bootApp({code, libs}) {
  const sandbox = {
    console: {log() {}, warn() {}, error() {}},
    performance,
    TextDecoder, TextEncoder, URL, Blob, ArrayBuffer, Uint8Array, DataView, Promise, Math, JSON,
    navigator: {userAgent: "split-regression (node)"},
    innerWidth: 1440, innerHeight: 1000, devicePixelRatio: 2,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, queueMicrotask
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = makeDocument();
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(libs["lib/three.min.js"], sandbox);
  const THREE = sandbox.THREE;

  THREE.WebGLRenderer = class {
    constructor() {
      this.domElement = new Node2("canvas");
      this.shadowMap = {enabled: false, type: 0};
    }
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    setAnimationLoop() {}
    render() {}
    dispose() {}
    compile() {}
  };
  THREE.OrbitControls = class {
    constructor(object, domElement) {
      this.object = object;
      this.domElement = domElement;
      this.target = new THREE.Vector3();
      this.enableDamping = false;
    }
    update() {
      // what the real controls do to the camera every frame: look from position at target
      this.object.lookAt(this.target);
    }
    dispose() {}
  };

  for (const rel of LIBS.slice(1, 4)) vm.runInContext(libs[rel], sandbox);
  const ActualLoader = THREE.GLTFLoader;
  const loadLog = [];
  THREE.GLTFLoader = class extends ActualLoader {
    load(url, onLoad, onProgress, onError) {
      const abs = new URL(url, pageUrl).href;
      const rec = {url: abs, state: "start"};
      loadLog.push(rec);
      fetch(abs)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status} for ${abs}`))))
        .then(buf => {
          rec.state = `parsed ${buf.byteLength}`;
          return this.parse(buf, "", gltf => { rec.state = "loaded"; onLoad(gltf); }, onError);
        })
        .catch(err => { rec.state = `error ${err && err.message}`; onError(err); });
    }
  };
  for (const rel of LIBS.slice(4)) vm.runInContext(libs[rel], sandbox);

  vm.runInContext(code, sandbox, {filename: "body/index.html <inline script>"});
  sandbox.__loadLog = loadLog;
  return sandbox;
}

const evaluate = (sandbox, expr) => vm.runInContext(expr, sandbox);

async function until(sandbox, expr, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (evaluate(sandbox, expr)) return true;
    await sleep(50);
  }
  const diag = evaluate(sandbox, `JSON.stringify({
    pending, bodyBox: !!bodyBox, failed: failedFiles.slice(), total: loadTotal,
    done: loadDone, log: __loadLog.map(l => l.url.replace(/^.*\\/body\\//, "") + " " + l.state)
  })`);
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}: ${diag}`);
}

/* ---------------- the checks ---------------- */

const failures = [];
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  else { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); failures.push(name); }
}

function dist3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

function pointSegmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
  return dist3(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

async function main() {
  await ensureServer();
  const page = await loadPage();
  const sandbox = bootApp(page);
  await until(sandbox, "__ready()", loadTimeout, "the page to finish loading its models");
  const loadErrors = evaluate(sandbox, "__loadErrors()");
  if (loadErrors.length) throw new Error(`page could not load: ${loadErrors.join(", ")}`);

  /* the gesture, not a hook: select the organs set, press "split into systems" in its panel */
  const pressed = evaluate(sandbox, `(() => {
    select("organs");
    const acts = document.getElementById("npActs");
    const btn = acts.children.find(b => (b.textContent || "").trim() === "split into systems");
    if (!btn) return "the organs panel has no 'split into systems' button";
    btn.click();
    return null;
  })()`);
  if (pressed) throw new Error(pressed);

  const snap = evaluate(sandbox, `(() => {
    // two seconds of the real frame loop at 60 fps: the group lerps settle on their slots, the
    // camera finishes its fly-to, and updateEdges() writes the buffer from node world positions
    const settle = () => { clock.getDelta = () => 1 / 60; for (let i = 0; i < 150; i++) tick(); };
    const frameOf = () => {
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.updateProjectionMatrix();
      const tanH = Math.tan(camera.fov * Math.PI / 360);
      return {
        distance: camera.position.distanceTo(controls.target),
        nodes: organNodes.map(o => {
          const p = new THREE.Vector3();
          o.node.getWorldPosition(p);
          const cp = p.clone().applyMatrix4(camera.matrixWorldInverse);
          const v = p.clone().project(camera);
          const r = o.node.userData.radius || 0;
          const depth = Math.abs(cp.z);
          const halfH = depth * tanH, halfW = halfH * camera.aspect;
          const rx = r / (depth * tanH * camera.aspect);
          return {
            id: o.meta.id, radius: r,
            pos: [p.x, p.y, p.z],
            ndc: [v.x, v.y, v.z],
            // a node is a ball: inside means the whole ball, not just its centre
            inside: Math.abs(cp.x) + r <= halfW && Math.abs(cp.y) + r <= halfH &&
                    depth - r > camera.near && depth + r < camera.far,
            // informational: the rail covers 236 px, the open node panel 320 px
            inStrip: (() => {
              const panelL = state.collapsed ? 28 : 236, panelR = state.sel ? 320 : 0;
              const x0 = panelL / innerWidth * 2 - 1, x1 = 1 - panelR / innerWidth * 2;
              return v.x - rx >= x0 && v.x + rx <= x1;
            })()
          };
        })
      };
    };
    // the frame the user gets when the split button is pressed
    settle();
    const afterClick = frameOf();
    // what layout() alone asks for (no fly-to-selection on top)
    camKey = ""; layout(); settle();
    const afterLayout = frameOf();
    const arr = edges ? Array.from(edges.geometry.attributes.position.array) : [];
    const set = setCentre();
    return {
      nodes: afterClick.nodes, layoutNodes: afterLayout.nodes, buffer: arr,
      set: [set.x, set.y, set.z],
      camera: {distance: afterClick.distance, layoutDistance: afterLayout.distance},
      panel: {collapsed: state.collapsed, sel: state.sel},
      groups: organNodes.map(o => o.meta.id),
      spread: (() => {
        let max = 0;
        for (let i = 0; i < organNodes.length; i++) for (let j = i + 1; j < organNodes.length; j++) {
          const a = new THREE.Vector3(), b = new THREE.Vector3();
          organNodes[i].node.getWorldPosition(a); organNodes[j].node.getWorldPosition(b);
          max = Math.max(max, a.distanceTo(b));
        }
        return max;
      })()
    };
  })()`);

  const n = snap.nodes.length, e = snap.buffer.length / 6;
  console.log(`split into systems: ${n} nodes, ${e} edges, node spread ${snap.spread.toFixed(2)} units`);
  console.log(`  systems: ${snap.groups.join(", ")}`);
  console.log(`  camera after the click: ${snap.camera.distance.toFixed(2)} units out; ` +
    `layout()'s own frame: ${snap.camera.layoutDistance.toFixed(2)} units out`);

  check("six systems, six edges", n === 6 && e === 6, `${n} nodes / ${e} edges`);

  // every edge is drawn between a node and a node: read the buffer that is rendered, not the
  // pairs the code meant to draw
  const targets = snap.nodes.map(o => ({id: o.id, pos: o.pos})).concat([{id: "the set", pos: snap.set}]);
  const endpoints = [];
  for (let i = 0; i < e; i++) {
    endpoints.push({edge: i, end: "start", p: snap.buffer.slice(i * 6, i * 6 + 3)});
    endpoints.push({edge: i, end: "end", p: snap.buffer.slice(i * 6 + 3, i * 6 + 6)});
  }
  const floating = endpoints.filter(ep => !targets.some(t => dist3(ep.p, t.pos) < 1e-3));
  check("every edge endpoint is on a node", snap.buffer.length === e * 6 && floating.length === 0,
    floating.length ? `${floating.map(f => `edge ${f.edge} ${f.end}`).join(", ")} in empty space`
                    : `${endpoints.length} endpoints`);

  // no endpoint on another edge: sharing a node is the whole point of a star, so only an endpoint
  // that sits in the INTERIOR of another edge counts
  const crossings = [];
  for (const ep of endpoints) {
    for (let j = 0; j < e; j++) {
      if (j === ep.edge) continue;
      const a = snap.buffer.slice(j * 6, j * 6 + 3), b = snap.buffer.slice(j * 6 + 3, j * 6 + 6);
      if (dist3(ep.p, a) < 1e-3 || dist3(ep.p, b) < 1e-3) continue;
      if (pointSegmentDistance(ep.p, a, b) < 1e-3) crossings.push(`edge ${ep.edge} ${ep.end} on edge ${j}`);
    }
  }
  check("no edge endpoint lies on another edge", crossings.length === 0,
    crossings.length ? crossings.join(", ") : `${endpoints.length} endpoints clear`);

  const outside = snap.nodes.filter(o => !o.inside);
  check("every node is inside the camera frame after the split", outside.length === 0,
    outside.length ? outside.map(o => `${o.id} at ndc ${o.ndc.map(v => v.toFixed(2)).join(",")}`).join("; ")
                   : `${n} nodes, camera ${snap.camera.distance.toFixed(2)} units out`);

  const layoutOutside = snap.layoutNodes.filter(o => !o.inside);
  const stripOutside = snap.nodes.filter(o => !o.inStrip);
  if (layoutOutside.length || stripOutside.length) {
    console.log(`  note: layout()'s own frame leaves ${layoutOutside.length}/${n} outside; ` +
      `${stripOutside.length}/${n} also sit under the rail or the open panel`);
  }

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} split check(s) failed: ${failures.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nPASS: the split puts six systems on screen, every edge runs node to node, and the frame holds them.");
  }
}

const exit = code => { if (server) server.kill(); setTimeout(() => process.exit(code), 50); };

try {
  await main();
  exit(failures.length ? 1 : 0);
} catch (err) {
  if (err instanceof ServerError) {
    console.error(`\nSERVER DEAD — this is not a page failure.\n${err.message}\n` +
      `Start it with: (cd ${root} && python3 -m http.server ${port} --bind 127.0.0.1)`);
    exit(2);
  } else {
    console.error(`\nFAIL: ${err && err.message ? err.message : err}`);
    exit(1);
  }
}
