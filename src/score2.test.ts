/**
 * SCORE2 against the numbers the paper published, not against itself.
 *
 * A risk model is a claim about the world, so the tests that matter are the ones that can fail
 * because the arithmetic is wrong. Three profiles are held to numbers somebody else printed:
 *
 *   1. Supplementary Methods Table 4, a 50-year-old man who smokes (SBP 140, total cholesterol
 *      6.3 mmol/L, HDL 1.4) — uncalibrated 5.41%, and one recalibrated value per region;
 *   2. the same person as a woman — uncalibrated 3.32%, four regions;
 *   3. a 65-year-old man with different risk factors, against the ESC's own calculator
 *      (heartscore.org, high-risk region, 14% — it prints whole percent, so the tolerance is half
 *      a point; this model computes 14.21%).
 *
 * Everything else here is a property the model has to keep after any refactor: the interval
 * brackets the number, the region can only move the number in one direction, a risk factor can
 * only move it in one direction, and an input that is missing is refused instead of defaulted.
 * The last block pins the published tables themselves, because a typo in a coefficient is exactly
 * the bug these tests exist for.
 *
 *   bun test src/score2.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGE_MAX,
  AGE_MIN,
  REGIONS,
  SCORE2,
  Score2Error,
  type Score2Input,
  type Region,
  VERSION,
  score2,
} from './score2'

const FIXTURES = 'tests/fixtures/score2'
const profile = (name: string): Score2Input => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
  return {
    age: raw.age as number,
    sex: raw.sex as Score2Input['sex'],
    currentSmoker: raw.current_smoker as boolean,
    systolicBp: raw.systolic_bp as number,
    totalCholesterol: raw.total_cholesterol as number,
    hdlCholesterol: raw.hdl_cholesterol as number,
  }
}

const MAN_50 = profile('profile-a-male-50-smoker.json')
const WOMAN_50 = profile('profile-b-female-50-smoker.json')
const MAN_65 = profile('profile-c-male-65-high.json')

/** The refusal, as one string: what a reader of the error would see. */
function refusal(input: unknown, region: unknown): string {
  try {
    score2(input as Score2Input, region as Region)
  } catch (error) {
    return error instanceof Score2Error ? error.message : `not a Score2Error: ${String(error)}`
  }
  return ''
}

/** A person, with one field changed. */
const withField = (base: Score2Input, change: Partial<Score2Input>): Score2Input => ({ ...base, ...change })

describe('the three known profiles', () => {
  test('Table 4: a 50-year-old man who smokes, uncalibrated and in all four regions', () => {
    const uncalibrated = score2(MAN_50, 'moderate').uncalibrated
    expect(uncalibrated).toBeCloseTo(5.41, 1)

    const published: Array<[Region, number]> = [
      ['low', 6.31],
      ['moderate', 8.11],
      ['high', 8.81],
      ['very_high', 15.06],
    ]
    for (const [region, expected] of published) {
      expect(score2(MAN_50, region).risk).toBeCloseTo(expected, 1)
    }
  })

  test('Table 4: the same risk factors in a 50-year-old woman', () => {
    expect(score2(WOMAN_50, 'moderate').uncalibrated).toBeCloseTo(3.32, 1)

    const published: Array<[Region, number]> = [
      ['low', 4.34],
      ['moderate', 5.23],
      ['high', 7.13],
      ['very_high', 14.14],
    ]
    for (const [region, expected] of published) {
      expect(score2(WOMAN_50, region).risk).toBeCloseTo(expected, 1)
    }
  })

  test('a 65-year-old man against the ESC calculator: 14% in the high-risk region', () => {
    // The calculator prints whole percent; our exact value is asserted on the next line so the
    // test fails loudly (not by a tenth of a point) if the model moves.
    const risk = score2(MAN_65, 'high').risk
    expect(Math.abs(risk - 14)).toBeLessThanOrEqual(0.5)
    expect(risk).toBeCloseTo(14.21, 1)
  })

  test('the published examples are also pinned to three decimals, so a refactor cannot drift', () => {
    expect([score2(MAN_50, 'low').risk, score2(MAN_50, 'moderate').risk]).toEqual([6.314, 8.107])
    expect([score2(MAN_50, 'high').risk, score2(MAN_50, 'very_high').risk]).toEqual([8.809, 15.058])
    expect([score2(WOMAN_50, 'low').risk, score2(WOMAN_50, 'moderate').risk]).toEqual([4.332, 5.227])
    expect([score2(WOMAN_50, 'high').risk, score2(WOMAN_50, 'very_high').risk]).toEqual([7.126, 14.127])
  })
})

