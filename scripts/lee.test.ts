/**
 * The Lee index gate, through the door a reader actually uses: the CLI.
 *
 * `src/lee.test.ts` proves the sum. This proves that the refusals survive the boundary — a person
 * the index cannot score exits non-zero and says which item is missing, and a person it can score
 * prints the whole basis of the number and the same bytes on a second run. A library that refuses a
 * missing BMI but a CLI that prints 12 points anyway would be a policy with no enforcement.
 *
 *   bun test scripts/lee.test.ts
 */
import { describe, expect, test } from 'bun:test'

const MAN_80 = 'tests/fixtures/lee/profile-b-man-80-heavy.json'
const WOMAN_65 = 'tests/fixtures/lee/profile-a-woman-65-minimal.json'
const MISSING_BMI = 'tests/fixtures/lee/invalid-missing-bmi.json'
const TYPO = 'tests/fixtures/lee/invalid-typo-key.json'

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const done = Bun.spawnSync(['bun', 'scripts/lee.ts', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() }
}

describe('bun run lee', () => {
  test('prints the index, the band, the deficit list with citations, and what the model ignores', () => {
    const done = run([MAN_80])
    expect(done.exitCode).toBe(0)
    expect(done.stdout).toContain('lee-4y-points/1')
    expect(done.stdout).toContain('17 of 26 points')
    expect(done.stdout).toContain('14 points or more: 64%')
    expect(done.stdout).toContain('age_80_84')
    expect(done.stdout).toContain('difficulty_walking_several_blocks')
    expect(done.stdout).toContain('PMID:16478903')
    expect(done.stdout).toContain('absent')
    expect(done.stdout).toContain('what this number does not know')
    expect(done.stdout).toContain('community-dwelling US adults over 50')
  })

  test('--json is the model’s own object, and the second run is byte-identical', () => {
    const first = run([MAN_80, '--json'])
    expect(first.exitCode).toBe(0)
    const index = JSON.parse(first.stdout) as {
      model: string
      version: string
      points: number
      maxPoints: number
      band: { from: number; to: number | null; printed: string }
      deficits: Array<{ rule: string; points: number; source: string }>
      absent: Array<{ rule: string; reason: string }>
      ignored: string[]
      limits: string[]
      source: { pmid: string; doi: string }
      discrimination: { development: number; validation: number }
    }
    expect(index.model).toBe('Lee')
    expect(index.version).toBe('lee-4y-points/1')
    expect(index.points).toBe(17)
    expect(index.maxPoints).toBe(26)
    expect(index.band).toEqual({ from: 14, to: null, printed: '64%' })
    expect(index.deficits.map((deficit) => deficit.rule)).toContain('cancer')
    expect(index.deficits.every((deficit) => deficit.source === 'PMID:16478903')).toBe(true)
    expect(index.deficits.reduce((sum, deficit) => sum + deficit.points, 0)).toBe(index.points)
    expect(index.absent.every((row) => row.reason === 'no-match')).toBe(true)
    expect(index.ignored).toEqual([])
    expect(index.limits.length).toBe(9)
    expect(index.source.pmid).toBe('PMID:16478903')
    expect(index.discrimination).toEqual({ development: 0.84, validation: 0.82 })

    const second = run([MAN_80, '--json'])
    expect(second.stdout).toBe(first.stdout)
  })

  test('the fixture’s note is not a fact, so it is not reported as an ignored one', () => {
    const done = run([WOMAN_65, '--json'])
    expect(done.exitCode).toBe(0)
    const index = JSON.parse(done.stdout) as { points: number; ignored: string[] }
    expect(index.points).toBe(3)
    expect(index.ignored).toEqual([])
  })

  test('a missing item exits 1 and names it', () => {
    const done = run([MISSING_BMI])
    expect(done.exitCode).toBe(1)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain('refused:')
    expect(done.stderr).toContain('facts.bmi')
  })

  test('a misspelt item is refused under its real name and the typo is printed', () => {
    const done = run([TYPO])
    expect(done.exitCode).toBe(1)
    expect(done.stderr).toContain('facts.diabetes')
    expect(done.stderr).toContain('diabetis')
  })

  test('no facts file is a usage error, and a file that is not JSON is a refusal', () => {
    const usage = run([])
    expect(usage.exitCode).toBe(2)
    expect(usage.stderr).toContain('usage: bun scripts/lee.ts <facts.json>')

    const broken = run(['README.md'])
    expect(broken.exitCode).toBe(1)
    expect(broken.stderr).toContain('refused: README.md')
    expect(broken.stdout).toBe('')
  })
})
