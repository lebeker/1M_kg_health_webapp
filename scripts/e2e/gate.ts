/**
 * The gate between "the harness ran at some point" and "this card may finish".
 *
 * A run directory is only evidence of the commit it names: the branch moves, the build is
 * rebuilt, and a green run from twenty commits ago says nothing about the tree being reviewed.
 * So the whole question is one function — is there a run, produced by `run.ts`, against this
 * exact commit, clean, with every policy check present and green? — and this file is where it is
 * answered, so the harness, a reviewer and the card template all answer it the same way instead
 * of each deciding what counts.
 *
 * The second question here is which diffs need a run at all. "Every product card" is not a list
 * of card titles, which is what let the gate become optional: a card was product or not by the
 * prose somebody wrote. It is a list of paths, because that is what a pull request actually is.
 * `APP_SURFACE` is that list, and `appSurface()` answers for any diff.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_OUT = join(homedir(), '.hermes', 'e2e')

/** The checks a run must carry for its pass to count. Absent is not the same as green. */
export const REQUIRED_CHECKS = ['policy.no-host-apps', 'policy.stays-in-room', 'capture.browser-only'] as const

export type E2eCheck = { name: string; ok: boolean; detail: string }

export type E2eReport = {
  card?: { id?: string; title?: string; mode?: string; prompt?: string; expect?: string[] }
  branch?: string
  commit?: string
  dirty?: boolean
  dirty_files?: string[]
  evidence?: string
  checks?: E2eCheck[]
  passed?: boolean
  finished_at?: string
  artifacts?: { screenshots?: string[] }
}

export type E2eRun = {
  dir: string
  commit: string
  branch: string
  finishedAt: string
  dirty: boolean
  passed: boolean
  checks: E2eCheck[]
  report: E2eReport
}

/**
 * The paths whose change means a user-visible surface moved: the page's header, timeline,
 * columns, centre and right panel live in `body/index.html` and its libs, the demo is a build
 * artifact, and the graph view and node panel are the React viewer under `src/`. A card that
 * touches any of them is a product card whatever its prose says.
 */
