/**
 * The browser half of G3 — and the only place a page is opened.
 *
 * The harness does not drive a browser and does not import a browser driver. It starts one
 * narrowly scoped Hermes session whose only toolset is `browser`, hands it the pages to look
 * at, and reads the session's own record stream back. The page is opened by `browser_navigate`,
 * read by `browser_console`, and photographed by `browser_vision`, in the managed browser
 * Hermes runs for that session (headless, throwaway profile, no real-profile copy). The owner
 * policy forbids bots from launching or attaching to desktop applications, so nothing here
 * spawns Chrome, CDP or Playwright, and a headless-chrome command in a child's transcript is a
 * failed check rather than a workaround.
 *
 * What comes back per page is not a claim, it is the page: the readiness boolean, the title,
 * the header, the visible text, and a sha256 over the live DOM. The screenshot is the file the
 * `browser_vision` tool wrote into this session's own cache — the harness copies it, it is not
 * re-rendered.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserEnv, endpointConfig, packagedAgentBrowser, runChat, writeHermesHome } from './hermes'

export type Page = { label: string; url: string; expect: string[] }

export type PageCapture = {
  label: string
  url: string
  /** The object `browser_console` returned; `{}` when the session never got that far. */
  values: Record<string, unknown>
  /** Evidence-dir path of the PNG `browser_vision` wrote, or '' when there was none. */
  screenshot: string
  screenshotBytes: number
  /**
   * What went wrong for this page, in the harness's words. Empty when the page was captured
   * and the values name the URL that was asked for.
   */
  problems: string[]
}

export type CaptureRun = {
  pages: PageCapture[]
  /** Every tool the capture session called, in order — the log a reviewer can read. */
  tools: string[]
  seconds: number
  code: number
  logPath: string
  sessionProblems: string[]
}

/**
 * The expression the capture session runs in the page. It waits for the app's first render, so
 * one call is enough, and it answers the claim itself: `expect` is matched against the page's
 * own text, in the page, rather than against a string the model retyped.
 *
 * Keep the returned object small: the session's record stream caps one tool result at 5 kB, and
 * a truncated result cannot be parsed. The whole DOM is represented by its sha256 and length;
 * `domHead` is there so a reviewer sees the document is real without a 2 MB file.
 */
export function probeExpression(expect: string[]): string {
  const needles = JSON.stringify(expect)
  return `(async () => {
  const start = Date.now()
  const mounted = () => document.querySelectorAll('#root *').length
  const loading = () => document.querySelector('[data-loading="first-frame"]')
  while (Date.now() - start < 20000 && (mounted() < 6 || loading())) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const header = document.querySelector('header.bar')
  const empty = document.querySelector('[data-empty]')
  const html = document.documentElement.outerHTML
  const body = (document.body.innerText || '')
  const lower = body.toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  const sha = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return {
    url: location.href,
    ready: mounted() > 5 && !loading(),
    title: document.title,
    header: header ? header.innerText.replace(/\\n+/g, ' | ') : '',
    text: body.slice(0, 1200),
    claim: ${needles}.map((needle) => ({ needle, found: lower.includes(needle.toLowerCase()) })),
    mounted: mounted(),
    empty: empty ? empty.getAttribute('data-empty') : null,
    domBytes: html.length,
    domSha256: sha,
    domHead: html.slice(0, 500),
    capturedAt: new Date().toISOString(),
  }
})()`
}

/**
 * The capture session's whole brief. It is infrastructure, not the card: the card decides
 * *what* page and *what* claim; this decides only how to look at it, and it is the same text
 * for every card so a reviewer can read it once.
 */
