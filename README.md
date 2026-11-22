# Health map — the template half

The web half of the health map. A `kg/1-health` document is the facts — labs, diagnoses, visits,
drugs, each with its date and its source — and this repository is how those facts look: a timeline
you can stand on a date in, a left column that says what was known then, a centre that shows the
selected record in full, and estimates that carry their interval and their reason.

Three things ship from here:

| what | where | what it is |
|---|---|---|
| the main page | `body/index.html` | the template: the health view, the anatomy under it, and the `#kg-graph` slot a document is rendered into |
| the graph view | `src/` → `dist/index.html` | the same document rendered as a graph, opened behind the "open graph" button, read-only |
| the case page | `case.html` | the published page: the template with `kg_demo.json` in its slot, which is what the Pages address serves |
| the skills | `skills/` | what this app hands to the parent `kg` skill: markers → PDF, markers → FHIR, and `add-prediction` |

The app's own identity is `app.json` → `id: health-viewer`, `title: Health map`. A skill routes on
that file, not on the package name. Everything about publishing, licences and the model set is in
[`docs/RELEASE.md`](docs/RELEASE.md).

**Read first:** [PRODUCT](docs/PRODUCT.md) (what it is for and what it refuses to do),
[ARCHITECTURE](docs/ARCHITECTURE.md) (the four layers and the seams between them),
[DATA-CONTRACT](docs/DATA-CONTRACT.md) (the `kg/1-health` document), and
[ANATOMY-VOCABULARIES](ANATOMY-VOCABULARIES.md) (the organ vocabulary the meshes are named in).

## Quick start

```bash
bun install                 # or: npm install
bun run dev                 # the graph view on the dev server
python3 -m http.server 8770 --bind 127.0.0.1    # then http://127.0.0.1:8770/body/
bun run build               # dist/index.html (the graph page) + dist/demo.html and case.html (the case page)
bun run build:demo          # dist/demo.html only, from kg_demo.json
bun run build:case          # case.html — the published page, from the same two inputs
bun run verify              # lint, types, published page current, case build, unit, contract fixtures, branch rule, split regression
```

The body page has no runtime build step and no network. `body/index.html` is the template: it carries
the `#kg-graph` placeholder and nothing else. Open it over a local server rather than `file://` — the
3D layer loads `models/*.glb` when, and only when, the reader asks for it.

## The published page

Pages serves this repository from `main` at its root, and `dist/` is never published. So the page a
reader opens without cloning anything is `case.html`: the case page, generated from
`body/index.html` and `kg_demo.json` and committed, at
<https://lebeker.github.io/1M_kg_health_webapp/case.html>. It is the artifact with one `<base>`
naming `body/`, because the page addresses its assets relatively and they live there; opening it
draws the 47-record case with no interaction and no button, and stores nothing.

`bun run build:case` writes it and `bun run check:case` fails on a stale copy, both wired into
`bun run verify` and CI. The template stays empty: the case exists as one document (`kg_demo.json`)
and one generated page, never as code in the template a reader's own document is rendered from.

## The case page is not a user

