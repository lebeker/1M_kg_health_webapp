# Export — the two skills that carry the markers out (T20)

A template app has no write path. That is the design, not an oversight: the document is the
record, and a page that could edit it would be a second record of one person. But a reader
eventually wants the numbers somewhere else — on paper for an appointment, or in a format
another system can ingest. Those are the two exits, and both of them are **skills the webapp
hands to the `kg` skill**, never screens.

| skill | what it produces | for whom |
|---|---|---|
| `skills/markers-to-pdf/SKILL.md` | one paginated PDF: a card per panel, every marker with value, reference, flag, date and source | a person, and the person they hand it to |
| `skills/markers-to-fhir/SKILL.md` | one HL7 FHIR R4 `Bundle`: `Observation` per marker, `DiagnosticReport` per panel, `DocumentReference` per source | another system |

`app.json` names both — and, since T22, the third skill `add-prediction`, which writes rather than
exports — under `requires.skills`, and `scripts/bundle.mjs` writes
`skills_url = <repo>/main/skills` into the `kg` catalogue — so `kg check` reports them and
`kg check --install` fetches them. That is the whole delivery mechanism: `{skills_url}/{name}/SKILL.md`.
Nothing else travels, which is why each skill carries its script inside its own `SKILL.md` and
why `scripts/skills.ts --embed` keeps that copy equal to the `.py` the tests run.

**Two steps of that chain are outside this repo and are not done here.** `bun scripts/bundle.mjs`
in `1M_kg_skill` is what copies `requires` into the catalogue that `kg new` reads, and it runs at
release (T26); until it does, the catalogue's `health-viewer` entry still lists `kg` alone. And a
graph created before this change keeps the `meta.requires` it was seeded with — its `kg check`
will not offer the export skills. Both are consequences of the handover being a document, not a
service, and neither blocks the skills from working: they are run from `skills_url`, and the
`kg` skill can install them by name.

## What a marker is, once

`body/lib/main-view.js` decides it: `markers(node)` reads `values[]` (a panel) or a bare `value`
(a single test), and `sourceOf(node)` resolves the document behind it. Both export scripts carry
a port of those four functions, and `scripts/skills.test.ts` runs the app's own `MainView` and
the port on the demo and compares **every field of every row** — value, unit, reference, printed
flag, whether the flag is the lab's or a range reading, the LOINC code, the date and the source
document. "Every marker of the main view" is therefore a checked claim, not a description.

## Markers → PDF

```
python3 markers_to_pdf.py --graph kg.json --out markers.pdf --json
```

A PDF 1.4 file written by hand: base-14 Helvetica, uncompressed content streams, a `ToUnicode`
map so the text can be selected and copied. python3 and nothing else — no reportlab, no pandoc,
no browser, no network. On the demo it produces **13 markers from 6 panels on 2 pages**.

| rule | how the file keeps it |
|---|---|
| read-only | the graph is opened once, for reading; `--out` resolving to the graph is refused with exit 2 |
| five fields per row | columns `MARKER · VALUE · UNIT · REFERENCE · FLAG · DATE · SOURCE`, with the LOINC code under the marker's name |
| a flag is the lab's or it says it is not | printed flag prints as printed; `above range` / `below range` plus a footnote when the report printed none |
| a missing field is printed | `missing: no document behind it · no lab named · …`; `—` in a cell, never a blank or a zero |
| pagination | a card that crosses a break repeats its heading and the table header, marked `(continued)`; every page carries `page N of M` |
| deterministic | same graph → same bytes (a test runs it twice and compares hashes) |

It is not PDF/A: the fonts are not embedded. Saying so is cheaper than pretending.

## Markers → FHIR: the survey, and why FHIR

The card asked for the established formats to be surveyed and then either aligned with one or
refused in writing. The full table — FHIR R4, FHIR IPS, HL7 v2 ORU, CDA/C-CDA, openEHR,
ISO 13606, OMOP, the Apple Health export, and the vocabularies on their own — lives in
`skills/markers-to-fhir/SKILL.md`, because that is the copy an agent receives. The verdict:

- **Chosen: HL7 FHIR R4.** Every field the card names has a slot the standard already defines —
  `Observation.valueQuantity`, `referenceRange`, `interpretation`, `effectiveDateTime`,
  `derivedFrom`, `DiagnosticReport.result`/`conclusion`, `DocumentReference`. LOINC and UCUM are
  free to use. Nothing in the mapping had to be invented.
