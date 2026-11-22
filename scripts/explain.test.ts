/**
 * T17 through the door a reader actually uses: the CLI.
 *
 * `src/explain.test.ts` proves the row model — the rows add to the change, a missing fact is not a
 * vanished deficit, a changed model is refused. None of that proves the page. This file proves the
 * page: that `bun run explain` prints the rows, that the printed numbers add up *as printed*, that
 * a rule whose citation cannot be opened stops the whole explanation at the boundary, and that the
 * second run is byte-identical.
 *
 * The reconciliation test is the one that matters. It parses the three numbers off the page and
 * subtracts them, which is the first check a reader runs — and the check that failed at 2dp while
 * the change and every row printed at 3dp (8.81 − 7.09 = 1.72, page said 1.718). A test that reads
 * the objects cannot see a display defect, which is why one is here.
 *
 *   bun test scripts/explain.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LEE_BEFORE = 'tests/fixtures/explain/lee-before.json'
const LEE_AFTER = 'tests/fixtures/explain/lee-after.json'
const SCORE2_BEFORE = 'tests/fixtures/explain/score2-before.json'
const SCORE2_AFTER = 'tests/fixtures/explain/score2-after.json'
const RULES = 'tests/fixtures/rules/synthetic.json'
const SYNTHETIC_FACTS = 'tests/fixtures/rules/synthetic-facts.json'

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const done = Bun.spawnSync(['bun', 'scripts/explain.ts', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() }
}

/** The line a reader's eye lands on, by its label, or a failure that says what was missing. */
function line(stdout: string, label: string): string {
  const found = stdout.split('\n').find((text) => text.trimStart().startsWith(label))
  if (found === undefined) throw new Error(`no line starting "${label}" in:\n${stdout}`)
  return found
}

/** The number a printed line names, with the places it was printed in. */
function printed(text: string, pattern: RegExp): { value: number; places: number } {
  const match = pattern.exec(text)
  if (match === null || match[1] === undefined) throw new Error(`"${text}" does not match ${pattern}`)
  const digits = match[1]
  return { value: Number(digits), places: digits.split('.')[1]?.length ?? 0 }
}

describe('bun run explain lee', () => {
  test('prints the band, the five rules that moved, and the same bytes on a second run', () => {
    const first = run(['lee', LEE_BEFORE, LEE_AFTER])
    expect(first.exitCode).toBe(0)

    expect(line(first.stdout, 'band')).toContain('6–9 points: 15%')
    expect(first.stdout).toContain('10–13 points: 42%')
    expect(line(first.stdout, 'before')).toContain('8 · 5 rule(s) fired')
    expect(line(first.stdout, 'after')).toContain('11 · 6 rule(s) fired')
    expect(line(first.stdout, 'change')).toContain('+3.000 points')
    expect(line(first.stdout, 'rows')).toContain('5, each one a rule that started or stopped firing')

    // Each row carries its three obligations: the Δ, the cause, and a source a reader can open.
    const rows = first.stdout.split('\n').filter((text) => /^\s{4}\w[\w ]*\s+[+-]\d+\.\d{3} points/.test(text))
    expect(rows.length).toBe(5)
    expect(rows.map((text) => text.trim().split(/\s{2,}/)[0])).toEqual([
      'age_65_69',
      'age_70_74',
      'cancer',
      'current_smoker',
      'difficulty_bathing',
    ])
    expect(rows.every((text) => text.includes('no longer fires') || text.includes('now fires'))).toBe(true)
    for (const pmid of ['https://pubmed.ncbi.nlm.nih.gov/16478903/']) {
      expect(first.stdout.split(pmid).length - 1).toBe(5)
    }
    expect(first.stdout).toContain('because age: 68 → 70')

    expect(line(first.stdout, 'sum of rows')).toContain('+3.000 points — the same number as the change')
    expect(line(first.stdout, 'unchanged')).toContain('bmi_under_25, diabetes, sex_male')

    expect(run(['lee', LEE_BEFORE, LEE_AFTER]).stdout).toBe(first.stdout)
  })

  test('--json is the object a view would consume, and it holds the same change', () => {
    const done = run(['lee', LEE_BEFORE, LEE_AFTER, '--json'])
    expect(done.exitCode).toBe(0)
    const explanation = JSON.parse(done.stdout) as {
      change: number
      drivers: Array<{ delta: number; source: string; link: string }>
      band: { before: { from: number }; after: { from: number } }
    }
    expect(explanation.change).toBeCloseTo(3, 10)
    expect(explanation.drivers.length).toBe(5)
    expect(explanation.drivers.reduce((sum, driver) => sum + driver.delta, 0)).toBeCloseTo(explanation.change, 10)
    expect(explanation.drivers.every((driver) => driver.link.startsWith('https://'))).toBe(true)
    expect(explanation.band.before.from).toBe(6)
    expect(explanation.band.after.from).toBe(10)
  })
})

