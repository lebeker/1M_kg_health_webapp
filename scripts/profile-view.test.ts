import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * SCRUM-16 — the profile view's missing blocks: the cohort (27), the inputs (28), what no model
 * reads (29) and the other three knobs (30).
 *
 * The card's hard constraint is that no number is invented. So every table this file checks is
 * held to the file in the repo that produces it:
 *
 *   - `src/score2.ts` states SCORE2's ages (40–69), its four regions and its six inputs
 *     (`SCORE2_FACTS`), and the diabetes refusal is its own `LIMITS`;
 *   - `src/lee.ts` states the twelve items, their whole-number points (`LEE_ROWS`), the age floor
 *     (60), the ceiling (26, `MAX_POINTS`), the four printed bands (`BANDS`) and the
 *     discrimination (0.84 / 0.82);
 *   - `docs/LEE.md` carries the cohort and its sizes (11,701 developed, 8,009 validated);
 *   - `body/index.html` carries the baseline table the sex knob actually reads
 *     (`meta.life_expectancy`, default `{ male: 74, female: 80 }`).
 *
 * And the other direction: the wireframe's knob deltas (+3.4 for female, −2.9 per five years of
 * birth year, −1.9 / +1.2 for smoking, +0.6 for steps) have no derivation anywhere in this repo,
 * so the page and this module must not print them. That is checked too — a row that invents a
 * delta is worse than a row that is not drawn.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')
const score2 = read('src/score2.ts')
const lee = read('src/lee.ts')
const leeDoc = read('docs/LEE.md')
const module_ = read('body/lib/profile-view.js')

type Row = {
  key: string
  label: string
  state: 'supplied' | 'absent' | 'refused'
  detail: string
  record: string
  date: string
  value: string
  points: number | null
}
type View = {
  subject: {
    name: string | null
    sex: string | null
    year: number | null
    age: number | null
    reading: { year: number | null; age: number | null; sex: string }
    span: { first: string; last: string; fromAge: number; toAge: number; dated: number } | null
    edited: boolean
    today: string
  }
  cohort: {
    score2: { ages: { min: number; max: number }; regions: string[]; regionInDocument: boolean; refusals: string[]; title: string }
    lee: {
      cohort: string
      developed: number
      validated: number
      ageMin: number
      maxPoints: number
      bands: Array<{ from: number; to: number | null; printed: string }>
      discrimination: { development: number; validation: number }
      refusals: string[]
    }
  }
  inputs: {
    score2: { rows: Row[]; refusals: string[] }
    lee: { rows: Row[]; refusals: string[]; summary: { supplied: number; items: number; points: number; maxPoints: number; complete: boolean } }
  }
  blind: Array<{ name: string; why: string }>
  knobs: {
    sex: { value: string; documentValue: string; edited: boolean; table: { male: number | null; female: number | null }; move: number | null; detail: string }
    birth: { value: number | null; documentValue: number | null; age: number | null; edited: boolean; detail: string; refusals: string[] }
    smoker: { value: string; documentValue: string; edited: boolean; points: number | null; detail: string }
    steps: { value: null; detail: string }
  }
  sources: Record<string, string>
}
type ProfileView = {
  build: (input: Record<string, unknown>) => View
  SCORE2: { ages: { min: number; max: number }; regions: string[]; facts: Array<{ fact: string; input: string; label: string }> }
  LEE: {
    ageMin: number
    ageTypoMax: number
    maxPoints: number
    cohort: string
    developed: number
    validated: number
    discrimination: { development: number; validation: number }
    bands: Array<{ from: number; to: number | null; printed: string }>
    ageBands: Array<{ id: string; label: string; from: number; to: number | null; points: number }>
    items: Array<{ fact: string; label: string; points: number }>
  }
  BLIND: Array<{ name: string; why: string }>
  ageBandAt: (age: number | null) => { id: string; points: number } | null
  baselineOf: (leBySex: Record<string, number>, sex: string) => number | null
}

