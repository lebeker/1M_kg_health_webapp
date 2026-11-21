/**
 * The rules engine's contract, held as properties rather than as examples.
 *
 * The three promises the card makes, and the failure each test exists for:
 *
 *   1. a rule without `source` does not load — a rule that cannot cite itself never moves a
 *      number, and it is refused loudly rather than dropped, because a silently smaller rule set
 *      computes a different estimate that nobody was told about;
 *   2. the same input gives the same output — same facts, same number, and a reordered JSON file
 *      cannot move a floating-point sum;
 *   3. the engine never guesses — a missing fact is not false, so `not <missing>` does not fire
 *      either. That is the difference between "we do not know" and "no".
 *
 *   bun test src/rules.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Facts, RuleError, type Rule, applyRules, loadRules } from './rules'

const FIXTURES = 'tests/fixtures/rules'
const read = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const TEMPLATE: Rule = {
  id: 'r',
  when: { fact: 'x', op: 'gt', value: 0 },
  delta: 1,
  source: 'synthetic:r',
  confidence: 0.5,
}

const rule = (over: Partial<Rule> = {}): Rule => ({ ...TEMPLATE, ...over })

/** The refusal, as one string: what a reader of the error would see. */
function refusal(input: unknown): string {
  try {
    loadRules(input)
  } catch (error) {
    return error instanceof RuleError ? error.message : `not a RuleError: ${String(error)}`
  }
  return ''
}

function engineRefusal(rules: Rule[], facts: Facts, base = 0): string {
  try {
    applyRules(rules, facts, base)
  } catch (error) {
    return error instanceof RuleError ? error.message : `not a RuleError: ${String(error)}`
  }
  return ''
}

const set = (rules: unknown[], version = 'demo-rules/1'): unknown => ({ version, rules })

describe('loading a rule set', () => {
  test('loads the synthetic fixture and orders it by id, not by file order', () => {
    const loaded = loadRules(read('synthetic.json'))
    expect(loaded.version).toBe('demo-rules/1')
    expect(loaded.rules.map((item) => item.id)).toEqual([
      'demo-existing-condition',
      'demo-male',
      'demo-older-and-flagged',
    ])
  })

  test('a rule without source does not load — the whole set is refused, and says why', () => {
    const message = refusal(read('no-source.json'))
    expect(message).toContain('a rule without source does not load')
    expect(message).toContain('rule-without-source')
  })

  test('an empty or whitespace source is not a source', () => {
    for (const source of ['', '   ']) {
      expect(refusal(set([{ ...TEMPLATE, source }]))).toContain('source must be a non-empty string')
    }
    expect(refusal(set([{ ...TEMPLATE, source: 42 }]))).toContain('source must be a non-empty string')
  })

  test('one refusal names every problem, not only the first', () => {
    const message = refusal(
      set([
        { id: 'no-source-here', when: { fact: 'x', op: 'eq', value: 1 }, delta: 1, confidence: 0.5 },
        { id: 'bad-confidence', when: { fact: 'x', op: 'eq', value: 1 }, delta: 1, source: 'synthetic:b', confidence: 1.4 },
      ]),
    )
    expect(message).toContain('no-source-here')
    expect(message).toContain('bad-confidence')
    expect(message.split('\n').length).toBeGreaterThan(1)
  })

  test('a typo is refused instead of becoming a default', () => {
    const typo = set([{ id: 'r1', wnen: { fact: 'x', op: 'eq', value: 1 }, delta: 1, source: 'synthetic:r1', confidence: 0.5 }])
    expect(refusal(typo)).toContain('unknown key "wnen"')
    expect(refusal(typo)).toContain('missing when')
  })

  test('the shape the card names is the shape that loads, and nothing else', () => {
    const extra = set([{ ...TEMPLATE, note: 'a free-text field nobody agreed on' }])
    expect(refusal(extra)).toContain('unknown key "note"')

    const noVersion = { rules: [TEMPLATE] }
    expect(refusal(noVersion)).toContain('$.version')

    const notArray = { version: 'demo-rules/1', rules: { ...TEMPLATE } }
    expect(refusal(notArray)).toContain('$.rules')
  })

  // The malformed half: every row is a rule file that must not produce an estimate.
  const malformed: Array<[string, unknown, string]> = [
    ['a non-finite delta', set([{ ...TEMPLATE, delta: Number.POSITIVE_INFINITY }]), 'delta must be a finite number'],
    ['a delta as a string', set([{ ...TEMPLATE, delta: '0.4' }]), 'delta must be a finite number'],
    ['a confidence below zero', set([{ ...TEMPLATE, confidence: -0.1 }]), 'confidence must be a number from 0 to 1'],
    ['two rules under one id', set([TEMPLATE, TEMPLATE]), 'duplicate rule id'],
    ['an unknown op', set([{ ...TEMPLATE, when: { fact: 'x', op: '≈', value: 1 } }]), 'op: must be one of'],
    ['a comparison with no fact', set([{ ...TEMPLATE, when: { op: 'gt', value: 1 } }]), 'a comparison names one fact'],
    ['an in with nothing in it', set([{ ...TEMPLATE, when: { fact: 'x', op: 'in', value: [] } }]), 'non-empty list'],
    ['an exists that carries a value', set([{ ...TEMPLATE, when: { fact: 'x', op: 'exists', value: true } }]), 'exists takes no value'],
    ['an empty all, which can never fire', set([{ ...TEMPLATE, when: { all: [] } }]), 'a condition that can never fire'],
    ['a condition that is two shapes at once', set([{ ...TEMPLATE, when: { fact: 'x', all: [] } }]), 'exactly one of'],
    ['a condition that is no shape at all', set([{ ...TEMPLATE, when: {} }]), 'exactly one of'],
  ]

  for (const [what, input, expected] of malformed) {
    test(`refuses ${what}`, () => {
      expect(refusal(input)).toContain(expected)
    })
  }
})

