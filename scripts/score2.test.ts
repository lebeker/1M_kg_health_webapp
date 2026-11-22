/**
 * The SCORE2 gate, through the door a reader actually uses: the CLI.
 *
 * `src/score2.test.ts` proves the model. This proves that the refusals survive the boundary — a
 * person the model cannot score exits non-zero and says why, and a person it can score prints the
 * whole arithmetic and the same bytes on a second run. A library that refuses an out-of-range age
 * but a CLI that prints a number anyway would be a policy with no enforcement.
 *
 *   bun test scripts/score2.test.ts
 */
import { describe, expect, test } from 'bun:test'

const MAN_50 = 'tests/fixtures/score2/profile-a-male-50-smoker.json'
const MAN_65 = 'tests/fixtures/score2/profile-c-male-65-high.json'

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const done = Bun.spawnSync(['bun', 'scripts/score2.ts', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() }
}

describe('bun run score2', () => {
  test('prints the number, its interval, the arithmetic and what the model does not know', () => {
    const done = run([MAN_65, '--region=high'])
    expect(done.exitCode).toBe(0)
    expect(done.stdout).toContain('score2-10y/1')
    expect(done.stdout).toContain('region       high')
    expect(done.stdout).toContain('14.21%')
    expect(done.stdout).toContain('95% interval')
    expect(done.stdout).toContain('age_x_systolic_bp')
    expect(done.stdout).toContain('SCORE2-Diabetes')
    expect(done.stdout).toContain('40–69')
  })

  test("--json is the model's own object, and the second run is byte-identical", () => {
    const first = run([MAN_50, '--region=very_high', '--json'])
    expect(first.exitCode).toBe(0)
    const risk = JSON.parse(first.stdout) as {
      model: string
      version: string
      region: string
      risk: number
      interval: { low: number; high: number; level: number }
      terms: Array<{ name: string; contribution: number }>
      limits: string[]
    }
    expect(risk.model).toBe('SCORE2')
    expect(risk.version).toBe('score2-10y/1')
    expect(risk.region).toBe('very_high')
    expect(risk.risk).toBeCloseTo(15.06, 1)
    expect(risk.interval.level).toBe(0.95)
    expect(risk.terms.length).toBe(11)
    expect(risk.limits.join(' ')).toContain('interval covers')
    expect(run([MAN_50, '--region=very_high', '--json']).stdout).toBe(first.stdout)
  })

  test('with no region there is no number: exit 2, nothing on stdout', () => {
    const done = run([MAN_65])
    expect(done.exitCode).toBe(2)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('there is no default')
  })

  test('with no facts file it says how it is called, and prints no number', () => {
    const done = run(['--region=high'])
    expect(done.exitCode).toBe(2)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('usage: bun scripts/score2.ts <facts.json>')
  })

  test('a person over 69 is refused at the boundary, by name and with the model that covers them', () => {
    const done = run(['tests/fixtures/score2/invalid-age-72.json', '--region=high'])
    expect(done.exitCode).toBe(1)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('refused: tests/fixtures/score2/invalid-age-72.json')
    expect(done.stderr).toContain('SCORE2-OP')
  })

  test('a typo in a fact name is refused, not read as a missing fact', () => {
    const done = run(['tests/fixtures/score2/invalid-typo-key.json', '--region=high'])
    expect(done.exitCode).toBe(1)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('input.hdl')
    expect(done.stderr).toContain('unknown key')
  })

  test('a missing file is an error, not a person with no risk factors', () => {
    const done = run(['tests/fixtures/score2/does-not-exist.json', '--region=high'])
    expect(done.exitCode).toBe(1)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('refused: tests/fixtures/score2/does-not-exist.json')
  })
})
