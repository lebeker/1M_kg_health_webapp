import { describe, expect, test } from 'bun:test'
import { ROOM_RULES } from './cleanroom'
import type { ToolCall } from './hermes'
import { hostAppCalls, outsideRoomCalls } from './policy'

const call = (name: string, input: Record<string, unknown>): ToolCall => ({ name, input, output: '', isError: false })

describe('the room rules state the boundary, not just the task', () => {
  test('names every directory the agent may not search', () => {
    for (const needle of ['Stay inside this directory', 'find /', 'ls /', '/Volumes', '/System', '/Applications', '/Users', 'mdfind', 'diskutil']) {
      expect(ROOM_RULES).toContain(needle)
    }
  })

  test('says where the app, its checker and the output live, all inside the directory', () => {
    for (const needle of ['./kg', 'kg/scripts/kg.py', './check/validate.ts', './storage/']) {
      expect(ROOM_RULES).toContain(needle)
    }
    expect(ROOM_RULES).not.toContain('../kg')
  })
})

describe('the guard that makes the boundary true', () => {
  test('fails a search from the root', () => {
    const calls = [call('terminal', { command: 'find / -name "validate.ts" -maxdepth 6 2>/dev/null | head' })]
    expect(outsideRoomCalls(calls)).toHaveLength(1)
    expect(outsideRoomCalls(calls)[0]).toContain('filesystem root')
  })

  test('fails a listing of the root, a Spotlight search and a disk query', () => {
    expect(outsideRoomCalls([call('terminal', { command: 'ls -la /' })])).toHaveLength(1)
    expect(outsideRoomCalls([call('terminal', { command: 'mdfind -name kg-contract' })])).toHaveLength(1)
    expect(outsideRoomCalls([call('terminal', { command: 'diskutil list' })])).toHaveLength(1)
  })

  test('fails a walk of the mounted volumes or a home directory outside the room', () => {
    expect(outsideRoomCalls([call('terminal', { command: 'ls /Volumes' })])).toHaveLength(1)
    expect(outsideRoomCalls([call('terminal', { command: 'find /Users/denistatarenko -name graph.json' })])).toHaveLength(1)
    expect(outsideRoomCalls([call('terminal', { command: 'find ~ -maxdepth 3 -name "kg.py"' })])).toHaveLength(1)
    expect(outsideRoomCalls([call('terminal', { command: 'find ../.. -name "*.json"' })])).toHaveLength(1)
  })

  test('reads a file outside the room as an escape too, not only a search', () => {
    expect(outsideRoomCalls([call('read_file', { path: '/Users/denistatarenko/.hermes/kanban.db' })])).toHaveLength(1)
    expect(outsideRoomCalls([call('read_file', { path: '/Applications/Google Chrome.app/Contents/Info.plist' })])).toHaveLength(1)
  })

  test('leaves the work the room asks for alone', () => {
    const allowed = [
      call('terminal', { command: 'python3 kg/scripts/kg.py --help' }),
      call('terminal', { command: 'bun check/validate.ts storage/synthetic/graph.json' }),
      call('terminal', { command: 'cd /var/folders/wj/9sk4v59j2pn2xt6xszpqnn0c0000gn/T/kg-e2e-room-x/work && ls storage' }),
      call('terminal', { command: 'grep -rn "confirmed" kg/scripts/kg.py' }),
      call('read_file', { path: 'check/validate.ts' }),
      call('terminal', { command: 'find . -name "*.json"' }),
    ]
    expect(outsideRoomCalls(allowed)).toEqual([])
  })
})

describe('the host-application guard still holds', () => {
  test('fails a child that starts its own browser', () => {
    expect(hostAppCalls([call('terminal', { command: 'open -a "Google Chrome" http://x' })])).toHaveLength(1)
    expect(hostAppCalls([call('terminal', { command: 'osascript -e "tell app Safari to activate"' })])).toHaveLength(1)
    expect(hostAppCalls([call('terminal', { command: 'npx playwright test' })])).toHaveLength(1)
  })

  test('leaves the browser tools alone', () => {
    expect(hostAppCalls([call('browser_navigate', { url: 'file:///tmp/page.html' })])).toEqual([])
  })
})
