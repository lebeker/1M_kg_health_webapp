import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * T23 — demo ≠ user. SCRUM-48 — the demo page opens with its case.
 *
 * Somebody else's labs must never end up in the reader's own record. `body/demo/graph.json` is a
 * finished document about an invented man, and the checked-in page fetches it at launch, because a
 * demo that needs a click before it has anything in it is not a demo. This card is the proof that
 * the load is a *view*: a clean workspace that opens on the demo still has no user data afterwards —
 * nothing in storage, no second record, no profile the reader did not bring.
 *
 * The static half (`demo-artifact.test.ts`) greps for the one write call it knows about. That grep
 * cannot hold the rule: a write path can arrive under another name, another API, or three lines
 * below a comment that says "nothing is saved". So `loadDemo` is executed here, out of the page
 * itself, against the real demo file and a recording storage — and the whole page is held to its
 * own sentence, "Nothing on this page writes to storage".
 *
 * The other half of the card is the guard: only a page with no rendered document (`#kg-graph`
 * absent) loads the demo. A rendered page is the reader's own and fetches nothing, so its empty
 * start stays empty. Both halves are executed below, not only grepped.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')
const demo = JSON.parse(read('body/demo/graph.json')) as {
  meta: { demo?: boolean; profile?: { sex?: string; year_of_birth?: number } }
  nodes: unknown[]
  edges: unknown[]
}

/** The readers `loadDemo` is made of, by the names `body/index.html` declares them. */
const LOAD_PARTS = [
  'finiteOrNaN',
  'evidenceOf',
  'confidenceOf',
  'isMark',
  'whenOf',
  'markersOf',
  'toAnalyses',
  'dayOf',
  'birthOf',
  'applyDocument',
  'loadDemo',
] as const

/** One `function name(...) { ... }` (or `async function`) out of the page, by its text. */
function pageFunction(html: string, name: string): string | null {
  const start = html.search(new RegExp(`\\n(?:async )?function ${name}\\(`))
  if (start < 0) return null
  const end = html.indexOf('\n}\n', start)
  return end < 0 ? null : html.slice(start + 1, end + 2)
}

/** What a storage the page must not write to looks like: every call is recorded. */
type Spy = {
  writes: Array<{ key: string; value: string }>
  removed: string[]
  clears: number
  reads: string[]
  keys: () => string[]
  api: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
    clear: () => void
    key: (index: number) => string | null
    readonly length: number
  }
}

function storageSpy(): Spy {
  const data = new Map<string, string>()
  const writes: Array<{ key: string; value: string }> = []
  const removed: string[] = []
  const reads: string[] = []
  const spy: Spy = {
    writes,
    removed,
    clears: 0,
    reads,
    keys: () => [...data.keys()],
    api: {
      getItem: (key) => {
        reads.push(key)
        return data.has(key) ? (data.get(key) as string) : null
      },
      setItem: (key, value) => {
        writes.push({ key, value })
        data.set(key, String(value))
      },
      removeItem: (key) => {
        removed.push(key)
        data.delete(key)
      },
      clear: () => {
        spy.clears += 1
        data.clear()
      },
      key: (index) => [...data.keys()][index] ?? null,
      get length() {
        return data.size
      },
    },
  }
  return spy
}

type Snapshot = {
  demoState: string
  analyses: string[]
  nodes: number
  edges: number
  birth: string | null
  profile: { sex?: string; year_of_birth?: number } | null
  isDemo: boolean
}

type LoadRun = {
  before: Snapshot
  after: Snapshot
  storage: Spy
  fetches: Array<{ url: string; cache: unknown }>
  built: string[]
  foot: { textContent: string }
  clearedAnalysisHides: boolean
}

/**
 * The page's own `loadDemo`, in a clean workspace: no `#kg-graph`, an empty storage, a DOM stub
 * carrying only the element the loader writes to, and a `fetch` that answers with the demo file.
 * The five redraw calls are stubbed — this is about what the load *writes*, not what it paints.
 */
