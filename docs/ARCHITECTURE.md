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

This repo. A single-file HTML app that reads the inlined document and draws three columns.

**Owns:** layout, widget behaviour, empty states, what is shown when a field is missing.
**Does not own:** facts, defaults that look like data, editing.

The build inlines the document:

```html
<script id="kg-graph" type="application/json">__KG_GRAPH__</script>
```

because a page opened from `file://` cannot `fetch()` a sidecar. Whatever produces the final page
replaces that text and changes nothing else.

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

**Today this file is a byte-for-byte copy of the science app** (`id: "viewer"`, `title: "Research
field map"`). Fixing it is task T02 in the plan, and until it is fixed every agent that reads this
repo will build a research map.

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
3. **Provenance chains** — every claim points to a source, and a source points to a document; the
   graph is the only place where that chain is one object.
4. **Honest gaps** — a missing edge is visible. A missing column is just a blank cell nobody notices.

If a screen can be drawn from three numbers, draw three numbers. The graph earns its place when a
question needs a path.
