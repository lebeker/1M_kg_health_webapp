/**
 * The explanation's contract, held as properties rather than as examples.
 *
 * The card is one sentence — every estimate change has a Δ, a cause, and a source link — and the
 * failure each test exists for:
 *
 *   1. a change with no cause: a number that moved and no row saying what moved it;
 *   2. a cause with no link: "see Smith 2020" printed as if a reader could follow it;
 *   3. rows that do not add up to the number above them — the one thing an explanation of an
 *      estimate must never do, because the whole point is that the reader can check it;
 *   4. a scale mixed into another: a coefficient model printed as a sum, or a Δ added to a number
 *      whose scale it does not name;
 *   5. a guess: a fact that went missing read as "the deficit is gone".
 *
 *   bun test src/explain.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExplainError, type RuleDriver, explainRules, explainScore2, sourceLink } from './explain'
import { LEE_RULES, lee } from './lee'
import { type Facts, type RuleSet, RuleError, applyRules, loadRules } from './rules'
import { SCORE2, type Region, Score2Error, calibrate, inputFromFacts, score2 } from './score2'

const FIXTURES = 'tests/fixtures/explain'
const RULE_FIXTURES = 'tests/fixtures/rules'
const SCORE2_FIXTURES = 'tests/fixtures/score2'
const read = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'))

/** A fixture explains itself in a `note`; a model reads facts, so prose never reaches it. */
function factsOf(raw: unknown): Facts {
  const record = { ...(raw as Record<string, unknown>) }
  delete record.note
  return record as Facts
}

const leeBefore = (): Facts => factsOf(read(FIXTURES, 'lee-before.json'))
const leeAfter = (): Facts => factsOf(read(FIXTURES, 'lee-after.json'))
const score2Before = (): ReturnType<typeof inputFromFacts> => inputFromFacts(read(FIXTURES, 'score2-before.json'))
const score2After = (): ReturnType<typeof inputFromFacts> => inputFromFacts(read(FIXTURES, 'score2-after.json'))

const explainLee = (before = leeBefore(), after = leeAfter()): ReturnType<typeof explainRules> =>
  explainRules(LEE_RULES, { unit: 'points', before, after })

/** The refusal, as one string: what a reader of the error would see. */
function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof ExplainError) return error.message
    return `not an ExplainError: ${String(error)}`
  }
  return ''
}

/** A refusal from the engine's door rather than the explanation's, kept apart for the tests. */
function notThrown(run: () => unknown): unknown {
  try {
    return run()
  } catch (error) {
    return error
  }
}

describe('a citation as a link a reader can open', () => {
  test('a PMID, in the forms the rule files use', () => {
    expect(sourceLink('PMID:16478903')).toBe('https://pubmed.ncbi.nlm.nih.gov/16478903/')
    expect(sourceLink('pmid:16478903')).toBe('https://pubmed.ncbi.nlm.nih.gov/16478903/')
    expect(sourceLink('  16478903  ')).toBe('https://pubmed.ncbi.nlm.nih.gov/16478903/')
  })

  test('a DOI, bare or behind its prefix', () => {
    expect(sourceLink('10.1001/jama.295.7.801')).toBe('https://doi.org/10.1001/jama.295.7.801')
    expect(sourceLink('doi:10.1093/eurheartj/ehab309')).toBe('https://doi.org/10.1093/eurheartj/ehab309')
  })

  test('a URL is already one', () => {
    expect(sourceLink('https://heartscore.escardio.org/')).toBe('https://heartscore.escardio.org/')
  })

  // The failure this test exists for: a rule whose source is prose. It is not a citation, and an
  // explanation that prints it is claiming a place the reader cannot go.
  test('prose and fixture ids are not links', () => {
    expect(sourceLink('synthetic:demo-sex')).toBeNull()
    expect(sourceLink('Smith 2020')).toBeNull()
    expect(sourceLink('JAMA 2006;295(7):801')).toBeNull()
    expect(sourceLink('')).toBeNull()
  })
})

