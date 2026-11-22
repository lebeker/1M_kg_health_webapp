import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HEALTH_EDGE_LABELS,
  HEALTH_EVENT_KINDS,
  HEALTH_KINDS,
  HEALTH_SCHEMA,
  HEALTH_SCHEMA_VERSION,
  PREDICTION_REQUIRED,
  PREDICTION_TARGET_KINDS,
  TEMPORAL_NODE_KINDS,
  validateKg,
} from './lib/kg-contract'
import { PREDICTION_FIELDS, loadPredictions } from '../src/prediction'
import { conditionProblems } from '../src/rules'

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
    ['invalid/edge-without-end.json', 'edge has no to'],
    ['invalid/duplicate-node-id.json', 'duplicate node id'],
    ['invalid/unknown-kind.json', 'must be one of: condition, observation'],
    ['invalid/event-without-date.json', 'an encounter needs its date'],
    ['invalid/procedure-without-date.json', 'a procedure needs the date it was performed'],
    ['invalid/document-without-date.json', 'a document needs the date printed on it'],
    ['invalid/document-with-a-source.json', 'a document node is the provenance'],
    ['invalid/edge-without-source.json', 'missing "source"'],
    ['invalid/value-as-string.json', 'must be a number'],
    ['invalid/edge-label-not-in-contract.json', 'must be one of: tracks'],
    ['invalid/missing-profile.json', 'must have required property "profile"'],
    ['invalid/wrong-endpoints.json', 'tracks starts at condition, expected observation'],
    ['invalid/valid-from-on-non-temporal-node.json', 'valid_from on a non-temporal node'],
    ['invalid/prediction-without-condition.json', 'a prediction is a simulation, not a fact'],
    ['invalid/prediction-with-when.json', 'a prediction is not an event'],
    ['invalid/prediction-target-not-in-document.json', 'is not a node in this document'],
    ['invalid/prediction-horizon-before-its-document.json', 'a forecast is about a later date, never an earlier one'],
    ['invalid/prediction-condition-as-prose.json', 'must be an object'],
  ]

  for (const [fixture, expected] of mustReject) {
    test(`rejects ${fixture}`, () => {
      const issues = validateKg(read(fixture))
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.map((issue) => issue.message).join(' | ')).toContain(expected)
    })
  }
})