export const APP_SURFACE: Array<[RegExp, string]> = [
  [/^body\/index\.html$/, 'the page: header, timeline, columns, centre, right panel'],
  [/^body\/lib\//, 'the page: timeline and player behaviour'],
  [/^body\/demo\//, 'the demo build: the case the page opens with'],
  [/^body\/tools\//, 'the demo build: the tools that emit it'],
  [/^app\.json$/, 'the demo build: the app manifest'],
  [/^src\//, 'the graph view and the node panel'],
  [/^(?:package\.json|bun\.lockb?|vite\.config\.[cm]?[jt]s|tsconfig\.json)$/, 'the build itself'],
]

/** Which of `files` are app surface, and which surface each one moves. */
export function appSurface(files: string[]): Array<{ path: string; area: string }> {
  const found: Array<{ path: string; area: string }> = []
  for (const file of files) {
    const path = file.trim()
    if (!path) continue
    for (const [pattern, area] of APP_SURFACE) {
      if (pattern.test(path)) {
        found.push({ path, area })
        break
      }
    }
  }
  return found
}

/** Does this diff need a clean-room run before it may merge? */
export function needsE2e(files: string[]): boolean {
  return appSurface(files).length > 0
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Every run directory under `outDir`, oldest name first (the name carries an ISO timestamp). */
export function runDirs(outDir: string = DEFAULT_OUT): string[] {
  if (!existsSync(outDir)) return []
  return readdirSync(outDir)
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => join(outDir, entry))
    .filter((dir) => existsSync(join(dir, 'report.json')))
    .sort()
}

/** One run, as the report describes it. `null` when the directory holds no usable report. */
export function readRun(dir: string): E2eRun | null {
  const report = readJson<E2eReport>(join(dir, 'report.json'))
  if (!report) return null
  const commit = String(report.commit ?? '')
  if (!/^[0-9a-f]{40}$/.test(commit)) return null
  const checks = Array.isArray(report.checks) ? report.checks : []
  return {
    dir,
    commit,
    branch: String(report.branch ?? ''),
    finishedAt: String(report.finished_at ?? ''),
    dirty: report.dirty === true,
    passed: report.passed === true && checks.every((check) => check.ok === true),
    checks,
    report,
  }
}

/** Newest first, so "the latest run" means what a reader expects. */
export function runs(outDir: string = DEFAULT_OUT): E2eRun[] {
  return runDirs(outDir)
    .map((dir) => readRun(dir))
    .filter((run): run is E2eRun => run !== null)
    .sort((a, b) => (a.dir < b.dir ? 1 : -1))
}

function policyProblems(run: E2eRun): string[] {
  const problems: string[] = []
  for (const name of REQUIRED_CHECKS) {
    const check = run.checks.find((candidate) => candidate.name === name)
    if (!check) problems.push(`${name} is missing`)
    else if (!check.ok) problems.push(`${name} failed: ${check.detail}`)
  }
  return problems
}

export type GateResult = {
  ok: boolean
  run: E2eRun | null
  /** One sentence a worker can act on. Empty when `ok`. */
  reason: string
}

/**
 * The gate. `ok` only for a clean, passing, policy-complete run against exactly `commit`.
 *
 * The reasons are ordered by how far the reader has to go to fix them: no evidence at all, the
 * evidence is for another commit, the evidence is for this commit and it is red, the evidence is
 * for this commit and it is not trustworthy (dirty tree, missing policy scan).
 */
export function gateFor(commit: string, outDir: string = DEFAULT_OUT): GateResult {
  const wanted = commit.trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(wanted)) {
    return { ok: false, run: null, reason: `"${commit}" is not a full commit sha, so no run can be matched to it` }
  }
  const all = runs(outDir)
  if (all.length === 0) {
    return { ok: false, run: null, reason: `no e2e run directory under ${outDir}` }
  }
  const forCommit = all.filter((run) => run.commit === wanted)
  if (forCommit.length === 0) {
    const newest = all[0]
    return {
      ok: false,
      run: null,
      reason: `no e2e run for ${wanted.slice(0, 7)} — the newest run is ${newest.commit.slice(0, 7)} (${newest.dir})`,
    }
  }
  const green = forCommit.filter((run) => run.passed && !run.dirty)
  if (green.length === 0) {
    const red = forCommit.find((run) => !run.passed) ?? forCommit[0]
    const failed = red.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`)
    return {
      ok: false,
      run: red,
      reason: red.dirty
        ? `the run for ${wanted.slice(0, 7)} was made on a dirty worktree, so it is not evidence of the commit`
        : `the run for ${wanted.slice(0, 7)} failed — ${failed.slice(0, 3).join(' / ') || 'see report.json'}`,
    }
  }
  for (const run of green) {
    const problems = policyProblems(run)
    if (problems.length === 0) return { ok: true, run, reason: '' }
  }
  const run = green[0]
  return { ok: false, run, reason: `the run for ${wanted.slice(0, 7)} cannot be trusted — ${policyProblems(run).slice(0, 3).join(' / ')}` }
}

/** One line for a log: which run satisfied the gate, and what it captured. */
export function describeRun(run: E2eRun): string {
  const dom = run.checks.filter((check) => /\.dom$/.test(check.name)).map((check) => check.detail)
  return `${run.dir} (${run.commit.slice(0, 7)}, ${run.checks.filter((check) => check.ok).length}/${run.checks.length} checks${dom.length > 0 ? `, ${dom.join('; ')}` : ''})`
}

function printHelp() {
  console.log(`usage: bun scripts/e2e/gate.ts --commit <sha> [options]

  --commit <sha>   the head commit the run has to be against (required)
  --out <dir>      where run directories live (default: ~/.hermes/e2e)
  --files <paths>  instead of a commit: say whether this diff needs a run at all
  --json           print the result as JSON

Exit 0 = a clean, passing, policy-complete run exists for that commit. Exit 1 = it does not,
and the reason is the one sentence printed. No run is ever invented here.`)
}

function main(argv: string[]): number {
  let commit = ''
  let out = DEFAULT_OUT
  let files: string[] | null = null
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      const value = argv[i]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      return value
    }
    if (arg === '--commit') commit = next()
    else if (arg === '--out') out = next()
    else if (arg === '--files') files = argv.slice(i + 1).filter((value) => !value.startsWith('--'))
    else if (arg === '--json') json = true
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      return 0
    } else throw new Error(`unknown argument ${arg}`)
  }

  if (files) {
    const surface = appSurface(files)
    if (json) console.log(JSON.stringify({ needed: surface.length > 0, surface }, null, 2))
    else if (surface.length === 0) console.log('no e2e needed — none of these paths is app surface')
    else for (const hit of surface) console.log(`e2e needed — ${hit.path} moves ${hit.area}`)
    return 0
  }

  if (!commit) {
    printHelp()
    return 1
  }
  const result = gateFor(commit, out)
  if (json) {
    console.log(JSON.stringify({ ok: result.ok, reason: result.reason, run: result.run?.dir ?? null }, null, 2))
  } else if (result.ok && result.run) {
    console.log(`e2e ok  ${describeRun(result.run)}`)
  } else {
    console.error(`e2e missing  ${result.reason}`)
    console.error(`  run one: bun run e2e --card <task-id>   (it exits non-zero when the card's claim is not visible)`)
  }
  return result.ok ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
