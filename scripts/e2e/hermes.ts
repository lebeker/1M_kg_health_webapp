/**
 * The one place G3 talks to Hermes: how a child session is configured, how it is started, and
 * how its `--format stream-json` record stream is read back.
 *
 * Two children use it, and both get the same treatment: a private `HERMES_HOME` with a single
 * config file and no memory, a stripped environment, and a pin on what they may do. The
 * clean-room agent gets `terminal` only; the capture session gets `browser` only. Nothing here
 * starts a browser or a desktop app itself — a child that needs to look at a page does it with
 * the `browser_*` tools, in the managed browser Hermes runs for that session.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function hermesBinary(): string {
  if (process.env.HERMES_BIN && existsSync(process.env.HERMES_BIN)) return process.env.HERMES_BIN
  try {
    return execFileSync('command', ['-v', 'hermes'], { encoding: 'utf8', shell: '/bin/sh' }).trim()
  } catch {
    throw new Error('no hermes binary found — set HERMES_BIN')
  }
}

/**
 * The Chromium Hermes installed for its own browser toolset. A child with a private
 * `HERMES_HOME` would otherwise look for it under that empty home and try to download one
 * mid-run; pointing at the copy the machine already has keeps the run offline and keeps the
 * capture on Hermes's own managed browser.
 */
export function packagedChromium(): string | null {
  const override = process.env.E2E_CHROMIUM
  if (override && existsSync(override)) return override
  const roots = [
    join(homedir(), '.hermes', 'tools'),
    join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'tools'),
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue
      const candidates = [
        join(root, entry, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        join(root, entry, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        join(root, entry, 'chrome-linux64', 'chrome'),
        join(root, entry, 'chrome-linux', 'chrome'),
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

export type ToolCall = {
  name: string
  input: Record<string, unknown>
  output: string
  isError: boolean
}

export type StreamEvents = { calls: ToolCall[]; resultText: string; resultExit: number | null }

/**
 * Read `--format stream-json` output: one JSON object per line, `tool_use` then `tool_result`,
 * closed by a `result` envelope. Tool results are paired by `tool_call_id` when the protocol
 * carries one and by name otherwise.
 */
export function parseStream(jsonl: string): StreamEvents {
  const calls: ToolCall[] = []
  const byId = new Map<string, ToolCall>()
  const events: StreamEvents = { calls, resultText: '', resultExit: null }
  for (const line of jsonl.split('\n')) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const type = String(event.type ?? '')
    if (type === 'tool_use') {
      const input = (event.input ?? {}) as Record<string, unknown>
      const call: ToolCall = { name: String(event.name ?? 'unknown'), input, output: '', isError: false }
      calls.push(call)
      if (typeof event.tool_call_id === 'string') byId.set(event.tool_call_id, call)
    } else if (type === 'tool_result') {
      const id = typeof event.tool_call_id === 'string' ? event.tool_call_id : null
      const name = String(event.name ?? '')
      const target = id ? byId.get(id) : calls.find((call) => call.name === name && call.output === '')
      if (!target) continue
      target.output = String(event.output ?? '')
      target.isError = Boolean(event.is_error)
    } else if (type === 'result') {
      events.resultText = String(event.text ?? '')
      if (typeof event.exit_code === 'number') events.resultExit = event.exit_code
    }
  }
  return events
}

export function cleanEnv(home: string, work: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
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
  // The child gets its own home too: with the operator's home it could read another profile's
  // memory and skills, which is exactly the prior context this gate exists to exclude.
  env.HOME = home
  env.PWD = work
  return { ...env, ...extra }
}

/**
 * The child's model endpoint. This is the one shared thing: no memory, no skills, no keys —
 * the local endpoint the machine already serves. Override with E2E_MODEL / E2E_PROVIDER /
 * E2E_BASE_URL.
 */
export function endpointConfig(work: string, extra: string[] = []): string {
  const model = process.env.E2E_MODEL ?? 'deepseek-v4.1-flash:cloud'
  const provider = process.env.E2E_PROVIDER ?? 'ollama-launch'
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:11434/v1'
  const chromium = packagedChromium()
  return [
    'model:',
    `  default: ${model}`,
    `  provider: ${provider}`,
    `  base_url: ${baseUrl}`,
    'providers:',
    `  ${provider}:`,
    `    api: ${baseUrl}`,
    `    default_model: ${model}`,
    '    models:',
    `      - ${model}`,
    '    name: local',
    'terminal:',
    `  cwd: ${work}`,
    'browser:',
    '  headed: false',
    '  use_real_profile: false',
    '  inactivity_timeout: 120',
    '  extension_control:',
    '    enabled: false',
    ...(chromium ? [`  executable_path: "${chromium}"`] : []),
    'approvals:',
    '  single_query_mode: approve',
    ...extra,
    '',
  ].join('\n')
}

export function writeHermesHome(home: string, config: string): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), config)
}