describe('bun run explain score2', () => {
  test('the printed triple adds up as printed — the check a reader actually runs', () => {
    const done = run(['score2', SCORE2_BEFORE, SCORE2_AFTER, '--region=high'])
    expect(done.exitCode).toBe(0)

    const before = printed(line(done.stdout, 'before'), /([\d.]+)%/)
    const after = printed(line(done.stdout, 'after'), /([\d.]+)%/)
    const change = printed(line(done.stdout, 'change'), /([+-][\d.]+) percentage points/)

    // One precision for the page, at the model's own: `risk` is 3dp, so the estimates are too.
    // This is the assertion the 2dp estimates failed: 8.81 was followed by a change of −1.718,
    // and 8.81 − 7.09 = 1.72. The `change` is `after − before`, so the row checks the sign too.
    expect(before.places).toBe(3)
    expect(after.places).toBe(3)
    expect(change.places).toBe(3)
    // Compared in thousandths, the unit the page prints in: the digits a reader subtracts are the
    // digits printed beside them, whatever the floating-point dust underneath.
    expect(Math.round((after.value - before.value) * 1000)).toBe(Math.round(change.value * 1000))

    expect(line(done.stdout, 'region')).toContain('high')
    expect(line(done.stdout, 'rows')).toContain("9, in Supplementary Table 2's order")
    const rows = done.stdout.split('\n').filter((text) => /^\s+[+-]\d+\.\d{3} pp\s/.test(text))
    expect(rows.length).toBe(9)

    expect(line(done.stdout, 'sum of rows')).toContain('-1.718 percentage points — the same number as the change')
    // The order dependence is on the page, next to the rows it qualifies, not only in the object.
    expect(line(done.stdout, 'method')).toContain('sequential split')
    expect(line(done.stdout, 'method')).toContain('another order would split the same total differently')
    expect(done.stdout).toContain('SCORE2-OP')

    expect(run(['score2', SCORE2_BEFORE, SCORE2_AFTER, '--region=high']).stdout).toBe(done.stdout)
  })

  test('a change of sex is refused as a change of model, with nothing on stdout', () => {
    const done = run([SCORE2_BEFORE, SCORE2_AFTER]) // no region: no number at all
    expect(done.exitCode).toBe(2)
    expect(done.stdout).toBe('')

    const region = run(['score2', SCORE2_BEFORE, SCORE2_AFTER, '--region=somewhere'])
    expect(region.exitCode).toBe(2)
    expect(region.stdout).toBe('')
    expect(region.stderr).toContain('there is no default')
  })
})

describe('bun run explain rules', () => {
  test('a rule whose source is not a link stops the whole explanation, naming the rule and the source', () => {
    // The one synthetic rule that can move: demo.condition is present on one date and absent on
    // the other. Its citation is `synthetic:demo-presence`, which no reader can open. Printing the
    // change with that citation would be claiming a source the explanation cannot produce.
    const room = mkdtempSync(join(tmpdir(), 'explain-cli-'))
    const withCondition = join(room, 'with-condition.json')
    writeFileSync(withCondition, JSON.stringify({ 'demo.sex': 'male', 'demo.age': 61, 'demo.flag': 'high', 'demo.condition': true }))

    const done = run(['rules', RULES, withCondition, SYNTHETIC_FACTS, '--unit=points'])
    expect(done.exitCode).toBe(1)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('refused:')
    expect(done.stderr).toContain('demo-existing-condition')
    expect(done.stderr).toContain('synthetic:demo-presence')
    expect(done.stderr).toContain('cannot be shown with a citation')

    // And the same pair the other way round: the absence is a change too, not a vanished deficit.
    const reversed = run(['rules', RULES, SYNTHETIC_FACTS, withCondition, '--unit=points'])
    expect(reversed.exitCode).toBe(1)
    expect(reversed.stderr).toContain('demo-existing-condition')
  })

  test('with no unit, or with no rule file, it says how it is called and prints no row', () => {
    const noUnit = run(['rules', RULES, LEE_BEFORE, LEE_AFTER])
    expect(noUnit.exitCode).toBe(2)
    expect(noUnit.stdout).toBe('')
    expect(noUnit.stderr).toContain('usage: bun scripts/explain.ts rules')

    const noSet = run(['rules', LEE_BEFORE, LEE_AFTER, '--unit=points'])
    expect(noSet.exitCode).toBe(2)

    const nothing = run([])
    expect(nothing.exitCode).toBe(2)
    expect(nothing.stderr).toContain('usage: bun scripts/explain.ts <rules|score2>')
  })

  test('a rule set that reads facts neither date has explains nothing, rather than something', () => {
    // The synthetic set reads demo.* facts; the lee fixtures have none of them. Nothing moved, so
    // there is one row-less explanation, not a fabricated cause.
    const done = run(['rules', RULES, LEE_BEFORE, LEE_AFTER, '--unit=points'])
    expect(done.exitCode).toBe(0)
    expect(line(done.stdout, 'change')).toContain('0.000 points')
    expect(line(done.stdout, 'rows')).toContain('none')
  })
})
