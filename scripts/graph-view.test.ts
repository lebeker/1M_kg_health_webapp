import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * T27 — the graph is a tool behind one button, not the product.
 *
 * The card's acceptance has three halves and this file pins the two that can be checked without a
 * browser:
 *
 *   1. one button ("open graph", widget 1) opens the page's own viewer in a view of its own;
 *   2. that view is read-only — the page has no write path at all, so nothing in the graph can add,
 *      connect or delete a node;
 *   3. the main flow never requires it — the ruler, the records list and the centre view are built
 *      at launch, and since T28 no model loads when the view opens: the 3D layer is its own toggle,
 *      off by default, and the only thing that ever fetches a model is its yes button.
 *
 * The fourth half — back returns to the selected date — is behaviour on the page, not text, and is
 * proved in the card's browser run (`__graph()`, `__selectRecord`, `__closeGraph`). What is pinned
 * here is that closing rebuilds the main flow from `state.date`, which the graph view never writes.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The 3D layer's own file list, read out of the page: [lazy] rows of ["layer", "file", sex|null]. */
function anatomyRows(sex: 'male' | 'female') {
  const from = page.indexOf(`${sex}: [`)
  const to = sex === 'male' ? page.indexOf('],\n  female: [') : page.indexOf(']\n};', from)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return [...page.slice(from, to).matchAll(/\["([a-z]+)", "([a-z0-9-]+)", (?:null|"[a-z]+")\]/g)]
    .map((m) => ({ layer: m[1], file: `${m[2]}.glb` }))
}

