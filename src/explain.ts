/**
 * Explanations: why an estimate moved.
 *
 * The card is one sentence — every estimate change has a Δ, a cause, and a source link — and this
 * file is that sentence as code. Three things it will not do, because each of them is a number a
 * reader would otherwise believe:
 *
 *   1. **No Δ without a cause.** A row is named after the thing that moved the number: a rule's
 *      `id`, or a term of the coefficient model. A row that says only `+2` is not an explanation,
 *      it is arithmetic with the reason left out.
 *   2. **No cause without a link.** `sourceLink` turns a citation into an address a reader can
 *      open — a PMID, a DOI, a URL. A rule whose `source` is prose has no link, and an explanation
 *      naming it is refused rather than printed with a citation nobody can follow. The engine
 *      already refuses a rule with no `source` at all (T14); this is the stricter promise the
 *      explanation makes, because "see Smith 2020" is not a place.
 *   3. **No two scales in one column of numbers.** A rule set carries its `version` and one call
 *      applies one set, so a Δ can never be added to a number whose scale it does not name. A
 *      coefficient model is not a sum of independent deltas at all, so it is explained by its own
 *      function returning its own shape — never flattened into the rule-set shape to make a table
 *      look uniform (see docs/ARCHITECTURE.md §Estimates).
 *
 * Two shapes, on purpose, matching the two models:
 *
 *   - `explainRules` — for an additive scale (the Lee index, T16). Both dates are scored by the
 *     engine from the *same* rule set and the same base, so a row's Δ is exactly what the rule
 *     added at one date and not the other, and the rows add up to the change.
 *   - `explainScore2` — for SCORE2 (T15), a Cox model in which risk is a nonlinear function of the
 *     linear predictor. The only quantity that adds up is the linear predictor, so that is what
 *     the rows are cut from: each term's Δ is the change in risk produced by adding its
 *     log-hazard change in the paper's table order. The rows still add to the total, and the
 *     output says out loud that the *split* depends on that order while the total does not.
 *
 * Where the explanation is shown is a separate question from what it is. The drift view is T13 in
 * the plan, parked with T08 behind the owner's decision, so nothing here renders: the page that
 * wants it calls these functions and draws the rows. `bun run explain` prints the same rows from a
 * shell, which is how this file is checked until that view exists.
 *
 * Deterministic throughout: facts in, rows out, nothing read from the clock, the locale or
 * `Math.random`, and rules always in `id` order so a reordered JSON file cannot move a number.
 */
import {
  type Facts,
  type FactValue,
  type Predicate,
  type RuleSet,
  type SkipReason,
  applyRules,
} from './rules'
import {
  type Region,
  type Score2Input,
  type TermName,
  SCORE2,
  VERSION as SCORE2_VERSION,
  calibrate,
  inputFromFacts,
  score2,
} from './score2'

/** A refused explanation. Carries every problem, so one run names all of them. */
export class ExplainError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'ExplainError'
    this.problems = problems
  }
}

const URLISH = /^https?:\/\/\S+$/i
const PMID = /^(?:pmid:\s*)?(\d{5,9})$/i
const DOI = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i

/**
 * The citation as a link a reader can open, or `null` when the source names no addressable record.
 *
 * Accepted, case-insensitively: `https://…`, `PMID:12345678` (and a bare 5–9 digit id),
 * `10.1001/jama.295.7.801`, and either of those behind `doi:` / `pmid:`. A bare identifier is not
 * accepted: "synthetic:demo-sex" and "Smith 2020" both return `null`, because a reader cannot
 * check them and an explanation that cites them is claiming a source it cannot produce.
 */
export function sourceLink(source: string): string | null {
  const trimmed = source.trim()
  if (URLISH.test(trimmed)) return trimmed
  const pmid = PMID.exec(trimmed)
  if (pmid !== null) return `https://pubmed.ncbi.nlm.nih.gov/${pmid[1]}/`
  const doi = DOI.exec(trimmed)
  if (doi !== null) return `https://doi.org/${doi[1]}`
  return null
}

/** One fact as the two dates record it. `null` is "not supplied", which is not `false`. */
export type FactChange = { fact: string; before: FactValue | null; after: FactValue | null }

/** What a rule added at one date and not the other. */
export type RuleDriver = {
  /** The rule's `id`: the thing that moved the number, and what a reader searches for. */
  cause: string
  /** The condition the rule states, so a reader can see why it fired at one date and not the other. */
  when: Predicate
  /** `started` = it fires at the later date only; `stopped` = at the earlier date only. */
  kind: 'started' | 'stopped'
  /** In the scale's own unit. Positive raises the estimate, negative lowers it. */
  delta: number
  source: string
  /** `sourceLink(source)` — never null here: a rule that cannot be linked refuses the explanation. */
  link: string
  confidence: number
  /** Why a rule that no longer fires does not fire. Absent when it started firing. */
  reason?: SkipReason
  /** The facts this rule reads that differ between the two dates — the change behind the change. */
  evidence: FactChange[]
}

