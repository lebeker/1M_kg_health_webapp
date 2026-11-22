# Data contract — `kg/1` for health

The document is one JSON file. The engine is `../../1M_kg_skill/scripts/kg.py`; the base schema is
`../../1M_kg_skill/references/format.md`. This file does not replace it — it says which parts health
uses, and which fields health adds.

Anything not written here is not part of the contract. If a field is needed, it goes in this file
first, then in the engine, then in the template. Not the other way round.

## Envelope

```json
{
  "meta": {
    "title": "Andrei, 65",
    "schema": "kg/1",
    "app": "health-viewer",
    "app_url": "https://…/health-viewer.html",
    "requires": { "skills": ["kg"], "plugins": [], "tools": [] },
    "colors": { "condition": "#c0504d", "observation": "#4f81bd" },
    "profile": { "sex": "male", "year_of_birth": 1961, "name": null },
    "timezone": "Europe/Berlin"
  },
  "nodes": [],
  "edges": []
}
```

| key | required | meaning |
|---|---|---|
| `title` | yes | shown at the top; a person's name or "unnamed profile" |
| `schema` | yes | always `kg/1`; the engine stamps it |
| `app` | yes | `health-viewer` — which template draws this document |
| `app_url` | no | where to fetch the template if it is not installed |
| `requires` | yes | what must exist before the graph can be built |
| `colors` | yes | kind → hex; health kinds ship defaults |
| `profile` | **yes** | the only place identity lives. `sex` and `year_of_birth` are required; a full date and a name are optional |
| `timezone` | no | IANA name; without it, "today" is the machine's today |

**No identity anywhere else.** Not in `nodes`, not in `desc`, not in the template's JavaScript. A birth
date hard-coded in the page is a defect, not a default: the page used to carry `1984-03-01` in a
constant, and T01 removed it. The birthday now appears once, in the document that invented the person
(`body/demo/graph.json`, labelled `meta.demo: true`).

This file is one of the four in the contract set — `docs/PRODUCT.md` (what it is for),
`docs/ARCHITECTURE.md` (how the parts fit), this file (what a document may contain), and
[`../ANATOMY-VOCABULARIES.md`](../ANATOMY-VOCABULARIES.md) (how anatomy is named). Where another file
describes a document differently, this file and `scripts/schema/kg-1-health.schema.json` are the
contract and the other file is corrected. Issues live in Jira (`SCRUM` on `lebeker.atlassian.net`), not
in this repository.

`requires` and `colors` are marked required because a document the app writes always carries them.
The schema does not reject a document without them: the template supplies its own defaults (the
health kinds ship their hex values), so a hand-written or foreign document is not turned away for
a key the viewer would have filled in anyway.

## Node kinds

Eight kinds, and no free-form ones. Six of them are **events**: a fact in the record that happened on
a date and came from a document. A kind that is not on this list is a modelling error, because the
template has a layout for each and nothing for the rest.

| kind | an event? | date | what it is | example |
|---|---|---|---|---|
| `condition` | yes | `when`: onset, `to` when resolved | a diagnosis, confirmed or suspected | hyperlipidaemia |
| `observation` | yes | `when` | a measured value or a panel | lipid panel, TSH |
| `encounter` | yes | `when` | a visit, an appointment, a hospital stay | cardiology visit 2021-05-14 |
| `medication` | yes | `when`: start, `to` when stopped | a drug and a regimen | atorvastatin 20 mg |
| `procedure` | yes | `when`: the day it was performed | something done to the person | coronary angiography 2021-05-15 |
| `document` | yes | `when`: the date printed on it | the file the facts came from | discharge note, page 2 |
| `summary` | no | `when`: the period end | a period rolled up: annual or today. Virtual | 2025 annual summary |
| `prediction` | no | `horizon`: the date it is about | a simulated projection under a condition | LDL < 3.0 by 2028 |

Rules:

