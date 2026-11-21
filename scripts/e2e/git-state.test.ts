import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { worktreeState } from './git-state'

/** A real repository, because the bug this covers was in how git was asked. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kg-e2e-git-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env })
  git('init', '-q')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', 'a.txt')
  git('commit', '-qm', 'first')
  return dir
}

describe('the worktree the evidence names', () => {
  test('a clean tree is clean, and the commit is the head', () => {
    const dir = repo()
    try {
      const state = worktreeState(dir)
      expect(state.dirtyFiles).toEqual([])
      expect(state.commit).toMatch(/^[0-9a-f]{40}$/)
      expect(state.branch).toBe('main')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a modified file is named, not just counted', () => {
    const dir = repo()
    try {
      writeFileSync(join(dir, 'a.txt'), 'two\n')
      const state = worktreeState(dir)
      expect(state.dirtyFiles).toEqual(['M a.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an untracked file shows up too', () => {
    const dir = repo()
    try {
      writeFileSync(join(dir, 'b.txt'), 'new\n')
      expect(worktreeState(dir).dirtyFiles).toEqual(['?? b.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
