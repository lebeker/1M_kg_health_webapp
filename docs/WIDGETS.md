# Widgets — registry and where to look

Every widget in the health app has one number for its whole life. The same widget keeps its number
in every view; a different widget always gets a new one. Approved core is 1–8; main-view candidates
start at 9; the right panel starts at 19 and is **not approved yet**.

Look at the wireframes in `docs/`:

| File | What it shows |
|---|---|
| `wireframe-health-v11-analysis.svg` | main view = analysis (lipid panel), right panel candidate |
| `wireframe-health-v11b-diagnosis.svg` | main view = diagnosis, right panel candidate |
| `wireframe-health-v11c-summary.svg` | main view = summary, right panel candidate |
| `wireframe-health-v12-past-ghost.svg` | past date selected: right panel as a dimmed ghost copy (rejected 2026-11-22) |
| `wireframe-health-v13-past-then-now.svg` | past date selected: the right panel with both states — solid then, paled now |

All three share the same header, timeline and left column. Only column 2 changes.

---

## Approved core — 1 to 8

| # | Widget | Zone | Present in | Behaviour |
|---|---|---|---|---|
| 1 | Graph button | header, glued to the left of the profile | v11, v11b, v11c | square icon, hexagon with nodes; opens the graph in a separate view. Never part of the main flow. See `docs/GRAPH-VIEW.md` |
| 2 | Profile | header, far right | v11, v11b, v11c | sex, birth year, age; data comes from `kg.json`, not from JS. Opens profile controls |
| 3 | Timeline | top strip, full width | v11, v11b, v11c | one row from birth to +40 years; year ticks; labels every 10; navigator, not decoration |
| 4 | Event marks | on the timeline | v11, v11b, v11c | one tick and one dot per event; click selects the event; click on empty space between two marks opens the period summary |
| 5 | Zoom window ±2 years | on the timeline, around today | v11, v11b, v11c | inside the window the scale is per month; outside it is per year. Otherwise a month is half a pixel |
| 6 | Player controls | header of the main view | v11, v11b, v11c | `start / prev / next / end`; steps between **events in the timeline**. Does not scroll the left list |
| 7 | Related list | left column | v11, v11b, v11c | one list, newest on top: future above, past below, no FUTURE/PAST captions; mixes analyses, diagnoses, summaries, decisions; the selected row is marked |
| 8 | Selected row | inside 7 | v11, v11b, v11c | black row; the only marker in the list. There is no separate "selected" widget |

---

## Main view candidates — 9 to 18

Number 9 is the container itself and appears in all three views. Numbers 10–12 exist only in the
analysis view, 14–15 only in the diagnosis view, 16–18 only in the summary view. Number 13 is shared
by all three.

| # | Widget | View | What it shows |
|---|---|---|---|
| 9 | Main view | analysis, diagnosis, summary | header with subject and date; the container the event type fills. The event decides the layout, never the user |
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

## Right panel — 19 to 25 (candidates, not approved)

Present only as a sketch in the three v11 files. Numbers are reserved so they never collide with
the core:

| # | Widget | What it would show |
|---|---|---|
| 19 | Panel header | "forecast and recommendations", with the selected date and, on a past record, today |
| 20 | Forecast | one number in years, in one state per column; labelled as the page's own projection, not a promise. An interval is shown only when the document publishes one — this baseline publishes none, so there is no interval row rather than an invented band |
| 21 | What moves it | drivers with +/− deltas, the same tracks on both columns, one scale |
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
translate a number backwards in time to use it. See `wireframe-health-v13-past-then-now.svg`.

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