describe('the same input gives the same output', () => {
  test('evaluating the same facts twice gives byte-identical results', () => {
    const loaded = loadRules(read('synthetic.json'))
    const facts = read('synthetic-facts.json') as Facts
    const first = JSON.stringify(applyRules(loaded.rules, facts, 4.2))
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(applyRules(loaded.rules, facts, 4.2))).toBe(first)
    }
  })

  test('the order of the file cannot move the number', () => {
    const facts: Facts = { x: 1 }
    const a = rule({ id: 'a', delta: 0.1 })
    const b = rule({ id: 'b', delta: 0.2 })
    const c = rule({ id: 'c', delta: 0.3 })

    // The trap: a sum is not associative in floating point, so file order would show through.
    const inOrder = [0.1, 0.2, 0.3].reduce((value, delta) => value + delta, 0)
    const reversed = [0.3, 0.2, 0.1].reduce((value, delta) => value + delta, 0)
    expect(inOrder).not.toBe(reversed)

    const forwards = applyRules([a, b, c], facts)
    const shuffled = applyRules([c, a, b], facts)
    expect(shuffled.value).toBe(forwards.value)
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forwards))
    expect(forwards.contributions.map((item) => item.rule)).toEqual(['a', 'b', 'c'])
  })

  test('nothing in the engine reads the clock', () => {
    const loaded = loadRules(read('synthetic.json'))
    const facts = read('synthetic-facts.json') as Facts
    const before = applyRules(loaded.rules, facts, 0)
    const startedAt = Date.now()
    while (Date.now() - startedAt < 3) {
      // a few milliseconds of wall clock, so a reading of "now" would have a chance to move
    }
    expect(applyRules(loaded.rules, facts, 0)).toEqual(before)
  })
})

