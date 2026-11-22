/**
 * The rules engine: one estimate, computed from a base number and the rules that fire.
 *
 * Why a rule is data and not code. An estimate that moves because a model "thought" so cannot be
 * reviewed, diffed or re-run. A rule is a JSON object:
 *
 *     { "id": "...", "when": {...}, "delta": 0.4, "source": "PMID:...", "confidence": 0.8 }
 *
 *   - `id` — stable and unique. It is what an explanation names (T17) and what a reader searches
 *     for in the rule file.
 *   - `when` — the condition under which the rule fires, stated over the *facts*, not over time.
 *     The name is the card's (T14: `{id, when, delta, source, confidence}`) and it means "when the
 *     facts look like this": every date in this app lives in a document node's own `when`, and a
 *     rule that carried a date would be the second kind of time the plan warns about.
 *   - `delta` — what the rule adds to the estimate, in the unit of the set's `version` (a risk in
 *     percent points, a deficit count, a year). One rule set is one scale; see `RuleSet` for what
 *     the engine does — and does not — do about a caller holding two of them.
 *   - `source` — the citation that justifies the delta: a PMID, a DOI, a URL. **Required.**
 *   - `confidence` — 0..1, the trust in this adjustment.
 *
 * A rule without a `source` does not load, and it does not load quietly: `loadRules` refuses the
 * whole set. Dropping the one rule and computing the estimate anyway would print a number whose
 * composition nobody was told — the exact failure this card exists to prevent. `applyRules`
 * refuses as well, at its own door, so a hand-built set cannot sneak one past the loader.
 *
 * Determinism. Same rule set + same facts + same base → the same number, bit for bit:
 *
 *   - rules are evaluated in `id` order, never in file order, so reshuffling the JSON cannot move
 *     a floating-point sum;
 *   - nothing here reads the clock, the locale or `Math.random`; the caller supplies the facts;
 *   - a fact that is missing is not a default — the rule does not fire, and the estimate says so
 *     (`notApplied`). That is what makes "we do not know" different from "no".
 *
 * What this file deliberately does not know: which facts exist, what they mean, and any actual
 * medical rule. The fact vocabulary and the rule sets with real citations arrive with the scales
 * that use this engine (T15 SCORE2, T16 Lee index); the explanation UI arrives with T17. Until
 * then the only shipped rule files are synthetic fixtures under `tests/fixtures/rules/`.
 *
 * This is not a model and not a medical device: it is arithmetic over claims that carry sources.
 */

/** A fact is a value the document can supply. No nested objects: a fact is one comparison. */
export type FactValue = number | string | boolean

/** What the rules see: a flat record keyed by a fact name, e.g. `{ "age": 65, "sex": "male" }`. */
export type Facts = Record<string, FactValue>

/** How a leaf condition compares one fact. `in` takes a list, `exists` takes no value. */
export type Comparison = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'exists'

/**
 * A condition over the facts. `all` / `any` / `not` compose leaves; a leaf names one fact.
 *
 * `value` is required by every op but `exists`, and its shape is checked at load, not here: the
 * type stays one union so a hand-written rule file and a checked rule are the same shape.
 */
export type Predicate =
  | { fact: string; op: Comparison; value?: FactValue | FactValue[] }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }

/** One rule. Exactly the five fields of the card, no more — a rule is not a place for notes. */
export type Rule = {
  id: string
  when: Predicate
  delta: number
  source: string
  confidence: number
}

/**
 * A loaded set: rules plus the scale they adjust.
 *
 * The version is not decoration. It is the only thing that says what a delta is measured in, and
 * it travels with the rules: `applyRules` takes the set, never a bare array, and copies `version`
 * into the estimate. So every number this engine prints names its scale, and there is no call
 * that takes two sets — one call, one scale, one unit.
 *
 * That is the whole of the guarantee. The engine cannot stop a caller who gathers rules from two
 * sets by hand and writes `{ version: "score2-10y/1", rules: [...score2.rules, ...lee.rules] }`:
 * that is a set whose label is false, and it is false in the diff that wrote it. What the shape
 * does stop is the quiet version — passing concatenated rules as a plain array, which the engine
 * refuses because the array carries no scale at all.
 */
export type RuleSet = { version: string; rules: readonly Rule[] }

