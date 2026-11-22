import { describe, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_SURFACE, appSurface, capturedPages, type GateIo, gateFor, main, needsE2e, NOT_PRODUCT, pagesFor, readRun, REQUIRED_CHECKS, runDirs, runs } from './gate'
import { decide, latestE2eStatus, receiptPages } from './ci-gate'

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

/** A run directory as `run.ts` writes one; `over` cuts a hole in it. */
function makeRun(
  outDir: string,
  name: string,
  over: Partial<{
    commit: string
    passed: boolean
    dirty: boolean
    finishedAt: string
    checks: Array<{ name: string; ok: boolean; detail: string }>
    /** Which pages the run captured. Omitted means the report predates the field. */
    pages: string[]
    /** What the card's `## e2e` block asked for. Omitted means the report predates the field. */
    cardPage: string[]
  }> = {},
): string {
  const dir = join(outDir, name)
  mkdirSync(dir, { recursive: true })
  const checks = over.checks ?? REQUIRED_CHECKS.map((check) => ({ name: check, ok: true, detail: 'ok' }))
  const report = {
    card: { id: 't_test', title: 'a card', ...(over.cardPage ? { page: over.cardPage } : {}) },
    branch: 'feat/SCRUM-1_x',
    commit: over.commit ?? SHA,
    dirty: over.dirty ?? false,
    ...(over.pages ? { pages: over.pages.map((kind) => ({ label: kind, kind })) } : {}),
    checks,
    passed: over.passed ?? true,
    finished_at: over.finishedAt ?? '2026-11-22T10:00:00.000Z',
  }
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return dir
}

function emptyOut(): string {
  return mkdtempSync(join(tmpdir(), 'e2e-gate-test-'))
}

/** Run the CLI with the output captured, so a test can assert on what a person would read. */
function cli(argv: string[], out: string = emptyOut()): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  const io: GateIo = { out: (line) => stdout.push(line), err: (line) => stderr.push(line) }
  const code = main([...argv, '--out', out], io)
  return { code, stdout, stderr }
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
    makeRun(out, 'card-2026-11-22T09-00-00-000Z', {
      passed: false,
      finishedAt: '2026-11-22T09:00:00.000Z',
      checks: [{ name: 'agent.exit', ok: false, detail: 'killed' }],
    })
    makeRun(out, 'card-2026-11-22T10-00-00-000Z', { finishedAt: '2026-11-22T10:00:00.000Z' })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(true)
    expect(result.run?.dir).toContain('10-00-00')
  })

  test('run directories are ordered by when they finished, not by their name prefix', () => {
    const out = emptyOut()
    // Alphabetically `smoke-` sorts after `backfill-`, so a name sort calls yesterday's smoke run
    // the latest thing that happened. The report's `finished_at` says otherwise.
    makeRun(out, 'smoke-smoke-card-2026-11-21T21-39-12-801Z', { commit: OTHER, finishedAt: '2026-11-21T21:39:12.801Z' })
    makeRun(out, 'backfill-main-main-backfill-2026-11-22T12-59-20-255Z', { finishedAt: '2026-11-22T12:59:20.255Z' })
    expect(runDirs(out).map((dir) => dir.split('/').pop())).toEqual([
      'smoke-smoke-card-2026-11-21T21-39-12-801Z',
      'backfill-main-main-backfill-2026-11-22T12-59-20-255Z',
    ])
    expect(runs(out)[0].finishedAt).toBe('2026-11-22T12:59:20.255Z')
    // The refusal names the run that actually finished last, not the one whose name sorts last.
    const refusal = gateFor('c'.repeat(40), out).reason
    expect(refusal).toContain('backfill-main-main-backfill')
    expect(refusal).not.toContain('smoke-smoke-card')
  })

  test('a run whose report has no finished_at sorts as the oldest rather than jumping the queue', () => {
    const out = emptyOut()
    makeRun(out, 'a-2026-11-22T10-00-00-000Z', { commit: OTHER, finishedAt: '' })
    makeRun(out, 'z-2026-11-21T10-00-00-000Z', { finishedAt: '2026-11-21T10:00:00.000Z' })
    expect(runs(out)[0].commit).toBe(SHA)
  })

  test('a partial sha is refused instead of matched loosely', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z')
    expect(gateFor('aaaaaaa', out).ok).toBe(false)
  })
})

