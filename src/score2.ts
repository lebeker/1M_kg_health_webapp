/**
 * SCORE2 — the ESC's 10-year risk of fatal and non-fatal cardiovascular disease, for people aged
 * 40–69 in four European risk regions.
 *
 * Source: SCORE2 working group and ESC Cardiovascular Risk Collaboration, "SCORE2 risk prediction
 * algorithms: new models to estimate 10-year risk of cardiovascular disease in Europe",
 * Eur Heart J 2021;42(25):2439–2454, doi:10.1093/eurheartj/ehab309. Every number in `SCORE2` below
 * is copied from that paper's supplement, not re-estimated here:
 *
 *   - coefficients and baseline survival — Supplementary Methods Table 2 ("Model coefficients and
 *     baseline survival of the SCORE2 algorithm"), logged hazard ratios to four decimals;
 *   - regional recalibration scales — Supplementary Methods Table 3 ("Region and sex-specific
 *     recalibration scales"), intercept and slope;
 *   - 95% confidence intervals of the hazard ratios — Supplementary Table 7, used only for the
 *     interval (see below);
 *   - the worked examples the tests hold this file to — Supplementary Methods Table 4.
 *
 * The model. Two sex-specific Cox models with an age interaction on every predictor, and the age
 * of a person enters as `cage = (age - 60) / 5`. Risk is multiplicative in `exp(linear predictor)`,
 * so it is *not* a sum of independent deltas: no rule set can express it, which is why this card
 * ships a coefficient model and not a rule file (see docs/ARCHITECTURE.md §Estimates).
 *
 *   uncalibrated = 1 - S0 ^ exp(lp)                      S0: baseline survival, sex-specific
 *   calibrated   = 1 - exp(-exp(a + b·ln(-ln(1 - uncalibrated))))
 *
 * The second line is the paper's own recalibration step: it does not add a number, it moves the
 * whole risk scale of a region, which is why a region is an argument and not a default. A region
 * that is missing is not "moderate" — `score2()` refuses to print a number without one.
 *
 * What is deliberately not an input: diabetes. The published model carries a diabetes indicator
 * and an age interaction because the recalibration was fitted on whole populations, but Table 2's
 * footnote and the paper's discussion both say the indicator is set to zero for every individual
 * prediction and that SCORE2 is not for people with diabetes (SCORE2-Diabetes is a separate
 * algorithm). The two rows are in `coefficients` so the table matches the paper, and they are
 * multiplied by zero, so they cannot move a number.
 *
 * The interval. The paper publishes individual 95% confidence intervals for every hazard ratio
 * (Supplementary Table 7) but not the covariance between them, so the interval below is the
 * coefficient uncertainty propagated on the log-hazard scale with the coefficients treated as
 * independent, then carried through the recalibration slope. It is an interval on the model's own
 * estimates, not a prediction interval for a person, and it does not cover the recalibration
 * scales or the baseline survival — none of which is published with a standard error. The result
 * says so in `limits`, and the number is never printed without that sentence.
 *
 * What this file does not do: read a document, choose a region, guess a missing input. A missing
 * input is named and the estimate is refused, because "we do not know the HDL" and "HDL is 1.3"
 * are different people.
 */

/** SCORE2 is published as two sex-specific models. Nothing here interpolates between them. */
export type Sex = 'male' | 'female'

/** The four European risk regions of the 2021 ESC prevention guidelines. */
export type Region = 'low' | 'moderate' | 'high' | 'very_high'

export const REGIONS: readonly Region[] = ['low', 'moderate', 'high', 'very_high']

/** The ages the SCORE2 models were derived and validated for. Over 70 is SCORE2-OP, a different model. */
export const AGE_MIN = 40
export const AGE_MAX = 69

/** The scale every number from this file is on. It is what an explanation and a stored estimate name. */
export const VERSION = 'score2-10y/1'

