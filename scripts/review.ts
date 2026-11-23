#!/usr/bin/env bun
/**
 * Record a reviewer's verdict — the one thing CI will believe about the page.
 *
 *   bun scripts/review.ts --pass --conclusions "three columns, rails collapse, summary reads as a story" \
 *       --artifact review/artifacts/chat.log --artifact review/artifacts/page.png
 *   bun scripts/review.ts --fail --conclusions "the forecast panel is empty below the fold"
 *
 * Writes review/verdict.json against the current HEAD's surface. Commit it with the change it judged.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { surfaceOf } from './lib/review'

const args = process.argv.slice(2)
let passed: boolean | undefined
const conclusions: string[] = []
const artifacts: string[] = []
let named = ''

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--pass') passed = true
  else if (arg === '--fail') passed = false
  else if (arg === '--conclusions') conclusions.push(args[++i] ?? '')
  else if (arg === '--artifact') artifacts.push(args[++i] ?? '')
  else if (arg === '--reviewer') named = args[++i] ?? ''
  else if (arg === '--help' || arg === '-h') {
    console.log('usage: bun scripts/review.ts (--pass|--fail) --conclusions "..." [--reviewer NAME] [--artifact PATH]...')
    process.exit(0)
  } else {
    console.error(`unknown argument: ${arg}`)
    process.exit(2)
  }
}

if (passed === undefined) {
  console.error('say whether it passed: --pass or --fail')
  process.exit(2)
}
const said = conclusions.join(' ').trim()
if (said.length < 20) {
  console.error('say what you saw: --conclusions "..." (a sentence, not "ok")')
  process.exit(2)
}
for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    console.error(`no such artifact: ${artifact}`)
    process.exit(2)
  }
}

const reviewer = (() => {
  if (named) return named
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
})()
const tested = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

const verdict = {
  reviewer,
  when: new Date().toISOString(),
  passed,
  conclusions: said,
  surface: surfaceOf(process.cwd()),
  tested_sha: tested,
  artifacts,
}

mkdirSync('review', { recursive: true })
writeFileSync('review/verdict.json', `${JSON.stringify(verdict, null, 2)}\n`)
console.log(`wrote review/verdict.json: ${passed ? 'passed' : 'failed'} at surface ${verdict.surface}`)
console.log('commit it with the change it judged; the gate reads it on every push.')
