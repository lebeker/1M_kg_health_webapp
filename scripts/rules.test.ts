/**
 * The rule-file gate, through the door a reader actually uses: the CLI.
 *
 * `src/rules.test.ts` proves the loader and the engine. This proves that the same two promises
 * survive the boundary — a rule file without a citation exits non-zero and prints why, and a good
 * file prints an estimate that is byte-identical on the second run. A library that refuses a bad
 * rule but a CLI that swallows the refusal would be a policy with no enforcement.
 *
 *   bun test scripts/rules.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RULES = 'tests/fixtures/rules/synthetic.json'
const FACTS = 'tests/fixtures/rules/synthetic-facts.json'

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const done = Bun.spawnSync(['bun', 'scripts/rules.ts', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() }
}

describe('bun run rules', () => {
  test('prints the whole basis of the number, and the same bytes on a second run', () => {
    const first = run([RULES, FACTS, '--base=2'])
    expect(first.exitCode).toBe(0)
    const estimate = JSON.parse(first.stdout) as {
      version: string
      base: number
      value: number
      delta: number
      confidence: number
      contributions: Array<{ rule: string; source: string }>
      notApplied: Array<{ rule: string; reason: string }>
    }
    expect(estimate.version).toBe('demo-rules/1')
    expect(estimate.base).toBe(2)
    expect(estimate.value).toBeCloseTo(2.3, 10)
    expect(estimate.delta).toBeCloseTo(0.3, 10)
    expect(estimate.confidence).toBe(0.5)
    expect(estimate.contributions.map((item) => item.rule)).toEqual(['demo-male', 'demo-older-and-flagged'])
    expect(estimate.contributions.every((item) => item.source.startsWith('synthetic:'))).toBe(true)
    expect(estimate.notApplied).toEqual([{ rule: 'demo-existing-condition', reason: 'missing-fact' }])
    expect(run([RULES, FACTS, '--base=2']).stdout).toBe(first.stdout)
  })

  test('a rule file without a source is refused at the boundary, non-zero, with the reason', () => {
    const bad = run(['tests/fixtures/rules/no-source.json', FACTS])
    expect(bad.exitCode).toBe(1)
    expect(bad.stdout).toBe('')
    expect(bad.stderr).toContain('does not load')
    expect(bad.stderr).toContain('a rule without source does not load')
    expect(bad.stderr).toContain('rule-without-source')
  })

  test('with no facts nothing fires, and the base is what is printed', () => {
    const bare = run([RULES, 'tests/fixtures/rules/does-not-exist.json'])
    expect(bare.exitCode).toBe(1) // a missing file is an error, not an empty fact bag
    const alone = run([RULES])
    expect(alone.exitCode).toBe(0)
    expect(JSON.parse(alone.stdout).value).toBe(0)
    expect(JSON.parse(alone.stdout).notApplied.length).toBe(3)
  })

  test('with no rule file it explains itself and exits 2', () => {
    const usage = run([])
    expect(usage.exitCode).toBe(2)
    expect(usage.stderr).toContain('usage: bun scripts/rules.ts')
  })

  // Round 1: every refusal was printed as "<rules.json> does not load", including refusals that
  // were not about the rule file. A reader who is told the wrong file is chasing the wrong bug.
  test('a refusal names the thing that is actually wrong, not always the rule file', () => {
    const badBase = run([RULES, FACTS, '--base=abc'])
    expect(badBase.exitCode).toBe(1)
    expect(badBase.stdout).toBe('')
    expect(badBase.stderr).toContain('--base=abc')
    expect(badBase.stderr).toContain('finite number')
    expect(badBase.stderr).not.toContain('synthetic.json')

    const missingFacts = run([RULES, 'tests/fixtures/rules/no-such-facts.json'])
    expect(missingFacts.exitCode).toBe(1)
    expect(missingFacts.stderr).toContain('tests/fixtures/rules/no-such-facts.json')
    expect(missingFacts.stderr).toContain('ENOENT')
    expect(missingFacts.stderr).not.toContain('synthetic.json')

    const notAnObject = join(mkdtempSync(join(tmpdir(), 'rules-cli-')), 'facts.json')
    writeFileSync(notAnObject, '[1, 2, 3]')
    const arrayFacts = run([RULES, notAnObject])
    expect(arrayFacts.exitCode).toBe(1)
    expect(arrayFacts.stderr).toContain('flat JSON object')
    expect(arrayFacts.stderr).toContain(notAnObject)
  })
})
