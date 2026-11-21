import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HEALTH_EDGE_LABELS, HEALTH_KINDS } from './lib/kg-contract'

/**
 * `app.json` is the app's own word about itself, and the `kg` skill seeds a graph from it: the
 * edge `name` values become `meta.edges` in every document the app creates, and a user (or a
 * fresh agent) writes edges with exactly those labels. So an `app.json` that says
 * `"name": "derived from"` while the contract says `derived_from` does not drift quietly — it
 * makes every graph this app produces fail G1, and E01's clean-room run is how that was found.
 * This test is the guard that keeps the two files in step.
 */
const manifest = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
  id: string
  kinds: Array<{ kind: string }>
  edges: Array<{ name?: string; label?: string; from?: string[]; to?: string[] }>
  levels: Record<string, number>
}

describe('app.json agrees with the kg/1 contract', () => {
  test('it declares the health app', () => {
    expect(manifest.id).toBe('health-viewer')
  })

  test('every kind it draws is a kind the contract knows', () => {
    for (const kind of manifest.kinds) expect(HEALTH_KINDS).toContain(kind.kind as (typeof HEALTH_KINDS)[number])
  })

  test('every level anchor is a declared kind', () => {
    const declared = new Set(manifest.kinds.map((kind) => kind.kind))
    for (const key of Object.keys(manifest.levels)) expect(declared.has(key)).toBe(true)
  })

  test('every edge name is a contract relation token — no spaces, no display text', () => {
    for (const edge of manifest.edges) {
      expect(typeof edge.name).toBe('string')
      const name = String(edge.name)
      expect(name).not.toMatch(/\s/)
      expect(Object.keys(HEALTH_EDGE_LABELS)).toContain(name)
    }
  })

  test('an edge it declares does not allow endpoints the contract forbids', () => {
    for (const edge of manifest.edges) {
      const rule = HEALTH_EDGE_LABELS[String(edge.name)]
      if (!rule) continue // reported by the test above
      for (const kind of edge.from ?? []) expect(rule.from.includes(kind) || rule.from.includes('*')).toBe(true)
      for (const kind of edge.to ?? []) expect(rule.to.includes(kind)).toBe(true)
    }
  })

  test('the human label is kept beside the machine name', () => {
    for (const edge of manifest.edges) expect(typeof edge.label).toBe('string')
  })
})
