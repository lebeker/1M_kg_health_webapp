/**
 * The clean room: a throwaway directory that holds the `kg` skill and the app under test,
 * and nothing else. No repo checkout, no fixtures, no memory, no conversation.
 *
 * Three things make it an honest test rather than a stage set:
 *
 *  - The app is installed by the skill's own command (`kg.py fetch-app --url …`) from a
 *    local mirror of the worktree build — the same artifact that ships, the same install
 *    path a user takes, just not yet public. Pages serves `main`; a card's work is on a
 *    branch, so the published URL would test the old product.
 *  - The agent gets one sentence and the skill. The only thing the harness shares with the
 *    machine is the model endpoint; the skill catalogue the agent reads says the app is
 *    installed, and where from, and nothing about what the answer should be.
 *  - It is built in the system temp directory, not next to the evidence: a room inside the
 *    repo (or inside `~/.hermes`) can be escaped by walking up one directory, and an agent
 *    that reads the harness's own capture code is no longer a clean room.
 *
 * The app's own contract checker comes along (`check/validate.ts`), because the skill's
 * `validate` only knows the base kg/1 shape and this app is stricter: without the checker in
 * the room the agent cannot see the rules its document is judged by, and the gate would be
 * measuring the harness's hindsight rather than the product. Same file, both sides of the gate.
 *
 * The room's `AGENTS.md` states the working rules: stay inside the room, and no desktop
 * applications — a browser this agent started would not be the managed one, and pictures
 * are taken by the capture session outside, with the `browser_*` tools.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { endpointConfig, runChat, writeHermesHome, type ToolCall } from './hermes'

export type CleanRoom = {
  dir: string
  /** Directory the agent works in; its graph ends up in `storage/` here. */
  work: string
  /** A private HERMES_HOME: one skill, one config, no memory. */
  home: string
  skill: string
  appId: string
  appTitle: string
  mirrorUrl: string
  close(): Promise<void>
}

export type PrepareOptions = {
  /** `dist/graph.html` of the card's worktree — the artifact under test. */
  buildPath: string
  /** The worktree's `app.json`: what the app says it is. */
  manifestPath: string
  /** The worktree itself, so the room can be given the app's own contract checker. */
  worktree: string
  /** The `kg` skill checkout. */
  skillPath: string
  /** Commit the build came from, stamped into the mirror so evidence can name it. */
  commit: string
}

/** The working rules the room starts with. Infrastructure, not part of the user's question. */
export const ROOM_RULES = `# Working rules for this workspace

This directory — the one you start in — is a user's own machine as far as this task is
concerned: one skill, one installed app, and the empty space to write in. Everything this task
needs is inside it.

## Where things live

- The skill is \`./kg\`. \`kg/scripts/kg.py\` is the engine; the app it can render is already
  installed in \`kg/assets/\`.
- The app ships its own contract checker at \`./check/validate.ts\`. \`bun check/validate.ts
  <graph.json>\` prints every rule this app needs a document to keep, and exits 0 only when it
  keeps all of them. \`kg.py validate\` checks the base kg/1 shape; this app is stricter, and
  its checker lists the difference. It is the same checker the harness runs afterwards.
- Anything written for this task belongs under \`./storage/\`.

## What is out of bounds

- Stay inside this directory. Never search or read outside it: no \`find /\`, no \`ls /\`, no
  \`/Volumes\`, \`/System\`, \`/Applications\` or \`/Users\`, no \`mdfind\`, no \`diskutil\`. A search
  from the root walks every mounted volume and makes macOS ask the machine's owner for
  permission, which is a thing this run must not do to somebody's laptop. Locate a file by the
  path named here, or with a relative grep inside this directory — every file you need is
  named above.
- Desktop applications are out of bounds, browsers included: no browser binary, no \`open\`,
  no AppleScript. Rendering is done with the skill. Pages are photographed after this run,
  by the harness, with Hermes's own browser tools — this session has none.

## The task

The user's question is the single message you were given. Answer it by building the record
with the skill, keeping the app's contract, and rendering it; run the app's checker over the
document before you finish. Then say what you did and where the page is.
`

/**
 * Where the app's contract checker lives in the room, relative to the directory the agent works
 * in. Both the install and the `--keep-room` copy go through this one function: the first
 * version had each side spell the path out, they disagreed by one directory, and `--keep-room`
 * kept nothing while the README said it kept the checker.
 */
export function checkerDir(work: string): string {
  return join(work, 'check')
}

