import { useMemo, useState } from 'react'
import type { Kg } from './kg'
import { type Profile, ageAt, readProfile, recordAges, todayIn } from './profile'

/**
 * Widget 2: who this record is about, and the controls that change it.
 *
 * The chip reads `meta.profile` and nothing else — the birth year on screen is the one in the
 * file, and a document without a profile says so instead of showing a plausible person. Clicking
 * opens the controls, and an edit changes the page's working copy, never the file: a page opened
 * over `file://` may not write to the reader's disk, and the document has an owner (the same rule
 * DocPanel states about notes). The changed profile can be copied out and handed to the agent
 * that holds `kg.json`.
 *
 * What the year actually moves is the age, everywhere: the age in the chip, the age the record
 * spans, and — through `ageAt()` — the age any estimate is computed from. Nothing derived from
 * the profile is stored, so a corrected year recomputes all of it in one render.
 */

/** The document's values in a form a control can hold: a half-typed year is text, not an estimate. */
type Draft = { name: string; sex: string; year: string }

/** The sexes the controls offer. The contract keeps `sex` a free string, so a document that says
 *  something else keeps its word — see `shown.sex` below — instead of being silently corrected.
 *  Leaving the field empty is "not stated", which the validator then reports as missing. */
const SEXES = ['female', 'male', 'other']

const label = (sex: string) => (sex === 'unknown' ? 'not stated' : sex)

export default function ProfileChip({ kg }: { kg: Kg }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')

  /** What the file says. Re-read only when the document changes. */
  const document = useMemo(() => readProfile(kg.meta), [kg])

  const today = todayIn(kg.meta?.timezone)

  /** What the page works with: the file, unless the reader has changed something. */
  const working = useMemo(() => {
    if (!draft) return document
    const year = draft.year.trim()
    return readProfile({
      profile: {
        name: draft.name.trim() || null,
        sex: draft.sex.trim(),
        year_of_birth: year === '' ? undefined : Number(year),
      },
    })
  }, [draft, document])

  const profile: Profile | null = working.profile
  const age = profile ? ageAt(profile, today) : null

  /** The dates in the record, so the profile has something to be an age of. */
  const nodes = useMemo(() => {
    const out: { when?: unknown }[] = []
    kg.graph.forEachNode((_id, attrs) => {
      out.push({ when: (attrs as Record<string, unknown>).when })
    })
    return out
  }, [kg])
  const ages = profile ? recordAges(nodes, profile) : null

  const shown: Draft = draft ?? {
    name: document.profile?.name ?? '',
    sex: document.profile?.sex ?? '',
    year: document.profile ? String(document.profile.year_of_birth) : '',
  }
  const edit = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft({ ...shown, [field]: event.target.value })

  /** The profile as it would sit in `kg.json`, for the handoff to whoever owns the file. */
  const handoff = profile
    ? JSON.stringify(
        { sex: profile.sex, year_of_birth: profile.year_of_birth, name: profile.name ?? null },
        null,
        2,
      )
    : ''

  const copyProfile = async () => {
    try {
      await navigator.clipboard.writeText(handoff)
      setCopy('done')
    } catch {
      // file:// pages and locked-down browsers refuse the clipboard: the text is selectable above,
      // so the handoff is slower, not lost.
      setCopy('failed')
    }
  }

  const summary = profile
    ? `${profile.name ? `${profile.name} · ` : ''}${profile.sex} · born ${profile.year_of_birth}${
        age ? ` · age ${age.age}` : ''
      }`
    : 'no profile in this document'

  return (
    <>
      <button
        className="profile"
        data-profile={profile ? `${profile.sex}|${profile.year_of_birth}` : 'none'}
        data-profile-age={age ? age.age : ''}
        data-profile-source={draft ? 'edited' : 'document'}
        aria-expanded={open}
        aria-controls="profile-controls"
        title={`${summary} — open the profile controls`}
        onClick={() => setOpen((was) => !was)}
      >
        {profile ? (
          <>
            {profile.name ? <b className="nm">{profile.name}</b> : null}
            <span className="sex">{label(profile.sex)}</span>
            <span className="born">{profile.year_of_birth}</span>
            {age ? <span className="age">age {age.age}</span> : null}
          </>
        ) : (
          <span className="none">no profile</span>
        )}
      </button>

      {open ? (
        <div
          className="profile-pop"
          id="profile-controls"
          role="dialog"
          aria-label="profile"
          data-profile-panel="open"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        >
          <div className="pop-head">
            <b>who this record is about</b>
            <button className="x" aria-label="close the profile controls" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>

          <label className="row">
            <span>name</span>
            <input value={shown.name} placeholder="optional" onChange={edit('name')} />
          </label>

          <label className="row">
            <span>sex</span>
            <select value={shown.sex} onChange={edit('sex')}>
              <option value="">not stated</option>
              {shown.sex && !SEXES.includes(shown.sex) ? (
                <option value={shown.sex}>{shown.sex}</option>
              ) : null}
              {SEXES.map((sex) => (
                <option key={sex} value={sex}>
                  {sex}
                </option>
              ))}
            </select>
          </label>

          <label className="row">
            <span>born</span>
            <input
              className="year"
              inputMode="numeric"
              value={shown.year}
              placeholder="yyyy"
              onChange={edit('year')}
            />
          </label>

          <div className="derived">
            <span className="h">derived from this profile</span>
            <span className="v" data-derived-age={age ? age.age : ''}>
              {age ? `age ${age.age} today (${today})` : 'age unknown — no year of birth'}
            </span>
            <span className="v" data-derived-span={ages ? `${ages.fromAge}-${ages.toAge}` : ''}>
              {!profile
                ? 'without a year of birth there is no age to put the record’s dates on'
                : ages
                  ? `the record runs from age ${ages.fromAge} to ${ages.toAge} — ${ages.dated} dated ${
                      ages.dated === 1 ? 'event' : 'events'
                    }`
                  : 'the record has no dated events yet'}
            </span>
          </div>

          {working.problems.length ? (
            <ul className="issues" data-profile-issues={working.problems.length}>
              {working.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          {profile ? (
            <>
              <label className="row handoff">
                <span>kg.json</span>
                <textarea readOnly rows={4} value={handoff} spellCheck={false} />
              </label>
              <div className="acts">
                <button onClick={copyProfile}>
                  {copy === 'done'
                    ? 'copied'
                    : copy === 'failed'
                      ? 'copy refused — select the text'
                      : 'copy profile'}
                </button>
                {draft ? (
                  <button onClick={() => setDraft(null)}>revert to the document</button>
                ) : null}
              </div>
            </>
          ) : null}

          <p className="note">
            This page cannot write to <code>kg.json</code>: a page opened from a file may not write
            to your disk, and the document has an owner.{' '}
            {profile
              ? 'Copy the profile and hand it to the agent that holds the file.'
              : 'Fill in the year of birth and the sex, then hand them to the agent that holds the file.'}
          </p>
        </div>
      ) : null}
    </>
  )
}
