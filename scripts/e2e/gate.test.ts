import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, latestE2eStatus } from './ci-gate'
import { APP_SURFACE, appSurface, gateFor, needsE2e, readRun, REQUIRED_CHECKS, runs } from './gate'

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

/** A run directory as `run.ts` writes one; `over` cuts a hole in it. */
function makeRun(
  outDir: string,
  name: string,
  over: Partial<{ commit: string; passed: boolean; dirty: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }> = {},
): string {
  const dir = join(outDir, name)
  mkdirSync(dir, { recursive: true })
  const checks = over.checks ?? REQUIRED_CHECKS.map((check) => ({ name: check, ok: true, detail: 'ok' }))
  const report = {
    card: { id: 't_test', title: 'a card' },
    branch: 'feat/SCRUM-1_x',
    commit: over.commit ?? SHA,
    dirty: over.dirty ?? false,
    checks,
    passed: over.passed ?? true,
    finished_at: '2026-11-22T10:00:00.000Z',
  }
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return dir
}

function emptyOut(): string {
  return mkdtempSync(join(tmpdir(), 'e2e-gate-test-'))
}

describe('a run is evidence of one commit, not of the branch', () => {
  test('a clean passing run against the head satisfies the gate', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z')
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('')
    expect(result.run?.commit).toBe(SHA)
  })

  test('a green run against another commit does not', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', { commit: OTHER })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(SHA.slice(0, 7))
    expect(result.reason).toContain(OTHER.slice(0, 7))
  })

  test('no run directory at all is the plainest failure there is', () => {
    const result = gateFor(SHA, emptyOut())
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('no e2e run directory')
  })

  test('a dirty worktree is not evidence of the commit, however green', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', { dirty: true })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('dirty')
  })

  test('a failing run names the failing check', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', {
      passed: false,
      checks: [
        { name: 'policy.no-host-apps', ok: true, detail: 'ok' },
        { name: 'cleanroom.claim', ok: false, detail: 'not visible: "LDL cholesterol"' },
      ],
    })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('cleanroom.claim')
  })

  test('a pass that never ran the policy scan is refused', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', {
      checks: [
        { name: 'policy.no-host-apps', ok: true, detail: 'ok' },
        { name: 'agent.exit', ok: true, detail: 'ok' },
      ],
    })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('policy.stays-in-room is missing')
  })

  test('a pass with a red policy check is refused', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', {
      checks: REQUIRED_CHECKS.map((name) => ({ name, ok: name !== 'policy.stays-in-room', detail: 'find / from the root' })),
    })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('policy.stays-in-room')
  })

  test('a report that claims passed while a check is red is not a pass', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', {
      passed: true,
      checks: [...REQUIRED_CHECKS.map((name) => ({ name, ok: true, detail: 'ok' })), { name: 'g2.verify', ok: false, detail: 'tsc' }],
    })
    const run = readRun(join(out, 'card-2026-11-22T10-00-00-000Z'))
    expect(run?.passed).toBe(false)
  })

  test('a directory with no report, or a malformed commit, is skipped rather than trusted', () => {
    const out = emptyOut()
    mkdirSync(join(out, 'no-report-2026-11-22T09-00-00-000Z'), { recursive: true })
    const broken = join(out, 'broken-2026-11-22T09-30-00-000Z')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'report.json'), '{"commit":"HEAD","passed":true}')
    expect(runs(out)).toHaveLength(0)
    expect(gateFor(SHA, out).reason).toContain('no e2e run directory')
  })

  test('the newest run wins when two are for the same commit', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T09-00-00-000Z', { passed: false, checks: [{ name: 'agent.exit', ok: false, detail: 'killed' }] })
    makeRun(out, 'card-2026-11-22T10-00-00-000Z')
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(true)
    expect(result.run?.dir).toContain('10-00-00')
  })

  test('a partial sha is refused instead of matched loosely', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z')
    expect(gateFor('aaaaaaa', out).ok).toBe(false)
  })
})

