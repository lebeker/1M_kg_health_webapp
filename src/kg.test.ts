/**
 * What the data layer carries from the document to the page.
 *
 * The rule these tests hold: a property the document states is a property, whatever its shape.
 * The bug that made this a test file: a nested object was skipped on the way in, so a condition
 * carrying an interval date — `when: {from: "2021-05-14", to: null}` — arrived with no date at all.
 * Nothing complained: the node drew, the profile controls said the record had no date, and the
 * only symptom was a number that was quietly wrong (T05).
 *
 *   bun test src/kg.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { toKg } from './kg'
import { recordAges } from './profile'

const graphOf = (doc: Parameters<typeof toKg>[0]) => toKg(doc).graph

describe('a nested value is a value', () => {
  test('a node keeps an interval date intact', () => {
    const graph = graphOf({
      nodes: [
        { id: 'c', kind: 'condition', when: { from: '2021-05-14', to: null } },
        { id: 'o', kind: 'observation', when: '2026-11-12', value: 4.9, unit: 'mmol/L' },
      ],
      edges: [],
    })
    expect(graph.getNodeAttribute('c', 'when')).toEqual({ from: '2021-05-14', to: null })
    expect(graph.getNodeAttribute('o', 'when')).toBe('2026-11-12')
  })

  test('so the page can put a condition on the record’s span', () => {
    const graph = graphOf({
      nodes: [
        { id: 'c', kind: 'condition', when: { from: '2021-05-14', to: null } },
        { id: 'o', kind: 'observation', when: '2026-11-12', value: 4.9, unit: 'mmol/L' },
      ],
      edges: [],
    })
    const nodes: { when?: unknown }[] = []
    graph.forEachNode((_id, attrs) => {
      nodes.push({ when: (attrs as Record<string, unknown>).when })
    })
    expect(recordAges(nodes, { sex: 'male', year_of_birth: 1961 })).toEqual({
      first: '2021-05-14',
      last: '2026-11-12',
      fromAge: 60,
      toAge: 65,
      dated: 2,
    })
  })

  test('an edge keeps a nested property — a validity window is an object too', () => {
    const graph = graphOf({
      nodes: [
        { id: 'a', kind: 'observation' },
        { id: 'b', kind: 'condition' },
      ],
      edges: [
        {
          from: 'a',
          to: 'b',
          label: 'tracks',
          valid_from: '2021-05-14',
          valid_to: '2024-01-01',
          when: { from: '2021-05-14', to: null },
          measurement: { value: 4.9, unit: 'mmol/L' },
        },
      ],
    })
    const [key] = graph.edges()
    expect(graph.getEdgeAttribute(key, 'valid_from')).toBe('2021-05-14')
    // The two shapes a relation actually carries. Both are objects, both were dropped by the same
    // skip the node loop had — and an edge's extras reach the page as a connection row, so this is
    // the fence for that path, not bookkeeping.
    expect(graph.getEdgeAttribute(key, 'when')).toEqual({ from: '2021-05-14', to: null })
    expect(graph.getEdgeAttribute(key, 'measurement')).toEqual({ value: 4.9, unit: 'mmol/L' })
  })

  test('an object nested deeper is still the document’s property', () => {
    const graph = graphOf({
      nodes: [{ id: 'p', kind: 'prediction', source: 's', projection: { median: 3.1, horizon: 10 } }],
      edges: [],
    })
    expect(graph.getNodeAttribute('p', 'projection')).toEqual({ median: 3.1, horizon: 10 })
  })
})
