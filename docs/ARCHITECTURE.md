# Architecture

Four layers, one document. Nothing else is shared.

```
┌──────────────┐   writes    ┌──────────────┐   renders   ┌──────────────┐   hosts   ┌──────────────┐
│  kg skill    │ ──────────▶ │   kg.json    │ ──────────▶ │   template   │ ────────▶ │   service    │
│ (how facts   │             │ (the facts)  │             │ (how it      │           │ (where it    │
│  are found)  │             │ + sources/   │             │  looks)      │           │  lives)      │
└──────────────┘             └──────────────┘             └──────────────┘           └──────────────┘
   ../../1M_kg_skill            user data                    this repo                  not built
```

## The contract set — four files, and this is how they divide

Every agent and every manager reads the same four files, and each has one subject:

| file | answers | corrected here, not there, when they disagree |
|---|---|---|
| `docs/PRODUCT.md` | what the thing is for, and what it refuses | nothing — it is the promise, not a description |
| `docs/ARCHITECTURE.md` (this file) | how the four layers fit, and where the seams are | any other description of the layout |
| `docs/DATA-CONTRACT.md` + `scripts/schema/kg-1-health.schema.json` | what a document may contain, and the gate that refuses one | any other description of a document — `../ANATOMY-VOCABULARIES.md` included |
| `../ANATOMY-VOCABULARIES.md` | how anatomy is named (Uberon, CL, GO, ChEBI, LOINC, SNOMED) | nothing — it is a naming reference, not a shape |

The long forms hang off these and are linked from the subject they belong to: `docs/MAIN-VIEW.md`,
`docs/WIDGETS.md`, `docs/LEE.md`, `docs/SCORE2.md`, `docs/EXPLANATIONS.md`, `docs/PREDICTIONS.md`,
`docs/STRATEGIES.md`, `docs/EXPORT.md`, `docs/ADD-PREDICTION.md`. `docs/PLAN-health-2026-11-12.md`
says what is built in which order and `docs/DELIVERY-LOOP.md` says how a card moves; the decisions in
those two belong to the owner — a card may carry an approved decision into them, not make one.

**Issues live in Jira** — the `SCRUM` project on `lebeker.atlassian.net` — not in this repository. A
file here is a specification or a record of what already happened. A defect, an open question and an
undecided choice are issues, and they are tracked there.

## Layer 1 — the skill

`../../1M_kg_skill` (`SKILL.md`, `scripts/kg.py`, `references/format.md`, `references/apps.md`).

**Owns:** finding facts, choosing what becomes a node or an edge, writing the document, validating it,
keeping history in git. **Does not own:** layout, colours, columns, interaction.

The skill is generic. It knows `kg/1`, not health. Health enters through `app.json`, which the skill
reads to know which kinds and edges make a legible health map.

```
user asks for something
        │
        ▼
skill reads app.json  ──▶  kinds, edges, requires, tool_notes
        │
        ▼
skill talks to the user: "here is what I need first, and why"
        │
        ▼
kg.py new / add-node / add-edge / validate / render
        │
        ▼
kg.json  +  sources/
```

## Layer 2 — the document

One JSON file, meant to be small enough to read and diff by hand. `kg/1` schema; see
`docs/DATA-CONTRACT.md`.

**Owns:** facts, dates, provenance, confidence. **Does not own:** folding, selection, zoom, which panel
is open. A document that carries view state is a document only one viewer can read.

Two companions travel with it and never mix:

| Companion | Contains | Rule |
|---|---|---|
| `sources/` | original PDFs, JPEGs, scans | copied, never edited; named by id |
| `seed/` | fake demo cases | clearly labelled; never merged with a real profile |

## Layer 3 — the template

This repo, and two pages in it, because a page here has two different jobs:

| page | built from | what it is |
|---|---|---|
| `dist/index.html` | `src/` (React, `bun run build`) | the viewer a skill ships: the whole `kg/1` graph in sigma 2D and in the 3D force graph, with the notes beside it. `scripts/bundle.mjs` copies it into a skill as `assets/viewer.html` |
| `body/index.html` | hand-written, no build step | the health page: the body, the timeline, the records list, one main view per event type. Pulls its three.js and its `body/lib/*.js` modules from the folder beside it; no network |

Both read a `kg/1` JSON document — `dist/index.html` whichever one it is handed, `body/index.html`
one in the `kg/1-health` profile — and neither writes it.

**Owns:** layout, widget behaviour, empty states, what is shown when a field is missing, and the
arithmetic that turns facts into an estimate (`src/rules.ts`).
**Does not own:** facts, defaults that look like data, editing.

The shipped viewer inlines the document:

```html
<script id="kg-graph" type="application/json">__KG_GRAPH__</script>
```

because a page opened from `file://` cannot `fetch()` a sidecar. Whatever produces the final page
replaces that text and changes nothing else. The checked-in `body/index.html` carries no placeholder:
it is the demo artifact, so it opens with the invented case (`body/demo/graph.json`, `meta.demo:
true`) fetched at launch. A renderer writes `<script id="kg-graph">` into a copy for the reader's own
document; that page draws what it was handed and never fetches the demo, so a reader's document with
no records still starts empty.

The right panel (widgets 19–25) and the drift view are parked, so no score or forecast an engine
computes is drawn yet: the ruler shades future years with the page's own `annualRisk(age)`, which is not
a SCORE2 or Lee number, and the commands and tests are the surface the engines have
(`bun run rules`, `score2`, `lee`, `explain`). `docs/WIDGETS.md` is the registry of that decision.

`app.json` is the template's own declaration and lives beside it:

| Field | Meaning here |
|---|---|
| `id` | `health-viewer` — the name a skill matches |
| `title` | what the app is called in a list |
| `purpose` | one paragraph; the promise the template keeps |
| `kinds` | node kinds that make a health map legible |
| `edges` | relation patterns that make it readable |
| `requires` | what has to be installed before a graph can be built |
| `tool_notes` | why each requirement exists |

It is final (T02), and `scripts/app-manifest.test.ts` holds it to the contract: a kind the schema does
not know, an edge `name` with a space in it, or an edge whose ends the relation forbids fails the gate.
That matters because the skill seeds a graph from those `name` tokens — a display string in that field
would make every document the app creates non-conformant.

### Estimates

An estimate is a base number plus the deltas of the rules that fire, and every rule carries its own
citation: `{id, when, delta, source, confidence}` (`src/rules.ts`). `when` is a condition over the
facts — `age >= 50`, `flag in [high, critical]` — never a date; dates live on nodes.

A rule set names the scale it adjusts (`score2-10y/1`), and the scale travels with the rules: the
engine takes the set, never a bare array of rules, one call applies one scale, and the estimate it
returns carries `version`. So every number printed names the unit its deltas are in, and there is
no call that takes two sets. Adding two scales therefore means hand-writing a third set whose
version is false — a mistake that is visible in the diff that wrote it, not one the engine can make
silently on a caller's behalf.

The engine owns the arithmetic and one promise: the same facts and the same rules give the same
number, bit for bit; a fact that is missing is not a default — the rule does not fire, and the
estimate says which rules did not fire and why. A rule without a `source` does not load. What counts
as a risk factor is not the engine's claim to make: it arrives as a reviewed rule file with a
citation and a confidence.

The first shipped set is the **Lee index** (T16, `src/lee.ts`, `docs/LEE.md`): twelve published
weights, one citation each, seventeen rows of points over an index of 0–26. It is additive, so it is
the set the engine was built for; it refuses a person with a missing item rather than score that
item as zero, and it prints a band of a group's mortality, never a percentage for a person.

The explanation (T17, `src/explain.ts`, `docs/EXPLANATIONS.md`) is the second consumer: it scores
both dates with the same set and reports the rules that started or stopped firing, each with its Δ,
its cause and a link a reader can open. A rule that moved the number and whose `source` is not
addressable is refused, not printed. The same file explains SCORE2 by cutting its linear predictor,
because that is the only quantity on a coefficient model that adds up.

### The one scale that is not a rule set

SCORE2 (T15, `src/score2.ts`, `docs/SCORE2.md`) is the exception, and it is arithmetic, not
editorial: a Cox model whose predictors enter as `exp(Σβx)` and interact with age cannot be written
as a sum of independent deltas. It is a coefficient table copied from the paper's supplement — eleven
rows, a baseline survival, four regional recalibration scales — and it publishes `score2-10y/1` as
its version for the same reason the engine does. Every number it prints carries a 95% interval
built from the published hazard-ratio intervals, and a list of what the model does not know
(diabetes, the population it was not fitted for, the age range, the assumptions behind the
interval). A rule set that later adjusts that number carries `score2-10y/1` and its deltas are in
percentage points, which is what the version is for.

So T17 has two shapes to explain — `Estimate` (base + deltas) and `Score2Risk` (a coefficient model)
— and two things never to do: add a delta to a number whose scale it does not name, and print a
coefficient model as if it were a sum. It ships both shapes (`src/explain.ts`): rules as rows that
started or stopped firing, SCORE2 as the steps of its linear predictor in the paper's table order,
with the model's own limits carried through. Where those rows are drawn is still open — the drift
view (T13) and the right panel (widgets 19–25) are parked, and `docs/WIDGETS.md` is the registry of
that decision, not this file.