describe('a change of the Lee index, explained row by row', () => {
  test('the two numbers and the change between them', () => {
    const explanation = explainLee()
    expect(explanation.model).toBe('rules')
    expect(explanation.scale).toBe('lee-4y-points/1')
    expect(explanation.unit).toBe('points')
    expect(explanation.before.value).toBe(8)
    expect(explanation.after.value).toBe(11)
    expect(explanation.change).toBe(3)
    // The index itself, from the model that owns it — not a second implementation in this file.
    expect(lee(leeBefore()).points).toBe(8)
    expect(lee(leeAfter()).points).toBe(11)
  })

  test('one row per rule that started or stopped, with the fact that changed', () => {
    const explanation = explainLee()
    const rows = explanation.drivers.map((driver) => [driver.cause, driver.delta, driver.kind])
    expect(rows).toEqual([
      ['age_65_69', -2, 'stopped'],
      ['age_70_74', 3, 'started'],
      ['cancer', 2, 'started'],
      ['current_smoker', -2, 'stopped'],
      ['difficulty_bathing', 2, 'started'],
    ])
    const cancer = explanation.drivers.find((driver) => driver.cause === 'cancer') as RuleDriver
    expect(cancer.evidence).toEqual([{ fact: 'cancer', before: false, after: true }])
    // A rule that no longer fires says why, so "no longer fires" is not read as "no longer true".
    const smoker = explanation.drivers.find((driver) => driver.cause === 'current_smoker') as RuleDriver
    expect(smoker.reason).toBe('no-match')
  })

  test('every row carries a source and a link a reader can open', () => {
    for (const driver of explainLee().drivers) {
      expect(driver.source).toBe('PMID:16478903')
      expect(driver.link).toBe('https://pubmed.ncbi.nlm.nih.gov/16478903/')
      expect(driver.confidence).toBe(1)
    }
  })

  test('the rows add up to the change', () => {
    const explanation = explainLee()
    const sum = explanation.drivers.reduce((total, driver) => total + driver.delta, 0)
    expect(sum).toBe(explanation.change)
    expect(explanation.after.value - explanation.before.value).toBe(explanation.change)
  })

  test('rules that fired at both dates are named but are not rows', () => {
    expect(explainLee().unchanged).toEqual(['bmi_under_25', 'diabetes', 'sex_male'])
  })

  test('the same two dates give the same rows, whatever order the facts are written in', () => {
    const straight = JSON.stringify(explainLee())
    expect(JSON.stringify(explainLee())).toBe(straight)
    const reversed = Object.fromEntries(Object.entries(leeAfter()).reverse())
    expect(JSON.stringify(explainLee(leeBefore(), reversed))).toBe(straight)
  })

  test('nothing changed: no rows, and every fired rule is unchanged', () => {
    const explanation = explainLee(leeBefore(), leeBefore())
    expect(explanation.change).toBe(0)
    expect(explanation.drivers).toEqual([])
    expect(explanation.unchanged.length).toBe(explanation.before.fired)
  })
})

describe('what the explanation refuses to print', () => {
  // The card's third promise, at its own door: a rule whose source is `synthetic:demo-sex` moves
  // the estimate between these two dates and cannot be cited.
  test('a cause with no link refuses the whole explanation', () => {
    const set = loadRules(read(RULE_FIXTURES, 'synthetic.json')) as RuleSet
    const before: Facts = { 'demo.sex': 'male', 'demo.age': 61, 'demo.flag': 'high' }
    const after: Facts = { 'demo.sex': 'male', 'demo.age': 61, 'demo.flag': 'high', 'demo.condition': true }

    const message = refusal(() => explainRules(set, { unit: 'units', before, after }))
    expect(message).toContain('"demo-existing-condition"')
    expect(message).toContain('synthetic:demo-presence')
    expect(message).toContain('is not a link')
  })

  test('a delta with no unit is not a quantity', () => {
    const message = refusal(() => explainRules(LEE_RULES, { unit: '  ', before: leeBefore(), after: leeAfter() }))
    expect(message).toContain('comparison.unit')
    expect(message).toContain('a delta with no unit is not a quantity')
  })

  // The engine's refusals are not swallowed and not relabelled: a caller has to be able to tell a
  // rule set that will not load from a pair of dates that cannot be compared.
  test('a rule set the engine refuses is the engine\'s error, not this file\'s', () => {
    const broken = {
      version: 'lee-4y-points/1',
      rules: [{ id: 'cancer', when: { fact: 'cancer', op: 'eq', value: true }, delta: 2, confidence: 1 }],
    }
    const caught = notThrown(() => explainRules(broken as RuleSet, { unit: 'points', before: leeBefore(), after: leeAfter() }))
    expect(caught).toBeInstanceOf(RuleError)
    expect(String(caught)).toContain('a rule without source does not load')
  })
})