- **An event cannot exist without a date.** `when` is required per kind by the schema, and the
  template's event model (`src/events.ts`) refuses to build one without a real calendar date. An
  undated fact is not an event that can be repaired later: nothing can place it on the timeline.
- **A fact points at its document.** Every node carries `source`, the id of a `document` node, except
  the `document` itself: it is the provenance, so it points at none. A fact without a document is a
  rumour with a colour.
- A `procedure` is not an `encounter`: an encounter is where the person went, a procedure is what was
  done to them. A document that records both carries two nodes.
- A `summary` is virtual. It is not an event somebody recorded; it is a marker the app generates for
  a year (stamped `01-01` of the following year) or for today. It is stored only once confirmed.
- A `prediction` never moves the main estimate until its condition is met. When it is met, the
  estimate moves and the history says which prediction moved it. The condition is a predicate over
  the facts — the same vocabulary a rule's `when` uses (see §Predictions) — and it is three-valued:
  a missing or mistyped fact is **unknown**, and an unknown condition is not met.

## Node fields

Base fields are `kg/1` (`id`, `label`, `kind`, `level`, `size`, `style`, `desc`, `link`). Health adds:

| field | on | required | meaning |
|---|---|---|---|
| `when` | every event, and `summary` | yes | ISO date or interval `{"from": "...", "to": "..."}`; the date the thing happened, or the day the interval started |
| `value` | `observation` | yes | number, as a number, not a string |
| `unit` | `observation` | yes | UCUM code where one exists (`mmol/L`, `mm[Hg]`) |
| `ref_low`, `ref_high` | `observation` | no | the lab's own reference range; never invented |
| `flag` | `observation` | no | `low` / `normal` / `high` / `critical`, as the lab printed it |
| `code` | `observation`, `condition`, `procedure` | no | LOINC for observations, ICD-10 or SNOMED for conditions, SNOMED CT / ICD-10-PCS / OPCS-4 for procedures |
| `status` | `condition`, `medication` | yes | `active`, `resolved`, `suspected`, `stopped` |
| `confirmed` | any | yes | `true` when a human confirmed it; otherwise `false` and the UI says `not confirmed` |
| `source` | any but `document` | yes | id of a `document` node; a document is the provenance and carries none |
| `origin` | `condition`, `summary` | no | `doctor` or `generated`; the two never look alike |
| `confidence` | any | no | `0..1`; shown only when it exists |
| `target` | `prediction` | yes | id of the condition or observation the forecast is about |
| `horizon` | `prediction` | yes | ISO date: the date the forecast is about, not the day it was made |
| `condition` | `prediction` | yes | the predicate that has to be met before the forecast may move an estimate |
| `delta_median` | `prediction` | yes | number: what the estimate of its scale would move by, once the condition is met |

`value` is a number and `unit` is separate on purpose: a string `"4.9 mmol/L"` cannot be plotted,
sorted or compared, and every downstream bug starts there.

**A string that has to name something may not be blank.** The gate and the app's readers trim before
they answer (`isNonEmptyString` in `scripts/lib/kg-contract.ts`, `conditionProblems` in
`src/rules.ts`, `loadPredictions` in `src/prediction.ts`), so `"  "` and `""` are the same nothing to
them. The schema states that once, as `$defs.nonEmptyText`, and refers to it where a string is a name:

| field | in the set | why |
|---|---|---|
| node `id` | yes | `loadPredictions` reads it through the trimmed test and refuses a forecast it cannot name |
| `source`, on a node and on an edge | yes | it is an id; the schema states the rule and the referential check adds its own sentence for a blank, because a check that resolves nothing must not be silent |
| `target` | yes | `loadPredictions` reads it through the same test |
| a comparison's `fact` | yes | `conditionProblems` reads it through the same test |
| `from` / `to` on an edge | yes | the base path reads them through the same test; a blank end is a dangling relation the renderer would drop without a word |
| `label`, `desc`, `link`, `code`, `unit`, `origin`, `status`, `flag`, `kind` | no | no reader applies the trimmed test to them; an empty `label` is a display choice, and the enumerated ones are refused by their `enum` if they are wrong |

