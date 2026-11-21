/**
 * The two refusals a child session is held to, as patterns rather than as instructions.
 *
 * A rule in a prompt is a request: a model can ignore it, and the run then reports success on a
 * machine it rummaged through. These are the checks that make the request true — every tool call
 * the clean-room agent makes is scanned after the fact, and one hit is a failed run, not a note.
 *
 * `HOST_APP` is owner policy: bots do not launch, attach to or control desktop applications, so a
 * child that names a browser binary, `osascript`, `open -a`, a remote-debugging port, Playwright or
 * Puppeteer produced a picture of something the harness did not choose.
 *
 * `OUTSIDE_ROOM` is the same idea about the filesystem. The room is a directory, not a jail, and a
 * `find /` walk does not merely leave it: it crosses `/Volumes`, so macOS raises a consent dialog
 * for every removable and network volume, attributed to this machine's owner. That happened in a
 * real run — the agent was looking for the app's checker because the first version of the room put
 * it one directory up — and the fix is both a room where nothing is out of reach and this check.
 */
import type { ToolCall } from './hermes'

export const HOST_APP_PATTERNS: Array<[RegExp, string]> = [
  [/Google Chrome for Testing/i, 'the packaged Chrome binary'],
  [/Chrome\.app\/Contents\/MacOS/i, 'a Chrome binary'],
  [/Chromium\.app/i, 'a Chromium binary'],
  [/--remote-debugging/i, 'a raw CDP port'],
  [/--dump-dom/i, 'a headless-chrome dump'],
  [/headless=new/i, 'a headless-chrome launch'],
  [/\bosascript\b/i, 'AppleScript'],
  [/\bopen\s+-a\b/i, 'launching a mac app'],
  [/\bplaywright\b/i, 'Playwright'],
  [/\bpuppeteer\b/i, 'Puppeteer'],
]

/**
 * The room's boundary. A path *inside* the room is under the system temp directory, so an
 * absolute in-room path never matches these; anything that names the operator's home, a mounted
 * volume, the system or the applications folder does.
 */
export const OUTSIDE_ROOM_PATTERNS: Array<[RegExp, string]> = [
  [/\bfind\b[^\n]*?\s\/(?![\w.-])/, 'a search from the filesystem root'],
  [/\bfind\b[^\n]*\s(?:~|\$HOME)(?:\/|\s|"|$)/, 'a search of a home directory'],
  [/\bfind\b[^\n]*\s\.\.(?:\/|\s|"|$)/, 'a search above the room'],
  [/\bls\b[^\n]*\s\/(?![\w.-])/, 'a listing of the filesystem root'],
  [/\b(?:grep|rg)\b[^\n]*\s\/(?![\w.-])/, 'a search from the filesystem root'],
  [/\bmdfind\b/, 'a Spotlight search over the whole machine'],
  [/\bdiskutil\b/, 'a disk query'],
  [/\/Volumes\b/, 'the mounted volumes'],
  [/\/System\b/, 'the system directory'],
  [/\/Applications\b/, 'the applications directory'],
  [/\/Users\b/, 'a home directory outside the room'],
]

/** Tool calls whose input matches any of `patterns`, described in the harness's own words. */
export function offendingCalls(calls: ToolCall[], patterns: Array<[RegExp, string]>): string[] {
  const found: string[] = []
  for (const call of calls) {
    const text = JSON.stringify(call.input)
    for (const [pattern, what] of patterns) {
      if (pattern.test(text)) {
        found.push(`${call.name}: ${what}`)
        break
      }
    }
  }
  return found
}

export function hostAppCalls(calls: ToolCall[]): string[] {
  return offendingCalls(calls, HOST_APP_PATTERNS)
}

export function outsideRoomCalls(calls: ToolCall[]): string[] {
  return offendingCalls(calls, OUTSIDE_ROOM_PATTERNS)
}
