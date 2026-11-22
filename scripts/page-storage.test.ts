import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

/**
 * T23 — demo ≠ user, on the template/artifact split (T01).
 *
 * Somebody else's labs must never end up in the reader's own record. The case page is an artifact
 * built from `kg_demo.json`; the template a reader's page is rendered from carries only the
 * `#kg-graph` placeholder. Neither has a write path, so opening the built page cannot put anything
 * into a profile — but that is a claim about code, and a claim about code is worth exactly the
 * check that runs it.
 *
 * Two things are executed here, out of the page itself:
 *
 * 1. `KGDATA`, the reader of the payload: the template's placeholder is read as "no document" and
 *    logs nothing (an empty start is a valid start, not an error), and a real document is read as
 *    itself.
 * 2. `applyDocument`, the one function that turns a document into the view, run over the artifact's
 *    own payload with a recording storage: the invented case fills the page and the reader's
 *    storage is exactly as clean afterwards — no key written, no key read, nothing removed.
 *
 * The static half greps for storage APIs a write path could arrive through; the executed half is
 * what holds the whole page to its own sentence, "Nothing on this page writes to storage".
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const template = read('body/index.html')
const ARTIFACT = 'dist/demo.html'
const artifactUrl = new URL(`../${ARTIFACT}`, import.meta.url)
if (!existsSync(artifactUrl)) {
  throw new Error(`${ARTIFACT} is missing — run \`bun run build:demo\` first (\`bun run verify\` does)`)
}
const artifact = readFileSync(artifactUrl, 'utf8')

type Demo = {
  meta?: { profile?: { sex?: string; year_of_birth?: number } }
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
}

/** The payload the build wrote into the artifact: what opening the demo actually hands the page. */
function payloadOf(html: string): Demo {
  const m = html.match(/<script id="kg-graph" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('the page carries no #kg-graph payload')
  return JSON.parse(m[1]) as Demo
}

const demo = payloadOf(artifact)

/** One `function name(...) { ... }` (or `async function`) out of the page, by its text. */
function pageFunction(html: string, name: string): string | null {
  const start = html.search(new RegExp(`\\n(?:async )?function ${name}\\(`))
  if (start < 0) return null
  const end = html.indexOf('\n}\n', start)
  return end < 0 ? null : html.slice(start + 1, end + 2)
}

/** The readers and the one applier a load is made of, as the page declares them. */
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
] as const

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
  analyses: string[]
  nodes: number
  edges: number
  birth: string | null
  profile: { sex?: string; year_of_birth?: number } | null
}

/** `applyDocument` from the page, over any document, with a storage it is not supposed to touch. */
function applyIn(html: string, doc: unknown): { before: Snapshot; after: Snapshot; storage: Spy } {
  const parts = LOAD_PARTS.map((name) => ({ name, source: pageFunction(html, name) }))
  const missing = parts.filter((part) => part.source === null).map((part) => part.name)
  // a renamed reader would otherwise fail as an undefined call, or worse, be skipped silently
  expect(missing).toEqual([])
  const sources = parts.flatMap((part) => (part.source === null ? [] : [part.source]))

  const storage = storageSpy()
  const factory = new Function(
    'doc',
    'localStorage',
    `${sources.join('\n')}
     let TL_META = {};
     let BIRTH = null;
     let LE_BY_SEX = { male: 74, female: 80 };
     let ANALYSES = [];
     let DOC_NODES = [];
     let DOC_EDGES = [];
     const ymd = d => d
       ? [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
       : null;
     const snapshot = () => ({ analyses: ANALYSES.map(a => a.id), nodes: DOC_NODES.length,
                               edges: DOC_EDGES.length, birth: ymd(BIRTH),
                               profile: (TL_META && TL_META.profile) || null });
     const before = snapshot();
     applyDocument(doc);
     return { before, after: snapshot() };`
  ) as (doc: unknown, storage: Spy['api']) => { before: Snapshot; after: Snapshot }

  const run = factory(doc, storage.api)
  return { ...run, storage }
}