export type RulesExplanation = {
  model: 'rules'
  /** The rule set's own scale, copied from it. Every Δ below is in this scale's unit. */
  scale: string
  /** What the unit is called, supplied by the caller: points, percentage points, a year. */
  unit: string
  base: number
  before: { value: number; fired: number }
  after: { value: number; fired: number }
  /** `after.value - before.value`, in `unit`. The sum of the rows, up to floating-point order. */
  change: number
  /** One row per rule whose contribution changed, in `id` order. Rules in both dates are absent. */
  drivers: RuleDriver[]
  /** Rules that fired at both dates with the same delta: they move the number, but not between these two. */
  unchanged: string[]
}

/** The two fact records to compare, and what the scale's numbers are in. */
export type RulesComparison = {
  /** Required: a Δ with no unit is not a quantity. `points`, `percentage points`, `a year`. */
  unit: string
  /** The facts as the earlier date records them. */
  before: Facts
  /** The facts as the later date records them. */
  after: Facts
  /** The scale's base. One base for both dates, so the change is the rules' own and not the base's. */
  base?: number
}

/**
 * Explain a change of a rule-set estimate between two fact records.
 *
 * Both numbers are computed here, from the set the caller passed, so the explanation cannot be
 * handed two estimates that came from different rule files or different bases. What differs is
 * then exactly the facts, and each row is a rule that started or stopped firing.
 */
export function explainRules(set: RuleSet, comparison: RulesComparison): RulesExplanation {
  const problems: string[] = []
  if (typeof comparison?.unit !== 'string' || comparison.unit.trim() === '') {
    problems.push(
      'comparison.unit: a delta with no unit is not a quantity — say what this scale\'s numbers are in (points, percentage points, a year)',
    )
  }
  if (problems.length > 0) throw new ExplainError(problems)

  const base = comparison.base ?? 0
  const before = applyRules(set, comparison.before, base)
  const after = applyRules(set, comparison.after, base)

  const beforeById = new Map(before.contributions.map((contribution) => [contribution.rule, contribution]))
  const afterById = new Map(after.contributions.map((contribution) => [contribution.rule, contribution]))
  const reasonById = new Map(after.notApplied.map((entry) => [entry.rule, entry.reason]))

  const drivers: RuleDriver[] = []
  const unchanged: string[] = []
  const linkProblems: string[] = []

  for (const id of [...new Set([...beforeById.keys(), ...afterById.keys()])].sort()) {
    const was = beforeById.get(id)
    const is = afterById.get(id)
    if (was !== undefined && is !== undefined) {
      unchanged.push(id)
      continue
    }

    const contribution = is ?? was
    if (contribution === undefined) continue
    const link = sourceLink(contribution.source)
    if (link === null) {
      linkProblems.push(
        `rule "${id}": moves the estimate between these two dates, but its source "${contribution.source}" is not a link — a reader cannot open it, so the change cannot be shown with a citation; use a PMID, a DOI or a URL`,
      )
      continue
    }

    const evidence = factsThatChanged(contribution.when, comparison.before, comparison.after)
    const row: RuleDriver = {
      cause: id,
      when: contribution.when,
      kind: is !== undefined ? 'started' : 'stopped',
      delta: is !== undefined ? contribution.delta : -contribution.delta,
      source: contribution.source,
      link,
      confidence: contribution.confidence,
      evidence,
    }
    if (is === undefined) {
      const reason = reasonById.get(id)
      if (reason !== undefined) row.reason = reason
    }
    drivers.push(row)
  }

  if (linkProblems.length > 0) throw new ExplainError(linkProblems)

  const change = drivers.reduce((sum, driver) => sum + driver.delta, 0)
  const engineChange = after.delta - before.delta
  // Not a refusal: a disagreement here is a defect in this file, and printing a table that does
  // not add up to the number above it is the one thing an explanation must never do.
  if (Math.abs(change - engineChange) > 1e-9) {
    throw new ExplainError([
      `the rows add up to ${change} but the estimates differ by ${engineChange} — this is a defect in explainRules, not a refusal`,
    ])
  }

  return {
    model: 'rules',
    scale: after.version,
    unit: comparison.unit,
    base,
    before: { value: before.value, fired: before.contributions.length },
    after: { value: after.value, fired: after.contributions.length },
    change,
    drivers,
    unchanged,
  }
}

