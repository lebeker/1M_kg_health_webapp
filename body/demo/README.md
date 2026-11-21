# body/demo/graph.json

The demonstration records, and the only copy of them. The page (`body/index.html`) fetches this
file when the reader presses **load demo**; a clean start is an empty page and an empty ruler.

It is deliberately an artifact and not part of the page: somebody else's lab results must never
be what a new reader sees first. Nothing here is saved — the page has no write path — so loading
the demo leaves a clean reader with an empty record of their own (the seed of card T23).

The path is page-relative (`demo/graph.json` from `body/index.html`), so the page works from its
own directory on any static host — GitHub Pages, `python3 -m http.server` at the repo root —
without climbing out of it.

## Shape

A `kg/1` document in the analysis shape the body page draws: one node per dated document, with
`organ`, `panel`, `track`, `values[]`, `summary`, `affects[]`, `evidence`, `confidence` and
`delta`. `meta.birth` and `meta.life_expectancy` are what the timeline projects from; without a
`birth` there is no ruler.

This is **not** the `kg/1-health` profile (`scripts/schema/kg-1-health.schema.json`), which has
seven event kinds and no `analysis` kind, and which requires `meta.profile`. The health profile is
what a real `kg.json` will be (T04), and the adapter from events to these panels is T06/T11. Do
not point the contract gate at this file until that adapter exists — a fixture that is not meant
to conform would only teach the gate to ignore a failure.

## Replaced by T21

T21 ("demo case: man, 65") replaces the contents of this file with the 62-event case. The path
and the loader stay; the records change.
