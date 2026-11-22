import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { validateKg } from './lib/kg-contract'

/**
 * T01 — the demo is an artifact, not part of the page. SCRUM-48 — and the demo page opens with it.
 *
 * A reader who opens the viewer must not start with somebody else's lab results. The page used
 * to carry them inline (`SAMPLE_ANALYSES`, and a birth date written into a `const`), so a clean
 * start looked like a patient history. `demo/graph.json` is now the only copy, fetched when the
 * reader opens the checked-in demo page; the page itself carries no document, and a page rendered
 * with the reader's own document starts with that document and nothing else.
 *
 * T21 — the demo case: a man of 65 with twenty years of records.
 *
 * The document behind the demo is a `kg/1-health` one now, not the page's old `analysis` shape:
 * 62 events, of which 3 conditions, 5 medications and 2 procedures, and every one of them a node
 * the contract accepts. That is why the gate below is `validateKg` and not a hand-written list of
 * keys: the case is the first real document in the repo, and a fixture that never meets the gate
 * is how the gate learns to ignore a failure.
 *
 * Most of these checks stay static on purpose: they are the card's acceptance (counts and a `grep`
 * for the sample names), they run in G2 without a browser, and they fail on the exact mistake the
 * card exists to prevent — data put back into the page, or a demo that only looks like the
 * contract from a distance.
 *
 * The projection is the one thing a `grep` cannot hold. `projectionOf` below takes the adapter and
 * the arithmetic out of `body/index.html` verbatim and runs them over this document, because a
 * page that reads `confidence` where it should read `evidence` still contains the string
 * `evidence: evidenceOf(n)` and still passes every static check — it just promises the invented
 * man 12.8 extra years. So the numbers are executed here, not spelled.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')

type Node = Record<string, unknown> & { id: string; kind: string; when?: unknown; source?: string }
type Demo = {
  meta?: { title?: string; app?: string; demo?: boolean; profile?: { sex?: string; year_of_birth?: number } }
  nodes?: Node[]
  edges?: Array<Record<string, unknown>>
}

const demo = JSON.parse(read('body/demo/graph.json')) as Demo
const nodes = demo.nodes ?? []

/** The six kinds that are events (docs/DATA-CONTRACT.md §Node kinds); a summary and a prediction are not. */
const EVENT_KINDS = ['condition', 'observation', 'encounter', 'medication', 'procedure', 'document'] as const
const events = nodes.filter((node) => (EVENT_KINDS as readonly string[]).includes(node.kind))
const ofKind = (kind: string) => events.filter((node) => node.kind === kind)

/** The readers and the arithmetic a projection is made of, as `body/index.html` declares them. */
const PROJECTION_PARTS = [
  'finiteOrNaN', 'evidenceOf', 'confidenceOf', 'isMark', 'whenOf', 'markersOf', 'toAnalyses',
  'dayOf', 'deltaOf', 'latestByTrack', 'lifeExpectancy', 'baselineLE', 'annualRisk',
] as const

type Analysis = {
  id: string
  track: string
  at: Date | null
  delta: number | null
  evidence: number
  confidence: number
}
type Projection = {
  analyses: Analysis[]
  lifeExpectancy: number
  baselineLE: number
  annualRisk: (age: number) => number
  deltaOf: (analysis: Analysis) => number
  missing: string[]
}

/** One `function name(...) { ... }` out of the page, by its text: the page is a script, not a module. */
function pageFunction(html: string, name: string): string | null {
  const start = html.indexOf(`\nfunction ${name}(`)
  if (start < 0) return null
  const end = html.indexOf('\n}\n', start)
  return end < 0 ? null : html.slice(start + 1, end + 2)   // the declaration, closing brace included
}

/**
 * The demo through the page's own code: the adapter (`toAnalyses`) and the projection
 * (`lifeExpectancy`, `deltaOf`, `annualRisk`) are taken out of `body/index.html` verbatim and run
 * over this document. None of them touches the 3D scene or the DOM, so the page's numbers can be
 * checked in G2 with no browser — and a wrong number fails here instead of on a reader's screen.
 */
