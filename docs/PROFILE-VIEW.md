# Profile view — widget 2, in the same shell

The header's right-hand group ends with the profile: a box reading who the record is about, straight
out of the document — `male · 1961 (65)`. It is a button, and it opens the profile view in the
centre column of this page. No second page, no file of its own: the view draws the record the app
already holds.

The wireframe is `docs/wireframe-health-v11d-profile.svg` (SCRUM-52); the widget numbers are the
registry's (`docs/WIDGETS.md`).

## What it is

| Piece | Where |
|---|---|
| the header button (widget 2) | `body/index.html`, `<div class="bar">`, `#profileBtn`; the text is written by `paintProfileButton()` from `meta.profile` |
| the view | `body/index.html`, `#profileBody` inside `#main` — the centre column, so the ruler, the left list and the right panel stay where they are |
| open / close / repaint | `setProfileView()`, `buildProfile()`, `profileOf()`, and the `profile` field on `state` |
| the cohort, the inputs, the blind spots and the knobs, as rows | `body/lib/profile-view.js` — `ProfileView.build()`; pure, no DOM and no clock, the same shape as `body/lib/right-panel.js` |
| the birth-year knob and the page's reading of the year | `state.born`, `workingYear()`, `workingMeta()`, `setBorn()`, and `DOC_BIRTH` (the document's own date, read again when the knob is reset) |
| what the acceptance run reads | `window.__profile()`, `window.__openProfile()`, `window.__closeProfile()`, `window.__profileBlocks()`, `window.__setBorn()`, `window.__setSmoker()` |
| the rules, pinned without a browser | `scripts/graph-view.test.ts` (SCRUM-49) and `scripts/profile-view.test.ts` (SCRUM-16) |

## The contract

- **The identity is the document's.** Sex, birth year and the age that year makes are read from
  `meta.profile` (`docs/DATA-CONTRACT.md` §Envelope) and written nowhere else. A document with no
  profile says `no profile` in the header and `unnamed profile` in the view; the page never invents
  one.
- **The age is the year's age.** The contract carries a year, not a birthday, so the view prints
  `65 today` and says nothing about months.
- **Nothing is written.** The knobs move the page's reading, never the document. When a knob and the
  file disagree the view says so in the same row — "the document says male · reading as female; the
  file is not written", "the document says 1961 · reading as 1980".
- **Back returns to the same selected date.** Opening and closing changes neither `state.date` nor
  `state.event`; closing rebuilds the centre column from the date, exactly as the graph view does.
  Picking a date anywhere (ruler, player, a row, a linked item) leaves the profile view.
- **One view at a time.** Opening the graph closes the profile view, and ✕ on the centre closes it
  the same way; the two views never argue over the centre column.
- **No number without a source.** Every table in `body/lib/profile-view.js` is held to the file that
  produces it by `scripts/profile-view.test.ts`: SCORE2's ages, regions and six inputs to
  `src/score2.ts`; Lee's seventeen rows, their whole-number points, the age floor, the four bands and
  the discrimination to `src/lee.ts`; the cohort and its sizes to `docs/LEE.md`; the region's cost to
  `docs/SCORE2.md`; the baseline table the sex knob prints to `LE_BY_SEX` in `body/index.html`.

## What this view draws today

| # | Widget | Drawn | Where it comes from |
|---|---|---|---|
| 26 | Subject — name or `unnamed profile`, sex, birth year, age today, and the record's age span | yes | `meta.profile` and the record's own dates |
| 27 | Cohort — SCORE2 (10-year CVD, ages 40–69, four ESC regions, and the region refusal), Lee (HRS 1998 cohort, 11,701 developed / 8,009 validated, four printed bands, c = 0.84 / 0.82) | yes | `src/score2.ts`, `src/lee.ts`, `docs/LEE.md`, `docs/SCORE2.md` |
| 28 | Inputs — every fact each model reads, its state on this record (`●` supplied, `—` nobody asked, `✗` refused), the record and date behind it, Lee's points so far, and the refusals (diabetes and no region on SCORE2; nine missing Lee items) | yes | the document's own nodes, plus the two models' fact lists |
| 29 | What no model reads — family history, sleep, vaccinations, depression, loneliness | yes, as named facts | by absence from both fact lists; Lee's `LIMITS` says social and psychological measures carry no weight |
| 30 | What you may change — sex, birth year, smoker, steps a day | yes, all four | see below |
| 31 | Who may see this record — one file on one device, no accounts, no share link | yes | — |

### The knobs, and the numbers they refuse to print

The wireframe gives each knob a years delta (female, per five years of birth year, smoking, steps).
**No file in this repo derives any of them**, so the page prints none of them — a row that invents a
delta is worse than a row that is not drawn. What each knob does instead:

| Knob | What moving it does |
|---|---|
| sex | moves the forecast's baseline to the other row of the document's own table (`meta.life_expectancy`, default `{ male: 74, female: 80 }`), and says what that table says — `male 74 · female 80`; the difference is computed from the table, never written into the page |
| birth year | moves `BIRTH`, the one value every age on the page is read from: the date readout's `NN y`, the ruler's span, the profile's `N today`, the record's age span, the age the right panel's projection reads. It also states where a model refuses the new age (SCORE2 outside 40–69, Lee under 60) |
| smoker | moves the reading the Lee rows state: current tobacco use is worth 2 of its 26 points, and the row says the file is not written. No years are printed — neither estimate can be evaluated for this record |
| steps a day | not a control: no model here reads a step count, and no effect size with a published source exists, so the row is a refusal in words |

The birth-year knob is T05's acceptance on this page: the graph page's `src/ProfileChip.tsx` has had
it since T05, and the case page did not. Correcting the year recomputes the page's age-shaped
outputs and leaves the file unmodified — `setBorn()` writes `state.born` and `BIRTH`, and nothing
else; `bun run test` and `scripts/profile-view.test.ts` hold the page to that.

## Honest limits

- The two estimates are **not run** in this view. The page cannot evaluate `src/score2.ts` or
  `src/lee.ts` — they are TypeScript modules of the viewer, not part of the single-file page — so the
  view lists what each model reads, and says what stops it, rather than printing a risk or an index.
  For this record SCORE2 refuses on three counts (no region in the file, diabetes in the record, no
  smoking record) and Lee supplies 3 of its 12 items.
- A fact the record does not carry is `—`, never a zero: a missing item is not an absence, which is
  the rule `src/lee.ts` refuses by.
- Nothing here is a prognosis. A Lee band is a group's observed 4-year mortality; SCORE2's number,
  when it can be computed at all, carries its own `limits` sentence wherever it is shown.
