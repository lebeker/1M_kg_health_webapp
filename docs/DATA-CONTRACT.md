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

**No identity anywhere else.** Not in `nodes`, not in `desc`, not in the template's JavaScript. The
birth date `1984-03-01` hardcoded in `body/index.html` is a defect, not a default.

## Node kinds

Seven kinds, and no free-form ones. A kind that is not on this list is a modelling error, because the
template has a layout for each and nothing for the rest.

| kind | what it is | carries a date? | example |
|---|---|---|---|
| `condition` | a diagnosis, confirmed or suspected | onset, resolution | hyperlipidaemia |
| `observation` | a measured value or a panel | always | lipid panel, TSH |
| `encounter` | a visit, a hospital stay, a procedure | always | cardiology visit 2021-05-14 |
| `medication` | a drug and a regimen | start, stop | atorvastatin 20 mg |
| `summary` | a period rolled up: annual or today | the period end | 2025 annual summary |
| `prediction` | a simulated projection under a condition | target date | LDL < 3.0 by 2028 |
| `source` | a document the facts came from | document date | discharge note, page 2 |

Rules:

- A `summary` is virtual. It is not an event somebody recorded; it is a marker the app generates for a
  year (stamped `01-01` of the following year) or for today. It is stored only once confirmed.
- A `prediction` never moves the main estimate until its condition is met. When it is met, the
  estimate moves and the history says which prediction moved it.
- A `source` node is required for every fact that came from a document. A fact without a source is a
  rumour with a colour.

## Node fields

Base fields are `kg/1` (`id`, `label`, `kind`, `level`, `size`, `style`, `desc`, `link`). Health adds:

| field | on | required | meaning |
|---|---|---|---|
| `when` | `observation`, `encounter`, `medication`, `summary`, `condition` | yes for events | ISO date or interval `{"from": "...", "to": "..."}` |
| `value` | `observation` | yes | number, as a number, not a string |
| `unit` | `observation` | yes | UCUM code where one exists (`mmol/L`, `mm[Hg]`) |
| `ref_low`, `ref_high` | `observation` | no | the lab's own reference range; never invented |
| `flag` | `observation` | no | `low` / `normal` / `high` / `critical`, as the lab printed it |
| `code` | `observation`, `condition` | no | LOINC for observations, ICD-10 or SNOMED for conditions |
| `status` | `condition`, `medication` | yes | `active`, `resolved`, `suspected`, `stopped` |
| `confirmed` | any | yes | `true` when a human confirmed it; otherwise `false` and the UI says `not confirmed` |
| `source` | any | yes | id of a `source` node |
| `origin` | `condition`, `summary` | no | `doctor` or `generated`; the two never look alike |
| `confidence` | any | no | `0..1`; shown only when it exists |

`value` is a number and `unit` is separate on purpose: a string `"4.9 mmol/L"` cannot be plotted,
sorted or compared, and every downstream bug starts there.

## Edge relations

The relation is the edge's `label`. The list is closed — a new relation needs an entry here first.

| label | from → to | meaning |
|---|---|---|
| `tracks` | observation → condition | this measurement watches that condition |
| `treated_by` | condition → medication | that condition is treated with this drug |
| `contradicts` | observation → condition | a later measurement disagrees with the note |
| `preceded_by` | event → event | the order of two events, when dates alone are ambiguous |
| `derived_from` | any → source | provenance: this fact came from that document |
| `advised` | encounter → medication, observation | a doctor recommended it |
| `projected` | prediction → condition, observation | what the prediction is about |
| `part_of` | observation → observation | a marker inside a panel |

Every edge carries `source` and `confidence` when they are known, and `valid_from` / `valid_to` when
the relation itself is temporary. A relation that was true between two dates and is not true now is
still a fact about the past — do not delete it, close it.

## Temporal rule

Dates do not live on stable entities. An organ has no date. Its removal has one.

```
node.condition.hyperlipidaemia   ── onset 2021-05-14, status active
edge.hyperlipidaemia treated_by atorvastatin ── valid_from 2026-08-19, valid_to null
node.observation.ldl-2026-11     ── when 2026-11-12, value 4.9
```

The template derives "state on date D" by taking every event with `when <= D` and every edge whose
`valid_from <= D < valid_to`. Nothing is stored twice.

## What the template may assume

1. `id` is unique and stable. Never reused for different content.
2. An event has `when`. A non-event does not need one.
3. Every node has `kind` from the list above and `confirmed` set.
4. Fields may be missing. **A missing field hides its row; it never breaks the layout.**
5. The document is read-only for the template. No writes, no mutation, no caching into localStorage.

## Validation

The document is valid when:

- `kg.py validate` passes for `kg/1`;
- every `kind` is in the list above;
- every event has `when`, every observation has `value` + `unit`;
- every node has `source` pointing at an existing `source` node;
- no node carries a date it should not (a `condition` without `onset` is fine; a `medication` without
  `started` is not);
- `meta.profile.sex` and `meta.profile.year_of_birth` exist.

The health-specific checks are **not implemented yet**: they are task T04 in the plan. Until they
exist, `validate` proves the document is well-formed `kg/1`, not that it is a valid health record.