async function loadDemoIn(pageHtml: string, options: { status?: number } = {}): Promise<LoadRun> {
  const parts = LOAD_PARTS.map((name) => ({ name, source: pageFunction(pageHtml, name) }))
  const missing = parts.filter((part) => part.source === null).map((part) => part.name)
  // a renamed reader would otherwise fail as an undefined call, or worse, be skipped silently
  expect(missing).toEqual([])
  const sources = parts.flatMap((part) => (part.source === null ? [] : [part.source]))

  const storage = storageSpy()
  const fetches: Array<{ url: string; cache: unknown }> = []
  const built: string[] = []
  const foot = { textContent: 'nothing saved yet' }
  const state = { analysisHidden: new Set<string>(['hide-me']) }

  const elements: Record<string, unknown> = { foot }
  const documentStub = {
    getElementById: (id: string) => elements[id] ?? null,
  }
  const fetchStub = async (url: string, init?: { cache?: unknown }) => {
    fetches.push({ url, cache: init?.cache })
    if (options.status !== undefined && options.status !== 200) {
      return { ok: false, status: options.status }
    }
    return { ok: true, status: 200, json: async () => structuredClone(demo) }
  }
  const mark = (name: string) => () => {
    built.push(name)
  }

  const factory = new Function(
    'document',
    'fetch',
    'localStorage',
    'state',
    'buildLegend',
    'buildTimeline',
    'buildAnalyses',
    'buildStateList',
    'paintFade',
    'console',
    `${sources.join('\n')}
     let TL_META = {};
     let BIRTH = null;
     let LE_BY_SEX = { male: 74, female: 80 };
     let ANALYSES = [];
     let DOC_NODES = [];
     let DOC_EDGES = [];
     let demoState = "absent";
     const snapshot = () => ({ demoState, analyses: ANALYSES.map(a => a.id), nodes: DOC_NODES.length,
                               edges: DOC_EDGES.length, birth: BIRTH,
                               profile: (TL_META && TL_META.profile) || null,
                               isDemo: Boolean(TL_META && TL_META.demo) });
     return { loadDemo, snapshot, hidden: () => state.analysisHidden.size };`
  ) as (
    document: unknown,
    fetch: unknown,
    localStorage: unknown,
    state: unknown,
    buildLegend: () => void,
    buildTimeline: () => void,
    buildAnalyses: () => void,
    buildStateList: () => void,
    paintFade: () => void,
    console: unknown
  ) => {
    loadDemo: () => Promise<void>
    snapshot: () => Snapshot
    hidden: () => number
  }

  const quietConsole = { error: () => {}, warn: () => {}, log: () => {} }
  const run = factory(
    documentStub,
    fetchStub,
    storage.api,
    state,
    mark('buildLegend'),
    mark('buildTimeline'),
    mark('buildAnalyses'),
    mark('buildStateList'),
    mark('paintFade'),
    quietConsole
  )

  const before = run.snapshot()
  await run.loadDemo()
  const after = run.snapshot()

  return {
    before,
    after,
    storage,
    fetches,
    built,
    foot,
    clearedAnalysisHides: run.hidden() === 0,
  }
}

describe('a clean workspace stays empty when demo is loaded', () => {
  test('before the load the page holds no record and no identity', async () => {
    const run = await loadDemoIn(page)
    expect(run.before.analyses).toEqual([])
    expect(run.before.nodes).toBe(0)
    expect(run.before.edges).toBe(0)
    expect(run.before.birth).toBeNull()
    expect(run.before.profile).toBeNull()
    expect(run.before.demoState).toBe('absent')
  })

  test('the load really ran: one fetch of the artifact, five redraws, the demo in view', async () => {
    const run = await loadDemoIn(page)
    // not a bailed-out early return: the demo is in the view, and it came from the one URL
    expect(run.fetches).toEqual([{ url: 'demo/graph.json', cache: 'no-store' }])
    expect(run.built).toEqual(['buildLegend', 'buildTimeline', 'buildAnalyses', 'buildStateList', 'paintFade'])
    expect(run.clearedAnalysisHides).toBe(true)
    expect(run.after.demoState).toBe('loaded')
    expect(run.after.nodes).toBe(demo.nodes.length)
    expect(run.after.analyses.length).toBe(27) // the measurement marks of the T21 case
    expect(run.after.isDemo).toBe(true)
    expect(run.after.profile).toEqual(demo.meta.profile as Snapshot['profile'])
    // it says whose record this is, in the page, where the reader can see it
    expect(run.foot.textContent).toContain('invented records, not a patient history')
    expect(run.foot.textContent).toContain('nothing saved')
  })

  test('the reader’s workspace is still empty afterwards: no key, no write, no removal', async () => {
    const run = await loadDemoIn(page)
    // the whole point: the demo is in view, and storage is exactly as clean as it was
    expect(run.storage.writes).toEqual([])
    expect(run.storage.removed).toEqual([])
    expect(run.storage.clears).toBe(0)
    expect(run.storage.keys()).toEqual([])
    expect(run.storage.reads).toEqual([]) // it did not even look for a saved copy to merge into
  })

  test('a failed fetch leaves no half-applied record and no user data', async () => {
    const run = await loadDemoIn(page, { status: 404 })
    expect(run.after.demoState).toBe('absent')
    expect(run.after.nodes).toBe(0)
    expect(run.after.analyses).toEqual([])
    expect(run.after.profile).toBeNull()
    expect(run.foot.textContent).toContain('Could not load demo/graph.json')
    expect(run.storage.writes).toEqual([])
    expect(run.storage.keys()).toEqual([])
  })
})