const sandbox: { ProfileView?: ProfileView } = {}
vm.createContext(sandbox)
vm.runInContext(module_, sandbox)
const PV = sandbox.ProfileView as ProfileView

if (!PV) throw new Error('profile-view.js did not define ProfileView')

const demo = JSON.parse(read('kg_demo.json')) as {
  meta: { profile: { sex: string; year_of_birth: number; name: string } }
  nodes: Array<Record<string, unknown>>
}
const LE = { male: 74, female: 80 }
const TODAY = '2026-11-23'

const build = (over: Record<string, unknown> = {}) =>
  PV.build({ meta: demo.meta, nodes: demo.nodes, sex: 'male', born: null, smoker: null, today: TODAY, leBySex: LE, ...over })

const view = build()
const score2Rows = () => view.inputs.score2.rows
const leeRows = () => view.inputs.lee.rows
const row = (rows: Row[], key: string) => rows.find((r) => r.key === key) as Row

describe('the module reads the document and asks nothing else', () => {
  test('the demo profile comes out as the document states it', () => {
    expect(view.subject.name).toBe('Andrei')
    expect(view.subject.sex).toBe('male')
    expect(view.subject.year).toBe(1961)
    expect(view.subject.age).toBe(65)
    expect(view.subject.today).toBe(TODAY)
    expect(view.subject.edited).toBe(false)
  })

  test('the record’s age span follows the reading year, and nothing is stored', () => {
    const span = view.subject.span as NonNullable<View['subject']['span']>
    expect(Number(span.first.slice(0, 4))).toBeGreaterThanOrEqual(1961)
    expect(span.toAge - span.fromAge).toBeGreaterThan(0)
    expect(span.dated).toBeGreaterThan(0)
    // a corrected year moves every age in the span, in one step
    const edited = build({ born: 1980 })
    expect(edited.subject.reading.age).toBe(46)
    expect((edited.subject.span as NonNullable<View['subject']['span']>).toAge).toBe(span.toAge - 19)
    expect(edited.subject.year).toBe(1961) // the document's own year is untouched
    expect(edited.subject.edited).toBe(true)
  })

  test('no profile in the document makes no person', () => {
    const none = PV.build({ meta: {}, nodes: [], sex: '', born: null, smoker: null, today: TODAY, leBySex: LE })
    expect(none.subject.year).toBeNull()
    expect(none.subject.age).toBeNull()
    expect(none.subject.span).toBeNull()
    expect(row(none.inputs.score2.rows, 'age').state).toBe('absent')
    expect(row(none.inputs.lee.rows, 'age').state).toBe('absent')
  })
})

describe('widget 27 — the cohort', () => {
  test('SCORE2’s ages, regions and the region refusal come out of src/score2.ts', () => {
    expect(view.cohort.score2.ages).toEqual({ min: 40, max: 69 })
    expect(view.cohort.score2.regions).toEqual(['low', 'moderate', 'high', 'very_high'])
    expect(view.cohort.score2.regionInDocument).toBe(false)
    expect(view.cohort.score2.refusals.join(' ')).toContain('no ESC region')
    // and the refusal is the file's own: the region is an argument with no default
    expect(score2).toContain('there is no default')
  })

  test('Lee’s cohort, bands and discrimination come out of src/lee.ts and docs/LEE.md', () => {
    expect(view.cohort.lee.bands).toEqual(PV.LEE.bands)
    expect(view.cohort.lee.discrimination).toEqual({ development: 0.84, validation: 0.82 })
    expect(view.cohort.lee.ageMin).toBe(60)
    expect(view.cohort.lee.maxPoints).toBe(26)
    expect(view.cohort.lee.developed).toBe(11701)
    expect(view.cohort.lee.validated).toBe(8009)
    expect(view.cohort.lee.cohort).toContain('over 50')
    expect(lee).toContain('community-dwelling US adults over 50')
    expect(leeDoc).toContain('11,701')
    expect(leeDoc).toContain('8,009')
  })

  test('the record’s diabetes refuses SCORE2, in words, and no risk number is printed', () => {
    const refusals = view.cohort.score2.refusals.join(' ')
    expect(refusals).toContain('diabetes')
    expect(refusals).toContain('SCORE2-Diabetes')
    expect(score2).toContain('not for people with diabetes')
  })

  test('an age outside 40–69 refuses SCORE2 and names SCORE2-OP', () => {
    const old = build({ born: 1936 }) // 90 in 2026
    expect(old.cohort.score2.refusals.join(' ')).toContain('SCORE2-OP')
    expect(score2).toContain('over 70 is SCORE2-OP')
  })
})

