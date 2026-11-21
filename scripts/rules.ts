#!/usr/bin/env bun
/**
 * An estimate, on the command line: the same engine the page will call, given a rule file and a
 * bag of facts.
 *
 *   bun scripts/rules.ts tests/fixtures/rules/synthetic.json tests/fixtures/rules/synthetic-facts.json
 *   bun run rules <rules.json> [facts.json] [--base=<number>]
 *
 * Why it exists: "the model said" is not reproducible, but two runs of this are. The output is the
 * whole basis of the number — base, Δ, every rule that fired with its citation, and every rule
 * that did not fire with its reason — so a reviewer can re-run the same two files and get the same
 * bytes, and a new rule can be argued about in a diff instead of in prose.
 *
 * Facts are a flat JSON object (`{"age": 65, "sex": "male"}`); no facts file means no facts, which
 * is a valid (and honest) input: nothing fires, the base is the estimate.
 *
 * Exit 0 = an estimate was printed, 1 = a rule set or input was refused, 2 = no rule file named.
 */
import { readFileSync } from 'node:fs'
import { type Facts, RuleError, applyRules, loadRules } from '../src/rules'

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function main(argv: string[]): number {
  const baseFlag = argv.find((arg) => arg.startsWith('--base='))
  const base = baseFlag === undefined ? 0 : Number(baseFlag.slice('--base='.length))
  const files = argv.filter((arg) => !arg.startsWith('-'))

  if (files.length === 0) {
    console.error('usage: bun scripts/rules.ts <rules.json> [facts.json] [--base=<number>]')
    return 2
  }

  try {
    const set = loadRules(readJson(files[0]))
    const facts = files[1] === undefined ? {} : (readJson(files[1]) as Facts)
    const estimate = applyRules(set.rules, facts, base)
    console.log(JSON.stringify({ version: set.version, ...estimate }, null, 2))
    return 0
  } catch (error) {
    if (error instanceof RuleError) {
      console.error(`refused: ${files[0]} does not load — ${error.problems.length} problem(s)`)
      for (const problem of error.problems) console.error(`  - ${problem}`)
      return 1
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

process.exit(main(process.argv.slice(2)))
