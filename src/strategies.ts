/**
 * Five built-in strategies: the mechanics the demo has to show, each with a PMID and an interval.
 *
 * A strategy is not a fact and not a prediction. It is a *template* for one forecast:
 *
 *   - somebody does something (`on_statin`, `screening_colonoscopy`, `intensive_glycaemic_control`);
 *   - a paper measured what that does to an outcome, and printed a relative risk with an interval;
 *   - so the forecast is `delta_median = ln(ratio)` on a named scale, and it may not move anything
 *     until the condition on the facts is met (T18, `src/prediction.ts`).
 *
 * Why the delta is a logarithm, when the paper prints 0.78. The gate sums deltas, and on the ratio
 * scale summing is wrong: 0.78 and 0.80 together are 0.62, not 0.58. The additive quantity is the
 * log, `ln 0.78 + ln 0.80 = ln 0.624`, so a strategy's `delta_median` is the paper's ratio taken to
 * its log, and `exp(gate.delta)` puts the product back on the scale the paper printed. This is the
 * same move T17 makes on SCORE2's linear predictor: the one additive quantity on the scale is the
 * one the rows are cut from.
 *
 * Why each outcome has its own scale. Two strategies that lower the risk of the *same* outcome may
 * be added — statin and blood-pressure lowering are both about major vascular events. Two that are
 * about different outcomes may not be: a colonoscopy's effect on colorectal cancer has no business
 * in the same sum as a statin's effect on heart attacks. So the scale is the outcome
 * (`mve-log-rr/1`, `cvd-log-rr/1`, `crc-log-rr/1`, `microvascular-log-rr/1`), the gate is called once
 * per scale (T18's "one call, one scale"), and a caller cannot add a stroke to a colonoscopy by
 * accident because the two never share a version.
 *
 * Why the interval lives on the document and not on the prediction. T18's `delta_median` is a
 * median change and nothing else; the published interval belongs to the paper, so the strategy
 * writes the `document` node that carries the citation — `pmid`, `citation`, the PubMed `link`,
 * the date printed on it — and `effect: {ratio, interval, per}` says what the number means. The
 * prediction's `source` then points at that document, which is the only place in this contract a
 * PMID can live. This is the handoff PREDICTIONS.md §What comes next wrote for this card.
 *
 * What this file does not do: read a document (the contract does), decide the facts (the caller
 * supplies them — matching a statin prescription to `on_statin` is recorded work with its own error
 * rate), choose a horizon (a forecast's date is the caller's; the paper's follow-up is not this
 * module's claim about the person it writes for), or print an absolute risk. `exp(delta)` is a
 * relative change; turning it into "your risk falls from 8% to 6.2%" needs a baseline, and the
 * baseline is SCORE2's job on `score2-10y/1`, not this one's.
 *
 * This is not a medical device and not advice: it is five published relative risks, each waiting on
 * a condition somebody has to meet, with the reason a number did not move written down beside it.
 */
import type { KgEdge, KgNode } from './kg'
import {
  type Prediction,
  type PredictionGate,
  PredictionError,
  applyPredictions,
  loadPredictions,
} from './prediction'
import { type Facts, type Predicate, conditionProblems } from './rules'

/**
 * One published effect, as the paper prints it, plus the window it was measured over in words.
 *
 * `per` is not decoration: a relative risk is per *something* — per 1.0 mmol/L of LDL lowering, per
 * 10 mmHg of systolic pressure, per invitation to one screening colonoscopy. A ratio without its
 * `per` is a number that will be applied to the wrong thing.
 */
export type StrategyEffect = {
  /** The outcome the paper measured, in its own words. */
  outcome: string
  /** The measure as printed: "relative risk", "rate ratio", "risk ratio", "hazard ratio". */
  measure: string
  /** The point estimate, on the ratio scale, as printed. */
  ratio: number
  /** The published interval — `low <= ratio <= high`, at `level`. */
  interval: { level: number; low: number; high: number }
  /** What the ratio is per: the change or exposure the paper's comparison is about. */
  per: string
}

