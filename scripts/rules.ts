#!/usr/bin/env bun
/**
 * An estimate, on the command line: the same engine the page will call, given a rule file and a
 * bag of facts.
 *
 *   bun scripts/rules.ts tests/fixtures/rules/synthetic.json tests/fixtures/rules/synthetic-facts.json
 *   bun run rules <rules.json> [facts.json] [--base=<number>]
 *
 * Why it exists: "the model said" is not reproducible, but two runs of this are. The output is the
 * whole basis of the number — scale, base, Δ, every rule that fired with its citation, and every
 * rule that did not fire with its reason — so a reviewer can re-run the same two files and get the
 * same bytes, and a new rule can be argued about in a diff instead of in prose.
 *
 * Facts are a flat JSON object (`{"age": 65, "sex": "male"}`); no facts file means no facts, which
 * is a valid (and honest) input: nothing fires, the base is the estimate.
 *
 * Exit 0 = an estimate was printed, 1 = a rule set or input was refused, 2 = no rule file named.
 * A refusal names the file it is about: a bad `--base` is not the rule file's fault and does not
 * say it is.
 */
import { readFileSync } from 'node:fs'
import { type Estimate, type Facts, RuleError, type RuleSet, applyRules, loadRules } from '../src/rules'

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    // The refusal header already names the path; the message only says what is wrong with it.
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/** Print a refusal as one header plus every problem, under the name of what was refused. */
function refuse(about: string, error: unknown): number {
  if (error instanceof RuleError) {
    console.error(`refused: ${about} — ${error.problems.length} problem(s)`)
    for (const problem of error.problems) console.error(`  - ${problem}`)
    return 1
  }
  console.error(`refused: ${about} — ${error instanceof Error ? error.message : String(error)}`)
  return 1
}

function main(argv: string[]): number {
  const baseFlag = argv.find((arg) => arg.startsWith('--base='))
  const baseText = baseFlag === undefined ? '0' : baseFlag.slice('--base='.length)
  const base = Number(baseText)
  const files = argv.filter((arg) => !arg.startsWith('-'))

  if (files.length === 0) {
    console.error('usage: bun scripts/rules.ts <rules.json> [facts.json] [--base=<number>]')
    return 2
  }

  const [rulesPath, factsPath] = files
  if (!Number.isFinite(base)) return refuse(`--base=${baseText}`, new Error('an estimate starts from a finite number'))
  if (files.length > 2) return refuse(files.slice(2).join(', '), new Error('expected one rule file and one facts file'))

  let set: RuleSet
  try {
    set = loadRules(readJson(rulesPath))
  } catch (error) {
    return refuse(rulesPath, error)
  }

  let facts: Facts = {}
  if (factsPath !== undefined) {
    try {
      const parsed = readJson(factsPath)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return refuse(factsPath, new Error('facts are a flat JSON object: {"age": 65, "sex": "male"}'))
      }
      facts = parsed as Facts
    } catch (error) {
      return refuse(factsPath, error)
    }
  }

  let estimate: Estimate
  try {
    estimate = applyRules(set, facts, base)
  } catch (error) {
    // The engine's own refusals are about the set it was given, which is the file we loaded.
    return refuse(rulesPath, error)
  }

  console.log(JSON.stringify(estimate, null, 2))
  return 0
}

process.exit(main(process.argv.slice(2)))
