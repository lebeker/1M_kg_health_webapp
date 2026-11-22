/**
 * Lee index — the 4-year mortality prognostic index, in points.
 *
 * Source: Lee SJ, Lindquist K, Segal MR, Covinsky KE, "Development and validation of a
 * prognostic index for 4-year mortality in older adults", JAMA 2006;295(7):801–808,
 * doi:10.1001/jama.295.7.801, PMID:16478903. Every weight in `LEE_ROWS` is copied from that
 * paper's printed results, not re-estimated here: the abstract prints all twelve predictors with
 * their points, and the four bands with their observed mortality. The paper carries an erratum
 * (JAMA 2006;295(16):1900) whose text was not reachable when this file was written, so it says
 * what it knows — these are the weights PubMed holds today, and `LEE_ROWS` is the only place a
 * weight appears, so a correction is one line there.
 *
 * The model, in one line: add the points of the twelve items that apply. That is why this scale
 * ships as a rule set on the T14 engine (`src/rules.ts`) and not as a coefficient model like
 * SCORE2: the paper weighted independent predictors and a person's index is their sum.
 *
 *   index = Σ pointsᵢ            i over the twelve items (0–26)
 *
 * Two of the twelve are not deficits in the usual sense — age and sex are not things that went
 * wrong — but they carry weight, so they are counted, and the count is called what the paper calls
 * it: an index. What the number is *not* is a probability: the paper gives four bands of observed
 * 4-year mortality in its validation cohort ("0 to 5 points predicting a less than 4% risk, 6 to 9
 * points predicting a 15% risk, 10 to 13 points predicting a 42% risk, and 14 or more points
 * predicting a 64% risk"), and `BANDS` copies those four rows. A band is a group's risk, not this
 * person's, so `lee()` never prints a percentage for an individual.
 *
 * What this file refuses, and why, because each refusal is a number that would otherwise be
 * printed:
 *
 *   - a missing item. The index is a count over *known* items. A missing fact would be scored
 *     zero by the engine (correctly — a rule that cannot see its fact does not fire), and zero
 *     means "this deficit is absent", which is a different person. So all twelve are required.
 *   - a wrong type (`"diabetes": "yes"`) — the engine would call that a type mismatch and skip the
 *     rule, i.e. score it as absent. Refused instead.
 *   - an age under 60. The paper's cohort is over 50, but its printed table begins at 60–64; the
 *     rows below that are not in this file, so an age under 60 is refused rather than scored zero.
 *   - an age or BMI that is not a number a person could have: a typo is not a patient.
 *
 * What it does not do at all: read the document. The twelve facts have to be supplied. Matching a
 * condition's ICD-10 code or free-text label to "diabetes", "cancer", "lung disease" or "heart
 * failure" is a mapping with its own errors, and it is a separate, recorded backlog item
 * (Charlson/Elixhauser from the ICD-10 history). Joining a weight and a height observation into a
 * BMI is the same kind of work: those are two nodes with their own dates, and a BMI needs them on
 * the same day. Nothing here guesses.
 *
 * Facts are named the way the document names facts — snake_case, flat:
 *
 *     { "age": 65, "sex": "female", "bmi": 24.1, "diabetes": true, "cancer": false,
 *       "lung_disease": false, "heart_failure": false, "current_smoker": false,
 *       "difficulty_bathing": false, "difficulty_walking_several_blocks": true,
 *       "difficulty_managing_money": false, "difficulty_pushing_large_objects": true }
 *
 * A key this index does not read is not an error: one facts record may serve several scales (age,
 * sex and smoking are shared with SCORE2), so unread keys come back in `ignored` and are named in
 * any refusal — a misspelt `diabetis` then shows up twice, once as the missing `diabetes` and once
 * as a fact nobody read.
 *
 * This is not a medical device and not a prognosis for a person: it is arithmetic over weights
 * somebody else published.
 */
import {
  type Estimate,
  type Facts,
  type Predicate,
  type RuleSet,
  type SkipReason,
  applyRules,
  loadRules,
} from './rules'

/** The scale these deltas are in. Points, not a percentage: every rule's `delta` is a point. */
export const VERSION = 'lee-4y-points/1'

