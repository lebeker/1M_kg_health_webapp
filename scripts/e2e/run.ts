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
 *  4. takes what the agent produced (`kg.json`), screenshots the page it rendered, and reads
 *     the DOM back: title, node/edge counts, the card's expected text;
 *  5. replays that same `kg.json` inside the branch build, screenshots it again, and runs the
 *     acceptance scripts (`bun run verify`, the kg/1 contract over the agent's document);
 *  6. writes `report.json` next to the screenshots; on failure comments on the card with the
 *     screenshot attached and exits 1.
 *
 * The card's claim is the only thing that decides pass or fail. "It rendered" is not a claim.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { capture, type Capture } from './browser'
import { type Card, missingPromptHelp, readCard } from './card'
import { findArtifacts, keepRoomCopy, prepareCleanRoom, runAgent } from './cleanroom'

type Check = { name: string; ok: boolean; detail: string; hard?: boolean }

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
  // Outside the repo on purpose: the clean room must not have a checkout two directories up,
  // so a curious agent that runs `ls ..` finds evidence, not the product source.
  options.out = options.out || join(homedir(), '.hermes', 'e2e')
  return options
}

function printHelp() {
  console.log(`usage: bun run e2e --card <task-id | card.md> [options]

  --worktree <dir>     the card's worktree (default: cwd)
  --out <dir>          where evidence goes (default: <worktree>/.e2e)
  --kg-skill <dir>     the kg skill checkout (default: $KG_SKILL, ../1M_kg_skill)
  --prompt <text>      override the card's prompt (recorded as an override, for debugging)
  --label <text>       prefix for the run directory, e.g. "smoke"
  --timeout <seconds>  how long the fresh agent may take (default: 900)
  --skip-build         reuse dist/index.html from an earlier build
  --skip-verify        do not run \`bun run verify\`
  --no-comment         never comment on the card, even on failure
  --keep-room          keep the clean room on disk for inspection`)
}

