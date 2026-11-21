#!/usr/bin/env bun
/**
 * Contract gate (G1) — the `kg/1` rules over fixtures.
 *
 *   bun scripts/validate-kg-fixtures.ts              # tests/fixtures/kg/{valid,invalid}
 *   bun scripts/validate-kg-fixtures.ts some.json    # any document you name must conform
 *
 * A fixture in `valid/` must produce no issues. A fixture in `invalid/` must produce at least one,
 * and the failure is printed with its reasons. The invalid half is the point: a checker that cannot
 * go red is a checker that never fails, and the two halves are read from the same directory so
 * neither can be quietly dropped.
 *
 * Exit 0 = both halves behave, 1 = the contract is broken (or the fixtures stopped testing it).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type Issue, validateKg } from './lib/kg-contract'

const FIXTURES = 'tests/fixtures/kg'

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
    if (valid.length === 0) {
      console.error(`FAIL: no valid fixtures in ${FIXTURES}/valid`)
      return 1
    }
    if (invalid.length === 0) {
      console.error(`FAIL: no invalid fixtures in ${FIXTURES}/invalid — the checker is untested`)
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

  console.log(`\n${results.length} fixture(s), ${failures} failure(s)`)
  return failures === 0 ? 0 : 1
}

process.exit(main(process.argv.slice(2)))
