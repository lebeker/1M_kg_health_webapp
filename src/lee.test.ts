/**
 * The Lee index against the paper's own table, not against itself.
 *
 * The index is a sum, so it can be wrong in only two ways: a weight that is not the published one,
 * or an item that fires when it should not. Both are pinned here — the sixteen rows with their
 * points exactly as the abstract prints them, the four bands with their printed mortality, and a
 * per-item test that adding a deficit moves the index by exactly that deficit's weight.
 *
 * The rest is what the card calls "the explicit list of what the model ignores": every refactor
 * has to keep a missing fact a refusal (not a zero), a wrong type a refusal, an unread fact named,
 * and the nine limits attached to every result.
 *
 *   bun test src/lee.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGE_MIN,
  AGE_TYPO_MAX,
  BANDS,
  LEE_FACTS,
  LEE_ROWS,
  LEE_RULES,
  LeeError,
  type LeeIndex,
  LIMITS,
  MAX_POINTS,
  PMID,
  VERSION,
  bandFor,
  lee,
} from './lee'
import { applyRules, loadRules } from './rules'

const FIXTURES = 'tests/fixtures/lee'

/** A fixture is a facts file plus a `note` for the reader; the note never reaches the index. */
function fixture(name: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
  const { note, ...facts } = raw
  return facts
}

/** The refusal, as one string: what a reader of the error would see. */
function refusal(input: unknown): string {
  try {
    lee(input)
  } catch (error) {
    return error instanceof LeeError ? error.message : `not a LeeError: ${String(error)}`
  }
  return 'no refusal'
}

/** A profile that scores nothing except its age band (70–74, 3 points). */
const BASE: Record<string, unknown> = {
  age: 70,
  sex: 'female',
  bmi: 26,
  diabetes: false,
  cancer: false,
  lung_disease: false,
  heart_failure: false,
  current_smoker: false,
  difficulty_bathing: false,
  difficulty_walking_several_blocks: false,
  difficulty_managing_money: false,
  difficulty_pushing_large_objects: false,
}

const withPatch = (patch: Record<string, unknown>): Record<string, unknown> => ({ ...BASE, ...patch })

describe('the published table', () => {
  /** Lee 2006, the twelve predictors as the abstract prints them: 2 demographic, 6 comorbid, 4 functional. */
  const PUBLISHED: ReadonlyArray<readonly [string, number]> = [
    ['age_60_64', 1],
    ['age_65_69', 2],
    ['age_70_74', 3],
    ['age_75_79', 4],
    ['age_80_84', 5],
    ['age_85_plus', 7],
    ['sex_male', 2],
    ['diabetes', 1],
    ['cancer', 2],
    ['lung_disease', 2],
    ['heart_failure', 2],
    ['current_smoker', 2],
    ['bmi_under_25', 1],
    ['difficulty_bathing', 2],
    ['difficulty_walking_several_blocks', 2],
    ['difficulty_managing_money', 2],
    ['difficulty_pushing_large_objects', 1],
  ]

  test('every row carries exactly the points the paper prints', () => {
    expect(LEE_ROWS.map((row) => [row.id, row.points])).toEqual(PUBLISHED)
  })

  test('twelve items, seventeen rows, and a ceiling of 26 points', () => {
    expect(new Set(LEE_ROWS.map((row) => row.item)).size).toBe(12)
    expect(LEE_ROWS.length).toBe(17)
    expect(LEE_FACTS.length).toBe(12)
    expect(MAX_POINTS).toBe(26)
  })

  test('every row cites the same primary source, and the scale is named', () => {
    for (const row of LEE_ROWS) expect(row.source).toBe(PMID)
    expect(PMID).toBe('PMID:16478903')
    expect(VERSION).toBe('lee-4y-points/1')
  })

  test('the table loads through the engine as one rule set, delta = points, confidence 1', () => {
    const reloaded = loadRules(JSON.parse(JSON.stringify(LEE_RULES)))
    expect(reloaded.version).toBe(VERSION)
    expect(reloaded.rules.length).toBe(LEE_ROWS.length)
    for (const rule of reloaded.rules) {
      const row = LEE_ROWS.find((candidate) => candidate.id === rule.id)
      expect(row).toBeDefined()
      expect(rule.delta).toBe(row?.points)
      expect(rule.confidence).toBe(1)
      expect(rule.source).toBe(PMID)
    }
  })

  test('the rules arrive in id order, whichever order the table was written in', () => {
    const reversed = loadRules({ version: VERSION, rules: [...LEE_RULES.rules].reverse() })
    const facts = withPatch({ age: 80, sex: 'male', diabetes: true })
    expect(applyRules(reversed, facts).value).toBe(applyRules(LEE_RULES, facts).value)
  })
})