A document cannot pass the gate with a blank where a loader would then refuse the same field — that
disagreement is what these rows are pinned against in `scripts/kg-contract.test.ts`.

## Predictions

A forecast is a simulation, not a fact. It is a node — visible, dated, drawable — and it is the one
kind that may carry a number the record has not earned yet. So it says exactly what it is waiting
for, in a form a program can decide:

```json
{
  "id": "pred-ldl-2028",
  "kind": "prediction",
  "label": "LDL below 3.0 by 2028 on a statin",
  "target": "obs-ldl-2026-11",
  "horizon": "2028-01-01",
  "condition": { "fact": "on_statin", "op": "eq", "value": true },
  "delta_median": -1.1,
  "confidence": 0.6,
  "source": "src-discharge-2021",
  "confirmed": false
}
```

| field | what it is | what a document may not do without it |
|---|---|---|
| `target` | the condition or observation the forecast is about | a forecast about nothing is a mood |
| `horizon` | the date the forecast is about | without it the timeline cannot place the projection; a prediction carries **no** `when` — its date is the horizon, and the day it was made is the date printed on its document |
| `condition` | the predicate that has to be met | it is the only thing that may let the number move; a forecast with no condition moves the estimate the day it is written |
| `delta_median` | the change it would make, in the unit of the scale it adjusts | a number with no size is not a forecast |
| `source` | the id of a `document` node in this document — the paper, note or discharge letter the forecast came from, which is where the citation (PMID, DOI, URL) belongs | required on every kind but the document, and a forecast is no exception |
| `confidence` | 0..1 | the reader has to know how much to trust the delta |

The condition is **a predicate over the facts**, in the same vocabulary as a rule's `when`
(`$defs.predicate` in the schema; `src/rules.ts`):

```json
{ "all": [ { "fact": "on_statin", "op": "eq", "value": true },
           { "any": [ { "fact": "ldl_cholesterol", "op": "lt", "value": 3 },
                      { "not": { "fact": "current_smoker", "op": "eq", "value": true } } ] } ] }
```

One comparison is `{fact, op, value}`; `all`, `any` and `not` compose them; `op` is one of
`eq ne lt le gt ge in exists`. The shape of `value` follows the operator, and the schema decides it
operator by operator exactly as `src/rules.ts` does: the six comparisons take one value — a number, a
string or `true`/`false` — `in` takes a non-empty list of them, and `exists` takes **no** value at all
because it asks only whether the fact is known. A document cannot pass the gate with a condition the
loader would then refuse. A condition is about facts — `age`, `on_statin`, `ldl_cholesterol` —
never about dates: dates live on nodes, and a condition that carried one would be the second kind
of time this contract exists to prevent.

**The gate.** `src/prediction.ts` is the only thing that turns a prediction into a number, and it
applies a delta **only** when the condition is exactly `met`:

| verdict | when | what the estimate does |
|---|---|---|
| `met` | every comparison is true | takes the delta |
| `unmet` | a comparison is false | stays where it was; the row is withheld as `no-match` |
| `unknown` | a fact is missing or of the wrong type | stays where it was; the row is withheld as `missing-fact` / `type-mismatch` |

`unknown` is the important one. "We do not know whether he is on a statin" is not "he is on a
statin", and it is not "he is not" either: the forecast stays visibly pending instead of firing or
being quietly dropped. For the same reason `not` over an unknown comparison is still unknown.

Two things the contract refuses outright, because they are the shape of a forecast mistaken for a
fact: a `target` that is not a condition or an observation in the same document, and a `horizon`
earlier than the date printed on the forecast's own document — a forecast is about a later date,
never an earlier one. `docs/PREDICTIONS.md` is the long form: why the gate exists, what the rows look
like, and what a prediction is not allowed to claim.

