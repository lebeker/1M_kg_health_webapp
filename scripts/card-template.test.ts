import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { e2eBlock, main, renderCard, shapeProblems, stampBody, surfacePaths } from './card-template'
import { parseCard, readCard } from './e2e/card'

const product = {
  jira: 'SCRUM-16',
  title: 'T05 — Profile',
  acceptance: '`year_of_birth`, `sex`, optional `name` in `kg.json`; controls read the profile',
  paths: ['body/index.html', 'src/profile.ts'],
  e2e: { prompt: 'who is this record about, and how old are they', expect: ['Andrei', 'age 65'] },
}

describe('a product card carries its own question, before anybody writes prose', () => {
  test('the rendered body has the surface list and the e2e block the harness reads', () => {
    const body = renderCard(product)
    expect(body).toContain('## surface')
    expect(body).toContain('- body/index.html — the page: header, timeline, columns, centre, right panel')
    expect(body).toContain('## e2e')
    expect(body).toContain('Commit trailer: `Task: SCRUM-16`.')
    expect(surfacePaths(body)).toEqual(['body/index.html', 'src/profile.ts'])
  })

  test('the harness reads the prompt and the expected text straight back out of it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'card-template-test-'))
    const path = join(dir, 'card.md')
    writeFileSync(path, renderCard(product))
    const card = readCard(path)
    expect(card.prompt).toBe(product.e2e.prompt)
    expect(card.expect).toEqual(['Andrei', 'age 65'])
    expect(card.mode).toBe('full')
  })

  test('a card that touches no surface gets no e2e block and is not asked for one', () => {
    const body = renderCard({ ...product, paths: ['docs/WIDGETS.md', 'scripts/e2e/run.ts'] })
    expect(body).not.toContain('## e2e')
    expect(body).toContain('- none: this card does not touch the product')
    expect(shapeProblems({ body, surface: [] })).toHaveLength(0)
  })

  test('a product card with no user question is refused, and the refusal names the paths', () => {
    const body = renderCard({ ...product, paths: ['body/index.html'] })
    const withoutBlock = body.replace(/## e2e[\s\S]*?(?=Commit trailer)/, '')
    const problems = shapeProblems({ body: withoutBlock, surface: ['body/index.html'] })
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toContain('body/index.html')
    expect(problems[0].problem).toContain('## e2e')
  })

  test('an e2e block with a prompt but no expect is refused: the claim has to be checkable', () => {
    const body = renderCard({ ...product, e2e: { prompt: 'show me my profile', expect: [] } })
    const problems = shapeProblems({ body, surface: ['body/index.html'] })
    expect(problems.map((problem) => problem.problem).join(' ')).toContain('expect')
  })

  test('the block is one shape wherever it is written', () => {
    expect(e2eBlock({ prompt: 'show me my last lipid panel', expect: ['LDL cholesterol'] })).toBe(
      ['## e2e', 'prompt: show me my last lipid panel', 'expect: LDL cholesterol'].join('\n'),
    )
  })

  test('a columns-page card says `page: case`, so the harness opens the page the claim lives on', () => {
    const body = renderCard({ ...product, paths: ['body/index.html'] })
    expect(body).toContain('page: case')
    const card = readCard(cardFile(body))
    expect(card.pages).toEqual(['case'])
  })

  test('a card that moves both pages says `page: both`', () => {
    const body = renderCard(product)
    expect(body).toContain('page: both')
    expect(readCard(cardFile(body)).pages).toEqual(['case', 'graph'])
  })

  test('a graph-only card keeps the block it has always had: no `page:` line', () => {
    const body = renderCard({ ...product, paths: ['src/App.tsx'] })
    expect(body).not.toContain('page:')
    expect(readCard(cardFile(body)).pages).toEqual(['graph'])
  })

  test('a card already on the board is read through its own `## surface` section', () => {
    const stamped = `${renderCard(product).replace(/## e2e[\s\S]*?(?=Commit trailer)/, '')}`
    expect(surfacePaths(stamped)).toEqual(['body/index.html', 'src/profile.ts'])
    expect(shapeProblems({ body: stamped, surface: surfacePaths(stamped) ?? [] })).toHaveLength(1)
  })

  test('a body with no surface section is an unchecked card, not an exempt one', () => {
    expect(surfacePaths('# a card\n\nsome prose')).toBeNull()
    const problems = shapeProblems({ body: '# a card', surface: surfacePaths('# a card') })
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toContain('## surface')
    expect(problems[0].problem).toContain('unchecked')
    // A card that has said it touches nothing is still exempt: the section is the answer, and
    // an empty list is an answer whereas `null` is silence.
    expect(shapeProblems({ body: '# a card', surface: [] })).toHaveLength(0)
  })

  test('the parsed card keeps the mode when a card is marked light', () => {
    const card = parseCard(`${renderCard(product)}\n\ne2e: light\n`, 'T05')
    expect(card.mode).toBe('light')
  })
})

/** Run the CLI with its output captured, so a test reads what a person would read. */
function cli(argv: string[]): { code: number; stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  const code = main(argv, { out: (line) => stdout.push(line), err: (line) => stderr.push(line) })
  return { code, stdout, stderr }
}