describe('what the number says about itself', () => {
  test('it names the scale it is on and the model it came from', () => {
    const risk = score2(MAN_50, 'high')
    expect(risk.model).toBe('SCORE2')
    expect(risk.version).toBe('score2-10y/1')
    expect(risk.version).toBe(VERSION)
    expect(risk.region).toBe('high')
  })

  test('the interval brackets the number, at 95%, and stays inside 0–100', () => {
    for (const person of [MAN_50, WOMAN_50, MAN_65]) {
      for (const region of REGIONS) {
        const risk = score2(person, region)
        expect(risk.interval.level).toBe(0.95)
        expect(risk.interval.low).toBeLessThan(risk.risk)
        expect(risk.interval.high).toBeGreaterThan(risk.risk)
        expect(risk.interval.low).toBeGreaterThan(0)
        expect(risk.interval.high).toBeLessThan(100)
      }
    }
  })

  test('what it does not know travels with it: diabetes, the target population, the age range, the chart ranges, the interval', () => {
    const limits = score2(MAN_50, 'low').limits.join('\n')
    expect(limits).toContain('diabetes')
    expect(limits).toContain('40–69')
    expect(limits).toContain('extrapolation')
    expect(limits).toContain('interval covers')
  })

  test('the arithmetic is printed term by term, and adds up to the linear predictor', () => {
    const risk = score2(MAN_65, 'high')
    const summed = risk.terms.reduce((sum, term) => sum + term.contribution, 0)
    expect(summed).toBeCloseTo(risk.linearPredictor, 6)
    expect(risk.linearPredictor).toBeCloseTo(0.86519, 5)
    // Table 4's linear predictor for the 50-year-old man, printed as 0.3221.
    expect(score2(MAN_50, 'low').linearPredictor).toBeCloseTo(0.3221, 4)
    expect(score2(WOMAN_50, 'low').linearPredictor).toBeCloseTo(0.39788, 4)
  })

  test('the same person, scored twice, gives the same bytes', () => {
    const first = JSON.stringify(score2(MAN_50, 'very_high'))
    const second = JSON.stringify(score2(MAN_50, 'very_high'))
    expect(second).toBe(first)
  })
})

describe('the signs of the model', () => {
  const base = score2(MAN_50, 'moderate').risk

  test('older is worse, and so are higher blood pressure and total cholesterol', () => {
    expect(score2(withField(MAN_50, { age: 60 }), 'moderate').risk).toBeGreaterThan(base)
    expect(score2(withField(MAN_50, { systolicBp: 160 }), 'moderate').risk).toBeGreaterThan(base)
    expect(score2(withField(MAN_50, { totalCholesterol: 7.3 }), 'moderate').risk).toBeGreaterThan(base)
  })

  test('a smoker is worse off than a non-smoker and a higher HDL is better', () => {
    expect(score2(withField(MAN_50, { currentSmoker: false }), 'moderate').risk).toBeLessThan(base)
    expect(score2(withField(MAN_50, { hdlCholesterol: 1.9 }), 'moderate').risk).toBeLessThan(base)
  })

  test('the regions are ordered: low < moderate < high < very high, for both sexes', () => {
    for (const person of [MAN_50, WOMAN_50]) {
      const risks = REGIONS.map((region) => score2(person, region).risk)
      expect(risks).toEqual([...risks].sort((a, b) => a - b))
      expect(new Set(risks).size).toBe(REGIONS.length)
    }
  })
})

