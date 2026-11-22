# Widgets — registry and where to look

Every widget in the health app has one number for its whole life. The same widget keeps its number
in every view; a different widget always gets a new one. Approved core is 1–8; main-view candidates
start at 9; the right panel starts at 19 and is **not approved yet**; the profile view starts at 26.

Look at the wireframes in `docs/`:

| File | What it shows |
|---|---|
| `wireframe-health-v11-analysis.svg` | main view = analysis (lipid panel), right panel candidate |
| `wireframe-health-v11b-diagnosis.svg` | main view = diagnosis, right panel candidate |
| `wireframe-health-v11c-summary.svg` | main view = summary, right panel candidate |
| `wireframe-health-v11d-profile.svg` | main view = profile: who the record is about, the cohort, the inputs, the knobs, who may see it |
| `wireframe-health-v13-past-compared.svg` | past date selected: three columns — related records, the record, and the right panel with both states — solid then, paled now |

All four views share the same header, timeline, left column and right panel. Only column 2 changes.

---

## Approved core — 1 to 8

| # | Widget | Zone | Present in | Behaviour |
|---|---|---|---|---|
| 1 | Graph button | header, in the right-hand group, glued to the left of the profile | v11, v11b, v11c, v11d | a filled 30px square, hexagon with nodes; opens the graph in a separate view. Never part of the main flow. See `docs/GRAPH-VIEW.md` |
| 2 | Profile | header, far right — the second button of that group | v11, v11b, v11c, v11d | a box reading `sex · year (age)` (`male · 1961 (65)`), from `meta.profile` in `kg.json`, never from JS. It is a button: it opens the profile view in the same shell — a view of the record, not a settings page. See `docs/PROFILE-VIEW.md` |
| 3 | Timeline | top strip, full width | v11, v11b, v11c, v11d | one row from birth to +40 years; year ticks; labels every 10; navigator, not decoration |
| 4 | Event marks | on the timeline | v11, v11b, v11c, v11d | one tick and one dot per event; click selects the event; click on empty space between two marks opens the period summary |
| 5 | Zoom window ±2 years | on the timeline, around today | v11, v11b, v11c, v11d | inside the window the scale is per month; outside it is per year. Otherwise a month is half a pixel |
| 6 | Player controls | header of the main view | v11, v11b, v11c, v11d | `start / prev / next / end`; steps between **events in the timeline**. Does not scroll the left list |
| 7 | Related list | left column | v11, v11b, v11c, v11d | one list, newest on top: future above, past below, no FUTURE/PAST captions; mixes analyses, diagnoses, summaries, decisions; the selected row is marked |
| 8 | Selected row | inside 7 | v11, v11b, v11c, v11d | black row; the only marker in the list. There is no separate "selected" widget |

---

## Main view candidates — 9 to 18

Number 9 is the container itself and appears in all four views. Numbers 10–12 exist only in the
analysis view, 14–15 only in the diagnosis view, 16–18 only in the summary view. Number 13 is shared
by the three event views; the profile view does not carry it (see below).

| # | Widget | View | What it shows |
|---|---|---|---|
| 9 | Main view | analysis, diagnosis, summary, profile | header with subject and date; the container the event type fills. The event decides the layout, never the user — the profile is the one container opened by 2 instead of by an event, and what it draws is the record, not a settings form |
| 10 | Panel table | analysis | the whole panel, not one number: marker, value, reference, flag. A lipid panel is four rows, a single test is one row. Fields come from the schema (LOINC code, unit, range) |
| 11 | Source | analysis | lab name and address, collection date, link to the map and to the original scan, `not confirmed` flag when nobody has verified it |
| 12 | Plain meaning | analysis | what the marker is, why it is measured, what it means in human terms, and the bottom line: "not tomorrow, but the clock is running" |
| 13 | Linked items | analysis, diagnosis, summary | links, always: a click opens the item in the main view, hover highlights the matching row in 7. One widget, one number |
| 14 | Verdict | diagnosis | two kinds that never mix: an official note (full text, doctor, clinic, links) or a generated one (badge `not confirmed`, no doctor link). Warnings attach here |
| 15 | Assignments | diagnosis | what was decided to do: tests to clarify, drugs, diet, activity, restrictions. Each line can carry a warning |
| 16 | Plan | summary | what was planned for the period |
| 17 | Fact | summary | what was actually done, with dates |
| 18 | Went to plan / went to hell | summary | two short lists: what held, what was dropped. A summary reports; it does not prescribe |

### Warning icons — inside 14 and 15

| Icon | Meaning |
|---|---|
| yellow triangle with `!` | check before acting. Applies to a generated note and to a doctor's note when a later test contradicts it, or something looks off |
| skull | dangerous, do not act. Reserved for advice that can hurt |
| red `!` on an assignment | known side effect, or we do not trust the generator |
| yellow `!` on an assignment | plausible but unverified |

A model recommendation moves from red to yellow only if one of three holds: there is no alternative,
a real diagnosis exists, or the user already applied it and it helped.

---

## Profile view — 26 to 31

The profile is a view in the same shell, opened by widget 2: same header, same timeline, same left
list, same right panel — only column 2 changes, exactly as in v11, v11b and v11c. Drawn in
`docs/wireframe-health-v11d-profile.svg`. It is not a settings page: nothing on it is saved, and no
row on it changes a record. Widget 13 has no row here — a profile is not a record and links nothing of
its own; the numbers it names are grounded in the right panel (24).