/** The page's `KGDATA` reader, with a document-element stub and a console that counts warnings. */
function kgDataIn(html: string): (text: string | null) => { value: unknown; warnings: number } {
  const start = html.indexOf('const KGDATA = (() => {')
  if (start < 0) throw new Error('the page no longer declares KGDATA')
  const tail = '\n})();'
  const end = html.indexOf(tail, start)
  if (end < 0) throw new Error('the KGDATA block has no end')
  const source = html.slice(start, end + tail.length)
  const factory = new Function(
    'document',
    'console',
    `${source}
     return KGDATA;`
  ) as (document: unknown, console: unknown) => unknown

  return (text) => {
    let warnings = 0
    const element = text === null ? null : { textContent: text }
    const documentStub = { getElementById: () => element }
    const consoleStub = { warn: () => { warnings += 1 }, error: () => { warnings += 1 }, log: () => {} }
    const value = factory(documentStub, consoleStub)
    return { value, warnings }
  }
}

describe('a clean workspace stays empty when the demo is loaded', () => {
  test('before the document arrives the view holds no record and no identity', () => {
    const run = applyIn(artifact, null)
    expect(run.before.analyses).toEqual([])
    expect(run.before.nodes).toBe(0)
    expect(run.before.edges).toBe(0)
    expect(run.before.birth).toBeNull()
    expect(run.before.profile).toBeNull()
  })

  test('the artifact really loads its case: the document is in the view afterwards', () => {
    const run = applyIn(artifact, demo)
    expect(run.after.nodes).toBe(demo.nodes.length)
    expect(run.after.edges).toBe(demo.edges.length)
    expect(run.after.analyses.length).toBe(27) // the measurement marks of the T21 case
    expect(run.after.profile).toEqual(demo.meta?.profile as Snapshot['profile'])
    expect(run.after.birth).toBe('1961-01-01') // identity is meta.profile.year_of_birth
  })

  test('the reader’s workspace is still empty afterwards: no key, no write, no removal', () => {
    const run = applyIn(artifact, demo)
    // the whole point: the demo is in view, and storage is exactly as clean as it was
    expect(run.storage.writes).toEqual([])
    expect(run.storage.removed).toEqual([])
    expect(run.storage.clears).toBe(0)
    expect(run.storage.keys()).toEqual([])
    expect(run.storage.reads).toEqual([]) // it did not even look for a saved copy to merge into
  })

  test('a reader’s page with an empty document keeps its empty start', () => {
    const run = applyIn(template, { meta: { app: 'health-viewer' }, nodes: [], edges: [] })
    expect(run.after.analyses).toEqual([])
    expect(run.after.nodes).toBe(0)
    expect(run.after.birth).toBeNull()
    expect(run.storage.writes).toEqual([])
  })
})

describe('the template’s placeholder is not a document, and not an error', () => {
  const reader = kgDataIn(template)
  const payload = payloadOf(artifact)

  test('the placeholder opens an empty page and logs nothing', () => {
    const read = reader('__KG_GRAPH__')
    expect(read.value).toBeNull()
    expect(read.warnings).toBe(0)
  })

  test('a missing payload element is the same empty page', () => {
    const read = reader(null)
    expect(read.value).toBeNull()
    expect(read.warnings).toBe(0)
  })

  test('the artifact’s own payload is read as the document', () => {
    const text = artifact.match(/<script id="kg-graph" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? ''
    const read = reader(text)
    expect(read.value).toEqual(payload)
    expect(read.warnings).toBe(0)
  })

  test('broken JSON is the one case that warns — and still opens empty', () => {
    const read = reader('{not json')
    expect(read.value).toBeNull()
    expect(read.warnings).toBe(1)
  })
})

describe('the demo page is a view, never a record', () => {
  test('no storage API is referenced at all — not storage, not cookies, not IndexedDB', () => {
    // docs/MAIN-VIEW.md §Export: "The page writes nothing". A reader's record is a file they own;
    // this page never becomes a second place it can live. A card that gives the page a theme or a
    // budget has to come here and prove the demo is not part of it.
    for (const page of [template, artifact]) {
      expect(page).not.toMatch(/localStorage/)
      expect(page).not.toMatch(/sessionStorage/)
      expect(page).not.toMatch(/indexedDB/)
      expect(page).not.toMatch(/document\.cookie/)
      expect(page).not.toMatch(/navigator\.storage/)
      expect(page).not.toMatch(/caches\.(open|match)/)
    }
  })

  test('the template a reader’s page is rendered from ships no demo case', () => {
    expect(template).not.toContain('Andrei')
    expect(template).not.toContain('1961')
    // the demo lives in its own document and its own artifact; the template has neither
    expect(template).not.toContain('lab-')
  })
})