describe('the diff decides which branches need a run', () => {
  test('the surfaces the owner named are surface', () => {
    for (const path of ['body/index.html', 'body/lib/x.js', 'body/fixture.js', 'src/App.tsx', 'app.json', 'body/tools/bundle.mjs']) {
      expect(needsE2e([path])).toBe(true)
    }
  })

  test('the models the page renders, the graph page entry and the demo builder are surface too', () => {
    // Each of these was exempt before the first review round: the anatomy the centre and the
    // right panel are made of, the document the viewer mounts into, and the builder that emits
    // the case page. A pull request touching only one of them moved the product.
    for (const path of ['body/models/heart.glb', 'body/models/bones.glb', 'graph.html', 'index.html', 'case.html', 'scripts/build-demo.ts', 'scripts/build-case.ts', 'body/constellation.html']) {
      expect(needsE2e([path])).toBe(true)
    }
    expect(appSurface(['body/models/heart.glb'])[0].area).toContain('centre')
    expect(appSurface(['graph.html'])[0].area).toContain('entry document')
    // the root page is what Pages answers `/` with, and it is a build output: a diff that only
    // regenerates it still changed what a visitor to the bare address sees
    expect(appSurface(['index.html'])[0].area).toContain('published root page')
  })

  test('the allowlist is exactly the things that cannot move the product on their own', () => {
    for (const path of ['body/shots/header.png', 'body/README.md', 'body/MODEL_REPAIR.md', 'body/CONSTELLATION_EXPERIMENT.md', 'src/rules.test.ts', 'src/App.test.tsx']) {
      expect(needsE2e([path])).toBe(false)
    }
    for (const [pattern] of NOT_PRODUCT) expect(pattern.source.startsWith('^')).toBe(true)
    // A new file under body/ or src/ is surface until somebody says otherwise, which is the
    // direction the list has to fail in.
    for (const path of ['body/new-thing.js', 'body/models/new.glb', 'src/new.ts', 'body/style.css']) {
      expect(needsE2e([path])).toBe(true)
    }
    // `body/shots/` is a directory allowlist, not a prefix free-for-all on the page's notes.
    expect(needsE2e(['body/MODEL_REPAIR.md.bak'])).toBe(true)
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

describe('the command line answers the question it advertises', () => {
  test('--files <path> with a surface path is a run, not a crash', () => {
    const result = cli(['--files', 'body/lib/right-panel.js'])
    expect(result.code).toBe(0)
    expect(result.stderr).toEqual([])
    expect(result.stdout.join('\n')).toContain('e2e needed')
    expect(result.stdout.join('\n')).toContain('body/lib/right-panel.js')
  })

  test('--files takes several paths, and one of them is enough', () => {
    const result = cli(['--files', 'docs/PLAN.md', 'body/models/heart.glb', 'src/App.tsx'])
    expect(result.code).toBe(0)
    expect(result.stdout.filter((line) => line.startsWith('e2e needed'))).toHaveLength(2)
  })

  test('--files with only non-surface paths says so, without asking for a run', () => {
    const result = cli(['--files', 'docs/PLAN.md', 'body/shots/header.png'])
    expect(result.code).toBe(0)
    expect(result.stdout.join('\n')).toContain('no e2e needed')
  })

  test('the help text says the same exit codes the code does', () => {
    const result = cli(['--help'])
    expect(result.code).toBe(0)
    const text = result.stdout.join('\n').replace(/\s+/g, ' ')
    // "does this diff need a run" is an answer either way, so both outcomes are exit 0; only a
    // missing run, no paths, or an unusable flag is exit 1.
    expect(text).toContain('the question was answered')
    expect(text).not.toContain('the diff is not app surface')
    const nonSurface = cli(['--files', 'docs/PLAN.md'])
    expect(nonSurface.code).toBe(0)
    expect(nonSurface.stdout.join('\n')).toContain('no e2e needed')
  })

  test('--files with no paths is a usage error, never an exemption', () => {
    const result = cli(['--files'])
    expect(result.code).toBe(1)
    expect(result.stderr.join('\n')).toContain('at least one path')
    expect(result.stdout.join('\n')).not.toContain('no e2e needed')
  })

  test('a flag after --files is still a flag', () => {
    const result = cli(['--files', 'body/index.html', '--json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout.join('\n'))).toMatchObject({ needed: true })
  })

  test('--commit against a run that exists is ok, and against a fabricated sha it is not', () => {
    const out = emptyOut()
    makeRun(out, 'card-2026-11-22T10-00-00-000Z')
    const good = cli(['--commit', SHA], out)
    expect(good.code).toBe(0)
    expect(good.stdout.join('\n')).toContain('e2e ok')
    const bad = cli(['--commit', '0'.repeat(40)], out)
    expect(bad.code).toBe(1)
    expect(bad.stderr.join('\n')).toContain('e2e missing')
  })

  test('an unknown argument is refused with a sentence, not a stack trace', () => {
    const result = cli(['--nonsense'])
    expect(result.code).toBe(1)
    expect(result.stderr.join('\n')).toContain('unknown argument --nonsense')
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
    // The positive control. Since the columns page became capturable the receipt names the pages
    // it opened, and `surface` here is `body/index.html` — a columns-page diff. An unmarked
    // receipt on this diff is the old loophole and is refused; see the negative controls below.
    const decision = decide({ event: 'pull_request', files: surface, status: { state: 'success', description: 'G3 [case] PASS — card-2026-11-22' } })
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

describe('a pull request with no head or base is a usage error, not an empty diff', () => {
  // The bug this pins: `main()` handed `files: []` to `decide()` when the diff was merely
  // unknown, so `appSurface([])` was empty and the branch was exempt — exit 0 from the script
  // whose whole job is refusing a product pull request without a receipt. The exit code is the
  // contract, so these run the CLI the way `verify.yml` does.
  const CI_GATE = join(import.meta.dirname, 'ci-gate.ts')
  const REPO = join(import.meta.dirname, '..', '..')

  function runCiGate(env: Record<string, string>, cwd: string = REPO): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [CI_GATE], {
      cwd,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    })
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  /** A throwaway repo whose two commits are the two ends of the pull request under test. */
  function twoCommitRepo(before: string, after: string): { dir: string; base: string; head: string } {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-ci-gate-'))
    const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
    const write = (rel: string, body: string) => {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), body)
    }
    git(['init', '-q'])
    git(['config', 'user.email', 'gate@example.test'])
    git(['config', 'user.name', 'gate test'])
    write(before, 'before\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'base'])
    const base = git(['rev-parse', 'HEAD'])
    write(after, 'after\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'head'])
    const head = git(['rev-parse', 'HEAD'])
    return { dir, base, head }
  }

  test('neither end given exits 1 and names both inputs', () => {
    const result = runCiGate({ GITHUB_EVENT_NAME: 'pull_request' })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('E2E_HEAD_SHA')
    expect(result.stderr).toContain('E2E_BASE_SHA')
    // the old fail-open message must not appear anywhere
    expect(`${result.stdout}${result.stderr}`).not.toContain('no app-surface files')
  })

  test('only the head missing names the head and nothing else', () => {
    const result = runCiGate({ GITHUB_EVENT_NAME: 'pull_request', E2E_BASE_SHA: 'a'.repeat(40) })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('E2E_HEAD_SHA')
    expect(result.stderr).not.toContain('E2E_BASE_SHA')
  })

  test('a docs-only diff is still exempt, and says so', () => {
    const repo = twoCommitRepo('docs/PLAN.md', 'docs/NOTES.md')
    const result = runCiGate({ GITHUB_EVENT_NAME: 'pull_request', E2E_HEAD_SHA: repo.head, E2E_BASE_SHA: repo.base }, repo.dir)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('no app-surface files')
  })

  test('a diff that moves the surface still goes to the receipt, and refuses without a token', () => {
    const repo = twoCommitRepo('docs/PLAN.md', 'body/index.html')
    const result = runCiGate(
      { GITHUB_EVENT_NAME: 'pull_request', E2E_HEAD_SHA: repo.head, E2E_BASE_SHA: repo.base, GITHUB_TOKEN: '' },
      repo.dir,
    )
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('no GITHUB_TOKEN')
  })

  test('a push with no diff is not a merge and is still a pass', () => {
    const result = runCiGate({ GITHUB_EVENT_NAME: 'push' })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('not a pull request')
  })
})

describe('the required checks are the ones the gate names', () => {
  test('host apps, the room boundary and the capture scope are all mandatory', () => {
    expect([...REQUIRED_CHECKS]).toEqual(['policy.no-host-apps', 'policy.stays-in-room', 'capture.browser-only'])
  })
})

/**
 * The negative control this card exists for: a green run against the graph page used to satisfy
 * any card, including one whose claim is only visible on the columns page (`body/index.html` →
 * `dist/demo.html`). That is how a columns-page PR merged on an infrastructure smoke.
 */
describe('a graph receipt does not authorise a claim about the columns page', () => {
  test('a case-page card with a graph-only run is refused, and the reason says which page is missing', () => {
    const out = emptyOut()
    makeRun(out, 'case-card-2026-11-22T10-00-00-000Z', { checks: [...REQUIRED_CHECKS.map((name) => ({ name, ok: true, detail: 'ok' })), { name: 'cleanroom.counts', ok: true, detail: 'header "9 nodes / 11 edges"' }] })
    // No `pages` field: a report as the harness wrote it before the field existed, which was a
    // graph-page run every time.
    const result = gateFor(SHA, out, ['case'])
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('the columns page')
    expect(result.reason).toContain('not evidence of this claim')
  })

  test('the same run satisfies a card that asks for the graph page', () => {
    const out = emptyOut()
    makeRun(out, 'smoke-2026-11-22T10-00-00-000Z', { pages: ['graph'], cardPage: ['graph'] })
    expect(gateFor(SHA, out, ['graph']).ok).toBe(true)
  })

  test('a run that captured the columns page satisfies a case-page card', () => {
    const out = emptyOut()
    makeRun(out, 'case-2026-11-22T10-00-00-000Z', { pages: ['case'], cardPage: ['case'] })
    const result = gateFor(SHA, out, ['case'])
    expect(result.ok).toBe(true)
    expect(result.run?.pages).toEqual(['case'])
  })

  test('a card that names both pages needs a run that opened both', () => {
    const out = emptyOut()
    makeRun(out, 'case-only-2026-11-22T10-00-00-000Z', { pages: ['case'] })
    expect(gateFor(SHA, out, ['case', 'graph']).ok).toBe(false)
    const both = emptyOut()
    makeRun(both, 'both-2026-11-22T10-00-00-000Z', { pages: ['case', 'graph'] })
    expect(gateFor(SHA, both, ['case', 'graph']).ok).toBe(true)
  })

  test('a report whose own card names a page its captures do not is refused without being asked', () => {
    // The second half of the rule: even with no caller-supplied requirement, a report that says
    // "this card asked for the columns page" and carries no columns capture is not evidence.
    const out = emptyOut()
    makeRun(out, 'incoherent-2026-11-22T10-00-00-000Z', { pages: ['graph'], cardPage: ['case'] })
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('the columns page')
  })

  test('a run from before the page field is read as a graph run, not as every page', () => {
    const old = { checks: [{ name: 'cleanroom.counts', ok: true, detail: 'header "9 nodes / 11 edges"' }] }
    expect(capturedPages(old)).toEqual(['graph'])
    expect(capturedPages({ pages: [{ label: 'case', kind: 'case' }] })).toEqual(['case'])
    expect(capturedPages({ pages: [{ label: 'case', kind: 'case' }, { label: 'replay', kind: 'graph' }] })).toEqual(['case', 'graph'])
    // A report with neither is not evidence of any page: absent is not "all of them".
    expect(capturedPages({ checks: REQUIRED_CHECKS.map((name) => ({ name, ok: true, detail: 'ok' })) })).toEqual([])
  })

  test('the CLI refuses a case-page run it does not have, and names the page', () => {
    const out = emptyOut()
    makeRun(out, 'graph-2026-11-22T10-00-00-000Z', { pages: ['graph'] })
    const refused = cli(['--commit', SHA, '--pages', 'case'], out)
    expect(refused.code).toBe(1)
    expect(refused.stderr.join('\n')).toContain('the columns page')
    // The same directory answers yes when only the graph page is asked for: the refusal is about
    // the page, not about the run being unusable.
    expect(cli(['--commit', SHA, '--pages', 'graph'], out).code).toBe(0)
  })

  test('a flag that names no page is a usage error', () => {
    const result = cli(['--commit', SHA, '--pages', 'columns'])
    expect(result.code).toBe(1)
    expect(result.stderr.join('\n')).toContain('not a page')
  })
})

describe('the diff decides which page the receipt has to be evidence of', () => {
  test('the columns page and the graph page are named by their own paths', () => {
    expect(pagesFor(['body/index.html'])).toEqual(['case'])
    expect(pagesFor(['src/App.tsx'])).toEqual(['graph'])
    expect(pagesFor(['graph.html'])).toEqual(['graph'])
    expect(pagesFor(['index.html', 'case.html', 'scripts/build-demo.ts'])).toEqual(['case'])
    // Both pages come out of one build, and app.json is what the clean room installs.
    expect(pagesFor(['package.json'])).toEqual(['case', 'graph'])
    expect(pagesFor(['docs/PLAN.md', 'scripts/e2e/gate.ts'])).toEqual([])
  })

  test('a green receipt that names no page cannot authorise a diff that moves the columns page', () => {
    // This is the receipt t_7557a1f2 produced: green, from the graph page, on a columns-page branch.
    const decision = decide({ event: 'pull_request', files: ['body/lib/right-panel.js'], status: { state: 'success', description: 'G3 PASS — t17-what-moves-it-2026-11-22' } })
    expect(decision.required).toBe(true)
    expect(decision.ok).toBe(false)
    expect(decision.message).toContain('the columns page')
    expect(decision.message).toContain('page: case')
  })

  test('a receipt that says it opened the columns page is enough for that diff', () => {
    const decision = decide({
      event: 'pull_request',
      files: ['body/lib/right-panel.js'],
      status: { state: 'success', description: 'G3 [case] PASS — t17-what-moves-it-2026-11-22 — t_7557a1f2' },
    })
    expect(decision.ok).toBe(true)
  })

  test('a graph-only receipt is still enough for a graph-page diff, old ones included', () => {
    for (const description of ['G3 PASS — smoke-2026-11-21', 'G3 [graph] PASS — card-2026-11-22']) {
      const decision = decide({ event: 'pull_request', files: ['src/App.tsx'], status: { state: 'success', description } })
      expect(decision.ok).toBe(true)
    }
  })

  test('a diff that moves both pages needs both, named', () => {
    const files = ['body/index.html', 'src/App.tsx']
    expect(decide({ event: 'pull_request', files, status: { state: 'success', description: 'G3 [case] PASS — x' } }).ok).toBe(false)
    expect(decide({ event: 'pull_request', files, status: { state: 'success', description: 'G3 [graph] PASS — x' } }).ok).toBe(false)
    expect(decide({ event: 'pull_request', files, status: { state: 'success', description: 'G3 [case+graph] PASS — x' } }).ok).toBe(true)
  })

  test('the page marker is read from the receipt, and an absent one is not a claim', () => {
    expect(receiptPages('G3 [case] PASS — dir — t_1')).toEqual(['case'])
    expect(receiptPages('G3 [case+graph] PASS — dir')).toEqual(['case', 'graph'])
    expect(receiptPages('G3 [graph, case] PASS — dir')).toEqual(['case', 'graph'])
    expect(receiptPages('G3 PASS — dir')).toBeNull()
  })
})
