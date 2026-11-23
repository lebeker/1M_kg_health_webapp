#!/usr/bin/env bun
/**
 * Review gate — the pipeline's only e2e claim.
 *
 *   bun scripts/review-gate.ts            # judge review/verdict.json against HEAD
 *
 * GitHub runs no model, so it cannot run the skill. What it can check is that a person did, against
 * this page, and that they said it passed. Red when the verdict is missing, failed, or covers a
 * different surface than HEAD (see scripts/lib/review.ts).
 */
import { existsSync, readFileSync } from 'node:fs'
import { judge, parseVerdict, surfaceOf } from './lib/review'

const root = process.cwd()
const file = 'review/verdict.json'

if (!existsSync(file)) {
  console.error(`no verdict: ${file} is missing.`)
  console.error('Run the e2e (clone lebeker/1M_kg_skill into an empty dir, render this template with a')
  console.error('kg.json, open the page, look at it), then record what you saw:')
  console.error('  bun scripts/review.ts --pass --conclusions "..." --artifact <chat log or screenshot>')
  process.exit(1)
}

const parsed = parseVerdict(readFileSync(file, 'utf8'))
if (typeof parsed === 'string') {
  console.error(parsed)
  process.exit(1)
}

const surface = surfaceOf(root)
const verdict = judge(parsed, surface, (path) => existsSync(path))
console.log(`surface ${surface}; verdict covers ${parsed.surface}`)
if (!verdict.ok) {
  console.error(verdict.reason)
  process.exit(1)
}
console.log(`pass: ${verdict.reason}`)
