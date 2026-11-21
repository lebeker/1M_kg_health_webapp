#!/usr/bin/env bun
/**
 * Contract gate (G1) — the `kg/1-health` contract over fixtures.
 *
 *   bun scripts/validate-kg-fixtures.ts              # tests/fixtures/kg/{valid,invalid}
 *   bun scripts/validate-kg-fixtures.ts some.json    # any document you name must conform
 *
 * A fixture in `valid/` must produce no issues. A fixture in `invalid/` must produce at least one,
 * and the failure is printed with its reasons. The invalid half is the point: a checker that cannot
 * go red is a checker that never fails, and the two halves are read from the same directory so
 * neither can be quietly dropped. T04 named six fixtures — three valid, three invalid — so the
 * directory is required to hold at least that many of each: a suite that lost its teeth fails here
 * rather than passing quietly.
 *
 * The contract is `scripts/schema/kg-1-health.schema.json`, read from disk; this runs headless,
 * needs no network and no `node_modules`, and exits non-zero on a bad fixture.
 *
 * Exit 0 = both halves behave, 1 = the contract is broken (or the fixtures stopped testing it).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type Issue, HEALTH_SCHEMA_VERSION, validateKg } from './lib/kg-contract'

const FIXTURES = 'tests/fixtures/kg'
const MIN_VALID = 3
const MIN_INVALID = 3

type Result = { file: string; ok: boolean; issues: Issue[] }

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function collect(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(dir, name))
      .sort()
  } catch {
    return []
  }
}

function main(argv: string[]): number {
  const named = argv.filter((arg) => !arg.startsWith('-'))
  const results: Result[] = []
  let failures = 0

  console.log(`contract kg/1-health ${HEALTH_SCHEMA_VERSION}`)

  if (named.length > 0) {
    for (const file of named) {
      const issues = validateKg(readJson(file))
      results.push({ file, ok: issues.length === 0, issues })
      if (issues.length > 0) failures += 1
    }
  } else {
    if (!statSync(FIXTURES, { throwIfNoEntry: false })) {
      console.error(`FAIL: no fixture directory at ${FIXTURES}; the gate has nothing to check`)
      return 1
    }

    const valid = collect(join(FIXTURES, 'valid'))
    const invalid = collect(join(FIXTURES, 'invalid'))
    if (valid.length < MIN_VALID) {
      console.error(`FAIL: ${valid.length} valid fixture(s) in ${FIXTURES}/valid, the card names ${MIN_VALID}`)
      return 1
    }
    if (invalid.length < MIN_INVALID) {
      console.error(`FAIL: ${invalid.length} invalid fixture(s) in ${FIXTURES}/invalid — the checker is undertested`)
      return 1
    }

    for (const file of valid) {
      const issues = validateKg(readJson(file))
      results.push({ file, ok: issues.length === 0, issues })
      if (issues.length > 0) failures += 1
    }
    for (const file of invalid) {
      const issues = validateKg(readJson(file))
      const rejected = issues.length > 0
      // A fixture that stops being rejected means the rule behind it stopped being enforced.
      results.push({ file: `${file} (must be rejected)`, ok: rejected, issues })
      if (!rejected) failures += 1
    }
  }

  const width = Math.max(...results.map((r) => r.file.length))
  for (const result of results) {
    console.log(`${result.ok ? '  ok  ' : ' FAIL '} ${result.file.padEnd(width)}  ${result.issues.length} issue(s)`)
    for (const issue of result.issues.slice(0, 6)) {
      console.log(`         ${issue.path}: ${issue.message}`)
    }
    if (result.issues.length > 6) console.log(`         … and ${result.issues.length - 6} more`)
  }

  const accepted = results.filter((r) => !r.file.endsWith('(must be rejected)')).length
  const summary = named.length > 0 ? `${results.length} document(s)` : `${results.length} fixture(s) (${accepted} valid, ${results.length - accepted} invalid)`
  console.log(`\n${summary}, ${failures} failure(s)`)
  return failures === 0 ? 0 : 1
}

process.exit(main(process.argv.slice(2)))
