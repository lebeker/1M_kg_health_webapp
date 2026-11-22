/**
 * Predictions: a forecast is a simulation, not a fact.
 *
 * The card is one sentence — target, horizon, condition, delta_median, source, confidence; it does
 * not affect the estimate until its condition is met — and this file is that sentence as code. Why
 * it needs code at all, and not just six fields in a schema:
 *
 *   - a schema can say a `condition` is well-formed. It cannot say whether the condition is *true*,
 *     and a forecast that quietly assumed its own condition is exactly the failure the card names:
 *     the number moves, and nobody was told it moved on a guess.
 *   - so the gate is a function over the facts. `applyPredictions` returns a `delta` that is the sum
 *     of the predictions whose condition is **met**, and nothing else. Met is not "not obviously
 *     false": the condition language is three-valued (`src/rules.ts`), and a missing fact or a
 *     mistyped one gives `unknown`, which is withheld. "We do not know whether he is on a statin" is
 *     not "he is on a statin" — and it is not "he is not", either: the forecast stays visibly
 *     pending instead of being silently dropped.
 *   - the withheld rows travel with the number. A caller that prints only the estimate throws away
 *     the reason a forecast did not count, and the next reader cannot tell a forecast that was
 *     checked and unmet from one that was never considered.
 *
 * The six fields, and what each one is for:
 *
 *   target        the id of the condition or observation the forecast is about. The `projected` edge
 *                 says the same thing in the graph; this is the same claim on the node, so a
 *                 prediction is readable without walking its edges.
 *   horizon       the date the forecast is about — not the day it was made, which is the date printed
 *                 on its source document. A prediction is not an event and carries no `when`.
 *   condition     the predicate that has to be met. Same vocabulary as a rule's `when`
 *                 (`$defs.predicate`), evaluated by the same engine, so "a forecast is live" and
 *                 "a rule fires" cannot mean two different things.
 *   delta_median  what the estimate of this scale would move by, in that scale's unit, once the
 *                 condition is met. Median, not mean, and not a range: the interval belongs to the
 *                 paper the source names, not to this field.
 *   source        the id of the `document` node in this document that the forecast came from — the
 *                 same field, and the same rule, as every other node's `source`. The citation itself
 *                 (a PMID, a DOI, a URL) belongs to that document, which is what carries a date and
 *                 an address a reader can open. Required: a forecast that cannot be traced is a
 *                 rumour with a date on it.
 *   confidence    0..1, the trust in the delta.
 *
 * What this file deliberately does not do: read the document (that is `scripts/lib/kg-contract.ts`,
 * which refuses a malformed prediction outright), decide what the facts are (the caller supplies
 * them, and a forecast is not allowed to invent one), render anything, or read the clock. Determinism
 * is the same promise the rules engine makes: same predictions + same facts → the same number, bit
 * for bit, with rows in `id` order so a reordered JSON file cannot move a sum.
 *
 * This is not a medical device and not advice: it is arithmetic over a condition that somebody has to
 * meet, with the reason a number did not move written down beside it.
 */
import { type Facts, type Predicate, type SkipReason, conditionProblems, evaluatePredicate } from './rules'

/**
 * The six fields a prediction cannot do without, in the order the card names them. `scripts/kg-contract.test.ts`
 * holds this list against the schema's `required`, so the document and the code cannot drift apart.
 */
export const PREDICTION_FIELDS = ['target', 'horizon', 'condition', 'delta_median', 'source', 'confidence'] as const

/** One loaded prediction: the six fields of the card, plus the id the row is read by. */
export type Prediction = {
  id: string
  target: string
  horizon: string
  condition: Predicate
  delta_median: number
  source: string
  confidence: number
}

/** What the gate decided about one prediction. `met` is the only value that may move an estimate. */
export type PredictionVerdict = 'met' | 'unmet' | 'unknown'

/** One row of the gate's output: the forecast, what it would do, and whether it may do it. */
export type PredictionRow = Prediction & {
  verdict: PredictionVerdict
  /** Why the condition did not pass — `no-match` for unmet, a missing or mistyped fact for unknown. */
  reason: SkipReason | undefined
}

/**
 * The gate's answer. `delta` is the only number an estimate may take from a forecast: the sum of
 * the deltas whose condition is met, and nothing else.
 */
export type PredictionGate = {
  /** The scale the deltas are in, supplied by the caller — a delta with no unit is not a number. */
  version: string
  delta: number
  applied: PredictionRow[]
  withheld: PredictionRow[]
}

/** A refused prediction set. Carries every problem, so one run names all of them. */
export class PredictionError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'PredictionError'
    this.problems = problems
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** A calendar date, not just the shape of one: 2026-02-30 is not a date. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * Read the predictions out of a document's `nodes`. Only `kind: "prediction"` nodes are read; every
 * other kind is ignored, so a caller can hand this a whole document.
 *
 * A malformed prediction is refused, and the whole set with it: dropping one would compute an
 * estimate whose composition nobody was told, which is the same failure the rules loader refuses.
 */
