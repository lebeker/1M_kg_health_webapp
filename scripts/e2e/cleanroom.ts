/**
 * The clean room: a throwaway directory that holds the `kg` skill and the app under test,
 * and nothing else. No repo checkout, no fixtures, no memory, no conversation.
 *
 * Two things make it an honest test rather than a stage set:
 *
 *  - The app is installed by the skill's own command (`kg.py fetch-app --url …`) from a
 *    local mirror of the worktree build — the same artifact that ships, the same install
 *    path a user takes, just not yet public. Pages serves `main`; a card's work is on a
 *    branch, so the published URL would test the old product.
 *  - The agent gets one sentence and the skill. The only thing the harness shares with the
 *    machine is the model endpoint; the skill catalogue the agent reads says the app is
 *    installed, and where from, and nothing about what the answer should be.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'

import { basename, join } from 'node:path'

export type CleanRoom = {
  dir: string
  /** Empty directory the agent works in; its graph ends up in `storage/` here. */
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
  /** Directory to create the room in (the harness makes a subdirectory). */
  parent: string
  /** `dist/index.html` of the card's worktree — the artifact under test. */
  buildPath: string
  /** The worktree's `app.json`: what the app says it is. */
  manifestPath: string
  /** The `kg` skill checkout. */
  skillPath: string
  /** Commit the build came from, stamped into the mirror so evidence can name it. */
  commit: string
}

function copySkill(source: string, destination: string) {
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = basename(path)
      return name !== '.git' && name !== '__pycache__' && name !== 'node_modules'
    },
  })
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
async function installApp(room: string, appId: string, mirrorUrl: string): Promise<void> {
  // Asynchronous on purpose: the mirror lives in this process, so a synchronous child
  // would block the event loop the fetch is waiting on.
  const child = spawn(
    'python3',
    [
      join(room, 'kg', 'scripts', 'kg.py'),
      'fetch-app',
      appId,
      '--url',
      `${mirrorUrl}/${appId}.html`,
      '--manifest-url',
      `${mirrorUrl}/${appId}.app.json`,
    ],
    { cwd: room, stdio: ['ignore', 'pipe', 'pipe'] },
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

  const dir = join(options.parent, 'room')
  const work = join(dir, 'work')
  const home = join(dir, 'home')
  const skill = join(dir, 'kg')
  mkdirSync(work, { recursive: true })
  mkdirSync(join(home, 'skills'), { recursive: true })
  copySkill(options.skillPath, skill)
  copySkill(options.skillPath, join(home, 'skills', 'kg'))

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

    await installApp(dir, appId, mirror.url)

    const installed = join(skill, 'assets', `${appId}.html`)
    if (!existsSync(installed)) throw new Error(`fetch-app reported success but ${installed} is missing`)

    writeFileSync(join(home, 'config.yaml'), hermesConfig(work))

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
      },
    }
  } catch (error) {
    mirror.server.close()
    throw error
  }
}

/**
 * The clean room's model endpoint. This is the one shared thing: no memory, no skills, no
 * keys — the local endpoint the machine already serves. Override with E2E_MODEL /
 * E2E_PROVIDER / E2E_BASE_URL.
 */
function hermesConfig(work: string): string {
  const model = process.env.E2E_MODEL ?? 'deepseek-v4.1-flash:cloud'
  const provider = process.env.E2E_PROVIDER ?? 'ollama-launch'
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:11434/v1'
  return `model:
  default: ${model}
  provider: ${provider}
  base_url: ${baseUrl}
providers:
  ${provider}:
    api: ${baseUrl}
    default_model: ${model}
    models:
      - ${model}
    name: local
terminal:
  cwd: ${work}
approvals:
  single_query_mode: approve
`
}

/** The child's environment: everything board- or session-related is removed on purpose. */
function cleanEnv(home: string, work: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('HERMES_KANBAN')) continue
    if (key.startsWith('HERMES_SESSION')) continue
    if (key === 'HERMES_HOME' || key === 'HERMES_PROFILE' || key === 'HERMES_TASK_ID') continue
    // The agent's shell takes its start directory from these; inherited, it would start the
    // "clean room" inside the repo the harness is running from.
    if (key === 'PWD' || key === 'OLDPWD' || key === 'CDPATH') continue
    env[key] = value
  }
  env.HERMES_HOME = home
  // A clean room has its own home too: with the operator's home the agent could read another
  // profile's memory and skills, which is exactly the prior context this gate exists to exclude.
  env.HOME = home
  env.PWD = work
  return env
}

export function hermesBinary(): string {
  if (process.env.HERMES_BIN && existsSync(process.env.HERMES_BIN)) return process.env.HERMES_BIN
  try {
    return execFileSync('command', ['-v', 'hermes'], { encoding: 'utf8', shell: '/bin/sh' }).trim()
  } catch {
    throw new Error('no hermes binary found — set HERMES_BIN')
  }
}

export type AgentRun = { code: number; output: string; seconds: number; logPath: string }

/** One prompt, one fresh agent, no follow-up turns from the harness. */
export async function runAgent(
  room: CleanRoom,
  prompt: string,
  options: { logPath: string; timeoutMs?: number; maxTurns?: number },
): Promise<AgentRun> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  const started = Date.now()
  const args = ['chat', '-q', prompt, '--max-turns', String(options.maxTurns ?? 100), '--source', 'e2e']
  const child: ChildProcess = spawn(hermesBinary(), args, {
    cwd: room.work,
    env: cleanEnv(room.home, room.work),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const collect = (chunk: Buffer) => {
    output += chunk.toString()
    writeFileSync(options.logPath, output)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  const code = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      output += `\n[harness] killed after ${Math.round(timeoutMs / 1000)}s\n`
      resolve(124)
    }, timeoutMs)
    child.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolve(exitCode ?? 1)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(127)
    })
  })

  writeFileSync(options.logPath, output)
  // The child's own log is the full trace; the piped output is what a human reads.
  try {
    copyFileSync(join(room.home, 'logs', 'agent.log'), options.logPath.replace(/\.log$/, '-hermes.log'))
  } catch {
    // a run that never started leaves no log
  }
  return { code, output, seconds: Math.round((Date.now() - started) / 100) / 10, logPath: options.logPath }
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
  const storage = join(room.work, 'storage')
  if (existsSync(storage)) cpSync(storage, join(destination, 'storage'), { recursive: true })
  const assets = join(room.skill, 'assets')
  if (existsSync(assets)) {
    for (const name of readdirSync(assets)) {
      if (name.endsWith('.version') || name.endsWith('.app.json')) copyFileSync(join(assets, name), join(destination, name))
    }
  }
}
