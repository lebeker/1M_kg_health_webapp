import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { e2eBlock, renderCard, shapeProblems, surfacePaths } from './card-template'
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

  test('a card already on the board is read through its own `## surface` section', () => {
    const stamped = `${renderCard(product).replace(/## e2e[\s\S]*?(?=Commit trailer)/, '')}`
    expect(surfacePaths(stamped)).toEqual(['body/index.html', 'src/profile.ts'])
    expect(shapeProblems({ body: stamped, surface: surfacePaths(stamped) ?? [] })).toHaveLength(1)
  })

  test('a body with no surface section is not silently treated as a product card', () => {
    expect(surfacePaths('# a card\n\nsome prose')).toBeNull()
    expect(shapeProblems({ body: '# a card', surface: surfacePaths('# a card') ?? [] })).toHaveLength(0)
  })

  test('the parsed card keeps the mode when a card is marked light', () => {
    const card = parseCard(`${renderCard(product)}\n\ne2e: light\n`, 'T05')
    expect(card.mode).toBe('light')
  })
})