describe('a missing fact is not a default', () => {
  test('every input is required, and the refusal names the one that is missing', () => {
    const missing: Array<keyof Score2Input> = [
      'age',
      'sex',
      'currentSmoker',
      'systolicBp',
      'totalCholesterol',
      'hdlCholesterol',
    ]
    for (const field of missing) {
      const partial = { ...MAN_50 } as Record<string, unknown>
      delete partial[field]
      expect(refusal(partial, 'high')).toContain(`input.${field}`)
    }
  })

  test('an unknown smoking status is not a non-smoker', () => {
    expect(refusal(withField(MAN_50, { currentSmoker: 'no' as unknown as boolean }), 'high')).toContain(
      'an unknown smoking status is not a non-smoker',
    )
  })

  test("the age range is the model's own, and the refusal points at the model that covers 70+", () => {
    expect(refusal(withField(MAN_50, { age: AGE_MIN - 1 }), 'high')).toContain('validated for 40–69')
    expect(refusal(withField(MAN_50, { age: AGE_MAX + 1 }), 'high')).toContain('SCORE2-OP')
    expect(refusal(withField(MAN_50, { age: 50.5 }), 'high')).toContain('whole number of years')
  })

  test('neither sex is guessed for a document that says neither', () => {
    expect(refusal(withField(MAN_50, { sex: 'other' as unknown as 'male' }), 'high')).toContain('two sex-specific models')
  })

  test('a number that is not a number, or not positive, is refused by name', () => {
    expect(refusal(withField(MAN_50, { systolicBp: '140' as unknown as number }), 'high')).toContain('input.systolicBp')
    expect(refusal(withField(MAN_50, { totalCholesterol: 0 }), 'high')).toContain('input.totalCholesterol')
    expect(refusal(withField(MAN_50, { hdlCholesterol: Number.NaN }), 'high')).toContain('input.hdlCholesterol')
  })

  test('an unknown key is refused rather than ignored: a typo is not a missing fact', () => {
    const typo = { ...MAN_50, hdl: 1.4 } as unknown as Score2Input
    expect(refusal(typo, 'high')).toContain('unknown key')
    expect(refusal(typo, 'high')).toContain('input.hdl')
  })

  test('there is no default region, and a region that is not one of the four is refused', () => {
    expect(refusal(MAN_50, undefined)).toContain('region: must be one of low, moderate, high, very_high')
    expect(refusal(MAN_50, 'Moderate')).toContain('region: must be one of')
  })

  test('an input so far outside the charts that the equation rounds to certain death is refused, not answered', () => {
    // Without the guard this returns 0%: the probability rounds to 1, the log-log step runs to
    // minus infinity, and a person at absurd risk is told they are safe.
    const message = refusal(withField(MAN_50, { systolicBp: 1e6 }), 'high')
    expect(message).toContain('not a number strictly between 0 and 1')
    expect(message).toContain('extrapolating')
  })
})

describe('the published tables, row by row', () => {
  test('the eleven coefficients of Table 2 are the ones the model computes with', () => {
    const expected: Record<'male' | 'female', Array<[string, number]>> = {
      male: [
        ['age', 0.3742],
        ['smoking', 0.6012],
        ['systolic_bp', 0.2777],
        ['total_cholesterol', 0.1458],
        ['hdl_cholesterol', -0.2698],
        ['diabetes', 0.6457],
        ['age_x_smoking', -0.0755],
        ['age_x_systolic_bp', -0.0255],
        ['age_x_total_cholesterol', -0.0281],
        ['age_x_hdl_cholesterol', 0.0426],
        ['age_x_diabetes', -0.0983],
      ],
      female: [
        ['age', 0.4648],
        ['smoking', 0.7744],
        ['systolic_bp', 0.3131],
        ['total_cholesterol', 0.1002],
        ['hdl_cholesterol', -0.2606],
        ['diabetes', 0.8096],
        ['age_x_smoking', -0.1088],
        ['age_x_systolic_bp', -0.0277],
        ['age_x_total_cholesterol', -0.0226],
        ['age_x_hdl_cholesterol', 0.0613],
        ['age_x_diabetes', -0.1272],
      ],
    }
    for (const sex of ['male', 'female'] as const) {
      expect(SCORE2.models[sex].coefficients.map((row) => [row.name, row.logHr])).toEqual(expected[sex])
      expect(SCORE2.models[sex].baselineSurvival).toBe(sex === 'male' ? 0.9605 : 0.9776)
      for (const row of SCORE2.models[sex].coefficients) expect(row.ci[0]).toBeLessThan(row.ci[1])
    }
  })

  test('the recalibration scales are Table 3, all four regions and both sexes', () => {
    expect(SCORE2.calibration).toEqual({
      male: {
        low: [-0.5699, 0.7476],
        moderate: [-0.1565, 0.8009],
        high: [0.3207, 0.936],
        very_high: [0.5836, 0.8294],
      },
      female: {
        low: [-0.738, 0.7019],
        moderate: [-0.3143, 0.7701],
        high: [0.571, 0.9369],
        very_high: [0.9412, 0.8329],
      },
    })
  })

  test('the diabetes rows are in the table and multiplied by zero: they cannot move a number', () => {
    const risk = score2({ ...MAN_50, age: 65 }, 'high')
    const zeros = risk.terms.filter((term) => term.name.includes('diabetes'))
    expect(zeros.map((term) => term.name)).toEqual(['diabetes', 'age_x_diabetes'])
    expect(zeros.every((term) => term.value === 0 && term.contribution === 0)).toBe(true)
  })
})