/** A card as a file, which `readCard` accepts wherever it accepts a task id. */
function cardFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'card-template-cli-'))
  const path = join(dir, 'card.md')
  writeFileSync(path, body)
  return path
}

/** A card written before this template existed: prose, no `## surface`, no `## e2e`. */
const bare = '# T07 — Date-addressable timeline\n\nput the timeline on a date, not a scroll order\n'

describe('--check answers for the card on the board, not for the template', () => {
  test('a card carrying no `## surface` section is unchecked: exit 2, not "fine"', () => {
    const result = cli(['--check', cardFile(bare)])
    expect(result.code).toBe(2)
    expect(result.stdout).toEqual([])
    expect(result.stderr.join('\n')).toContain('## surface')
    expect(result.stderr.join('\n')).toContain('unchecked')
    expect(result.stderr.join('\n')).toContain('--stamp')
  })

  test('a card whose section names no product path is fine, and says which answer it gave', () => {
    const result = cli(['--check', cardFile(renderCard({ ...product, paths: ['docs/WIDGETS.md'] }))])
    expect(result.code).toBe(0)
    expect(result.stdout.join('\n')).toContain('fine')
    expect(result.stdout.join('\n')).toContain('names no product path')
  })

  test('a product card with no e2e block is exit 2 and names the paths it changes', () => {
    const body = renderCard({ ...product, paths: ['body/index.html'] }).replace(/## e2e[\s\S]*?(?=Commit trailer)/, '')
    const result = cli(['--check', cardFile(body)])
    expect(result.code).toBe(2)
    expect(result.stderr.join('\n')).toContain('body/index.html')
    expect(result.stderr.join('\n')).toContain('## e2e')
  })

  test('the same card passes once the block is there', () => {
    const result = cli(['--check', cardFile(renderCard(product))])
    expect(result.code).toBe(0)
    expect(result.stdout.join('\n')).toContain('carries its own question')
  })
})

describe('--stamp writes what --check reads, so a stamped card is not unchecked', () => {
  const e2e = { prompt: 'who is this record about, and how old are they', expect: ['age 65'] }

  test('a card with no surface section gets the section from --path, before the block', () => {
    const body = stampBody(bare, e2e, ['body/index.html', 'docs/PLAN.md'])
    expect(surfacePaths(body)).toEqual(['body/index.html'])
    expect(body.indexOf('## surface')).toBeLessThan(body.indexOf('## e2e'))
    expect(shapeProblems({ body, surface: surfacePaths(body) })).toHaveLength(0)
    expect(body).toContain('put the timeline on a date')
  })

  test('with no --path it refuses: silence cannot be stamped into an exemption', () => {
    expect(() => stampBody(bare, e2e, [])).toThrow(/--path/)
  })

  test('with paths that are not app surface it refuses to write a product block at all', () => {
    expect(() => stampBody(bare, e2e, ['docs/PLAN.md'])).toThrow(/needs no|not app surface/)
  })

  test('a card that already has a section keeps it and gets the block after it', () => {
    const body = stampBody(renderCard({ ...product, paths: ['body/index.html'] }).replace(/## e2e[\s\S]*?(?=Commit trailer)/, ''), e2e, [])
    expect(surfacePaths(body)).toEqual(['body/index.html'])
    expect(body.indexOf('## surface')).toBeLessThan(body.indexOf('## e2e'))
    expect(body).toContain('Commit trailer: `Task: SCRUM-16`.')
  })

  test('stamping a card that already carries a block is refused instead of doubling it', () => {
    expect(() => stampBody(renderCard(product), e2e, ['body/index.html'])).toThrow(/already carries/)
  })

  test('a stamped columns-page card asks for the columns page, not the graph default', () => {
    // The stamping tool wrote `prompt:` and `expect:` only, and since the page field existed an
    // absent `page:` means the graph page — so a stamped body/ card asked for a page its change
    // is not on and failed its own claim with nothing but CI's refusal to explain why.
    const fresh = stampBody(bare, e2e, ['body/index.html'])
    expect(fresh).toContain('page: case')
    expect(readCard(cardFile(fresh)).pages).toEqual(['case'])
    // When the card already names what it touches, the pages come from that section, not from
    // a --path list the caller may not have repeated.
    const declared = renderCard({ ...product, paths: ['body/index.html'] }).replace(/## e2e[\s\S]*?(?=Commit trailer)/, '')
    const kept = stampBody(declared, e2e, [])
    expect(kept).toContain('page: case')
    expect(readCard(cardFile(kept)).pages).toEqual(['case'])
    // And a graph-only card is stamped exactly as it was before the field existed.
    const graph = stampBody(bare, e2e, ['src/App.tsx'])
    expect(graph).not.toContain('page:')
    expect(readCard(cardFile(graph)).pages).toEqual(['graph'])
  })

  test('--stamp without a prompt is exit 2 before anything is written', () => {
    const result = cli(['--stamp', 't_00000000', '--path', 'body/index.html'])
    expect(result.code).toBe(2)
    expect(result.stderr.join('\n')).toContain('--prompt')
  })
})
