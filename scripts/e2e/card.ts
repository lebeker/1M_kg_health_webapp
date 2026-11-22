/**
 * The card is the input. Everything the harness runs comes from it — no prompt table, no
 * per-app branch in the code. A card states its own user question in an `## e2e` block:
 *
 *   ## e2e
 *   prompt: show me my last lipid panel
 *   expect: LDL cholesterol, mmol/L
 *
 * `prompt` is one sentence a user would say, written when the card is written and reviewed
 * with it. `expect` is optional; without it the harness still checks that the document
 * renders (title, node/edge counts), but it cannot check the card's own claim.
 *
 * A card marked `e2e: light` runs G2 plus one prompt and no replay. Anything smaller than
 * `M` may be marked that way by the lead (docs/DELIVERY-LOOP.md §3).
 *
 * A card with no prompt is not guessed at. G0 says a card that does not state its own test
 * is blocked, not started; the harness exits 2 and says which block to add.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export type CardMode = 'full' | 'light'

export type Card = {
  /** Task id (`t_…`) or the file the card was read from. */
  id: string
  title: string
  body: string
  mode: CardMode
  prompt: string
  expect: string[]
  source: 'kanban' | 'file'
}

const TASK_ID = /^t_[0-9a-f]{4,}$/i
const JIRA_KEY = /^SCRUM-\d+$/i

function sqliteJson(dbPath: string, sql: string): Array<Record<string, unknown>> {
  const out = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], { encoding: 'utf8' })
  const trimmed = out.trim()
  return trimmed ? (JSON.parse(trimmed) as Array<Record<string, unknown>>) : []
}

function boardDb(): string {
  return process.env.HERMES_KANBAN_DB ?? join(homedir(), '.hermes', 'kanban.db')
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function whereClause(ref: string): string {
  return TASK_ID.test(ref)
    ? `id = ${quote(ref)}`
    : `id = (select id from tasks where title like ${quote(`${ref.toUpperCase()} —%`)} or title like ${quote(`${ref.toUpperCase()} -%`)} limit 1)`
}

function readKanbanCard(ref: string): Card {
  const db = boardDb()
  const rows = sqliteJson(db, `select id, title, body from tasks where ${whereClause(ref)}`)
  const row = rows[0]
  if (!row) {
    throw new Error(`no card '${ref}' on the board at ${db}`)
  }
  return { ...parseCard(String(row.body ?? ''), String(row.title ?? '')), id: String(row.id), source: 'kanban' }
}

/**
 * Where the card sits on the board right now — `running`, `review`, `ready`, … — or `null` for a
 * card that is a file. The harness reads it before it moves anything: a failure reopens a card
 * that is waiting in `review`, and it does not try to move one a live worker is holding.
 */
export function cardStatus(ref: string): string | null {
  if (!TASK_ID.test(ref) && !JIRA_KEY.test(ref)) return null
  const rows = sqliteJson(boardDb(), `select status from tasks where ${whereClause(ref)}`)
  return rows[0] ? String(rows[0].status ?? '') : null
}

function readFileCard(path: string): Card {
  const text = readFileSync(path, 'utf8')
  const heading = text.match(/^#\s+(.+)$/m)
  return { ...parseCard(text, heading ? heading[1].trim() : basename(path)), id: resolve(path), source: 'file' }
}

/**
 * Read one `## e2e` block: `key: value` lines, with `expect:` accepting a comma-separated
 * list or indented `- item` bullets. Everything else on the card is prose.
 */
export function parseE2e(body: string): { mode?: CardMode; prompt?: string; expect: string[] } {
  const result: { mode?: CardMode; prompt?: string; expect: string[] } = { expect: [] }

  const lightMarker = body.match(/^\s*e2e:\s*light\b/im)
  if (lightMarker) result.mode = 'light'

  const lines = body.split('\n')
  const start = lines.findIndex((line) => /^##\s*e2e\s*$/i.test(line.trim()))
  if (start === -1) return result
  const after = lines.findIndex((line, index) => index > start && /^##\s/.test(line))
  const block = lines.slice(start + 1, after === -1 ? lines.length : after)

  let key = ''
  for (const raw of block) {
    const line = raw.trimEnd()
    const heading = line.match(/^\s{0,3}([a-z][\w-]*)\s*:\s*(.*)$/i)
    if (heading) {
      key = heading[1].toLowerCase()
      const value = heading[2].trim()
      if (key === 'prompt' && value) result.prompt = value
      if (key === 'mode' && /^(full|light)$/i.test(value)) result.mode = value.toLowerCase() as CardMode
      if (key === 'expect' && value) {
        result.expect.push(...value.split(',').map((s) => s.trim()).filter(Boolean))
      }
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet && key === 'expect') {
      result.expect.push(bullet[1].trim().replace(/^["']|["']$/g, ''))
    }
  }
  return result
}

export function parseCard(body: string, title: string): { title: string; body: string; mode: CardMode; prompt: string; expect: string[] } {
  const e2e = parseE2e(body)
  return {
    title,
    body,
    mode: e2e.mode ?? 'full',
    prompt: e2e.prompt ?? '',
    expect: e2e.expect,
  }
}

export function readCard(ref: string): Card {
  if (TASK_ID.test(ref) || JIRA_KEY.test(ref)) return readKanbanCard(ref)
  return readFileCard(ref)
}

/** The message for a card that cannot be run, kept in one place so it reads the same everywhere. */
export function missingPromptHelp(card: Card): string {
  return [
    `card ${card.id} ("${card.title}") declares no e2e prompt, so there is nothing to ask a user's question.`,
    'Add this to the card body (G0: the card states its own test):',
    '',
    '  ## e2e',
    '  prompt: <the one sentence a user would say>',
    '  expect: <text that must be visible when it worked>',
    '',
    'Then run the harness again. Nothing was run.',
  ].join('\n')
}