/** The paper every weight is copied from. Printed with the index, so the number has a source. */
export const PMID = 'PMID:16478903'
export const DOI = '10.1001/jama.295.7.801'

/** An age in whole years, from the first band the paper prints to the last. */
export const AGE_MIN = 60

/** Above this an age is a typo in the input, not a person; the paper's top band is 85 and over. */
export const AGE_TYPO_MAX = 120

/**
 * The weight of every row is copied, not estimated here, so the trust in the delta is complete and
 * `confidence` is 1. The uncertainty that matters is not in a weight but in the model — a group's
 * observed mortality against one person's future — and it is stated in `LIMITS`, with the paper's
 * own discrimination (c = 0.84 development, 0.82 validation). A per-item confidence below 1 would
 * be a number invented by this file, which is the one thing the engine exists to prevent.
 */
const CONFIDENCE = 1

/** One scored row of the published table: a fact, a condition on it, and the points it adds. */
export type LeeRow = {
  /** Stable id: what an explanation names (T17) and what a reader searches for. */
  id: string
  /** The item family. Age is one item with six bands; everything else is one row. */
  item: string
  /** The item as the paper prints it, for a reader who has the paper open. */
  label: string
  /** The published points this row adds. Never a fraction: the index counts whole points. */
  points: number
  /** The fact this row reads. Named here so a refusal can name the field, not the rule. */
  fact: string
  when: Predicate
  source: string
}

/**
 * The twelve predictors of the paper's index, in its order, with its points: 2 demographic
 * variables (age in six bands, 1/2/3/4/5/7 points; male sex, 2), 6 comorbid conditions (diabetes 1,
 * cancer 2, lung disease 2, heart failure 2, current tobacco use 2, BMI under 25, 1) and 4
 * functional difficulties (bathing 2, walking several blocks 2, managing money 2, pushing large
 * objects 1). Seventeen rows, twelve items, twenty-six points: the age item is six rows and every
 * other item is one.
 */