## Edge relations

The relation is the edge's `label`. The list is closed — a new relation needs an entry here first.

| label | from → to | meaning |
|---|---|---|
| `tracks` | observation → condition | this measurement watches that condition |
| `treated_by` | condition → medication | that condition is treated with this drug |
| `contradicts` | observation → condition | a later measurement disagrees with the note |
| `preceded_by` | event → event | the order of two events, when dates alone are ambiguous |
| `derived_from` | any → document | provenance: this fact came from that document |
| `advised` | encounter → medication, observation | a doctor recommended it |
| `projected` | prediction → condition, observation | what the prediction is about |
| `part_of` | observation → observation | a marker inside a panel |

Every edge carries `source` and `confidence` when they are known, and `valid_from` / `valid_to` when
the relation itself is temporary. A relation that was true between two dates and is not true now is
still a fact about the past — do not delete it, close it.

## Anatomy, and the vocabularies outside this file

[`../ANATOMY-VOCABULARIES.md`](../ANATOMY-VOCABULARIES.md) says how anatomy is named: Uberon and FMA
for organs and parts, CL and GO for cells and processes, ChEBI for compounds, LOINC for tests, UCUM
for units, SNOMED and ICD for diagnoses, and a CURIE (`UBERON:0000995`) as the identifier. It is the
reference for **what to call a thing**, and it is not a second shape. A `kg/1-health` document is not
the place its kind list applies.

Where the two files meet, this one is the contract:

| `ANATOMY-VOCABULARIES.md` says | in a health document |
|---|---|
| a node is `organ`, `tissue`, `cell`, `organelle`, `compound`, `marker`, `protocol` | the `kind` is one of the eight (§Node kinds). Anatomy is not a node kind: an organ enters a document as the `code` of a `condition` or a `procedure`, or as the `organ` key the health page reads when it is there. Both `organ` and `mesh` are outside the schema, so they are carried through untouched and never validated |
| `id` is a CURIE, and `source` names the vocabulary | `source` is the id of a `document` node, always (§Node fields). A CURIE belongs in `code` (LOINC, ICD-10, SNOMED) or in `id`, and the vocabulary is then read off its prefix |
| `confidence` is `established` / `draft` / `not confirmed` | `confidence` is a number `0..1`; the established / not-confirmed distinction is `confirmed: true/false`, and `not confirmed` is the mark the UI draws for `false` |
| edge labels include `part_of`, `located_in`, `measured_by`, `indicates`, `site_of`, `treats`, `contraindicates`, `affects`, `documented_in` | the eight relations (§Edge relations). `part_of` is a different relation in each file — here it is a marker inside a panel — so a document that means "this organ is part of that system" has no edge for it yet. The vocabulary names it; this file does not carry it |
| a node with a `mesh` but no CURIE is a drawing, not a fact | the same rule holds, and it is enforced by the same field: `confirmed: false` is what makes a drawing visible as unconfirmed |

Adding anatomy to a health document is therefore a **vocabulary** decision, not a schema change: it
adds ids and `code` values. Adding a kind or a relation is a schema change, and it starts here.

## Temporal rule

Dates do not live on stable entities. An organ has no date. Its removal has one.

```
node.condition.hyperlipidaemia   ── onset 2021-05-14, status active
edge.hyperlipidaemia treated_by atorvastatin ── valid_from 2026-08-19, valid_to null
node.observation.ldl-2026-11     ── when 2026-11-12, value 4.9
```

The template derives "state on date D" by taking every event with `when <= D` and every edge whose
`valid_from <= D < valid_to`. Nothing is stored twice.

A validity window belongs to something that holds between two dates — a condition, a medication, a
projection. A document is dated (the date printed on it) but was never "in force", so it carries no
window; the checker refuses one on it.

