/**
 * The receipt's arithmetic: which checks decide a run, and which one only records a gap.
 *
 * A gate that can be red because a capture tool is broken is not a gate, it is a hostage. The
 * 2026-11-23 incident was exactly that: `browser_vision` deadlocked on every call (30 s, three
 * attempts, including `https://example.com`), so `case.browser` and `case.screenshot` went red on
 * two cards whose product behaviour was independently approved and whose CI was green. The engine
 * worked — the bundled `agent-browser` binary photographed the same page in 2.1 s — and the
 * wrapper was the broken part. No amount of evidence about the product was going to fix it.
 *
 * So a check carries a lane. A **hard** check asserts the product: the page held this document,
 * drew these columns, printed these counts, and the card's own claim is visible on it. Those stay
 * red and they are what a merge waits for. A check with `hard: false` asserts the *capture tool*:
 * that a PNG exists and is a real one. It is still written down — silence about a missing
 * photograph would be the same lie in the other direction — but it lands in `evidenceGaps`, is
 * printed as `gap`, and it never turns a green run red.
 *
 * The rule is deliberately one-directional. Nothing here promotes a tool check to a product
 * check, and a page whose DOM was never read still fails its hard checks: "the camera was broken"
 * explains a missing photograph, not a page that did not render.
 */
import type { PageKind } from './card'

export type Check = {
  name: string
  ok: boolean
  detail: string
  /**
   * `false` for a check that proves a capture tool worked rather than that the product did.
   * Omitted means hard: a check is a product assertion unless it says otherwise.
   */
  hard?: boolean
}

export function isHard(check: Check): boolean {
  return check.hard !== false
}

/** The checks that make a run red: they are about the product, and they are not green. */
export function hardFailures(checks: Check[]): Check[] {
  return checks.filter((check) => !check.ok && isHard(check))
}

/** The checks that are not green but decide nothing: what the run could not photograph. */
export function evidenceGaps(checks: Check[]): Check[] {
  return checks.filter((check) => !check.ok && !isHard(check))
}

export function verdict(checks: Check[]): { passed: boolean; failures: Check[]; gaps: Check[] } {
  const failures = hardFailures(checks)
  return { passed: failures.length === 0, failures, gaps: evidenceGaps(checks) }
}

/** One line each, for a comment, a log, or a report. */
export function describeGaps(gaps: Check[]): string[] {
  return gaps.map((gap) => `${gap.name}: ${gap.detail}`)
}

/**
 * The screenshot check. `hard: false`, always: it is the one check whose failure is about the
 * tool, and the card that exposed it (`SCRUM-64`) is the reason it is written this way.
 */
export const SCREENSHOT_BYTES = 15_000

export type ScreenshotEvidence = {
  /** Evidence-dir path of the PNG, or '' when there is none. */
  screenshot: string
  screenshotBytes: number
  /** Which path took it: `browser_vision` in the capture session, or `agent-browser` directly. */
  screenshotRoute: string
}

export function screenshotCheck(stage: string, shot: ScreenshotEvidence): Check {
  const ok = shot.screenshot !== '' && shot.screenshotBytes >= SCREENSHOT_BYTES
  if (ok) {
    return {
      name: `${stage}.screenshot`,
      ok: true,
      hard: false,
      detail: `${shot.screenshotBytes} bytes of PNG at ${shot.screenshot} (taken by ${shot.screenshotRoute})`,
    }
  }
  const why =
    shot.screenshot === ''
      ? 'no screenshot was taken'
      : `${shot.screenshot} is only ${shot.screenshotBytes} bytes, below the ${SCREENSHOT_BYTES}-byte floor`
  return {
    name: `${stage}.screenshot`,
    ok: false,
    hard: false,
    detail: `${why} (${shot.screenshotRoute || 'no route'}) — recorded as an evidence gap: the page's own checks decide the run, not the camera`,
  }
}

export type ReceiptState = 'success' | 'failure' | 'error' | 'pending'

/**
 * The one line the `e2e` commit status carries. The page marker must stay in the shape
 * `ci-gate.ts` reads (`[case]`, `[graph]`, `[case+graph]`): a diff that moves the columns page is
 * only satisfied by a receipt that says it opened that page, and that marker is the whole record
 * of the claim.
 *
 * Gaps are named on a green receipt instead of being hidden. A reader who sees `PASS — 1 evidence
 * gap` knows to open the run; a receipt that said only `PASS` would be claiming a photograph that
 * may not exist.
 */
export function receiptDescription(input: {
  pages: PageKind[]
  failures: Check[]
  gaps: Check[]
  run: string
  cardId: string
}): string {
  const marker = `[${input.pages.join('+')}]`
  if (input.failures.length === 0) {
    const gapText = input.gaps.length > 0 ? ` — ${input.gaps.length} evidence gap${input.gaps.length === 1 ? '' : 's'}` : ''
    return `G3 ${marker} PASS${gapText} — ${input.run} — ${input.cardId}`
  }
  const what = `${input.failures.length} failed: ${input.failures
    .map((check) => check.name)
    .slice(0, 2)
    .join(', ')}`
  return `G3 ${marker} ${what} — ${input.run}`
}
