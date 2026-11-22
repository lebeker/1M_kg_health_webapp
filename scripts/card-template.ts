#!/usr/bin/env bun
/**
 * The card template: the machine-readable half of "every product card runs e2e".
 *
 * The gate was optional for as long as "this card touches the product" was a sentence in a body
 * somebody wrote. It is not a sentence any more — it is the list of paths the card says it will
 * touch, run through `appSurface()` before the card exists and again in CI against the actual
 * diff. A card that names app-surface paths and carries no user question is refused here rather
 * than discovered later: G0 says a card that does not state its own test is blocked, not started,
 * and the harness would exit 2 on it anyway.
 *
 * `--check` is the same question asked of a card already on the board, for the ones written
 * before this template existed; `--stamp` puts the block in, so the fix is one command and not a
 * paragraph of prose in a comment.
 *
 * A card that touches no surface is ordinary: it gets a body, no e2e block, and CI never asks it
 * for a receipt, because its diff does not move the product.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCard } from './e2e/card'
import { appSurface } from './e2e/gate'

export type CardDraft = {
  jira: string
  title: string
  acceptance: string
  /** The paths the card expects to change. This, not the prose, decides whether it needs e2e. */
  paths: string[]
  e2e: { prompt: string; expect: string[] }
  size?: string
  dependsOn?: string[]
  plan?: string
}

/** The block the harness reads, and the one a reviewer reads the claim from. */
export function e2eBlock(e2e: { prompt: string; expect: string[] }): string {
  return ['## e2e', `prompt: ${e2e.prompt}`, `expect: ${e2e.expect.join(', ')}`].join('\n')
}

/** The card body, in the shape the board and the harness both understand. */
export function renderCard(draft: CardDraft): string {
  const surface = appSurface(draft.paths)
  const sections: string[] = [
    [draft.plan ? `Jira: ${draft.jira}` : `Jira: ${draft.jira}`, draft.plan ? `Plan: ${draft.plan}` : ''].filter(Boolean).join('  —  '),
    draft.acceptance.trim(),
    [
      '## surface',
      ...(surface.length > 0 ? surface.map((hit) => `- ${hit.path} — ${hit.area}`) : ['- none: this card does not touch the product, so it runs no e2e']),
    ].join('\n'),
  ]
  if (surface.length > 0) sections.push(e2eBlock(draft.e2e))
  if (draft.dependsOn && draft.dependsOn.length > 0) sections.push(['## Depends on', ...draft.dependsOn.map((dep) => `- ${dep}`)].join('\n'))
  if (draft.size) sections.push(['## Size', draft.size].join('\n'))
  sections.push(`Commit trailer: \`Task: ${draft.jira}\`.`)
  return `${sections.join('\n\n')}\n`
}

export type ShapeProblem = { problem: string }