/**
 * The citable document a strategy writes: the paper itself, as a `document` node.
 *
 * It carries the date printed on it (`when`), because a forecast may not have a horizon before the
 * date its source was written, and `pmid`/`citation`/`link` because a number nobody can trace is a
 * rumour with a date on it. `effect` travels here for the same reason: it is the paper's number.
 */
export type StrategySource = {
  /** Stable node id, so the same paper is written once and reused. */
  id: string
  /** PubMed id, bare digits — the same convention `doi` uses in a research map. */
  pmid: string
  /** Authors, title, journal, year, volume, pages: enough to find it without the link. */
  citation: string
  /** The date printed on the paper (publication date), YYYY-MM-DD. */
  when: string
  /** Where a reader can open it. */
  link: string
}

export type Strategy = {
  /** Stable id; the prediction this strategy writes is `pred-<id>`. */
  id: string
  /** What the strategy is, as a sentence a person can read. */
  label: string
  /** What somebody does — the action the condition on the facts records. */
  action: string
  /** The kind of node this strategy is about: a marker or a condition. Never a prediction. */
  target: 'observation' | 'condition'
  /** The condition that has to be met before the delta may count. Same vocabulary as a rule. */
  when: Predicate
  /** The outcome's scale: a log relative risk, one per outcome. Deltas only add within one scale. */
  scale: string
  effect: StrategyEffect
  /** 0..1, this module's trust in the delta as a forecast for a person — not the paper's. */
  confidence: number
  source: StrategySource
  /** What the effect does not cover. Printed with every number; none of these is optional. */
  limits: readonly string[]
}

/** A refused strategy set. Carries every problem, so one run names all of them. */
export class StrategyError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'StrategyError'
    this.problems = problems
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** A calendar date, not just the shape of one: 2026-02-30 is not a date. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** The four scales these five strategies are on: one per outcome, so no sum mixes two. */
export const SCALE = {
  /** Major vascular events: myocardial infarction, stroke, revascularisation. */
  mve: 'mve-log-rr/1',
  /** Incident cardiovascular disease, any. */
  cvd: 'cvd-log-rr/1',
  /** Colorectal cancer incidence. */
  crc: 'crc-log-rr/1',
  /** Composite microvascular complications of diabetes. */
  microvascular: 'microvascular-log-rr/1',
} as const

/**
 * The five. Every number below is copied from the paper's abstract, quoted in `citation`, and
 * checked against PubMed — not re-estimated, not rounded into a nicer number. The `limits` of a
 * strategy say what its evidence does not cover, because the interesting thing about all five is
 * how little of a person any of them decides.
 */