- **No fit, with reasons:** HL7 v2 ORU is a message from a laboratory system and has nowhere to
  put "the document behind this number"; CDA/C-CDA requires an author, a custodian and a patient
  identity the document does not hold; openEHR and ISO 13606 assume a clinical system of record
  that issues and versions compositions; OMOP is a population analytics model with no reference
  ranges or provenance; the Apple Health export carries no ranges, no printed flags and no source
  document; PDF is not machine-readable at all (it is the other, human export).
- **FHIR IPS is the closest miss**, and it is worth naming: an IPS needs a `Patient`, and `kg`
  carries `year_of_birth` and `sex` and no patient id. This bundle is valid input to an IPS
  builder later; it is not one, and it does not fabricate a patient to become one.

### The mapping

| kg | FHIR R4 |
|---|---|
| analysis/observation with `values[]` | `DiagnosticReport` + one `Observation` per row, joined by `result` |
| analysis/observation with a bare `value` | a single `Observation`, no report |
| `name` | `Observation.code.text` |
| `code` (LOINC) | `Observation.code.coding[{system: http://loinc.org}]` — only when the record carries one |
| `value` + `unit` | `Observation.valueQuantity{value, unit}` plus a UCUM `system`/`code` only when the unit maps exactly |
| `ref` | `Observation.referenceRange[0].low`/`.high` |
| `flag` **printed** | `Observation.interpretation` (`low→L`, `normal→N`, `high→H`, `critical→AA`) |
| a range reading the export made | `Observation.note` text, never `interpretation` |
| `when` / demo-era `date` | `effectiveDateTime` |
| the `source` document | `Observation.derivedFrom` → a `DocumentReference` in the same bundle |
| `confirmed` | `status: final` when true, `preliminary` when not (including when the key is absent) |
| a panel's `meaning` | `DiagnosticReport.conclusion` |
| `lab` | `performer[].display` |
| the kg id | `identifier[{system: "urn:kg:node"}]` on every resource |

### What does not fit, written down

`Patient` identity (no name, no birth date), `confidence`, `weight`/`level`, `organ`/`track`,
`affects`, and the document's edges (`tracks`, `contradicts`, `part_of` — no `Condition`
resources are exported, so they have nowhere to land). None of these becomes a private
extension: an extension nobody else understands is a proprietary format wearing a standard's
clothes. An unmapped unit keeps its printed text and loses its code, and the run's report lists
it.

### The round trip is the evidence

```
python3 markers_to_fhir.py --graph kg.json --out bundle.json
python3 markers_to_fhir.py --graph kg.json --bundle bundle.json --roundtrip
```

The second command reads the file that was just written, rebuilds every marker from the FHIR
resources and compares name, value, unit, printed flag, reference range, LOINC code, date and
source document. Rows are matched on their own `Observation.id`, never by position, so a bundle
whose entries are in any order still compares the right marker with the right marker. It also
checks the rules FHIR itself states: unique ids, `status` / `code` / `effectiveDateTime` on every
`Observation`, every `result` **and** every `derivedFrom` reference resolving inside the bundle
(and carrying the kg id it resolves to), `DocumentReference` with `status` and `content`. On the
demo:

```
13 markers -> 13 Observations, 6 DiagnosticReports, 1 DocumentReference
round trip: 13 observations read back, 0 field mismatches, 0 structural issues
```

The test suite also runs it the other way round: it tampers with one value in the written bundle
and requires the round trip to **fail**. A comparison that cannot fail proves nothing.

## What these skills must never become

- **A screen.** No button, no panel, no download link in the page. The export is the skill's job,
  and the page keeps writing nothing.
- **A writer.** Neither script calls `kg.py add-node`, and neither opens the graph for writing.
  A PDF is not an event; a bundle is not a second record.
- **An interpreter.** No unit conversion, no rounding, no diagnosis. The only reading either one
  makes on its own is *above range* / *below range*, and both say so in the output.

## Running the checks

```
bun run verify                    # lint, types, the whole suite (T20's export tests included), contract,
                                  # branch-name and split checks
bun scripts/skills.ts             # is each SKILL.md's embedded copy still the .py it claims?
bun scripts/skills.ts --embed      # re-copy the .py into its SKILL.md
```

The suite runs both scripts exactly as the skills tell an agent to run them, and separately proves
that the block inside each `SKILL.md` is byte-identical to the `.py` it was copied from. Two
checks, one artifact: the code that travels is the code that was tested.
