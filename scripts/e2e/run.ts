#!/usr/bin/env bun
/**
 * G3 — agentic end to end, per card. One command, one fresh agent, evidence a reviewer can
 * look at, non-zero exit when the product did not deliver the card's claim.
 *
 *   bun run e2e --card t_0042bfe2
 *   bun run e2e --card scripts/e2e/fixtures/smoke-card.md --label smoke --no-comment
 *
 * What it does, in order (docs/DELIVERY-LOOP.md §3):
 *
 *  1. reads the card and takes the user's question from its `## e2e` block;
 *  2. builds the card's worktree (`bun run build`) and records the commit and the artifact hash;
 *  3. makes a clean room — the `kg` skill and the app installed from a local mirror of that
 *     build, no repo, no fixtures, no memory — and gives one fresh agent the one sentence;
 *  4. takes what the agent produced (`kg.json`), then opens the page it rendered in a capture
 *     session that has Hermes's `browser_*` tools and nothing else: readiness, title, header,
 *     visible text, a sha256 over the live DOM, and a screenshot. Which page is opened is the
 *     card's `page:` line: the graph view (`dist/graph.html`) and/or the columns page
 *     (`dist/demo.html` + the agent's document), and each capture records which it is;
 *  5. replays that same `kg.json` inside the branch build, captures it the same way, and runs
 *     the acceptance scripts (`bun run verify`, the kg/1 contract over the agent's document);
 *  6. writes `report.json` next to the screenshots and posts one `e2e` commit status on the head
 *     it built, so CI can require the receipt; on a pass the numbers and the artifacts are
 *     attached to the card, on a failure the card gets the transcripts, a red status and leaves
 *     `review`; exits 1.
 *
 * The card's claim is the only thing that decides pass or fail. "It rendered" is not a claim.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { capturePages, describeValues, type PageCapture } from './capture'
import { type Card, cardStatus, missingPromptHelp, type PageKind, readCard } from './card'
import { findArtifacts, keepRoomCopy, prepareCleanRoom, runAgent } from './cleanroom'
import type { ToolCall } from './hermes'
import { inject } from './inject'
import { worktreeState } from './git-state'
import { captureScopeViolations, hostAppCalls, outsideRoomCalls } from './policy'
import { type Check, describeGaps, receiptDescription, screenshotCheck, verdict } from './receipt'
import { onRemote, postStatus } from './status'

/** The parts of a kg/1 document the harness reads. */
type KgDocument = {
  meta?: { title?: string; app?: string }
  nodes?: unknown[]
  edges?: unknown[]
}

type Options = {
  card: string
  worktree: string
  out: string
  kgSkill: string
  promptOverride: string | null
  label: string
  skipVerify: boolean
  skipBuild: boolean
  comment: boolean
  keepRoom: boolean
  timeoutMs: number
  /** Post the `e2e` commit status that CI reads. Off only for a probe run. */
  status: boolean
  /** On failure, move the card out of `review` (or block it) instead of leaving it to merge. */
  returnCard: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    card: '',
    worktree: process.cwd(),
    out: '',
    kgSkill: process.env.KG_SKILL ?? '',
    promptOverride: null,
    label: '',
    skipVerify: false,
    skipBuild: false,
    comment: true,
    keepRoom: false,
    timeoutMs: 15 * 60_000,
    status: true,
    returnCard: true,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      const value = argv[i]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      return value
    }
    switch (arg) {
      case '--card':
        options.card = next()
        break
      case '--worktree':
        options.worktree = resolve(next())
        break
      case '--out':
        options.out = resolve(next())
        break
      case '--kg-skill':
        options.kgSkill = resolve(next())
        break
      case '--prompt':
        options.promptOverride = next()
        break
      case '--label':
        options.label = next()
        break
      case '--timeout':
        options.timeoutMs = Number(next()) * 1000
        break
      case '--no-comment':
        options.comment = false
        break
      case '--no-status':
        options.status = false
        break
      case '--no-return-card':
        options.returnCard = false
        break
      case '--skip-verify':
        options.skipVerify = true
        break
      case '--skip-build':
        options.skipBuild = true
        break
      case '--keep-room':
        options.keepRoom = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        throw new Error(`unknown argument ${arg}`)
    }
  }
  if (!options.card) throw new Error('--card is required')
  if (!options.kgSkill) {
    for (const candidate of [join(options.worktree, '..', '1M_kg_skill'), join(process.env.HOME ?? '', 'Work/other/1M_kg_skill')]) {
      if (existsSync(join(candidate, 'scripts', 'kg.py'))) {
        options.kgSkill = resolve(candidate)
        break
      }
    }
  }
  if (!options.kgSkill) throw new Error('no kg skill found — pass --kg-skill <path-to-1M_kg_skill>')
  // Outside the repo on purpose. Evidence next to the worktree is a checkout away from the
  // clean room, and the room itself is built in the system temp directory for the same reason.
  options.out = options.out || join(homedir(), '.hermes', 'e2e')
  if (resolve(options.out).startsWith(`${resolve(options.worktree)}${sep}`)) {
    throw new Error(`--out ${options.out} is inside the worktree — evidence belongs outside the repo`)
  }
  return options
}

