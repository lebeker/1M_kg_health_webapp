import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Owner policy, 2026-11-22: no bot, child agent, reviewer or harness may launch, attach to or
 * control a host application. The three CDP drivers in `body/tools/` start the local Chrome app,
 * so under an agent harness they must refuse instead — and the refusal has to land before the
 * `Popen`, which is why every case here asserts three things: the exit code, the message, and that
 * no Chrome with a remote-debugging port appeared while the test ran. E01 shipped a harness that
 * drove a host browser; this is the check that stops the next agent from repeating it through
 * `probe.py`, which `HANDOVER.md` used to recommend as the test driver.
 */
const TOOLS = fileURLToPath(new URL('../body/tools/', import.meta.url))

/** A refusal is immediate; a launch path polls the CDP port for 20–36 s before giving up. */
const REFUSAL_BUDGET_MS = 5_000

const DRIVERS = [
  { script: 'probe.py', argv: ['--port', '10801'] },
  { script: 'stress.py', argv: ['10601', '1'] },
  { script: 'browser_qa.py', argv: [] },
] as const

type Run = { status: number | null; out: string; ms: number }

/** Every process on the machine that is driving a browser over CDP right now. */
function cdpProcesses(): string[] {
  const ps = spawnSync('ps', ['-Ao', 'args'], { encoding: 'utf8', timeout: 20_000 })
  if (ps.status !== 0) throw new Error(`ps failed: ${ps.stderr}`)
  return ps.stdout.split('\n').filter((line) => line.includes('remote-debugging-port'))
}

/** The process environment minus anything Hermes: the child only sees what a case asks for. */
function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('HERMES_')) continue
    env[key] = value
  }
  return { ...env, ...extra }
}

function run(script: string, argv: readonly string[], extraEnv: Record<string, string>): Run {
  const started = Date.now()
  const result = spawnSync('python3', [join(TOOLS, script), ...argv], {
    encoding: 'utf8',
    env: cleanEnv(extraEnv),
    timeout: 60_000,
  })
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}`, ms: Date.now() - started }
}

/** Nothing new may be driving a browser: the guard runs before the launcher, or it is not a guard. */
function expectNoBrowserStarted(before: readonly string[]): void {
  expect(cdpProcesses().filter((line) => !before.includes(line))).toEqual([])
}

const before = cdpProcesses()

describe('the body QA drivers refuse a host browser under an agent', () => {
  for (const { script, argv } of DRIVERS) {
    test(`${script} exits non-zero with one refusal, having started nothing`, () => {
      const result = run(script, argv, { HERMES_PROFILE: 'right' })

      expect(result.status).toBe(2)
      expect(result.out).toContain(`${script}: refusing to launch a host browser`)
      expect(result.out).not.toContain('Traceback')
      // One message, and it says what an agent does instead of a browser.
      expect(result.out.match(/refusing to launch a host browser/g)?.length).toBe(1)
      expect(result.out).toContain('browser_*')
      expect(result.out).toContain('served build')
      expect(result.out).toContain('http://127.0.0.1:8770/body/index.html')

      // The launch path polls CDP for half a minute; a refusal is over in milliseconds.
      expect(result.ms).toBeLessThan(REFUSAL_BUDGET_MS)
      expectNoBrowserStarted(before)
    })
  }

  test('any one of the three Hermes variables is enough to refuse', () => {
    for (const name of ['HERMES_PROFILE', 'HERMES_SESSION_ID', 'HERMES_HOME']) {
      const result = run('probe.py', ['--port', '10801'], { [name]: 'x' })
      expect(result.status).toBe(2)
      expect(result.out).toContain(`${name} is set`)
    }
    expectNoBrowserStarted(before)
  })

  test('an owner without a harness still gets through to --help', () => {
    for (const { script } of DRIVERS) {
      const result = run(script, ['--help'], {})
      expect(result.status).toBe(0)
      expect(result.out).toContain('OWNER-ONLY')
      expect(result.out).toContain('--force-host-browser')
      expect(result.out).toContain('browser_*')
    }
    expectNoBrowserStarted(before)
  })

  test('--help explains the tool under a harness too — it launches nothing', () => {
    const result = run('browser_qa.py', ['--help'], { HERMES_PROFILE: 'right' })
    expect(result.status).toBe(0)
    expect(result.out).toContain('OWNER-ONLY')
    expectNoBrowserStarted(before)
  })

  test("the guard's own decisions, including the owner's override", () => {
    const result = run('host_browser_guard.py', ['--selftest'], { HERMES_PROFILE: 'right' })
    expect(result.status).toBe(0)
    expect(result.out).toContain('ok: harness detection, refusal, --help and the owner\'s override')
    expectNoBrowserStarted(before)
  })

  test('the guard sits above the launcher in every driver', () => {
    for (const { script } of DRIVERS) {
      const lines = readFileSync(join(TOOLS, script), 'utf8').split('\n')
      const guard = lines.findIndex((line) => line.includes('from host_browser_guard import begin'))
      const call = lines.findIndex((line) => line.includes('begin(') && !line.includes('import'))
      const launch = lines.findIndex((line) => line.includes('subprocess.Popen'))
      const chrome = lines.findIndex((line) => line.includes('Applications/Google Chrome'))
      expect(guard).toBeGreaterThan(-1)
      expect(call).toBeGreaterThan(guard)
      expect(launch).toBeGreaterThan(call)
      expect(chrome).toBeGreaterThan(-1)
    }
  })
})
