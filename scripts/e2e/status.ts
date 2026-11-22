/**
 * The receipt a G3 run leaves on the commit it ran against.
 *
 * A run directory under `~/.hermes/e2e` is evidence a human can open; it is not something CI or
 * the board can see. So a passing run also posts one commit status, on the exact `HEAD` it
 * built, and that status is what the rest of the loop reads: `verify` requires it on a pull
 * request that touches the product, and a branch cannot merge without `verify`.
 *
 * The status carries no claim of its own. Its description names the run directory, so a reader
 * who wants the DOM hashes, the screenshots and the transcripts follows the receipt to them;
 * the run directory is the evidence and this is only the pointer. Written by `run.ts` on the
 * commit it just captured, and never by hand — a status posted by anything other than a green
 * run of that commit defeats the gate it exists to be.
 */
import { execFileSync } from 'node:child_process'

/** The context name. CI reads exactly this one; changing it breaks the gate without breaking a test. */
export const E2E_STATUS_CONTEXT = 'e2e'

export type StatusState = 'success' | 'failure' | 'error' | 'pending'

/** `owner/name` of the repository this worktree pushes to. */
export function repoSlug(worktree: string): string {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: worktree, encoding: 'utf8' }).trim()
  const match = url.match(/(?:[:/])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (!match) throw new Error(`cannot read a GitHub repository out of the origin remote: ${url}`)
  return match[1]
}

/** Is `sha` actually on the remote? A status for a commit GitHub has never seen is refused. */
export function onRemote(worktree: string, sha: string): boolean {
  try {
    const out = execFileSync('git', ['branch', '-r', '--contains', sha], { cwd: worktree, encoding: 'utf8' })
    const lines = out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.some((line) => /^origin\/\S+$/.test(line))
  } catch {
    return false
  }
}

/**
 * Post one status. `gh` is the transport: the worker is already authenticated as its own
 * identity, and a token in the harness's environment would be a second credential to keep.
 */
export function postStatus(input: {
  worktree: string
  sha: string
  state: StatusState
  description: string
}): { ok: boolean; output: string } {
  const repo = repoSlug(input.worktree)
  const description = input.description.replace(/\s+/g, ' ').slice(0, 140)
  try {
    const output = execFileSync(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${repo}/statuses/${input.sha}`,
        '-f',
        `state=${input.state}`,
        '-f',
        `context=${E2E_STATUS_CONTEXT}`,
        '-f',
        `description=${description}`,
      ],
      { cwd: input.worktree, encoding: 'utf8' },
    )
    return { ok: true, output }
  } catch (error) {
    const failed = error as { stderr?: string; message?: string }
    return { ok: false, output: String(failed.stderr ?? failed.message ?? error).trim() }
  }
}