function projectionOf(html: string): Projection {
  const parts = PROJECTION_PARTS.map((name) => ({ name, source: pageFunction(html, name) }))
  const missing = parts.filter((part) => part.source === null).map((part) => part.name)
  const sources = parts.flatMap((part) => (part.source === null ? [] : [part.source]))
  const factory = new Function(
    'DOC',
    `${sources.join('\n')}
     let state = { sex: 'male', date: null };
     let LE_BY_SEX = { male: 74, female: 80 };
     let ANALYSES = toAnalyses(DOC.nodes);
     return { analyses: ANALYSES, lifeExpectancy: lifeExpectancy(), baselineLE: baselineLE(),
              annualRisk: annualRisk, deltaOf: deltaOf };`
  ) as (doc: Demo) => Omit<Projection, 'missing'>
  return { ...factory(demo), missing }
}

/** The day an event sits on: its date, or the day the interval started. */
const dayOf = (node: Node): string =>
  typeof node.when === 'string' ? node.when : String((node.when as { from?: string } | undefined)?.from ?? '')

describe('the page carries no records of anyone', () => {
  test('the inline sample set is gone', () => {
    expect(page).not.toContain('SAMPLE_ANALYSES')
    expect(page).not.toContain('1984-03-01')
  })

  test('no analysis record is written into the page', () => {
    // the page keeps the shape of an analysis (it still maps nodes), never the contents
    expect(page).not.toMatch(/id:\s*["']lab-/)
    expect(page).not.toMatch(/id:\s*["']bp-/)
    expect(page).not.toMatch(/evidence:\s*\d/)
  })

  test('the demo is fetched from demo/graph.json and from nowhere else', () => {
    // page-relative: the artifact is body/demo/graph.json, so the page works from its directory
    // on any static host without climbing out of it
    expect(page).toContain('fetch("demo/graph.json"')
    expect(page.match(/fetch\(/g)?.length).toBe(1)
  })

  test('nothing on the page writes storage, so a loaded demo is not user data', () => {
    // the seed of T23: the demo is a view, never a record. If a later card gives the page a
    // write path, it has to prove the demo did not go into it.
    expect(page).not.toContain('localStorage.setItem')
  })
})

describe('demo/graph.json is the case the card names', () => {
  test('it is a kg/1-health document, and the contract accepts every node of it', () => {
    expect(demo.meta?.app).toBe('health-viewer')
    // not a shape that looks close: the real gate, over the real document
    expect(validateKg(demo)).toEqual([])
  })

  test('it is one invented man, 65 in 2026, and it says so', () => {
    expect(demo.meta?.demo).toBe(true)
    expect(demo.meta?.profile?.sex).toBe('male')
    expect(demo.meta?.profile?.year_of_birth).toBe(1961)
    expect(2026 - Number(demo.meta?.profile?.year_of_birth)).toBe(65)
  })

  test('62 events, and the case the card names — 3 conditions, 5 medications, 2 procedures', () => {
    expect(events.length).toBe(62)
    expect(ofKind('condition').length).toBe(3)
    expect(ofKind('medication').length).toBe(5)
    expect(ofKind('procedure').length).toBe(2)
    // the other three event kinds carry the record: measurements, visits, and the papers behind them
    expect(ofKind('observation').length).toBeGreaterThan(0)
    expect(ofKind('encounter').length).toBeGreaterThan(0)
    expect(ofKind('document').length).toBeGreaterThan(0)
    expect(nodes.length).toBe(events.length) // a summary or a prediction would not be an event
  })

  test('the 47 records the demo page opens on: every dated event that is not provenance', () => {
    // the left list is `StateList.rows`, which drops documents from the record list: 62 events
    // minus the 15 papers behind them is the case the SCRUM-48 acceptance names.
    expect(ofKind('document').length).toBe(15)
    expect(events.length - ofKind('document').length).toBe(47)
  })

  test('twenty years: the first visit in 2006, the last note in 2026', () => {
    const dates = events.map(dayOf).sort()
    expect(dates[0].slice(0, 4)).toBe('2006')
    expect(dates[dates.length - 1].slice(0, 4)).toBe('2026')
    const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 864e5)
    expect(years).toBeGreaterThanOrEqual(20)
  })

  test('every event has a date and a real calendar day', () => {
    for (const event of events) {
      expect(dayOf(event)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const day = new Date(`${dayOf(event)}T00:00:00Z`)
      expect(Number.isNaN(day.getTime())).toBe(false)
      // 2026-02-30 parses as March 2nd in a Date; refuse the date the day rolls over
      expect(day.toISOString().slice(0, 10)).toBe(dayOf(event))
    }
  })

  test('every fact points at a document in this document', () => {
    const documents = new Set(ofKind('document').map((node) => node.id))
    for (const event of events) {
      if (event.kind === 'document') {
        // the provenance points at nothing; the contract says so and the gate enforces it
        expect(event.source).toBeUndefined()
        continue
      }
      expect(typeof event.source).toBe('string')
      expect(documents.has(String(event.source))).toBe(true)
    }
  })

  test('the ids are unique — a graph with two nodes of one name is a bug', () => {
    const ids = nodes.map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the page can draw it: the marks come from observations, not from an `analysis` kind', () => {
    // the document carries no `analysis` node (the contract has no such kind), so the page's
    // mark path has to read observations and their `when`; a page that only knew `kind:"analysis"`
    // would load this demo and draw an empty ruler
    expect(nodes.some((node) => node.kind === 'analysis')).toBe(false)
    expect(page).toContain('node.kind === "observation"')
    expect(page).toContain('node.when')
  })

  test('certainty is not spent as an effect size', () => {
    // A kg/1-health document carries no `delta` and no `evidence`: only `confidence`, which says how
    // solid a fact is, not how much it harms. So nothing in this file may move the projection.
    expect(nodes.some((node) => 'delta' in node || 'evidence' in node)).toBe(false)
  })

  test('the page turns this document into a neutral projection, not a decade of extra life', () => {
    const page1 = projectionOf(page)
    // every reader the projection needs exists on the page: a renamed or swallowed one fails here,
    // not silently at 74.0 because a missing function happened to be skipped
    expect(page1.missing).toEqual([])
    expect(page1.analyses.length).toBe(ofKind('observation').length)   // one mark per measurement
    expect(page1.baselineLE).toBe(74)                                   // LE_BY_SEX.male
    // the handoff's claim, executed: baseline 74.0 -> 74.0. On a7dfd8e this read 86.8.
    expect(page1.lifeExpectancy).toBe(74)
    for (const analysis of page1.analyses) expect(page1.deltaOf(analysis)).toBe(0)
    // and the toy annual risk at 65 is the baseline's, 4.0%, not the 0.98% the old adapter printed
    const risk = page1.annualRisk(65)
    expect(risk).toBeGreaterThan(0.03)
    expect(risk).toBeLessThan(0.05)
  })

  test('`confidence` is carried as certainty — 0..1 scaled to 0..100 — and never as evidence', () => {
    const projection = projectionOf(page)
    const byId = new Map(nodes.map((node) => [node.id, node]))
    expect(projection.analyses.some((analysis) => analysis.confidence !== 50)).toBe(true) // the file does say how sure
    for (const analysis of projection.analyses) {
      expect(analysis.evidence).toBe(50)   // no authored weight, so no movement either way
      const confidence = Number(byId.get(analysis.id)?.confidence)
      if (Number.isFinite(confidence)) {
        expect(analysis.confidence).toBeCloseTo(confidence <= 1 ? confidence * 100 : confidence, 6)
      }
    }
  })
})