describe('the diff decides which branches need a run', () => {
  test('the surfaces the owner named are surface', () => {
    for (const path of ['body/index.html', 'body/lib/x.js', 'body/demo/graph.json', 'src/App.tsx', 'app.json', 'body/tools/bundle.mjs']) {
      expect(needsE2e([path])).toBe(true)
    }
  })

  test('tooling, docs, tests and the harness itself are not', () => {
    for (const path of ['docs/WIDGETS.md', 'scripts/e2e/run.ts', 'scripts/graph-view.test.ts', '.github/workflows/verify.yml', 'body/shots/header.png', 'README.md']) {
      expect(needsE2e([path])).toBe(false)
    }
  })

  test('one surface file in a long diff is enough, and it is named with its area', () => {
    const surface = appSurface(['docs/WIDGETS.md', 'body/index.html', 'scripts/rules.ts'])
    expect(surface).toHaveLength(1)
    expect(surface[0].path).toBe('body/index.html')
    expect(surface[0].area).toContain('header')
  })

  test('every rule is anchored to the repo root, so a path that merely mentions one is not surface', () => {
    for (const [pattern] of APP_SURFACE) {
      expect(pattern.source.startsWith('^')).toBe(true)
    }
    expect(needsE2e(['docs/src/notes.md', 'vendor/body/index.html.bak'])).toBe(false)
  })
})

describe('the CI step reads the receipt, and only a run can write one', () => {
  const surface = ['body/index.html']

  test('a docs-only pull request is exempt', () => {
    const decision = decide({ event: 'pull_request', files: ['docs/PLAN.md'], status: null })
    expect(decision).toMatchObject({ required: false, ok: true })
  })

  test('a push on main is not a merge and is not gated', () => {
    const decision = decide({ event: 'push', files: surface, status: null })
    expect(decision.ok).toBe(true)
    expect(decision.message).toContain('not a pull request')
  })

  test('a product pull request with no receipt fails, and names what moved', () => {
    const decision = decide({ event: 'pull_request', files: surface, status: null })
    expect(decision.required).toBe(true)
    expect(decision.ok).toBe(false)
    expect(decision.message).toContain('body/index.html')
    expect(decision.message).toContain('no e2e run was recorded')
  })

  test('a red or pending receipt fails', () => {
    const red = decide({ event: 'pull_request', files: surface, status: { state: 'failure', description: 'claim not visible' } })
    expect(red.ok).toBe(false)
    expect(red.message).toContain('claim not visible')
    const pending = decide({ event: 'pull_request', files: surface, status: { state: 'pending', description: 'running' } })
    expect(pending.ok).toBe(false)
  })

  test('a green receipt passes', () => {
    const decision = decide({ event: 'pull_request', files: surface, status: { state: 'success', description: 'card-2026-11-22' } })
    expect(decision.ok).toBe(true)
    expect(decision.message).toContain('card-2026-11-22')
  })

  test('the newest status for the context wins, and other contexts are ignored', () => {
    const entries = [
      { context: 'e2e', state: 'failure', description: 'older', created_at: '2026-11-22T09:00:00Z' },
      { context: 'verify', state: 'success', description: 'not the receipt', created_at: '2026-11-22T09:30:00Z' },
      { context: 'e2e', state: 'success', description: 'newer', created_at: '2026-11-22T10:00:00Z' },
    ]
    expect(latestE2eStatus(entries)).toEqual({ state: 'success', description: 'newer' })
    expect(latestE2eStatus([])).toBeNull()
  })
})

describe('the required checks are the ones the gate names', () => {
  test('host apps, the room boundary and the capture scope are all mandatory', () => {
    expect([...REQUIRED_CHECKS]).toEqual(['policy.no-host-apps', 'policy.stays-in-room', 'capture.browser-only'])
  })
})