describe('widget 28 — the inputs, and the refusals where they belong', () => {
  test('SCORE2 rows are its six published inputs, in its own order', () => {
    expect(score2Rows().map((r) => r.key)).toEqual([
      'age',
      'sex',
      'current_smoker',
      'systolic_bp',
      'total_cholesterol',
      'hdl_cholesterol',
      'diabetes',
    ])
    expect(row(score2Rows(), 'age').state).toBe('supplied')
    expect(row(score2Rows(), 'age').value).toBe('65')
    expect(row(score2Rows(), 'sex').state).toBe('supplied')
  })

  test('a supplied input carries the record it came from — the document is the source', () => {
    const bp = row(score2Rows(), 'systolic_bp')
    expect(bp.state).toBe('supplied')
    expect(bp.record).toBe('obs-bp-2025')
    expect(bp.date).toBe('2025-11-04')
    expect(bp.value).toContain('149')

    const tc = row(score2Rows(), 'total_cholesterol')
    expect(tc.record).toBe('obs-lipids-2026')
    expect(tc.value).toContain('5.6')
    expect(row(score2Rows(), 'hdl_cholesterol').value).toContain('1.08')
  })

  test('a fact nobody asked about is absent, not zero', () => {
    expect(row(score2Rows(), 'current_smoker').state).toBe('absent')
    expect(leeRows().filter((r) => r.key.startsWith('difficulty_'))).toHaveLength(4)
    for (const r of leeRows().filter((row_) => row_.key.startsWith('difficulty_'))) expect(r.state).toBe('absent')
    expect(leeRows().filter((r) => r.state === 'absent').length).toBeGreaterThan(0)
  })

  test('diabetes is refused on the SCORE2 side, and scored on Lee’s', () => {
    expect(row(score2Rows(), 'diabetes').state).toBe('refused')
    expect(row(score2Rows(), 'diabetes').detail).toContain('not for people with diabetes')
    expect(row(leeRows(), 'diabetes').state).toBe('supplied')
    expect(row(leeRows(), 'diabetes').points).toBe(1)
  })

  test('Lee prints an index only when all twelve items are supplied — this record supplies three', () => {
    expect(view.inputs.lee.summary).toEqual({ supplied: 3, items: 12, points: 5, maxPoints: 26, complete: false })
    expect(view.inputs.lee.refusals.join(' ')).toContain('all twelve items')
    expect(view.inputs.lee.refusals.join(' ')).toContain('supplies 3')
  })

  test('the reader’s smoking reading adds the paper’s 2 points and says the file is not written', () => {
    const asSmoker = build({ smoker: true })
    expect(row(asSmoker.inputs.lee.rows, 'current_smoker').points).toBe(2)
    expect(asSmoker.inputs.lee.summary.points).toBe(7)
    expect(row(asSmoker.inputs.lee.rows, 'current_smoker').detail).toContain('the file is not written')
    // one knob, one reading: SCORE2's smoking row moves with Lee's, or the two disagree on screen
    expect(row(asSmoker.inputs.score2.rows, 'current_smoker').state).toBe('supplied')
    expect(row(asSmoker.inputs.score2.rows, 'current_smoker').value).toBe('smoker')
    expect(row(asSmoker.inputs.score2.rows, 'current_smoker').detail).toContain('the file is not written')
    // and a document that states it outranks the knob
    expect(row(view.inputs.score2.rows, 'current_smoker').detail).toContain('no record says whether he smokes')
  })

  test('the sex knob moves both models’ sex reading, and the document still has the last word', () => {
    const female = build({ sex: 'female' })
    expect(row(female.inputs.score2.rows, 'sex').value).toBe('female')
    expect(row(female.inputs.score2.rows, 'sex').detail).toContain('the document says male')
    expect(row(view.inputs.score2.rows, 'sex').detail).toBe('male · from meta.profile')
  })

  test('Lee scores female sex as supplied and worth nothing, and says so', () => {
    const female = build({ sex: 'female' })
    expect(row(female.inputs.lee.rows, 'sex').state).toBe('supplied')
    expect(row(female.inputs.lee.rows, 'sex').points).toBe(0)
    expect(row(female.inputs.lee.rows, 'sex').detail).toContain('scores nothing')
  })
})

