import { describe, expect, test } from 'bun:test'
import { missingPromptHelp, parseCard, parseE2e } from './card'

describe('the e2e block on a card', () => {
  test('reads the prompt and the expected text', () => {
    const card = parseCard(
      ['Body prose.', '', '## e2e', 'prompt: show me my last lipid panel', 'expect: LDL cholesterol, mmol/L', '', '## Size', 'M'].join('\n'),
      'T10 — State-at-date panel',
    )
    expect(card.prompt).toBe('show me my last lipid panel')
    expect(card.expect).toEqual(['LDL cholesterol', 'mmol/L'])
    expect(card.mode).toBe('full')
  })

  test('accepts bullets under expect', () => {
    const e2e = parseE2e(['## e2e', 'prompt: what is my ten-year risk', 'expect:', '  - ten-year risk', '  - SCORE2'].join('\n'))
    expect(e2e.expect).toEqual(['ten-year risk', 'SCORE2'])
  })

  test('e2e: light is a mode, not a prompt', () => {
    const e2e = parseE2e(['e2e: light', '', '## e2e', 'prompt: show me the year summary'].join('\n'))
    expect(e2e.mode).toBe('light')
    expect(e2e.prompt).toBe('show me the year summary')
  })

  test('a card with no block has no prompt, and says how to add one', () => {
    const card = parseCard('Nothing here.', 'T21 — Demo case')
    expect(card.prompt).toBe('')
    expect(card.expect).toEqual([])
    expect(missingPromptHelp({ ...card, id: 't_1', source: 'kanban' })).toContain('## e2e')
  })

  test('a heading that merely starts with e2e is not the block', () => {
    const e2e = parseE2e(['## e2e notes', 'prompt: nope'].join('\n'))
    expect(e2e.prompt).toBeUndefined()
  })
})
