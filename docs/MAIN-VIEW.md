# Main view — one view per event type (T11)

The centre answers "the selected event, in full". The event decides the layout; the reader never
switches a mode. The rules live in `body/lib/main-view.js` (pure, DOM-free) and are stated as data
in `scripts/main-view.test.ts`; the page only decides what the view looks like.

| Event kind | View | Widgets |
|---|---|---|
| `analysis`, `observation` | panel | 9 main view, 10 panel table, 11 source, 12 plain meaning, 13 linked items |
| `condition` (a diagnosis) | verdict | 9, 14 verdict, 15 assignments, 13 linked items |
| `summary`, and the two generated rows (`today`, `annual:YYYY`) | period | 9, 16 plan, 17 fact, 18 went to plan / went to hell |
| anything else (`decision`, `medication`, `procedure`, `encounter`, `prediction`) | record | 9, 13 — the record's own facts. It is not a state, so it gets no panel and no verdict |

Widget numbers are the registry's (`docs/WIDGETS.md`); the same widget keeps its number in every
view.

## What a warning means

| Mark | Where | Meaning |
|---|---|---|
| yellow triangle `⚠` | the verdict | check before acting. A generated note always carries it; a doctor's note carries it when a later test **contradicts** it (an edge `contradicts`, observation → condition, dated after the note), or when the document says `warning: "check"` |
| skull `☠` | the verdict, an assignment | dangerous, do not act. Only for `warning: "danger"` |
| red `!` | an assignment | a known side effect (`side_effect: true`) or low trust in the generator (`trust: "low"`) |
| yellow `!` | an assignment | plausible but unverified (`trust: "unverified"`), or model advice that one of the three escape conditions lifted out of red |

**The rule that moves a red `!` to yellow.** Model advice (`trust: "low"`) stays red unless one of
three things is true — then it is yellow, and the title says which:

1. `no_alternative: true` — there is nothing else to do;
2. the note it hangs off is a **real** diagnosis — kind `condition`, status `active` or `resolved`,
   and an official note (`origin: "doctor"`, or `confirmed` with a doctor or a clinic named and no
   `origin` at all). A suspected or generated diagnosis is not one;
3. `applied: true` and `helped: true` — the reader used it and it helped.

A known side effect is red and stays red: the escape rule is about model advice, not about danger.

## Fields the views read

The contract (`docs/DATA-CONTRACT.md`, `scripts/schema/kg-1-health.schema.json`) types the event
spine. A document may always carry extra keys — they are carried through untouched — and this is
the small set the main view reads. Every one is optional: a missing key hides its row or line, and
never becomes a blank, a zero or a guess.

### Analysis

| Key | On | What it is |
|---|---|---|
| `values[]` | analysis | the whole panel: `{name, value, unit, ref: [low, high], flag, code}`. A single test is one row, either here or as the observation's own `value` / `unit` / `ref_low` / `ref_high` / `flag` |
| `flag` | value | `low` / `normal` / `high` / `critical` **as the lab printed it**. When the report printed none, the table compares the value with the reference and marks that word as the page's own reading — it is never dressed up as the lab's |
| `panel` | analysis | the panel's name, in the sub-line |
| `source` | analysis | the `document` node behind it. The lab, the address and the scan come from it (`lab`, `address`, `link`) or from the analysis itself |
| `scan` | analysis | a link to the original scan, when it is not the document's `link` |
| `summary` or `meaning` | analysis | the plain-language meaning. `summary` is the demo's word for it |
| `code` | value / observation | LOINC for a marker, ICD-10 or SNOMED on a condition |

What is missing is printed: *missing: no document behind it · no lab named · no address · no scan
to open.* An empty block would be a lie about a gap.

### Diagnosis

| Key | On | What it is |
|---|---|---|
| `origin` | condition | `doctor` or `generated`. With no `origin`, a note is official only if it is `confirmed` **and** names a doctor or a clinic |
| `text` (or `summary`) | condition | the note in full. The verdict shows `text` first |
| `doctor`, `clinic` | condition | `{name, specialty}`, `{name, address}`, or a plain string. Never rendered on a generated note |
| `link`, `links[]`, `scan` | condition | the note itself and anything it points at. One line per href: a note whose only link is its own `scan` still shows it, as *the original scan* |
| `warning` | condition | `check` or `danger`, when something the data cannot show makes the note doubtful |
| `decided_in` | an assignment | the id of the note that decided it |
| `assignment` | an assignment | `test`, `drug`, `diet`, `activity` or `restriction` — the five groups. Without it, `medication` falls into drugs, `procedure` and `prediction` into tests, and anything else is **not** an assignment (it is never guessed into a group) |
| `trust` | an assignment | `low`, `untrusted`, `unverified`, `verified` |
| `no_alternative`, `applied`, `helped`, `side_effect` | an assignment | the inputs to the red → yellow rule above |
| `status` | condition | `active`, `resolved`, `suspected`, `stopped`; only `active` and `resolved` count as a real diagnosis |

An assignment is a node that names the note in `decided_in`, or that an edge the contract already
has joins to it (`treated_by` from the condition, `advised` out of it). Under *what was decided* the
line is the decision's own name — `label` — not its prose; its `text` follows as a second line when
it says something the name does not. A generator's commentary is never the decision.

### Summary