## What the template may assume

1. `id` is unique and stable. Never reused for different content.
2. An event has `when`; a `summary` has the date it marks; a `prediction` has a `horizon` and no
   `when` (§Predictions). A non-event needs no `when` of its own.
3. Every node has `kind` from the list above and `confirmed` set.
4. Fields may be missing. **A missing field hides its row; it never breaks the layout.**
5. The document is read-only for the template. No writes, no mutation, no caching into localStorage.

## Validation

The machine-readable form of this file is `scripts/schema/kg-1-health.schema.json` (JSON Schema
draft 2020-12, version in `x-contract-version`), and the checker that reads it is
`scripts/lib/kg-contract.ts`. `bun run test:contract` runs both over `tests/fixtures/kg/`: a fixture
in `valid/` must pass, a fixture in `invalid/` must be rejected, and the run exits non-zero when
either half misbehaves. It needs no network and no `node_modules` — `bun` is the whole install.

The schema is at **2.1.0** since T18: a `prediction` carries `target`, `horizon`, `condition`,
`delta_median`, `source` and `confidence`, and no `when`. **2.0.0** (T06) renamed `source` to
`document`, made `procedure` its own event, and made the six event kinds the spine of the model. A
document written against 1.0.0 is migrated by renaming the `source` kind to `document` and giving it
the date printed on it.

The document is valid when:

- it matches the schema: the envelope, the eight kinds (six of them events), the eight relations, the
  fields as typed (a `value` is a number, a `when` is a real calendar date), and per kind the fields
  that kind cannot do without (an observation its date, value, unit and source; a condition its onset,
  status and source; an encounter and a procedure their date and source; a document the date printed
  on it);
- `id` is unique, and every edge's `from` and `to` are nodes in the same document;
- every node's `source` points at an existing node whose kind is `document` — and a `document` points
  at none, because it is the provenance;
- an edge's ends carry the kinds its relation allows (`x-relations` in the schema: `tracks` runs
  observation → condition, `derived_from` anything → document, and so on);
- no node but one that can be in force carries a validity window: `valid_from` / `valid_to` are a
  relation's device. A stable thing — a document, an organ — has no window, and an event states its
  date in `when`. A window that ends before it starts is rejected on both nodes and edges;
- `meta.profile.sex` and `meta.profile.year_of_birth` exist;
- a `prediction` carries all six of its fields, its `condition` is a well-formed predicate, its
  `target` is a condition or an observation in the same document, its `horizon` is not before the
  date printed on its own document, and it carries no `when`.

The document the page ships is the honest example of all of this: `body/demo/graph.json`, an invented
65-year-old man with twenty years of records and `meta.demo: true` (its long form is
`body/demo/README.md`). It is checked like any other document — `bun scripts/validate-kg-fixtures.ts
body/demo/graph.json` reports 0 issues at 2.1.0 — so a reader who wants to see the contract applied
reads it, and an agent that wants to know whether a document is a real person looks for `meta.demo`
first. `meta.demo` is not one of the envelope keys above: it is an extra key the schema carries
through, and the page and its tests treat it as the mark of an invented person. The fixtures in
`tests/fixtures/kg/` are the minimal cases, one field each; the demo is a whole record.

What the schema deliberately does not describe: a stored snapshot. A snapshot is derived, not
recorded — the state at date D is every node whose `when` is on or before D, plus every edge whose
validity window holds at D (§Temporal rule). The immutable snapshot store is proposal T08 and is
not approved, so the contract covers the snapshot by keeping that derivation well-defined rather
than by inventing a shape for it.

The base `kg/1` shape stays thin: a document whose `meta.app` is not `health-viewer` is checked
only for an envelope, an id per node and, per edge, both ends named and resolving to a node in the
document — an edge with a missing or empty `from`/`to` is not a relation, and the renderer drops it
without a word. Any other key is carried through untouched.