describe('the base kg/1 path', () => {
  // A research map, not a health document: the renderer needs `nodes[].id` and `edges[].{from,to}`
  // and nothing else (src/kg.ts), so these are the only edge fields the base pass may insist on.
  const viewer = (edges: unknown[]): unknown => ({
    meta: { title: 'a research map', schema: 'kg/1', app: 'viewer' },
    nodes: [
      { id: 'pub-1', label: 'A paper', kind: 'publication' },
      { id: 'res-1', label: 'A researcher', kind: 'researcher', x: 12.5, y: -4 },
    ],
    edges,
  })

  test('an edge with both ends and free-form extras conforms', () => {
    expect(validateKg(viewer([{ from: 'pub-1', to: 'res-1', label: 'authored by', power: 1 }]))).toEqual([])
  })

  // The renderer drops an edge that names no end without a word, so the checker is the only thing
  // that can see it — a document with one must not be reported clean.
  const missingEnd: Array<[string, Record<string, unknown>, string]> = [
    ['no to', { from: 'pub-1', label: 'authored by' }, '$.edges[0].to'],
    ['no from', { to: 'res-1', label: 'authored by' }, '$.edges[0].from'],
    ['an empty to', { from: 'pub-1', to: '', label: 'authored by' }, '$.edges[0].to'],
    ['a to that is not a string', { from: 'pub-1', to: 7, label: 'authored by' }, '$.edges[0].to'],
  ]

  for (const [name, edge, path] of missingEnd) {
    test(`a base-path edge with ${name} is rejected`, () => {
      const issues = validateKg(viewer([edge]))
      expect(issues.map((issue) => issue.path)).toContain(path)
      expect(issues.map((issue) => issue.message).join(' | ')).toContain('edge has no')
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

  test('every event kind states its date, and the document is the one event without a source', () => {
    const node = (
      HEALTH_SCHEMA.$defs as Record<
        string,
        { oneOf: Array<{ properties?: Record<string, { const?: string }>; required?: string[] }> }
      >
    ).node
    for (const kind of HEALTH_EVENT_KINDS) {
      const branch = node.oneOf.find((candidate) => candidate.properties?.kind?.const === kind)
      expect(branch?.required).toContain('when')
      if (kind === 'document') expect(branch?.required ?? []).not.toContain('source')
      else expect(branch?.required ?? []).toContain('source')
    }
  })

  test('a summary marker and a prediction are kinds without being events', () => {
    expect(HEALTH_KINDS).toContain('summary')
    expect(HEALTH_KINDS).toContain('prediction')
    expect(HEALTH_EVENT_KINDS).not.toContain('summary')
    expect(HEALTH_EVENT_KINDS).not.toContain('prediction')
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

  test('an event is one of the six kinds T06 names; a summary marker and a prediction are not', () => {
    expect([...HEALTH_EVENT_KINDS]).toEqual([
      'condition',
      'observation',
      'encounter',
      'medication',
      'procedure',
      'document',
    ])
    expect(TEMPORAL_NODE_KINDS).toContain('prediction')
    expect(TEMPORAL_NODE_KINDS).not.toContain('document')
    expect(TEMPORAL_NODE_KINDS).not.toContain('summary')
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
      { id: 'src-1', kind: 'document', when: '2021-05-14', label: 'a note', confirmed: true },
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

  test('a fact must point at a node whose kind is document', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[1].source = 'obs-1'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('not a document')
  })

  test('an edge that names a source must name a document node', () => {
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

  test('a document node is the provenance and may not point at one', () => {
    const doc = health({}) as { nodes: Array<Record<string, unknown>> }
    doc.nodes[0].source = 'src-1'
    expect(validateKg(doc).map((i) => i.message).join(' ')).toContain('a document node is the provenance')
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
    doc.nodes.push({
      id: 'pred-1',
      kind: 'prediction',
      label: 'LDL under 3 by 2031',
      target: 'obs-1',
      horizon: '2031-01-01',
      condition: { fact: 'on_statin', op: 'eq', value: true },
      delta_median: -1.1,
      confidence: 0.6,
      confirmed: false,
      source: 'src-1',
    })
    expect(validateKg(doc)).toEqual([])
  })

  test('the document is read-only for the template: nothing is mutated by validating it', () => {
    const doc = health({})
    const before = JSON.stringify(doc)
    validateKg(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('a prediction is a simulation, not a fact', () => {
  const PREDICTION_KEY = 'pred-1'

  /**
   * A document with one prediction, its document, its target and the `projected` edge. Each test
   * breaks one thing; the rest of the document is what a forecast looks like when it is right.
   */
  const forecast = (): {
    meta: Record<string, unknown>
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  } => ({
    meta: {
      title: 't',
      schema: 'kg/1',
      app: 'health-viewer',
      requires: { skills: ['kg'], plugins: [], tools: [] },
      colors: {},
      profile: { sex: 'male', year_of_birth: 1961 },
      timezone: 'Europe/Berlin',
    },
    nodes: [
      { id: 'src-1', kind: 'document', label: 'a note', when: '2021-05-14', confirmed: true },
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
      {
        id: PREDICTION_KEY,
        kind: 'prediction',
        label: 'LDL under 3 by 2028',
        target: 'obs-1',
        horizon: '2028-01-01',
        condition: { fact: 'on_statin', op: 'eq', value: true },
        delta_median: -1.1,
        confidence: 0.6,
        confirmed: false,
        source: 'src-1',
      },
    ],
    edges: [{ from: PREDICTION_KEY, to: 'obs-1', label: 'projected', confidence: 0.6 }],
  })

  const pred = (doc: ReturnType<typeof forecast>): Record<string, unknown> =>
    doc.nodes.find((node) => node.id === PREDICTION_KEY) as Record<string, unknown>

  test('a well-formed forecast is clean', () => {
    expect(validateKg(forecast())).toEqual([])
  })

  // The schema is the list's home; the loader in src/prediction.ts restates it for the app, and the
  // two are held together here so a field added to one cannot be forgotten in the other.
  test('the six fields the schema requires are the six the gate reads', () => {
    expect([...PREDICTION_REQUIRED]).toEqual([...PREDICTION_FIELDS])
    expect([...PREDICTION_REQUIRED]).toEqual(['target', 'horizon', 'condition', 'delta_median', 'source', 'confidence'])
  })

  test('a prediction is about an outcome — the kinds it may project onto are the relation’s', () => {
    expect([...PREDICTION_TARGET_KINDS]).toEqual([...HEALTH_EDGE_LABELS.projected.to])
    expect([...PREDICTION_TARGET_KINDS]).toEqual(['condition', 'observation'])
  })

  const broken: Array<[string, (doc: ReturnType<typeof forecast>) => void, string]> = [
    ['target', (doc) => { delete pred(doc).target }, 'missing "target"'],
    ['horizon', (doc) => { delete pred(doc).horizon }, 'missing "horizon"'],
    ['condition', (doc) => { delete pred(doc).condition }, 'missing "condition"'],
    ['delta_median', (doc) => { delete pred(doc).delta_median }, 'missing "delta_median"'],
    ['source', (doc) => { delete pred(doc).source }, 'missing "source"'],
    ['confidence', (doc) => { delete pred(doc).confidence }, 'missing "confidence"'],
    ['when', (doc) => (pred(doc).when = '2026-11-12'), 'a prediction is not an event'],
    ['target that is not here', (doc) => { pred(doc).target = 'obs-gone' }, 'is not a node in this document'],
    ['target that is a document', (doc) => { pred(doc).target = 'src-1' }, 'expected condition or observation'],
    ['horizon before the document', (doc) => (pred(doc).horizon = '2020-01-01'), 'never an earlier one'],
    ['horizon that is not a date', (doc) => (pred(doc).horizon = '2028-02-30'), 'must be a date, YYYY-MM-DD'],
    ['condition in prose', (doc) => (pred(doc).condition = 'if he takes a statin'), 'must be an object'],
    ['empty condition object', (doc) => (pred(doc).condition = {}), 'missing "fact"'],
    ['condition with an unknown operator', (doc) => (pred(doc).condition = { fact: 'x', op: 'roughly' }), 'must be one of: eq'],
    // The value of a comparison is decided by its operator, in the schema and in the engine alike.
    ['condition that is an `exists` with a value', (doc) => (pred(doc).condition = { fact: 'on_statin', op: 'exists', value: 1 }), 'exists takes no value'],
    ['condition that gives a comparison a list', (doc) => (pred(doc).condition = { fact: 'ldl_cholesterol', op: 'eq', value: [1, 2] }), 'must be a number'],
    ['condition that names an operator and no value', (doc) => (pred(doc).condition = { fact: 'ldl_cholesterol', op: 'eq' }), 'missing "value"'],
    ['condition that is an `in` with a single value', (doc) => (pred(doc).condition = { fact: 'ldl_cholesterol', op: 'in', value: 5 }), 'must be an array'],
    ['condition that is an `in` with an empty list', (doc) => (pred(doc).condition = { fact: 'ldl_cholesterol', op: 'in', value: [] }), 'at least 1 item'],
    ['delta_median as a string', (doc) => (pred(doc).delta_median = 'a bit'), 'must be a number'],
    ['confidence above 1', (doc) => (pred(doc).confidence = 1.4), 'must be at most 1'],
  ]

  for (const [name, breakIt, expected] of broken) {
    test(`a prediction with ${name} is rejected`, () => {
      const doc = forecast()
      breakIt(doc)
      const issues = validateKg(doc)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.map((issue) => issue.message).join(' | ')).toContain(expected)
    })
  }

  test('the refusal points at the prediction by id, not by its index', () => {
    const doc = forecast()
    delete pred(doc).target
    expect(validateKg(doc).map((issue) => issue.path)).toContain(`$.nodes[${PREDICTION_KEY}]`)
  })

  test('a comparison, a group and a negation are all conditions', () => {
    const doc = forecast()
    pred(doc).condition = {
      all: [
        { fact: 'on_statin', op: 'eq', value: true },
        { any: [{ fact: 'ldl_cholesterol', op: 'lt', value: 3 }, { not: { fact: 'current_smoker', op: 'eq', value: true } }] },
      ],
    }
    expect(validateKg(doc)).toEqual([])
  })

  /**
   * The failure this table exists for: a document that passes `bun run test:contract` and then makes
   * `loadPredictions` throw. The schema's `$defs.predicate` and the engine's `conditionProblems` are
   * one language read by two readers, so every shape has to get the same answer from both — an
   * `exists` carries no value, `in` takes a list and only `in` does, and a comparison needs a value.
   * Each row is one shape; a row that changes side fails the test that names it. The fourth column is
   * what the reader is told on the schema's side as well (`null` where the schema names the missing
   * shape rather than the operator's error) — the two voices differ in wording, never in verdict.
   */
  const withCondition = (condition: unknown): ReturnType<typeof forecast> => {
    const doc = forecast()
    pred(doc).condition = condition
    return doc
  }

  const acceptedByBoth: Array<[string, unknown]> = [
    ['eq with a boolean', { fact: 'on_statin', op: 'eq', value: true }],
    ['gt with a number', { fact: 'age', op: 'gt', value: 40 }],
    ['ne with a string', { fact: 'sex', op: 'ne', value: 'male' }],
    ['in with a list of mixed scalars', { fact: 'sex', op: 'in', value: ['male', 'female', 1, true] }],
    ['exists with no value', { fact: 'on_statin', op: 'exists' }],
    ['a group of groups', { all: [{ any: [{ fact: 'a', op: 'exists' }] }, { not: { fact: 'b', op: 'le', value: 2 } }] }],
  ]

  const refusedByBoth: Array<[string, unknown, string, string | null]> = [
    ['exists that carries a value', { fact: 'on_statin', op: 'exists', value: 1 }, 'exists takes no value', 'exists takes no value'],
    ['a comparison given a list', { fact: 'sex', op: 'eq', value: ['male'] }, 'must be a number', 'must be a number'],
    ['a comparison with no value', { fact: 'sex', op: 'eq' }, 'must be a number', 'missing "value"'],
    ['a comparison with a null value', { fact: 'sex', op: 'eq', value: null }, 'must be a number', 'must be a number'],
    ['in given a single value', { fact: 'sex', op: 'in', value: 'male' }, 'in takes a non-empty list', 'must be an array'],
    ['in with no value', { fact: 'sex', op: 'in' }, 'in takes a non-empty list', 'missing "value"'],
    ['in with an empty list', { fact: 'sex', op: 'in', value: [] }, 'in takes a non-empty list', 'at least 1 item'],
    ['in with an object in the list', { fact: 'sex', op: 'in', value: [{ sex: 'male' }] }, 'in takes a non-empty list', 'must be a number'],
    ['a leaf key that is not fact, op or value', { fact: 'age', op: 'eq', value: 40, weight: 2 }, 'unknown key "weight"', 'not part of the contract'],
    ['an empty fact name', { fact: '', op: 'eq', value: 1 }, 'a comparison names one fact', 'must not be blank'],
    // Both readers trim before they answer, so a fact name of spaces is empty to both. A bare
    // `minLength: 1` reads it as content, which is how a document passed the gate and then threw.
    ['a fact name of spaces', { fact: '   ', op: 'eq', value: 1 }, 'a comparison names one fact', 'must not be blank'],
    ['an `exists` over a fact name of spaces', { fact: ' ', op: 'exists' }, 'a comparison names one fact', 'must not be blank'],
    ['an empty all', { all: [] }, 'can never fire', null],
    ['an empty any', { any: [] }, 'can never fire', null],
  ]

  for (const [name, condition] of acceptedByBoth) {
    test(`the schema and the engine both accept ${name}`, () => {
      expect(conditionProblems(condition, '$.condition')).toEqual([])
      expect(validateKg(withCondition(condition))).toEqual([])
    })
  }

  for (const [name, condition, engineSays, schemaSays] of refusedByBoth) {
    test(`the schema and the engine both refuse ${name}`, () => {
      expect(conditionProblems(condition, '$.condition').join(' | ')).toContain(engineSays)
      const issues = validateKg(withCondition(condition))
      expect(issues.length).toBeGreaterThan(0)
      if (schemaSays !== null) {
        expect(issues.map((issue) => issue.message).join(' | ')).toContain(schemaSays)
      }
    })
  }

  /**
   * The same disagreement, one level up from the condition. `loadPredictions` reads a prediction's
   * own fields through the same trimmed test (`isNonEmptyString`), so a blank target, source or id
   * has to be refused here as well — otherwise the document passes the gate and the loader throws.
   * A blank `source` is the sharpest case: the referential check resolves an id, and an id of spaces
   * is nothing to resolve, so before this the gate skipped the field entirely.
   */
  const blankOwnFields: Array<[string, (doc: ReturnType<typeof forecast>) => void]> = [
    ['a target of spaces', (doc) => { pred(doc).target = '  ' }],
    ['an empty target', (doc) => { pred(doc).target = '' }],
    ['a source of spaces', (doc) => { pred(doc).source = '  ' }],
    ['an empty source', (doc) => { pred(doc).source = '' }],
    ['an id of spaces', (doc) => { pred(doc).id = '  ' }],
  ]

  for (const [name, blankIt] of blankOwnFields) {
    test(`the gate and the loader both refuse a prediction with ${name}`, () => {
      const doc = forecast()
      blankIt(doc)
      expect(validateKg(doc).map((issue) => issue.message).join(' | ')).toContain('must not be blank')
      expect(() => loadPredictions(doc.nodes)).toThrow()
    })
  }

  // A blank source and a source that points at nothing must not read alike: the schema states the
  // rule, and the lookup then says it had nothing to resolve. The second half is the one that was
  // missing — the guard skipped the check and the field went unreported.
  test('a blank source is reported by the rule and by the lookup; a dangling one only by the lookup', () => {
    const blank = forecast()
    pred(blank).source = '   '
    const blankIssues = validateKg(blank)
    expect(blankIssues.map((issue) => issue.path)).toEqual([`$.nodes[${PREDICTION_KEY}].source`, `$.nodes[${PREDICTION_KEY}].source`])
    expect(blankIssues[0].message).toContain('must not be blank')
    expect(blankIssues[1].message).toContain('source is blank')

    const dangling = forecast()
    pred(dangling).source = 'src-gone'
    const danglingIssues = validateKg(dangling)
    expect(danglingIssues).toHaveLength(1)
    expect(danglingIssues[0].message).toContain('not a node in this document')
  })

  test('a source on an edge that is blank is refused the same way', () => {
    const doc = forecast()
    doc.edges[0].source = '  '
    const messages = validateKg(doc).map((issue) => issue.message).join(' | ')
    expect(messages).toContain('must not be blank')
    expect(messages).toContain('source is blank')
  })

  test('an edge whose end is spaces is refused — the same string rule, on a relation', () => {
    const doc = forecast()
    doc.edges[0].from = '   '
    expect(validateKg(doc).map((issue) => issue.message).join(' | ')).toContain('must not be blank')
  })

  test('an interval document date is compared by the day it starts', () => {
    const doc = forecast()
    doc.nodes[0].when = { from: '2021-05-14', to: null }
    expect(validateKg(doc)).toEqual([])

    pred(doc).horizon = '2021-05-13'
    expect(validateKg(doc).map((issue) => issue.path)).toContain(`$.nodes[${PREDICTION_KEY}].horizon`)
  })
})
