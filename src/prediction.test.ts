import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Prediction, PredictionError, applyPredictions, loadPredictions } from './prediction'
import { applyRules, loadRules } from './rules'

/**
 * T18 — a forecast is a simulation, not a fact.
 *
 * The tests are written around the one promise a reader can be hurt by: the estimate must not move
 * until the forecast's condition is met, and "we do not know" must never be read as "met". So the
 * negative cases come first and outnumber the happy one.
 */

const SOURCE = 'PMID:16478903'

const prediction = (over: Partial<Prediction> = {}): Prediction => ({
  id: 'pred-ldl-2028',
  target: 'obs-ldl-2026-11',
  horizon: '2028-01-01',
  condition: { fact: 'on_statin', op: 'eq', value: true },
  delta_median: -1.1,
  source: SOURCE,
  confidence: 0.6,
  ...over,
})

const nodeOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pred-ldl-2028',
  kind: 'prediction',
  label: 'LDL below 3.0 by 2028',
  target: 'obs-ldl-2026-11',
  horizon: '2028-01-01',
  condition: { fact: 'on_statin', op: 'eq', value: true },
  delta_median: -1.1,
  confidence: 0.6,
  source: 'src-discharge-2021',
  confirmed: false,
  ...over,
})

describe('loading predictions out of a document', () => {
  test('reads the prediction nodes and leaves every other kind alone', () => {
    const nodes = [
      { id: 'src-1', kind: 'document' },
      nodeOf(),
      { id: 'obs-1', kind: 'observation' },
      nodeOf({ id: 'pred-a', target: 'obs-2' }),
    ]
    expect(loadPredictions(nodes).map((p) => p.id)).toEqual(['pred-a', 'pred-ldl-2028'])
  })

  test('a document with no predictions yields none, not an error', () => {
    expect(loadPredictions([{ id: 'src-1', kind: 'document' }])).toEqual([])
    expect(loadPredictions([])).toEqual([])
  })

  test('the six fields of the card are read off the node, not invented', () => {
    const [loaded] = loadPredictions([nodeOf()])
    expect(loaded).toEqual({
      id: 'pred-ldl-2028',
      target: 'obs-ldl-2026-11',
      horizon: '2028-01-01',
      condition: { fact: 'on_statin', op: 'eq', value: true },
      delta_median: -1.1,
      source: 'src-discharge-2021',
      confidence: 0.6,
    })
  })

  // Each field the card names, removed on its own: the refusal has to name the one that is gone.
  const missing: Array<[string, string]> = [
    ['target', 'missing target'],
    ['horizon', 'missing horizon'],
    ['condition', 'missing condition'],
    ['delta_median', 'delta_median: must be a finite number'],
    ['source', 'a forecast without a source does not load'],
    ['confidence', 'confidence: must be a number from 0 to 1'],
  ]

  for (const [field, message] of missing) {
    test(`a prediction without ${field} does not load`, () => {
      const node = nodeOf()
      delete node[field]
      expect(() => loadPredictions([node])).toThrow(PredictionError)
      expect(() => loadPredictions([node])).toThrow(message)
    })
  }

  test('a horizon that does not exist on the calendar is not a date', () => {
    expect(() => loadPredictions([nodeOf({ horizon: '2028-02-30' })])).toThrow('must be a date, YYYY-MM-DD')
  })

  test('a condition in prose is refused: it cannot be evaluated, so it cannot be waited on', () => {
    expect(() => loadPredictions([nodeOf({ condition: 'if he takes a statin' })])).toThrow(
      'condition: a condition is an object',
    )
  })

  test('a malformed condition names the part that is wrong', () => {
    expect(() => loadPredictions([nodeOf({ condition: { fact: 'on_statin', op: 'roughly', value: true } })])).toThrow(
      'must be one of eq, ne, lt, le, gt, ge, in, exists',
    )
  })

  test('two predictions under one id cannot be told apart, so the set is refused', () => {
    expect(() => loadPredictions([nodeOf(), nodeOf()])).toThrow('duplicate prediction id')
  })

  test('one bad prediction refuses the whole set: a partial load is a different estimate', () => {
    const good = nodeOf({ id: 'pred-good' })
    const bad = nodeOf({ id: 'pred-bad', delta_median: 'a bit' })
    expect(() => loadPredictions([good, bad])).toThrow(PredictionError)
  })
})

