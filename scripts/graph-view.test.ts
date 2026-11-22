import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

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
 *      at launch, and the 35 MB of models load only when the button is pressed.
 *
 * The fourth half — back returns to the selected date — is behaviour on the page, not text, and is
 * proved in the card's browser run (`__graph()`, `__selectRecord`, `__closeGraph`). What is pinned
 * here is that closing rebuilds the main flow from `state.date`, which the graph view never writes.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')

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
    expect(page).toMatch(/if \(state\.graph\) \{\s*startViewer\(\);/)
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