describe('widget 29 — what no model reads', () => {
  test('the five names are on the page, each with why it is not in a number', () => {
    expect(view.blind.map((b) => b.name)).toEqual(['family history', 'sleep', 'vaccinations', 'depression', 'loneliness'])
    for (const item of view.blind) expect(item.why.length).toBeGreaterThan(10)
  })

  test('and none of them is a fact either model reads, which is the claim being made', () => {
    const score2Facts = score2.slice(score2.indexOf('SCORE2_FACTS'), score2.indexOf('export function inputFromFacts'))
    const leeFacts = lee.slice(lee.indexOf('LEE_ROWS'), lee.indexOf('LEE_RULES'))
    for (const name of ['family_history', 'family history', 'sleep', 'vaccin', 'depression', 'loneliness']) {
      expect(PV.SCORE2.facts.map((f) => f.fact)).not.toContain(name)
      expect(leeFacts.toLowerCase()).not.toContain(name)
      expect(score2Facts.toLowerCase()).not.toContain(name)
    }
  })
})

describe('widget 30 — the knobs, and what moving each one does', () => {
  test('the sex knob prints the baseline table it reads, not a delta nobody derived', () => {
    expect(view.knobs.sex.table).toEqual({ male: 74, female: 80 })
    expect(view.knobs.sex.move).toBe(6)
    expect(view.knobs.sex.detail).toContain('male 74')
    expect(view.knobs.sex.detail).toContain('female 80')
    expect(view.knobs.sex.detail).toContain('+6.0 years')
    // and the table really is the page's: the knob reads it rather than a constant of its own
    expect(page).toMatch(/let LE_BY_SEX = \{ male: 74, female: 80 \};/)
    expect(page).toMatch(/LE_BY_SEX = meta\.life_expectancy \|\| \{ male: 74, female: 80 \};/)
  })

  test('the birth-year knob states the ages it moves and where a model refuses the age', () => {
    expect(view.knobs.birth.value).toBe(1961)
    expect(view.knobs.birth.age).toBe(65)
    expect(view.knobs.birth.detail).toContain("the record's age span")
    expect(view.knobs.birth.refusals).toEqual([])

    const young = build({ born: 1990 })
    expect(young.knobs.birth.age).toBe(36)
    expect(young.knobs.birth.refusals.join(' ')).toContain('SCORE2 refuses age 36')
    expect(young.knobs.birth.refusals.join(' ')).toContain('Lee refuses age 36')
  })

  test('the smoking knob prints points and never a years delta', () => {
    expect(view.knobs.smoker.points).toBeNull()
    expect(view.knobs.smoker.detail).toContain('2 of its 26 points')
    expect(view.knobs.smoker.detail).toContain('no years are printed')
    expect(build({ smoker: true }).knobs.smoker.points).toBe(2)
  })

  test('the steps knob is refused in words, because nothing in the repo reads a step count', () => {
    expect(view.knobs.steps.value).toBeNull()
    expect(view.knobs.steps.detail).toContain('no model in this repo reads a step count')
    expect(PV.SCORE2.facts.map((f) => f.fact)).not.toContain('steps')
    expect(lee.slice(lee.indexOf('LEE_ROWS'), lee.indexOf('LEE_RULES'))).not.toContain('steps')
  })
})

