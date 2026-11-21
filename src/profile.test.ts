/**
 * The profile is data. These tests hold the two halves of that sentence apart:
 *
 *   1. reading — what the page says about a person comes from `meta.profile`, and a document
 *      without one gets "no profile", never a birth year the page made up;
 *   2. deriving — every age the page shows is computed from that profile at read time, so
 *      correcting the year moves all of them and nothing has to be re-saved.
 *
 * The bug these fence: `1984-03-01` was hardcoded in the page, so the app was about a person the
 * reader never chose (T01), and T05 is the card that made identity data.
 *
 *   bun test src/profile.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { ageAt, readProfile, recordAges, todayIn } from './profile'

const MAN_65 = { sex: 'male', year_of_birth: 1961, name: 'Andrei' }

describe('meta.profile', () => {
  test('sex, birth year and an optional name come from the document', () => {
    const read = readProfile({ profile: MAN_65 })
    expect(read.profile).toEqual({ sex: 'male', year_of_birth: 1961, name: 'Andrei' })
    expect(read.problems).toEqual([])
  })

  test('a name is optional and `null` means "there is none"', () => {
    expect(readProfile({ profile: { sex: 'female', year_of_birth: 1980, name: null } }).profile).toEqual({
      sex: 'female',
      year_of_birth: 1980,
      name: null,
    })
    expect(readProfile({ profile: { sex: 'female', year_of_birth: 1980 } }).problems).toEqual([])
  })

  test('a document without a profile gets no person, and a reason in words', () => {
    const missing = readProfile({ title: 'someone' })
    expect(missing.profile).toBeNull()
    expect(missing.problems[0]).toContain('meta.profile is missing')

    // Empty is a state, not a person: nothing is defaulted to 1961 or to male.
    expect(readProfile(undefined).profile).toBeNull()
    expect(readProfile({ profile: 'male, 1961' }).profile).toBeNull()
  })

  test('sex and year are required; a half-stated profile is refused', () => {
    expect(readProfile({ profile: { sex: '', year_of_birth: 1961 } }).profile).toBeNull()
    expect(readProfile({ profile: { year_of_birth: 1961 } }).problems).toContain(
      'profile.sex is missing: the page cannot guess it',
    )
    const noYear = readProfile({ profile: { sex: 'male' } })
    expect(noYear.profile).toBeNull()
    expect(noYear.problems).toContain('profile.year_of_birth is missing')
  })

  test('a year is a whole year inside 1900–2200 — the schema bounds, not a rounding', () => {
    for (const bad of ['1961', 1961.5, 1899, 2201, Number.NaN]) {
      expect(readProfile({ profile: { sex: 'male', year_of_birth: bad } }).profile).toBeNull()
    }
    expect(readProfile({ profile: { sex: 'male', year_of_birth: 1900 } }).profile).not.toBeNull()
    expect(readProfile({ profile: { sex: 'male', year_of_birth: 2200 } }).profile).not.toBeNull()
  })

  test('a bad name is reported and dropped; it does not take the person with it', () => {
    const read = readProfile({ profile: { sex: 'male', year_of_birth: 1961, name: 7 } })
    expect(read.profile).toEqual({ sex: 'male', year_of_birth: 1961, name: null })
    expect(read.problems).toContain('profile.name is not text')
  })

  test('a sex outside the controls keeps its word instead of being corrected', () => {
    expect(readProfile({ profile: { sex: 'intersex', year_of_birth: 1990 } }).profile?.sex).toBe('intersex')
    expect(readProfile({ profile: { sex: '  male ', year_of_birth: 1990 } }).profile?.sex).toBe('male')
  })
})

describe('age', () => {
  const man = readProfile({ profile: MAN_65 }).profile
  if (!man) throw new Error('the fixture profile must read')

  test('age is the difference in years, and it is the same all year long', () => {
    // The contract carries a birth *year*, not a birthday: one of these two is right and the page
    // must not pretend to know which, so both read 65 — never 64 years and 11 months.
    expect(ageAt(man, '2026-01-01')?.age).toBe(65)
    expect(ageAt(man, '2026-11-12')?.age).toBe(65)
    expect(ageAt(man, '2027-01-01')?.age).toBe(66)
    expect(ageAt(man, '1961-06-01')?.age).toBe(0)
  })

  test('the age carries the two facts it came from', () => {
    expect(ageAt(man, '2026-11-12')).toEqual({ age: 65, born: 1961, on: '2026-11-12' })
  })

  test('a record dated before the birth year has no age — no negative one either', () => {
    expect(ageAt(man, '1959-05-01')).toBeNull()
    expect(ageAt(man, 'yesterday')).toBeNull()
  })
})

describe('today', () => {
  const at = new Date('2026-11-21T22:30:00Z')

  test('today is the document’s today, not the machine’s', () => {
    expect(todayIn('Pacific/Kiritimati', at)).toBe('2026-11-22')
    expect(todayIn('America/Anchorage', at)).toBe('2026-11-21')
  })

  test('without a zone — or with one this host does not know — today is the machine’s', () => {
    const local = todayIn(undefined, at)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayIn('Mars/Olympus', at)).toBe(local)
  })
})

describe('recompute', () => {
  const nodes = [
    { when: '2021-05-14' },
    { when: '2026-11-12' },
    { when: { from: '2019-02-01', to: null } },
    { when: 'not a date' },
    { label: 'a source node has no date' },
  ]

  test('the record spans ages, and correcting the year moves the whole span', () => {
    const before = readProfile({ profile: MAN_65 }).profile
    const after = readProfile({ profile: { sex: 'male', year_of_birth: 1980 } }).profile
    if (!before || !after) throw new Error('both fixture profiles must read')

    const a = recordAges(nodes, before)
    const b = recordAges(nodes, after)
    expect(a).toEqual({ first: '2019-02-01', last: '2026-11-12', fromAge: 58, toAge: 65, dated: 3 })
    // Nineteen years later: the document did not change, only the profile did.
    expect(b).toEqual({ first: '2019-02-01', last: '2026-11-12', fromAge: 39, toAge: 46, dated: 3 })
  })

  test('undated nodes are not ages, and a record with no dates has no span', () => {
    expect(recordAges([{ when: 'not a date' }, {}], { sex: 'male', year_of_birth: 1961 })).toBeNull()
    expect(recordAges([], { sex: 'male', year_of_birth: 1961 })).toBeNull()
  })

  test('an interval contributes both ends but counts as one event', () => {
    const span = recordAges(
      [{ when: { from: '2018-03-01', to: '2020-07-01' } }, { when: { from: '2021-01-01' } }],
      { sex: 'female', year_of_birth: 2000 },
    )
    expect(span).toEqual({ first: '2018-03-01', last: '2021-01-01', fromAge: 18, toAge: 21, dated: 2 })
  })

  test('a record dated before the birth year shows the contradiction, not a clamp', () => {
    // A wrong profile is visible: the page says age -3 rather than hiding the disagreement.
    expect(recordAges([{ when: '1998-01-01' }], { sex: 'male', year_of_birth: 2001 })?.fromAge).toBe(-3)
  })
})