/** What a value is as a fact, or `null` when the record does not supply one. */
function factValue(facts: Facts, fact: string): FactValue | null {
  const value = facts[fact]
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/** Every fact a condition reads, in the order it reads them, once each. */
function predicateFacts(when: Predicate, out: string[] = []): string[] {
  if ('all' in when) {
    for (const child of when.all) predicateFacts(child, out)
  } else if ('any' in when) {
    for (const child of when.any) predicateFacts(child, out)
  } else if ('not' in when) {
    predicateFacts(when.not, out)
  } else if (!out.includes(when.fact)) {
    out.push(when.fact)
  }
  return out
}

/** The facts a rule reads that are not the same at both dates. */
function factsThatChanged(when: Predicate, before: Facts, after: Facts): FactChange[] {
  const out: FactChange[] = []
  for (const fact of predicateFacts(when)) {
    const was = factValue(before, fact)
    const is = factValue(after, fact)
    if (was === is) continue
    out.push({ fact, before: was, after: is })
  }
  return out
}

/**
 * A term of the coefficient model, and what it did to the number between the two dates.
 *
 * Two deltas, and the difference between them is the whole point: `logHrDelta` is exact and
 * order-free (the linear predictor is a sum), while `delta` is that term's share of the change in
 * percentage points, cut in the published table order. `delta` is what a reader asked for;
 * `logHrDelta` is what a reviewer checks.
 */
export type Score2Driver = {
  cause: Score2TermName
  /** This term's change in the linear predictor — the additive quantity on this scale. */
  logHrDelta: number
  /** `exp(logHrDelta)`: the hazard ratio this change alone applies. */
  hazardRatio: number
  /** This term's share of the change in percentage points, in the published table order. */
  delta: number
  source: string
  /** Never null: every row points at the paper the coefficients were copied from. */
  link: string
  /** The inputs this term reads that differ between the two dates. */
  evidence: FactChange[]
}

export type Score2Explanation = {
  model: 'SCORE2'
  /** The scale, copied from the model: `score2-10y/1`. */
  scale: string
  unit: 'percentage points'
  region: Region
  /** As the model reports them: three decimals of a percent, and the linear predictor. */
  before: { risk: number; linearPredictor: number }
  after: { risk: number; linearPredictor: number }
  /** `after - before` in percentage points. Exact, and the sum of the rows. */
  change: number
  /** The change of the linear predictor: the sum of every row's `logHrDelta`. */
  linearPredictorChange: number
  /** One row per term that moved, in the paper's table order. */
  drivers: Score2Driver[]
  /** Terms whose contribution is identical at both dates: part of the number, not of the change. */
  unchanged: Score2TermName[]
  /** How the rows were cut. Printed with them, because their sizes depend on it. */
  method: string
  /** The model's own limits, plus the one the split adds. */
  limits: readonly string[]
}

/** The paper the coefficients, the recalibration and the hazard ratios come from. */
const SCORE2_SOURCE = 'SCORE2 working group, Eur Heart J 2021;42(25):2439–2454'
const SCORE2_LINK = 'https://doi.org/10.1093/eurheartj/ehab309'

/** The model's input names and the document's fact names, which is all `evidence` may contain. */
const INPUT_FACT: Record<string, keyof Score2Input> = {
  age: 'age',
  current_smoker: 'currentSmoker',
  systolic_bp: 'systolicBp',
  total_cholesterol: 'totalCholesterol',
  hdl_cholesterol: 'hdlCholesterol',
}

/** The facts each term of Table 2 is built from. Diabetes is an input the model zeroes, so it is absent. */
const TERM_FACTS: Record<Score2TermName, readonly string[]> = {
  age: ['age'],
  smoking: ['current_smoker'],
  systolic_bp: ['systolic_bp'],
  total_cholesterol: ['total_cholesterol'],
  hdl_cholesterol: ['hdl_cholesterol'],
  diabetes: [],
  age_x_smoking: ['age', 'current_smoker'],
  age_x_systolic_bp: ['age', 'systolic_bp'],
  age_x_total_cholesterol: ['age', 'total_cholesterol'],
  age_x_hdl_cholesterol: ['age', 'hdl_cholesterol'],
  age_x_diabetes: ['age'],
}

/** Two SCORE2 inputs to compare. The region is one argument: it is where a person is, not a change in them. */
export type Score2Comparison = {
  before: Score2Input
  after: Score2Input
  /**
   * One region for both dates. Two regions are two calibrations of the same arithmetic — the
   * number changes, the person does not — so comparing them is a different question from "why did
   * my risk move", and this function is not the place to answer it.
   */
  region: Region
}

/**
 * Explain a change of the SCORE2 risk between two inputs.
 *
 * Why not a rule-set explanation: risk is `1 - exp(-exp(a + b·ln(-ln(1 - S0^exp(lp)))))`, so a term's
 * effect is not a fixed number of percentage points — it depends on what the rest of the linear
 * predictor is. The rows below are a *sequential* split: term 1's share is the risk change of
 * adding its log-hazard change to the earlier date's predictor, term 2's is the next step, and so
 * on in Supplementary Table 2's order. They add to the total exactly (the steps telescope), and a
 * different order would cut the same total differently — which `method` and `limits` say, because
 * a row whose size depends on the order is only honest when the order is on the page.
 */
export function explainScore2(comparison: Score2Comparison): Score2Explanation {
  if (comparison.before.sex !== comparison.after.sex) {
    throw new ExplainError([
      `sex: the two dates are ${comparison.before.sex} and ${comparison.after.sex} — SCORE2 publishes two sex-specific models, so this is a change of model, not a change in the estimate; explain one person's risk with one model`,
    ])
  }

  const before = score2(comparison.before, comparison.region)
  const after = score2(comparison.after, comparison.region)
  const { sex } = comparison.after
  const model = SCORE2.models[sex]

  // Recomputed from the terms, not from the rounded `linearPredictor`: the rows have to add to the
  // change, and a value rounded to six decimals before the split would leave a residue in the last
  // digit that nobody could account for.
  const lpOf = (terms: readonly { contribution: number }[]): number =>
    terms.reduce((sum, term) => sum + term.contribution, 0)
  const lpBefore = lpOf(before.terms)
  const lpAfter = lpOf(after.terms)
  const riskAt = (lp: number): number => calibrate(lp, sex, comparison.region).calibrated * 100

  const beforeById = new Map(before.terms.map((term) => [term.name, term]))
  const drivers: Score2Driver[] = []
  const unchanged: Score2TermName[] = []
  let previous = riskAt(lpBefore)
  let running = lpBefore

  for (const coefficient of model.coefficients) {
    const was = beforeById.get(coefficient.name)
    const is = after.terms.find((term) => term.name === coefficient.name)
    if (was === undefined || is === undefined) {
      throw new ExplainError([
        `term ${coefficient.name}: the model reports it at one date and not the other — this is a defect in explainScore2, not a refusal`,
      ])
    }
    const logHrDelta = is.contribution - was.contribution
    if (logHrDelta === 0) {
      unchanged.push(coefficient.name)
      continue
    }

    running += logHrDelta
    const risk = riskAt(running)
    const evidence: FactChange[] = []
    for (const fact of TERM_FACTS[coefficient.name]) {
      const input = INPUT_FACT[fact]
      const wasFact = comparison.before[input] as FactValue
      const isFact = comparison.after[input] as FactValue
      if (wasFact === isFact) continue
      evidence.push({ fact, before: wasFact, after: isFact })
    }

    drivers.push({
      cause: coefficient.name,
      logHrDelta,
      hazardRatio: Math.exp(logHrDelta),
      delta: risk - previous,
      source: `${SCORE2_SOURCE}, Suppl. Table 2 (${sex} model), ${coefficient.name}: log hazard ratio ${coefficient.logHr.toFixed(4)}, published hazard ratio ${coefficient.ci[0]}–${coefficient.ci[1]}`,
      link: SCORE2_LINK,
      evidence,
    })
    previous = risk
  }

  const change = drivers.reduce((sum, driver) => sum + driver.delta, 0)
  const printed = after.risk - before.risk
  const total = riskAt(lpAfter) - riskAt(lpBefore)
  // A disagreement is a defect: the rows must add to the change a reader is looking at. The slack
  // is the two roundings the model itself prints with (half a thousandth each), and nothing more.
  if (Math.abs(change - total) > 1e-9 || Math.abs(total - printed) > 1.1e-3) {
    throw new ExplainError([
      `the rows add up to ${change} percentage points, the model's own change is ${printed} — this is a defect in explainScore2, not a refusal`,
    ])
  }

  const method =
    'the rows are a sequential split: each term\'s delta is the change in risk from adding that term\'s log-hazard change in the published Supplementary Table 2 order; the rows add to the total, and another order would split the same total differently'

  return {
    model: 'SCORE2',
    scale: SCORE2_VERSION,
    unit: 'percentage points',
    region: comparison.region,
    before: { risk: before.risk, linearPredictor: before.linearPredictor },
    after: { risk: after.risk, linearPredictor: after.linearPredictor },
    change: total,
    linearPredictorChange: lpAfter - lpBefore,
    drivers,
    unchanged,
    method,
    limits: [
      ...before.limits,
      'a decomposition of a coefficient model is not a set of rules: the size of each row depends on the order it was cut in, and only the total does not',
    ],
  }
}

/** The explanation of a change of SCORE2 risk, given two facts files and one region. */
export function explainScore2Facts(before: unknown, after: unknown, region: Region): Score2Explanation {
  return explainScore2({ before: inputFromFacts(before), after: inputFromFacts(after), region })
}

/** The term names of the coefficient model, re-exported so a view does not reach into score2.ts. */
export type Score2TermName = TermName
