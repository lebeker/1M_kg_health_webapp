#!/usr/bin/env bun
/**
 * The Lee index on the command line: the same twelve weights the page will call, given the twelve
 * facts they are weights for.
 *
 *   bun scripts/lee.ts tests/fixtures/lee/profile-b-man-80-heavy.json
 *   bun run lee <facts.json> [--json]
 *
 * Why it exists: an index of points is easy to add up wrongly and hard to argue with afterwards.
 * The output is the whole basis of the number — the scale, the points against the published
 * ceiling, the band the paper printed, every item that scored with its weight and its citation,
 * every item that was supplied and did not score, every fact that was given and not read, and what
 * the model does not know — so a reviewer can add the same lines by hand from the paper's table.
 *
 * The facts file is a flat JSON object, snake_case because that is how facts are named in the
 * document. A `note` key explains the fixture to a human and is dropped before the index sees it;
 * nothing else is dropped, because a fact nobody read is a fact somebody meant to supply.
 *
 * Exit 0 = an index was printed, 1 = the facts were refused (the message names every missing or
 * malformed item), 2 = no facts file named or more than one.
 */
import { readFileSync } from 'node:fs'
import { type LeeIndex, LeeError, lee } from '../src/lee'

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/** Print a refusal as one header plus every problem, under the name of what was refused. */
function refuse(about: string, error: unknown): number {
  if (error instanceof LeeError) {
    console.error(`refused: ${about} — ${error.problems.length} problem(s)`)
    for (const problem of error.problems) console.error(`  - ${problem}`)
    return 1
  }
  console.error(`refused: ${about} — ${error instanceof Error ? error.message : String(error)}`)
  return 1
}

/** The band as the paper prints it: a range of points, then the group's observed mortality. */
function bandLabel(index: LeeIndex): string {
  const { from, to, printed } = index.band
  const range = to === null ? `${from} points or more` : `${from}–${to} points`
  return `${range}: ${printed} 4-year mortality in the validation cohort`
}

function printIndex(index: LeeIndex): void {
  console.log('Lee index — 4-year mortality in points, not a percentage')
  console.log(`  index        ${index.points} of ${index.maxPoints} points`)
  console.log(`  scale        ${index.version}   (${index.source.pmid})`)
  console.log(`  band         ${bandLabel(index)}`)
  console.log(`  deficits     ${index.deficits.length} item(s) scored:`)
  for (const deficit of index.deficits) {
    const unit = deficit.points === 1 ? 'pt ' : 'pts'
    console.log(
      `    ${deficit.rule.padEnd(36)} ${deficit.label.padEnd(40)} ${String(deficit.points).padStart(2)} ${unit}  ${deficit.source}`,
    )
  }
  console.log(`  absent       ${index.absent.length} row(s) supplied and not present:`)
  for (const row of index.absent) {
    console.log(`    ${row.rule.padEnd(36)} ${row.label.padEnd(40)} ${row.reason}`)
  }
  console.log(
    index.ignored.length === 0
      ? '  ignored      nothing — every fact given is read by this index'
      : `  ignored      given but not read by this index: ${index.ignored.join(', ')}`,
  )
  console.log('  what this number does not know:')
  for (const limit of index.limits) console.log(`    - ${limit}`)
}

/**
 * The facts file as the index's input. A `note` is fixture prose, never a fact; everything else is
 * passed through, including keys the index does not read, so they are named in `ignored` instead of
 * vanishing.
 */
function toFacts(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const facts: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'note') continue
    facts[key] = value
  }
  return facts
}

function main(argv: string[]): number {
  const asJson = argv.includes('--json')
  const files = argv.filter((arg) => !arg.startsWith('-'))

  if (files.length === 0) {
    console.error('usage: bun scripts/lee.ts <facts.json> [--json]')
    return 2
  }
  if (files.length > 1) {
    return refuse(files.slice(1).join(', '), new Error('expected one facts file'))
  }

  let index: LeeIndex
  try {
    index = lee(toFacts(readJson(files[0])))
  } catch (error) {
    return refuse(files[0], error)
  }

  if (asJson) console.log(JSON.stringify(index, null, 2))
  else printIndex(index)
  return 0
}

process.exit(main(process.argv.slice(2)))
