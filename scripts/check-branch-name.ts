#!/usr/bin/env bun
/**
 * Branch name gate.
 *
 *   bun scripts/check-branch-name.ts feat/SCRUM-15_schema-validator
 *   bun scripts/check-branch-name.ts                 # reads GITHUB_HEAD_REF, or `git branch --show-current`
 *   bun scripts/check-branch-name.ts --self-test     # the rule's own cases, no git needed
 *
 * Exit 0 when the name complies, 1 when it does not (with the reason on stderr).
 * CI runs this on every pull request; a worker can run it before pushing.
 */
import { execFileSync } from 'node:child_process'
import { checkBranchName } from './lib/branch-name'

function currentBranch(): string {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const SELF_TEST_CASES: Array<[string, boolean]> = [
  ['feat/SCRUM-15', true],
  ['feat/SCRUM-15_schema-validator', true],
  ['fix/SCRUM-12_panel-camera', true],
  ['chore/SCRUM-40_delivery-workflow', true],
  ['fix/PROJ2-7', true],
  ['main', true],
  ['feat/scrum-15', false],
  ['feat/SCRUM-15schema', false],
  ['feat/SCRUM-15_', false],
  ['feat/SCRUM-15_Bad-Desc', false],
  ['feat/SCRUM-15_two_words', false],
  ['lead/delivery-loop', false],
  ['SCRUM-15', false],
  ['feat/15', false],
  ['', false],
]

function selfTest(): number {
  let failed = 0
  for (const [branch, expected] of SELF_TEST_CASES) {
    const got = checkBranchName(branch).ok
    if (got !== expected) {
      failed += 1
      console.error(`  FAIL ${JSON.stringify(branch)}: expected ${expected ? 'accepted' : 'rejected'}, got the opposite`)
    }
  }
  if (failed) {
    console.error(`${failed} of ${SELF_TEST_CASES.length} cases failed`)
    return 1
  }
  console.log(`branch-name rule: ${SELF_TEST_CASES.length} cases pass`)
  return 0
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

const branch = process.argv[2] ?? currentBranch()
const result = checkBranchName(branch)
if (result.ok) {
  console.log(
    result.exempt
      ? `branch "${result.branch}" is the default branch — the rule does not apply`
      : `branch "${result.branch}" is valid: ${result.type}/${result.ticket}${result.description ? ` (${result.description})` : ''}`,
  )
  process.exit(0)
}

console.error(`branch "${result.branch}" does not follow the rule: ${result.reason}`)
console.error('rule: (fix|feat|chore)/<JIRA-TICKET>_<optional-short-description>, e.g. feat/SCRUM-15_schema-validator')
process.exit(1)
