/**
 * The five built-in strategies, as arithmetic and as refusals.
 *
 * The card (T19, SCRUM-30) is one line: "Statin/LDL, smoking, colonoscopy, HbA1c, blood pressure;
 * each with a PMID and an interval". What that has to mean in code is narrower and testable:
 *
 *   - five strategies, each carrying a PubMed id, a citation, a published ratio and the interval
 *     that came with it, and what the ratio is per;
 *   - a strategy that is missing any of that does not load, all five or none, the same rule the
 *     rules engine and the prediction loader already enforce;
 *   - a strategy becomes nodes only when somebody says what it is about and by when, and the date
 *     may not be before the paper was printed;
 *   - the delta is the log of the ratio, so two strategies on one outcome add the way their ratios
 *     multiply, and two outcomes never share a scale.
 *
 *   bun test src/strategies.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { STRATEGIES, SCALE, StrategyError, gateStrategies, loadStrategies, materialise } from './strategies'

/** The demo placements, inline so this file tests the module and not a fixture. */
const PLACEMENTS = {
  'statin-ldl': { target: 'obs-ldl', horizon: '2031-11-12' },
  'quit-smoking': { target: 'cond-tobacco', horizon: '2031-11-12' },
  'colonoscopy-screening': { target: 'cond-adenoma', horizon: '2036-11-12' },
  'intensive-hba1c': { target: 'obs-hba1c', horizon: '2031-11-12' },
  'bp-lowering': { target: 'obs-sbp', horizon: '2031-11-12' },
}

const ALL_MET = {
  on_statin: true,
  current_smoker: false,
  ever_smoked: true,
  screening_colonoscopy: true,
  intensive_glycaemic_control: true,
  on_antihypertensive: true,
}

/** A deep copy of the shipped set, so a test can break one field without touching the module. */
const clone = (): Record<string, unknown>[] => JSON.parse(JSON.stringify(STRATEGIES)) as Record<string, unknown>[]

const problemsOf = (input: unknown): string[] => {
  try {
    loadStrategies(input)
    return []
  } catch (error) {
    if (error instanceof StrategyError) return error.problems
    throw error
  }
}

describe('the five', () => {
  test('are the five the card names, and nothing else', () => {
    expect(STRATEGIES.map((strategy) => strategy.id)).toEqual([
      'statin-ldl',
      'quit-smoking',
      'colonoscopy-screening',
      'intensive-hba1c',
      'bp-lowering',
    ])
  })

  test('each carries a PMID, a citation, a link, and the date printed on the paper', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.source.pmid).toMatch(/^\d{8}$/)
      expect(strategy.source.citation.length).toBeGreaterThan(40)
      expect(strategy.source.link).toBe(`https://pubmed.ncbi.nlm.nih.gov/${strategy.source.pmid}/`)
      expect(Number.isNaN(Date.parse(strategy.source.when))).toBe(false)
      expect(strategy.source.id).not.toBe('')
    }
    const pmids = STRATEGIES.map((strategy) => strategy.source.pmid)
    expect(new Set(pmids).size).toBe(pmids.length)
    const documentIds = STRATEGIES.map((strategy) => strategy.source.id)
    expect(new Set(documentIds).size).toBe(documentIds.length)
  })

  test('each carries an interval that brackets its own point estimate', () => {
    for (const strategy of STRATEGIES) {
      const { ratio, interval, per } = strategy.effect
      expect(interval.level).toBe(0.95)
      expect(interval.low).toBeLessThanOrEqual(ratio)
      expect(ratio).toBeLessThanOrEqual(interval.high)
      expect(interval.low).toBeGreaterThan(0)
      expect(per).not.toBe('')
    }
  })

  test('every interval and ratio is the published one, quoted from the abstract', () => {
    // The numbers a reviewer re-reads in PubMed. A transcription error is one line to fix and
    // impossible to notice in a demo, so the table is pinned here.
    const published = Object.fromEntries(
      STRATEGIES.map((strategy) => [strategy.id, [strategy.source.pmid, strategy.effect.ratio, strategy.effect.interval.low, strategy.effect.interval.high]]),
    )
    expect(published).toEqual({
      'statin-ldl': ['21067804', 0.78, 0.76, 0.8],
      'quit-smoking': ['31429895', 0.61, 0.49, 0.76],
      'colonoscopy-screening': ['36214590', 0.82, 0.7, 0.93],
      'intensive-hba1c': ['22115901', 0.88, 0.79, 0.97],
      'bp-lowering': ['26724178', 0.8, 0.77, 0.83],
    })
  })

  test('each says what it does not cover, and the scale is a log relative risk', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.limits.length).toBeGreaterThan(0)
      expect(strategy.limits.some((limit) => limit.trim() === '')).toBe(false)
      expect(strategy.scale).toMatch(/^[a-z-]+-log-rr\/1$/)
      expect(strategy.confidence).toBeGreaterThan(0)
      expect(strategy.confidence).toBeLessThanOrEqual(1)
    }
  })

  test('one scale per outcome: statin and blood pressure share one, the rest have their own', () => {
    const scales = STRATEGIES.map((strategy) => strategy.scale)
    expect(scales.filter((scale) => scale === SCALE.mve).length).toBe(2)
    expect([SCALE.cvd, SCALE.crc, SCALE.microvascular].every((scale) => scales.filter((s) => s === scale).length === 1)).toBe(true)
    expect(SCALE.mve).toBe('mve-log-rr/1')
    expect(SCALE.crc).toBe('crc-log-rr/1')
  })
})