### Forecasts do not move the estimate; their conditions do

A prediction (T18, `src/prediction.ts`, `docs/PREDICTIONS.md`) is the third consumer of the same
arithmetic, and the only one whose input is a **condition over the facts** rather than a rule. It is
a node kind (`kind: "prediction"`) with `target`, `horizon`, `condition`, `delta_median`, `source`
and `confidence`; the schema refuses one that is missing any of the six, and the contract refuses a
`target` that is not a condition or an observation in the same document.

`applyPredictions` is the whole gate: it sums `delta_median` for the forecasts whose condition
evaluates to `met`, and returns the rest in `withheld` with the reason. It reuses
`evaluatePredicate` from the rules engine, so "a forecast is live" and "a rule fires" cannot mean two
different things — including the third answer. A missing or mistyped fact is `unknown`, and unknown
is not met: the estimate does not move, and the row stays visible as pending. A forecast that is
merely *likely* is therefore never arithmetic; it is a row a reader can see and argue with.

The gate needs the scale to name, and the document does not carry it: `delta_median` is a number in
the unit of whichever scale it adjusts, so `applyPredictions` takes the `version` from the caller,
exactly as `applyRules` takes the set. One call, one scale.

### The five built-in strategies

The first users of that gate are the five strategies (T19, `src/strategies.ts`, `docs/STRATEGIES.md`):
statin/LDL, smoking cessation, screening colonoscopy, intensive glycaemic control and blood-pressure
lowering, each with a PMID, the paper's published ratio and its 95% interval, and a condition over the
facts. A strategy is a template, not a node: `materialise()` places each one on a node of a document
(`target`) and a date (`horizon`) and writes two nodes — the `document` that carries the PMID and the
interval, and the `prediction` — plus the `projected` edge between them.

Two decisions are arithmetic, not taste. The delta is the **log** of the published ratio, because the
gate sums and only logs add the way ratios multiply. And the scale is the **outcome**
(`mve-log-rr/1`, `cvd-log-rr/1`, `crc-log-rr/1`, `microvascular-log-rr/1`), so statin and blood pressure
— both about major vascular events — may be added, and a colonoscopy's effect on colorectal cancer can
never be summed into a statin's effect on heart attacks. `gateStrategies` makes one call per scale.

The demo document (`tests/fixtures/kg/valid/health-strategies.json`) is all five placed on one invented
record, and it is a valid contract fixture: the strategies cannot write a document the contract would
refuse without `bun run test:contract` going red. Nothing draws a prediction yet — the panel and the
drift view are parked (`docs/WIDGETS.md`) — so the command is the surface this card ships.

## Layer 4 — the service (not built; do not start)

The service is the same template with the document fetched at runtime instead of inlined, plus three
things a file cannot do:

| Service adds | Why it cannot be a file |
|---|---|
| accounts and storage | a file has no owner |
| graph sharing by URL | a file has no address |
| app registry | `app_url` needs somewhere to point |

**Rule:** the service must not fork the format. The document stays `kg/1`; the health extension stays
the same. A second schema is how the two halves drift apart and both become wrong.

## Data flow for a real user

```
1. user brings a document  ──▶  2. agent extracts  ──▶  3. agent writes
   (PDF, JPEG, screenshot)        entities, dates          sources/ + kg.json
                                                                    │
                                                                    4. human confirms
                                                                    │
5. template renders  ◀──  kg.py render / bundle  ◀──────────────────┘
   │
6. user reads: what is this, what changed, what to do next
```

Step 4 is not optional. An unconfirmed entity exists in the document as `not confirmed` and is drawn
differently — never as a fact.

## Where the seams are

| Seam | Contract | Breaks if |
|---|---|---|
| skill → document | `kg/1` + health extension | the skill invents a field the template never sees |
| document → template | inlined `<script id="kg-graph">` | the template mutates the document |
| template → app.json | the app declares its own purpose | the file says `viewer` and describes research |
| template → service | same build, runtime fetch | the service keeps a private schema |

## Why a graph at all

Not for decoration. Four things only a graph carries at once:

1. **Multi-hop questions** — "which drug touches the organ this diagnosis damages" is two edges, not
   two tables.
2. **Temporal structure** — an event between two states is a node with edges into both; a table can
   only say the row exists.
3. **Provenance chains** — every claim points at a document, and the document carries the date printed
   on it; the graph is the only place where that chain is one object.
4. **Honest gaps** — a missing edge is visible. A missing column is just a blank cell nobody notices.

If a screen can be drawn from three numbers, draw three numbers. The graph earns its place when a
question needs a path.
