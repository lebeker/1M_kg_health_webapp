import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CleanRoom, checkerDir, keepRoomCopy } from './cleanroom'

/**
 * `--keep-room` is the reviewer's copy of the room, and it lied once: the checker is installed
 * under the directory the agent works in, but the copy looked one level up and kept nothing. The
 * README promised the app's `check/` and a reviewer opening `room/` got no such directory. These
 * tests pin the layout the copy has to follow.
 */
function fakeRoom(root: string): CleanRoom {
  const work = join(root, 'work')
  const skill = join(work, 'kg')
  mkdirSync(skill, { recursive: true })
  return {
    dir: root,
    work,
    home: join(root, 'home'),
    skill,
    appId: 'health',
    appTitle: 'Health',
    mirrorUrl: 'http://127.0.0.1:1',
    close: async () => {},
  }
}

function withRoom(run: (room: CleanRoom, destination: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'kg-e2e-cleanroom-test-'))
  try {
    run(fakeRoom(root), join(root, 'evidence'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the checker lives inside the directory the agent works in', () => {
  test('both the install path and the keep-room copy use the same directory', () => {
    expect(checkerDir('/tmp/room/work')).toBe('/tmp/room/work/check')
  })

  test('--keep-room keeps the checker from the work directory, not one level up', () => {
    withRoom((room, destination) => {
      // The room as `prepareCleanRoom` lays it out: the agent's `check/` is under `work/`.
      mkdirSync(join(room.work, 'check', 'lib'), { recursive: true })
      writeFileSync(join(room.work, 'check', 'validate.ts'), 'REAL')
      writeFileSync(join(room.work, 'check', 'lib', 'kg-contract.ts'), 'REAL-LIB')
      // A decoy beside the work directory: reading this instead of `work/check` is the bug.
      mkdirSync(join(room.dir, 'check'), { recursive: true })
      writeFileSync(join(room.dir, 'check', 'validate.ts'), 'DECOY')

      keepRoomCopy(room, destination)

      const kept = join(destination, 'check', 'validate.ts')
      expect(existsSync(kept)).toBe(true)
      expect(readFileSync(kept, 'utf8')).toBe('REAL')
      expect(readFileSync(join(destination, 'check', 'lib', 'kg-contract.ts'), 'utf8')).toBe('REAL-LIB')
    })
  })

  test('--keep-room keeps the storage tree and what was installed, and survives a bare room', () => {
    withRoom((room, destination) => {
      mkdirSync(join(room.work, 'storage', 'health'), { recursive: true })
      writeFileSync(join(room.work, 'storage', 'health', 'graph.json'), '{"nodes":[]}')
      mkdirSync(join(room.skill, 'assets'), { recursive: true })
      writeFileSync(join(room.skill, 'assets', 'health.app.json'), '{"id":"health"}')
      writeFileSync(join(room.skill, 'assets', 'health.version'), '1.0.0')

      keepRoomCopy(room, destination)

      expect(existsSync(join(destination, 'storage', 'health', 'graph.json'))).toBe(true)
      expect(existsSync(join(destination, 'health.app.json'))).toBe(true)
      expect(existsSync(join(destination, 'health.version'))).toBe(true)
    })
    withRoom((room, destination) => {
      // No checker, no storage, no assets: the copy is a no-op, not a crash.
      expect(() => keepRoomCopy(room, destination)).not.toThrow()
      expect(existsSync(destination)).toBe(true)
    })
  })
})
