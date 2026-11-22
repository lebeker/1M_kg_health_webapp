# body/demo/graph.json

The demonstration case (T21), and the only copy of it. The page (`body/index.html`) fetches this
file when the reader presses **load demo**; a clean start is an empty page and an empty ruler.

It is deliberately an artifact and not part of the page: somebody else's lab results must never
be what a new reader sees first. Nothing here is saved — the page has no write path — so loading
the demo leaves a clean reader with an empty record of their own (the seed of card T23).

The path is page-relative (`demo/graph.json` from `body/index.html`), so the page works from its
own directory on any static host — GitHub Pages, `python3 -m http.server` at the repo root —
without climbing out of it.

## The case

Andrei, born 1961, male, 65 on the day of the last note. Twenty years of an invented record,
from the annual check-up of 18 April 2006 to the cardiology note of 19 November 2026.

| | |
|---|---|
| events | **62** (the six event kinds of the contract; a summary or a prediction would not be one) |
| conditions | **3** — hypertension 2012, hyperlipidaemia 2016, type 2 diabetes 2021 |
| medications | **5** — amlodipine, atorvastatin, ramipril (stopped 2019 for a cough), metformin, empagliflozin |
| procedures | **2** — coronary angiography 2019, colonoscopy with polypectomy 2023 |
| the rest | 27 observations (panels and single tests), 10 encounters, 15 documents |

The story is ordinary on purpose: a man who keeps his appointments, whose numbers move slowly,
and who is told the same thing three times over fourteen years — the blood pressure, the LDL and
the glucose. Nothing in it is a medical decision the template is making; every number belongs to
a document in the file, and every document is one the invented record says was printed.

## Shape

A `kg/1-health` document (`meta.app: "health-viewer"`, `x-contract-version` 2.1.0): `meta.profile`
is the identity, every fact carries `source` naming a `document` node, and a document carries
none. It passes the contract gate — `bun scripts/validate-kg-fixtures.ts body/demo/graph.json`
exits 0 — and `scripts/demo-artifact.test.ts` holds the counts above so the case cannot quietly
lose its teeth.

A separate workspace in the everyday sense: its own document, its own profile, its own file. The
reader's `kg.json` is never this one, and the page never copies this one into anything.

Keys the page reads that the contract does not type are carried through untouched (DATA-CONTRACT
§What the template may assume 4, MAIN-VIEW §Demo): `organ`, `panel`, `track` and `values` place a
measurement on the body and in the legend, `summary` is its plain-language meaning, `affects` is
what it touches, and `lab` / `publisher` / `address` / `link` on a document are where the numbers
came from. `meta.birth` is not used: the ruler derives the birth day from
`meta.profile.year_of_birth`, because identity lives in one place only. The page scales the
contract's `confidence` (0..1) to its own 0..100 for the colour of a mark.

Two things the event model deliberately cannot carry here, so they are not faked as nodes:

- **Decisions.** The contract's eight kinds have no `decision`, so the diet, activity and
  restriction lines live in the text of the note that decided them, and the diagnosis view shows
  the drugs and tests that the document does link to it (`treated_by`, `advised`).
- **Summaries and predictions.** The page generates the annual markers and the today row itself
  (T10); forecasts are T18/T19 and have their own fixtures, not a place in a record of facts.

## Re-checking it

```
bun scripts/validate-kg-fixtures.ts body/demo/graph.json   # the contract, over this file
bun test scripts/demo-artifact.test.ts                    # the counts, the span, the page's grip on it
```