/** Why a rule that did not fire did not fire. Shown to a reader, so it is a closed list. */
export type SkipReason = 'missing-fact' | 'type-mismatch' | 'no-match'

/** The three answers a condition over the facts can give: true, false, or undecidable. */
export type PredicateVerdict = true | SkipReason

/** What one fired rule did to the number — Δ, cause and source link, which is what T17 shows. */
export type Contribution = {
  rule: string
  when: Predicate
  delta: number
  source: string
  confidence: number
}

export type Estimate = {
  /** The scale this number is on, copied from the set: its unit is the unit of every delta. */
  version: string
  base: number
  value: number
  delta: number
  /** The weakest confidence among the rules that fired; 1 when none did. */
  confidence: number
  /** Fired rules, in id order. */
  contributions: Contribution[]
  /** Rules that did not fire and why — the explicit "what the model ignores" of T16. */
  notApplied: Array<{ rule: string; reason: SkipReason }>
}

/** A refused rule set. Carries every problem, so one run names all of them. */
export class RuleError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(problems.join('\n'))
    this.name = 'RuleError'
    this.problems = problems
  }
}

const RULE_KEYS = new Set(['id', 'when', 'delta', 'source', 'confidence'])
const OPS: readonly Comparison[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'exists']

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const isFactValue = (value: unknown): value is FactValue =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/**
 * Is this fact known? Own property *and* a value of the fact type: a rule asking for `toString`
 * must get nothing, not a function, and a caller passing `undefined` has not supplied the fact.
 */
const known = (facts: Facts, fact: string): boolean => isFactValue(facts[fact])

/**
 * Load a rule set from parsed JSON. Refuses the whole set when any rule is wrong, because a
 * partially loaded set is a different estimate and nobody was told which rules went missing.
 */
export function loadRules(input: unknown): RuleSet {
  if (!isObject(input)) {
    throw new RuleError(['$: a rule set is a JSON object: { "version": "score2-10y/1", "rules": [...] }'])
  }

  const problems: string[] = []
  for (const key of Object.keys(input)) {
    if (key !== 'version' && key !== 'rules') {
      problems.push(`$: unknown key "${key}"; a rule set is version and rules`)
    }
  }
  const version = isNonEmptyString(input.version) ? input.version : ''
  if (version === '') {
    problems.push('$.version: a rule set names the scale it adjusts, e.g. "score2-10y/1" — two scales\' deltas must not be added by accident')
  }
  if (!Array.isArray(input.rules)) {
    problems.push('$.rules: a rule set is an array of rules')
    throw new RuleError(problems)
  }
  problems.push(...ruleSetProblems(input.rules, '$.rules'))
  if (problems.length > 0) throw new RuleError(problems)

  const rules = [...(input.rules as Rule[])].sort(byId)
  return { version, rules }
}

/**
 * Apply one rule set to the facts. `value = base + Σ delta`; the sum runs in id order so its
 * floating-point result does not depend on how the file happened to list the rules.
 *
 * The set, not the rules: a bare array has no `version`, so accepting one would let an estimate
 * leave the engine without naming its scale. A caller who has two sets has to hand-write a third
 * one to add them, and that third set's version is visible where it was written.
 */
export function applyRules(set: RuleSet, facts: Facts, base = 0): Estimate {
  const problems = ruleSetShapeProblems(set)
  if (!isObject(facts)) problems.unshift('facts: the facts are a flat record of numbers, strings and booleans')
  if (!Number.isFinite(base)) problems.unshift(`base: an estimate starts from a finite number, found ${String(base)}`)
  if (problems.length > 0) throw new RuleError(problems)

  const ordered = [...set.rules].sort(byId)
  const contributions: Contribution[] = []
  const notApplied: Array<{ rule: string; reason: SkipReason }> = []
  let delta = 0

  for (const rule of ordered) {
    const verdict = evaluatePredicate(rule.when, facts)
    if (verdict !== true) {
      notApplied.push({ rule: rule.id, reason: verdict })
      continue
    }
    contributions.push({
      rule: rule.id,
      when: rule.when,
      delta: rule.delta,
      source: rule.source,
      confidence: rule.confidence,
    })
    delta += rule.delta
  }

  const confidence = contributions.reduce((worst, item) => Math.min(worst, item.confidence), 1)
  return { version: set.version, base, value: base + delta, delta, confidence, contributions, notApplied }
}