function printHelp() {
  console.log(`usage: bun run e2e --card <task-id | card.md> [options]

  --worktree <dir>     the card's worktree (default: cwd)
  --out <dir>          where evidence goes, outside the repo (default: ~/.hermes/e2e)
  --kg-skill <dir>     the kg skill checkout (default: $KG_SKILL, ../1M_kg_skill)
  --prompt <text>      override the card's prompt (recorded as an override, for debugging)
  --label <text>       prefix for the run directory, e.g. "smoke"
  --timeout <seconds>  how long the fresh agent may take (default: 900)
  --skip-build         reuse dist/graph.html (and dist/demo.html) from an earlier build
  --skip-verify        do not run \`bun run verify\`
  --no-comment         never comment on the card, even on failure
  --no-status          do not post the \`e2e\` commit status CI reads
  --no-return-card     on failure, leave the card where it is (do not reopen or block it)
  --keep-room          copy the clean room into the evidence directory`)
}

function sha256(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function run(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/**
 * Desktop applications are out of bounds for a bot (owner policy), and a machine-wide search is
 * the other half of the same boundary: `find /` crosses `/Volumes` and makes macOS ask this
 * machine's owner for permission. Both checks live in `policy.ts`, where they are unit tested;
 * this gate is where they are enforced — a child that did either produced evidence the harness
 * did not choose, and the run fails rather than reports it as a note.
 *
 * The third check is about scope, not about the machine: the capture session's documented surface
 * is three tools, and a session is only as narrow as its worst call.
 */
function policyChecks(sessionCalls: ToolCall[], roomCalls: ToolCall[], captureCalls: ToolCall[]): Check[] {
  const hostApps = hostAppCalls(sessionCalls)
  const escapes = outsideRoomCalls(roomCalls)
  const outOfScope = captureScopeViolations(captureCalls)
  return [
    {
      name: 'policy.no-host-apps',
      ok: hostApps.length === 0,
      detail: hostApps.length === 0 ? `${sessionCalls.length} child tool calls, none launched or attached to a desktop app` : hostApps.join(' / '),
    },
    {
      name: 'policy.stays-in-room',
      ok: escapes.length === 0,
      detail:
        escapes.length === 0
          ? `${roomCalls.length} clean-room tool calls, none searched or read outside the room`
          : escapes.join(' / '),
    },
    {
      name: 'capture.browser-only',
      ok: outOfScope.length === 0 && captureCalls.length > 0,
      detail:
        outOfScope.length > 0
          ? outOfScope.join(' / ')
          : captureCalls.length === 0
            ? 'the capture session made no tool calls, so its scope was never exercised'
            : `${captureCalls.length} capture calls, all browser_navigate / browser_console / browser_vision`,
    },
  ]
}

type PageValues = {
  url?: string
  page?: string
  ready?: boolean
  title?: string
  header?: string
  text?: string
  claim?: Array<{ needle: string; found: boolean }>
  mounted?: number
  empty?: string | null
  /** The columns page's own hooks: what it holds, what it drew, which rows it lists. */
  documentState?: string
  columns?: { left?: number; centre?: number; panel?: number; centreFilled?: boolean; centreRecord?: string; states?: number }
  records?: { total?: number; stored?: number; sample?: Array<{ kind?: string; date?: string }> }
  domBytes?: number
  domSha256?: string
  domHead?: string
  capturedAt?: string
}

/** `2024-03-05` out of whatever the document stores — a date, or a date-time. */
function day(value: unknown): string {
  const text = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''
}

/**
 * The checks for one captured page. The two pages do not have the same anatomy, so they do not
 * have the same evidence: the graph page proves itself with a `N nodes · M edges` header and a
 * mounted root, and the columns page with a document in its slot, three columns laid out and a
 * record list whose dates are the document's own. The claim checks are the same on both, and
 * they are the only part that decides the card.
 */
function pageChecks(stage: string, capture: PageCapture, document: KgDocument): Check[] {
  const values = capture.values as PageValues
  const nodes = document.nodes ?? []
  const edges = document.edges?.length ?? 0
  const docTitle = String(document.meta?.title ?? '')
  const header = String(values.header ?? '')
  const mounted = Number(values.mounted ?? 0)
  const claim = Array.isArray(values.claim) ? values.claim : []
  const checks: Check[] = [
    {
      name: `${stage}.browser`,
      ok: capture.problems.length === 0,
      detail:
        capture.problems.length === 0
          ? `the page was opened and read (${capture.screenshotRoute ? `photographed by ${capture.screenshotRoute}` : 'not photographed'})`
          : capture.problems.join(' / '),
    },
    {
      name: `${stage}.url`,
      ok: String(values.url ?? '') === capture.url,
      detail: `the browser reported ${values.url ? String(values.url) : 'no url'}, expected ${capture.url}`,
    },
  ]

  if (capture.kind === 'case') {
    const columns = values.columns ?? {}
    const records = values.records ?? {}
    const sample = Array.isArray(records.sample) ? records.sample : []
    const dated = new Set(
      nodes
        .map((node) => day((node as { when?: unknown }).when) || day((node as { date?: unknown }).date))
        .filter(Boolean),
    )
    const offDocument = sample.filter((row) => !dated.has(day(row.date)))
    checks.push(
      {
        name: `${stage}.page-ready`,
        ok: values.ready === true && values.documentState === 'present',
        detail:
          values.ready === true
            ? `the page holds a document and drew ${Number(columns.left ?? 0)} / ${Number(columns.centre ?? 0)} / ${Number(columns.panel ?? 0)} px of columns, centre on ${String(columns.centreRecord ?? '(none)')}`
            : `the columns page never finished its first render — document ${String(values.documentState ?? 'unknown')}, columns ${Number(columns.left ?? 0)} / ${Number(columns.centre ?? 0)} / ${Number(columns.panel ?? 0)} px`,
      },
      {
        name: `${stage}.not-empty`,
        ok: values.documentState === 'present',
        detail: values.documentState === 'present' ? 'the columns page is holding the run\'s document' : `the page says: no ${String(values.empty ?? 'document')}`,
      },
      {
        name: `${stage}.records`,
        ok: sample.length > 0 && offDocument.length === 0,
        detail:
          sample.length === 0
            ? 'the record list drew no stored row, so the page is not showing this document'
            : `${Number(records.stored ?? 0)} stored rows of ${Number(records.total ?? 0)}: ${sample
                .slice(0, 4)
                .map((row) => `${String(row.kind ?? '?')} ${String(row.date ?? '?')}`)
                .join(', ')}${offDocument.length > 0 ? ` — ${offDocument.length} row date(s) are not in the document: ${offDocument.map((row) => String(row.date)).join(', ')}` : ' — every one is dated in the document'}`,
      },
    )
  } else {
    checks.push(
      {
        name: `${stage}.page-ready`,
        ok: values.ready === true,
        detail: values.ready === true ? `${mounted} elements under #root` : 'the page never finished its first render',
      },
      {
        name: `${stage}.not-empty`,
        ok: values.empty === null || values.empty === undefined,
        detail: values.empty == null ? 'the viewer drew a graph' : `the viewer says: no ${String(values.empty)} yet`,
      },
      {
        name: `${stage}.title`,
        ok: docTitle.length > 0 && String(values.title ?? '') === docTitle,
        detail: `page title "${String(values.title ?? '')}", document title "${docTitle}"`,
      },
      {
        name: `${stage}.counts`,
        ok: header.includes(`${nodes.length} nodes`) && header.includes(`${edges} edges`),
        detail: `header "${header}" for ${nodes.length} nodes / ${edges} edges`,
      },
    )
  }

  checks.push(
    {
      name: `${stage}.dom`,
      ok: Number(values.domBytes ?? 0) > 10_000 && String(values.domSha256 ?? '').length === 64,
      detail: `${Number(values.domBytes ?? 0)} bytes of DOM, sha256 ${String(values.domSha256 ?? '').slice(0, 12)}`,
    },
    // Not hard: the page's own checks decide the run. A missing photograph is a gap on the
    // receipt (`receipt.ts`), because a capture tool that deadlocks is not a product defect —
    // SCRUM-64, where `browser_vision` timed out on every call while the DOM read was perfect.
    screenshotCheck(stage, capture),
  )
  if (claim.length === 0) {
    checks.push({ name: `${stage}.claim`, ok: false, detail: 'the card states no expected text, so its own claim was not checked' })
  }
  for (const hit of claim) {
    checks.push({ name: `${stage}.claim`, ok: hit.found === true, detail: `${hit.found ? 'visible' : 'not visible'}: "${hit.needle}"` })
  }
  return checks
}

function printChecks(checks: Check[]) {
  for (const check of checks) {
    // `gap` is not `note`: it is a check the run could not satisfy for a reason that is not the
    // product, and the word is the receipt's word for it.
    const flag = check.ok ? 'ok  ' : check.hard === false ? 'gap ' : 'FAIL'
    console.log(`  ${flag} ${check.name} — ${check.detail}`)
  }
}

function kanban(args: string[]): { ok: boolean; output: string } {
  const binary = process.env.HERMES_BIN ?? 'hermes'
  const env = { ...process.env }
  delete env.HERMES_KANBAN_TASK
  const result = spawnSync(binary, ['kanban', ...args], { encoding: 'utf8', env })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

function commentOnCard(taskId: string, body: string, files: string[]) {
  const comment = kanban(['comment', taskId, body])
  if (!comment.ok) console.error(`could not comment on ${taskId}: ${comment.output}`)
  for (const path of files) {
    if (!existsSync(path)) continue
    const attach = kanban(['attach', taskId, path, '--name', basename(path)])
    if (!attach.ok) console.error(`could not attach ${path}: ${attach.output}`)
  }
}

/**
 * A red run leaves the card where it cannot merge: `review` goes back to the implementer, and a
 * card a live worker is holding is blocked for a human rather than quietly left alone. The one
 * thing a failed run never does is move a card toward `done` — `docs/DELIVERY-LOOP.md` §3, and
 * the red `e2e` status it posts is what makes that true even if a worker ignores this.
 */
function returnCard(taskId: string, reason: string): string {
  const status = cardStatus(taskId)
  if (status === null) return 'file card — nothing to move'
  if (status === 'review') {
    const reopened = kanban(['reopen-review', taskId, '--reason', reason])
    return reopened.ok ? 'card reopened from review to ready' : `could not reopen the card: ${reopened.output}`
  }
  if (status === 'running') {
    const blocked = kanban(['block', taskId, '--kind', 'transient', reason])
    return blocked.ok ? 'card blocked as transient while its worker still holds it' : `could not block the card: ${blocked.output}`
  }
  return `card is ${status}; left where it is`
}

/** `N nodes / M edges` as the page itself printed them, or the document's own count. */
function pageCounts(capture: PageCapture, document: KgDocument): string {
  const values = capture.values as PageValues
  if (capture.kind === 'case') {
    const records = values.records ?? {}
    const columns = values.columns ?? {}
    const drawn = `${Number(records.stored ?? 0)} record(s) drawn, columns ${Number(columns.left ?? 0)}/${Number(columns.centre ?? 0)}/${Number(columns.panel ?? 0)} px`
    return drawn
  }
  const header = String(values.header ?? '')
  const match = header.match(/(\d+)\s+nodes?\D+(\d+)\s+edges?/i)
  if (match) return `${match[1]} nodes / ${match[2]} edges`
  return `${document.nodes?.length ?? 0} nodes / ${document.edges?.length ?? 0} edges (document; no header read)`
}

function checkDetail(checks: Check[], name: string): string {
  const check = checks.find((candidate) => candidate.name === name)
  if (!check) return 'missing'
  return `${check.ok ? 'ok' : 'FAILED'} — ${check.detail}`
}

/**
 * What the card carries when the run passes. The reviewer should not have to open a directory to
 * know whether the run happened or what it saw, so the numbers are in the comment and the
 * artifacts are attached beside it.
 */
function evidenceBody(input: {
  card: Card
  branch: string
  commit: string
  dirty: boolean
  evidence: string
  document: KgDocument
  captures: PageCapture[]
  checks: Check[]
  gaps: Check[]
  receipt: string
}): string {
  const lines = [
    `G3 agentic e2e PASS — ${input.card.id} "${input.card.title}"`,
    '',
    `run: ${input.evidence}`,
    `branch ${input.branch} @ ${input.commit.slice(0, 7)} (${input.dirty ? 'dirty worktree — not commit-bound' : 'clean tree'})`,
    `page ${input.card.pages.join('+')} — every claim below names the page it was checked against`,
    ...(input.gaps.length > 0 ? ['', 'evidence gaps (a capture tool that did not answer, not a product failure):', ...describeGaps(input.gaps).map((gap) => `- ${gap}`)] : []),
    '',
    'replay counts:',
    ...input.captures.map((capture) => `- ${capture.label}: ${pageCounts(capture, input.document)}`),
    '',
    'DOM:',
    ...input.captures.map((capture) => {
      const values = capture.values as PageValues
      return `- ${capture.label}: ${Number(values.domBytes ?? 0)} bytes, sha256 ${String(values.domSha256 ?? '')}`
    }),
    '',
    'screenshots:',
    ...input.captures.map(
      (capture) => `- ${capture.label}: ${capture.screenshot || '(none)'}${capture.screenshotRoute ? ` — taken by ${capture.screenshotRoute}` : ''}`,
    ),
    '',
    'claim:',
    ...input.captures.flatMap((capture) => {
      const values = capture.values as PageValues
      const claim = Array.isArray(values.claim) ? values.claim : []
      const where = `${capture.label} (${capture.kind} page)`
      if (claim.length === 0) return [`- ${where}: the card states no expected text`]
      return claim.map((hit) => `- ${where}: ${hit.found ? 'visible' : 'NOT visible'} — "${hit.needle}"`)
    }),
    '',
    `policy.no-host-apps: ${checkDetail(input.checks, 'policy.no-host-apps')}`,
    `policy.stays-in-room: ${checkDetail(input.checks, 'policy.stays-in-room')}`,
    `capture.browser-only: ${checkDetail(input.checks, 'capture.browser-only')}`,
    '',
    `receipt: ${input.receipt}`,
  ]
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const card: Card = readCard(options.card)
  if (options.promptOverride) card.prompt = options.promptOverride
  if (!card.prompt) {
    console.error(missingPromptHelp(card))
    process.exit(2)
  }

  const worktree = options.worktree
  const { commit, branch, dirtyFiles } = worktreeState(worktree)
  const dirty = dirtyFiles.length > 0

  if (!options.skipBuild) {
    console.log(`build   ${branch} @ ${commit.slice(0, 7)} (bun run build)`)
    const build = run('bun', ['run', 'build'], worktree)
    if (!build.ok) {
      console.error(build.output)
      process.exit(1)
    }
  }
  const buildPath = join(worktree, 'dist', 'graph.html')
  if (!existsSync(buildPath)) throw new Error(`${buildPath} is missing — run without --skip-build`)
  const buildBytes = readFileSync(buildPath)
  /** The three-column page, built by the same `bun run build` (`scripts/build-demo.ts`). */
  const caseBuildPath = join(worktree, 'dist', 'demo.html')
  const caseBytes = card.pages.includes('case') ? (existsSync(caseBuildPath) ? readFileSync(caseBuildPath) : null) : null
  if (card.pages.includes('case') && !caseBytes) throw new Error(`${caseBuildPath} is missing and the card asks for the case page — run without --skip-build`)

  const slugBase = card.source === 'file' ? basename(card.id).replace(/\.[^.]+$/, '') : card.id
  const slug = `${options.label ? `${options.label}-` : ''}${slugBase.replace(/[^A-Za-z0-9_-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const evidence = join(options.out, slug)
  mkdirSync(evidence, { recursive: true })
  copyFileSync(buildPath, join(evidence, 'build.html'))
  writeFileSync(join(evidence, 'card.json'), `${JSON.stringify({
    id: card.id,
    title: card.title,
    source: card.source,
    mode: card.mode,
    pages: card.pages,
    prompt: card.prompt,
    prompt_source: options.promptOverride ? 'override' : 'card',
    expect: card.expect,
    branch,
    commit,
    dirty,
    dirty_files: dirtyFiles,
    build: { path: join(evidence, 'build.html'), sha256: sha256(buildBytes), bytes: buildBytes.length },
    case_build: caseBytes ? { path: caseBuildPath, sha256: sha256(caseBytes), bytes: caseBytes.length } : null,
    started_at: new Date().toISOString(),
  }, null, 2)}\n`)

  console.log(`card    ${card.id} — ${card.title}`)
  console.log(`prompt  "${card.prompt}"  (${options.promptOverride ? 'override' : 'from the card'}, mode ${card.mode}, page ${card.pages.join('+')})`)
  console.log(`evidence ${evidence}`)
  console.log()

  const checks: Check[] = []
  const allCalls: ToolCall[] = []
  /** Only the clean-room agent's calls: the room's boundary, not the capture session's file URLs. */
  const roomCalls: ToolCall[] = []
  /** Only the capture session's calls: its documented scope is three tools, and it is checked. */
  const captureCalls: ToolCall[] = []
  let captures: PageCapture[] = []
  let document: KgDocument = {}
  let agentLog = join(evidence, 'agent.jsonl')
  let captureLog = join(evidence, 'capture.jsonl')

  const room = await prepareCleanRoom({
    buildPath,
    manifestPath: join(worktree, 'app.json'),
    worktree,
    skillPath: options.kgSkill,
    commit,
  })
  console.log(`room    ${room.dir} — kg skill + ${room.appId} from ${room.mirrorUrl}`)

  try {
    const agent = await runAgent(room, card.prompt, { logPath: agentLog, timeoutMs: options.timeoutMs })
    allCalls.push(...agent.calls)
    roomCalls.push(...agent.calls)
    agentLog = agent.logPath
    console.log(`agent   exit ${agent.code} in ${agent.seconds}s, ${agent.calls.length} tool calls (${agent.logPath})`)
    checks.push({
      name: 'agent.exit',
      ok: agent.code === 0 && !agent.timedOut,
      detail: agent.timedOut ? `killed after ${agent.seconds}s` : `exit ${agent.code} after ${agent.seconds}s, ${agent.calls.length} tool calls`,
    })

    const found = findArtifacts(room)
    checks.push({ name: 'agent.kg-json', ok: found !== null, detail: found ? found.graphPath : 'the agent left no storage/<id>/graph.json' })

    if (found) {
      const graphBytes = readFileSync(found.graphPath)
      copyFileSync(found.graphPath, join(evidence, 'kg.json'))
      document = JSON.parse(graphBytes.toString('utf8')) as typeof document
      checks.push({ name: 'agent.kg-json-parses', ok: (document.nodes?.length ?? 0) > 0, detail: `${document.nodes?.length ?? 0} nodes / ${document.edges?.length ?? 0} edges, sha256 ${sha256(graphBytes).slice(0, 12)}` })

      const contract = run('bun', ['scripts/validate-kg-fixtures.ts', join(evidence, 'kg.json')], worktree)
      writeFileSync(join(evidence, 'contract.txt'), contract.output)
      checks.push({ name: 'g1.contract', ok: contract.ok, detail: contract.ok ? 'the agent\'s document conforms to kg/1' : contract.output.trim().split('\n').slice(-3).join(' / ') })

      const cleanroomPage = found.pagePath ?? join(evidence, 'cleanroom-injected.html')
      if (!found.pagePath) writeFileSync(cleanroomPage, inject(buildBytes.toString('utf8'), document))
      const replayPage = join(evidence, 'replay.html')

      const pages: Array<{ label: string; url: string; expect: string[]; kind: PageKind; view?: 'record' | 'profile' }> = []
      if (card.pages.includes('graph')) {
        if (card.mode === 'full') writeFileSync(replayPage, inject(buildBytes.toString('utf8'), document))
        pages.push({ label: 'cleanroom', url: `file://${cleanroomPage}`, expect: card.expect, kind: 'graph' })
        if (card.mode === 'full') pages.push({ label: 'replay', url: `file://${replayPage}`, expect: card.expect, kind: 'graph' })
      }
      if (card.pages.includes('case')) {
        // The columns page the branch builds, with the run's own document in its slot. It is not
        // retitled: `dist/demo.html` carries the product's title, and a page the harness renamed
        // is not the page under test. `lib/` and `models/` are what the page loads relatively,
        // so they are linked beside the copy — otherwise nothing on it renders.
        const casePath = join(evidence, 'case.html')
        writeFileSync(casePath, inject(readFileSync(caseBuildPath, 'utf8'), document, { title: false }))
        for (const asset of ['lib', 'models']) {
          const from = join(worktree, 'dist', asset)
          const to = join(evidence, asset)
          if (!existsSync(from)) throw new Error(`${from} is missing — the columns page loads ${asset}/ and the build did not install it`)
          if (!existsSync(to)) symlinkSync(from, to, 'dir')
        }
        pages.push({ label: 'case', url: `file://${casePath}`, expect: card.expect, kind: 'case', view: card.view })
      }

      const capture = await capturePages({ pages, outDir: evidence })
      allCalls.push(...capture.calls)
      captureCalls.push(...capture.calls)
      captureLog = capture.logPath
      captures = capture.pages
      writeFileSync(join(evidence, 'capture.tools.json'), `${JSON.stringify(capture.tools, null, 2)}\n`)
      console.log(`capture exit ${capture.code} in ${capture.seconds}s, ${capture.tools.length} tool calls: ${capture.tools.join(' | ') || '(none)'}`)
      checks.push({
        // Hard only when the session produced nothing at all: then no page's DOM was read and
        // there is no evidence to judge. A killed or non-zero session that still read the pages
        // is a capture gap, and its pages carry their own red checks if they were not read.
        name: 'capture.session',
        ok: capture.sessionProblems.length === 0 && capture.tools.length > 0,
        detail:
          capture.sessionProblems.length > 0
            ? `${capture.sessionProblems.join(' / ')} — see ${capture.logPath}`
            : `exit ${capture.code} after ${capture.seconds}s; ${capture.tools.length} browser_* calls${capture.evidenceGaps.length > 0 ? `, ${capture.evidenceGaps.length} capture gap(s)` : ''}`,
      })
      for (const gap of capture.evidenceGaps) {
        checks.push({ name: `capture.gap`, ok: false, hard: false, detail: gap })
      }

      for (const page of capture.pages) {
        checks.push(...pageChecks(page.label, page, document))
        if (Object.keys(page.values).length > 0) {
          writeFileSync(join(evidence, `${page.label}.values.json`), `${JSON.stringify(page.values, null, 2)}\n`)
        }
      }

      if (card.mode === 'full' && !options.skipVerify) {
        const verify = run('bun', ['run', 'verify'], worktree)
        writeFileSync(join(evidence, 'verify.txt'), verify.output)
        checks.push({ name: 'g2.verify', ok: verify.ok, detail: verify.ok ? 'lint, types, unit, contract fixtures, branch name: green' : verify.output.trim().split('\n').slice(-3).join(' / ') })
      }
      if (options.keepRoom) keepRoomCopy(room, join(evidence, 'room'))
    }
  } finally {
    await room.close()
  }

  checks.push(...policyChecks(allCalls, roomCalls, captureCalls))

  /**
   * Two lists, not one. `failures` are the product checks that are red and they are what makes the
   * run red. `gaps` are the capture checks that could not be satisfied — a photograph that no
   * camera took — recorded on the receipt and never a veto (`receipt.ts` says why).
   */
  const { passed, failures: failed, gaps } = verdict(checks)
  /**
   * Which page each claim was checked against. The page kinds are recorded per capture as well as
   * on the card, because the reviewer's question is not "what did the card ask for" but "what did
   * this run actually open, and could the claim have failed there".
   */
  const pages = captures.map((capture) => {
    const values = capture.values as PageValues
    const claim = Array.isArray(values.claim) ? values.claim : []
    return {
      label: capture.label,
      kind: capture.kind,
      url: capture.url,
      screenshot: capture.screenshot,
      dom_bytes: Number(values.domBytes ?? 0),
      dom_sha256: String(values.domSha256 ?? ''),
      claim: claim.map((hit) => ({ needle: hit.needle, found: hit.found })),
    }
  })
  const report = {
    card: { id: card.id, title: card.title, mode: card.mode, page: card.pages, view: card.view, prompt: card.prompt, expect: card.expect },
    branch,
    commit,
    dirty,
    dirty_files: dirtyFiles,
    evidence,
    pages,
    // The receipt names both routes, because which camera took the picture is part of the record:
    // a run that only ever used the bundled binary never exercised `browser_vision`, and a
    // reviewer who knows the wrapper is broken can tell that apart from a clean session.
    browser: {
      route: 'hermes browser_* tools in a capture session, with the bundled agent-browser binary as the fallback',
      tools: captures.length > 0,
      routes: captures.map((capture) => ({ page: capture.label, route: capture.screenshotRoute || 'none' })),
    },
    artifacts: {
      kg_json: join(evidence, 'kg.json'),
      values: captures.map((page) => join(evidence, `${page.label}.values.json`)),
      screenshots: captures.map((page) => page.screenshot).filter(Boolean),
      agent_log: agentLog,
      capture_log: captureLog,
    },
    checks,
    /** What the run could not photograph. Named here so a green receipt is not silent about it. */
    evidence_gaps: gaps.map((gap) => ({ check: gap.name, detail: gap.detail })),
    passed,
    finished_at: new Date().toISOString(),
  }
  writeFileSync(join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  /**
   * The receipt. Posted only from here, only for the commit that was built: this is what
   * `.github/workflows/verify.yml` requires on a product pull request, and a green receipt is the
   * only thing that lets `verify` pass without a run. A run that did not build the commit has no
   * business posting anything, so a dirty tree or a commit the remote has never seen is reported
   * rather than stamped.
   */
  const receipt = (() => {
    if (!options.status) return 'not posted (--no-status)'
    if (dirty) return 'not posted — the worktree was dirty, so this run is not evidence of the commit'
    if (!onRemote(worktree, commit)) return `not posted — ${commit.slice(0, 7)} is not on origin, so it has no pull request`
    // A capture gap does not change the state. That is the whole point of the card: the receipt
    // records what could not be photographed and still lets a green run be green.
    const state = passed ? 'success' : 'failure'
    const posted = postStatus({
      worktree,
      sha: commit,
      state,
      description: receiptDescription({
        pages: card.pages,
        failures: failed,
        gaps,
        run: basename(evidence),
        // A kanban card is named by its id; a card file is named by its file, not by the absolute
        // path the reader cannot use (and which spent the status's 140 characters on `/Users/…`).
        cardId: card.source === 'kanban' ? card.id : basename(card.id),
      }),
    })
    if (!posted.ok) return `NOT posted: ${posted.output.split('\n').slice(0, 2).join(' ')}`
    const gapNote = gaps.length > 0 ? ` — ${gaps.length} evidence gap(s): ${gaps.map((gap) => gap.name).join(', ')}` : ''
    return `e2e=${state} posted on ${commit.slice(0, 7)} (${basename(evidence)})${gapNote}`
  })()
  writeFileSync(join(evidence, 'status.txt'), `${receipt}\n`)
  console.log(`status  ${receipt}`)

  console.log()
  printChecks(checks)
  console.log()
  if (passed) {
    console.log(`PASS  ${card.id} — ${checks.length} checks${gaps.length > 0 ? `, ${gaps.length} evidence gap(s)` : ''}, evidence in ${evidence}`)
    for (const capture of captures) {
      console.log(
        `      ${capture.label}: ${describeValues(capture.values, capture.kind)} — ${capture.screenshot || '(no screenshot)'}${capture.screenshotRoute ? ` (${capture.screenshotRoute})` : ''}`,
      )
    }
    for (const gap of describeGaps(gaps)) console.log(`      ${gap}`)
    if (options.comment && card.source === 'kanban') {
      const files = [
        join(evidence, 'report.json'),
        join(evidence, 'card.json'),
        ...captures.map((page) => page.screenshot).filter(Boolean),
        ...captures.map((page) => join(evidence, `${page.label}.values.json`)).filter((path) => existsSync(path)),
      ]
      commentOnCard(card.id, evidenceBody({ card, branch, commit, dirty, evidence, document, captures, checks, gaps, receipt }), files)
    }
    process.exit(0)
  }

  const message = [
    `G3 agentic e2e failed on ${card.id} ("${card.title}")${options.label ? ` [${options.label}]` : ''}: ${failed.length} of ${checks.length} checks.`,
    '',
    ...failed.map((check) => `- ${check.name}: ${check.detail}`),
    ...(gaps.length > 0 ? ['', 'evidence gaps (recorded, not the reason for this failure):', ...describeGaps(gaps).map((gap) => `- ${gap}`)] : []),
    '',
    `Prompt: "${card.prompt}"`,
    `Build: ${branch} @ ${commit.slice(0, 7)}${dirty ? ' (dirty worktree — not commit-bound)' : ''}; evidence: ${evidence}`,
    `Receipt: ${receipt}`,
  ].join('\n')
  console.error(`FAIL  ${card.id} — ${failed.length} of ${checks.length} checks\n${message}`)
  if (options.comment && card.source === 'kanban') {
    const files = [
      ...captures.map((page) => page.screenshot).filter(Boolean),
      agentLog,
      captureLog,
      join(evidence, 'report.json'),
    ]
    commentOnCard(card.id, message, files)
  }
  // The card's return to `ready` is not a comment: it is item 4 of the gate, so it does not ride
  // on the comment flag. `--no-comment` quiets the board, it does not leave a red card in review.
  if (options.returnCard && card.source === 'kanban') {
    const moved = returnCard(card.id, `G3 agentic e2e failed on ${commit.slice(0, 7)}: ${failed.map((check) => check.name).slice(0, 4).join(', ')} — evidence in ${evidence}`)
    console.error(`card    ${moved}`)
  }
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
