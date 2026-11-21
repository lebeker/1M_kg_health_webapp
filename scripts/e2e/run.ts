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
 *     visible text, a sha256 over the live DOM, and a screenshot;
 *  5. replays that same `kg.json` inside the branch build, captures it the same way, and runs
 *     the acceptance scripts (`bun run verify`, the kg/1 contract over the agent's document);
 *  6. writes `report.json` next to the screenshots; on failure comments on the card with the
 *     screenshots and both transcripts attached, and exits 1.
 *
 * The card's claim is the only thing that decides pass or fail. "It rendered" is not a claim.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { capturePages, describeValues, type PageCapture } from './capture'
import { type Card, missingPromptHelp, readCard } from './card'
import { findArtifacts, keepRoomCopy, prepareCleanRoom, runAgent } from './cleanroom'
import type { ToolCall } from './hermes'
import { inject } from './inject'
import { worktreeState } from './git-state'
import { captureScopeViolations, hostAppCalls, outsideRoomCalls } from './policy'

type Check = { name: string; ok: boolean; detail: string; hard?: boolean }

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
  --skip-build         reuse dist/index.html from an earlier build
  --skip-verify        do not run \`bun run verify\`
  --no-comment         never comment on the card, even on failure
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
  ready?: boolean
  title?: string
  header?: string
  text?: string
  claim?: Array<{ needle: string; found: boolean }>
  mounted?: number
  empty?: string | null
  domBytes?: number
  domSha256?: string
  domHead?: string
  capturedAt?: string
}

function pageChecks(stage: string, capture: PageCapture, document: KgDocument): Check[] {
  const values = capture.values as PageValues
  const nodes = document.nodes?.length ?? 0
  const edges = document.edges?.length ?? 0
  const docTitle = String(document.meta?.title ?? '')
  const header = String(values.header ?? '')
  const mounted = Number(values.mounted ?? 0)
  const claim = Array.isArray(values.claim) ? values.claim : []
  const checks: Check[] = [
    {
      name: `${stage}.browser`,
      ok: capture.problems.length === 0,
      detail: capture.problems.length === 0 ? 'browser_navigate + browser_console + browser_vision, all clean' : capture.problems.join(' / '),
    },
    {
      name: `${stage}.url`,
      ok: String(values.url ?? '') === capture.url,
      detail: `the browser reported ${values.url ? String(values.url) : 'no url'}, expected ${capture.url}`,
    },
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
      ok: header.includes(`${nodes} nodes`) && header.includes(`${edges} edges`),
      detail: `header "${header}" for ${nodes} nodes / ${edges} edges`,
    },
    {
      name: `${stage}.dom`,
      ok: Number(values.domBytes ?? 0) > 10_000 && String(values.domSha256 ?? '').length === 64,
      detail: `${Number(values.domBytes ?? 0)} bytes of DOM, sha256 ${String(values.domSha256 ?? '').slice(0, 12)}`,
    },
    {
      name: `${stage}.screenshot`,
      ok: capture.screenshotBytes > 15_000,
      detail: `${capture.screenshotBytes} bytes of PNG at ${capture.screenshot || '(none)'}`,
    },
  ]
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
    const flag = check.ok ? 'ok  ' : check.hard === false ? 'note' : 'FAIL'
    console.log(`  ${flag} ${check.name} — ${check.detail}`)
  }
}

function commentOnCard(taskId: string, body: string, files: string[]) {
  const binary = process.env.HERMES_BIN ?? 'hermes'
  const env = { ...process.env }
  delete env.HERMES_KANBAN_TASK
  const comment = spawnSync(binary, ['kanban', 'comment', taskId, body], { encoding: 'utf8', env })
  if (comment.status !== 0) console.error(`could not comment on ${taskId}: ${comment.stderr || comment.stdout}`)
  for (const path of files) {
    if (!existsSync(path)) continue
    const attach = spawnSync(binary, ['kanban', 'attach', taskId, path, '--name', basename(path)], { encoding: 'utf8', env })
    if (attach.status !== 0) console.error(`could not attach ${path}: ${attach.stderr || attach.stdout}`)
  }
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
  const buildPath = join(worktree, 'dist', 'index.html')
  if (!existsSync(buildPath)) throw new Error(`${buildPath} is missing — run without --skip-build`)
  const buildBytes = readFileSync(buildPath)

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
    prompt: card.prompt,
    prompt_source: options.promptOverride ? 'override' : 'card',
    expect: card.expect,
    branch,
    commit,
    dirty,
    dirty_files: dirtyFiles,
    build: { path: join(evidence, 'build.html'), sha256: sha256(buildBytes), bytes: buildBytes.length },
    started_at: new Date().toISOString(),
  }, null, 2)}\n`)

  console.log(`card    ${card.id} — ${card.title}`)
  console.log(`prompt  "${card.prompt}"  (${options.promptOverride ? 'override' : 'from the card'}, mode ${card.mode})`)
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
      if (card.mode === 'full') writeFileSync(replayPage, inject(buildBytes.toString('utf8'), document))

      const pages = [{ label: 'cleanroom', url: `file://${cleanroomPage}`, expect: card.expect }]
      if (card.mode === 'full') pages.push({ label: 'replay', url: `file://${replayPage}`, expect: card.expect })

      const capture = await capturePages({ pages, outDir: evidence })
      allCalls.push(...capture.calls)
      captureCalls.push(...capture.calls)
      captureLog = capture.logPath
      captures = capture.pages
      writeFileSync(join(evidence, 'capture.tools.json'), `${JSON.stringify(capture.tools, null, 2)}\n`)
      console.log(`capture exit ${capture.code} in ${capture.seconds}s, ${capture.tools.length} tool calls: ${capture.tools.join(' | ') || '(none)'}`)
      checks.push({
        name: 'capture.session',
        ok: capture.code === 0 && capture.sessionProblems.length === 0 && capture.tools.length > 0,
        detail:
          capture.sessionProblems.length > 0
            ? `${capture.sessionProblems.join(' / ')} — see ${capture.logPath}`
            : `exit ${capture.code} after ${capture.seconds}s; ${capture.tools.length} browser_* calls`,
      })

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

  const failed = checks.filter((check) => !check.ok)
  const report = {
    card: { id: card.id, title: card.title, mode: card.mode, prompt: card.prompt, expect: card.expect },
    branch,
    commit,
    dirty,
    dirty_files: dirtyFiles,
    evidence,
    browser: { route: 'hermes browser_* tools in a capture session', tools: captures.length > 0 },
    artifacts: {
      kg_json: join(evidence, 'kg.json'),
      values: captures.map((page) => join(evidence, `${page.label}.values.json`)),
      screenshots: captures.map((page) => page.screenshot).filter(Boolean),
      agent_log: agentLog,
      capture_log: captureLog,
    },
    checks,
    passed: failed.length === 0,
    finished_at: new Date().toISOString(),
  }
  writeFileSync(join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  console.log()
  printChecks(checks)
  console.log()
  if (failed.length === 0) {
    console.log(`PASS  ${card.id} — ${checks.length} checks, evidence in ${evidence}`)
    for (const capture of captures) console.log(`      ${capture.label}: ${describeValues(capture.values)} — ${capture.screenshot}`)
    process.exit(0)
  }

  const message = [
    `G3 agentic e2e failed on ${card.id} ("${card.title}")${options.label ? ` [${options.label}]` : ''}: ${failed.length} of ${checks.length} checks.`,
    '',
    ...failed.map((check) => `- ${check.name}: ${check.detail}`),
    '',
    `Prompt: "${card.prompt}"`,
    `Build: ${branch} @ ${commit.slice(0, 7)}${dirty ? ' (dirty worktree — not commit-bound)' : ''}; evidence: ${evidence}`,
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
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