const byId = (a: Rule, b: Rule): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The set's shape, at the engine's own door. Written for the misuse that matters — rules taken
 * from two sets and concatenated into one array — so the refusal says what to pass instead.
 */
function ruleSetShapeProblems(set: unknown): string[] {
  if (!isObject(set)) {
    return [
      Array.isArray(set)
        ? 'set: applyRules takes a rule set — { "version": "score2-10y/1", "rules": [...] } — not a bare array of rules; a number has to name the scale its deltas are in'
        : 'set: applyRules takes a rule set — { "version": "score2-10y/1", "rules": [...] }',
    ]
  }

  const problems: string[] = []
  if (!isNonEmptyString(set.version)) {
    problems.push('set.version: a rule set names the scale it adjusts, e.g. "score2-10y/1" — two scales\' deltas must not be added by accident')
  }
  if (!Array.isArray(set.rules)) {
    problems.push('set.rules: a rule set is an array of rules')
    return problems
  }
  problems.push(...ruleSetProblems(set.rules, 'set.rules'))
  return problems
}

/** Every reason a rule set may not load: the structure, and the ids that have to stay unique. */
function ruleSetProblems(rules: readonly unknown[], where: string): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  rules.forEach((rule, index) => {
    const path = `${where}[${index}]`
    problems.push(...ruleProblems(rule, path))
    if (isObject(rule) && isNonEmptyString(rule.id)) {
      if (seen.has(rule.id)) {
        problems.push(`${path} ("${rule.id}"): duplicate rule id — two rules under one id cannot be told apart in an explanation`)
      }
      seen.add(rule.id)
    }
  })

  return problems
}

function ruleProblems(rule: unknown, path: string): string[] {
  if (!isObject(rule)) return [`${path}: a rule is an object`]

  const problems: string[] = []
  const named = isNonEmptyString(rule.id) ? `${path} ("${rule.id}")` : path

  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.has(key)) {
      problems.push(`${named}: unknown key "${key}"; a rule is id, when, delta, source, confidence and nothing else`)
    }
  }
  if (!isNonEmptyString(rule.id)) problems.push(`${path}: missing id — an estimate change has to be nameable`)

  // The card's one hard promise, stated where a reader of the error sees it.
  if (rule.source === undefined || rule.source === null) {
    problems.push(`${named}: a rule without source does not load — it cannot move an estimate it cannot justify`)
  } else if (!isNonEmptyString(rule.source)) {
    problems.push(`${named}: source must be a non-empty string: a PMID, a DOI or a URL`)
  }

  if (typeof rule.delta !== 'number' || !Number.isFinite(rule.delta)) {
    problems.push(`${named}: delta must be a finite number`)
  }
  if (typeof rule.confidence !== 'number' || !Number.isFinite(rule.confidence) || rule.confidence < 0 || rule.confidence > 1) {
    problems.push(`${named}: confidence must be a number from 0 to 1`)
  }
  if (!('when' in rule)) {
    problems.push(`${named}: missing when — a rule with no condition applies to everyone`)
  } else {
    problems.push(...conditionProblems(rule.when, `${named}.when`))
  }

  return problems
}

/**
 * Every reason a condition over the facts is malformed — the checks a rule's `when` and a
 * prediction's `condition` share. Exported so the second reader of this language (`src/prediction.ts`)
 * refuses the same shapes with the same words, instead of growing a near-copy that drifts.
 */