/**
 * The app's own contract checker, in the room.
 *
 * The skill's `validate` knows the base kg/1 shape; this app adds rules of its own (a profile,
 * a source behind every fact, a date on every event) that only the app's checker states. A
 * fresh agent that is never handed that checker produces a document the skill calls conformant
 * and the app refuses — one smoke run did exactly that, 15 issues deep, and no amount of
 * harness strictness would have let the agent see it. So the room gets the files the app's own
 * CI runs, verbatim, and the harness runs the same file afterwards: one checker on both sides
 * of the gate. It carries the shape of a document, never its content.
 *
 * The schema comes along because the checker reads it at run time (`../schema/…` from `lib/`),
 * and so does the small JSON Schema evaluator beside it: the room has no `node_modules`, and
 * `bun` is the whole runtime.
 */
function installChecker(worktree: string, work: string) {
  const files: Array<[string, string]> = [
    ['scripts/validate-kg-fixtures.ts', 'check/validate.ts'],
    ['scripts/lib/kg-contract.ts', 'check/lib/kg-contract.ts'],
    ['scripts/lib/json-schema.ts', 'check/lib/json-schema.ts'],
    ['scripts/schema/kg-1-health.schema.json', 'check/schema/kg-1-health.schema.json'],
  ]
  for (const [from, to] of files) {
    const source = join(worktree, from)
    if (!existsSync(source)) throw new Error(`${source} is missing — the room cannot be given the app's checker`)
    const destination = join(checkerDir(work), to.replace(/^check\//, ''))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
  }
}

function copySkill(source: string, destination: string, keepApp: string) {
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = basename(path)
      return name !== '.git' && name !== '__pycache__' && name !== 'node_modules'
    },
  })
  // The skill ships a template of its own (the research viewer). The room is a user who has
  // *this* app installed: leaving another template in `assets/` would let the agent render with
  // the skill's bundled page instead of the build under test — and the screenshot would then be
  // of the old product, which is the one thing this gate exists to prevent.
  const assets = join(destination, 'assets')
  if (!existsSync(assets)) return
  for (const name of readdirSync(assets)) {
    const stem = name.replace(/\.(html|app\.json|version|md)$/, '')
    if (stem === keepApp || name === 'README.md') continue
    if (!/\.(html|app\.json|version)$/.test(name)) continue
    rmSync(join(assets, name), { force: true })
  }
}

async function startMirror(buildPath: string, manifestPath: string, appId: string): Promise<{ url: string; server: Server }> {
  const html = readFileSync(buildPath)
  const manifest = readFileSync(manifestPath)
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (path === `/${appId}.html` || path === '/app.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length })
      res.end(html)
      return
    }
    if (path === `/${appId}.app.json` || path === '/app.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': manifest.length })
      res.end(manifest)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not here\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('the local mirror did not get a port')
  return { url: `http://127.0.0.1:${address.port}`, server }
}

/** Put the worktree's app into the skill's catalogue, the way a shipped entry looks. */
function catalogueEntry(manifest: Record<string, unknown>, appId: string, mirrorUrl: string, commit: string) {
  return {
    id: appId,
    title: manifest.title ?? appId,
    purpose: manifest.purpose ?? '',
    keywords: manifest.keywords ?? [],
    url: `${mirrorUrl}/${appId}.html`,
    manifest_url: `${mirrorUrl}/${appId}.app.json`,
    build: { commit, source: 'card worktree, local mirror' },
  }
}

