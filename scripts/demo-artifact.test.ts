import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { validateKg } from './lib/kg-contract'

/**
 * T01 — the demo is an artifact, not part of the page.
 *
 * A reader who opens the viewer must not start with somebody else's lab results. The page used
 * to carry them inline (`SAMPLE_ANALYSES`, and a birth date written into a `const`), so a clean
 * start looked like a patient history. `demo/graph.json` is now the only copy, fetched when the
 * reader asks for it; the page itself starts empty.
 *
 * T21 — the demo case: a man of 65 with twenty years of records.
 *
 * The document behind the demo is a `kg/1-health` one now, not the page's old `analysis` shape:
 * 62 events, of which 3 conditions, 5 medications and 2 procedures, and every one of them a node
 * the contract accepts. That is why the gate below is `validateKg` and not a hand-written list of
 * keys: the case is the first real document in the repo, and a fixture that never meets the gate
 * is how the gate learns to ignore a failure.
 *
 * These checks stay static on purpose: they are the card's acceptance (counts and a `grep` for
 * the sample names), they run in G2 without a browser, and they fail on the exact mistake the
 * card exists to prevent — data put back into the page, or a demo that only looks like the
 * contract from a distance.
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
})