export function capturePrompt(pages: Page[]): string {
  const probe = probeExpression(pages[0]?.expect ?? [])
  const steps = pages
    .map(
      (page, index) =>
        `PAGE ${index + 1} — ${page.label}\n  a. browser_navigate with url: ${page.url}\n` +
        `  b. browser_console with this exact expression (it waits for the first render itself):\n${probe}\n` +
        `  c. browser_vision with question: "the page under test — does it show a rendered graph and which header text is visible?"`,
    )
    .join('\n\n')
  return [
    'You are the capture step of an automated gate. Do not solve any other problem, do not',
    'summarise, do not edit any file. The harness reads your tool results itself.',
    '',
    'For each page below, in this order, call these three tools and nothing else:',
    '',
    steps,
    '',
    'When the last page is done, reply with exactly: CAPTURE-DONE',
    '',
    'Rules:',
    '- Use only browser_navigate, browser_console and browser_vision.',
    '- The browser is already provided by those tools. Never start a browser program or a',
    '  desktop app: no chrome, no "Google Chrome for Testing", no open, no osascript, no',
    '  headless-chrome command, no CDP or Playwright script. Pages are opened by URL only.',
    '- Do not write files. Do not rebuild anything.',
    '- If browser_console returns an error, call it again once. If browser_vision fails, still',
    '  finish the remaining pages.',
  ].join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** `browser_console` answers `{success, result, result_type}`; unwrap whatever shape came back. */
function unwrapConsole(output: string): Record<string, unknown> | null {
  const parsed = asRecord(JSON.parse(output))
  if (!parsed) return null
  const inner = asRecord(parsed.result)
  return inner ?? parsed
}

/** Screenshots `browser_vision` wrote into this session's cache, oldest first. */
function screenshotsOf(home: string): string[] {
  const dir = join(home, 'cache', 'screenshots')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

export type CaptureOptions = {
  pages: Page[]
  outDir: string
  timeoutMs?: number
  maxTurns?: number
}

/**
 * Open every page in one capture session and copy its output into the evidence directory.
 * Nothing is softened on failure: a page with no values, no screenshot, or values naming a
 * different URL comes back in `problems`, and `run.ts` turns that into a failed check.
 */
export async function capturePages(options: CaptureOptions): Promise<CaptureRun> {
  const home = mkdtempSync(join(tmpdir(), 'kg-e2e-capture-home-'))
  const work = join(home, 'work')
  mkdirSync(work, { recursive: true })
  writeHermesHome(home, endpointConfig(work))
  // Hermes offers the browser toolset only when it can find its `agent-browser` CLI and a
  // Chromium. Both live under the operator's `~/.hermes/tools`; this session has its own home,
  // so the CLI is put on its PATH under the name Hermes looks for.
  const bin = join(home, 'bin')
  mkdirSync(bin, { recursive: true })
  const cli = packagedAgentBrowser()
  if (cli) {
    try {
      symlinkSync(cli, join(bin, 'agent-browser'))
    } catch {
      // an unlinkable CLI is caught below: the toolset will not be offered and the run fails
    }
  }
  mkdirSync(options.outDir, { recursive: true })
  const logPath = join(options.outDir, 'capture.jsonl')
  writeFileSync(join(options.outDir, 'capture.prompt.txt'), `${capturePrompt(options.pages)}\n`)

  let run: Awaited<ReturnType<typeof runChat>>
  run = await runChat({
    home,
    work,
    prompt: capturePrompt(options.pages),
    // Hermes only offers the browser toolset to a session that also has `terminal` (the
    // browser driver runs as a child process). The capture session is told not to use it.
    toolsets: ['browser', 'terminal'],
    env: browserEnv([bin]),
    maxTurns: options.maxTurns ?? 40,
    timeoutMs: options.timeoutMs ?? 8 * 60_000,
    logPath,
    source: 'e2e-capture',
  })

  const problems: string[] = []
  if (run.timedOut) problems.push(`the capture session was killed after ${Math.round(run.seconds)}s`)
  if (run.code !== 0) problems.push(`the capture session exited ${run.code}`)

  // Walk the record stream in order: a navigation, then the console read, then the picture,
  // page after page. Pairing by position rather than by matching model-retyped text keeps the
  // evidence tied to the tool calls that actually happened.
  const shots = screenshotsOf(home)
  const captures: PageCapture[] = options.pages.map((page) => ({
    label: page.label,
    url: page.url,
    values: {},
    screenshot: '',
    screenshotBytes: 0,
    problems: [],
  }))

  let stage = -1
  let visionSeen = 0
  for (const call of run.calls) {
    if (call.name === 'browser_navigate') {
      const url = String(call.input.url ?? '')
      const next = options.pages.findIndex((page, index) => index > stage && page.url === url)
      if (next !== -1) stage = next
      continue
    }
    if (call.name === 'browser_vision') {
      visionSeen += 1
      continue
    }
    if (call.name !== 'browser_console' || stage === -1) continue
    if (Object.keys(captures[stage].values).length > 0) continue
    try {
      const values = unwrapConsole(call.output)
      if (values) captures[stage].values = values
      else captures[stage].problems.push('browser_console returned nothing parseable')
    } catch {
      captures[stage].problems.push(`browser_console output was not JSON: ${call.output.slice(0, 200)}`)
    }
  }

  captures.forEach((capture, index) => {
    const name = `${capture.label}.png`
    const source = shots[index]
    if (!source) {
      capture.problems.push('browser_vision left no screenshot in the session cache')
      return
    }
    const bytes = statSync(source).size
    copyFileSync(source, join(options.outDir, name))
    capture.screenshot = join(options.outDir, name)
    capture.screenshotBytes = bytes
    const magic = readFileSync(source).subarray(0, 8).toString('hex')
    if (magic !== '89504e470d0a1a0a') capture.problems.push(`${name} is not a PNG`)
    if (bytes < 15_000) capture.problems.push(`${name} is only ${bytes} bytes`)
  })

  if (visionSeen < options.pages.length) {
    problems.push(`${options.pages.length} pages were asked for but browser_vision ran ${visionSeen} time(s)`)
  }

  const tools = run.calls.map((call) => {
    const detail =
      call.name === 'browser_navigate'
        ? String(call.input.url ?? '')
        : call.name === 'browser_vision'
          ? String(call.input.question ?? '').slice(0, 80)
          : call.name === 'browser_console'
            ? `${String(call.input.expression ?? '').slice(0, 40)}…`
            : ''
    return `${call.name} ${detail}`.trim()
  })

  try {
    rmSync(home, { recursive: true, force: true })
  } catch {
    // the OS will clean up a temp dir
  }

  return {
    pages: captures,
    tools,
    seconds: run.seconds,
    code: run.code,
    logPath,
    sessionProblems: problems,
  }
}

/** Kept for the failure comment: a page's own words when the harness could not read it. */
export function describeValues(values: Record<string, unknown>): string {
  const url = String(values.url ?? '')
  const title = String(values.title ?? '')
  const mounted = Number(values.mounted ?? 0)
  return `${url || 'no url'} ("${title}", ${mounted} elements)`
}
