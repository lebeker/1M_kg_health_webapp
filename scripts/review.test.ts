import { describe, expect, test } from 'bun:test'
import { judge, parseVerdict } from './lib/review'

const good = {
  reviewer: 'Denis',
  when: '2026-11-23T19:00:00Z',
  passed: true,
  conclusions: 'three columns, all collapsed, summary reads as a story',
  surface: 'abc123',
  artifacts: [],
}

describe('parseVerdict', () => {
  test('accepts a complete verdict', () => {
    const parsed = parseVerdict(JSON.stringify(good))
    expect(typeof parsed).toBe('object')
    if (typeof parsed !== 'string') expect(parsed.passed).toBe(true)
  })

  test('refuses an empty conclusion: a verdict has to say something', () => {
    const parsed = parseVerdict(JSON.stringify({ ...good, conclusions: 'ok' }))
    expect(typeof parsed).toBe('string')
  })

  test('refuses a verdict without a boolean', () => {
    const parsed = parseVerdict(JSON.stringify({ ...good, passed: 'yes' }))
    expect(typeof parsed).toBe('string')
  })

  test('refuses text that is not JSON', () => {
    expect(typeof parseVerdict('passed')).toBe('string')
  })
})

describe('judge', () => {
  test('green when it passes and covers this surface', () => {
    const result = judge({ ...good, artifacts: [] }, 'abc123', () => true)
    expect(result.ok).toBe(true)
  })

  test('red when the page moved since the review', () => {
    const result = judge({ ...good, surface: 'old999' }, 'abc123', () => true)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('changed since it was reviewed')
  })

  test('red when the reviewer failed it, and it says why', () => {
    const result = judge({ ...good, passed: false }, 'abc123', () => true)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('the reviewer failed this page')
  })

  test('red when a named artifact is not there', () => {
    const result = judge({ ...good, artifacts: ['review/artifacts/page.png'] }, 'abc123', () => false)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not there')
  })
})
