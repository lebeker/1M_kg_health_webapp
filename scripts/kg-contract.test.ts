import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateKg } from './lib/kg-contract'

const FIXTURES = 'tests/fixtures/kg'
const read = (rel: string): unknown => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'))

describe('the contract gate', () => {
  test('a health document that follows docs/DATA-CONTRACT.md conforms', () => {
    expect(validateKg(read('valid/health-man-65.json'))).toEqual([])
  })

  test('a plain kg/1 document needs no health fields at all', () => {
    expect(validateKg(read('valid/base-viewer.json'))).toEqual([])
  })

  // The fixture has to keep failing: if a rule is loosened, this table says which promise broke.
  const mustReject: Array<[string, string]> = [
    ['invalid/dangling-edge.json', 'not a node in this document'],
    ['invalid/duplicate-node-id.json', 'duplicate node id'],
    ['invalid/unknown-kind.json', 'is not one of condition, observation'],
    ['invalid/event-without-date.json', 'is an event and needs a date'],
    ['invalid/edge-without-source.json', 'every fact needs the id of the source'],
    ['invalid/value-as-string.json', 'value must be a number'],
    ['invalid/edge-label-not-in-contract.json', 'is not in the contract'],
    ['invalid/missing-profile.json', 'must carry meta.profile'],
    ['invalid/wrong-endpoints.json', 'tracks starts at condition, expected observation'],
  ]

  for (const [fixture, expected] of mustReject) {
    test(`rejects ${fixture}`, () => {
      const issues = validateKg(read(fixture))
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.map((issue) => issue.message).join(' | ')).toContain(expected)
    })
  }
})

describe('rules a card can trip over', () => {
  const health = (over: Record<string, unknown>): unknown => ({
    meta: { title: 't', schema: 'kg/1', app: 'health-viewer', profile: { sex: 'male', year_of_birth: 1961 } },
    nodes: [
      { id: 'src-1', kind: 'source', label: 'a note', confirmed: true },
      { id: 'obs-1', kind: 'observation', label: 'LDL', when: '2026-11-12', value: 4.9, unit: 'mmol/L', confirmed: true, source: 'src-1' },
    ],
    edges: [{ from: 'obs-1', to: 'src-1', label: 'derived_from' }],
    ...over,
  })

  test('an unknown top-level key is a modelling mistake, not an extension', () => {
    const issues = validateKg({ ...(health({}) as object), extra: 1 })
    expect(issues.map((i) => i.path)).toContain('$.extra')
  })

  test('schema must say kg/1', () => {
    const doc = health({}) as { meta: Record<string, unknown> }
    doc.meta.schema = 'kg/2'
    expect(validateKg(doc).map((i) => i.path)).toContain('$.meta.schema')
  })

  test('a source must point at a node whose kind is source', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].source = 'obs-1'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('not a source')
  })

  test('a confidence outside 0..1 is rejected', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].confidence = 1.4
    expect(validateKg(doc).map((i) => i.path)).toContain('$.nodes[obs-1].confidence')
  })

  test('an interval without a start is not a date', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].when = { to: '2026-11-12' }
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('ISO date or an interval')
  })

  test('a node without confirmed says nothing about who stands behind it', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[0].confirmed = 'yes'
    expect(validateKg(doc).map((i) => i.path)).toContain('$.nodes[src-1].confirmed')
  })
})