/** Two-sided normal quantile for a 95% interval. */
const Z_95 = 1.959964

/** The eleven rows of Supplementary Methods Table 2, in the paper's order. */
export type TermName =
  | 'age'
  | 'smoking'
  | 'systolic_bp'
  | 'total_cholesterol'
  | 'hdl_cholesterol'
  | 'diabetes'
  | 'age_x_smoking'
  | 'age_x_systolic_bp'
  | 'age_x_total_cholesterol'
  | 'age_x_hdl_cholesterol'
  | 'age_x_diabetes'

export type Coefficient = { name: TermName; logHr: number; ci: readonly [number, number] }

type Model = { baselineSurvival: number; coefficients: readonly Coefficient[] }

/**
 * Coefficients, baseline survival and the recalibration scales, exactly as printed.
 *
 * A row not in `coefficients` is a row the model does not have; a row whose condition is not an
 * input is multiplied by zero in `transformed()`, never dropped from the table.
 */
export const SCORE2: {
  readonly version: string
  readonly models: Readonly<Record<Sex, Model>>
  readonly calibration: Readonly<Record<Sex, Readonly<Record<Region, readonly [number, number]>>>>
} = {
  version: VERSION,
  models: {
    male: {
      baselineSurvival: 0.9605,
      coefficients: [
        { name: 'age', logHr: 0.3742, ci: [1.43, 1.48] },
        { name: 'smoking', logHr: 0.6012, ci: [1.76, 1.89] },
        { name: 'systolic_bp', logHr: 0.2777, ci: [1.3, 1.34] },
        { name: 'total_cholesterol', logHr: 0.1458, ci: [1.14, 1.17] },
        { name: 'hdl_cholesterol', logHr: -0.2698, ci: [0.74, 0.78] },
        { name: 'diabetes', logHr: 0.6457, ci: [1.81, 2.01] },
        { name: 'age_x_smoking', logHr: -0.0755, ci: [0.91, 0.95] },
        { name: 'age_x_systolic_bp', logHr: -0.0255, ci: [0.97, 0.98] },
        { name: 'age_x_total_cholesterol', logHr: -0.0281, ci: [0.96, 0.98] },
        { name: 'age_x_hdl_cholesterol', logHr: 0.0426, ci: [1.03, 1.06] },
        { name: 'age_x_diabetes', logHr: -0.0983, ci: [0.88, 0.93] },
      ],
    },
    female: {
      baselineSurvival: 0.9776,
      coefficients: [
        { name: 'age', logHr: 0.4648, ci: [1.56, 1.62] },
        { name: 'smoking', logHr: 0.7744, ci: [2.07, 2.27] },
        { name: 'systolic_bp', logHr: 0.3131, ci: [1.34, 1.39] },
        { name: 'total_cholesterol', logHr: 0.1002, ci: [1.09, 1.12] },
        { name: 'hdl_cholesterol', logHr: -0.2606, ci: [0.75, 0.79] },
        { name: 'diabetes', logHr: 0.8096, ci: [2.11, 2.4] },
        { name: 'age_x_smoking', logHr: -0.1088, ci: [0.87, 0.92] },
        { name: 'age_x_systolic_bp', logHr: -0.0277, ci: [0.96, 0.98] },
        { name: 'age_x_total_cholesterol', logHr: -0.0226, ci: [0.97, 0.99] },
        { name: 'age_x_hdl_cholesterol', logHr: 0.0613, ci: [1.05, 1.08] },
        { name: 'age_x_diabetes', logHr: -0.1272, ci: [0.85, 0.91] },
      ],
    },
  },
  calibration: {
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
  },
}

/** What the model is given. Every field is a fact about a person, not an option. */
export type Score2Input = {
  /** Whole years, 40–69. */
  age: number
  sex: Sex
  currentSmoker: boolean
  /** Systolic blood pressure, mmHg. */
  systolicBp: number
  /** Total cholesterol, mmol/L. */
  totalCholesterol: number
  /** HDL cholesterol, mmol/L. */
  hdlCholesterol: number
}

