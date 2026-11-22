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
import { type PageKind, readCard } from './e2e/card'
import { appSurface, pagesFor } from './e2e/gate'

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

/**
 * The `page:` line a stamped block needs, or `''` when it need none.
 *
 * The harness reads an absent field as `graph`, which is the page a receipt has always been
 * evidence of — so a graph-only card keeps the block it has always had, byte for byte. A card
 * whose paths move the columns page has to say so, because a stamped `body/` card used to ask
 * for the graph page and fail on its own claim with nothing but CI's refusal to explain it.
 */
function pageLine(pages: PageKind[]): string {
  if (!pages.includes('case')) return ''
  return `page: ${pages.includes('graph') ? 'both' : 'case'}`
}

/** The block the harness reads, and the one a reviewer reads the claim from. */
export function e2eBlock(e2e: { prompt: string; expect: string[] }, pages: PageKind[] = []): string {
  return ['## e2e', pageLine(pages), `prompt: ${e2e.prompt}`, `expect: ${e2e.expect.join(', ')}`].filter((line) => line !== '').join('\n')
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
  if (surface.length > 0) sections.push(e2eBlock(draft.e2e, pagesFor(draft.paths)))
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
 * section of a body that already exists. Three states, and the difference matters:
 * an array with surface paths is a product card, an empty array is a card that says it is not,
 * and `null` is a card that never said. `null` is a problem, not an exemption — reading silence as
 * "touches no surface" is how every card on the board came back "fine" while none of them was
 * checked (review round 2, defect 1).
 */
export function shapeProblems(input: { body: string; surface: string[] | null }): ShapeProblem[] {
  const problems: ShapeProblem[] = []
  if (input.surface === null) {
    problems.push({ problem: 'carries no `## surface` section, so whether it is a product card is unchecked — it has to name the paths it changes before it can be called exempt' })
  }
  const surface = input.surface ?? []
  const product = appSurface(surface).length > 0
  if (product && !hasE2eBlock(input.body)) {
    problems.push({ problem: `it changes ${surface.join(', ')}, so it needs a \`## e2e\` block with a user's question` })
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

/** A `## surface` section built from the paths the caller says the card will change. */
export function surfaceSection(paths: string[]): string {
  return ['## surface', ...appSurface(paths).map((hit) => `- ${hit.path} — ${hit.area}`)].join('\n')
}

/** Put a block after a `## <name>` section, so a stamped card reads in the same order as a rendered one. */
function insertAfterSection(body: string, name: string, chunk: string): string {
  const heading = new RegExp(`^##\\s*${name}\\s*$`, 'im').exec(body)
  if (!heading) return `${body.trimEnd()}\n\n${chunk}\n`
  const start = heading.index + heading[0].length
  const next = /^##\s/m.exec(body.slice(start))
  // The section runs to the next `## ` heading or the end of the body; everything in it stays.
  const at = next ? start + next.index : body.length
  const head = body.slice(0, at).trimEnd()
  const tail = next ? `\n\n${body.slice(at).trimStart()}` : ''
  return `${head}\n\n${chunk}${tail}\n`
}

/**
 * The stamped body: the `## e2e` block, and — when the card never said what it touches — the
 * `## surface` section the check reads. A card cannot be stamped exempt by silence, so `--path`
 * is required in exactly that case, and refused when none of the paths is app surface: then the
 * card is genuinely not a product card and needs no block at all.
 */
export function stampBody(body: string, e2e: { prompt: string; expect: string[] }, paths: string[]): string {
  if (/^##\s*e2e\s*$/im.test(body)) throw new Error('it already carries an `## e2e` block; edit it instead of stamping a second one')
  const declared = surfacePaths(body)
  // The pages come from what the card says it touches — its own `## surface` section when it has
  // one, the `--path` list when it does not. Stamping a `body/` card without `page: case` asks
  // the harness for the graph page, which is the mismatch the field exists to prevent.
  const block = e2eBlock(e2e, pagesFor(declared ?? paths))
  if (declared !== null) return insertAfterSection(body, 'surface', block)
  const surface = appSurface(paths)
  if (surface.length === 0) {
    throw new Error(
      paths.length === 0
        ? 'it carries no `## surface` section: pass --path for each file it will change, so the card says what it touches instead of leaving the question unchecked'
        : `none of ${paths.join(', ')} is app surface, so the card needs no \`## surface\` or \`## e2e\` block — stamp nothing`,
    )
  }
  return `${body.trimEnd()}\n\n${surfaceSection(paths)}\n\n${block}\n`
}

function stamp(cardId: string, e2e: { prompt: string; expect: string[] }, paths: string[]): string {
  const card = readCard(cardId)
  board(['edit', card.id, '--body', stampBody(card.body, e2e, paths)])
  return card.id
}

function printHelp(to: (line: string) => void = console.log) {
  to(`usage: bun scripts/card-template.ts [options]

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
  bun scripts/card-template.ts --stamp <task-id> --prompt "..." --expect "..." [--path <path>...]

--check exits 0 only when the card's own \`## surface\` section says what it touches and the answer
is complete: a product card with a question, or a card that names no product path. A card with no
\`## surface\` section at all is exit 2 — silence is not an exemption — and --stamp writes the
section, which is why --path is required when the card has none.

A product card with no user question is refused, so the card that runs no e2e is the card that
does not exist.`)
}

export type CardIo = { out: (line: string) => void; err: (line: string) => void }

const CONSOLE_IO: CardIo = { out: (line) => console.log(line), err: (line) => console.error(line) }

export function main(argv: string[], io: CardIo = CONSOLE_IO): number {
  try {
    return run(argv, io)
  } catch (error) {
    // One sentence, no stack: a refusal is an answer, not a crash.
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function run(argv: string[], io: CardIo): number {
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
        printHelp(io.out)
        return 0
      default:
        throw new Error(`unknown argument ${arg}`)
    }
  }

  if (check) {
    const card = readCard(check)
    // The section, exactly as the card states it: `null` is a card that never said what it
    // touches, and that is a problem, not an exemption (it used to answer "fine — touches no
    // surface" for every card on the board, which carried no section at all).
    const problems = shapeProblems({ body: card.body, surface: surfacePaths(card.body) })
    if (problems.length === 0) {
      io.out(`${card.id}: fine — ${card.prompt ? 'carries its own question' : 'its `## surface` section names no product path, so it runs no e2e'}`)
      return 0
    }
    for (const problem of problems) io.err(`${card.id}: ${problem.problem}`)
    io.err('  fix it: bun scripts/card-template.ts --stamp <task-id> --prompt "..." --expect "..." [--path <path it changes>]')
    return 2
  }

  if (stampId) {
    if (!draft.e2e.prompt || draft.e2e.expect.length === 0) {
      io.err('--stamp needs --prompt and at least one --expect')
      return 2
    }
    io.out(stamp(stampId, draft.e2e, draft.paths))
    return 0
  }

  if (!draft.jira || !draft.title) {
    printHelp(io.out)
    return 1
  }
  const body = renderCard(draft)
  const problems = shapeProblems({ body, surface: draft.paths })
  if (problems.length > 0) {
    for (const problem of problems) io.err(`refused: ${problem.problem}`)
    return 2
  }
  if (json) {
    io.out(JSON.stringify({ body, surface: appSurface(draft.paths) }, null, 2))
    return 0
  }
  if (!create) {
    process.stdout.write(body)
    return 0
  }
  const file = join(mkdtempSync(join(tmpdir(), 'card-create-')), 'body.md')
  writeFileSync(file, body)
  io.out(board(['create', draft.title, '--body-file', file, '--assignee', assignee, '--completion-contract', 'local-only']))
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
