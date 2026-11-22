/**
 * How a property reads as text, wherever the page prints one.
 *
 * The rule this holds: no value a document can carry renders as `[object Object]`. The connection
 * rows used to stringify their extras, which was safe only while `toKg` dropped objects — once a
 * relation's nested value reached the page, that row had a way to print one (T05 review).
 *
 *   bun test src/value.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { valueText } from './value'

describe('a value as text', () => {
  test('an interval date reads as the span it is', () => {
    expect(valueText({ from: '2021-05-14', to: null })).toBe('2021-05-14 → now')
    expect(valueText({ from: '2021-05-14', to: '2024-01-01' })).toBe('2021-05-14 → 2024-01-01')
  })

  test('any other object keeps its own shape instead of being flattened', () => {
    expect(valueText({ value: 4.9, unit: 'mmol/L' })).toBe('{"value":4.9,"unit":"mmol/L"}')
  })

  test('a list joins the way the panel joins one', () => {
    expect(valueText(['ldl', 'hdl'])).toBe('ldl · hdl')
    // Its members are values in their own right — joining them raw is how a list of objects
    // becomes `[object Object]`.
    expect(valueText([{ from: '2021-05-14', to: null }])).toBe('2021-05-14 → now')
    expect(valueText([{ value: 4.9 }])).toBe('{"value":4.9}')
  })

  test('a scalar is itself', () => {
    expect(valueText('2026-11-12')).toBe('2026-11-12')
    expect(valueText(4.9)).toBe('4.9')
    expect(valueText(0)).toBe('0')
    expect(valueText(false)).toBe('false')
  })

  test('no shape a document can carry renders as [object Object]', () => {
    const shapes: unknown[] = [
      { from: '2021-05-14', to: null },
      { from: '2021-05-14', to: '2024-01-01' },
      { value: 4.9, unit: 'mmol/L' },
      { when: { from: '2021-05-14', to: null } },
      {},
      [{}],
      [{ a: 1 }, 'b'],
      [[1, 2]],
    ]
    for (const v of shapes) expect(valueText(v)).not.toContain('[object Object]')
  })
})