/** One row of the arithmetic, so a reader can check the number without re-reading the paper. */
export type Score2Term = { name: TermName; value: number; logHr: number; contribution: number }

export type Score2Risk = {
  model: 'SCORE2'
  /** The scale this number is on, so it can never be summed with another scale's deltas. */
  version: string
  region: Region
  /** 10-year risk of fatal and non-fatal CVD, in percent (0–100). */
  risk: number
  /** The interval around `risk`, in percentage points, on the complementary log-log scale. */
  interval: { low: number; high: number; level: 0.95 }
  /** The same risk before the region's recalibration — shown, never used on its own. */
  uncalibrated: number
  linearPredictor: number
  linearPredictorSe: number
  /** Fired in Table 2's order; rows multiplied by zero are present with `contribution: 0`. */
  terms: readonly Score2Term[]
  /** What this number does not know. Travels with it wherever it is shown. */
  limits: readonly string[]
}

/** A refused input. Every problem, so one run names all of them. */
export class Score2Error extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'Score2Error'
    this.problems = problems
  }
}

const LIMITS: readonly string[] = [
  'the model sets the published diabetes indicator to zero: SCORE2 is not for people with diabetes, who have their own algorithm (SCORE2-Diabetes)',
  'people with previous cardiovascular disease, familial hypercholesterolaemia, chronic kidney disease, other rare lipid or blood-pressure disorders, or who are pregnant are outside the published target population',
  'ages 40–69 only: over 70 is SCORE2-OP, a different model with different coefficients',
  'the interval covers the uncertainty of the published hazard ratios only, with the coefficients treated as independent; it does not cover the recalibration scales, the baseline survival, or a person',
] as const

/**
 * The published 10-year risk, recalibrated to a region.
 *
 * Pure and deterministic: same input, same bytes. Nothing here reads the clock, the locale or
 * `Math.random`, and the order of the sum is the paper's table, not a caller's object.
 */
export function score2(input: Score2Input, region: Region): Score2Risk {
  const problems = inputProblems(input, region)
  if (problems.length > 0) throw new Score2Error(problems)

  const model = SCORE2.models[input.sex]
  const values = transformed(input)
  const terms: Score2Term[] = model.coefficients.map((coefficient) => ({
    name: coefficient.name,
    value: values[coefficient.name],
    logHr: coefficient.logHr,
    contribution: coefficient.logHr * values[coefficient.name],
  }))

  const linearPredictor = terms.reduce((sum, term) => sum + term.contribution, 0)
  // Marginal standard errors from the published 95% intervals. Rounded hazard ratios make these
  // approximate to the last digit; the interval is honest about what it covers in `limits`.
  const variance = model.coefficients.reduce((sum, coefficient) => {
    const value = values[coefficient.name]
    return sum + (standardError(coefficient.ci) * value) ** 2
  }, 0)
  const linearPredictorSe = Math.sqrt(variance)

  const uncalibrated = 1 - model.baselineSurvival ** Math.exp(linearPredictor)
  const [intercept, slope] = SCORE2.calibration[input.sex][region]
  const z = Math.log(-Math.log(1 - uncalibrated))
  const calibrated = 1 - Math.exp(-Math.exp(intercept + slope * z))
  const calibratedZ = intercept + slope * z
  const calibratedSe = slope * linearPredictorSe

  return {
    model: 'SCORE2',
    version: VERSION,
    region,
    risk: round(calibrated * 100),
    interval: {
      low: round((1 - Math.exp(-Math.exp(calibratedZ - Z_95 * calibratedSe))) * 100),
      high: round((1 - Math.exp(-Math.exp(calibratedZ + Z_95 * calibratedSe))) * 100),
      level: 0.95,
    },
    uncalibrated: round(uncalibrated * 100),
    linearPredictor: round(linearPredictor, 6),
    linearPredictorSe: round(linearPredictorSe, 6),
    terms,
    limits: LIMITS,
  }
}