const BUILT_INS: readonly Strategy[] = [
  {
    id: 'statin-ldl',
    label: 'Start a statin, and cut LDL cholesterol by 1.0 mmol/L',
    action: 'a statin at a dose that lowers LDL cholesterol by 1.0 mmol/L',
    target: 'observation',
    when: { fact: 'on_statin', op: 'eq', value: true },
    scale: SCALE.mve,
    effect: {
      outcome: 'major vascular events',
      measure: 'rate ratio',
      ratio: 0.78,
      interval: { level: 0.95, low: 0.76, high: 0.8 },
      per: '1.0 mmol/L lower LDL cholesterol',
    },
    confidence: 0.9,
    source: {
      id: 'src-ctt-2010',
      pmid: '21067804',
      citation:
        'Cholesterol Treatment Trialists’ (CTT) Collaboration. Efficacy and safety of more intensive lowering of LDL cholesterol: a meta-analysis of data from 170,000 participants in 26 randomised trials. Lancet 2010;376(9753):1670–81.',
      when: '2010-11-13',
      link: 'https://pubmed.ncbi.nlm.nih.gov/21067804/',
    },
    limits: [
      'a rate ratio per 1.0 mmol/L of LDL lowering, not a prediction for one person: the absolute change needs a baseline risk, and this strategy carries none',
      'the trials enrolled people at raised vascular risk, most with established disease or diabetes; the proportional reduction was similar across them, but a person outside those populations is outside the evidence',
      'the LDL reduction is the strategy’s assumption (a moderate dose), not something this module measures: a different dose is a different `per`',
      'no effect on cancer or non-vascular death is claimed; the paper found none',
    ],
  },
  {
    id: 'quit-smoking',
    label: 'Stop smoking, and the risk of a first cardiovascular event falls towards that of a non-smoker',
    action: 'stopping smoking, having smoked',
    target: 'condition',
    when: {
      all: [
        { fact: 'current_smoker', op: 'eq', value: false },
        { fact: 'ever_smoked', op: 'eq', value: true },
      ],
    },
    scale: SCALE.cvd,
    effect: {
      outcome: 'incident cardiovascular disease',
      measure: 'hazard ratio',
      ratio: 0.61,
      interval: { level: 0.95, low: 0.49, high: 0.76 },
      per: 'quitting within 5 years, compared with continuing to smoke',
    },
    confidence: 0.7,
    source: {
      id: 'src-duncan-2019',
      pmid: '31429895',
      citation:
        'Duncan MS, Freiberg MS, Greevy RA Jr, Kundu S, Vasan RS, Tindle HA. Association of smoking cessation with subsequent risk of cardiovascular disease. JAMA 2019;322(7):642–50.',
      when: '2019-08-20',
      link: 'https://pubmed.ncbi.nlm.nih.gov/31429895/',
    },
    limits: [
      'an association in a cohort (Framingham Heart Study, original and offspring cohorts pooled, 8,770 people, mean age 42.2 years, median 26.4 years of follow-up), not a randomised effect: people who quit differ from people who do not in ways this number cannot separate',
      'the paper’s primary analysis was restricted to heavy ever smokers (≥20 pack-years): 0.61 is that restricted estimate, and this strategy says nothing about lighter smokers',
      'smoking status was self-reported, and the comparison is with current smokers, not with never smokers',
      'quitting within 5 years is the exposure; the effect takes 10–15 years to approach never-smoker rates, which is a fact about time this single ratio does not carry',
      'middle-aged adults at baseline in Framingham, Massachusetts; not a claim about any other population',
    ],
  },
  {
    id: 'colonoscopy-screening',
    label: 'Have a screening colonoscopy: colorectal cancer is less likely within 10 years',
    action: 'invitation to one screening colonoscopy',
    target: 'condition',
    when: { fact: 'screening_colonoscopy', op: 'eq', value: true },
    scale: SCALE.crc,
    effect: {
      outcome: 'colorectal cancer incidence',
      measure: 'risk ratio',
      ratio: 0.82,
      interval: { level: 0.95, low: 0.7, high: 0.93 },
      per: 'invitation to one screening colonoscopy, at 10 years',
    },
    confidence: 0.8,
    source: {
      id: 'src-nordicc-2022',
      pmid: '36214590',
      citation:
        'Bretthauer M, Løberg M, Wieszczy P, et al.; NordICC Study Group. Effect of colonoscopy screening on risks of colorectal cancer and related death. N Engl J Med 2022;387(17):1547–56.',
      when: '2022-10-27',
      link: 'https://pubmed.ncbi.nlm.nih.gov/36214590/',
    },
    limits: [
      'intention-to-screen: only 42.0% of the invited group attended, so this is the effect of an invitation, not of the examination',
      'no significant effect on death from colorectal cancer was shown (risk ratio 0.90, 95% CI 0.64–1.16): incidence and mortality are two different numbers and this strategy claims only the first',
      'one screening round, 10-year follow-up, people aged 55–64 in Poland, Norway and Sweden; surveillance intervals for people with adenomas are a different question',
      'the horizon of the forecast is the caller’s; this ratio is measured at 10 years and says nothing about a longer or shorter window',
    ],
  },
  {
    id: 'intensive-hba1c',
    label: 'Push HbA1c down hard: microvascular complications are less likely, and severe hypoglycaemia is more likely',
    action: 'intensive glycaemic control, below the conventional HbA1c target',
    target: 'observation',
    when: { fact: 'intensive_glycaemic_control', op: 'eq', value: true },
    scale: SCALE.microvascular,
    effect: {
      outcome: 'composite microvascular complications',
      measure: 'risk ratio',
      ratio: 0.88,
      interval: { level: 0.95, low: 0.79, high: 0.97 },
      per: 'an intensive glycaemic target, as the trials defined it',
    },
    confidence: 0.6,
    source: {
      id: 'src-hemmingsen-2011',
      pmid: '22115901',
      citation:
        'Hemmingsen B, Lund SS, Gluud C, Vaag A, Almdal T, Hemmingsen C, Wetterslev J. Intensive glycaemic control for patients with type 2 diabetes: systematic review with meta-analysis and trial sequential analysis of randomised clinical trials. BMJ 2011;343:d6898.',
      when: '2011-11-24',
      link: 'https://pubmed.ncbi.nlm.nih.gov/22115901/',
    },
    limits: [
      'no effect on all-cause mortality (risk ratio 1.02, 95% CI 0.91–1.13), and the paper’s trial sequential analysis did not reach a firm answer on the microvascular effect: this is the least certain of the five',
      'severe hypoglycaemia rises with it (risk ratio 2.39, 95% CI 1.71–3.34): a strategy with a cost beside its benefit',
      'adults with type 2 diabetes in randomised trials; not a target for people without diabetes, and not a claim about which drug or diet reaches the target',
      'a composite outcome: it pools kidney, eye and nerve complications, so it is not any one of them',
    ],
  },
  {
    id: 'bp-lowering',
    label: 'Lower systolic blood pressure by 10 mmHg with treatment',
    action: 'antihypertensive treatment that lowers systolic pressure by 10 mmHg',
    target: 'observation',
    when: { fact: 'on_antihypertensive', op: 'eq', value: true },
    scale: SCALE.mve,
    effect: {
      outcome: 'major cardiovascular disease events',
      measure: 'relative risk',
      ratio: 0.8,
      interval: { level: 0.95, low: 0.77, high: 0.83 },
      per: '10 mmHg lower systolic blood pressure',
    },
    confidence: 0.85,
    source: {
      id: 'src-ettehad-2016',
      pmid: '26724178',
      citation:
        'Ettehad D, Emdin CA, Kiran A, Anderson SG, Callender T, Emberson J, Chalmers J, Rodgers A, Rahimi K. Blood pressure lowering for prevention of cardiovascular disease and death: a systematic review and meta-analysis. Lancet 2016;387(10022):957–67.',
      when: '2016-03-05',
      link: 'https://pubmed.ncbi.nlm.nih.gov/26724178/',
    },
    limits: [
      'a meta-regression across 123 trials, per 10 mmHg of achieved reduction; the reduction is the assumption, not something this module measures',
      'smaller relative reductions were seen in people with diabetes and chronic kidney disease, so this ratio is the general one, not theirs',
      'the absolute benefit depends on the starting pressure and the person’s baseline risk, which this strategy does not carry',
      'drug class matters for some outcomes (β-blockers inferior for major events, calcium channel blockers better for stroke); a single ratio cannot say which drug',
    ],
  },
]