describe('a missing fact is not a missing deficit', () => {
  // The engine's rule: a fact that is not supplied is not `false`. The explanation has to say that
  // out loud, or the reader reads a lost point as a recovered person.
  test('a rule that stops firing because its fact went missing says so', () => {
    // Cancer was recorded at the earlier date and is not supplied at the later one. The engine will
    // not score it, and the explanation must not report that as a person who recovered.
    const before = { ...leeBefore(), cancer: true }
    const after = leeAfter()
    delete after.cancer
    const explanation = explainLee(before, after)
    const row = explanation.drivers.find((driver) => driver.cause === 'cancer') as RuleDriver
    expect(row.kind).toBe('stopped')
    expect(row.reason).toBe('missing-fact')
    expect(row.delta).toBe(-2)
    expect(row.evidence).toEqual([{ fact: 'cancer', before: true, after: null }])
    // 10 points at the earlier date, 9 at the later: the lost point is the missing fact, and the
    // row says it is a missing fact rather than an absent deficit.
    expect(explanation.change).toBe(explanation.after.value - explanation.before.value)
    expect(explanation.change).toBe(-1)
  })
})

describe('a change of SCORE2 risk, explained term by term', () => {
  test('the two numbers and the change the reader is looking at', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2After(), region: 'high' })
    expect(explanation.model).toBe('SCORE2')
    expect(explanation.scale).toBe('score2-10y/1')
    expect(explanation.region).toBe('high')
    expect(explanation.before.risk).toBe(score2(score2Before(), 'high').risk)
    expect(explanation.after.risk).toBe(score2(score2After(), 'high').risk)
    expect(Math.abs(explanation.change - (explanation.after.risk - explanation.before.risk))).toBeLessThan(1.1e-3)
  })

  test('one row per term that moved, in the published table order', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2After(), region: 'high' })
    expect(explanation.drivers.map((driver) => driver.cause)).toEqual([
      'age',
      'smoking',
      'systolic_bp',
      'total_cholesterol',
      'hdl_cholesterol',
      'age_x_smoking',
      'age_x_systolic_bp',
      'age_x_total_cholesterol',
      'age_x_hdl_cholesterol',
    ])
    // The rows are the paper's table, not a sort of convenience.
    const table = SCORE2.models.male.coefficients.map((coefficient) => coefficient.name)
    const order = explanation.drivers.map((driver) => table.indexOf(driver.cause))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  test('two sums: the percentage points a reader asked for, and the log-hazard a reviewer checks', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2After(), region: 'high' })
    const pp = explanation.drivers.reduce((total, driver) => total + driver.delta, 0)
    const logHr = explanation.drivers.reduce((total, driver) => total + driver.logHrDelta, 0)
    expect(Math.abs(pp - explanation.change)).toBeLessThan(1e-9)
    expect(Math.abs(logHr - explanation.linearPredictorChange)).toBeLessThan(1e-12)
    for (const driver of explanation.drivers) {
      expect(driver.hazardRatio).toBeCloseTo(Math.exp(driver.logHrDelta), 12)
      expect(driver.source).toContain('Suppl. Table 2')
      expect(driver.source).toContain(driver.cause)
      expect(driver.link).toBe('https://doi.org/10.1093/eurheartj/ehab309')
      expect(driver.evidence.length).toBeGreaterThan(0)
    }
  })

  // The split is only honest if each row is really the step it claims to be, so this walks the
  // predictors again through the model's own `calibrate` and compares row for row.
  test('each row is the step from the previous linear predictor, recomputed independently', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2After(), region: 'high' })
    const risk = (lp: number): number => calibrate(lp, 'male', 'high').calibrated * 100
    let running = explanation.before.linearPredictor
    let previous = risk(explanation.before.linearPredictor)
    for (const driver of explanation.drivers) {
      running += driver.logHrDelta
      expect(driver.delta).toBeCloseTo(risk(running) - previous, 12)
      previous = risk(running)
    }
    expect(Math.abs(running - explanation.after.linearPredictor)).toBeLessThan(1e-6)
  })

  test('the facts behind each row are named, and the interactions name both', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2After(), region: 'high' })
    const byCause = new Map(explanation.drivers.map((driver) => [driver.cause, driver]))
    expect(byCause.get('age')?.evidence).toEqual([{ fact: 'age', before: 50, after: 60 }])
    expect(byCause.get('smoking')?.evidence).toEqual([{ fact: 'current_smoker', before: true, after: false }])
    expect(byCause.get('age_x_smoking')?.evidence).toEqual([
      { fact: 'age', before: 50, after: 60 },
      { fact: 'current_smoker', before: true, after: false },
    ])
  })

  test('the rows say how they were cut, and the model\'s limits travel with them', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2After(), region: 'high' })
    expect(explanation.method).toContain('sequential split')
    expect(explanation.method).toContain('Table 2 order')
    expect(explanation.limits.some((line) => line.includes('depends on the order'))).toBe(true)
    // Every limit the number carries is still there: an explanation does not get to drop one.
    for (const limit of score2(score2After(), 'high').limits) {
      expect(explanation.limits).toContain(limit)
    }
  })

  test('the same inputs give the same rows, bit for bit', () => {
    const once = JSON.stringify(explainScore2({ before: score2Before(), after: score2After(), region: 'high' }))
    const twice = JSON.stringify(explainScore2({ before: score2Before(), after: score2After(), region: 'high' }))
    expect(twice).toBe(once)
  })

  test('nothing changed: no rows, and every term is unchanged — including the zeroed ones', () => {
    const explanation = explainScore2({ before: score2Before(), after: score2Before(), region: 'high' })
    expect(explanation.change).toBe(0)
    expect(explanation.drivers).toEqual([])
    expect(explanation.unchanged.length).toBe(SCORE2.models.male.coefficients.length)
  })

  // Two sex-specific models: a change of sex is a change of model, and the difference between two
  // models is not a change in an estimate.
  test('a change of model is refused, not explained', () => {
    const message = refusal(() =>
      explainScore2({ before: score2Before(), after: { ...score2After(), sex: 'female' }, region: 'high' }),
    )
    expect(message).toContain('two sex-specific models')
  })

  test('an input the model refuses is the model\'s refusal, not a row', () => {
    const caught = notThrown(() =>
      explainScore2({ before: score2Before(), after: { ...score2After(), age: 30 }, region: 'high' }),
    )
    expect(caught).toBeInstanceOf(Score2Error)
  })
})