describe('loadStrategies refuses what the card refuses', () => {
  test('the shipped set loads', () => {
    expect(problemsOf(clone())).toEqual([])
  })

  test('a strategy without a PMID does not load', () => {
    const set = clone()
    delete (set[0].source as Record<string, unknown>).pmid
    const problems = problemsOf(set)
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('source.pmid: missing PMID')
  })

  test('a PMID that is not a PubMed id is refused', () => {
    const set = clone()
    ;(set[0].source as Record<string, unknown>).pmid = 'PMID:21067804'
    expect(problemsOf(set)[0]).toContain('is not a PubMed id')
  })

  test('a point estimate outside its own interval is refused', () => {
    const set = clone()
    ;(set[0].effect as Record<string, unknown>).ratio = 0.9
    expect(problemsOf(set)[0]).toContain('outside its own interval')
  })

  test('an interval whose level is not between 0 and 1 is refused', () => {
    const set = clone()
    ;((set[1].effect as Record<string, unknown>).interval as Record<string, unknown>).level = 1.2
    expect(problemsOf(set)[0]).toContain('interval.level')
  })

  test('a ratio with no `per` is refused: a relative risk is per something', () => {
    const set = clone()
    delete (set[2].effect as Record<string, unknown>).per
    expect(problemsOf(set)[0]).toContain('effect.per: missing per')
  })

  test('a condition the rules engine would refuse is refused here first', () => {
    const set = clone()
    set[0].when = { fact: 'on_statin', op: 'eq', value: true, because: 'the doctor said so' }
    expect(problemsOf(set).some((problem) => problem.includes('when'))).toBe(true)
  })

  test('a target that is not a condition or an observation is refused', () => {
    const set = clone()
    set[0].target = 'prediction'
    expect(problemsOf(set)[0]).toContain('target: must be "observation" or "condition"')
  })

  test('a scale that is not a log relative risk is refused', () => {
    const set = clone()
    set[0].scale = 'mve/1'
    expect(problemsOf(set)[0]).toContain('not a log relative risk')
  })

  test('a strategy with no limits is refused: the limits travel with the number', () => {
    const set = clone()
    set[3].limits = []
    expect(problemsOf(set)[0]).toContain('limits')
  })

  test('a duplicate id is refused, and every problem is named in one run', () => {
    const set = clone()
    set[1].id = set[0].id
    delete (set[4].source as Record<string, unknown>).citation
    const problems = problemsOf(set)
    expect(problems.length).toBeGreaterThanOrEqual(2)
    expect(problems.some((problem) => problem.includes('duplicate strategy id'))).toBe(true)
    expect(problems.some((problem) => problem.includes('source.citation'))).toBe(true)
  })

  test('a set that is not an array is refused', () => {
    expect(problemsOf({ strategies: [] })).toEqual(['strategies: an array of strategy objects'])
  })
})

