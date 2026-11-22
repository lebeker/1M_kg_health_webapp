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
 * columns, centre and right panel live in `body/` with the anatomy models it loads and the demo
 * it opens with, the graph view and node panel are the React viewer under `src/`, and the graph
 * page's own entry document is what that viewer mounts into.
 *
 * The list is directories, not a set of files somebody has to remember to extend. It was a set of
 * files, and the first three things it quietly exempted were the models the page renders, the
 * graph page's entry document, and the builder that writes the demo artifact — a pull request
 * that changed only one of those moved the product with no run behind it. A directory is only as
 * narrow as `NOT_PRODUCT` below, which is short, explicit, and read by the tests.
 */
export const APP_SURFACE: Array<[RegExp, string]> = [
  [/^body\//, 'the page: header, timeline, columns, centre, right panel, the models it loads and the demo build'],
  [/^src\//, 'the graph view and the node panel'],
  [/^index\.html$/, "the graph page's entry document, which the viewer mounts into"],
  [/^scripts\/build-demo\.ts$/, 'the case build: the builder that writes dist/demo.html'],
  [/^app\.json$/, 'the demo build: the app manifest'],
  [/^(?:package\.json|bun\.lockb?|vite\.config\.[cm]?[jt]s|tsconfig\.json)$/, 'the build itself'],
]

/**
 * Paths that sit inside a surface directory and are not the product: the screenshots the page's
 * checks take, the page's own notes, the viewer's tests. An allowlist rather than an exemption
 * list, so a new file under `body/` or `src/` is surface until somebody says otherwise in a diff
 * anyone can read.
 */
export const NOT_PRODUCT: Array<[RegExp, string]> = [
  [/^body\/shots\//, 'screenshots of the page, produced by the checks and by reviewers'],
  [/^body\/.*\.md$/, 'notes about the page, not the page'],
  [/^src\/[^/]*\.test\.tsx?$/, "the viewer's own tests"],
]

/** Which of `files` are app surface, and which surface each one moves. */
export function appSurface(files: string[]): Array<{ path: string; area: string }> {
  const found: Array<{ path: string; area: string }> = []
  for (const file of files) {
    const path = file.trim()
    if (!path) continue
    if (NOT_PRODUCT.some(([pattern]) => pattern.test(path))) continue
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

/** A report's `finished_at`, or `''` when it cannot be read. Used for ordering only. */
function finishedAt(dir: string): string {
  const report = readJson<{ finished_at?: unknown }>(join(dir, 'report.json'))
  return typeof report?.finished_at === 'string' ? report.finished_at : ''
}

/**
 * Every run directory under `outDir`, oldest first, ordered by the report's `finished_at`.
 *
 * Not by the directory name: names carry a mode prefix (`smoke-`, `backfill-`, `receipt-proof-`,
 * the card id), so sorting them sorts by prefix and can present a two-day-old smoke run as the
 * latest thing that happened while four runs from today sit behind it. The timestamp is in the
 * name but it is not at the front of it, which is the whole bug.
 */
export function runDirs(outDir: string = DEFAULT_OUT): string[] {
  if (!existsSync(outDir)) return []
  return readdirSync(outDir)
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => join(outDir, entry))
    .filter((dir) => existsSync(join(dir, 'report.json')))
    .map((dir) => ({ dir, at: finishedAt(dir) }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.dir.localeCompare(b.dir))
    .map((entry) => entry.dir)
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
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.dir.localeCompare(a.dir))
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
      reason: `no e2e run for ${wanted.slice(0, 7)} — the latest run is ${newest.commit.slice(0, 7)} (${newest.dir}, finished ${newest.finishedAt || 'at an unrecorded time'})`,
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

function printHelp(to: (line: string) => void = console.log) {
  to(`usage: bun scripts/e2e/gate.ts --commit <sha> [options]

  --commit <sha>       the head commit the run has to be against (required)
  --out <dir>          where run directories live (default: ~/.hermes/e2e)
  --files <path>...    instead of a commit: say whether this diff needs a run at all
  --json               print the result as JSON

Exit 0 = a clean, passing, policy-complete run exists for that commit, or (with --files) the
question was answered: the list needs a run, or it does not. Exit 1 = no such run exists, or
--files was given no paths to ask about, or a flag was unusable — the reason is the one sentence
printed. No run is ever invented here.`)
}

export type GateIo = { out: (line: string) => void; err: (line: string) => void }

const CONSOLE_IO: GateIo = { out: (line) => console.log(line), err: (line) => console.error(line) }

export function main(argv: string[], io: GateIo = CONSOLE_IO): number {
  let commit = ''
  let out = DEFAULT_OUT
  let files: string[] | null = null
  let json = false
  try {
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
      else if (arg === '--files') {
        // Everything up to the next flag is a path. Consume it, or the loop walks into the paths
        // and throws "unknown argument body/lib/right-panel.js" on every real invocation.
        files = []
        let j = i + 1
        while (j < argv.length && !argv[j].startsWith('--')) {
          files.push(argv[j])
          j += 1
        }
        i = j - 1
      } else if (arg === '--json') json = true
      else if (arg === '--help' || arg === '-h') {
        printHelp(io.out)
        return 0
      } else throw new Error(`unknown argument ${arg}`)
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  }

  if (files) {
    const paths = files.map((value) => value.trim()).filter(Boolean)
    if (paths.length === 0) {
      // "no paths" is not "no surface": answering exempt here is the false negative that lets a
      // gate go quiet, so it is a usage error instead of a pass.
      io.err('--files needs at least one path — with none, there is no diff to ask about')
      return 1
    }
    const surface = appSurface(paths)
    if (json) io.out(JSON.stringify({ needed: surface.length > 0, surface }, null, 2))
    else if (surface.length === 0) io.out('no e2e needed — none of these paths is app surface')
    else for (const hit of surface) io.out(`e2e needed — ${hit.path} moves ${hit.area}`)
    return 0
  }

  if (!commit) {
    printHelp(io.out)
    return 1
  }
  const result = gateFor(commit, out)
  if (json) {
    io.out(JSON.stringify({ ok: result.ok, reason: result.reason, run: result.run?.dir ?? null }, null, 2))
  } else if (result.ok && result.run) {
    io.out(`e2e ok  ${describeRun(result.run)}`)
  } else {
    io.err(`e2e missing  ${result.reason}`)
    io.err(`  run one: bun run e2e --card <task-id>   (it exits non-zero when the card's claim is not visible)`)
  }
  return result.ok ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