/** Every reason one strategy may not be loaded, written for the reader who has the file open. */
function strategyProblems(strategy: Record<string, unknown>, path: string): string[] {
  const problems: string[] = []

  if (!isNonEmptyString(strategy.id)) problems.push(`${path}: missing id — a strategy has to be nameable`)
  if (!isNonEmptyString(strategy.label)) problems.push(`${path}.label: missing label — what the strategy is, in one sentence`)
  if (!isNonEmptyString(strategy.action)) {
    problems.push(`${path}.action: missing action — what somebody does, which is what the condition records`)
  }
  if (strategy.target !== 'observation' && strategy.target !== 'condition') {
    problems.push(`${path}.target: must be "observation" or "condition" — the kinds a prediction may be about`)
  }
  if (!('when' in strategy)) {
    problems.push(`${path}.when: missing condition — a strategy with nothing to wait for moves a number the day it is written`)
  } else {
    problems.push(...conditionProblems(strategy.when, `${path}.when`))
  }
  if (!isNonEmptyString(strategy.scale)) {
    problems.push(`${path}.scale: missing scale — a delta with no unit names no outcome, e.g. "mve-log-rr/1"`)
  } else if (!strategy.scale.endsWith('-log-rr/1')) {
    problems.push(
      `${path}.scale: "${strategy.scale}" is not a log relative risk — these deltas add, and only the log of a relative risk adds the way a product of risks multiplies`,
    )
  }

  const effect = strategy.effect
  if (!isObject(effect)) {
    problems.push(`${path}.effect: missing effect — the published ratio, its interval, and what it is per`)
  } else {
    if (!isNonEmptyString(effect.outcome)) problems.push(`${path}.effect.outcome: missing outcome — what the paper measured`)
    if (!isNonEmptyString(effect.measure)) problems.push(`${path}.effect.measure: missing measure — "relative risk", "rate ratio", "risk ratio", "hazard ratio"`)
    if (!isNonEmptyString(effect.per)) {
      problems.push(`${path}.effect.per: missing per — a relative risk is per a change, and a ratio without it is applied to the wrong thing`)
    }
    if (!isFinitePositive(effect.ratio)) problems.push(`${path}.effect.ratio: a finite positive number, the published point estimate`)
    const interval = effect.interval
    if (!isObject(interval)) {
      problems.push(`${path}.effect.interval: missing interval — a point estimate with no interval is a number with no uncertainty`)
    } else {
      if (typeof interval.level !== 'number' || !(interval.level > 0 && interval.level < 1)) {
        problems.push(`${path}.effect.interval.level: a level between 0 and 1, e.g. 0.95`)
      }
      if (!isFinitePositive(interval.low)) problems.push(`${path}.effect.interval.low: a finite positive number, the published lower bound`)
      if (!isFinitePositive(interval.high)) problems.push(`${path}.effect.interval.high: a finite positive number, the published upper bound`)
      if (
        isFinitePositive(interval.low) &&
        isFinitePositive(interval.high) &&
        isFinitePositive(effect.ratio) &&
        !(interval.low <= effect.ratio && effect.ratio <= interval.high)
      ) {
        problems.push(
          `${path}.effect: the point estimate ${effect.ratio} is outside its own interval ${interval.low}–${interval.high} — one of the three was copied wrongly`,
        )
      }
    }
  }

  if (
    typeof strategy.confidence !== 'number' ||
    !Number.isFinite(strategy.confidence) ||
    strategy.confidence < 0 ||
    strategy.confidence > 1
  ) {
    problems.push(`${path}.confidence: must be a number from 0 to 1`)
  }

  const source = strategy.source
  if (!isObject(source)) {
    problems.push(`${path}.source: missing source — the paper the number comes from`)
  } else {
    if (!isNonEmptyString(source.id)) problems.push(`${path}.source.id: missing id — the document node this strategy writes`)
    if (!isNonEmptyString(source.pmid)) {
      problems.push(`${path}.source.pmid: missing PMID — a strategy without a PMID does not load`)
    } else if (!/^\d{7,8}$/.test(source.pmid)) {
      problems.push(`${path}.source.pmid: "${source.pmid}" is not a PubMed id — bare digits, e.g. 21067804`)
    }
    if (!isNonEmptyString(source.citation)) {
      problems.push(`${path}.source.citation: missing citation — authors, title, journal, year; a link alone is not a citation`)
    }
    if (!isNonEmptyString(source.when)) {
      problems.push(`${path}.source.when: missing date — the date printed on the paper`)
    } else if (!isCalendarDate(source.when)) {
      problems.push(`${path}.source.when: must be a date, YYYY-MM-DD, got "${source.when}"`)
    }
    if (!isNonEmptyString(source.link)) {
      problems.push(`${path}.source.link: missing link — where a reader can open the paper`)
    } else if (!/^https:\/\//.test(source.link)) {
      problems.push(`${path}.source.link: "${source.link}" is not an https link`)
    }
  }

  const limits = strategy.limits
  if (!Array.isArray(limits) || limits.length === 0) {
    problems.push(`${path}.limits: at least one — what the effect does not cover travels with the number`)
  } else if (limits.some((limit) => !isNonEmptyString(limit))) {
    problems.push(`${path}.limits: every entry must say something`)
  }

  return problems
}

