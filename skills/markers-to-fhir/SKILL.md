---
name: markers-to-fhir
description: Use when health markers must leave in an established record format — maps each marker to a HL7 FHIR R4 Observation and DiagnosticReport, surveys the formats that did not fit, and proves the mapping with a round trip.
---

# Markers → FHIR

The machine-readable half of the export. `markers-to-pdf` prints the panel for a reader; this
skill turns the same markers into a HL7 FHIR R4 bundle that another system can ingest, and then
reads its own output back to prove every field survived. The survey below is why FHIR, and the
round trip is the evidence — a mapping nobody has read back is a claim.

Read the `kg` skill first: `kg.json` is the source, this is one more view of it, and nothing is
written back. `docs/MAIN-VIEW.md` defines the marker; `docs/EXPORT.md` in the health app repo
carries the same survey and verdict.

## The survey — what was considered, and why each one lost

| format | what it is | verdict here |
|---|---|---|
| **HL7 FHIR R4** (`Observation`, `DiagnosticReport`, `DocumentReference`) | the current HL7 interchange standard; JSON resources with coded concepts, quantities, reference ranges, provenance | **chosen.** Every field the card names has a slot the standard already defines: `valueQuantity`, `referenceRange`, `interpretation`, `effectiveDateTime`, `derivedFrom`. LOINC and UCUM are free to use. Nothing had to be invented. |
| FHIR IPS (International Patient Summary) | a FHIR profile for a cross-border patient summary | **no fit as the target.** It requires a `Patient` identity and a curated problem list; kg carries `year_of_birth` and `sex` and no patient id. Emitting a Patient would mean inventing a birth date and a name. The bundle this skill writes is a valid input to an IPS builder later, not an IPS. |
| HL7 v2 ORU^R01 | pipe-delimited lab result messages, MLLP transport | **no fit.** It is a message about a specimen from a lab system to a clinical one: no place for "the document behind this number", no patient identifier in kg, and no way to say a value is unconfirmed. Making one would be a fake message from a fake lab. |
| CDA R2 / C-CDA | XML clinical documents with required author, custodian and patient roles | **no fit.** The document model demands identities kg does not hold, and the payload would be an XML document asserting authorship nobody can claim. |
| openEHR / ISO 13606 | archetype-based EHR with a repository and versioned compositions | **no fit.** Both assume a clinical system of record that issues and versions the compositions. kg is a file the person owns; there is no server to be the record. |
| OMOP CDM | a relational analytics model for populations | **no fit.** It is for cohorts, not one person's file, and it holds no reference ranges, no printed flags and no provenance documents. |
| Apple Health XML export | a device/aggregator dump of samples | **no fit.** No reference range per marker, no laboratory flag, no source document — the three things this export exists to carry. |
| LOINC + UCUM alone | vocabularies, not a container | **used, inside FHIR.** A vocabulary is not a record format, but the two are what make the mapping trustworthy. |
| PDF (see `markers-to-pdf`) | paginated card for a human | **not this.** Kept as the second, human-facing export. A PDF is not machine-readable and this skill does not pretend otherwise. |

The verdict is therefore an **alignment**, not a "no fit": FHIR R4 carries the markers, with the
losses listed below written down rather than papered over.

## The mapping, field by field

| kg (main view) | FHIR R4 | note |
|---|---|---|
| one analysis/observation record with `values[]` | `DiagnosticReport` + one `Observation` per row, `DiagnosticReport.result` pointing at each | a panel is a report; a single test with no `values[]` is a bare `Observation` |
| `values[].name` | `Observation.code.text` | always present |
| `values[].code` (LOINC) | `Observation.code.coding[{system: http://loinc.org, code}]` | absent when the record has none; never guessed from the name |
| `values[].value` + `unit` | `Observation.valueQuantity{value, unit, system: http://unitsofmeasure.org, code}` | the printed unit stays in `unit`; `code` is added only when the unit maps to UCUM exactly |
| `values[].ref` | `Observation.referenceRange[0].low/.high` | one end may be missing; both missing means no `referenceRange` at all |
| `values[].flag` **printed** | `Observation.interpretation` — `low→L`, `normal→N`, `high→H`, `critical→AA` | `critical` is directionless in kg, so `AA` (critical abnormal), never `HH`/`LL` |
| a flag the export derived from the range | **not** `interpretation` — `Observation.note` text | a reader's comparison must never look like the laboratory's flag |
| `when` (or the demo-era `date`) | `effectiveDateTime` | `YYYY-MM-DD`. An interval — `{from, to}` — exports its `from` day and drops the `to`, because `effectiveDateTime` holds one point and the main view prints the start of the interval; the interval is not turned into a `Period`, which would claim the record covers the span |
| the `document` node named by `source` | `Observation.derivedFrom` → `DocumentReference` in the bundle | the document's own label, lab and path travel with it |
| record `confirmed` | `Observation.status` / `DiagnosticReport.status`: `final` when true, `preliminary` when not | `status` is the workflow state, not the truth of the number; `preliminary` is the honest word for "nobody has checked this" |
| the plain-language `meaning` of a panel | `DiagnosticReport.conclusion` | FHIR's own slot for the reading of a result |
| `lab` | `Observation.performer[0].display`, `DiagnosticReport.performer[0].display` | a display name, because kg has no Organization id to reference |
| the record's kg id | `identifier[{system: "urn:kg:node", value: id}]` on every resource, plus `urn:kg:marker:` / `urn:kg:panel:` fullUrls | this is how the round trip finds the record again, and how a reader gets back to it |
| the scan/link path | `DiagnosticReport.presentedForm[].title`, `DocumentReference.content[].attachment.title` | a repo-relative path is not a URI, so it is not passed off as one |

