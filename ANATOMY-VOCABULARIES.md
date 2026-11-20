# Anatomy vocabularies — what to reference instead of inventing nodes

The health graph must not invent its own names. Every node should point at an existing
vocabulary, every edge at a published relation type. This file is the short list of what to wire
in, and the shape it takes inside `kg/1`.

Rule of thumb: **`id` is a CURIE, `label` is human text, `source` is mandatory.** If a node has no
CURIE, it is a note, not a fact — and it must render with the `not confirmed` mark.

---

## 1. Which vocabulary for which layer

| Layer | Vocabulary | Identifier shape | Use for |
|---|---|---|---|
| Gross anatomy (organs, tissues) | **Uberon** (cross-species) | `UBERON:0000995` = uterus | organ and tissue nodes |
| Clinical anatomy | **FMA** | `FMA:17742` | parts, when Uberon is too coarse |
| Latin anatomical names | **TA2** (Terminologia Anatomica 2) | plain latin string | display alias, not an id |
| Cells | **CL** (Cell Ontology) | `CL:0000066` = epithelial cell | cell-level nodes |
| Cell parts, organelles, processes | **GO** (Gene Ontology) | `GO:0005739` = mitochondrion, `GO:0031966` = mitochondrial membrane | sub-cellular nodes |
| Chemicals, drugs, metabolites | **ChEBI** | `CHEBI:16236` = ethanol, `CHEBI:17303` = morphine | compound nodes |
| Drugs as products / dosing | **RxNorm**, **DrugBank** | `RxCUI:…`, `DRUGBANK:DB…` | medication nodes |
| Lab tests | **LOINC** | `LOINC:3016-3` (verify before use) | analysis / marker nodes |
| Units | **UCUM** | `UCUM:mg/dL` | value units, always explicit |
| Diagnoses | **SNOMED CT**, **ICD-10/11** | `SNOMED:…`, `ICD10:I42` = cardiomyopathy | condition nodes |
| Rare disease | **Orphanet** | `ORPHA:…` | rare condition nodes |
| Genes / proteins | **HGNC**, **UniProt** | `HGNC:…`, `UNIPROT:P01308` | molecular nodes |
| Literature | **PubMed**, **DOI** | `PMID:…`, `DOI:10.…` | evidence nodes |
| Provenance | **W3C PROV-O** | `prov:wasAttributedTo` etc. | edge passport |
| Clinical exchange | **FHIR R5** | resource type + id | export/import layer |

Verified against OLS on 2026-11-12:

```
UBERON:0000995 uterus        UBERON:0000996 vagina
UBERON:0000992 ovary         UBERON:0003889 fallopian tube
GO:0005739     mitochondrion GO:0031966     mitochondrial membrane
CHEBI:16236    ethanol       CHEBI:17303     morphine
```

Anything not verified in this file must be checked against
`https://www.ebi.ac.uk/ols4/api/` before it is written into a graph.

---

## 2. Node shape

```json
{
  "id": "UBERON:0000995",
  "kind": "organ",
  "label": "uterus",
  "aliases": ["womb", "TA2: uterus"],
  "source": "uberon",
  "desc": "…",
  "mesh": "z-anatomy:Uterus'",
  "license": "CC-BY-SA-4.0"
}
```

- `kind` is the graph's own small set: `organ`, `tissue`, `cell`, `organelle`, `compound`,
  `marker`, `condition`, `document`, `protocol`, `medication`.
- `mesh` links the node to a drawable structure. The `z-anatomy` atlas exposes 2000 named
  collections; the female reproductive set is under
  `Visceral systems/Genital systems'/Female genital system'` (Uterus, Vagina, Ovary, Uterine tube,
  Vulva, Clitoris, Broad ligament of uterus).
- A node with a `mesh` but no CURIE is a drawing, not a fact.

---

## 3. Edge shape

```json
{
  "from": "UBERON:0000995",
  "to": "ICD10:N70",
  "label": "site_of",
  "confidence": "established",
  "source": "PMID:12345678",
  "date": "2024-05-01",
  "author": "…"
}
```

Edge labels are a closed list. Do not invent synonyms per screen:

| label | meaning | typical pair |
|---|---|---|
| `part_of` | anatomy hierarchy | organ → system |
| `located_in` | structure inside another | organ → cavity |
| `measured_by` | what a lab test measures | marker → organ/system |
| `indicates` | marker/observation suggests a condition | marker → condition |
| `site_of` | where a condition sits | condition → organ |
| `treats` | intervention → condition | medication/protocol → condition |
| `contraindicates` | intervention vs condition/medication | medication → condition |
| `affects` | compound changes a marker/process | compound → marker |
| `documented_in` | claim → document | fact → literature |

`confidence` is one of `established` / `draft` / `not confirmed`. The third one is what the UI
renders as the mark, instead of a safety wall of text.

---

## 4. What this buys

- A node can be looked up in an external database instead of guessed (`UBERON:0000995` is
  checkable; a bare organ name is not).
- A marker knows what it measures, so "TSH 6.8" lands on a thyroid node rather than on a list.
- A condition knows where it sits, so the 3D view has something to highlight.
- An edge knows where it came from, so "why is this flagged" has an answer.
- Export to FHIR becomes a projection, not a rewrite: `Observation`, `Condition`,
  `MedicationStatement`, `DocumentReference`, `DiagnosticReport`, plus `Provenance`.

---

## 5. Minimum for the health viewer

1. `app.json` declares kinds, edges and the vocabularies it understands.
2. Every seed node carries a CURIE and a `mesh` reference.
3. Every edge carries `confidence`, `source`, `date`.
4. `not confirmed` is a first-class value, not a disclaimer paragraph.
5. A validator rejects a node with no `source` and an edge with no `label` from the closed list.

---

## 6. Licenses

- **Uberon, GO, CL, ChEBI** — CC BY 4.0 (attribution).
- **Z-Anatomy** — CC BY-SA 4.0 (share-alike on derivative works).
- **SNOMED CT** — licensed, not free; use ICD-10 for open distribution.
- **LOINC** — free with attribution, license terms apply.
- **BodyParts3D** — CC BY 4.0.

If a mesh comes from Z-Anatomy, the attribution and share-alike travel with it. A viewer that
ships the mesh is a derivative work; a viewer that fetches it at runtime from a separately
licensed bundle is a collection.