/** The `## surface` section of a body, as the paths it names. */
export function surfacePaths(body: string): string[] | null {
  const match = body.match(/^##\s*surface\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/m)
  if (!match) return null
  return match[1]
    .split('\n')
    .map((line) => line.match(/^\s*[-*]\s+(\S+)/)?.[1] ?? '')
    .filter((path) => path !== '' && !path.startsWith('none'))
}

function hasE2eBlock(body: string): boolean {
  return /^##[ \t]*e2e[ \t]*$/im.test(body) && /^[ \t]*prompt[ \t]*:[ \t]*\S/im.test(body)
}

function hasExpect(body: string): boolean {
  return /^[ \t]*expect[ \t]*:[ \t]*\S/im.test(body)
}

/**
 * What is wrong with this card, if anything — the same answer for a draft and for a card already
 * on the board, so "a product card without a user question" has one definition.
 *
 * `surface` is what the caller knows about the paths: the draft's own list, or the `## surface`
 * section of a body that already exists. When it is empty the card is not a product card and
 * only the block/expect pair is checked for consistency.
 */
export function shapeProblems(input: { body: string; surface: string[] }): ShapeProblem[] {
  const problems: ShapeProblem[] = []
  const product = appSurface(input.surface).length > 0
  if (product && !hasE2eBlock(input.body)) {
    problems.push({ problem: `it changes ${input.surface.join(', ')}, so it needs a \`## e2e\` block with a user's question` })
  }
  if (hasE2eBlock(input.body) && !hasExpect(input.body)) {
    problems.push({ problem: 'its `## e2e` block states no `expect:` text, so the run cannot check the card\'s own claim' })
  }
  return problems
}

function board(args: string[]): string {
  const env = { ...process.env }
  delete env.HERMES_KANBAN_TASK
  return execFileSync('hermes', ['kanban', ...args], { encoding: 'utf8', env }).trim()
}

function stamp(cardId: string, e2e: { prompt: string; expect: string[] }): string {
  const card = readCard(cardId)
  if (/^##\s*e2e\s*$/im.test(card.body)) throw new Error(`${card.id} already carries an \`## e2e\` block; edit it instead of stamping a second one`)
  const block = e2eBlock(e2e)
  const body = card.body.includes('## surface')
    ? card.body.replace(/(^##\s*surface\s*$[\s\S]*?)(?=^##\s)/m, `$1\n${block}\n\n`)
    : `${card.body.trimEnd()}\n\n${block}\n`
  board(['edit', card.id, '--body', body])
  return card.id
}

function printHelp() {
  console.log(`usage: bun scripts/card-template.ts [options]

  --jira <KEY>          Jira key, e.g. SCRUM-16
  --title <text>        card title
  --acceptance <text>   the card's own acceptance, verbatim from the plan
  --path <path>         a path the card will change (repeatable) — this, not prose, decides e2e
  --prompt <text>       one sentence a user would say (required when a path is app surface)
  --expect <text>       text that must be visible when it worked (repeatable)
  --size <S|M|L>        optional
  --depends <id>        optional, repeatable
  --json                print the body and the surface decision as JSON
  --create [--assignee <profile>]   create the card on the board (refuses a product card with no prompt)

  bun scripts/card-template.ts --check <task-id>    does this card still carry its claim?
  bun scripts/card-template.ts --stamp <task-id> --prompt "..." --expect "..."

A product card with no user question is refused, so the card that runs no e2e is the card that
does not exist.`)
}

function main(argv: string[]): number {
  const draft: CardDraft = { jira: '', title: '', acceptance: '', paths: [], e2e: { prompt: '', expect: [] } }
  let json = false
  let create = false
  let assignee = 'mex'
  let check = ''
  let stampId = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      const value = argv[i]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      return value
    }
    switch (arg) {
      case '--jira':
        draft.jira = next()
        break
      case '--title':
        draft.title = next()
        break
      case '--acceptance':
        draft.acceptance = next()
        break
      case '--path':
        draft.paths.push(next())
        break
      case '--prompt':
        draft.e2e.prompt = next()
        break
      case '--expect':
        draft.e2e.expect.push(next())
        break
      case '--size':
        draft.size = next()
        break
      case '--depends':
        draft.dependsOn = [...(draft.dependsOn ?? []), next()]
        break
      case '--json':
        json = true
        break
      case '--create':
        create = true
        break
      case '--assignee':
        assignee = next()
        break
      case '--check':
        check = next()
        break
      case '--stamp':
        stampId = next()
        break
      case '--help':
      case '-h':
        printHelp()
        return 0
      default:
        throw new Error(`unknown argument ${arg}`)
    }
  }

  if (check) {
    const card = readCard(check)
    const problems = shapeProblems({ body: card.body, surface: surfacePaths(card.body) ?? [] })
    if (problems.length === 0) {
      console.log(`${card.id}: fine — ${card.prompt ? 'carries its own question' : 'touches no surface'}`)
      return 0
    }
    for (const problem of problems) console.error(`${card.id}: ${problem.problem}`)
    console.error('  fix it: bun scripts/card-template.ts --stamp <task-id> --prompt "..." --expect "..."')
    return 2
  }

  if (stampId) {
    if (!draft.e2e.prompt || draft.e2e.expect.length === 0) {
      console.error('--stamp needs --prompt and at least one --expect')
      return 2
    }
    console.log(stamp(stampId, draft.e2e))
    return 0
  }

  if (!draft.jira || !draft.title) {
    printHelp()
    return 1
  }
  const body = renderCard(draft)
  const problems = shapeProblems({ body, surface: draft.paths })
  if (problems.length > 0) {
    for (const problem of problems) console.error(`refused: ${problem.problem}`)
    return 2
  }
  if (json) {
    console.log(JSON.stringify({ body, surface: appSurface(draft.paths) }, null, 2))
    return 0
  }
  if (!create) {
    process.stdout.write(body)
    return 0
  }
  const file = join(mkdtempSync(join(tmpdir(), 'card-create-')), 'body.md')
  writeFileSync(file, body)
  console.log(board(['create', draft.title, '--body-file', file, '--assignee', assignee, '--completion-contract', 'local-only']))
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
