/**
 * The person the document is about: `meta.profile`, read, and nothing else.
 *
 * Identity lives in one place (docs/DATA-CONTRACT.md §Envelope): `sex` and `year_of_birth` are
 * required, `name` is optional. The page reads that object; it does not carry a birth year of its
 * own, because a constant in the template is a person the reader never chose — that is the defect
 * T01 removed (`1984-03-01` hardcoded in the page) and the reason this module exists.
 *
 * Everything age-dependent comes through `ageAt()`, so that correcting the year in the controls
 * moves the age beside the profile and every age a later estimate is built from, in one step. A
 * document without a profile has no age at all: `readProfile()` says what is wrong and returns
 * nothing, rather than handing the page a plausible person to draw (PRODUCT.md: an empty profile
 * must not look broken; it must not be filled in either).
 *
 * Pure on purpose — no React, no DOM — so the same rules run in the controls, in the tests, and in
 * whatever computes estimates next (T14, the rules engine).
 */

/** What the document says about its subject. `name: null` is "there is no name", not "unknown". */
export type Profile = {
  sex: string
  year_of_birth: number
  name?: string | null
}

/** The profile, or the reasons there is none. Never a default person. */
export type ProfileReading = { profile: Profile | null; problems: string[] }

/** An age, with the two facts it was computed from, so a caller can say where the number came from. */
export type Age = { age: number; born: number; on: string }

/** The span the document covers, in the only unit the profile can express it: age. */
export type RecordAges = { first: string; last: string; fromAge: number; toAge: number; dated: number }

/** The bounds the health contract puts on `year_of_birth` (scripts/schema/kg-1-health.schema.json). */
const YEAR_MIN = 1900
const YEAR_MAX = 2200

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const YEAR_OF = /^(\d{4})-\d{2}-\d{2}$/

/**
 * Read `meta.profile` — or the same shape anywhere it is handed to us.
 *
 * The bounds and the required fields are the ones the schema enforces, restated here in words a
 * reader of the page can act on: the validator refuses the document, and this panel says which
 * field to fix. A bad `name` is reported and dropped; sex and year are what the page cannot work
 * without.
 */
export function readProfile(meta: unknown): ProfileReading {
  const holder = meta && typeof meta === 'object' ? (meta as { profile?: unknown }) : undefined
  const raw = holder ? holder.profile : undefined

  if (raw === undefined || raw === null) {
    return {
      profile: null,
      problems: ['meta.profile is missing: this document does not say who it is about'],
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { profile: null, problems: ['meta.profile is not an object'] }
  }

  const fields = raw as Record<string, unknown>
  const problems: string[] = []

  const sex = typeof fields.sex === 'string' ? fields.sex.trim() : ''
  if (!sex) problems.push('profile.sex is missing: the page cannot guess it')

  const year = fields.year_of_birth
  if (year === undefined || year === null) {
    problems.push('profile.year_of_birth is missing')
  } else if (typeof year !== 'number' || !Number.isInteger(year)) {
    problems.push('profile.year_of_birth is not a whole year')
  } else if (year < YEAR_MIN || year > YEAR_MAX) {
    problems.push(`profile.year_of_birth is outside ${YEAR_MIN}–${YEAR_MAX}`)
  }

  let name: string | null = null
  if (typeof fields.name === 'string') name = fields.name
  else if (fields.name !== undefined && fields.name !== null) problems.push('profile.name is not text')

  const usable =
    sex !== '' &&
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= YEAR_MIN &&
    year <= YEAR_MAX

  return {
    profile: usable ? { sex, year_of_birth: year, name } : null,
    problems,
  }
}

/**
 * How old the person is on a given date.
 *
 * A birth *year* is all the contract carries, so this is the age in that calendar year: exact to
 * the year, not to the day. The page therefore says "age 65" and never "65 years and 3 months" —
 * one of those would be a guess dressed as a measurement. `null` when the date is not a date, or
 * when the document contradicts itself and dates the record before the person was born.
 */
export function ageAt(profile: Profile, on: string): Age | null {
  if (!ISO_DATE.test(on)) return null
  const born = profile.year_of_birth
  const year = Number(on.slice(0, 4))
  if (!Number.isInteger(year) || year < born) return null
  return { age: year - born, born, on }
}

/**
 * "Today" as the document counts it.
 *
 * `meta.timezone` is optional; when the document names a zone this host does not know, the
 * machine's own date is the honest fallback rather than a wrong one. The page needs a date at all
 * because an age is only meaningful on one.
 */
export function todayIn(timezone: string | undefined, now: Date = new Date()): string {
  if (typeof timezone === 'string' && timezone.trim()) {
    try {
      const stamp = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
      if (ISO_DATE.test(stamp)) return stamp
    } catch {
      /* an unknown zone is not a reason to stop reading the record */
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The years the record covers, as ages.
 *
 * This is what the profile changes on this page: correct the birth year and every dated fact
 * moves to a different age, because nothing here is stored — the span is derived from `when` and
 * the profile each time it is read. A node dated before the birth year yields a negative age
 * deliberately: the document is contradicting itself, and the page says so instead of clamping it
 * into a shape that looks plausible.
 */
export function recordAges(
  nodes: readonly { when?: unknown }[],
  profile: Profile,
): RecordAges | null {
  const dates: string[] = []
  let dated = 0

  for (const node of nodes) {
    const when = node ? node.when : undefined
    const found: string[] = []
    if (typeof when === 'string') {
      if (ISO_DATE.test(when)) found.push(when)
    } else if (when && typeof when === 'object') {
      const span = when as { from?: unknown; to?: unknown }
      if (typeof span.from === 'string' && ISO_DATE.test(span.from)) found.push(span.from)
      if (typeof span.to === 'string' && ISO_DATE.test(span.to)) found.push(span.to)
    }
    if (found.length) {
      dates.push(...found)
      dated += 1
    }
  }

  if (!dates.length) return null
  dates.sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  const born = profile.year_of_birth
  const yearOf = (d: string) => Number((YEAR_OF.exec(d) as RegExpExecArray)[1])
  return { first, last, fromAge: yearOf(first) - born, toAge: yearOf(last) - born, dated }
}