## What does not fit, and is said out loud

- **Patient identity.** kg holds `year_of_birth` and `sex`, not a name or a birth date. No
  `Patient` resource is emitted, and `Observation.subject` is left out rather than pointed at a
  fabricated patient. This is the single biggest gap between this bundle and an IPS.
- **Confidence, weight, level, organ, track, affects.** kg's own numbers and graph metrics have no
  FHIR field. They are not exported as private extensions: an extension nobody else understands
  is a proprietary format wearing a standard's clothes.
- **Edges.** `tracks`, `contradicts` and `part_of` are the map. The bundle carries no Condition
  resources, so those relations have nowhere to land; the app keeps showing them, the export does
  not pretend to.
- **An unmapped unit.** A unit with no exact UCUM code keeps its printed text and loses its code;
  the report lists it. Guessing `mg/l` → `mg/L` is fine, guessing `IU` → something is not.
- **A `critical` flag with a direction.** kg does not record whether it was high or low.
- **The reading of a range with no printed flag** is prose in a note, not a coded interpretation.

## The procedure

1. **Check the graph is health-shaped** (`kg check`), and that the markers exist: a document with
   no analysis records is an empty bundle, which is a valid answer and a waste of time.
2. **Write the script out** — the block below, verbatim, to `markers_to_fhir.py` (the source of
   truth is `skills/markers-to-fhir/scripts/markers_to_fhir.py` in the health app repo). python3
   and nothing else.
3. **Export and prove it in one run.**

   ```
   python3 markers_to_fhir.py --graph kg.json --out bundle.json --json
   python3 markers_to_fhir.py --graph kg.json --bundle bundle.json --roundtrip
   ```

   The second command reads the file just written, reconstructs every marker and compares name,
   value, unit, printed flag, reference range, LOINC code, date and source document — matching
   each row on its own Observation id, so the order a bundle happens to be in cannot disguise a
   mismatch. It also checks what FHIR itself requires: unique ids, `status`/`code`/
   `effectiveDateTime` on every Observation, every `result` **and** every `derivedFrom` reference
   resolving inside the bundle. It exits non-zero on any
   mismatch — a failed round trip is a failed export, and the answer is to fix the mapping, not
   to widen the comparison until it passes.
4. **Report the shape and the losses.** "13 markers, 13 Observations, 6 DiagnosticReports, 1
   DocumentReference, round trip 13/13 with no mismatches. Nine markers carry no LOINC code and
   say so; one scan is a path, not a URL; no Patient resource, because kg has no patient
   identity." A bundle that quietly drops a field is worse than a report that names it.

## Rules the script keeps

- **Read-only.** The graph is the source; the bundle is a sibling file. It refuses an `--out`
  that resolves to the graph.
- **No invented code.** A LOINC code comes from the record. No name is matched against a
  vocabulary by the export — a wrong code is a wrong fact with an authority stamp.
- **No invented patient, no invented author.** Absent is absent.
- **A printed flag and a derived reading never share a field.**
- **`preliminary` for anything unconfirmed**, including a record with no `confirmed` key at all:
  silence is not confirmation.

## The script

Verbatim copy of `skills/markers-to-fhir/scripts/markers_to_fhir.py`. It travels inside this
file because `kg check --install` from `skills_url` fetches only `SKILL.md`; a skill that needed a
second file would arrive broken. `scripts/skills.test.ts` fails if this copy drifts from the one
in the repo.