describe('the gate: nothing moves until the condition is met', () => {
  test('a met condition applies the delta to the estimate', () => {
    const gate = applyPredictions({
      version: 'score2-10y/1',
      predictions: loadPredictions([nodeOf()]),
      facts: { on_statin: true },
    })
    expect(gate.delta).toBe(-1.1)
    expect(gate.applied.map((row) => row.id)).toEqual(['pred-ldl-2028'])
    expect(gate.applied[0].verdict).toBe('met')
    expect(gate.applied[0].reason).toBeUndefined()
    expect(gate.withheld).toEqual([])
  })

  test('an unmet condition leaves the estimate exactly where it was', () => {
    const gate = applyPredictions({
      version: 'score2-10y/1',
      predictions: loadPredictions([nodeOf()]),
      facts: { on_statin: false },
    })
    expect(gate.delta).toBe(0)
    expect(gate.applied).toEqual([])
    expect(gate.withheld).toHaveLength(1)
    expect(gate.withheld[0].verdict).toBe('unmet')
    expect(gate.withheld[0].reason).toBe('no-match')
  })

  test('a fact nobody supplied is unknown, and unknown is withheld — not met, not dropped', () => {
    const gate = applyPredictions({
      version: 'score2-10y/1',
      predictions: loadPredictions([nodeOf()]),
      facts: {},
    })
    expect(gate.delta).toBe(0)
    expect(gate.withheld[0].verdict).toBe('unknown')
    expect(gate.withheld[0].reason).toBe('missing-fact')
  })

  test('"not on a statin" over an unknown fact stays unknown: the forecast waits, it does not fire', () => {
    // The trap this card exists to close: `not` over an undecidable condition is undecidable.
    const negation = prediction({ condition: { not: { fact: 'on_statin', op: 'eq', value: true } } })
    const gate = applyPredictions({ version: 'score2-10y/1', predictions: [negation], facts: {} })
    expect(gate.delta).toBe(0)
    expect(gate.withheld[0].verdict).toBe('unknown')
    expect(gate.withheld[0].reason).toBe('missing-fact')
  })

  test('a mistyped fact is unknown, not false', () => {
    const gate = applyPredictions({
      version: 'score2-10y/1',
      predictions: loadPredictions([nodeOf({ condition: { fact: 'on_statin', op: 'eq', value: true } })]),
      facts: { on_statin: 'yes' },
    })
    expect(gate.withheld[0].verdict).toBe('unknown')
    expect(gate.withheld[0].reason).toBe('type-mismatch')
  })

  test('only the met forecasts are summed; the rest are named, not silently dropped', () => {
    const gate = applyPredictions({
      version: 'score2-10y/1',
      predictions: [
        prediction({ id: 'pred-a', condition: { fact: 'on_statin', op: 'eq', value: true }, delta_median: -1 }),
        prediction({ id: 'pred-b', condition: { fact: 'current_smoker', op: 'eq', value: false }, delta_median: 2 }),
        prediction({ id: 'pred-c', condition: { fact: 'ldl_cholesterol', op: 'lt', value: 3 }, delta_median: -0.5 }),
      ],
      facts: { on_statin: true, current_smoker: false },
    })
    expect(gate.delta).toBe(1)
    expect(gate.applied.map((row) => row.id)).toEqual(['pred-a', 'pred-b'])
    expect(gate.withheld.map((row) => row.id)).toEqual(['pred-c'])
    expect(gate.withheld[0].reason).toBe('missing-fact')
  })

  test('the same predictions in any file order produce the same number, bit for bit', () => {
    const a = prediction({ id: 'pred-a', delta_median: 0.1 })
    const b = prediction({ id: 'pred-b', delta_median: 0.2 })
    const facts = { on_statin: true }
    const forward = applyPredictions({ version: 'score2-10y/1', predictions: [a, b], facts })
    const backward = applyPredictions({ version: 'score2-10y/1', predictions: [b, a], facts })
    expect(forward.delta).toBe(backward.delta)
    expect(forward.applied.map((row) => row.id)).toEqual(backward.applied.map((row) => row.id))
  })

  test('a forecast with a met condition is the only thing that can move the number', () => {
    // The estimate is a rule set's number, and the gate's delta is added only when it is non-zero.
    const set = loadRules({ version: 'score2-10y/1', rules: [] })
    const estimate = applyRules(set, { on_statin: true }, 12)
    const gate = applyPredictions({ version: 'score2-10y/1', predictions: [prediction()], facts: { on_statin: true } })
    expect(estimate.value + gate.delta).toBe(10.9)

    const unmet = applyPredictions({ version: 'score2-10y/1', predictions: [prediction()], facts: { on_statin: false } })
    expect(estimate.value + unmet.delta).toBe(12)
  })

  test('a bare array or a missing scale is refused at the gate, not half-applied', () => {
    expect(() =>
      applyPredictions({ version: '', predictions: [prediction()], facts: {} }),
    ).toThrow('a delta names the scale it is in')
    expect(() =>
      applyPredictions({ version: 'score2-10y/1', predictions: [prediction({ source: '' })], facts: {} }),
    ).toThrow('a forecast without a source does not load')
  })

  test('the gate does not rewrite the document it was handed', () => {
    const rows = loadPredictions([nodeOf()])
    const before = JSON.stringify(rows)
    applyPredictions({ version: 'score2-10y/1', predictions: rows, facts: { on_statin: true } })
    expect(JSON.stringify(rows)).toBe(before)
  })
})

describe('the shipped fixture, end to end', () => {
  test('a forecast over a stopped statin is withheld, and the estimate does not move', () => {
    const doc = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'tests/fixtures/kg/valid/health-prediction.json'), 'utf8'),
    ) as { nodes: unknown[] }
    const predictions = loadPredictions(doc.nodes)
    expect(predictions.map((p) => p.id)).toEqual(['pred-ldl-below-3-2031'])

    const stopped = applyPredictions({ version: 'score2-10y/1', predictions, facts: { on_statin: false } })
    expect(stopped.delta).toBe(0)
    expect(stopped.withheld[0].verdict).toBe('unmet')

    const started = applyPredictions({ version: 'score2-10y/1', predictions, facts: { on_statin: true } })
    expect(started.delta).toBe(-0.5)
  })
})