describe('the index', () => {
  test('a 65-year-old woman with BMI 24.1 is 3 points, the first band', () => {
    const index = lee(fixture('profile-a-woman-65-minimal.json'))
    expect(index.points).toBe(3)
    expect(index.band.printed).toBe('less than 4%')
    expect(index.deficits.map((deficit) => deficit.rule)).toEqual(['age_65_69', 'bmi_under_25'])
  })

  test('an 80-year-old man with eight deficits is 17 points, the top band', () => {
    const index = lee(fixture('profile-b-man-80-heavy.json'))
    expect(index.points).toBe(17)
    expect(index.band.printed).toBe('64%')
    // The paper's order, not alphabetical: age, sex, conditions, function.
    expect(index.deficits.map((deficit) => deficit.rule)).toEqual([
      'age_80_84',
      'sex_male',
      'diabetes',
      'cancer',
      'current_smoker',
      'bmi_under_25',
      'difficulty_bathing',
      'difficulty_walking_several_blocks',
    ])
    expect(index.deficits.reduce((sum, deficit) => sum + deficit.points, 0)).toBe(index.points)
  })

  test('an 88-year-old woman whose only weight is age is 7 points', () => {
    const index = lee(fixture('profile-c-woman-88-age-only.json'))
    expect(index.points).toBe(7)
    expect(index.band.printed).toBe('15%')
  })

  test('age scores exactly at the printed band edges', () => {
    const expected: ReadonlyArray<readonly [number, number]> = [
      [60, 1],
      [64, 1],
      [65, 2],
      [69, 2],
      [70, 3],
      [74, 3],
      [75, 4],
      [79, 4],
      [80, 5],
      [84, 5],
      [85, 7],
      [120, 7],
    ]
    for (const [age, points] of expected) {
      const index = lee(withPatch({ age }))
      expect({ age, points: index.points }).toEqual({ age, points })
    }
  })

  test('every other item moves the index by exactly its published weight', () => {
    const scoring: ReadonlyArray<readonly [string, unknown, number]> = [
      ['sex', 'male', 2],
      ['bmi', 24.9, 1],
      ['diabetes', true, 1],
      ['cancer', true, 2],
      ['lung_disease', true, 2],
      ['heart_failure', true, 2],
      ['current_smoker', true, 2],
      ['difficulty_bathing', true, 2],
      ['difficulty_walking_several_blocks', true, 2],
      ['difficulty_managing_money', true, 2],
      ['difficulty_pushing_large_objects', true, 1],
    ]
    const base = lee(BASE).points
    expect(base).toBe(3)
    for (const [fact, value, points] of scoring) {
      const index = lee(withPatch({ [fact]: value }))
      expect({ fact, points: index.points - base }).toEqual({ fact, points })
    }
  })

  test('the whole table at once is the ceiling, and nothing else can be', () => {
    const index = lee(
      withPatch({
        age: 85,
        sex: 'male',
        bmi: 22,
        diabetes: true,
        cancer: true,
        lung_disease: true,
        heart_failure: true,
        current_smoker: true,
        difficulty_bathing: true,
        difficulty_walking_several_blocks: true,
        difficulty_managing_money: true,
        difficulty_pushing_large_objects: true,
      }),
    )
    expect(index.points).toBe(26)
    expect(index.maxPoints).toBe(26)
    expect(index.deficits.length).toBe(12)
    // The five age bands that are not 85-and-over are the only rows left over.
    expect(index.absent.filter((row) => row.item !== 'age').length).toBe(0)
    expect(index.absent.length).toBe(5)
  })

  test('a fact of exactly 25 is not "under 25", and a woman is not the male row', () => {
    expect(lee(withPatch({ bmi: 25 })).points).toBe(3)
    expect(lee(withPatch({ bmi: 24.999 })).points).toBe(4)
    expect(lee(withPatch({ sex: 'male' })).deficits.map((deficit) => deficit.rule)).toContain('sex_male')
    expect(lee(withPatch({ sex: 'female' })).deficits.map((deficit) => deficit.rule)).not.toContain('sex_male')
  })
})

describe('the published bands', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, 'less than 4%'],
    [5, 'less than 4%'],
    [6, '15%'],
    [9, '15%'],
    [10, '42%'],
    [13, '42%'],
    [14, '64%'],
    [26, '64%'],
  ]

  test('every sum from 0 to 26 lands in the printed band', () => {
    for (const [points, printed] of cases) expect({ points, printed: bandFor(points).printed }).toEqual({ points, printed })
  })

  test('the four bands cover 0–26 with no gap and no overlap', () => {
    expect(BANDS.map((band) => [band.from, band.to])).toEqual([
      [0, 5],
      [6, 9],
      [10, 13],
      [14, null],
    ])
    for (let points = 0; points <= 26; points += 1) {
      expect(BANDS.filter((band) => points >= band.from && (band.to === null || points <= band.to)).length).toBe(1)
    }
  })

  test('a sum outside the table is refused, not clamped', () => {
    expect(() => bandFor(27)).toThrow(LeeError)
    expect(() => bandFor(-1)).toThrow(LeeError)
  })
})