describe('calibrate: the explanation and the number evaluate one function', () => {
  // The reason `calibrate` is exported at all. If these ever disagree, an explanation could walk
  // through linear predictors that the number it explains never visited.
  const fixtures = ['profile-a-male-50-smoker.json', 'profile-b-female-50-smoker.json', 'profile-c-male-65-high.json']
  const regions: Region[] = ['low', 'moderate', 'high', 'very_high']

  test('every published profile, in every region', () => {
    for (const name of fixtures) {
      const input = inputFromFacts(read(SCORE2_FIXTURES, name))
      for (const region of regions) {
        const risk = score2(input, region)
        const linearPredictor = risk.terms.reduce((sum, term) => sum + term.contribution, 0)
        expect(calibrate(linearPredictor, input.sex, region).calibrated * 100).toBeCloseTo(risk.risk, 2)
      }
    }
  })

  test('a linear predictor the paper never charted is still refused', () => {
    expect(() => calibrate(40, 'male', 'high')).toThrow(Score2Error)
  })
})

describe('a facts file as the model\'s input', () => {
  test('the document\'s names become the model\'s, and the note is prose', () => {
    expect(inputFromFacts({ note: 'prose', age: 50, sex: 'male', current_smoker: true, systolic_bp: 140 })).toEqual({
      age: 50,
      sex: 'male',
      currentSmoker: true,
      systolicBp: 140,
    })
  })

  // A typo has to reach the model's own refusal: dropped here, `hdl` would read as a missing HDL,
  // which is a different and much quieter failure.
  test('an unknown key is passed through so the model can name it', () => {
    const input = inputFromFacts({ note: 'prose', age: 50, sex: 'male', hdl: 1.4 })
    expect(input).toHaveProperty('hdl', 1.4)
    expect(String(notThrown(() => score2(input, 'high')))).toContain('input.hdl')
  })

  test('a facts file that is not an object is refused', () => {
    expect(() => inputFromFacts([1, 2, 3])).toThrow(Score2Error)
  })
})

describe('the explanation and the estimate agree on the same rules', () => {
  // A property rather than an example: whichever pair of fact records is compared, the rows the
  // explanation prints are the rules the engine applied, and their sum is the engine's change.
  test('for every pair of Lee fixtures', () => {
    const records = [leeBefore(), leeAfter()]
    for (const before of records) {
      for (const after of records) {
        const explanation = explainRules(LEE_RULES, { unit: 'points', before, after })
        const engineChange = applyRules(LEE_RULES, after).value - applyRules(LEE_RULES, before).value
        expect(explanation.change).toBe(engineChange)
        expect(explanation.drivers.reduce((sum, driver) => sum + driver.delta, 0)).toBe(engineChange)
        // No rule may be in two states at once, and no row may be a rule that did not change.
        for (const driver of explanation.drivers) {
          expect(explanation.unchanged).not.toContain(driver.cause)
        }
      }
    }
  })
})