<!-- script: scripts/markers_to_fhir.py — copied from the .py of the same name by `bun scripts/skills.ts --embed`; edit the .py, not this block -->
```python
#!/usr/bin/env python3
"""Markers -> HL7 FHIR R4 (Observation / DiagnosticReport / DocumentReference), with a round trip.

The second of the two export skills. It answers the same question as `markers-to-pdf` — what do
the markers of the main view look like outside this app — but for a machine instead of a reader.

**The format was chosen, not inherited.** `docs/EXPORT.md` and this skill's own `FORMATS` section
hold the survey: FHIR R4 wins because a marker with a reference range, a printed flag, a date and
a source document maps onto resources the standard already has (Observation.referenceRange,
Observation.interpretation, effectiveDateTime, derivedFrom), the codes it needs (LOINC, UCUM) are
free to use, and nothing in the mapping is invented. The formats that lost lost for stated
reasons, not because they are worse software.

**The mapping proves itself.** `--roundtrip` writes the bundle, reads it back with the same
script and compares every marker field by field. A mapping that cannot be read back is a claim,
not a mapping. The comparison is the acceptance:

    name · value · unit · printed flag · reference range · LOINC code · date · source document

**Nothing is written to kg.json.** The graph is opened read-only; the bundle is a sibling file.
The kg ids travel as `identifier: {system: "urn:kg:node"}` so a reader can always get back to the
record the marker came from — the export does not become a second, competing record.

Usage:

    python3 markers_to_fhir.py --graph kg.json --out bundle.json
    python3 markers_to_fhir.py --graph kg.json --out bundle.json --json
    python3 markers_to_fhir.py --graph kg.json --bundle bundle.json --roundtrip
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FLAGS = ("low", "normal", "high", "critical")
ANALYSIS_KINDS = ("analysis", "observation")

KG_SYSTEM = "urn:kg:node"
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category"
INTERPRETATION = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation"

# kg flag -> FHIR v3 ObservationInterpretation. `critical` is directionless in kg (the lab printed
# "critical", not "critical high"), so it becomes AA — "critical abnormal" — and never HH or LL,
# which would be a direction the document does not state.
INTERPRETATIONS = {
    "low": ("L", "Low"),
    "normal": ("N", "Normal"),
    "high": ("H", "High"),
    "critical": ("AA", "Critical abnormal"),
}
INTERPRETATIONS_BACK = {code: flag for flag, (code, _) in INTERPRETATIONS.items()}

# kg unit -> UCUM. Only the units the documents actually carry; an unknown unit is reported, not
# guessed at. UCUM is case-sensitive: `mmol/l` is `mmol/L`, and `bpm` is `/min`.
UCUM_BY_UNIT = {
    "mmol/l": "mmol/L",
    "umol/l": "umol/L",
    "µmol/l": "umol/L",
    "mIu/l": "m[IU]/L",
    "miu/l": "m[IU]/L",
    "u/l": "U/L",
    "g/l": "g/L",
    "g/dl": "g/dL",
    "mg/dl": "mg/dL",
    "mmhg": "mm[Hg]",
    "bpm": "/min",
    "%": "%",
    "10^9/l": "10*9/L",
    "10^12/l": "10*12/L",
    "mmol/mol": "mmol/mol",
    "kg/m2": "kg/m2",
    "cm": "cm",
    "kg": "kg",
    "ml/min/1.73m2": "mL/min/{1.73_m2}",
    "": "",
}


# ---------------------------------------------------------------------------------------------
# The main view's rules, restated in Python — the same port `markers-to-pdf` carries, and pinned
# against `body/lib/main-view.js` by `scripts/skills.test.ts`. Two skills, one definition.
# ---------------------------------------------------------------------------------------------


def text(value):
    return "" if value is None else str(value).strip()


def num(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value and abs(value) != float("inf") else None
    if isinstance(value, str) and value.strip() != "":
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
        return parsed if parsed == parsed and abs(parsed) != float("inf") else None
    return None


def js_number(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return repr(value) if isinstance(value, float) else str(value)


def truthy(value):
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0:
        return False
    if isinstance(value, str) and value == "":
        return False
    if isinstance(value, (list, dict)) and len(value) == 0:
        return False
    return True


def first_truthy(*values):
    for value in values:
        if truthy(value):
            return value
    return None


def day(value):
    if isinstance(value, dict):
        value = value.get("from")
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", "" if value is None else str(value))
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else ""


def date_of(node):
    node = node or {}
    return day(node.get("when")) or day(node.get("date"))


def id_of(node):
    return text((node or {}).get("id"))


def label_of(node):
    return text(first_truthy((node or {}).get("label"), (node or {}).get("id")))


def reference_text(low, high):
    if low is None and high is None:
        return ""
    if low is None:
        return "up to " + js_number(high)
    if high is None:
        return "from " + js_number(low)
    return js_number(low) + " – " + js_number(high)


def marker(name, value, unit, ref, flag, code):
    low = high = None
    if isinstance(ref, list):
        low = num(ref[0]) if len(ref) > 0 else None
        high = num(ref[1]) if len(ref) > 1 else None
    elif isinstance(ref, dict):
        low, high = num(ref.get("low")), num(ref.get("high"))
    out = (low is not None and value < low) or (high is not None and value > high)
    printed = flag if flag in FLAGS else ""
    return {
        "name": text(name),
        "value": value,
        "unit": text(unit),
        "ref": None if low is None and high is None else [low, high],
        "reference": reference_text(low, high),
        "flag": printed,
        "from": "lab" if printed else ("range" if out else ""),
        "out": (printed != "normal") if printed else out,
        "code": text(code),
    }


def markers(node):
    out = []
    node = node or {}
    if isinstance(node.get("values"), list):
        for row in node["values"]:
            row = row if isinstance(row, dict) else {}
            value = num(row.get("value"))
            if value is None:
                continue
            out.append(marker(first_truthy(row.get("name"), row.get("label"), row.get("code")),
                              value, row.get("unit"), row.get("ref"), row.get("flag"),
                              row.get("code")))
        return out
    single = num(node.get("value"))
    if single is not None:
        has_ref = node.get("ref_low") is not None or node.get("ref_high") is not None
        ref = [node.get("ref_low"), node.get("ref_high")] if has_ref else None
        out.append(marker(first_truthy(node.get("label"), node.get("id")), single, node.get("unit"),
                          ref, node.get("flag"), node.get("code")))
    return out


def source_of(node, by_id):
    node = node or {}
    source_id = node.get("source")
    doc = by_id.get(source_id) if isinstance(source_id, str) else None
    lab = text(node.get("lab")) or text((doc or {}).get("lab")) or text((doc or {}).get("publisher"))
    address = text(node.get("address")) or text((doc or {}).get("address"))
    link = text(node.get("scan")) or text(node.get("link")) or text((doc or {}).get("link"))
    return {
        "lab": lab,
        "address": address,
        "link": link,
        "document": None if not doc else {
            "id": id_of(doc),
            "label": label_of(doc),
            "date": date_of(doc),
            "link": text(doc.get("link")),
        },
    }


def meaning(node):
    node = node or {}
    return text(node.get("meaning")) or text(node.get("summary")) or text(node.get("desc"))


def cards_of(graph):
    nodes = [n for n in (graph.get("nodes") or []) if isinstance(n, dict)]
    by_id = {id_of(n): n for n in nodes if id_of(n)}
    cards = []
    for node in nodes:
        if text(node.get("kind")) not in ANALYSIS_KINDS:
            continue
        rows = markers(node)
        if not rows:
            continue
        source = source_of(node, by_id)
        cards.append({
            "node": id_of(node),
            "label": label_of(node),
            "date": date_of(node),
            "panel": text(node.get("panel")),
            "organ": text(node.get("organ")),
            "confirmed": node.get("confirmed") is True,
            "is_panel": isinstance(node.get("values"), list),
            "source": None if not source["document"] else source["document"]["id"],
            "source_label": None if not source["document"] else source["document"]["label"],
            "lab": source["lab"],
            "link": source["link"],
            "meaning": meaning(node),
            "markers": rows,
        })
    cards.sort(key=lambda card: (card["date"], card["node"]))
    return cards


# ---------------------------------------------------------------------------------------------
# kg -> FHIR
# ---------------------------------------------------------------------------------------------


def quantity(value, unit):
    """A Quantity with the unit the document printed, plus a UCUM code only when one is known."""
    out = {"value": int(value) if float(value).is_integer() else value, "unit": unit}
    code = UCUM_BY_UNIT.get(unit.strip().lower())
    if code:
        out["system"] = UCUM
        out["code"] = code
    return out


def safe_id(value):
    """A FHIR `id`: [A-Za-z0-9-.], at most 64 characters."""
    cleaned = re.sub(r"[^A-Za-z0-9.\-]", "-", value)
    return cleaned[:64] or "resource"


def document_url(source_id):
    """The one place a kg document id becomes a FHIR reference.

    A kg id is unique but not restricted to the FHIR `id` charset (`docs/DATA-CONTRACT.md`), so
    `doc_lipid_2026` has to travel as `doc-lipid-2026`. Both the DocumentReference fullUrl and
    every `derivedFrom` that points at it come from here, or the bundle carries a dangling
    reference. The raw id survives in `identifier.value`, which is what reads back.
    """
    return "urn:kg:node:" + safe_id(source_id)


def observation_id(node, index):
    """A marker's Observation id — and therefore the key the round trip matches rows on."""
    return safe_id(f"{node}-{index}")


def document_reference(card, document=None):
    content = {"attachment": {"contentType": "application/pdf",
                              "title": card["link"] or card["source_label"] or ""}}
    resource = {
        "resourceType": "DocumentReference",
        # the id half of document_url(source): fullUrl and every derivedFrom meet here
        "id": safe_id(card["source"]),
        "identifier": [{"system": KG_SYSTEM, "value": card["source"]}],
        "status": "current",
        "content": [content],
    }
    when = date_of(document) if document else ""
    if when:
        resource["date"] = when
    if card["source_label"]:
        resource["type"] = {"text": card["source_label"]}
        resource["description"] = card["source_label"]
    return resource


def observation(card, row, index):
    resource = {
        "resourceType": "Observation",
        "id": observation_id(card["node"], index),
        "identifier": [{"system": KG_SYSTEM, "value": card["node"]}],
        # `status` is the workflow state, not the truth of the number: an unconfirmed record is
        # `preliminary`, which is what "nobody has checked this" means in FHIR. It is never
        # `final` on the strength of a number simply existing.
        "status": "final" if card["confirmed"] else "preliminary",
        "category": [{"coding": [{"system": OBS_CATEGORY, "code": "laboratory",
                                  "display": "Laboratory"}]}],
        "code": {"text": row["name"]},
        "effectiveDateTime": card["date"],
        "valueQuantity": quantity(row["value"], row["unit"]),
    }
    if row["code"]:
        resource["code"]["coding"] = [{"system": LOINC, "code": row["code"]}]
    if card["source"]:
        # The same sanitised id the DocumentReference's fullUrl carries, or the reference dangles.
        resource["derivedFrom"] = [{"reference": document_url(card["source"]),
                                    "display": card["source_label"] or card["source"]}]
    if card["lab"]:
        resource["performer"] = [{"display": card["lab"]}]
    if row["ref"]:
        low, high = row["ref"]
        reference_range = {}
        if low is not None:
            reference_range["low"] = quantity(low, row["unit"])
        if high is not None:
            reference_range["high"] = quantity(high, row["unit"])
        resource["referenceRange"] = [reference_range]
    if row["flag"] in INTERPRETATIONS:
        code, display = INTERPRETATIONS[row["flag"]]
        resource["interpretation"] = [{"coding": [{"system": INTERPRETATION, "code": code,
                                                   "display": display}]}]
    notes = []
    if not card["confirmed"]:
        notes.append("not confirmed in the source record: nobody has checked this value")
    if row["from"] == "range":
        notes.append("the report printed no flag; this export compared the value with the "
                     "reference and read it as " + ("above range" if row["out"] else "below range")
                     + " — that reading is not the laboratory's")
    if notes:
        resource["note"] = [{"text": note} for note in notes]
    return resource


def diagnostic_report(card, observations):
    resource = {
        "resourceType": "DiagnosticReport",
        "id": safe_id(card["node"]),
        "identifier": [{"system": KG_SYSTEM, "value": card["node"]}],
        "status": "final" if card["confirmed"] else "preliminary",
        "category": [{"coding": [{"system": OBS_CATEGORY, "code": "laboratory",
                                  "display": "Laboratory"}]}],
        "code": {"text": card["panel"] or card["label"]},
        "effectiveDateTime": card["date"],
        "result": [{"reference": resource_ref(item), "display": item["code"].get("text")}
                   for item in observations],
    }
    if card["lab"]:
        resource["performer"] = [{"display": card["lab"]}]
    if card["meaning"]:
        # `conclusion` is FHIR's own slot for the plain-language reading of a result.
        resource["conclusion"] = card["meaning"]
    if card["link"]:
        # A repository-relative path is not a URI FHIR may promise to resolve, so it travels as
        # the attachment's title and is recorded in the report as a partial mapping.
        resource["presentedForm"] = [{"contentType": "application/pdf", "title": card["link"]}]
    return resource


def resource_ref(resource):
    """Each resource's own fullUrl. A report is not a marker, so it gets its own namespace."""
    prefix = {"Observation": "urn:kg:marker:", "DiagnosticReport": "urn:kg:panel:",
              "DocumentReference": "urn:kg:node:"}.get(resource.get("resourceType"), "urn:kg:x:")
    return prefix + resource["id"]


def bundle_of(graph):
    cards = cards_of(graph)
    entries, unmapped_units, no_loinc, documents = [], set(), [], set()
    for card in cards:
        if card["source"] and card["source"] not in documents:
            documents.add(card["source"])
            entries.append(document_reference(card, document_of(graph, card["source"])))
        observations = []
        for index, row in enumerate(card["markers"]):
            item = observation(card, row, index)
            if "system" not in item["valueQuantity"]:
                unmapped_units.add(row["unit"])
            if not row["code"]:
                no_loinc.append({"node": card["node"], "marker": row["name"]})
            observations.append(item)
        if card["is_panel"]:
            entries.append(diagnostic_report(card, observations))
        entries.extend(observations)
    bundle = {"resourceType": "Bundle", "type": "collection",
              "entry": [{"fullUrl": resource_ref(resource), "resource": resource}
                        for resource in entries]}
    losses = {
        "unmapped_units": sorted(unmapped_units),
        "no_loinc_code": no_loinc,
        "documents_without_an_addressable_url": [
            {"node": card["node"], "path": card["link"]}
            for card in cards if card["link"] and not card["link"].startswith("http")],
    }
    return bundle, cards, losses


def document_of(graph, document_id):
    for node in graph.get("nodes") or []:
        if isinstance(node, dict) and id_of(node) == document_id:
            return node
    return None


# ---------------------------------------------------------------------------------------------
# FHIR -> kg, and the comparison that proves the mapping
# ---------------------------------------------------------------------------------------------


def read_back(bundle):
    """Every Observation in the bundle, back as the marker row the main view would draw."""
    entries = bundle.get("entry") or []
    resources = [entry.get("resource") or {} for entry in entries]
    by_full_url = {entry.get("fullUrl"): entry.get("resource") or {} for entry in entries}
    # A `derivedFrom` names a sanitised URL; the kg id it stands for is the identifier the
    # DocumentReference carries. This is the only way back from `doc-lipid-2026` to
    # `doc_lipid_2026`, and it is why the round trip compares source ids that kg actually uses.
    kg_by_url = {}
    for entry in entries:
        resource = entry.get("resource") or {}
        for identifier in resource.get("identifier") or []:
            if identifier.get("system") == KG_SYSTEM:
                kg_by_url[entry.get("fullUrl")] = identifier.get("value")
    reports = {}
    for resource in resources:
        if resource.get("resourceType") == "DiagnosticReport":
            report_id = (resource.get("identifier") or [{}])[0].get("value")
            reports[resource.get("id")] = report_id
    rows = []
    for resource in resources:
        if resource.get("resourceType") != "Observation":
            continue
        node = (resource.get("identifier") or [{}])[0].get("value", "")
        value_quantity = resource.get("valueQuantity") or {}
        reference_range = (resource.get("referenceRange") or [{}])[0]
        low = (reference_range.get("low") or {}).get("value")
        high = (reference_range.get("high") or {}).get("value")
        interpretation = (((resource.get("interpretation") or [{}])[0].get("coding") or [{}])[0]
                          .get("code") or "")
        coding = (resource.get("code") or {}).get("coding") or [{}]
        derived = (resource.get("derivedFrom") or [{}])[0].get("reference") or ""
        panel = None
        for report in resources:
            if report.get("resourceType") != "DiagnosticReport":
                continue
            urls = [item.get("reference") for item in report.get("result") or []]
            if resource_ref(resource) in urls:
                panel = (report.get("identifier") or [{}])[0].get("value")
        rows.append({
            "node": node,
            "panel": panel,
            "name": (resource.get("code") or {}).get("text", ""),
            "value": None if value_quantity.get("value") is None
            else float(value_quantity["value"]),
            "unit": value_quantity.get("unit", ""),
            "ref": None if low is None and high is None
            else [None if low is None else float(low), None if high is None else float(high)],
            "flag": INTERPRETATIONS_BACK.get(interpretation, ""),
            "code": coding[0].get("code", "") if coding and coding[0].get("system") == LOINC
            else "",
            "date": resource.get("effectiveDateTime", ""),
            "source": kg_by_url.get(derived, ""),
            "status": resource.get("status", ""),
            "id": resource.get("id", ""),
            "_resolved": by_full_url.get(resource_ref(resource)) is not None,
            "_source_resolved": not derived or derived in kg_by_url,
        })
    rows.sort(key=lambda row: (row["node"], row["id"]))
    return rows, reports


def compare(cards, rows):
    """The acceptance: every field the card names, from the document and from the bundle.

    Rows are matched on the Observation id — `observation_id(node, index)`, the same string the
    bundle's resource carries — and never by position. Two `zip`s of lists that are sorted
    differently (`…-10` sorts before `…-2`) compare different markers from the tenth row on and
    report a correct bundle as broken; a panel of a dozen rows is ordinary.
    """
    expected = []
    for card in cards:
        for index, row in enumerate(card["markers"]):
            expected.append({
                "id": observation_id(card["node"], index),
                "node": card["node"], "name": row["name"], "value": row["value"],
                "unit": row["unit"], "ref": row["ref"], "flag": row["flag"],
                "code": row["code"], "date": card["date"], "source": card["source"] or "",
                "panel": card["node"] if card["is_panel"] else None,
            })
    expected.sort(key=lambda row: row["id"])
    got_by_id = {}
    for row in rows:
        got_by_id.setdefault(row["id"], row)
    mismatches = []
    if len(expected) != len(rows):
        mismatches.append({"field": "count", "expected": len(expected), "read_back": len(rows)})
    # A row that only one side has is a mismatch in its own right; `zip` would have hidden it.
    for missing in sorted({row["id"] for row in expected} - set(got_by_id)):
        mismatches.append({"field": "id", "expected": missing, "read_back": None})
    for extra in sorted(set(got_by_id) - {row["id"] for row in expected}):
        mismatches.append({"field": "id", "expected": None, "read_back": extra})
    for want in expected:
        got = got_by_id.get(want["id"])
        if got is None:
            continue
        for field in ("node", "name", "unit", "flag", "code", "date", "source"):
            if want[field] != got.get(field):
                mismatches.append({"marker": want.get("name"), "node": want["node"], "field": field,
                                   "expected": want[field], "read_back": got.get(field)})
        # A single-test record has no report, so `panel` is None on both sides for it.
        if want["panel"] != got.get("panel"):
            mismatches.append({"marker": want["name"], "node": want["node"], "field": "panel",
                               "expected": want["panel"], "read_back": got.get("panel")})
        if want["value"] != got["value"] and (want["value"] is None or got["value"] is None
                                              or abs(want["value"] - got["value"]) > 1e-9):
            mismatches.append({"marker": want["name"], "node": want["node"], "field": "value",
                               "expected": want["value"], "read_back": got["value"]})
        if want["ref"] != got["ref"]:
            mismatches.append({"marker": want["name"], "node": want["node"], "field": "ref",
                               "expected": want["ref"], "read_back": got["ref"]})
    return mismatches


def structural_issues(bundle, rows):
    """Rules FHIR itself states, checked on the file that was written — not on the model."""
    issues = []
    entries = bundle.get("entry") or []
    resources = [entry.get("resource") or {} for entry in entries]
    urls = {entry.get("fullUrl") for entry in entries}
    # The fullUrls whose resource carries a kg id, so a `derivedFrom` can be read back to a record.
    kg_ids_by_url = {entry.get("fullUrl") for entry in entries
                     for identifier in (entry.get("resource") or {}).get("identifier") or []
                     if identifier.get("system") == KG_SYSTEM}
    ids = [(resource.get("resourceType"), resource.get("id")) for resource in resources]
    if bundle.get("resourceType") != "Bundle":
        issues.append("not a Bundle")
    if len(set(ids)) != len(ids):
        issues.append("duplicate resource ids in the bundle")
    for resource in resources:
        kind = resource.get("resourceType")
        if kind == "Observation":
            for field in ("status", "code", "valueQuantity"):
                if not resource.get(field):
                    issues.append(f"Observation {resource.get('id')} has no {field}")
            if not resource.get("effectiveDateTime"):
                issues.append(f"Observation {resource.get('id')} has no effectiveDateTime")
            if resource.get("status") not in ("final", "preliminary"):
                issues.append(f"Observation {resource.get('id')} has an unexpected status")
            if (resource.get("valueQuantity") or {}).get("system") == UCUM and not \
                    (resource.get("valueQuantity") or {}).get("code"):
                issues.append(f"Observation {resource.get('id')} claims UCUM without a code")
        elif kind == "DiagnosticReport":
            for field in ("status", "code", "result"):
                if not resource.get(field):
                    issues.append(f"DiagnosticReport {resource.get('id')} has no {field}")
            for result in resource.get("result") or []:
                if result.get("reference") not in urls:
                    issues.append(f"DiagnosticReport {resource.get('id')} points at a resource "
                                  f"that is not in the bundle: {result.get('reference')}")
        elif kind == "DocumentReference":
            for field in ("status", "content"):
                if not resource.get(field):
                    issues.append(f"DocumentReference {resource.get('id')} has no {field}")
        for reference in resource.get("derivedFrom") or []:
            url = reference.get("reference")
            if url not in urls:
                issues.append(f"{kind} {resource.get('id')} derives from a resource that is not "
                              f"in the bundle: {url}")
            elif url not in kg_ids_by_url:
                issues.append(f"{kind} {resource.get('id')} derives from {url}, which carries no "
                              f"urn:kg:node identifier to read the record back through")
    # Every entry's fullUrl must be the one its own resource id produces, or nothing that points
    # at a resource can be resolved by a reader that computes URLs the same way this bundle does.
    for entry in entries:
        resource = entry.get("resource") or {}
        if entry.get("fullUrl") != resource_ref(resource):
            issues.append(f"{resource.get('resourceType')} {resource.get('id')} is published as "
                          f"{entry.get('fullUrl')} but referenced as {resource_ref(resource)}")
    for row in rows:
        if not row["_resolved"]:
            issues.append(f"Observation {row['id']} is not addressable by its own fullUrl")
        if not row["_source_resolved"]:
            issues.append(f"Observation {row['id']} derives from a document the bundle does not "
                          f"carry")
    return issues


# ---------------------------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Every marker of the main view as a FHIR R4 Bundle, with a round trip.")
    parser.add_argument("--graph", required=True, help="the kg/1 document (read-only)")
    parser.add_argument("--out", help="the bundle to write")
    parser.add_argument("--bundle", help="a bundle already on disk, for --roundtrip")
    parser.add_argument("--roundtrip", action="store_true",
                        help="read the bundle back and compare every marker field")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args(argv)

    graph_path = Path(args.graph)
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"cannot read {graph_path}: {error}", file=sys.stderr)
        return 2

    bundle, cards, losses = bundle_of(graph)

    if args.out:
        out_path = Path(args.out)
        if out_path.resolve() == graph_path.resolve():
            print("refusing: --out is the graph; the export never writes kg.json", file=sys.stderr)
            return 2
        out_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")

    read_from = bundle
    if args.bundle:
        try:
            read_from = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"cannot read {args.bundle}: {error}", file=sys.stderr)
            return 2

    rows, reports = read_back(read_from)
    mismatches = compare(cards, rows) if args.roundtrip else []
    issues = structural_issues(read_from, rows) if args.roundtrip else []
    resources = [entry.get("resource") or {} for entry in read_from.get("entry") or []]
    counts = {
        "observations": sum(1 for r in resources if r.get("resourceType") == "Observation"),
        "diagnostic_reports": sum(1 for r in resources
                                  if r.get("resourceType") == "DiagnosticReport"),
        "document_references": sum(1 for r in resources
                                   if r.get("resourceType") == "DocumentReference"),
    }
    report = {
        "graph": str(graph_path),
        "bundle": args.out or args.bundle,
        "markers": sum(len(card["markers"]) for card in cards),
        "panels": len(reports),
        **counts,
        "roundtrip": None if not args.roundtrip else {
            "compared": len(rows), "mismatches": mismatches, "structural_issues": issues,
            "passed": not mismatches and not issues,
        },
        "not_carried": losses,
        "unconfirmed_as_preliminary": sum(1 for row in rows if row["status"] == "preliminary"),
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"{report['markers']} markers -> {counts['observations']} Observations, "
              f"{counts['diagnostic_reports']} DiagnosticReports, "
              f"{counts['document_references']} DocumentReferences"
              + (f" -> {args.out}" if args.out else ""))
        if args.roundtrip:
            print(f"round trip: {len(rows)} observations read back, "
                  f"{len(mismatches)} field mismatches, {len(issues)} structural issues")
            for mismatch in mismatches:
                print(f"  MISMATCH {mismatch}")
            for issue in issues:
                print(f"  ISSUE {issue}")
        if losses["unmapped_units"]:
            print("unit without a UCUM code (the printed unit is kept): "
                  + ", ".join(losses["unmapped_units"]))
        if losses["no_loinc_code"]:
            print(f"{len(losses['no_loinc_code'])} marker(s) carry no LOINC code; the name is "
                  "sent as code.text and nothing is invented")
        print("kg.json not touched: " + str(graph_path))
    return 0 if not mismatches and not issues else 1


if __name__ == "__main__":
    sys.exit(main())
```
<!-- /script -->