describe('what the model ignores', () => {
  test('every result carries the nine limits, and they name the paper’s own boundaries', () => {
    const index = lee(fixture('profile-a-woman-65-minimal.json'))
    expect(index.limits).toBe(LIMITS)
    expect(index.limits.length).toBe(9)
    const text = index.limits.join('\n')
    for (const phrase of [
      'not a probability for one person',
      'community-dwelling US adults over 50',
      'severity, duration, control and treatment are not scored',
      'self-reported difficulty',
      'hypertension and chronic kidney disease',
      'an age under 60 is refused',
      'does not read the document',
      'missing is not “no”',
      'cause of death',
    ]) {
      expect(text).toContain(phrase)
    }
  })

  test('everything supplied and not present is listed with its reason, nothing silently drops', () => {
    const index = lee(fixture('profile-b-man-80-heavy.json'))
    const listed = [...index.deficits.map((deficit) => deficit.rule), ...index.absent.map((row) => row.rule)]
    expect(listed.slice().sort()).toEqual(LEE_ROWS.map((row) => row.id).slice().sort())
    for (const row of index.absent) expect(row.reason).toBe('no-match')
  })

  test('the engine keeps its own skip list, one entry per rule that did not fire', () => {
    const index = lee(fixture('profile-b-man-80-heavy.json'))
    expect(index.estimate.notApplied.length).toBe(index.absent.length)
    expect(index.estimate.contributions.length).toBe(index.deficits.length)
    expect(index.estimate.version).toBe(VERSION)
    expect(index.estimate.base).toBe(0)
  })

  test('a fact another scale needs is read by neither: it is named, not dropped', () => {
    const index = lee({ ...BASE, systolic_bp: 140, total_cholesterol: 6.3, hdl_cholesterol: 1.4 })
    expect(index.points).toBe(3)
    expect(index.ignored).toEqual(['hdl_cholesterol', 'systolic_bp', 'total_cholesterol'])
  })

  test('the source and the paper’s discrimination travel with the number', () => {
    const index = lee(BASE)
    expect(index.source).toEqual({ pmid: PMID, doi: '10.1001/jama.295.7.801' })
    expect(index.discrimination).toEqual({ development: 0.84, validation: 0.82 })
    expect(index.model).toBe('Lee')
  })
})

describe('refusals', () => {
  test('each of the twelve facts, removed, is named in the refusal', () => {
    for (const fact of LEE_FACTS) {
      const facts: Record<string, unknown> = { ...BASE }
      delete facts[fact]
      expect({ fact, named: refusal(facts).includes(`facts.${fact}`) }).toEqual({ fact, named: true })
    }
  })

  test('a missing fact is not a zero, and the missing BMI fixture says so', () => {
    const message = refusal(fixture('invalid-missing-bmi.json'))
    expect(message).toContain('facts.bmi')
    expect(message).toContain('an unknown weight is not a normal one')
  })

  test('a misspelt fact is refused by its real name and the typo is shown', () => {
    const message = refusal(fixture('invalid-typo-key.json'))
    expect(message).toContain('facts.diabetes')
    expect(message).toContain('diabetis')
    expect(message).toContain('misspelling')
  })

  test('a condition that is not true or false is refused, not read as absent', () => {
    const message = refusal(fixture('invalid-wrong-type.json'))
    expect(message).toContain('facts.diabetes')
    expect(message).toContain('true or false')
    expect(refusal(withPatch({ bmi: '24' }))).toContain('facts.bmi')
    expect(refusal(withPatch({ sex: 'M' }))).toContain('facts.sex')
  })

  test('an age under 60 is refused rather than scored zero', () => {
    const message = refusal(fixture('invalid-age-59.json'))
    expect(message).toContain('facts.age 59')
    expect(message).toContain(`${AGE_MIN}–64`)
    expect(refusal(withPatch({ age: 60.5 }))).toContain('whole number of years')
    expect(refusal(withPatch({ age: AGE_TYPO_MAX + 1 }))).toContain('typo')
  })

  test('something that is not a facts record is refused by shape', () => {
    expect(refusal([BASE])).toContain('an array')
    expect(refusal(null)).toContain('facts:')
    expect(refusal('age 70')).toContain('facts:')
  })

  test('every problem is reported at once, so one run fixes them all', () => {
    const message = refusal({ age: 70 })
    expect(message.split('\n').length).toBe(11) // sex, bmi, five conditions, four functions
  })
})

describe('determinism', () => {
  test('the same facts give the same bytes, whatever order the keys arrive in', () => {
    const facts = fixture('profile-b-man-80-heavy.json')
    const reversed = Object.fromEntries(Object.entries(facts).reverse())
    const first: LeeIndex = lee(facts)
    const second = lee(reversed)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(lee(facts))).toBe(JSON.stringify(first))
  })

  test('the index is the sum of the deficit list, always', () => {
    for (const name of ['profile-a-woman-65-minimal.json', 'profile-b-man-80-heavy.json', 'profile-c-woman-88-age-only.json']) {
      const index = lee(fixture(name))
      expect(index.deficits.reduce((sum, deficit) => sum + deficit.points, 0)).toBe(index.points)
      expect(index.estimate.value).toBe(index.points)
    }
  })
})