export function loadPredictions(nodes: unknown): Prediction[] {
  if (!Array.isArray(nodes)) {
    throw new PredictionError(['nodes: a document nodes array is what predictions are read from'])
  }

  const predictions: Prediction[] = []
  const problems: string[] = []
  const seen = new Set<string>()

  nodes.forEach((node, index) => {
    if (!isObject(node) || node.kind !== 'prediction') return
    const id = isNonEmptyString(node.id) ? node.id : ''
    const path = `$.nodes[${index}]${id === '' ? '' : ` ("${id}")`}`
    const found = predictionProblems(node, path)
    problems.push(...found)
    if (found.length > 0) return
    if (seen.has(id)) {
      problems.push(`${path}: duplicate prediction id — two forecasts under one id cannot be told apart`)
      return
    }
    seen.add(id)
    predictions.push({
      id,
      target: node.target as string,
      horizon: node.horizon as string,
      condition: node.condition as Predicate,
      delta_median: node.delta_median as number,
      source: node.source as string,
      confidence: node.confidence as number,
    })
  })

  if (problems.length > 0) throw new PredictionError(problems)
  return predictions.sort(byId)
}

/** Every reason a prediction may not be read. The same checks the gate applies at its own door. */
function predictionProblems(node: Record<string, unknown>, path: string): string[] {
  const problems: string[] = []

  if (!isNonEmptyString(node.id)) problems.push(`${path}: missing id — a forecast has to be nameable`)

  if (!isNonEmptyString(node.target)) {
    problems.push(`${path}.target: missing target — the condition or observation this forecast is about`)
  }
  if (!isNonEmptyString(node.horizon)) {
    problems.push(`${path}.horizon: missing horizon — the date this forecast is about`)
  } else if (!isCalendarDate(node.horizon)) {
    problems.push(`${path}.horizon: must be a date, YYYY-MM-DD, got "${node.horizon}"`)
  }
  if (!('condition' in node)) {
    problems.push(
      `${path}.condition: missing condition — a forecast with nothing to wait for moves the estimate the day it is written`,
    )
  } else {
    problems.push(...conditionProblems(node.condition, `${path}.condition`))
  }
  if (typeof node.delta_median !== 'number' || !Number.isFinite(node.delta_median)) {
    problems.push(`${path}.delta_median: must be a finite number — what the estimate would move by`)
  }
  if (!isNonEmptyString(node.source)) {
    problems.push(`${path}.source: a forecast without a source does not load — it cannot justify a number`)
  }
  if (
    typeof node.confidence !== 'number' ||
    !Number.isFinite(node.confidence) ||
    node.confidence < 0 ||
    node.confidence > 1
  ) {
    problems.push(`${path}.confidence: must be a number from 0 to 1`)
  }

  return problems
}

/**
 * Gate a set of predictions against the facts and return what may move the estimate.
 *
 * `delta` is the sum of the deltas whose condition is `met`, in `id` order, and it is zero when no
 * condition is met — the estimate then stays exactly where it was, which is the card's promise.
 * Everything else is in `withheld` with the reason it did not pass.
 *
 * The version is the caller's, because a delta is meaningless without the scale it is measured on:
 * `score2-10y/1` deltas are risk points, `lee-4y-points/1` deltas are index points, and two scales'
 * deltas must never be added by accident (the same rule `applyRules` enforces).
 */
export function applyPredictions(input: {
  version: string
  predictions: readonly Prediction[]
  facts: Facts
}): PredictionGate {
  const problems: string[] = []
  if (!isObject(input)) {
    throw new PredictionError(['$: applyPredictions takes { version, predictions, facts }'])
  }
  const version = isNonEmptyString(input.version) ? input.version : ''
  if (version === '') {
    problems.push('version: a delta names the scale it is in, e.g. "score2-10y/1"')
  }
  if (!isObject(input.facts)) {
    problems.push('facts: a flat record of numbers, strings and booleans')
  }
  if (!Array.isArray(input.predictions)) {
    problems.push('predictions: an array of loaded predictions — `loadPredictions` reads them from a document')
  }
  if (problems.length > 0) throw new PredictionError(problems)

  const seen = new Set<string>()
  const ordered = [...input.predictions].sort(byId)
  ordered.forEach((prediction, index) => {
    if (!isObject(prediction)) {
      problems.push(`predictions[${index}]: a prediction is an object`)
      return
    }
    problems.push(...predictionProblems(prediction as unknown as Record<string, unknown>, `predictions[${index}]`))
    if (isNonEmptyString(prediction.id)) {
      if (seen.has(prediction.id)) problems.push(`predictions[${index}] ("${prediction.id}"): duplicate prediction id`)
      seen.add(prediction.id)
    }
  })
  if (problems.length > 0) throw new PredictionError(problems)

  const applied: PredictionRow[] = []
  const withheld: PredictionRow[] = []
  let delta = 0

  for (const prediction of ordered) {
    const verdict = evaluatePredicate(prediction.condition, input.facts)
    const decided: PredictionVerdict =
      verdict === true ? 'met' : verdict === 'no-match' ? 'unmet' : 'unknown'
    const row: PredictionRow = {
      ...prediction,
      verdict: decided,
      reason: verdict === true ? undefined : verdict,
    }
    if (decided !== 'met') {
      withheld.push(row)
      continue
    }
    applied.push(row)
    delta += prediction.delta_median
  }

  return { version, delta, applied, withheld }
}

const byId = (a: Prediction, b: Prediction): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
