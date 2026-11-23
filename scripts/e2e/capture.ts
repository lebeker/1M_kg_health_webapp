/**
 * The browser half of G3 — and the only place a page is opened.
 *
 * Two routes, one rule: the harness never drives a desktop application. The page is opened by the
 * capture session's `browser_navigate`, read by `browser_console`, and photographed by
 * `browser_vision`, in the managed browser Hermes runs for that session (headless, throwaway
 * profile, no real-profile copy). When that photograph does not arrive — the 2026-11-23 incident
 * was `browser_vision` deadlocking at 30 s on every call while the engine underneath answered in
 * 2.1 s — the harness takes the picture itself through the same bundled `agent-browser` binary,
 * which spawns its own headless Chromium. No `open -a`, no `osascript`, no CDP against the
 * operator's browser, and a host-application path is refused before it is spawned (`hostAppHit`).
 *
 * What comes back per page is not a claim, it is the page: the readiness boolean, the title,
 * the header, the visible text, and a sha256 over the live DOM. The DOM read is the evidence the
 * run is judged on, and it stays a hard check. The screenshot names the route that took it, and
 * a missing one is an evidence gap on the receipt (`receipt.ts`) — never a red run, because a
 * broken camera is not a product defect.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { PageKind } from './card'
import { browserEnv, endpointConfig, packagedAgentBrowser, runChat, writeHermesHome, type ToolCall } from './hermes'
import { hostAppHit } from './policy'

export type Page = { label: string; url: string; expect: string[]; kind: PageKind }

/** Which path took a page's photograph. The receipt names it per page. */
export type ScreenshotRoute = 'browser_vision' | 'agent-browser' | ''

export type PageCapture = {
  label: string
  url: string
  /** Which built page this is: `graph` (the React viewer) or `case` (the columns page). */
  kind: PageKind
  /** The object `browser_console` returned; `{}` when the session never got that far. */
  values: Record<string, unknown>
  /** Evidence-dir path of the PNG, or '' when there was none. */
  screenshot: string
  screenshotBytes: number
  /** Which route produced `screenshot`: the session's `browser_vision`, or `agent-browser`. */
  screenshotRoute: ScreenshotRoute
  /**
   * What the page could not tell us in the harness's words — a console read that never landed, a
   * value naming another URL. These are product evidence, so `run.ts` treats them as hard.
   */
  problems: string[]
  /**
   * What could not be photographed. Not the product: recorded on the receipt as a gap, and never
   * the reason a green run turns red.
   */
  evidenceGaps: string[]
}

export type CaptureRun = {
  pages: PageCapture[]
  /** Every tool the capture session called, in order — the log a reviewer can read. */
  tools: string[]
  /** The same calls, whole: the harness scans them for host-application use. */
  calls: ToolCall[]
  seconds: number
  code: number
  logPath: string
  /** The capture session itself failed to be a session: no tool calls at all. Hard. */
  sessionProblems: string[]
  /** The session ran but a photograph is missing or thin. Recorded, never a red run. */
  evidenceGaps: string[]
}

/**
 * The expression the capture session runs in the page. It waits for the app's first render, so
 * one call is enough, and it answers the claim itself: `expect` is matched against the page's
 * own text, in the page, rather than against a string the model retyped.
 *
 * Two pages, two shapes. The graph page mounts React into `#root` and prints `N nodes · M edges`
 * in `header.bar`; the columns page mounts nothing, boots from `#kg-graph` into three static
 * columns, and reports itself through the page's own acceptance hooks (`__documentState`,
 * `__columns`, `__records`) — so readiness means "the document is in it and the three columns
 * are drawn", not "six elements appeared under a root that does not exist here".
 *
 * Keep the returned object small: the session's record stream caps one tool result at 5 kB, and
 * a truncated result cannot be parsed. The whole DOM is represented by its sha256 and length;
 * `domHead` is there so a reviewer sees the document is real without a 2 MB file.
 */
