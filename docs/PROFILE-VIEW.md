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
| what the acceptance run reads | `window.__profile()`, `window.__openProfile()`, `window.__closeProfile()` |
| the rules, pinned without a browser | `scripts/graph-view.test.ts`, the `SCRUM-49` suite |

## The contract

- **The identity is the document's.** Sex, birth year and the age that year makes are read from
  `meta.profile` (`docs/DATA-CONTRACT.md` §Envelope) and written nowhere else. A document with no
  profile says `no profile` in the header and `unnamed profile` in the view; the page never invents
  one.
- **The age is the year's age.** The contract carries a year, not a birthday, so the view prints
  `65 today` and says nothing about months.
- **Nothing is written.** The one knob the view carries is the sex switch, and it moves the page's
  forecast baseline (`RightPanel`), never the document. When the knob and the file disagree the view
  says so in the same row — "the document says male · reading as female; the file is not written".
- **Back returns to the same selected date.** Opening and closing changes neither `state.date` nor
  `state.event`; closing rebuilds the centre column from the date, exactly as the graph view does.
  Picking a date anywhere (ruler, player, a row, a linked item) leaves the profile view.
- **One view at a time.** Opening the graph closes the profile view, and ✕ on the centre closes it
  the same way; the two views never argue over the centre column.

## What this view draws today

| # | Widget | Drawn |
|---|---|---|
| 26 | Subject — name or `unnamed profile`, sex, birth year, age today | yes |
| 30 | What you may change — **the sex knob only** | part |
| 31 | Who may see this record — one file on one device, no accounts, no share link | yes |
| 27 | Cohort — SCORE2 and Lee, with their regions and bands | not yet |
| 28 | Inputs — what each model reads and what it refuses | not yet |
| 29 | What no model reads — family history, sleep, vaccinations | not yet |
| 30 | the birth-year, smoker and steps knobs | not yet |

The missing rows need the estimates' own inputs on screen, which is the profile-view card's work, not
the header's. The view says nothing it cannot show, and draws no placeholder for a block it has not
got: a block that is not there is a card, not a lie.
