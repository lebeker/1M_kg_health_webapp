#!/usr/bin/env bun
/**
 * SCORE2 on the command line: the same model the page will call, given the six facts it needs.
 *
 *   bun scripts/score2.ts tests/fixtures/score2/profile-a-male-50-smoker.json --region=high
 *   bun run score2 <facts.json> --region=<low|moderate|high|very_high> [--json]
 *
 * Why it exists: a risk percentage is the number a person is most likely to act on, and the one
 * least likely to be re-checked. The output is the whole basis of it — the region, the
 * uncalibrated risk, the linear predictor with its standard error, every row of the arithmetic
 * and the published hazard ratio behind it, and what the model does not know — so a reviewer can
 * add up the same lines by hand, and the paper's worked example can be reproduced from a shell.
 *
 * The facts file is a flat JSON object, snake_case because that is how facts are named in the
 * document (`{"age": 50, "sex": "male", "current_smoker": true, "systolic_bp": 140,
 * "total_cholesterol": 6.3, "hdl_cholesterol": 1.4}`). There is no default region: the same person
 * has a different number in every region, and guessing one would be inventing the fact that
 * carries the largest effect.
 *
 * Exit 0 = a risk was printed, 1 = the input was refused, 2 = no facts file or no region named.
 */
import { readFileSync } from 'node:fs'
import { type Region, Score2Error, type Score2Input, type Score2Risk, score2 } from '../src/score2'

/** The facts file's names, and the model's. The only place the two vocabularies meet. */
const FIELDS: readonly { fact: string; input: keyof Score2Input }[] = [
  { fact: 'age', input: 'age' },
  { fact: 'sex', input: 'sex' },
  { fact: 'current_smoker', input: 'currentSmoker' },
  { fact: 'systolic_bp', input: 'systolicBp' },
  { fact: 'total_cholesterol', input: 'totalCholesterol' },
  { fact: 'hdl_cholesterol', input: 'hdlCholesterol' },
]

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/** Print a refusal as one header plus every problem, under the name of what was refused. */
function refuse(about: string, error: unknown): number {
  if (error instanceof Score2Error) {
    console.error(`refused: ${about} — ${error.problems.length} problem(s)`)
    for (const problem of error.problems) console.error(`  - ${problem}`)
    return 1
  }
  console.error(`refused: ${about} — ${error instanceof Error ? error.message : String(error)}`)
  return 1
}

/**
 * The facts file as the model's input. A key that is not one of the six is refused rather than
 * ignored: `hdl` typed for `hdl_cholesterol` would otherwise read as a missing HDL, which is a
 * different and much quieter failure.
 */
function toInput(raw: unknown): Score2Input {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Score2Error([
      'facts: a flat JSON object: {"age": 50, "sex": "male", "current_smoker": true, "systolic_bp": 140, "total_cholesterol": 6.3, "hdl_cholesterol": 1.4}',
    ])
  }

  const facts = raw as Record<string, unknown>
  const known = new Set(FIELDS.map((field) => field.fact))
  const input: Record<string, unknown> = {}

  for (const key of Object.keys(facts)) {
    // A fixture explains itself in a `note`; a model reads facts, so prose never reaches it.
    if (key === 'note') continue
    if (!known.has(key)) input[key] = facts[key] // let the model name it as an unknown key
  }
  for (const field of FIELDS) {
    if (facts[field.fact] !== undefined) input[field.input] = facts[field.fact]
  }
  return input as Score2Input
}

function percent(value: number): string {
  return `${value.toFixed(2)}%`
}

function printRisk(risk: Score2Risk): void {
  console.log('SCORE2 — 10-year risk of fatal and non-fatal cardiovascular disease')
  console.log(`  model        ${risk.version}`)
  console.log(`  region       ${risk.region}`)
  console.log(`  risk         ${percent(risk.risk)}   (95% interval ${percent(risk.interval.low)}–${percent(risk.interval.high)})`)
  console.log(`  uncalibrated ${percent(risk.uncalibrated)} before this region's recalibration`)
  console.log(`  predictor    ${risk.linearPredictor.toFixed(6)} (se ${risk.linearPredictorSe.toFixed(6)})`)
  console.log('  arithmetic:')
  for (const term of risk.terms) {
    console.log(`    ${term.name.padEnd(24)} ${term.value.toFixed(6).padStart(11)} × ${term.logHr.toFixed(4).padStart(8)} = ${term.contribution.toFixed(6).padStart(10)}`)
  }
  console.log('  what this number does not know:')
  for (const limit of risk.limits) console.log(`    - ${limit}`)
}

function main(argv: string[]): number {
  const regionFlag = argv.find((arg) => arg.startsWith('--region='))
  const region = regionFlag?.slice('--region='.length)
  const asJson = argv.includes('--json')
  const files = argv.filter((arg) => !arg.startsWith('-'))

  if (files.length === 0) {
    console.error('usage: bun scripts/score2.ts <facts.json> --region=<low|moderate|high|very_high> [--json]')
    return 2
  }
  if (region === undefined) {
    console.error('refused: --region — SCORE2 recalibrates to a risk region; there is no default')
    return 2
  }
  if (files.length > 1) {
    return refuse(files.slice(1).join(', '), new Error('expected one facts file'))
  }

  let input: Score2Input
  try {
    input = toInput(readJson(files[0]))
  } catch (error) {
    return refuse(files[0], error)
  }

  let risk: Score2Risk
  try {
    risk = score2(input, region as Region)
  } catch (error) {
    return refuse(files[0], error)
  }

  if (asJson) console.log(JSON.stringify(risk, null, 2))
  else printRisk(risk)
  return 0
}

process.exit(main(process.argv.slice(2)))
