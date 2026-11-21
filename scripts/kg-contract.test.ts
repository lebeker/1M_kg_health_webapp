import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HEALTH_EDGE_LABELS,
  HEALTH_EVENT_KINDS,
  HEALTH_KINDS,
  HEALTH_SCHEMA,
  HEALTH_SCHEMA_VERSION,
  TEMPORAL_NODE_KINDS,
  validateKg,
} from './lib/kg-contract'

const FIXTURES = 'tests/fixtures/kg'
const read = (rel: string): unknown => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'))

describe('the contract gate', () => {
  test('a health document that follows docs/DATA-CONTRACT.md conforms', () => {
    expect(validateKg(read('valid/health-man-65.json'))).toEqual([])
  })

  test('a prediction with a closed relation conforms', () => {
    expect(validateKg(read('valid/health-prediction.json'))).toEqual([])
  })

  test('a plain kg/1 document needs no health fields at all', () => {
    expect(validateKg(read('valid/base-viewer.json'))).toEqual([])
  })

  // The fixture has to keep failing: if a rule is loosened, this table says which promise broke.
  const mustReject: Array<[string, string]> = [
    ['invalid/dangling-edge.json', 'not a node in this document'],
    ['invalid/duplicate-node-id.json', 'duplicate node id'],
    ['invalid/unknown-kind.json', 'must be one of: condition, observation'],
    ['invalid/event-without-date.json', 'an encounter needs its date'],
    ['invalid/edge-without-source.json', 'missing "source"'],
    ['invalid/value-as-string.json', 'must be a number'],
    ['invalid/edge-label-not-in-contract.json', 'must be one of: tracks'],
    ['invalid/missing-profile.json', 'must have required property "profile"'],
    ['invalid/wrong-endpoints.json', 'tracks starts at condition, expected observation'],
    ['invalid/valid-from-on-non-temporal-node.json', 'valid_from on a non-temporal node'],
  ]

  for (const [fixture, expected] of mustReject) {
    test(`rejects ${fixture}`, () => {
      const issues = validateKg(read(fixture))
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.map((issue) => issue.message).join(' | ')).toContain(expected)
    })
  }
})

describe('the schema is the contract, and it is versioned', () => {
  test('the schema carries a semver of its own and names the profile it describes', () => {
    expect(HEALTH_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(HEALTH_SCHEMA.$id).toBe(`urn:kg:1-health:${HEALTH_SCHEMA_VERSION}`)
    expect(HEALTH_SCHEMA['x-contract-profile']).toBe('health-viewer')
  })

  test('the kinds and the relations the checker knows are the ones the schema lists', () => {
    const node = (HEALTH_SCHEMA.$defs as Record<string, { properties: Record<string, { enum?: string[] }> }>).node
    const edge = (HEALTH_SCHEMA.$defs as Record<string, { properties: Record<string, { enum?: string[] }> }>).edge
    expect([...HEALTH_KINDS]).toEqual(node.properties.kind.enum)
    expect(Object.keys(HEALTH_EDGE_LABELS)).toEqual(edge.properties.label.enum)
  })

  test('every relation allows the endpoints the checker enforces', () => {
    for (const [label, rule] of Object.entries(HEALTH_EDGE_LABELS)) {
      expect(rule.from.length).toBeGreaterThan(0)
      expect(rule.to.length).toBeGreaterThan(0)
      for (const kind of [...rule.from, ...rule.to]) {
        expect(kind === '*' || HEALTH_KINDS.includes(kind)).toBe(true)
        expect(label).not.toMatch(/\s/)
      }
    }
  })

  test('an event is a kind whose branch requires a date; a prediction and a source are not', () => {
    expect([...HEALTH_EVENT_KINDS]).toEqual(['condition', 'observation', 'encounter', 'medication', 'summary'])
    expect(TEMPORAL_NODE_KINDS).toContain('prediction')
    expect(TEMPORAL_NODE_KINDS).not.toContain('source')
  })
})

describe('rules a card can trip over', () => {
  const health = (over: Record<string, unknown>): unknown => ({
    meta: {
      title: 't',
      schema: 'kg/1',
      app: 'health-viewer',
      profile: { sex: 'male', year_of_birth: 1961 },
    },
    nodes: [
      { id: 'src-1', kind: 'source', label: 'a note', confirmed: true },
      {
        id: 'obs-1',
        kind: 'observation',
        label: 'LDL',
        when: '2026-11-12',
        value: 4.9,
        unit: 'mmol/L',
        confirmed: true,
        source: 'src-1',
      },
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

  test('an edge that names a source must name a source node', () => {
    const doc = health({}) as { edges: Array<Record<string, unknown>> }
    doc.edges[0].source = 'obs-1'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('edge source "obs-1" is a observation node')
  })

  test('a confidence outside 0..1 is rejected', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].confidence = 1.4
    expect(validateKg(doc).map((i) => i.path)).toContain('$.nodes[obs-1].confidence')
  })

  test('an interval without a start is not a date', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].when = { to: '2026-11-12' }
    const issues = validateKg(doc)
    expect(issues.map((i) => i.path)).toContain('$.nodes[obs-1].when.from')
    expect(issues.map((i) => i.message).join(' ')).toContain('required property "from"')
  })

  test('a date that does not exist on the calendar is not a date', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].when = '2026-02-30'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('must be a date, YYYY-MM-DD')
  })

  test('a node without confirmed says nothing about who stands behind it', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[0].confirmed = 'yes'
    expect(validateKg(doc).map((i) => i.path)).toContain('$.nodes[src-1].confirmed')
  })

  test('a source node is the provenance and may not point at one', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[0].source = 'src-1'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('a source node is the provenance')
  })

  test('a dated node may carry a validity window; a stable one may not', () => {
    const dated = health({}) as { nodes: Array<Record<string, unknown>> }
    dated.nodes[1].valid_from = '2026-01-01'
    expect(validateKg(dated)).toEqual([])

    const stable = health({}) as { nodes: Array<Record<string, unknown>> }
    stable.nodes[0].valid_from = '2026-01-01'
    expect(validateKg(stable).map((i) => i.path)).toContain('$.nodes[src-1].valid_from')
  })

  test('a window that ends before it starts never holds', () => {
    const doc = health({}) as { edges: Array<Record<string, unknown>> }
    doc.edges[0].valid_from = '2026-05-01'
    doc.edges[0].valid_to = '2025-05-01'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('a window that ends before it starts never holds')
  })

  test('every event carries its date, and a prediction is not an event', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes.push({ id: 'pred-1', kind: 'prediction', label: 'LDL under 3 by 2031', confirmed: false, source: 'src-1' })
    expect(validateKg(doc)).toEqual([])
  })

  test('the document is read-only for the template: nothing is mutated by validating it', () => {
    const doc = health({})
    const before = JSON.stringify(doc)
    validateKg(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})