describe('widget 1: one button, a view of its own', () => {
  test('the button is in the header, square and hexagon-shaped, and says what it opens', () => {
    const bar = page.slice(page.indexOf('<div class="bar">'), page.indexOf('<div id="leftCol">'))
    const btn = bar.slice(bar.indexOf('id="openGraph"'), bar.indexOf('class="only-main">Body'))
    expect(btn).toContain('title="open graph')
    expect(btn).toContain('aria-label="open graph"')
    expect(btn).toContain('aria-pressed="false"')
    // the registry's icon: a hexagon with the nodes on it
    expect(btn).toMatch(/<svg[^>]*>[\s\S]*<path d="M8 1\.7 13\.4 4\.85/)
    expect(btn.match(/<circle/g)?.length).toBe(4)
  })

  test('the view has its own chrome, and it says read-only', () => {
    expect(page).toContain('id="graphBack"')
    expect(page).toContain('← back')
    expect(page).toMatch(/class="gnote only-graph">read-only[^<]*kg\.json[^<]*never writes it/)
  })

  test('the view is not the main flow: each side hides the other', () => {
    // closed: no scene, no boot overlay, no node panel, no layer list
    expect(page).toMatch(/body:not\(\.graph-open\) #stage,\s*body:not\(\.graph-open\) #boot,/)
    expect(page).toMatch(/body:not\(\.graph-open\) #node,/)
    expect(page).toMatch(/body:not\(\.graph-open\) \.legend,/)
    // open: no centre view, no records list, no product-only header controls
    expect(page).toMatch(/body\.graph-open #main \{ display:none !important; \}/)
    expect(page).toMatch(/body\.graph-open #state \{ display:none; \}/)
    expect(page).toMatch(/body\.graph-open \.only-main \{ display:none !important; \}/)
    // the boot overlay starts hidden and is opened by the button, not by the page
    expect(page).toContain('<div id="boot" hidden>')
    expect(page).toContain('#boot[hidden] { display:none; }')
  })
})

describe('read-only: the viewer renders the document and cannot change it', () => {
  test('there is no write path in the page at all', () => {
    // no storage, no sockets, no beacons, no non-GET request: the document arrives (embedded or
    // fetched) and is drawn, never sent anywhere
    expect(page).not.toMatch(/localStorage\.(setItem|removeItem|clear)/)
    expect(page).not.toMatch(/sessionStorage|indexedDB|sendBeacon|new WebSocket|XMLHttpRequest/)
    expect(page).not.toMatch(/fetch\([^)]*method\s*:/)
    // the one fetch is the demo artifact, GET, page-relative (T01's rule, kept here)
    expect(page.match(/fetch\(/g)?.length).toBe(1)
    expect(page).toContain('fetch("demo/graph.json"')
  })

  test('no control in the page offers to add, connect or delete a node', () => {
    // every label the page writes into a button: the graph's own panel actions only move what is
    // on screen (take out, put back, split, open the document). None of them touches the document.
    const labels = [...page.matchAll(/textContent\s*=\s*"([^"]*)"/g)].map(m => m[1])
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label).not.toMatch(/\b(add|create|delete|remove|connect|unlink)\b/i)
    }
    // and no function by those names exists to be wired to a future button
    expect(page).not.toMatch(/function\s+(addNode|addEdge|deleteNode|removeNode|connectNodes?)\s*\(/)
  })
})

describe('the main flow never requires the graph', () => {
  test('the page builds the ruler and the list at launch, and starts no viewer', () => {
    const start = page.slice(page.indexOf('const loadDemoBtn ='));
    const order = ['buildLegend()', 'buildStateList()', 'buildTimeline()', 'refreshPick()', 'tick()']
    let at = -1
    for (const call of order) {
      const next = start.indexOf(`\n${call}`, at + 1)
      expect(next).toBeGreaterThan(at)
      at = next
    }
    // boot() is behind the button now, with one guard so a second open does not stack a second body
    expect(page).not.toMatch(/^boot\(\);/m)
    expect(page).toMatch(/function startViewer\(\) \{\s*\/\/[^\n]*\n\s*if \(viewerStarted\) return;/)
    expect(page).toMatch(/if \(state\.graph\) \{\s*openGraphView\(\);/)
  })

  test('back returns to the selected date, which the graph view never touches', () => {
    // the only thing that moves the date is selectDate(); the graph view calls neither it nor
    // setStateDate, and closing rebuilds the marker, the row and the centre from state.date
    const view = page.slice(page.indexOf('function setGraphView(open)'), page.indexOf('document.getElementById("openGraph").onclick'))
    expect(view).not.toContain('selectDate')
    expect(view).not.toContain('state.date =')
    expect(view).toContain('refreshPick()')
    // refreshPick is the one path that rebuilds the whole main flow from the date
    expect(page).toMatch(/function refreshPick\(\) \{[\s\S]*?markStateRow\(\);[\s\S]*?renderMain\(\);/)
  })
})

/**
 * T28 — the 3D layer is a layer of the graph view, not the view.
 *
 * The card's acceptance has four halves and this file pins all four that can be checked without a
 * browser: it is a toggle of its own, it asks a question that names the download, it loads lazily,
 * and it is off until a click answers yes. The fifth — that the `kg` skill asks before downloading
 * models — is pinned where the app can hold it: `app.json` declares the layer and its bytes, and
 * `docs/GRAPH-VIEW.md` states the rule the skill implements.
 *
 * What a browser has to show is proved in the card's acceptance run: `__openGraph()` with model
 * requests at 0, `__ask3d()`, `__load3d()`, and the model count going up only after the yes.
 */
describe('T28: the 3D layer is a layer, off by default, and the only download', () => {
  test('it starts off, and the view says so', () => {
    expect(page).toMatch(/anatomy3d:false\s+\/\/ the 3D layer inside that view/)
    expect(page).toMatch(/<button id="layer3d" class="only-graph" aria-pressed="false"/)
    expect(page).toContain('3D layer · off')
    // the layer list is hidden while the layer is off: a list of what is not in the scene says nothing
    expect(page).toMatch(/body\.graph-open:not\(\.anatomy-open\) #leftCol \{ display:none; \}/)
  })

  test('opening the graph downloads nothing — it draws the marks the page already has', () => {
    const open = page.slice(page.indexOf('function openGraphView()'), page.indexOf('function setGraphView('))
    expect(open).toContain('buildAnalyses()')
    for (const network of ['startViewer', 'boot(', 'loadFile', 'fetch(', 'XMLHttpRequest', 'new Image']) {
      expect(open).not.toContain(network)
    }
    expect(page).toMatch(/document\.getElementById\("openGraph"\)\.onclick = \(\) => setGraphView\(true\);/)
    // the model url is written once, in loadFile, and loadFile is reached from boot() only
    expect(page.match(/models\/\$\{file\}\.glb/g)?.length).toBe(1)
    const start = page.slice(page.indexOf('function startViewer()'), page.indexOf('function setAnatomy3d('))
    expect(start).toContain('boot();')
  })

  test('the question is explicit, and the yes carries the number it names', () => {
    const ask = page.slice(page.indexOf('function askLayer3d(show)'), page.indexOf('function startViewer()'))
    expect(ask).toContain('The shell, the skeleton and the organs')
    expect(ask).toContain('Nothing is downloaded until you say yes.')
    expect(ask).toMatch(/megabytes\(bytes\)/)
    expect(ask).toContain('"load " + megabytes(bytes)')
    // answered by a click, not by a browser dialog nobody can read twice
    expect(page).not.toMatch(/\b(confirm|alert|prompt)\(/)
    expect(page).toMatch(/getElementById\("layerYes"\)\.onclick = \(\) => \{ askLayer3d\(false\); startViewer\(\); \};/)
    expect(page).toMatch(/getElementById\("layerNo"\)\.onclick = \(\) => askLayer3d\(false\);/)
  })

  test('the bytes it promises are the bytes on disk, for both bodies', () => {
    const table = new Map([...page.matchAll(/"([a-z0-9-]+\.glb)": (\d+)/g)].map((m) => [m[1], Number(m[2])]))
    expect(table.size).toBe(10)
    for (const sex of ['male', 'female'] as const) {
      const files = anatomyRows(sex)
      expect(files.length).toBe(7)
      for (const f of files) {
        expect(table.get(f.file)).toBe(statSync(join(ROOT, 'body/models', f.file)).size)
      }
      expect([...new Set(files.map((f) => f.layer))].sort()).toEqual(['bones', 'organs', 'skin'])
      const bytes = files.reduce((n, f) => n + (table.get(f.file) ?? 0), 0)
      // the card's "~15 MB": his body 16.6, hers 20.6 — the question prints whichever one is true
      expect(bytes).toBeGreaterThan(14e6)
      expect(bytes).toBeLessThan(22e6)
    }
  })

  test("the body's detail is not downloaded for the map", () => {
    const layers = anatomyRows('male').map((f) => f.layer)
    for (const layer of ['muscles', 'cardio', 'nervous', 'lymphoid']) expect(layers).not.toContain(layer)
  })

  test('the kg skill is told what the layer costs, and that it must ask', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
      models?: { layer?: string; note?: string; files?: { file: string; bytes: number }[] }
    }
    expect(manifest.models?.layer).toBe('3d')
    expect((manifest.models?.files ?? []).length).toBeGreaterThan(0)
    for (const f of manifest.models?.files ?? []) {
      expect(statSync(join(ROOT, 'body/models', f.file)).size).toBe(f.bytes)
    }
    expect(manifest.models?.note ?? '').toMatch(/ask/i)
    const doc = read('docs/GRAPH-VIEW.md')
    expect(doc).toMatch(/The `kg` skill asks too/)
    expect(doc).toMatch(/ask\s+before downloading/i)
  })
})