/**
 * The environment a capture session needs to be *offered* the browser toolset: Hermes resolves
 * both its `agent-browser` CLI and its Chromium through the operator home (`~/.hermes/tools`),
 * and this child has a private one. `extraBinDirs` is where the caller puts an `agent-browser`
 * entry point — Hermes looks that name up on `PATH`. Nothing here starts a browser: Hermes does,
 * headless, for the session.
 */
export function browserEnv(extraBinDirs: string[] = []): Record<string, string> {
  const env: Record<string, string> = {}
  const chromium = packagedChromium()
  if (chromium) env.AGENT_BROWSER_EXECUTABLE_PATH = chromium
  const path = (process.env.PATH ?? '').split(':').filter(Boolean)
  const dirs = [...extraBinDirs.filter(Boolean), ...path]
  env.PATH = dirs.join(':')
  return env
}

export function packagedAgentBrowser(): string | null {
  const override = process.env.E2E_AGENT_BROWSER
  if (override && existsSync(override)) return override
  const root = join(homedir(), '.hermes', 'tools')
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('agent-browser')) continue
    const dir = join(root, entry, 'bin')
    if (!existsSync(dir)) continue
    // The package manager names the native binary after the platform; Hermes itself looks the
    // CLI up as plain `agent-browser` on PATH.
    const binary = readdirSync(dir).find((name) => name.startsWith('agent-browser') && !name.endsWith('.js'))
    if (binary) return join(dir, binary)
  }
  return null
}

export type ChatOptions = {
  home: string
  work: string
  prompt: string
  /** Toolsets to pin, e.g. `['terminal']`. Omitted = the child's default surface. */
  toolsets?: string[]
  /** Extra environment for the child (a browser binary path, say). */
  env?: Record<string, string>
  maxTurns?: number
  timeoutMs?: number
  logPath: string
  source: string
}

export type ChatRun = StreamEvents & {
  code: number
  seconds: number
  timedOut: boolean
  logPath: string
}

/** One prompt, one fresh Hermes session, no follow-up turns from the harness. */
export async function runChat(options: ChatOptions): Promise<ChatRun> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  const started = Date.now()
  const args = [
    'chat',
    '--format',
    'stream-json',
    '--max-turns',
    String(options.maxTurns ?? 120),
    '--source',
    options.source,
  ]
  if (options.toolsets?.length) args.push('--toolsets', options.toolsets.join(','))
  args.push('-q', options.prompt)

  const child: ChildProcess = spawn(hermesBinary(), args, {
    cwd: options.work,
    env: cleanEnv(options.home, options.work, options.env ?? {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  const append = (target: 'out' | 'err', chunk: Buffer) => {
    if (target === 'out') stdout += chunk.toString()
    else stderr += chunk.toString()
    writeFileSync(options.logPath, stdout + stderr)
  }
  child.stdout?.on('data', (chunk: Buffer) => append('out', chunk))
  child.stderr?.on('data', (chunk: Buffer) => append('err', chunk))

  let timedOut = false
  const code = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
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

  writeFileSync(options.logPath, stdout)
  writeFileSync(options.logPath.replace(/\.jsonl$/, '.stderr.log'), stderr)
  try {
    const agentLog = join(options.home, 'logs', 'agent.log')
    if (existsSync(agentLog)) copyFileSync(agentLog, options.logPath.replace(/\.jsonl$/, '-hermes.log'))
  } catch {
    // a run that never started leaves no log
  }

  const events = parseStream(stdout)
  return { ...events, code, seconds: Math.round((Date.now() - started) / 100) / 10, timedOut, logPath: options.logPath }
}
