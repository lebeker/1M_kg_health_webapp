/**
 * Headless Chrome, driven over the DevTools Protocol — no npm dependency.
 *
 * The G3 harness needs three things a plain `chrome --screenshot` cannot give in one process:
 * the DOM *after* React has rendered, the concrete values a reviewer can read, and the
 * console errors that tell "blank page" apart from "the page threw". So it launches Chrome
 * itself, attaches to one page target, and asks for those three by protocol.
 *
 * Chrome is found through $CHROME_PATH or the usual install locations. That single binary is
 * the harness's only browser requirement; there is nothing to `bun install`.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type ConsoleLine = { level: string; text: string }

export type Capture = {
  url: string
  /** `ready` is false when the page never satisfied the readiness expression in time. */
  ready: boolean
  /** Values returned by the probe expression, as JSON. */
  values: Record<string, unknown>
  /** Serialized DOM with inline <script> bodies elided, so the file stays readable. */
  dom: string
  console: ConsoleLine[]
  errors: string[]
  screenshot: Buffer
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
]

export function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate
  }
  throw new Error(
    'no Chrome/Chromium found — set CHROME_PATH to a headless-capable browser binary ' +
      '(checked: ' +
      CHROME_CANDIDATES.filter(Boolean).join(', ') +
      ')',
  )
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class Cdp {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, Pending>()
  readonly console: ConsoleLine[] = []
  readonly errors: string[] = []

  private constructor(ws: WebSocket) {
    this.ws = ws
    this.ws.addEventListener('message', (event) => this.onMessage(String((event as MessageEvent).data)))
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error(`could not open ${url}`)), { once: true })
    })
    return new Cdp(ws)
  }

  private onMessage(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)))
      else pending.resolve(msg.result)
      return
    }
    const method = String(msg.method ?? '')
    const params = (msg.params ?? {}) as Record<string, unknown>
    if (method === 'Runtime.consoleAPICalled') {
      const args = (params.args ?? []) as Array<Record<string, unknown>>
      const text = args
        .map((a) => (typeof a.value === 'string' ? a.value : JSON.stringify(a.value ?? a.description ?? '')))
        .join(' ')
      this.console.push({ level: String(params.type ?? 'log'), text })
    } else if (method === 'Runtime.exceptionThrown') {
      const detail = (params.exceptionDetails ?? {}) as Record<string, unknown>
      const exception = (detail.exception ?? {}) as Record<string, unknown>
      this.errors.push(String(exception.description ?? detail.text ?? 'uncaught exception'))
    } else if (method === 'Log.entryAdded') {
      const entry = (params.entry ?? {}) as Record<string, unknown>
      const level = String(entry.level ?? 'info')
      const text = String(entry.text ?? '')
      if (level === 'error') this.errors.push(text)
      this.console.push({ level, text })
    }
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++
    const payload: Record<string, unknown> = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.ws.send(JSON.stringify(payload))
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // already gone
    }
  }
}

async function waitForFile(path: string, deadlineMs: number): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8').trim()
      if (text.length > 0) return text
    }
    await sleep(100)
  }
  throw new Error(`chrome did not come up: ${path} never appeared`)
}

async function devtoolsSocket(profileDir: string, deadlineMs: number): Promise<string> {
  const port = Number((await waitForFile(join(profileDir, 'DevToolsActivePort'), deadlineMs)).split('\n')[0])
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      const info = (await res.json()) as { webSocketDebuggerUrl?: string }
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl
    } catch {
      // not listening yet
    }
    await sleep(100)
  }
  throw new Error('chrome opened a debugging port but never answered /json/version')
}

export type CaptureOptions = {
  /** Expression evaluated in the page; capture stops waiting when it returns true. */
  readyExpression?: string
  timeoutMs?: number
  width?: number
  height?: number
  /** Expression whose JSON-serializable result becomes `values`. */
  probeExpression?: string
}

/** Open `url` in a fresh headless Chrome, wait for readiness, then read the page back. */
export async function capture(url: string, options: CaptureOptions = {}): Promise<Capture> {
  const executable = findChrome()
  const timeoutMs = options.timeoutMs ?? 20_000
  const width = options.width ?? 1440
  const height = options.height ?? 900
  const profileDir = mkdtempSync(join(tmpdir(), 'kg-e2e-chrome-'))
  let chrome: ChildProcess | undefined
  let cdp: Cdp | undefined
  try {
    chrome = spawn(
      executable,
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--enable-unsafe-swiftshader',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        `--window-size=${width},${height}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )

    cdp = await Cdp.connect(await devtoolsSocket(profileDir, timeoutMs))
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })

    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Log.enable', {}, sessionId)
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )

    await cdp.send('Page.navigate', { url }, sessionId)

    let ready = false
    const started = Date.now()
    const readyExpression = options.readyExpression ?? 'document.readyState === "complete"'
    while (Date.now() - started < timeoutMs) {
      try {
        const result = await cdp.send<{ result: { value?: unknown } }>(
          'Runtime.evaluate',
          { expression: readyExpression, returnByValue: true, awaitPromise: true },
          sessionId,
        )
        if (result.result?.value === true) {
          ready = true
          break
        }
      } catch {
        // navigation in flight; ask again
      }
      await sleep(150)
    }

    // One settle beat after readiness: the viewer draws in an effect, and a screenshot taken
    // in the same task as the last DOM mutation catches half a layout.
    await sleep(400)

    let values: Record<string, unknown> = {}
    if (options.probeExpression) {
      try {
        const result = await cdp.send<{ result: { value?: unknown } }>(
          'Runtime.evaluate',
          { expression: options.probeExpression, returnByValue: true, awaitPromise: true },
          sessionId,
        )
        values = (result.result?.value ?? {}) as Record<string, unknown>
      } catch (error) {
        values = { probe_error: String(error) }
      }
    }

    let dom = ''
    try {
      const result = await cdp.send<{ result: { value?: unknown } }>(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const clone = document.documentElement.cloneNode(true)
            let hidden = 0
            for (const s of clone.querySelectorAll('script')) {
              hidden += s.textContent.length
              s.textContent = '/* ' + s.textContent.length + ' bytes elided */'
            }
            return clone.outerHTML
          })()`,
          returnByValue: true,
        },
        sessionId,
      )
      dom = String(result.result?.value ?? '')
    } catch {
      // keep going: the screenshot is the primary evidence
    }

    const shot = await cdp.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId,
    )

    return {
      url,
      ready,
      values,
      dom,
      console: cdp.console,
      errors: cdp.errors,
      screenshot: Buffer.from(shot.data, 'base64'),
    }
  } finally {
    cdp?.close()
    chrome?.kill('SIGKILL')
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      // the OS will clean it up
    }
  }
}