/**
 * Read a strategy set. The whole set is refused when one strategy is malformed, and the refusal
 * names every problem: dropping one silently would print a demo whose composition nobody was told,
 * which is the failure the rules loader and the prediction loader both exist to prevent.
 */
export function loadStrategies(input: unknown): Strategy[] {
  if (!Array.isArray(input)) {
    throw new StrategyError(['strategies: an array of strategy objects'])
  }

  const problems: string[] = []
  const seen = new Set<string>()

  input.forEach((strategy, index) => {
    const id = isObject(strategy) && isNonEmptyString(strategy.id) ? strategy.id : ''
    const path = `strategies[${index}]${id === '' ? '' : ` ("${id}")`}`
    if (!isObject(strategy)) {
      problems.push(`${path}: a strategy is an object`)
      return
    }
    const found = strategyProblems(strategy, path)
    problems.push(...found)
    if (found.length > 0) return
    if (seen.has(id)) {
      problems.push(`${path}: duplicate strategy id — two strategies under one id cannot be told apart`)
      return
    }
    seen.add(id)
  })

  if (problems.length > 0) throw new StrategyError(problems)
  return (input as Strategy[]).map((strategy) => ({ ...strategy, limits: [...strategy.limits] }))
}

/** The five, validated at module load: a strategy added by hand without a PMID fails on import. */
export const STRATEGIES: readonly Strategy[] = loadStrategies(BUILT_INS)