describe('the page writes nothing, which is what makes the demo safe to load', () => {
  test('no storage API is referenced at all — not storage, not cookies, not IndexedDB', () => {
    // docs/MAIN-VIEW.md §Export: "The page writes nothing". A reader's record is a file they own;
    // this page never becomes a second place it can live. A card that gives the page a theme or a
    // budget has to come here and prove the demo is not part of it.
    expect(page).not.toMatch(/localStorage/)
    expect(page).not.toMatch(/sessionStorage/)
    expect(page).not.toMatch(/indexedDB/)
    expect(page).not.toMatch(/document\.cookie/)
    expect(page).not.toMatch(/navigator\.storage/)
    expect(page).not.toMatch(/caches\.(open|match)/)
  })

  test('the demo is the demo: it is fetched, not built into the page', () => {
    expect(page).toContain('fetch("demo/graph.json"')
    expect(page.match(/fetch\(/g)?.length).toBe(1)
    // the case's identity is in the artifact only — a page that spells it is a page that ships it
    expect(page).not.toContain('Andrei')
    expect(page).not.toContain('1961')
  })
})

/**
 * SCRUM-48 — the demo page opens with its case, and the reader's page never takes it.
 *
 * The button is gone: a demo that needs a click before it has anything in it is not a demo. What
 * replaces it is one guard at launch — `if (!KGDATA) loadDemo()` — where `KGDATA` is the document
 * a renderer wrote into `#kg-graph`. So the guard is executed here twice, out of the page: with no
 * document it loads, with a document (even an empty one) it does not. That is the whole difference
 * between the demo artifact and the reader's own page, and it is text, so it is pinned here.
 */
describe('the demo opens loaded; a rendered page does not (SCRUM-48)', () => {
  const guard = page.match(/if \(!KGDATA\) loadDemo\(\);/)?.[0] ?? ''
  const runsWith = (kgdata: unknown): number => {
    let calls = 0
    // the page's own guard text, executed: a `null` document is the demo, an object is the reader's
    new Function('KGDATA', 'loadDemo', guard)(kgdata, () => { calls += 1 })
    return calls
  }

  test('the guard exists, and the page has exactly one way to arrive at the demo', () => {
    expect(guard).toBe('if (!KGDATA) loadDemo();')
    // the declaration and the one launch call: there is no second trigger, and no click handler
    expect(page.match(/loadDemo/g)?.length).toBe(2)
    expect(page).not.toContain('id="loadDemo"')
    expect(page).not.toContain('.onclick = loadDemo')
    expect(page).not.toContain('loadDemoBtn')
  })

  test('no document in the page: the demo loads at launch', () => {
    expect(runsWith(null)).toBe(1)
  })

  test('a rendered document — even an empty one — never loads the demo', () => {
    // the reader's page is handed a document; it draws that, and its empty start stays empty
    expect(runsWith({ meta: { app: 'health-viewer' }, nodes: [], edges: [] })).toBe(0)
  })
})