describe('a rule that does not fire', () => {
  test('no match leaves the number alone and is listed as not applied', () => {
    const estimate = applyRules([rule({ when: { fact: 'x', op: 'gt', value: 10 } })], { x: 1 }, 7)
    expect(estimate.value).toBe(7)
    expect(estimate.contributions).toEqual([])
    expect(estimate.notApplied).toEqual([{ rule: 'r', reason: 'no-match' }])
  })

  test('a missing fact is not false — and not <missing> does not fire either', () => {
    const direct = applyRules([rule({ when: { fact: 'absent', op: 'gt', value: 1 } })], {}, 7)
    expect(direct.notApplied).toEqual([{ rule: 'r', reason: 'missing-fact' }])

    const negated = applyRules([rule({ when: { not: { fact: 'absent', op: 'gt', value: 0 } } })], {}, 7)
    expect(negated.value).toBe(7)
    expect(negated.notApplied).toEqual([{ rule: 'r', reason: 'missing-fact' }])
  })

  test('a fact of the wrong type is not coerced into a comparison', () => {
    expect(applyRules([rule({ when: { fact: 'x', op: 'gt', value: 0 } })], { x: 'high' }, 0).notApplied).toEqual([
      { rule: 'r', reason: 'type-mismatch' },
    ])
    // "sixty" is not older than 50, and neither is it younger: the rule cannot be decided.
    expect(applyRules([rule({ when: { fact: 'age', op: 'ge', value: 50 } })], { age: 'sixty' }, 0).notApplied).toEqual([
      { rule: 'r', reason: 'type-mismatch' },
    ])
    expect(applyRules([rule({ when: { fact: 'x', op: 'ne', value: 'male' } })], { x: true }, 0).notApplied).toEqual([
      { rule: 'r', reason: 'type-mismatch' },
    ])
  })

  test('all needs every child; one false child is a decision, one unknown child is not', () => {
    const both: Rule = { ...rule(), when: { all: [{ fact: 'age', op: 'ge', value: 50 }, { fact: 'flag', op: 'eq', value: 'high' }] } }
    expect(applyRules([both], { age: 60, flag: 'high' }, 0).value).toBe(1)
    expect(applyRules([both], { age: 40, flag: 'high' }, 0).notApplied).toEqual([{ rule: 'r', reason: 'no-match' }])
    expect(applyRules([both], { age: 60 }, 0).notApplied).toEqual([{ rule: 'r', reason: 'missing-fact' }])
    // A false child decides the conjunction even when a sibling is undecidable: `any` is not at stake.
    expect(applyRules([both], { age: 40 }, 0).notApplied).toEqual([{ rule: 'r', reason: 'no-match' }])
  })

  test('any needs one true child, and an unknown sibling cannot cancel it', () => {
    const either: Rule = { ...rule(), when: { any: [{ fact: 'a', op: 'eq', value: 1 }, { fact: 'b', op: 'eq', value: 2 }] } }
    expect(applyRules([either], { a: 1 }, 0).value).toBe(1)
    expect(applyRules([either], { a: 2, b: 2 }, 0).value).toBe(1)
    expect(applyRules([either], { a: 2, b: 3 }, 0).notApplied).toEqual([{ rule: 'r', reason: 'no-match' }])
    expect(applyRules([either], { a: 2 }, 0).notApplied).toEqual([{ rule: 'r', reason: 'missing-fact' }])
  })

  test('exists asks a question a missing fact answers', () => {
    const present = rule({ when: { fact: 'condition', op: 'exists' } })
    expect(applyRules([present], { condition: false }, 0).value).toBe(1)
    expect(applyRules([present], {}, 0).notApplied).toEqual([{ rule: 'r', reason: 'missing-fact' }])
  })

  test('in compares within the fact type and ignores members of other types', () => {
    const flagged = rule({ when: { fact: 'flag', op: 'in', value: ['high', 'critical'] } })
    expect(applyRules([flagged], { flag: 'high' }, 0).value).toBe(1)
    expect(applyRules([flagged], { flag: 'low' }, 0).notApplied).toEqual([{ rule: 'r', reason: 'no-match' }])
    expect(applyRules([flagged], { flag: 3 }, 0).notApplied).toEqual([{ rule: 'r', reason: 'type-mismatch' }])
  })

  test('not inverts a decided condition and leaves an undecidable one undecidable', () => {
    const notHigh = rule({ when: { not: { fact: 'flag', op: 'eq', value: 'high' } } })
    expect(applyRules([notHigh], { flag: 'low' }, 0).value).toBe(1)
    expect(applyRules([notHigh], { flag: 'high' }, 0).notApplied).toEqual([{ rule: 'r', reason: 'no-match' }])
  })
})

describe('what the estimate records', () => {
  test('every fired rule carries its delta, its condition and its source', () => {
    const loaded = loadRules(read('synthetic.json'))
    const estimate = applyRules(loaded.rules, read('synthetic-facts.json') as Facts, 2)

    expect(estimate.contributions.map((item) => item.rule)).toEqual(['demo-male', 'demo-older-and-flagged'])
    expect(estimate.contributions[0]).toEqual({
      rule: 'demo-male',
      when: { fact: 'demo.sex', op: 'eq', value: 'male' },
      delta: 0.1,
      source: 'synthetic:demo-sex',
      confidence: 0.5,
    })
    for (const item of estimate.contributions) expect(item.source.length).toBeGreaterThan(0)
    expect(estimate.notApplied).toEqual([{ rule: 'demo-existing-condition', reason: 'missing-fact' }])
  })

  test('delta, value and base agree; the sum is the contributions in id order', () => {
    const estimate = applyRules([rule({ id: 'a', delta: 0.4 }), rule({ id: 'b', delta: -0.1 })], { x: 1 }, 10)
    expect(estimate.base).toBe(10)
    expect(estimate.delta).toBeCloseTo(0.3, 10)
    expect(estimate.value).toBeCloseTo(10.3, 10)
  })

  test('confidence is the weakest rule that fired, and 1 when nothing moved the number', () => {
    const estimate = applyRules([rule({ id: 'a', confidence: 0.9 }), rule({ id: 'b', confidence: 0.4 })], { x: 1 }, 0)
    expect(estimate.confidence).toBe(0.4)
    const untouched = applyRules([], { x: 1 }, 3)
    expect(untouched).toEqual({ base: 3, value: 3, delta: 0, confidence: 1, contributions: [], notApplied: [] })
  })

  test('a rule passed to the engine without a source is refused there too', () => {
    const withoutSource: Record<string, unknown> = { ...TEMPLATE }
    delete withoutSource.source
    const noSource = engineRefusal([withoutSource as unknown as Rule], { x: 1 })
    expect(noSource).toContain('a rule without source does not load')
    expect(noSource).toContain('rules[0] ("r")')
    expect(engineRefusal([{ ...TEMPLATE, source: '' }], { x: 1 })).toContain('source must be a non-empty string')
  })

  test('an estimate cannot start from a number that is not one', () => {
    expect(engineRefusal([], {}, Number.NaN)).toContain('finite number')
    expect(engineRefusal([], {}, Number.NEGATIVE_INFINITY)).toContain('finite number')
  })
})