/**
 * Where a strategy's forecast goes in a document: the node it is about, and the date it is about.
 * Both are the caller's, because both are claims about a person rather than about the paper.
 */
export type Placement = {
  /** Id of the condition or observation in this document the forecast projects onto. */
  target: string
  /** The date the forecast is about, YYYY-MM-DD — not before the date printed on the paper. */
  horizon: string
}

/** One strategy's forecast, ready to be read and gated. */
export type StrategyRow = {
  strategy: string
  scale: string
  forecast: Prediction
}

/** What `materialise` builds: the nodes, the edges, and the forecasts the gate reads. */
export type StrategyPlan = {
  /** One `document` node per strategy: the paper, its PMID, its interval. */
  documents: KgNode[]
  /** One `prediction` node per placed strategy. */
  predictions: KgNode[]
  /** `projected` edges, prediction → the node it is about. */
  edges: KgEdge[]
  /** The same predictions, read by T18's loader — so the module cannot emit one it would refuse. */
  rows: StrategyRow[]
}

/**
 * Turn strategies into nodes for a document.
 *
 * Every strategy needs a placement, and an unknown placement is refused as loudly as a missing one:
 * a typo in the map would otherwise ship a demo with four strategies and no error. The horizon is
 * checked against the date printed on the strategy's own document, because a forecast that looks
 * back is a record in a forecast's clothes (T18, `kg-contract.ts`).
 */
