#!/usr/bin/env bun
/**
 * Why the number moved, on the command line: the same rows a drift view would draw, without one.
 *
 *   bun run explain rules <set.json> <before.json> <after.json> --unit=points
 *   bun run explain score2 <before.json> <after.json> --region=high
 *
 * Why it exists: T17's promise is that every change of an estimate carries a Δ, a cause and a
 * source link. A promise about what a reader is shown is checked by printing the rows and reading
 * them, and the drift view that will draw them is T13 in the plan — parked behind the owner's
 * decision, not something this card can build. Until it exists, this command is where the rows can
 * be seen, and the evidence that they add up to the change.
 *
 * Two shapes because there are two models (see src/explain.ts and docs/EXPLANATIONS.md): `rules` for
 * an additive scale such as the Lee index, `score2` for the coefficient model. They are not
 * interchangeable and this command will not print one in the other's shape.
 *
 * Exit 0 = an explanation was printed (a change or none), 1 = refused (the message names every
 * problem), 2 = usage: a missing file, no unit, no region.
 */
import { readFileSync } from 'node:fs'
import {
  ExplainError,
  type RuleDriver,
  type RulesExplanation,
  type Score2Driver,
  type Score2Explanation,
  explainRules,
  explainScore2,
} from '../src/explain'
import { LEE_RULES, type LeeIndex, lee } from '../src/lee'
import { type Facts, type RuleSet, loadRules } from '../src/rules'
import { type Region, REGIONS, Score2Error, inputFromFacts } from '../src/score2'

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/** Print a refusal as one header plus every problem, under the name of what was refused. */
function refuse(about: string, error: unknown): number {
  if (error instanceof ExplainError || error instanceof Score2Error) {
    console.error(`refused: ${about} — ${error.problems.length} problem(s)`)
    for (const problem of error.problems) console.error(`  - ${problem}`)
    return 1
  }
  console.error(`refused: ${about} — ${error instanceof Error ? error.message : String(error)}`)
  return 1
}

/** A fact as a row reads it: prose for the two absences, the value itself otherwise. */
function factText(value: unknown): string {
  if (value === null || value === undefined) return 'not supplied'
  return JSON.stringify(value)
}

/** A delta with its sign, so a reader can see which way the number went without reading the total. */
function signed(value: number, places: number): string {
  const text = value.toFixed(places)
  return value > 0 ? `+${text}` : text
}

function evidenceLines(evidence: readonly { fact: string; before: unknown; after: unknown }[]): string[] {
  return evidence.map((change) => `because ${change.fact}: ${factText(change.before)} → ${factText(change.after)}`)
}

function printRuleDriver(driver: RuleDriver, unit: string): void {
  const verdict = driver.kind === 'started' ? 'now fires' : 'no longer fires'
  const reason = driver.reason === undefined ? '' : ` (${driver.reason})`
  console.log(
    `    ${driver.cause.padEnd(36)} ${signed(driver.delta, 3).padStart(9)} ${unit.padEnd(20)} ${verdict}${reason}`,
  )
  console.log(`      ${driver.source}`)
  console.log(`      ${driver.link}`)
  for (const line of evidenceLines(driver.evidence)) console.log(`      ${line}`)
}

/** The bands as a reader needs them: which group of the paper the index is in at each date. */
function bandText(index: LeeIndex): string {
  const { from, to, printed } = index.band
  const range = to === null ? `${from} points or more` : `${from}–${to} points`
  return `${range}: ${printed} 4-year mortality in the validation cohort`
}

/** A fixture explains itself in a `note`; a model reads facts, so prose never reaches it. */
function withoutNote(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw as Record<string, unknown>
  const facts: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'note') facts[key] = value
  }
  return facts
}

function printRules(explanation: RulesExplanation): void {
  console.log(
    `  before       ${explanation.before.value}${explanation.base === 0 ? '' : ` (base ${explanation.base})`} · ${explanation.before.fired} rule(s) fired`,
  )
  console.log(`  after        ${explanation.after.value} · ${explanation.after.fired} rule(s) fired`)
  console.log(`  change       ${signed(explanation.change, 3)} ${explanation.unit}`)
  if (explanation.drivers.length === 0) {
    console.log('  rows         none — nothing this scale reads is different between the two dates')
  } else {
    console.log(`  rows         ${explanation.drivers.length}, each one a rule that started or stopped firing:`)
    for (const driver of explanation.drivers) printRuleDriver(driver, explanation.unit)
    const sum = explanation.drivers.reduce((total, driver) => total + driver.delta, 0)
    console.log(`  sum of rows  ${signed(sum, 3)} ${explanation.unit} — the same number as the change`)
  }
  console.log(
    explanation.unchanged.length === 0
      ? '  unchanged    no rule fired at both dates'
      : `  unchanged    ${explanation.unchanged.length} rule(s) fired at both dates, same weight: ${explanation.unchanged.join(', ')}`,
  )
}

function printScore2Driver(driver: Score2Driver): void {
  console.log(
    `    ${signed(driver.delta, 3).padStart(9)} pp         ${driver.cause.padEnd(28)} ×${driver.hazardRatio.toFixed(3)} (log HR ${signed(driver.logHrDelta, 4)})`,
  )
  console.log(`              ${driver.source}`)
  console.log(`              ${driver.link}`)
  for (const line of evidenceLines(driver.evidence)) console.log(`              ${line}`)
}

