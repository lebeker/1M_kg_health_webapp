import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { buildDemo, unstamped } from './build-demo'
import { validateKg } from './lib/kg-contract'

/**
 * T01 — the demo is a build artifact, not part of the page.
 *
 * A reader who opens the viewer must not start with somebody else's lab results. The template
 * (`body/index.html`) carries the `#kg-graph` placeholder and no document at all — no sample set,
 * no birth date, and no `fetch` that could pull one in at launch. The demo is built from
 * `body/index.html` into `dist/demo.html`, so the invented case exists in exactly two
 * places: the document and the artifact made from it. A page rendered for a reader carries that
 * reader's document and nothing else. `bun run verify` builds the artifact before it runs the
 * suite, so the byte-for-byte check below is against real output and not a remembered copy.
 *
 * T21 — the demo case: a man of 65 with twenty years of records.
 *
 * The document behind the demo is a `kg/1-health` one, not the page's old `analysis` shape:
 * 62 events, of which 3 conditions, 5 medications and 2 procedures, and every one of them a node
 * the contract accepts. That is why the gate below is `validateKg` and not a hand-written list of
 * keys: the case is the first real document in the repo, and a fixture that never meets the gate
 * is how the gate learns to ignore a failure.
 *
 * Most of these checks stay static on purpose: they are the card's acceptance (counts and a `grep`
 * for the sample names), they run in G2 without a browser, and they fail on the exact mistake the
 * card exists to prevent — data put back into the template, or an artifact that drifted from its
 * source. The artifact check is byte-for-byte against the build function: a hand-edited demo page
 * fails here, not on a reader's screen.
 *
 * The projection is the one thing a `grep` cannot hold. `projectionOf` below takes the adapter and
 * the arithmetic out of `body/index.html` verbatim and runs them over this document, because a
 * page that reads `confidence` where it should read `evidence` still contains the string
 * `evidence: evidenceOf(n)` and still passes every static check — it just promises the invented
 * man 12.8 extra years. So the numbers are executed here, not spelled.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')
const ARTIFACT = 'dist/demo.html'
const artifactUrl = new URL(`../${ARTIFACT}`, import.meta.url)
if (!existsSync(artifactUrl)) {
  throw new Error(`${ARTIFACT} is missing — run \`bun run build:demo\` first (\`bun run verify\` does)`)
}
const artifact = readFileSync(artifactUrl, 'utf8')

type Node = Record<string, unknown> & { id: string; kind: string; when?: unknown; source?: string }
type Demo = {
  meta?: { title?: string; app?: string; profile?: { sex?: string; year_of_birth?: number } }
  nodes?: Node[]
  edges?: Array<Record<string, unknown>>
}

const demo = JSON.parse(read('kg_demo.json')) as Demo
const nodes = demo.nodes ?? []

/** The six kinds that are events (docs/DATA-CONTRACT.md §Node kinds); a summary and a prediction are not. */
const EVENT_KINDS = [
  'condition', 'observation', 'encounter', 'medication', 'procedure', 'document',
  'immunization', 'device', 'allergy',
] as const
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

describe('the template carries a placeholder, not a document', () => {
  test('the inline sample set is gone', () => {
    expect(page).not.toContain('SAMPLE_ANALYSES')
    expect(page).not.toContain('1984-03-01')
  })

  test('no analysis record and no demo identity is written into the page', () => {
    // the page keeps the shape of an analysis (it still maps nodes), never the contents
    expect(page).not.toMatch(/id:\s*["']lab-/)
    expect(page).not.toMatch(/id:\s*["']bp-/)
    expect(page).not.toMatch(/evidence:\s*\d/)
    expect(page).not.toContain('Andrei')
    expect(page).not.toContain('1961')
  })

  test('the document arrives through the one #kg-graph placeholder', () => {
    // exactly one payload slot, with the placeholder still in it: a template with two slots would
    // silently render whichever one the parser found first
    const marker = '<script id="kg-graph" type="application/json">__KG_GRAPH__</script>'
    expect(page.split(marker).length - 1).toBe(1)
    expect(page).toContain('raw === "__KG_GRAPH__"')   // and the placeholder is not mistaken for a document
  })

  test('the template has no way to fetch a document — no demo, no sidecar, no socket', () => {
    expect(page).not.toMatch(/fetch\(/)
    expect(page).not.toMatch(/XMLHttpRequest|sendBeacon|new WebSocket|import\(/)
  })

  test('nothing on the template writes storage, so no load can become user data', () => {
    // the seed of T23: opening any page built from this template is a view, never a record.
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.storage/)
  })
})

describe('dist/demo.html is the artifact, built from kg_demo.json', () => {
  test('it is exactly what the build produces from this template and this document', () => {
    // byte-for-byte apart from the build stamp, which is a clock and cannot be compared: a
    // hand-edited demo page fails here instead of drifting from its source
    expect(unstamped(artifact)).toBe(unstamped(buildDemo(page, demo)))
    expect(artifact).toMatch(/<meta name="kg-build" content="[^"]+">/)
    expect(artifact).not.toContain('<script id="kg-graph" type="application/json">__KG_GRAPH__</script>')
  })

  test('the document in the artifact is the source document, not a copy of a copy', () => {
    const m = artifact.match(/<script id="kg-graph" type="application\/json">([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    expect(JSON.parse((m as RegExpMatchArray)[1])).toEqual(demo)
  })

  test('the artifact carries the case and never reaches the network or storage', () => {
    expect(artifact).toContain('Andrei')
    expect(artifact).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|new WebSocket/)
    expect(artifact).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.storage/)
  })
})

describe('kg_demo.json is the case the card names', () => {
  test('it is a kg/1-health document, and the contract accepts every node of it', () => {
    expect(demo.meta?.app).toBe('health-viewer')
    // not a shape that looks close: the real gate, over the real document
    expect(validateKg(demo)).toEqual([])
  })

  test('it is one invented man, 65 in 2026, and it says so', () => {
    // the honesty is in the document's own words, not in a flag the page would branch on
    expect(demo.meta?.title).toContain('invented')
    expect(demo.meta?.profile?.sex).toBe('male')
    expect(demo.meta?.profile?.year_of_birth).toBe(1961)
    expect(2026 - Number(demo.meta?.profile?.year_of_birth)).toBe(65)
  })

  test('72 events, and the case the card names — 5 conditions, 5 medications, 2 procedures, 3 immunizations', () => {
    expect(events.length).toBe(72)
    expect(ofKind('condition').length).toBe(5)
    expect(ofKind('immunization').length).toBe(3)
    expect(ofKind('device').length).toBe(1)
    expect(ofKind('allergy').length).toBe(1)
    expect(ofKind('medication').length).toBe(5)
    expect(ofKind('procedure').length).toBe(2)
    // the other three event kinds carry the record: measurements, visits, and the papers behind them
    expect(ofKind('observation').length).toBeGreaterThan(0)
    expect(ofKind('encounter').length).toBeGreaterThan(0)
    expect(ofKind('document').length).toBeGreaterThan(0)
    expect(nodes.length).toBe(events.length) // a summary or a prediction would not be an event
  })

  test('the records the demo page opens on: every dated event that is not provenance', () => {
    // the left list is `StateList.rows`, which drops documents from the record list: 72 events
    // minus the 18 papers behind them is what the SCRUM-48 acceptance names, now including the
    // immunizations, the hearing aid and the penicillin intolerance.
    expect(ofKind('document').length).toBe(18)
    expect(events.length - ofKind('document').length).toBe(54)
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
