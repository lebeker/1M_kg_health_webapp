import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * T01 — the demo is an artifact, not part of the page.
 *
 * A reader who opens the viewer must not start with somebody else's lab results. The page used
 * to carry them inline (`SAMPLE_ANALYSES`, and a birth date written into a `const`), so a clean
 * start looked like a patient history. `demo/graph.json` is now the only copy, fetched when the
 * reader asks for it; the page itself starts empty.
 *
 * These checks are static on purpose: they are the card's acceptance (`grep` for the sample
 * names and the birth date returns 0), they run in G2 without a browser, and they fail on the
 * exact mistake the card exists to prevent — data put back into the HTML.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')

type Demo = {
  meta?: { birth?: string; demo?: boolean }
  nodes?: Array<Record<string, unknown>>
}

const demo = JSON.parse(read('body/demo/graph.json')) as Demo

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

describe('demo/graph.json is a document, and the page can draw it', () => {
  test('it is a kg/1 document with a profile the ruler needs', () => {
    expect(demo.meta?.birth).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(String(demo.meta?.birth)))).toBe(false)
    expect(demo.meta?.demo).toBe(true)
  })

  test('it holds the analyses, and each one has a date, an organ and a value', () => {
    const analyses = (demo.nodes ?? []).filter((node) => node.kind === 'analysis')
    expect(analyses.length).toBeGreaterThan(0)
    for (const analysis of analyses) {
      expect(typeof analysis.id).toBe('string')
      expect(Date.parse(String(analysis.date))).not.toBeNaN()
      expect(typeof analysis.organ).toBe('string')
      expect(Array.isArray(analysis.values)).toBe(true)
      expect((analysis.values as unknown[]).length).toBeGreaterThan(0)
    }
  })

  test('the ids are unique — a graph with two nodes of one name is a bug', () => {
    const ids = (demo.nodes ?? []).map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
