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

  test('page: names which built page the claim lives on', () => {
    const caseCard = parseCard(['## e2e', 'prompt: what moves my forecast', 'page: case', 'expect: statin'].join('\n'), 'T17 — what moves it')
    expect(caseCard.pages).toEqual(['case'])
    expect(parseCard(['## e2e', 'prompt: p', 'expect: x'].join('\n'), 'T1').pages).toEqual(['graph'])
    expect(parseCard(['## e2e', 'prompt: p', 'page: both', 'expect: x'].join('\n'), 'T1').pages).toEqual(['case', 'graph'])
    expect(parseCard(['## e2e', 'prompt: p', 'page: graph', 'expect: x'].join('\n'), 'T1').pages).toEqual(['graph'])
  })

  test('a page nobody has is refused, not quietly turned back into the graph page', () => {
    // The whole point of the field: a typo must not fall back to the page the harness used to
    // capture, or the card would get a receipt for something it never claimed.
    expect(() => parseE2e(['## e2e', 'prompt: p', 'page: colums', 'expect: x'].join('\n'))).toThrow(/not a page/)
    expect(() => parseE2e(['## e2e', 'prompt: p', 'page: ,', 'expect: x'].join('\n'))).toThrow(/names no page/)
  })

  test('pages are listed in a stable order, so a report reads the same twice', () => {
    expect(parseE2e(['## e2e', 'prompt: p', 'page: graph+case', 'expect: x'].join('\n')).pages).toEqual(['case', 'graph'])
  })
})