function sha256(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function git(worktree: string, args: string[]): string {
  return execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim()
}

function run(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** Replace the `#kg-graph` payload and the page title, the same two things the skill's render does. */
function inject(build: string, document: { meta?: { title?: string } }): string {
  const payload = JSON.stringify(document).replace(/<\/script/gi, '<\\/script>')
  let injected = build.replace(
    /(<script id="kg-graph" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_match, open: string, close: string) => `${open}${payload}${close}`,
  )
  if (injected === build) throw new Error('the build has no #kg-graph element to put the document in')
  const title = String(document.meta?.title ?? '').trim()
  if (title) {
    const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    injected = injected.replace(/<title>.*?<\/title>/s, `<title>${escaped}</title>`)
  }
  return injected
}

const PROBE = `(() => {
  const header = document.querySelector('header.bar')
  const empty = document.querySelector('[data-empty]')
  return {
    title: document.title,
    header: header ? header.innerText.replace(/\\n+/g, ' | ') : '',
    text: document.body.innerText || '',
    mounted: document.querySelectorAll('#root *').length,
    empty: empty ? empty.getAttribute('data-empty') : null,
  }
})()`

const READY = `(() => document.querySelectorAll('#root *').length > 5 && !document.querySelector('[data-loading="first-frame"]'))()`

type PageFacts = { title: string; header: string; text: string; mounted: number; empty: string | null }

function factsOf(shot: Capture): PageFacts {
  const values = shot.values as Partial<PageFacts>
  return {
    title: String(values.title ?? ''),
    header: String(values.header ?? ''),
    text: String(values.text ?? ''),
    mounted: Number(values.mounted ?? 0),
    empty: values.empty === null || values.empty === undefined ? null : String(values.empty),
  }
}

function pageChecks(stage: string, shot: Capture, facts: PageFacts, document: { meta?: { title?: string }; nodes?: unknown[]; edges?: unknown[] }, expect: string[]): Check[] {
  const nodes = document.nodes?.length ?? 0
  const edges = document.edges?.length ?? 0
  const docTitle = String(document.meta?.title ?? '')
  const text = facts.text.toLowerCase()
  const checks: Check[] = [
    { name: `${stage}.page-ready`, ok: shot.ready, detail: shot.ready ? `${facts.mounted} elements under #root` : 'the page never finished its first render' },
    { name: `${stage}.no-errors`, ok: shot.errors.length === 0, detail: shot.errors.length === 0 ? 'no uncaught exception, no console error' : shot.errors.join(' / ') },
    { name: `${stage}.not-empty`, ok: facts.empty === null, detail: facts.empty === null ? 'the viewer drew a graph' : `the viewer says: no ${facts.empty} yet` },
    { name: `${stage}.title`, ok: docTitle.length > 0 && facts.title === docTitle, detail: `page title "${facts.title}", document title "${docTitle}"` },
    { name: `${stage}.counts`, ok: facts.header.includes(`${nodes} nodes`) && facts.header.includes(`${edges} edges`), detail: `header "${facts.header}" for ${nodes} nodes / ${edges} edges` },
    { name: `${stage}.screenshot`, ok: shot.screenshot.length > 15_000, detail: `${shot.screenshot.length} bytes of PNG` },
  ]
  for (const needle of expect) {
    checks.push({
      name: `${stage}.claim`,
      ok: text.includes(needle.toLowerCase()),
      detail: needle,
    })
  }
  return checks
}

function printChecks(checks: Check[]) {
  for (const check of checks) {
    const flag = check.ok ? 'ok  ' : check.hard === false ? 'note' : 'FAIL'
    console.log(`  ${flag} ${check.name} — ${check.detail}`)
  }
}

function commentOnCard(taskId: string, body: string, screenshot: string, logPath: string) {
  const binary = process.env.HERMES_BIN ?? 'hermes'
  const env = { ...process.env }
  delete env.HERMES_KANBAN_TASK
  const comment = spawnSync(binary, ['kanban', 'comment', taskId, body], { encoding: 'utf8', env })
  if (comment.status !== 0) console.error(`could not comment on ${taskId}: ${comment.stderr || comment.stdout}`)
  for (const [path, name] of [[screenshot, 'g3-failure.png'], [logPath, 'g3-agent.log']] as const) {
    if (!existsSync(path)) continue
    const attach = spawnSync(binary, ['kanban', 'attach', taskId, path, '--name', name], { encoding: 'utf8', env })
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
  const commit = git(worktree, ['rev-parse', 'HEAD'])
  const dirty = git(worktree, ['status', 'porcelain']).length > 0
  const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])

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
    build: { path: join(evidence, 'build.html'), sha256: sha256(buildBytes), bytes: buildBytes.length },
    started_at: new Date().toISOString(),
  }, null, 2)}\n`)

  console.log(`card    ${card.id} — ${card.title}`)
  console.log(`prompt  "${card.prompt}"  (${options.promptOverride ? 'override' : 'from the card'}, mode ${card.mode})`)
  console.log(`evidence ${evidence}`)
  console.log()

  const checks: Check[] = []
  let cleanRoomShot: Capture | null = null
  let replayShot: Capture | null = null
  let document: { meta?: { title?: string }; nodes?: unknown[]; edges?: unknown[] } = {}

  const room = await prepareCleanRoom({
    parent: evidence,
    buildPath,
    manifestPath: join(worktree, 'app.json'),
    skillPath: options.kgSkill,
    commit,
  })
  console.log(`room    ${room.dir} — kg skill + ${room.appId} from ${room.mirrorUrl}`)

  try {
    const agent = await runAgent(room, card.prompt, { logPath: join(evidence, 'agent.log'), timeoutMs: options.timeoutMs })
    console.log(`agent   exit ${agent.code} in ${agent.seconds}s (${agent.logPath})`)
    checks.push({ name: 'agent.exit', ok: agent.code === 0, detail: `exit ${agent.code} after ${agent.seconds}s` })

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

      const pageUrl = found.pagePath ? `file://${found.pagePath}` : `file://${join(evidence, 'cleanroom-injected.html')}`
      if (!found.pagePath) writeFileSync(join(evidence, 'cleanroom-injected.html'), inject(buildBytes.toString('utf8'), document))
      cleanRoomShot = await capture(pageUrl, { readyExpression: READY, probeExpression: PROBE, timeoutMs: 30_000 })
      writeFileSync(join(evidence, 'cleanroom.png'), cleanRoomShot.screenshot)
      writeFileSync(join(evidence, 'cleanroom.dom.html'), cleanRoomShot.dom)
      checks.push(...pageChecks('cleanroom', cleanRoomShot, factsOf(cleanRoomShot), document, card.expect))

      if (card.mode === 'full') {
        const replayPath = join(evidence, 'replay.html')
        writeFileSync(replayPath, inject(buildBytes.toString('utf8'), document))
        replayShot = await capture(`file://${replayPath}`, { readyExpression: READY, probeExpression: PROBE, timeoutMs: 30_000 })
        writeFileSync(join(evidence, 'replay.png'), replayShot.screenshot)
        writeFileSync(join(evidence, 'replay.dom.html'), replayShot.dom)
        checks.push(...pageChecks('replay', replayShot, factsOf(replayShot), document, card.expect))

        if (!options.skipVerify) {
          const verify = run('bun', ['run', 'verify'], worktree)
          writeFileSync(join(evidence, 'verify.txt'), verify.output)
          checks.push({ name: 'g2.verify', ok: verify.ok, detail: verify.ok ? 'lint, types, unit, contract fixtures, branch name: green' : verify.output.trim().split('\n').slice(-3).join(' / ') })
        }
      }
      if (options.keepRoom) keepRoomCopy(room, join(evidence, 'room'))
    }
  } finally {
    await room.close()
  }

  const failed = checks.filter((check) => !check.ok)
  const report = {
    card: { id: card.id, title: card.title, mode: card.mode, prompt: card.prompt, expect: card.expect },
    branch,
    commit,
    dirty,
    evidence,
    artifacts: {
      kg_json: join(evidence, 'kg.json'),
      cleanroom: { screenshot: join(evidence, 'cleanroom.png'), dom: join(evidence, 'cleanroom.dom.html') },
      replay: replayShot ? { screenshot: join(evidence, 'replay.png'), dom: join(evidence, 'replay.dom.html') } : null,
      agent_log: join(evidence, 'agent.log'),
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
    process.exit(0)
  }

  const message = [
    `G3 agentic e2e failed on ${card.id} ("${card.title}")${options.label ? ` [${options.label}]` : ''}: ${failed.length} of ${checks.length} checks.`,
    '',
    ...failed.map((check) => `- ${check.name}: ${check.detail}`),
    '',
    `Prompt: "${card.prompt}"`,
    `Build: ${branch} @ ${commit.slice(0, 7)}; evidence: ${evidence}`,
  ].join('\n')
  console.error(`FAIL  ${card.id} — ${failed.length} of ${checks.length} checks\n${message}`)
  if (options.comment && card.source === 'kanban') {
    commentOnCard(card.id, message, join(evidence, 'cleanroom.png'), join(evidence, 'agent.log'))
  }
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