function printScore2(explanation: Score2Explanation): void {
  const percent = (value: number): string => `${value.toFixed(2)}%`
  console.log(`estimate change — ${explanation.scale}, in ${explanation.unit}`)
  console.log(`  region       ${explanation.region}`)
  console.log(
    `  before       ${percent(explanation.before.risk)} · linear predictor ${explanation.before.linearPredictor.toFixed(6)}`,
  )
  console.log(
    `  after        ${percent(explanation.after.risk)} · linear predictor ${explanation.after.linearPredictor.toFixed(6)}`,
  )
  console.log(
    `  change       ${signed(explanation.change, 3)} percentage points (linear predictor ${signed(explanation.linearPredictorChange, 6)})`,
  )
  if (explanation.drivers.length === 0) {
    console.log("  rows         none — not one of the model's inputs is different between the two dates")
  } else {
    console.log(`  rows         ${explanation.drivers.length}, in Supplementary Table 2's order:`)
    for (const driver of explanation.drivers) printScore2Driver(driver)
    const sum = explanation.drivers.reduce((total, driver) => total + driver.delta, 0)
    const logSum = explanation.drivers.reduce((total, driver) => total + driver.logHrDelta, 0)
    console.log(`  sum of rows  ${signed(sum, 3)} percentage points — the same number as the change`)
    console.log(`               ${signed(logSum, 6)} log-hazard — the same number as the predictor's change`)
  }
  console.log(
    explanation.unchanged.length === 0
      ? '  unchanged    no term of the model moved'
      : `  unchanged    ${explanation.unchanged.length} term(s) identical at both dates: ${explanation.unchanged.join(', ')}`,
  )
  console.log(`  method       ${explanation.method}`)
  console.log('  what this number does not know:')
  for (const limit of explanation.limits) console.log(`    - ${limit}`)
}

/** The flag's value, or undefined. Flags are the only arguments that start with `--`. */
function flag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const found = argv.find((arg) => arg.startsWith(prefix))
  return found?.slice(prefix.length)
}

function main(argv: string[]): number {
  const [shape, ...rest] = argv
  const asJson = rest.includes('--json')
  const files = rest.filter((arg) => !arg.startsWith('-'))

  if (shape === 'lee') {
    if (files.length !== 2) {
      console.error('usage: bun scripts/explain.ts lee <before.json> <after.json> [--json]')
      return 2
    }

    let explanation: RulesExplanation
    let beforeIndex: LeeIndex
    let afterIndex: LeeIndex
    try {
      const beforeFacts = withoutNote(readJson(files[0]))
      const afterFacts = withoutNote(readJson(files[1]))
      // The index itself first: it refuses a person with a missing item, and an explanation of a
      // change between two numbers that were never allowed to exist would be a story about nothing.
      beforeIndex = lee(beforeFacts)
      afterIndex = lee(afterFacts)
      explanation = explainRules(LEE_RULES, {
        unit: 'points',
        before: beforeFacts as Facts,
        after: afterFacts as Facts,
      })
    } catch (error) {
      return refuse(`${files[0]} → ${files[1]}`, error)
    }

    const bandMoved = beforeIndex.band.from !== afterIndex.band.from || beforeIndex.band.to !== afterIndex.band.to
    if (asJson) {
      console.log(JSON.stringify({ band: { before: beforeIndex.band, after: afterIndex.band }, ...explanation }, null, 2))
      return 0
    }
    console.log(`estimate change — ${explanation.scale}, in ${explanation.unit} (the Lee index)`)
    console.log(`  band         ${bandText(beforeIndex)}`)
    console.log(bandMoved ? `            →  ${bandText(afterIndex)}` : '               (the band did not change)')
    printRules(explanation)
    return 0
  }

  if (shape === 'rules') {
    const unit = flag(rest, 'unit')
    if (files.length !== 3 || unit === undefined) {
      console.error(
        'usage: bun scripts/explain.ts rules <set.json> <before.json> <after.json> --unit=<points|percentage points|a year> [--json]',
      )
      return 2
    }
    const base = Number(flag(rest, 'base') ?? 0)
    if (!Number.isFinite(base)) {
      console.error('refused: --base — an estimate starts from a finite number')
      return 2
    }

    let explanation: RulesExplanation
    let set: RuleSet
    try {
      set = loadRules(readJson(files[0]))
      // The engine validates the facts record itself and names what is wrong with it; a cast is
      // not a check, it is how an unknown JSON document reaches a function that will check it.
      const before = readJson(files[1]) as Facts
      const after = readJson(files[2]) as Facts
      explanation = explainRules(set, { unit, before, after, base })
    } catch (error) {
      return refuse(`${files[1]} → ${files[2]}`, error)
    }

    if (asJson) console.log(JSON.stringify(explanation, null, 2))
    else {
      console.log(`estimate change — ${explanation.scale}, in ${explanation.unit}`)
      printRules(explanation)
    }
    return 0
  }

  if (shape === 'score2') {
    const region = flag(rest, 'region')
    if (files.length !== 2 || region === undefined) {
      console.error(
        'usage: bun scripts/explain.ts score2 <before.json> <after.json> --region=<low|moderate|high|very_high> [--json]',
      )
      return 2
    }
    if (!REGIONS.includes(region as Region)) {
      console.error(`refused: --region — must be one of ${REGIONS.join(', ')}; there is no default`)
      return 2
    }

    let explanation: Score2Explanation
    try {
      explanation = explainScore2({
        before: inputFromFacts(readJson(files[0])),
        after: inputFromFacts(readJson(files[1])),
        region: region as Region,
      })
    } catch (error) {
      return refuse(`${files[0]} → ${files[1]}`, error)
    }

    if (asJson) console.log(JSON.stringify(explanation, null, 2))
    else printScore2(explanation)
    return 0
  }

  console.error('usage: bun scripts/explain.ts <rules|score2> …   (see the header of scripts/explain.ts)')
  return 2
}

process.exit(main(process.argv.slice(2)))