/**
 * The model's own inputs, transformed as Table 2 states them.
 *
 * The diabetes rows are multiplied by zero on purpose: the paper removes the indicator for
 * individual prediction (Table 2, footnote). They stay in the table so a reader can compare it
 * with the paper row by row.
 */
function transformed(input: Score2Input): Record<TermName, number> {
  const cage = (input.age - 60) / 5
  const csbp = (input.systolicBp - 120) / 20
  const ctchol = input.totalCholesterol - 6
  const chdl = (input.hdlCholesterol - 1.3) / 0.5
  const smoking = input.currentSmoker ? 1 : 0

  return {
    age: cage,
    smoking,
    systolic_bp: csbp,
    total_cholesterol: ctchol,
    hdl_cholesterol: chdl,
    diabetes: 0,
    age_x_smoking: cage * smoking,
    age_x_systolic_bp: cage * csbp,
    age_x_total_cholesterol: cage * ctchol,
    age_x_hdl_cholesterol: cage * chdl,
    age_x_diabetes: 0,
  }
}

/** The log-scale standard error implied by a published 95% hazard-ratio interval. */
function standardError(ci: readonly [number, number]): number {
  return (Math.log(ci[1]) - Math.log(ci[0])) / (2 * Z_95)
}

/** Three decimals of a percentage point is the precision the published inputs can carry. */
function round(value: number, places = 3): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

const INPUT_KEYS = new Set([
  'age',
  'sex',
  'currentSmoker',
  'systolicBp',
  'totalCholesterol',
  'hdlCholesterol',
])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * Every reason an input may not be scored. Written for the reader who has the document in front of
 * them: a missing value is named with the field it belongs to, and says what is missing rather
 * than what to guess.
 */
function inputProblems(input: unknown, region: unknown): string[] {
  const problems: string[] = []

  if (!REGIONS.includes(region as Region)) {
    problems.push(
      `region: must be one of ${REGIONS.join(', ')} — the recalibration scale is chosen by the person's risk region, and there is no default`,
    )
  }
  if (!isObject(input)) {
    problems.push('input: SCORE2 takes { age, sex, currentSmoker, systolicBp, totalCholesterol, hdlCholesterol }')
    return problems
  }

  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) {
      problems.push(`input.${key}: unknown key — the model reads age, sex, currentSmoker, systolicBp, totalCholesterol, hdlCholesterol and nothing else`)
    }
  }

  const age = input.age
  if (typeof age !== 'number' || !Number.isInteger(age)) {
    problems.push('input.age: a whole number of years, 40–69')
  } else if (age < AGE_MIN || age > AGE_MAX) {
    problems.push(
      `input.age ${age}: SCORE2 is validated for ${AGE_MIN}–${AGE_MAX}; over 70 is SCORE2-OP, a different model, and under 40 has no scale here`,
    )
  }

  if (input.sex !== 'male' && input.sex !== 'female') {
    problems.push('input.sex: two sex-specific models were published; sex must be "male" or "female", and the page does not pick one for a document that says neither')
  }

  if (typeof input.currentSmoker !== 'boolean') {
    problems.push('input.currentSmoker: true or false — an unknown smoking status is not a non-smoker')
  }
  if (!isFinitePositive(input.systolicBp)) {
    problems.push('input.systolicBp: systolic blood pressure in mmHg, a positive number')
  }
  if (!isFinitePositive(input.totalCholesterol)) {
    problems.push('input.totalCholesterol: total cholesterol in mmol/L, a positive number')
  }
  if (!isFinitePositive(input.hdlCholesterol)) {
    problems.push('input.hdlCholesterol: HDL cholesterol in mmol/L, a positive number')
  }

  return problems
}