describe('every table here is held to the file that produces it', () => {
  test('SCORE2’s six inputs and four regions are src/score2.ts’s own', () => {
    const block = score2.slice(score2.indexOf('export const SCORE2_FACTS'), score2.indexOf('export function inputFromFacts'))
    const pairs = [...block.matchAll(/\{ fact: '([a-z_0-9]+)', input: '([A-Za-z]+)' \}/g)].map((m) => [m[1], m[2]])
    expect(pairs).toEqual(PV.SCORE2.facts.map((f) => [f.fact, f.input]))
    const regions = score2.match(/export const REGIONS: readonly Region\[\] = \[([^\]]+)\]/)
    expect(regions?.[1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual(PV.SCORE2.regions)
    expect(score2).toContain('export const AGE_MIN = 40')
    expect(score2).toContain('export const AGE_MAX = 69')
  })

  test('Lee’s seventeen rows, their points and their facts are src/lee.ts’s own', () => {
    const start = lee.indexOf('export const LEE_ROWS')
    const block = lee.slice(start, lee.indexOf('export const LEE_RULES'))
    const rows = block
      .split('\n  {\n')
      .slice(1)
      .map((chunk) => ({
        id: chunk.match(/id: '([^']+)'/)?.[1] ?? '',
        item: chunk.match(/item: '([^']+)'/)?.[1] ?? '',
        points: Number(chunk.match(/points: (\d+)/)?.[1] ?? -1),
        fact: chunk.match(/fact: '([^']+)'/)?.[1] ?? '',
        values: [...chunk.matchAll(/value: (\d+)/g)].map((m) => Number(m[1])),
      }))
    expect(rows).toHaveLength(17)

    const ageRows = rows.filter((r) => r.item === 'age')
    expect(ageRows.map((r) => r.id)).toEqual(PV.LEE.ageBands.map((b) => b.id))
    expect(ageRows.map((r) => r.points)).toEqual(PV.LEE.ageBands.map((b) => b.points))
    // the published band edges, as the row's predicate states them
    for (const band of PV.LEE.ageBands) {
      const source = ageRows.find((r) => r.id === band.id) as { values: number[] }
      expect(source.values[0]).toBe(band.from)
      if (band.to !== null) expect(source.values[1]).toBe(band.to)
      else expect(source.values).toHaveLength(1)
    }

    const otherRows = rows.filter((r) => r.item !== 'age')
    expect(otherRows.map((r) => r.fact)).toEqual(PV.LEE.items.map((i) => i.fact))
    expect(otherRows.map((r) => r.points)).toEqual(PV.LEE.items.map((i) => i.points))
  })

  test('Lee’s floor, ceiling, bands and discrimination are its own', () => {
    expect(lee).toContain('export const AGE_MIN = 60')
    expect(lee).toContain('export const AGE_TYPO_MAX = 120')
    const printed = [...lee.slice(lee.indexOf('export const BANDS')).matchAll(/printed: '([^']+)'/g)].map((m) => m[1])
    expect(printed).toEqual(PV.LEE.bands.map((b) => b.printed))
    expect(lee).toContain('discrimination: { development: 0.84, validation: 0.82 }')
    expect(PV.LEE.maxPoints).toBe(26)
    expect(lee).toContain('Object.values(ITEM_MAX).reduce')
  })

  test('the age bands select the same row the paper prints', () => {
    expect(PV.ageBandAt(59)).toBeNull()
    expect(PV.ageBandAt(60)?.id).toBe('age_60_64')
    expect(PV.ageBandAt(65)?.points).toBe(2)
    expect(PV.ageBandAt(84)?.points).toBe(5)
    expect(PV.ageBandAt(85)?.points).toBe(7)
    expect(PV.ageBandAt(130)?.id).toBe('age_85_plus')
  })
})