export function conditionProblems(when: unknown, path: string): string[] {
  if (!isObject(when)) return [`${path}: a condition is an object`]

  const shapes = ['fact', 'all', 'any', 'not'].filter((key) => key in when)
  if (shapes.length === 0) {
    // An object with `op` and no `fact` is a comparison that forgot the thing being compared.
    return [
      'op' in when || 'value' in when
        ? `${path}.fact: a comparison names one fact`
        : `${path}: a condition is exactly one of fact, all, any or not — found none`,
    ]
  }
  if (shapes.length !== 1) {
    return [`${path}: a condition is exactly one of fact, all, any or not — found ${shapes.join(', ')}`]
  }

  const shape = shapes[0]
  if (shape === 'all' || shape === 'any') {
    const children = when[shape]
    if (!Array.isArray(children) || children.length === 0) {
      return [`${path}.${shape}: a condition that can never fire (an empty ${shape}) is a bug, not a rule`]
    }
    return children.flatMap((child, index) => conditionProblems(child, `${path}.${shape}[${index}]`))
  }
  if (shape === 'not') return conditionProblems(when.not, `${path}.not`)

  const leaf = when as { fact?: unknown; op?: unknown; value?: unknown }
  const problems: string[] = []
  for (const key of Object.keys(when)) {
    if (key !== 'fact' && key !== 'op' && key !== 'value') problems.push(`${path}: unknown key "${key}" in a comparison`)
  }
  if (!isNonEmptyString(leaf.fact)) problems.push(`${path}.fact: a comparison names one fact`)
  if (typeof leaf.op !== 'string' || !OPS.includes(leaf.op as Comparison)) {
    problems.push(`${path}.op: must be one of ${OPS.join(', ')}`)
    return problems
  }
  if (leaf.op === 'exists') {
    if ('value' in when) problems.push(`${path}: exists takes no value — it asks only whether the fact is there`)
    return problems
  }
  if (leaf.op === 'in') {
    if (!Array.isArray(leaf.value) || leaf.value.length === 0 || !leaf.value.every(isFactValue)) {
      problems.push(`${path}.value: in takes a non-empty list of numbers, strings or booleans`)
    }
    return problems
  }
  if (!isFactValue(leaf.value)) problems.push(`${path}.value: must be a number, a string or a boolean`)
  return problems
}

/**
 * Decide one condition over the facts. Exported because a prediction's `condition` is the same
 * language as a rule's `when` (`$defs.predicate` in the schema), and it has to get the same answer:
 * a forecast that is live only where a rule would fire is a forecast nobody can argue with.
 *
 * Three-valued, deliberately: a condition is true, false, or undecidable because a fact is missing
 * or of the wrong type. `not` over an undecidable condition stays undecidable — "we do not know
 * whether he is on a statin" is not "he is not on a statin", and a rule must never read it as one.
 */
export function evaluatePredicate(when: Predicate, facts: Facts): PredicateVerdict {
  if ('all' in when) {
    let unknown: SkipReason | undefined
    for (const child of when.all) {
      const verdict = evaluatePredicate(child, facts)
      if (verdict === true) continue
      if (verdict === 'no-match') return 'no-match'
      unknown = unknown ?? verdict
    }
    return unknown ?? true
  }

  if ('any' in when) {
    let unknown: SkipReason | undefined
    for (const child of when.any) {
      const verdict = evaluatePredicate(child, facts)
      if (verdict === true) return true
      if (verdict !== 'no-match') unknown = unknown ?? verdict
    }
    return unknown ?? 'no-match'
  }

  if ('not' in when) {
    const verdict = evaluatePredicate(when.not, facts)
    if (verdict === true) return 'no-match'
    if (verdict === 'no-match') return true
    return verdict
  }

  const fact = when.fact
  if (when.op === 'exists') return known(facts, fact) ? true : 'missing-fact'
  if (!known(facts, fact)) return 'missing-fact'

  const actual = facts[fact]
  const expected = when.value

  if (when.op === 'in') {
    const list = Array.isArray(expected) ? expected : []
    const comparable = list.filter((item) => typeof item === typeof actual)
    if (comparable.length === 0) return 'type-mismatch'
    return comparable.some((item) => item === actual) ? true : 'no-match'
  }

  if (Array.isArray(expected) || expected === undefined) return 'type-mismatch' // refused at load; kept total
  if (typeof expected !== typeof actual) return 'type-mismatch'
  if (when.op === 'eq') return actual === expected ? true : 'no-match'
  if (when.op === 'ne') return actual !== expected ? true : 'no-match'

  // Ordering is defined for numbers. A string compared with `>` is a type error, not a
  // lexicographic surprise: a rule that means "older than 50" must not fire on "sixty".
  if (typeof actual !== 'number' || typeof expected !== 'number') return 'type-mismatch'
  switch (when.op) {
    case 'lt':
      return actual < expected ? true : 'no-match'
    case 'le':
      return actual <= expected ? true : 'no-match'
    case 'gt':
      return actual > expected ? true : 'no-match'
    case 'ge':
      return actual >= expected ? true : 'no-match'
    default:
      return 'type-mismatch'
  }
}