/** Install through the skill's own command, not by copying files behind its back. */
async function installApp(skill: string, work: string, appId: string, mirrorUrl: string): Promise<void> {
  // Asynchronous on purpose: the mirror lives in this process, so a synchronous child
  // would block the event loop the fetch is waiting on.
  const child = spawn(
    'python3',
    [
      join(skill, 'scripts', 'kg.py'),
      'fetch-app',
      appId,
      '--url',
      `${mirrorUrl}/${appId}.html`,
      '--manifest-url',
      `${mirrorUrl}/${appId}.app.json`,
    ],
    { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  const code = await new Promise<number>((resolve) => child.on('exit', (exit) => resolve(exit ?? 1)))
  if (code !== 0) throw new Error(`kg.py fetch-app ${appId} exited ${code}:\n${output}`)
}

export async function prepareCleanRoom(options: PrepareOptions): Promise<CleanRoom> {
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8')) as Record<string, unknown>
  const appId = String(manifest.id ?? '')
  if (!appId) throw new Error(`${options.manifestPath} has no id — the harness cannot name the app`)

  const dir = mkdtempSync(join(tmpdir(), 'kg-e2e-room-'))
  const work = join(dir, 'work')
  const home = join(dir, 'home')
  // The skill and the app's checker live *inside* the directory the agent is told to stay in, so
  // that nothing it needs is one `..` away: the first version put them beside it, and a fresh
  // agent went looking with `find /`, which walks /Volumes and makes macOS ask the owner for
  // permission. A rule the agent has no reason to break is worth more than one it must remember.
  const skill = join(work, 'kg')
  mkdirSync(work, { recursive: true })
  mkdirSync(join(home, 'skills'), { recursive: true })
  copySkill(options.skillPath, skill, appId)
  copySkill(options.skillPath, join(home, 'skills', 'kg'), appId)
  installChecker(options.worktree, work)
  writeFileSync(join(work, 'AGENTS.md'), ROOM_RULES)

  const mirror = await startMirror(options.buildPath, options.manifestPath, appId)
  try {
    // The catalogue entry is what makes the app discoverable before anything is installed —
    // exactly what T03 will do to the real skill, pointed at the branch build instead of Pages.
    const appsPath = join(skill, 'scripts', 'apps.json')
    const catalogue = existsSync(appsPath)
      ? (JSON.parse(readFileSync(appsPath, 'utf8')) as { apps?: Array<Record<string, unknown>> })
      : { apps: [] }
    const apps = catalogue.apps ?? []
    const entry = catalogueEntry(manifest, appId, mirror.url, options.commit)
    const existing = apps.findIndex((app) => app.id === appId)
    if (existing >= 0) apps[existing] = { ...apps[existing], ...entry }
    else apps.push(entry)
    writeFileSync(appsPath, `${JSON.stringify({ ...catalogue, apps }, null, 2)}\n`)

    await installApp(skill, work, appId, mirror.url)

    const installed = join(skill, 'assets', `${appId}.html`)
    if (!existsSync(installed)) throw new Error(`fetch-app reported success but ${installed} is missing`)

    writeHermesHome(home, endpointConfig(work))

    return {
      dir,
      work,
      home,
      skill,
      appId,
      appTitle: String(manifest.title ?? appId),
      mirrorUrl: mirror.url,
      close: async () => {
        await new Promise<void>((resolve) => mirror.server.close(() => resolve()))
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // the OS will clean up a temp dir
        }
      },
    }
  } catch (error) {
    mirror.server.close()
    throw error
  }
}

export type AgentRun = {
  code: number
  seconds: number
  logPath: string
  calls: ToolCall[]
  resultText: string
  timedOut: boolean
}

/**
 * One prompt, one fresh agent, no follow-up turns from the harness. The agent gets `terminal`
 * and `file` and nothing else: it builds a record with the skill. Looking at the result is the
 * capture session's job, so a browser this agent starts is not a tool call to make — it is a
 * policy violation the harness looks for afterwards.
 */
export async function runAgent(
  room: CleanRoom,
  prompt: string,
  options: { logPath: string; timeoutMs?: number; maxTurns?: number },
): Promise<AgentRun> {
  const run = await runChat({
    home: room.home,
    work: room.work,
    prompt,
    toolsets: ['terminal', 'file'],
    maxTurns: options.maxTurns ?? 200,
    timeoutMs: options.timeoutMs ?? 15 * 60_000,
    logPath: options.logPath,
    source: 'e2e',
  })
  return {
    code: run.code,
    seconds: run.seconds,
    logPath: run.logPath,
    calls: run.calls,
    resultText: run.resultText,
    timedOut: run.timedOut,
  }
}

export type RoomArtifacts = { graphPath: string; pagePath: string | null }

/** What the agent left behind: the document, and the page it rendered from it, if it rendered. */
export function findArtifacts(room: CleanRoom): RoomArtifacts | null {
  const storage = join(room.work, 'storage')
  if (!existsSync(storage)) return null
  const graphs = readdirSync(storage)
    .map((name) => join(storage, name, 'graph.json'))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  const newest = graphs[0]
  if (!newest) return null
  const dir = join(newest.path, '..')
  const pages = readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => join(dir, name))
  const page = pages.includes(join(dir, 'index.html')) ? join(dir, 'index.html') : (pages[0] ?? null)
  return { graphPath: newest.path, pagePath: page }
}

/** Copy the room's leftovers into the evidence directory before the room is thrown away. */
export function keepRoomCopy(room: CleanRoom, destination: string) {
  mkdirSync(destination, { recursive: true })
  const check = checkerDir(room.work)
  if (existsSync(check)) cpSync(check, join(destination, 'check'), { recursive: true })
  const storage = join(room.work, 'storage')
  if (existsSync(storage)) cpSync(storage, join(destination, 'storage'), { recursive: true })
  const assets = join(room.skill, 'assets')
  if (existsSync(assets)) {
    for (const name of readdirSync(assets)) {
      if (name.endsWith('.version') || name.endsWith('.app.json')) copyFileSync(join(assets, name), join(destination, name))
    }
  }
}