| Key | On | What it is |
|---|---|---|
| `period` | summary | the period in words. With none, *period ending <date>* |
| `plan` (or `planned`) | summary | what was planned, as lines |
| `fact` (or `done`) | summary | what was actually done |
| `held` (or `went_to_plan`) | summary | what held |
| `dropped` (or `went_to_hell`) | summary | what was dropped |

A **generated** summary — the `today` row and an `annual:YYYY` marker — cannot judge: it counts the
plan items and the events inside its period, and says in one line that nobody has said what held
and what was dropped. It does not invent the two lists.

**A summary draws no links and no assignments.** That is the acceptance, not an omission: a summary
reports; it does not prescribe. `summaryOf` returns only the six fields above, so a link cannot leak
into it by accident.

## Linked items

Widget 13, present in every view that has one (analysis, diagnosis, record — never a summary). An
item is an edge around the record, or, for a decision, the note named in `decided_in`. A click opens
that item in this view (the ruler moves to its day, the row is marked); hovering it highlights the
matching row in the left list. A linked document that never became a row opens its file instead; an
item with neither a record nor a file is shown, not clickable, and says why.

## The right column follows the selected date (SCRUM-47)

The right column (widgets 19–25) is not part of the main view's container, but it reads the same
date. On a past record it shows both states at once: the `then` column is solid and computed from
the records that existed on that date; the `now` column is paled and computed from today's. Both
are in the same sections, with the same rows and on one scale, so a number is read against the
number it became instead of against a memory of it. On today's record there is one solid column.

The panel's forecast is the page's own projection in years — the life-expectancy table moved by
each record's `delta`, or by `evidence` when the record has no explicit delta — and it says so. It
does not publish an interval for this baseline, so it shows none rather than inventing one. Its
`recommended on this date` rows are the `advised` edges into the record, each carrying the advising
document and the advised item's status on that date; the `now` column carries the later advice and
the status today. Missing data stays visible: `what we do not know` lists the gaps at each date, and
a gap that has been filled since reads as known in the paled column only.

The panel is hidden in the graph view, like everything else that belongs to the product view
(`.only-main`). Its model is `body/lib/right-panel.js`, pure like `state-list.js` and `main-view.js`,
so the two states can be tested without a browser. The layout is
`docs/wireframe-health-v13-past-then-now.svg`.

## The case document

`kg_demo.json` is the T21 case — a `kg/1-health` document of 62 events over twenty years —
and it carries the records that make each view visible without a real document: four-marker lipid
panels with a lab, an address, a scan and printed flags; a cardiologist's note that put a
condition on the record and a drug under `treated_by`; a note that stopped a drug for its cough; a
colonoscopy with its polyp; and single tests (troponin, HbA1c, eGFR) whose one-row analysis view is
read from the observation itself. The diet, activity and restriction lines are in the notes' text:
the contract has no decision kind to hang them on. There is no stored summary and no prediction in
the file — the page generates its annual markers (T10) and forecasts have their own fixtures.

Opening it is a view and never a record: the page has no write path, so a clean reader who opens the
built page still has nothing of their own stored. `scripts/page-storage.test.ts` (T23) executes the
page's own reader over the artifact's document with an empty storage and fails if a single key appears.

### The case page is a build artifact (T01, SCRUM-51)

`body/index.html` is the template. It carries the `#kg-graph` placeholder and no document of its own:
no sample set, no birth date, no `fetch`, and no word about any one use case. `bun run build:demo`
replaces the placeholder with `kg_demo.json` and writes `dist/demo.html`, with the page's `lib/` beside
it, so the page opens on the case — the same timeline, the same 47 records in the left list, the latest
record drawn in the centre column — with no click and no network.

A rendered page is the other surface. The render command writes the reader's document into the same
placeholder, and the page draws what it was handed: with records, the latest of them is open in the
centre; with no records, it keeps its empty start (no profile, an empty ruler, the records list's
"nothing recorded yet"). The template's placeholder is read as "no document" and never warns, so
opening the template itself is an empty page, not an error.

The artifact is checked byte-for-byte against the build in `scripts/case-artifact.test.ts`: a
hand-edited page in `dist/`, or a document that drifted from its source, fails CI. The case exists in
exactly two places — the source document and the page built from it — and never in the template a
reader's own page is rendered from.

## Export — how a marker leaves, and how it does not

The page writes nothing: there is no download button, no export panel, no second place where a
marker is defined. The markers defined above leave through two skills the webapp hands to `kg`
(`app.json` → `requires.skills`, fetched from `skills_url`), and they leave *these* rows, not a
re-reading of the document:

| skill | output | keeps |
|---|---|---|
| `markers-to-pdf` | one paginated PDF card per panel | value, reference, flag, date, source per row; missing fields printed; a range reading never dressed as the lab's |
| `markers-to-fhir` | one HL7 FHIR R4 `Bundle` | the same five fields as `Observation`/`DiagnosticReport`, with a round trip that reads every row back |

`docs/EXPORT.md` holds the survey of established health-record formats, the mapping and its
losses. `scripts/skills.test.ts` runs both skills on this demo and compares their rows with
`markers()` and `sourceOf()` here, so the export cannot quietly become a second opinion.

A third skill, `add-prediction`, goes the other way: it writes a forecast into the document from a
paper the user brings. It is not an export and it is not a screen either — `docs/ADD-PREDICTION.md`.