**Drawn today** (`docs/PROFILE-VIEW.md`): 26, the sex knob of 30, and 31. 27, 28, 29 and 30's other
knobs need the estimates' own inputs on screen and arrive with the profile-view card; the view draws
no placeholder for a block it has not got.

| # | Widget | What it shows |
|---|---|---|
| 26 | Subject | who the record is about: the name, or `unnamed profile` when the file has none; sex; birth year; and age today. Identity lives in `meta.profile` and nowhere else. The document carries a year and not a birthday, so the age is the year's age and the page says so |
| 27 | Cohort | what the forecast is measured against: SCORE2 (10-year CVD, ages 40–69, no previous CVD) together with the ESC region, which is asked once per person and is not in the document; and Lee's cohort (HRS 1998, US adults over 50, 11,701, validated in 8,009). Both are group numbers — a median and a band — and are labelled as such |
| 28 | Inputs | every fact each model reads, with its state: `●` scored, `○` supplied and did not score, `—` nobody asked. And the refusal where it belongs: diabetes is not a SCORE2 input and the model is not for people with diabetes, so that row refuses the record instead of printing a number |
| 29 | What no model reads | family history, sleep, vaccinations, depression, loneliness: named on the page, kept in the record as facts, never folded into the number and never smoothed away |
| 30 | Knobs | the four facts the reader may change — sex, birth year, smoker, steps a day — each with what moving it does to the forecast, in years. A knob recomputes the same two scales with one fact moved and writes nothing; a record changes when a document says so. The step row carries the one number in the forecast with no PMID behind it, and it says so |
| 31 | Who may see it | one file on one device: whoever holds the file sees everything in it. No accounts, no share link, no per-panel permission — the service is not built |

---

## Right panel — 19 to 25 (candidates, not approved)

Present only as a sketch in the four v11 files. Numbers are reserved so they never collide with
the core:

| # | Widget | What it would show |
|---|---|---|
| 19 | Panel header | "forecast and recommendations", with the selected date and, on a past record, today |
| 20 | Forecast | one number in years, in one state per column; labelled as the page's own projection, not a promise. An interval is shown only when the document publishes one — this baseline publishes none, so there is no interval row rather than an invented band |
| 21 | What moves it | the factors the estimate is explained by — LDL, blood pressure, age, statin, smoking, steps — each with what the document records and the record it came from, in both states. A measurement that is not one of those factors is not a driver; a factor whose record carries no effect size shows a dash, never `+0.0` (owner audit, 2026-11-22: the list was showing ALT, blood count, HbA1c and fasting glucose at +0.0) |
| 22 | Recommended on this date | what was advised, with the source document and its status on that date |
| 23 | What we do not know | explicit list of missing data and model blind spots; a gap that has since closed reads as known in the now column |
| 24 | On what grounds | the baseline, the model, and how many records stand behind the number on each date |
| 25 | Empty state | "not enough data" instead of a fake number |

---

### Two states — 20 to 24 (owner correction, 2026-11-22)

A past record must not pretend it knew what we know now, and it must not show today's numbers in the
past's place either. The panel therefore shows **both states at once**, in one panel, in the same
sections and on one scale:

| State | When | How it looks |
|---|---|---|
| then | always; it is the selected date | solid, full contrast; every number is computed from the records that existed on that date |
| now | only when the selected date is before today | the same rows at 42% opacity, labelled `now`; every number is computed from today's records |

The two columns sit side by side inside each section: the forecast states the two values and the
delta in words beside them (`+2.2 years since 2021-05-14` / `+3.6 of it — Atorvastatin 20 mg
(2026-08-19)`); the tables state `then` and `now` per row, so the same track is read against itself.
Widget 22 keeps the advice's source in both columns and its status changes with the date (`not
started yet` then, `since 2026-08-19` now). A gap in 23 that has closed since reads as known in the
paled column.

A record dated today, or the today summary, has one state: one solid column, no paled row, and no
delta. A date before the first record has no `then` forecast: the column says `not enough data`, the
`now` column still shows today's number, and the delta says it cannot compare. An empty document
shows widget 25 instead of the panel.

The rejected v12 ghost — a dimmed copy carrying today's numbers under a past date, with a label
admitting it — is not a state. It showed the right numbers in the wrong place: the reader had to
translate a number backwards in time to use it. See `wireframe-health-v13-past-compared.svg`.

### How the page composes them (owner correction, 2026-11-22)

The three columns stand side by side at one time: related records, the record itself, and the
panel — and the record's column is filled when the page opens, on the latest record the document
holds. The panel is the width the compared pair needs, and the panel's blocks are one two-track
grid: `then` is the left half of every block and `now` the right half, so a forecast value in 20
stands in the same column as the same factor's value in 21 and the reader's eye can run down one
column. A factor the document had not recorded on the selected date keeps its name in the `then`
half and says `not recorded on this date`; the `now` half says what it says today. Closing the
record's column does not leave the panel floating beside an empty one — the two remaining columns
take the page. Drawn in `wireframe-health-v13-past-compared.svg`.

## Rules that apply to every widget

1. One number per widget, forever. Reuse the number, never the layout.
2. No number is shown to the user: numbers exist for review only.
3. Explanatory text on a wireframe is not a UI element and never gets a number.
4. If a field is missing, the row is hidden — the layout must not break.
5. Anything generated by a model carries `not confirmed` until a person confirms it.
6. Every number in the UI carries a source, or it is not shown.
7. Every UI card names the exact wireframe file(s) it implements, by path, and its PR attaches a
   screenshot of the built page beside that wireframe. If the wireframe does not settle something,
   ask on the card — do not invent a layout. No card may cite only a plan doc for its layout.
