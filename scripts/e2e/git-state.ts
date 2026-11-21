/**
 * What the worktree is, read in one place — and with the flag actually passed as a flag.
 *
 * The first version called `git status porcelain`, without the `--`. Git reads that as a
 * pathspec, prints the human status for a file named `porcelain` (which never exists, so the
 * tree is "clean"), and the harness split that paragraph into "files that made the worktree
 * dirty". Every run therefore recorded `dirty: true` on a clean tree, and the evidence could not
 * name the commit it was produced on — which is the one thing a reviewer needs from it.
 */
import { execFileSync } from 'node:child_process'

export function git(worktree: string, args: string[]): string {
  return execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim()
}

export type WorktreeState = {
  commit: string
  branch: string
  /** Porcelain lines: one per changed path, empty on a clean tree. */
  dirtyFiles: string[]
}

export function worktreeState(worktree: string): WorktreeState {
  const commit = git(worktree, ['rev-parse', 'HEAD'])
  const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const dirtyFiles = git(worktree, ['status', '--porcelain'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return { commit, branch, dirtyFiles }
}