describe('materialise: a strategy is a template until somebody places it', () => {
  test('builds one document, one prediction and one projected edge per strategy', () => {
    const plan = materialise(PLACEMENTS)
    expect(plan.documents.length).toBe(5)
    expect(plan.predictions.length).toBe(5)
    expect(plan.edges.length).toBe(5)
    expect(plan.rows.map((row) => row.strategy)).toEqual(STRATEGIES.map((strategy) => strategy.id))
  })

  test('the delta is the log of the published ratio, and the prediction carries no date of its own', () => {
    const plan = materialise(PLACEMENTS)
    for (const strategy of STRATEGIES) {
      const node = plan.predictions.find((prediction) => prediction.id === `pred-${strategy.id}`)
      expect(node).toBeDefined()
      expect(node?.delta_median).toBe(Math.log(strategy.effect.ratio))
      expect(node?.when).toBeUndefined()
      expect(node?.horizon).toBe(PLACEMENTS[strategy.id as keyof typeof PLACEMENTS].horizon)
      expect(node?.confirmed).toBe(false)
      expect(node?.source).toBe(strategy.source.id)
    }
  })

  test('the paper is written once, with its PMID and its interval', () => {
    const plan = materialise(PLACEMENTS)
    const ctt = plan.documents.find((document) => document.id === 'src-ctt-2010')
    expect(ctt?.kind).toBe('document')
    expect(ctt?.pmid).toBe('21067804')
    expect(ctt?.when).toBe('2010-11-13')
    expect(ctt?.effect).toEqual({
      outcome: 'major vascular events',
      measure: 'rate ratio',
      ratio: 0.78,
      interval: { level: 0.95, low: 0.76, high: 0.8 },
      per: '1.0 mmol/L lower LDL cholesterol',
    })
  })

  test('an unplaced strategy is refused, and so is a placement for a strategy that does not exist', () => {
    const missing = { ...PLACEMENTS } as Record<string, unknown>
    delete missing['bp-lowering']
    expect(() => materialise(missing)).toThrow(/placements\.bp-lowering: missing/)

    expect(() => materialise({ ...PLACEMENTS, 'take-vitamins': { target: 'x', horizon: '2031-11-12' } })).toThrow(
      /no built-in strategy has that id/,
    )
  })

  test('a horizon before the paper was printed is refused', () => {
    expect(() =>
      materialise({ ...PLACEMENTS, 'statin-ldl': { target: 'obs-ldl', horizon: '2009-01-01' } }),
    ).toThrow(/before 2010-11-13/)
  })

  test('a horizon that is not a calendar date, or a missing target, is refused', () => {
    expect(() => materialise({ ...PLACEMENTS, 'statin-ldl': { target: 'obs-ldl', horizon: '2031-02-30' } })).toThrow(
      /must be a date, YYYY-MM-DD/,
    )
    expect(() => materialise({ ...PLACEMENTS, 'statin-ldl': { target: '  ', horizon: '2031-11-12' } })).toThrow(
      /placements\.statin-ldl\.target: missing/,
    )
  })

  test('the same placements produce the same bytes twice', () => {
    const first = JSON.stringify(materialise(PLACEMENTS))
    const second = JSON.stringify(materialise(PLACEMENTS))
    expect(second).toBe(first)
  })
})

describe('gateStrategies: one call per scale, so two outcomes never share a sum', () => {
  test('every condition met: five forecasts move, grouped into four scales', () => {
    const gates = gateStrategies(materialise(PLACEMENTS), ALL_MET)
    expect(gates.map((gate) => gate.scale)).toEqual([SCALE.crc, SCALE.cvd, SCALE.microvascular, SCALE.mve])
    expect(gates.every((gate) => gate.gate.withheld.length === 0)).toBe(true)
    expect(gates.reduce((count, gate) => count + gate.gate.applied.length, 0)).toBe(5)

    const mve = gates.find((gate) => gate.scale === SCALE.mve)
    expect(mve?.gate.applied.map((row) => row.id)).toEqual(['pred-bp-lowering', 'pred-statin-ldl'])
  })

  test('two strategies on one outcome add as logs, which is their ratios multiplied', () => {
    const gates = gateStrategies(materialise(PLACEMENTS), ALL_MET)
    const mve = gates.find((gate) => gate.scale === SCALE.mve)
    expect(mve?.ratio).toBeCloseTo(0.78 * 0.8, 12)
    const crc = gates.find((gate) => gate.scale === SCALE.crc)
    expect(crc?.ratio).toBeCloseTo(0.82, 12)
  })

  test('a fact we do not have withholds the forecast as unknown, and the sum does not move', () => {
    const gates = gateStrategies(materialise(PLACEMENTS), { on_statin: true })
    const total = gates.reduce((count, gate) => count + gate.gate.applied.length, 0)
    expect(total).toBe(1)
    for (const { gate } of gates) {
      for (const row of gate.withheld) {
        expect(row.verdict).toBe('unknown')
        expect(row.reason).toBe('missing-fact')
      }
    }
    const smoking = gates.find((gate) => gate.scale === SCALE.cvd)
    expect(smoking?.gate.delta).toBe(0)
    expect(smoking?.ratio).toBe(1)
  })

  test('a fact of the wrong type is unknown, not met and not unmet', () => {
    const gates = gateStrategies(materialise(PLACEMENTS), { on_statin: 'yes' })
    const statin = gates.find((gate) => gate.scale === SCALE.mve)?.gate.withheld.find((row) => row.id === 'pred-statin-ldl')
    expect(statin?.verdict).toBe('unknown')
    expect(statin?.reason).toBe('type-mismatch')
  })

  test('a condition that is known and false is unmet, which is not the same as unknown', () => {
    const gates = gateStrategies(materialise(PLACEMENTS), { ...ALL_MET, current_smoker: true })
    const smoking = gates.find((gate) => gate.scale === SCALE.cvd)?.gate.withheld.find((row) => row.id === 'pred-quit-smoking')
    expect(smoking?.verdict).toBe('unmet')
    expect(smoking?.reason).toBe('no-match')
  })

  test('a never-smoker does not get the quitting forecast met: both facts have to hold', () => {
    const gates = gateStrategies(materialise(PLACEMENTS), { ...ALL_MET, ever_smoked: false })
    const smoking = gates.find((gate) => gate.scale === SCALE.cvd)?.gate.withheld.find((row) => row.id === 'pred-quit-smoking')
    expect(smoking?.verdict).toBe('unmet')
  })
})
