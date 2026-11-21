import { describe, expect, test } from 'bun:test'
import { validateAgainstSchema } from './json-schema'

/**
 * The contract validator is 200 lines of hand-written JSON Schema, and the fixtures only reach the
 * keywords the health contract happens to use. These are the keywords, asked directly: a bug in
 * here would show up as a health document passing that should not, which is the one failure this
 * whole card exists to prevent.
 */
const messages = (issues: Array<{ message: string }>): string => issues.map((issue) => issue.message).join(' | ')
const paths = (issues: Array<{ path: string }>): string[] => issues.map((issue) => issue.path)

describe('types and values', () => {
  test('a type mismatch is one issue, not a pile of restated ones', () => {
    const issues = validateAgainstSchema('4.9', { type: 'number', minimum: 0, maximum: 10 })
    expect(issues).toHaveLength(1)
    expect(messages(issues)).toContain('must be a number, not "4.9"')
  })

  test('integer means a whole number', () => {
    expect(validateAgainstSchema(1961, { type: 'integer' })).toEqual([])
    expect(validateAgainstSchema(1961.5, { type: 'integer' })).toHaveLength(1)
  })

  test('enum and const name what is there and what was allowed', () => {
    expect(paths(validateAgainstSchema('symptom', { enum: ['condition', 'source'] }))).toEqual(['$'])
    expect(messages(validateAgainstSchema('symptom', { enum: ['condition', 'source'] }))).toBe(
      'must be one of: condition, source',
    )
    expect(messages(validateAgainstSchema('kg/2', { const: 'kg/1' }))).toBe('must be "kg/1", found "kg/2"')
  })

  test('a date is a calendar date, not the shape of one', () => {
    const schema = { type: 'string', format: 'date' }
    expect(validateAgainstSchema('2026-11-12', schema)).toEqual([])
    expect(validateAgainstSchema('2026-02-30', schema)).toHaveLength(1)
    expect(validateAgainstSchema('12.11.2026', schema)).toHaveLength(1)
  })
})

describe('objects and arrays', () => {
  test('required names the property and the path to it', () => {
    const issues = validateAgainstSchema({ id: 'a' }, { required: ['id', 'kind'] })
    expect(paths(issues)).toEqual(['$.kind'])
    expect(messages(issues)).toContain('must have required property "kind"')
  })

  test('additionalProperties false is a closed door, and true is not', () => {
    const closed = { properties: { id: { type: 'string' } }, additionalProperties: false }
    expect(paths(validateAgainstSchema({ id: 'a', extra: 1 }, closed))).toEqual(['$.extra'])
    expect(validateAgainstSchema({ id: 'a', extra: 1 }, { properties: { id: { type: 'string' } } })).toEqual([])
  })

  test('items are checked one by one, with the index in the path', () => {
    const issues = validateAgainstSchema([1, 'two'], { type: 'array', items: { type: 'number' } })
    expect(paths(issues)).toEqual(['$[1]'])
  })

  test('a local $ref is followed', () => {
    const schema = { $defs: { word: { type: 'string', minLength: 1 } }, properties: { name: { $ref: '#/$defs/word' } } }
    expect(paths(validateAgainstSchema({ name: '' }, schema))).toEqual(['$.name'])
  })
})

describe('combinators', () => {
  const kinds = {
    oneOf: [
      { description: 'a thing needs a date', properties: { kind: { const: 'thing' } }, required: ['when'] },
      { description: 'a source is the provenance', properties: { kind: { const: 'source' } }, not: { required: ['source'] } },
    ],
  }

  test('the branch that pins the kind is the one whose reasons are reported', () => {
    const issues = validateAgainstSchema({ kind: 'thing', label: 'x' }, kinds)
    expect(issues).toHaveLength(1)
    expect(paths(issues)).toEqual(['$'])
    expect(messages(issues)).toBe('a thing needs a date — missing "when"')
  })

  test('a value no branch names is left to the property that enumerates it', () => {
    // The kind enum is the caller's statement; repeating "not a thing, not a source" adds nothing.
    expect(validateAgainstSchema({ kind: 'symptom' }, kinds)).toEqual([])
  })

  test('not is reported with the reason the schema gives it', () => {
    const schema = { properties: { kind: { const: 'source' } }, not: { required: ['source'], description: 'it is the provenance' } }
    expect(messages(validateAgainstSchema({ kind: 'source', source: 'x' }, schema))).toBe('it is the provenance')
  })

  test('a keyword this validator does not implement fails the run instead of passing silently', () => {
    const issues = validateAgainstSchema({ a: 1 }, { uniqueItems: true } as Record<string, unknown>)
    expect(messages(issues)).toContain('does not implement')
  })
})