`kg_demo.json` is an invented patient (man, 65, twenty years of history). `bun run build:demo` writes
that document into the template's placeholder and produces `dist/demo.html`, with the page's `lib/`
beside it; open it and the case is on screen — the latest record in the centre column, no button, no
interaction. `bun run build:case` produces the published copy of the same page (`case.html`, see
[the published page](#the-published-page)). The template itself carries no records, so a page
rendered for a reader's own document draws that document.

Opening the built page writes nothing into a profile: after it opens, the user's own workspace is
still empty. That rule has its own test (`scripts/page-storage.test.ts`), which runs the page's own
reader over the artifact's document with an empty storage and fails if a key appears — the one failure
this product cannot survive is someone else's labs appearing in your health record.

## The graph view

A graph answers "what connects to what"; a health question usually wants "what is true on this
date", which the three columns answer better. So the graph is a tool behind a button, never the home
screen: the button opens this repository's own viewer as a separate view, read-only — no create, no
connect, no delete — and back returns to the date you were reading. The rules and the evidence are
in [`docs/GRAPH-VIEW.md`](docs/GRAPH-VIEW.md).

## The graph object

One representation, three renderers:

```
kg/1 JSON  ──toKg()──▶  { graph: Graph (graphology), meta }  ──┬─▶ sigma          (2D, WebGL)
                                                               └─▶ adapters/forceGraph.ts ─▶ 3d-force-graph (3D)
```

`kg.graph` is a **graphology** instance and is the only graph state anything
reads. `src/kg.ts` builds it from the document (and fills in node colours from
`meta.colors`, hash-coloured per `kind` for anything unspecified).
`src/adapters/forceGraph.ts` turns the same graph into the `{ nodes, links }`
shape 3d-force-graph wants — it returns fresh objects every call, because
3d-force-graph mutates its input in place (it swaps `source`/`target` strings for
node references and writes `x`/`y`/`z` back onto nodes). Passing it the live
graph would corrupt the shared data layer.

`z` carries hierarchy when the document has `level`; otherwise it is 0 and the
force layout arranges depth itself.

## Two builds, on purpose

| command | output | why |
|---|---|---|
| `bun run build` | `dist/index.html` — one file, ~2 MB — and `dist/demo.html` + `case.html` | what the skill ships, plus the case page (local and published); both open from their address |
| `bun run build:demo` | `dist/demo.html` + `dist/lib/` | the case page alone, from `kg_demo.json` |
| `bun run build:case` | `case.html` at the repository root | the published case page; the same artifact with a `<base>` naming `body/` |
| `bun run build:multi` | `dist-multi/` — code-split | what a hosted app serves; 3D is fetched on demand |

`vite-plugin-singlefile` sets `codeSplitting: false` (Rollup's
`inlineDynamicImports`), so **lazy loading and single-file output cannot coexist
in one build** — it is one or the other. Hence the flag. In `build:multi` the 3D
code is its own chunk and is not fetched until the 3D button is pressed:

```
dist-multi/assets/index-*.js            383.79 kB │ gzip: 107.88 kB   app + sigma + graphology
dist-multi/assets/3d-force-graph-*.js 1,388.13 kB │ gzip: 371.21 kB   three + 3d-force-graph — on demand
```

In the single-file build everything is present but 3D still only *executes* when
it is opened.

## Getting the graph in

A page opened from `file://` **cannot** `fetch()` a sidecar JSON file — the
browser blocks it. So the graph is inlined into the document:

```html
<script id="kg-graph" type="application/json">__KG_GRAPH__</script>
```

The build output keeps that element and that placeholder verbatim. Whatever
produces the final page replaces the element's text with the `kg/1` JSON and
changes nothing else. Opening the file with the placeholder still in place shows
an empty graph and logs no errors.

The documents beside the graph travel the same way, so the page needs no folder:

```html
<script id="kg-docs" type="application/json">__KG_DOCS__</script>
```

It is a map of `docs/<file>` → text. When more than one is present the page opens
them as a folder — a list on the left, the document beside it, a node id in
backticks selecting that node on the map — and `meta.docs` (written by
`docs/index.json`) gives each one its title and role. A page with only a single
note still shows a plain **notes** button.

## The app's declaration — `app.json`

This repository ships two things, not one. The second is `app.json`: what this app **is for**,
what it **needs** in order to be useful, and the node kinds and edge patterns a graph for it
is made of.

It is what turns "make me a graph" into a specific thing to build. A skill reads it to:

- match a user's words to this app rather than to whatever is first in a list,
- tell the user what has to be installed first — and **why** (`tool_notes`: the `kg` skill writes the
  document and the three skills in `skills/` export or extend it; nothing here guesses a lab value,
  so a photo of a printout is what a graph actually starts from),
- build the graph to this app's conventions: `kinds` seed the palette (`observation`, `condition`,
  `encounter`, `medication`, `procedure`, `summary`, `prediction`, `document`), and `edges` are the
  patterns that make a history legible — `tracks`, `treated by`, `contradicts`, `derived from`,
  `advised` — so a forecast is projected from a condition and never stated as a fact.

Edit it here, in this repo — the app owns the definition of its own goal. It is published at
`…/main/app.json` (not tag-pinned: what the app is *for* does not change when the build
does), and picked up by `fetch-app`, or copied in by `bundle.mjs` as
`assets/viewer.app.json`.

## Skills this app hands to `kg`

`app.json` → `requires.skills` names them, and `skills/` holds them:

| skill | writes? | what it does |
|---|---|---|
| `markers-to-pdf` | no | every marker of the main view — value, reference, flag, date, source — as one paginated card |
| `markers-to-fhir` | no | the same markers as an HL7 FHIR R4 bundle, with the mapping and its limits documented |
| `add-prediction` | yes | one PubMed paper → its ratio and interval → a cohort check → a `prediction` node and a `projected` edge, both left `confirmed: false` |

A skill that ships code carries it twice — the `.py` in `skills/<name>/scripts/` and a verbatim
block inside `SKILL.md`, because a skill arrives as one file. `bun scripts/skills.ts --embed`
refreshes the block and `scripts/skills.test.ts` fails when the two disagree. The long forms are
[`docs/EXPORT.md`](docs/EXPORT.md) and [`docs/ADD-PREDICTION.md`](docs/ADD-PREDICTION.md).

## Landing it in a skill

```bash
bun run build
node scripts/bundle.mjs /path/to/skill-repo
```

Copies `dist/index.html` to `<skill-repo>/assets/viewer.html`, `app.json` to
`assets/viewer.app.json`, and writes `assets/viewer.version` (repo, commit, build time, where
to fetch a newer one). The files are **copied, not symlinked**: a skill repo has to work from
a clone, on its own, with no build step and no reference back here.

## Publishing a new build

```bash
bun run build:local && bun run release
```

`release` writes the artifact to a `dist` branch (git plumbing, never a checked-out orphan
branch) and tags it `viewer-v<version>`: an immutable URL, one `curl`, no node and no bun for
whoever wants the viewer. A fix gets a new version — the old tag keeps serving exactly what
it served. With `gh` authenticated it also attaches the file to a GitHub Release. The
rules around it — what travels in the artefact, how the version is bumped, what the model
set is and is not — are in [`docs/RELEASE.md`](docs/RELEASE.md).

## Using the same bundle as an MCP-App

The bundle is host-agnostic. To render it inside an AI app, serve this exact
file as an MCP resource at a `ui://` URI with mime `text/html;profile=mcp-app`
and have the tool advertise `_meta.ui.resourceUri`; the host fetches it and
renders it in a sandboxed iframe, and the page talks to the host over
postMessage via `@modelcontextprotocol/ext-apps`. No change to the HTML.

## Licences and attribution

This repository is a collection of three kinds of material, and they do not share a licence:

- **the code** — `src/`, `scripts/`, `body/`, `skills/`, the docs — **MIT**, © 2026 Denis Tatarenko
  (`LICENSE`).
- **the anatomy** — the GLB layers exported from the Z-Anatomy atlas, which is based in part on
  BodyParts3D by the Database Center for Life Science — **CC BY-SA 4.0**. Share-alike travels with
  the models and with anything derived from them.
- **the female body surface** — the Blender Studio / Wikimedia scan — **CC0 1.0**.

[`NOTICE.md`](NOTICE.md) is the path-by-path map and carries the credits that have to travel with
a redistribution; the full licence texts are in [`LICENSES/`](LICENSES/). The published viewer
artefact is code only and contains no models.

## Provenance

This repository began as a copy of the science viewer (`kg-viewer` 0.0.54) plus a standalone
three.js page for the body. The science viewer's own two worked cases — a drug overview and a field
survey — are still published from `docs/lynkuet/` and `docs/catmap/` and describe that product, not
this one; the parent repository is
[lebeker/1M_kg_sciense-kg_webapp](https://github.com/lebeker/1M_kg_sciense-kg_webapp).