export function probeExpression(expect: string[], kind: PageKind = 'graph'): string {
  const needles = JSON.stringify(expect)
  if (kind === 'case') {
    return `(async () => {
  const start = Date.now()
  const state = () => (typeof window.__documentState === 'function' ? window.__documentState() : 'no hook')
  const cols = () => {
    try { return typeof window.__columns === 'function' ? window.__columns() : null } catch (error) { return null }
  }
  const drawn = (c) => Boolean(c && c.left && c.centre && c.panel && c.centre.width > 0 && c.panel.width > 0)
  while (Date.now() - start < 20000 && !(state() === 'present' && cols() && cols().centreFilled)) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const columns = cols() || {}
  let records = { total: 0, stored: 0, sample: [] }
  try {
    if (typeof window.__records === 'function') {
      const all = window.__records()
      const kept = all.filter((row) => row.stored === true)
      records = { total: all.length, stored: kept.length, sample: kept.slice(0, 6).map((row) => ({ kind: row.kind, date: row.date })) }
    }
  } catch (error) { records = { total: 0, stored: 0, sample: [] } }
  const html = document.documentElement.outerHTML
  const body = (document.body.innerText || '')
  const lower = body.toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  const sha = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return {
    url: location.href,
    ready: state() === 'present' && drawn(columns) && columns.centreFilled === true,
    page: 'case',
    title: document.title,
    documentState: state(),
    columns: {
      left: columns.left ? columns.left.width : 0,
      centre: columns.centre ? columns.centre.width : 0,
      panel: columns.panel ? columns.panel.width : 0,
      centreFilled: columns.centreFilled === true,
      centreRecord: columns.centreRecord || '',
      states: columns.states || 0,
    },
    records,
    text: body.slice(0, 700),
    claim: ${needles}.map((needle) => ({ needle, found: lower.includes(needle.toLowerCase()) })),
    empty: state() === 'absent' ? 'document' : null,
    domBytes: html.length,
    domSha256: sha,
    domHead: html.slice(0, 300),
    capturedAt: new Date().toISOString(),
  }
})()`
  }
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
    page: 'graph',
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
  const steps = pages
    .map((page, index) => {
      const question =
        page.kind === 'case'
          ? 'the columns page under test — are the left record list, the centre record and the right panel drawn, and which headings are visible?'
          : 'the page under test — does it show a rendered graph and which header text is visible?'
      return (
        `PAGE ${index + 1} — ${page.label} (${page.kind} page)\n  a. browser_navigate with url: ${page.url}\n` +
        `  b. browser_console with this exact expression (it waits for the first render itself):\n${probeExpression(page.expect, page.kind)}\n` +
        `  c. browser_vision with question: "${question}"`
      )
    })
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
 * A file that is a PNG, and what is wrong with it when it is not one. Both routes go through
 * this: a photograph that is not a picture is the same defect whichever path produced it.
 */
function pngState(path: string): { ok: boolean; bytes: number; why: string } {
  if (!existsSync(path)) return { ok: false, bytes: 0, why: 'no file' }
  const bytes = statSync(path).size
  if (bytes === 0) return { ok: false, bytes, why: 'empty file' }
  const magic = readFileSync(path).subarray(0, 8).toString('hex')
  if (magic !== '89504e470d0a1a0a') return { ok: false, bytes, why: 'not a PNG' }
  return { ok: true, bytes, why: '' }
}

export type DirectCapture = { ok: boolean; bytes: number; detail: string }

/**
 * The route that does not depend on `browser_vision`: the harness spawns the bundled
 * `agent-browser` binary itself and asks it to open the page and take the picture.
 *
 * It is the same engine the managed session uses — the binary Hermes packages, spawning its own
 * headless Chromium — just without the tool layer that deadlocked. Every boundary the policy
 * states still applies, and it applies *before* the spawn rather than in a scan afterwards:
 *
 *  - the executable is checked against the owner-policy patterns first, so a path that names a
 *    desktop application (`/Applications/…Chrome.app`, `Chromium.app`, a CDP endpoint) is refused
 *    outright, and the packaged Chrome for Testing under `~/.hermes/tools` is not matched by any
 *    of them;
 *  - nothing is run through a shell, so `open -a` and `osascript` are not merely discouraged, they
 *    are not reachable: the URL is one argv element and the binary is executed directly;
 *  - the output path is required to be absolute. A relative path is resolved against the browser
 *    daemon's own working directory, not the harness's — measured: the file was written somewhere
 *    else while the CLI happily printed "✓ Screenshot saved to probe.png". A silent miss would be
 *    an evidence gap nobody asked for, so it is a refusal instead.
 *
 * `E2E_CAPTURE_PROBE=broken` makes this route fail on purpose. It exists so the gap path can be
 * exercised end to end (a run whose camera is broken must record a gap, not a veto) and is not
 * meant for a real run.
 */
export function captureWithBinary(input: { url: string; out: string; binary: string; session: string; timeoutMs?: number }): DirectCapture {
  // The host-application test comes before the existence test on purpose: whether a path names a
  // desktop application is a fact about the path, and a bot has no business stat-ing the user's
  // apps to find out. Refused either way, and refused without touching it.
  const hostHit = hostAppHit(input.binary)
  const refusal =
    hostHit
      ? `refused to run ${input.binary}: ${hostHit} is a desktop application, and the capture may only use the harness's own headless binary`
      : !input.binary || !existsSync(input.binary)
        ? 'no bundled agent-browser binary was found (set E2E_AGENT_BROWSER)'
        : !isAbsolute(input.out)
          ? `refused a relative screenshot path ${input.out}: agent-browser resolves it against its own working directory, not the harness's`
          : // The negative control is last on purpose: it breaks a route that is otherwise valid, so
            // the other refusals keep their own words and the probe cannot be mistaken for one of
            // them. It also stops leaking into anything that runs `bun run verify` beside the run.
            process.env.E2E_CAPTURE_PROBE === 'broken'
            ? 'the capture probe was deliberately broken (E2E_CAPTURE_PROBE=broken)'
            : ''
  if (refusal) return { ok: false, bytes: 0, detail: refusal }

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: browserEnv([]).PATH }
  // Deliberately *not* `AGENT_BROWSER_EXECUTABLE_PATH`, which is what Hermes sets for its own
  // browser: pointing it at the packaged `Google Chrome for Testing` makes this CLI's `screenshot`
  // hang here (`open` still answers in 1.4 s, `screenshot` never returns; measured at 40 s and at
  // the 60 s kill). Left unset, the same CLI launches its own managed Chromium — visible in `ps`
  // as `~/.hermes/tools/chromium-…/Google Chrome for Testing --headless=new`, never
  // `/Applications/Google Chrome.app` — and photographs the same page in under a second. So the
  // browser is the harness's, chosen by the harness's own CLI, not the operator's.
  delete env.AGENT_BROWSER_EXECUTABLE_PATH
  const timeout = input.timeoutMs ?? 45_000
  const session = ['--session', input.session]
  const started = Date.now()
  const open = spawnSync(input.binary, [...session, 'open', input.url], { encoding: 'utf8', env, timeout })
  if (open.status !== 0) {
    const why = `${open.error ? String(open.error.message) : ''}${open.stderr ?? ''}`.trim().split('\n')[0]
    return { ok: false, bytes: 0, detail: `agent-browser open exited ${open.status ?? 'killed'}${why ? `: ${why}` : ''}` }
  }
  const shot = spawnSync(input.binary, [...session, '--json', 'screenshot', input.out], { encoding: 'utf8', env, timeout })
  // The session is the CLI's, not the harness's: it must not outlive this call and become a
  // browser nobody owns.
  spawnSync(input.binary, [...session, 'close'], { encoding: 'utf8', env, timeout: 15_000 })
  if (shot.status !== 0) {
    const why = `${shot.error ? String(shot.error.message) : ''}${shot.stderr ?? ''}`.trim().split('\n')[0]
    return { ok: false, bytes: 0, detail: `agent-browser screenshot exited ${shot.status ?? 'killed'}${why ? `: ${why}` : ''}` }
  }
  // The CLI exits 0 on a browser it could not start and says so in the JSON instead
  // (`{"success":false,"error":"Chrome exited early…"}`); a non-zero exit is not the only failure.
  const reported = (() => {
    try {
      return JSON.parse(String(shot.stdout ?? '')) as { success?: boolean; error?: string | null }
    } catch {
      return null
    }
  })()
  if (reported && reported.success === false) {
    return { ok: false, bytes: 0, detail: `agent-browser reported failure: ${String(reported.error ?? 'no message').split('\n')[0]}` }
  }
  const png = pngState(input.out)
  if (!png.ok) return { ok: false, bytes: png.bytes, detail: `agent-browser wrote ${input.out}, which is ${png.why}` }
  const seconds = Math.round((Date.now() - started) / 100) / 10
  return { ok: true, bytes: png.bytes, detail: `agent-browser photographed ${input.url} in ${seconds}s` }
}

