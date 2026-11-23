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
 *      off by default, and a model is fetched only for a body that is on screen — after the yes,
 *      or when a body switch deferred while the layer was hidden is caught up with the layer on.
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
    const start = bar.indexOf('id="openGraph"')
    const btn = bar.slice(start, bar.indexOf('</svg></button>', start))
    expect(btn).toContain('title="open graph')
    expect(btn).toContain('aria-label="open graph"')
    expect(btn).toContain('aria-pressed="false"')
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

/**
 * SCRUM-49 — the graph is the app's data, drawn as a view, and its button belongs beside the profile
 * control: one right-hand group of two buttons, with the title alone on the left.
 *
 * Reopened after the owner's wireframe audit. Round 1 put the graph button next to the sex toggle and
 * called that the profile control; v11's header is widget 1 — a filled 30px square holding the
 * hexagon — immediately left of widget 2, the profile box that reads `male · 1961 (65)`. Nothing else
 * stands on that side, and the sex switch is widget 30's knob inside the profile view, not chrome.
 *
 * What a browser has to show (the group's geometry, the identity text, the open/back round trip) is
 * proved in the card's acceptance run; what the page is made of is pinned here.
 */
describe('the header: one right-hand group, graph and profile (SCRUM-49)', () => {
  const bar = page.slice(page.indexOf('<div class="bar">'), page.indexOf('<div id="leftCol">'))
  const at = (needle: string) => bar.indexOf(needle)
  const group = bar.slice(at('<div class="hgroup'), bar.indexOf('</div>', at('<div class="hgroup')))

  test('the left of the header is the title, and the summary button is the only control before it', () => {
    // SCRUM-66 renamed the page and put the document's own summary at the leftmost edge. The bar
    // still opens on nothing but that control and the wordmark; the title is the page's name.
    const title = at('<b class="only-main">My health story</b>')
    expect(title).toBeGreaterThan(-1)
    // between the bar's own tag and the title: the summary button and nothing else
    const before = bar.slice(bar.indexOf('>') + 1, title)
    expect(before.match(/<button/g)?.length).toBe(1)
    expect(before).toContain('id="summaryBtn"')
  })

  test('one group at the right end, two buttons, graph first', () => {
    expect(at('id="hgroup"')).toBeGreaterThan(at('class="spacer"'))
    expect(group).toContain('role="group"')
    expect(group.match(/<button/g)?.length).toBe(2)
    expect(group.indexOf('id="openGraph"')).toBeGreaterThan(-1)
    expect(group.indexOf('id="profileBtn"')).toBeGreaterThan(group.indexOf('id="openGraph"'))
    // nothing between them but the group's own markup
    expect(group).toMatch(/id="openGraph"[\s\S]*<\/svg><\/button>\s*<button id="profileBtn"/)
  })

  test('both are the same 30px box, six pixels apart, and the square is filled', () => {
    expect(page).toMatch(/\.hgroup \{ display:inline-flex; align-items:stretch; gap:6px; \}/)
    expect(page).toMatch(/#openGraph \{ width:30px; height:30px; padding:0;/)
    expect(page).toMatch(/#openGraph \{[^}]*background:#0f1620;/)
    expect(page).toMatch(/#profileBtn \{ height:30px;/)
    expect(page).toMatch(/#profileBtn .ptxt \{[^}]*font-size:11\.5px;/)
  })

  test('the profile button is the record, not a constant in the page', () => {
    // the markup carries a placeholder; the identity is written from `meta.profile` at launch and
    // repainted whenever a document lands, so a female file is not shown as a male one
    expect(group).toContain('id="profileWho"')
    expect(group).not.toMatch(/19\d\d|male ·|female ·/)
    expect(page).toMatch(/function paintProfileButton\(\) \{/)
    expect(page).toMatch(/const p = profileOf\(\);/)
    expect(page).toMatch(/out\.textContent = who \|\| "no profile";/)
    expect(page).toMatch(/const p = \(TL_META && TL_META\.profile\) \|\| \{\};/)
    expect(page).toMatch(/paintProfileButton\(\);/)
    // T05: the one switch starts on the sex the document states, read after the document is in hand
    expect(page).toMatch(/const PROFILE_SEX = TL_META\.profile && TL_META\.profile\.sex;\s*if \(PROFILE_SEX === "male" \|\| PROFILE_SEX === "female"\) state\.sex = PROFILE_SEX;/)
  })

  test('the profile button opens the profile view in the same shell', () => {
    expect(page).toContain('document.getElementById("profileBtn").onclick = () => setProfileView(!state.profile);')
    expect(page).toContain('document.getElementById("profileBack").onclick = () => setProfileView(false);')
    expect(page).toMatch(/function setProfileView\(open\) \{\s*state\.profile = !!open;\s*document\.body\.classList\.toggle\("profile-open", state\.profile\);/)
    expect(page).toMatch(/if \(state\.profile\) \{\s*state\.mainHidden = false;\s*buildProfile\(\); \}/)
    // the view is the centre column of this page: no second page, no navigation
    expect(page).not.toMatch(/window\.location\s*=|location\.href\s*=/)
  })

  test('back returns to the same selected date, because no view writes it', () => {
    const view = page.slice(page.indexOf('function setProfileView(open)'), page.indexOf('document.getElementById("profileBtn").onclick'))
    expect(view).not.toContain('state.date')
    // and a date picked anywhere (ruler, player, a row, a linked item) leaves the profile view
    const selectDate = page.slice(page.indexOf('function selectDate(d, id)'), page.indexOf('function tlStep('))
    expect(selectDate).toContain('state.profile = false;')
  })

  test('the sex switch is widget 30 inside that view, not header chrome', () => {
    expect(bar).not.toContain('id="sex"')
    const profileBody = page.slice(page.indexOf('id="profileBody"'), page.indexOf('<aside id="rightCol"'))
    expect(profileBody).toContain('id="sex"')
    expect(profileBody).toContain('the document is not written')
    // the view says which reading is on screen when the knob and the file disagree
    expect(page).toMatch(/the document says " \+ p\.sex \+ " · reading as " \+ state\.sex/)
  })

  test('still one button on one page: it opens the view and writes no file', () => {
    // the click path is unchanged: the button opens the page's own view of the document it holds
    expect(page).toContain('document.getElementById("openGraph").onclick = () => setGraphView(true);')
    // no second page and no second file for the graph: the view is this page
    expect(page).not.toMatch(/window\.location\s*=|location\.href\s*=/)
  })
})

describe('read-only: the viewer renders the document and cannot change it', () => {
  test('there is no write path in the page at all', () => {
    // no storage, no sockets, no beacons, no request: the document arrives in the `#kg-graph`
    // placeholder (replaced when the page is rendered) and is drawn, never sent anywhere. There is
    // no fetch at all — not the demo, not a sidecar (T01)
    expect(page).not.toMatch(/localStorage\.(setItem|removeItem|clear)/)
    expect(page).not.toMatch(/sessionStorage|indexedDB|sendBeacon|new WebSocket|XMLHttpRequest/)
    expect(page).not.toMatch(/fetch\([^)]*method\s*:/)
    expect(page.match(/fetch\(/g)?.length ?? 0).toBe(0)
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
    const start = page.slice(page.indexOf('document.getElementById("layerNo").onclick'));
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

  test('a body switch while the question is open restates the number it will fetch', () => {
    // applySex() refreshes the open question before it decides anything else, and refreshAsk()
    // re-renders from state.sex: the number cannot stay on the body the reader left
    const sex = page.slice(page.indexOf('function applySex()'), page.indexOf('function fitDistance('))
    expect(sex.indexOf('refreshAsk();')).toBeGreaterThan(-1)
    expect(sex.indexOf('refreshAsk();')).toBeLessThan(sex.indexOf('anatomyLoadedSex !== state.sex'))
    expect(page).toMatch(
      /function refreshAsk\(\) \{\s*const panel = document\.getElementById\("layerAsk"\);\s*if \(panel && !panel\.hidden\) askLayer3d\(true\);\s*\}/
    )
    // the question recomputes the size; it never hard-codes one body's number
    const ask = page.slice(page.indexOf('function askLayer3d(show)'), page.indexOf('function refreshAsk()'))
    expect(ask).not.toMatch(/\d+(\.\d+)? MB/)
    expect(ask).toMatch(/megabytes\(anatomyBytes\(state\.sex\)\)|const bytes = anatomyBytes\(state\.sex\)/)
    // and the two bodies really do cost different amounts, so the switch is observable
    const table = new Map([...page.matchAll(/"([a-z0-9-]+\.glb)": (\d+)/g)].map((m) => [m[1], Number(m[2])]))
    const bytes = (s: 'male' | 'female') =>
      anatomyRows(s).reduce((n, f) => n + (table.get(f.file) ?? 0), 0)
    expect(bytes('female')).toBeGreaterThan(bytes('male'))
  })

  test('the layer-off note is printed once, and never by the hint', () => {
    // #foot and .hint are siblings on the same bar: the same sentence in both read as a stutter.
    // The hint owns the camera controls; #foot owns what the layer costs.
    const set3d = page.slice(page.indexOf('function set3dButton()'), page.indexOf('/* the question:'))
    expect(set3d).not.toContain('footBody()')
    expect(set3d).not.toContain('already here')
    expect(set3d).toContain('drag to orbit · scroll to zoom · double-click a node to frame it')
    // and the sentence lives in footBody(), which is the only place that writes it
    expect(page.match(/already here, so turning it back on costs nothing/g)?.length).toBe(1)
    const foot = page.slice(page.indexOf('function layerOffNote()'), page.indexOf('function anatomyStale()'))
    expect(foot).toContain('the 3D layer is off')
  })

  test('the layer-off note tells the truth about the body that would load', () => {
    // load his body, go back, turn the layer off, switch to hers, reopen: the next toggle-on
    // fetches her 20.6 MB. The bar must say so instead of "its models are already here".
    const foot = page.slice(page.indexOf('function layerOffNote()'), page.indexOf('function anatomyStale()'))
    expect(foot).toContain('anatomyStale()')
    expect(foot).toMatch(/megabytes\(anatomyBytes\(state\.sex\)\)/)
    expect(foot).toContain('"her"')
    expect(foot).toContain('"his"')
    // "already here / costs nothing" is the fall-through, reachable only when the loaded body is
    // the reader's body: the stale branch returns before it
    expect(foot.indexOf('anatomyStale()')).toBeLessThan(foot.indexOf('already here'))
    // and the note is re-written whenever the state behind it changes
    expect(page).toMatch(/function applySex\(\)[\s\S]*?document\.getElementById\("foot"\)\.textContent = footBody\(\);/)
    const set3d = page.slice(page.indexOf('function setAnatomy3d('), page.indexOf('/* what the map draws'))
    expect(set3d).toContain('document.getElementById("foot").textContent = footBody();')
    // two bodies, two sizes, so the sentence is observable
    const table = new Map([...page.matchAll(/"([a-z0-9-]+\.glb)": (\d+)/g)].map((m) => [m[1], Number(m[2])]))
    const bytes = (s: 'male' | 'female') => anatomyRows(s).reduce((n, f) => n + (table.get(f.file) ?? 0), 0)
    expect(bytes('female')).not.toBe(bytes('male'))
  })

  test('with the layer off or the graph closed a body switch downloads nothing', () => {
    // the other body's files are fetched only while that body would be on screen
    const sex = page.slice(page.indexOf('function applySex()'), page.indexOf('function fitDistance('))
    expect(sex).toContain('if (state.anatomy3d && state.graph) { boot(); return; }')
    // and the deferred body is caught up where the reader can see it, not in the background
    expect(page).toMatch(/function anatomyStale\(\) \{ return viewerStarted && !!anatomyLoadedSex && anatomyLoadedSex !== state\.sex; \}/)
    const set3d = page.slice(page.indexOf('function setAnatomy3d('), page.indexOf('/* what the map draws'))
    expect(set3d).toContain('if (anatomyStale()) { boot(); return; }')
    const view = page.slice(page.indexOf('function setGraphView(open)'), page.indexOf('document.getElementById("openGraph").onclick'))
    expect(view).toContain('if (state.anatomy3d && anatomyStale()) boot();')
    // opening the view still fetches nothing: boot() is not reachable from openGraphView itself
    const open = page.slice(page.indexOf('function openGraphView()'), page.indexOf('function setGraphView('))
    expect(open).not.toContain('boot(')
  })
})