export const LEE_ROWS: readonly LeeRow[] = [
  {
    id: 'age_60_64',
    item: 'age',
    label: 'age 60–64 years',
    points: 1,
    fact: 'age',
    when: { all: [{ fact: 'age', op: 'ge', value: 60 }, { fact: 'age', op: 'le', value: 64 }] },
    source: PMID,
  },
  {
    id: 'age_65_69',
    item: 'age',
    label: 'age 65–69 years',
    points: 2,
    fact: 'age',
    when: { all: [{ fact: 'age', op: 'ge', value: 65 }, { fact: 'age', op: 'le', value: 69 }] },
    source: PMID,
  },
  {
    id: 'age_70_74',
    item: 'age',
    label: 'age 70–74 years',
    points: 3,
    fact: 'age',
    when: { all: [{ fact: 'age', op: 'ge', value: 70 }, { fact: 'age', op: 'le', value: 74 }] },
    source: PMID,
  },
  {
    id: 'age_75_79',
    item: 'age',
    label: 'age 75–79 years',
    points: 4,
    fact: 'age',
    when: { all: [{ fact: 'age', op: 'ge', value: 75 }, { fact: 'age', op: 'le', value: 79 }] },
    source: PMID,
  },
  {
    id: 'age_80_84',
    item: 'age',
    label: 'age 80–84 years',
    points: 5,
    fact: 'age',
    when: { all: [{ fact: 'age', op: 'ge', value: 80 }, { fact: 'age', op: 'le', value: 84 }] },
    source: PMID,
  },
  {
    id: 'age_85_plus',
    item: 'age',
    label: 'age 85 years or more',
    points: 7,
    fact: 'age',
    when: { fact: 'age', op: 'ge', value: 85 },
    source: PMID,
  },
  {
    id: 'sex_male',
    item: 'sex',
    label: 'male sex',
    points: 2,
    fact: 'sex',
    when: { fact: 'sex', op: 'eq', value: 'male' },
    source: PMID,
  },
  {
    id: 'diabetes',
    item: 'diabetes',
    label: 'diabetes',
    points: 1,
    fact: 'diabetes',
    when: { fact: 'diabetes', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'cancer',
    item: 'cancer',
    label: 'cancer',
    points: 2,
    fact: 'cancer',
    when: { fact: 'cancer', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'lung_disease',
    item: 'lung_disease',
    label: 'lung disease',
    points: 2,
    fact: 'lung_disease',
    when: { fact: 'lung_disease', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'heart_failure',
    item: 'heart_failure',
    label: 'heart failure',
    points: 2,
    fact: 'heart_failure',
    when: { fact: 'heart_failure', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'current_smoker',
    item: 'current_smoker',
    label: 'current tobacco use',
    points: 2,
    fact: 'current_smoker',
    when: { fact: 'current_smoker', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'bmi_under_25',
    item: 'bmi',
    label: 'body mass index under 25',
    points: 1,
    fact: 'bmi',
    when: { fact: 'bmi', op: 'lt', value: 25 },
    source: PMID,
  },
  {
    id: 'difficulty_bathing',
    item: 'difficulty_bathing',
    label: 'difficulty bathing',
    points: 2,
    fact: 'difficulty_bathing',
    when: { fact: 'difficulty_bathing', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'difficulty_walking_several_blocks',
    item: 'difficulty_walking_several_blocks',
    label: 'difficulty walking several blocks',
    points: 2,
    fact: 'difficulty_walking_several_blocks',
    when: { fact: 'difficulty_walking_several_blocks', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'difficulty_managing_money',
    item: 'difficulty_managing_money',
    label: 'difficulty managing money',
    points: 2,
    fact: 'difficulty_managing_money',
    when: { fact: 'difficulty_managing_money', op: 'eq', value: true },
    source: PMID,
  },
  {
    id: 'difficulty_pushing_large_objects',
    item: 'difficulty_pushing_large_objects',
    label: 'difficulty pushing large objects',
    points: 1,
    fact: 'difficulty_pushing_large_objects',
    when: { fact: 'difficulty_pushing_large_objects', op: 'eq', value: true },
    source: PMID,
  },
]

/**
 * The same table as a rule set, loaded through the engine's own loader when this module loads.
 *
 * A table that the engine would refuse (a typo in `when`, a weight that is not a finite number, a
 * duplicated id) therefore breaks the build instead of shipping a number whose composition nobody
 * checked. `applyRules` takes the set, never the rows: the scale travels with the rules.
 */
export const LEE_RULES: RuleSet = loadRules({
  version: VERSION,
  rules: LEE_ROWS.map((row) => ({
    id: row.id,
    when: row.when,
    delta: row.points,
    source: row.source,
    confidence: CONFIDENCE,
  })),
})

/** The twelve facts this index reads, in the paper's order. Everything else is `ignored`. */
export const LEE_FACTS: readonly string[] = LEE_ROWS.reduce<string[]>((facts, row) => {
  if (!facts.includes(row.fact)) facts.push(row.fact)
  return facts
}, [])

/** The most a person can score: per item the largest weight of its rows (7 for age), added up. */
const ITEM_MAX: Record<string, number> = {}
for (const row of LEE_ROWS) ITEM_MAX[row.item] = Math.max(ITEM_MAX[row.item] ?? 0, row.points)

/**
 * 26 — what the published weights add up to: 7 age + 2 sex + 10 conditions + 7 function. Held to
 * that number by `src/lee.test.ts`, so a mistyped weight cannot quietly move the ceiling.
 */
export const MAX_POINTS: number = Object.values(ITEM_MAX).reduce((sum, points) => sum + points, 0)

/** One row of the published bands: the observed 4-year mortality of a group with this many points. */
export type LeeBand = { from: number; to: number | null; printed: string }

/**
 * The paper's four bands, copied. `printed` is a string on purpose: "less than 4%" is a bound on a
 * group, and a field called `risk` holding a number would invite printing it for a person.
 */
export const BANDS: readonly LeeBand[] = [
  { from: 0, to: 5, printed: 'less than 4%' },
  { from: 6, to: 9, printed: '15%' },
  { from: 10, to: 13, printed: '42%' },
  { from: 14, to: null, printed: '64%' },
]

/** What this number does not know. Travels with it wherever it is shown. */
export const LIMITS: readonly string[] = [
  'the bands are the validation cohort’s observed 4-year mortality for a group with that many points, not a probability for one person; the index discriminates with c = 0.82 out of sample, so individuals are misclassified',
  'the cohort was community-dwelling US adults over 50 (Health and Retirement Study, 1998 wave; deaths to 31 December 2002); it is not validated for nursing-home residents or hospital inpatients, and the mortality it measures is United States mortality',
  'each condition counts once at one weight: severity, duration, control and treatment are not scored, so a cancer in remission and an active cancer add the same 2 points',
  'the functional items are self-reported difficulty, not measured performance: no gait speed, grip strength or test battery is read',
  'conditions outside the twelve carry no weight — hypertension and chronic kidney disease among them — and neither do social or psychological measures (living alone, income, depression)',
  'age is scored only in the bands the paper prints, 60–64 to 85 and over, so an age under 60 is refused rather than scored zero',
  'the index does not read the document: there is no ICD-10 mapping, no free-text label match and no height/weight join, so the twelve facts have to be supplied by something that already decided what they are',
  'missing is not “no”: all twelve items are required, and a missing one refuses the index instead of scoring zero',
  'nothing here models cause of death, time to death inside the four years, or what changes if a condition is treated',
]

/** A scored item: one row of the deficit list, with the points it added and its citation. */
export type LeeDeficit = {
  rule: string
  item: string
  label: string
  points: number
  source: string
}

/** An item supplied and absent — a known zero, which is not the same as a missing fact. */
export type LeeAbsent = {
  rule: string
  item: string
  label: string
  reason: SkipReason
}

export type LeeIndex = {
  model: 'Lee'
  /** The scale: points, so this number can never be read as a percentage. */
  version: string
  /** The index: the published points of the items that apply. */
  points: number
  maxPoints: number
  /** The published band this index falls in, as printed. A group's risk, never a person's. */
  band: LeeBand
  /** The deficit list: every item that scored, in the paper's order. */
  deficits: readonly LeeDeficit[]
  /** Items supplied and absent, in the paper's order. The engine's own skip list is in `estimate`. */
  absent: readonly LeeAbsent[]
  /** Facts supplied that this index does not read — another scale's facts, or a misspelling. */
  ignored: readonly string[]
  /** The engine's object unchanged: version, contributions and the full skip list, in id order. */
  estimate: Estimate
  source: { pmid: string; doi: string }
  discrimination: { development: number; validation: number }
  limits: readonly string[]
}

/** A refused set of facts. Carries every problem, so one run names all of them. */
export class LeeError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'LeeError'
    this.problems = problems
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The published band containing `points`; every sum from 0 to 26 is in one of the four. */
export function bandFor(points: number): LeeBand {
  if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) {
    throw new LeeError([
      `points ${String(points)}: outside the published index 0–${MAX_POINTS} — the index is a sum of twelve whole weights, so a number outside that range is not an index`,
    ])
  }
  const band = BANDS.find((candidate) => points >= candidate.from && (candidate.to === null || points <= candidate.to))
  if (band === undefined) {
    throw new LeeError([`points ${points}: no published band contains this sum — the four bands should cover 0–${MAX_POINTS}`])
  }
  return band
}

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The published index for one person's twelve facts.
 *
 * Pure and deterministic: same facts, same bytes. The rules run in the engine, in id order, with
 * the paper's table as the only input; nothing here reads the clock, the locale or `Math.random`.
 */
export function lee(input: unknown): LeeIndex {
  if (!isObject(input)) {
    throw new LeeError([
      `facts: a flat record of the twelve items — ${LEE_FACTS.join(', ')} — got ${Array.isArray(input) ? 'an array' : typeof input}`,
    ])
  }

  const ignored = Object.keys(input)
    .filter((key) => !LEE_FACTS.includes(key))
    .sort()

  const problems = inputProblems(input)
  if (problems.length > 0) {
    if (ignored.length > 0) {
      problems.push(
        `facts: given but not read by this index — ${ignored.join(', ')}; if one of those is a misspelling of an item, the item above is the one being refused`,
      )
    }
    throw new LeeError(problems)
  }

  // The twelve, and only the twelve: an unread key never reaches the engine, so a stray value
  // cannot make a rule fire or make the estimate's skip list confusing.
  const facts: Facts = {}
  for (const fact of LEE_FACTS) facts[fact] = input[fact] as Facts[string]

  const estimate = applyRules(LEE_RULES, facts)
  const byId = new Map(estimate.contributions.map((contribution) => [contribution.rule, contribution]))

  // In the paper's order, so the list can be added up against the printed table.
  const deficits: LeeDeficit[] = []
  for (const row of LEE_ROWS) {
    const contribution = byId.get(row.id)
    if (contribution === undefined) continue
    deficits.push({
      rule: row.id,
      item: row.item,
      label: row.label,
      points: contribution.delta,
      source: contribution.source,
    })
  }

  const skipped = new Map(estimate.notApplied.map((entry) => [entry.rule, entry.reason]))
  const absent: LeeAbsent[] = []
  for (const row of LEE_ROWS) {
    const reason = skipped.get(row.id)
    if (reason === undefined) continue
    absent.push({ rule: row.id, item: row.item, label: row.label, reason })
  }

  // Exactly one age band, because the bands are disjoint and every age from AGE_MIN up is in one.
  // If this ever fails, the table has a hole and the index is one point or seven short of the
  // person — the kind of gap that is invisible in a number and obvious here.
  if (deficits.filter((deficit) => deficit.item === 'age').length !== 1) {
    throw new LeeError([
      `facts.age ${String(facts.age)}: no single published band contains this age — the table has a hole`,
    ])
  }

  return {
    model: 'Lee',
    version: estimate.version,
    points: estimate.value,
    maxPoints: MAX_POINTS,
    band: bandFor(estimate.value),
    deficits,
    absent,
    ignored,
    estimate,
    source: { pmid: PMID, doi: DOI },
    discrimination: { development: 0.84, validation: 0.82 },
    limits: LIMITS,
  }
}

/**
 * Every reason these facts may not be scored, written for the reader who has the document in front
 * of them: the field is named, and a missing value says what is missing rather than what to guess.
 */
function inputProblems(input: Record<string, unknown>): string[] {
  const problems: string[] = []

  const age = input.age
  if (age === undefined) {
    problems.push('facts.age: missing — the index scores age in bands, and a person with no age is not 0 points')
  } else if (typeof age !== 'number' || !Number.isInteger(age)) {
    problems.push(`facts.age: a whole number of years, found ${JSON.stringify(age)}`)
  } else if (age < AGE_MIN) {
    problems.push(
      `facts.age ${age}: the published table begins at ${AGE_MIN}–64, so under ${AGE_MIN} there is no band to score; the index refuses rather than add 0`,
    )
  } else if (age > AGE_TYPO_MAX) {
    problems.push(`facts.age ${age}: above ${AGE_TYPO_MAX} is a typo, not a person`)
  }

  const sex = input.sex
  if (sex === undefined) {
    problems.push('facts.sex: missing — male sex is worth 2 points, and unknown sex is not female')
  } else if (sex !== 'male' && sex !== 'female') {
    problems.push(`facts.sex: "male" or "female", found ${JSON.stringify(sex)}`)
  }

  if (input.bmi === undefined) {
    problems.push('facts.bmi: missing — body mass index under 25 is worth a point, and an unknown weight is not a normal one')
  } else if (!isFinitePositive(input.bmi)) {
    problems.push(`facts.bmi: a positive number (kg/m²), found ${JSON.stringify(input.bmi)}`)
  }

  for (const fact of ['diabetes', 'cancer', 'lung_disease', 'heart_failure', 'current_smoker']) {
    if (input[fact] === undefined) {
      problems.push(`facts.${fact}: missing — the index counts conditions, and “we do not know” is not “no”`)
    } else if (typeof input[fact] !== 'boolean') {
      problems.push(`facts.${fact}: true or false, found ${JSON.stringify(input[fact])}`)
    }
  }

  const functions = [
    'difficulty_bathing',
    'difficulty_walking_several_blocks',
    'difficulty_managing_money',
    'difficulty_pushing_large_objects',
  ]
  for (const fact of functions) {
    if (input[fact] === undefined) {
      problems.push(`facts.${fact}: missing — a functional difficulty that was not asked about is not an absence`)
    } else if (typeof input[fact] !== 'boolean') {
      problems.push(`facts.${fact}: true or false, found ${JSON.stringify(input[fact])}`)
    }
  }

  return problems
}