export function materialise(placements: unknown): StrategyPlan {
  if (!isObject(placements)) {
    throw new StrategyError(['placements: a record of strategy id → { target, horizon }'])
  }

  const problems: string[] = []
  const known = new Set(STRATEGIES.map((strategy) => strategy.id))
  for (const id of Object.keys(placements).sort()) {
    if (!known.has(id)) problems.push(`placements.${id}: no built-in strategy has that id (${[...known].join(', ')})`)
  }

  const documents: KgNode[] = []
  const predictions: KgNode[] = []
  const edges: KgEdge[] = []

  for (const strategy of STRATEGIES) {
    const placement = placements[strategy.id]
    const path = `placements.${strategy.id}`
    const local: string[] = []
    if (!isObject(placement)) {
      problems.push(`${path}: missing — a strategy is a template: it needs a node to be about and a date to be about`)
      continue
    }
    const target = isNonEmptyString(placement.target) ? placement.target : ''
    const horizon = isNonEmptyString(placement.horizon) ? placement.horizon : ''
    if (target === '') {
      local.push(`${path}.target: missing — id of the ${strategy.target} this forecast is about`)
    }
    if (horizon === '') {
      local.push(`${path}.horizon: missing — the date this forecast is about`)
    } else if (!isCalendarDate(horizon)) {
      local.push(`${path}.horizon: must be a date, YYYY-MM-DD, got "${horizon}"`)
    } else if (horizon < strategy.source.when) {
      local.push(
        `${path}.horizon: ${horizon} is before ${strategy.source.when}, the date printed on the paper: a forecast is about a later date, never an earlier one`,
      )
    }
    problems.push(...local)
    if (local.length > 0) continue

    const delta = Math.log(strategy.effect.ratio)
    const predictionId = `pred-${strategy.id}`

    documents.push({
      id: strategy.source.id,
      kind: 'document',
      label: `${strategy.source.citation.split('.')[0]} — ${strategy.effect.outcome}`,
      when: strategy.source.when,
      confirmed: true,
      link: strategy.source.link,
      pmid: strategy.source.pmid,
      citation: strategy.source.citation,
      effect: strategy.effect,
    })

    predictions.push({
      id: predictionId,
      kind: 'prediction',
      label: strategy.label,
      target,
      horizon,
      condition: strategy.when,
      delta_median: delta,
      confidence: strategy.confidence,
      confirmed: false,
      source: strategy.source.id,
    })

    edges.push({
      from: predictionId,
      to: target,
      label: 'projected',
      confidence: strategy.confidence,
    })
  }

  if (problems.length > 0) throw new StrategyError(problems)

  // Read them back through T18's loader before handing them out: a shape the loader refuses is a
  // document that would fail the contract gate later, and this is the earliest place to say so.
  const loaded = loadPredictions(predictions)
  const byId = new Map(loaded.map((prediction) => [prediction.id, prediction]))
  const rows: StrategyRow[] = STRATEGIES.map((strategy) => {
    const forecast = byId.get(`pred-${strategy.id}`)
    if (forecast === undefined) {
      throw new StrategyError([`pred-${strategy.id}: the loader did not read back the forecast just built`])
    }
    return { strategy: strategy.id, scale: strategy.scale, forecast }
  })

  return { documents, predictions, edges, rows }
}

/** One scale's verdict: the gate's rows, and the product the applied ones make. */
export type StrategyGate = {
  /** The outcome's scale — `mve-log-rr/1` and `crc-log-rr/1` are never summed together. */
  scale: string
  gate: PredictionGate
  /**
   * `exp(gate.delta)`: the combined relative risk of the strategies whose condition is met, on this
   * scale. One met strategy's ratio is the paper's own; two met strategies' is their product, which
   * is what exp of a sum of logs is. No combined interval is printed: the two papers' intervals are
   * each their own, and multiplying them would assume an independence nobody published.
   */
  ratio: number
}

/**
 * Gate the plan's forecasts against the facts, one call per scale — T18's rule, applied here so a
 * caller cannot sum a colonoscopy into a statin. Scales come back in name order; rows inside a
 * scale are in prediction-id order, so the same facts always print the same bytes.
 */
export function gateStrategies(plan: StrategyPlan, facts: Facts): StrategyGate[] {
  const byScale = new Map<string, Prediction[]>()
  for (const row of [...plan.rows].sort((a, b) => (a.strategy < b.strategy ? -1 : a.strategy > b.strategy ? 1 : 0))) {
    const bucket = byScale.get(row.scale)
    if (bucket === undefined) byScale.set(row.scale, [row.forecast])
    else bucket.push(row.forecast)
  }

  try {
    return [...byScale.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([scale, predictions]) => {
        const gate = applyPredictions({ version: scale, predictions, facts })
        return { scale, gate, ratio: Math.exp(gate.delta) }
      })
  } catch (error) {
    // The gate's refusals are about the forecasts, which this module built from the strategies.
    if (error instanceof PredictionError) throw new StrategyError(error.problems.map((problem) => `gate: ${problem}`))
    throw error
  }
}