/**
 * Open every page in one capture session and copy its output into the evidence directory.
 *
 * Nothing is softened about the *page*: one with no values, or values naming a different URL,
 * comes back in `problems` and `run.ts` turns that into a failed check. A page that could not be
 * *photographed* is different, and after SCRUM-64 it is recorded as a gap: the harness tries the
 * session's picture, then the bundled binary, and whatever it could not get is written down
 * without deciding the run.
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
    // `browser` alone, deliberately. Hermes builds the browser toolset from its `browser_*`
    // tools and offers it when it can find the `agent-browser` CLI (put on this session's PATH
    // above); it does not need `terminal` for that. Granting `terminal` would hand a host shell
    // to a session whose only documented job is three browser calls — and it would keep
    // `browser_exec`, the toolset's arbitrary-code tool, in the surface. `run.ts` checks that
    // every call this session made is one of the three, so the scope cannot drift silently.
    toolsets: ['browser'],
    env: browserEnv([bin]),
    maxTurns: options.maxTurns ?? 40,
    timeoutMs: options.timeoutMs ?? 8 * 60_000,
    logPath,
    source: 'e2e-capture',
  })

  // A session that made no tool call produced nothing to read: that is a hard failure of the
  // session. A kill or a non-zero exit after the console reads landed is not — the pages were
  // still read, and the photographs now have a second route — so it is recorded as a gap.
  const sessionProblems: string[] = []
  const evidenceGaps: string[] = []
  if (run.calls.length === 0) {
    sessionProblems.push(
      run.timedOut
        ? `the capture session was killed after ${Math.round(run.seconds)}s without a tool call`
        : `the capture session made no tool calls (exit ${run.code})`,
    )
  } else if (run.timedOut) {
    evidenceGaps.push(`the capture session was killed after ${Math.round(run.seconds)}s; its console reads were kept and any page it had not reached was photographed directly`)
  } else if (run.code !== 0) {
    evidenceGaps.push(`the capture session exited ${run.code}; its console reads were kept and any missing photograph was taken directly`)
  }

  // Walk the record stream in order: a navigation, then the console read, then the picture,
  // page after page. Pairing by position rather than by matching model-retyped text keeps the
  // evidence tied to the tool calls that actually happened.
  const shots = screenshotsOf(home)
  const captures: PageCapture[] = options.pages.map((page) => ({
    label: page.label,
    url: page.url,
    kind: page.kind,
    values: {},
    screenshot: '',
    screenshotBytes: 0,
    screenshotRoute: '',
    problems: [],
    evidenceGaps: [],
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
    const destination = join(options.outDir, name)
    const source = shots[index] ? pngState(shots[index]) : { ok: false, bytes: 0, why: 'the session cache holds no file' }
    if (shots[index] && source.ok) {
      copyFileSync(shots[index], destination)
      capture.screenshot = destination
      capture.screenshotBytes = source.bytes
      capture.screenshotRoute = 'browser_vision'
      return
    }
    if (shots[index]) evidenceGaps.push(`${name}: browser_vision's own file was unusable (${source.why})`)
    const direct = captureWithBinary({
      url: capture.url,
      out: destination,
      binary: cli ?? '',
      session: `e2e-${process.pid}-${index}`,
    })
    if (direct.ok) {
      capture.screenshot = destination
      capture.screenshotBytes = direct.bytes
      capture.screenshotRoute = 'agent-browser'
      evidenceGaps.push(`browser_vision did not photograph ${capture.label}; ${direct.detail}`)
      return
    }
    capture.evidenceGaps.push(`no screenshot for ${capture.label}: ${direct.detail}`)
  })

  if (visionSeen < options.pages.length) {
    evidenceGaps.push(
      `${options.pages.length} pages were asked for but browser_vision ran ${visionSeen} time(s); the pictures came from the bundled binary instead`,
    )
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
    calls: run.calls,
    seconds: run.seconds,
    code: run.code,
    logPath,
    sessionProblems,
    evidenceGaps: [...evidenceGaps, ...captures.flatMap((capture) => capture.evidenceGaps)],
  }
}

/**
 * One line for the end of a run: where the page was, what it called itself, and the figure that
 * page actually has. The two pages do not share one: the graph viewer mounts React into `#root`
 * and counts the elements under it, the columns page mounts nothing and reports the record list
 * and the three column widths instead. Printing `values.mounted` for both made a passing columns
 * capture read `0 elements` — a render failure that never happened.
 */
export function describeValues(values: Record<string, unknown>, kind: PageKind = 'graph'): string {
  const url = String(values.url ?? '')
  const title = String(values.title ?? '')
  if (kind === 'case') {
    const records = (values.records ?? {}) as { stored?: number }
    const columns = (values.columns ?? {}) as { left?: number; centre?: number; panel?: number }
    return `${url || 'no url'} ("${title}", ${Number(records.stored ?? 0)} record(s), columns ${Number(columns.left ?? 0)}/${Number(columns.centre ?? 0)}/${Number(columns.panel ?? 0)} px)`
  }
  const mounted = Number(values.mounted ?? 0)
  return `${url || 'no url'} ("${title}", ${mounted} elements)`
}