describe('the wireframe’s underived deltas are nowhere in this work', () => {
  const deltas = ['+3.4', '−3.4', '-3.4', '−2.9', '-2.9', '+1.2', '−1.9', '-1.9', '+0.6', '−0.6']

  test('the module prints none of them', () => {
    for (const delta of deltas) expect([delta, module_.includes(delta)]).toEqual([delta, false])
  })

  test('and neither does the page', () => {
    for (const delta of deltas) expect([delta, page.includes(delta)]).toEqual([delta, false])
  })

  test('the knobs name what stops them instead of inventing a number', () => {
    expect(view.knobs.smoker.detail).toContain('no years are printed')
    expect(view.knobs.steps.detail).toContain('nobody published')
    expect(view.knobs.birth.detail).toContain('the file is not written')
  })
})

describe('the page draws each block, and reads only the document', () => {
  /* `has()` reports a boolean rather than the page: a failing regex should print one line, not
     200 KB of HTML. */
  const has = (re: RegExp) => expect([String(re), re.test(page)]).toEqual([String(re), true])

  test('the module is loaded before the page’s own script', () => {
    const lib = page.indexOf('<script src="lib/profile-view.js"></script>')
    expect(lib).toBeGreaterThan(page.indexOf('<script src="lib/right-panel.js"></script>'))
    expect(lib).toBeLessThan(page.indexOf('<script>\nconst LAYERS'))
  })

  test('the profile view has a place for each of the four blocks', () => {
    const body = page.slice(page.indexOf('id="profileBody"'), page.indexOf('<aside id="rightCol"'))
    for (const id of ['pvCohort', 'pvInputs', 'pvBlind', 'pvBorn', 'pvSmoke', 'stepsNote', 'pvSpan']) {
      expect(body).toContain(`id="${id}"`)
    }
    expect(body).toContain('what each model reads')
    expect(body).toContain('what no model reads')
  })

  test('the blocks are built from the module and from ProfileView, not from a second copy', () => {
    has(/ProfileView\.build\(\{/)
    has(/meta: TL_META,\s*nodes: DOC_NODES,/)
  })

  test('the birth-year knob moves BIRTH — the one value every age on the page is read from', () => {
    expect(page.includes('let DOC_BIRTH = null;')).toBe(true)
    expect(page.includes('DOC_BIRTH = BIRTH;')).toBe(true)
    has(/BIRTH = wanted \? new Date\(wanted, 0, 1\) : DOC_BIRTH;/)
    // the age-shaped outputs really do read BIRTH, so the knob reaches them
    has(/const ageAt = d => \(\+d - \+BIRTH\)/)
    has(/const yrs = BIRTH \? Math\.floor\(ageAt\(dayOf\(state\.date\)\)\) : null;/)
    has(/function workingMeta\(\) \{/)
    has(/meta: workingMeta\(\)/)
  })

  test('and the knob writes nothing: no storage, no fetch, no file', () => {
    const start = page.indexOf('function setBorn(year)')
    const setBorn = page.slice(start, page.indexOf('function pvEl(', start))
    expect(setBorn.length).toBeGreaterThan(200)
    expect(setBorn).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/)
    expect(setBorn).not.toContain('KGDATA')
    expect(setBorn).not.toContain('TL_META.profile.year_of_birth =')
    // the reset path reads the document's own year again rather than a copy of it
    expect(setBorn).toContain('DOC_BIRTH')
  })

  test('a count of people is grouped, and the span is a sentence rather than a label', () => {
    has(/function grouped\(n\) \{ return String\(n\)\.replace/)
    has(/grouped\(l\.developed\)/)
    expect(page).toContain('<div class="pvspan" id="pvSpan">')
  })

  test('a one-point row reads "1 pt", not "1 pts"', () => {
    // Lee's diabetes item and its 60–64 age band are one point each, so the reader sees the
    // singular. "1 pts" is the sort of label a reader stops to disbelieve.
    has(/r\.points \+ \(r\.points === 1 \? " pt" : " pts"\)/)
    expect(page).not.toContain('r.points + " pts"')
  })

  test('the acceptance run can read the blocks as data, like __profile() already does', () => {
    has(/window\.__setBorn = year => \{/)
    has(/window\.__profileBlocks = \(\) => \{/)
    has(/window\.__setSmoke = |window\.__setSmoker = /)
  })
})
