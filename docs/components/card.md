# Medical Card

What a doctor reads before a visit. Fixed by a standard, not by taste — and the standard is regional,
so the card is built from a **profile pack** the document names.

## The standard we follow

The **International Patient Summary** (ISO 27269, CEN EN 17269; the HL7 FHIR IPS implementation
guide is the machine-readable form of it). Its sections, in the order a reader expects them:

| section | LOINC-ish id in IPS | ours |
|---|---|---|
| Allergies and Intolerances | 48765-2 | **mandatory** |
| Medication Summary | 10160-0 | **mandatory** |
| Problem List | 11450-4 | **mandatory** |
| Immunizations | 11369-6 | required by the IG |
| History of Procedures | 47519-4 | required by the IG |
| Diagnostic Results | 30954-2 | required by the IG |
| Vital Signs | 8716-3 | required by the IG |
| Medical Devices | 46264-8 | required by the IG |
| Social History (smoking, alcohol) | 29762-2 | optional in IPS, **first question at a visit** |
| Plan of Care, Functional Status, Advance Directives, Pregnancy | — | optional |

Three sections are mandatory in the EU reading of IPS — allergies, medication, problem list. A
document that cannot fill them still shows them, saying `not recorded`, because their absence is
itself clinical information.

## Regional profiles

`meta.profile.region` names the pack; the page renders the card in that pack's order and flags that
pack's required fields. Packs live in `card-profiles/<region>.json` and are data, not code.

```json
{
  "id": "ips",
  "name": "International Patient Summary",
  "basis": "ISO 27269 / HL7 FHIR IPS",
  "sections": [
    { "id": "allergies", "title": "Allergies and intolerances", "required": true },
    { "id": "medications", "title": "Medication summary", "required": true },
    { "id": "problems", "title": "Problem list", "required": true },
    { "id": "immunizations", "title": "Immunizations", "required": true },
    { "id": "procedures", "title": "History of procedures", "required": true },
    { "id": "results", "title": "Diagnostic results", "required": true },
    { "id": "vitals", "title": "Vital signs", "required": true },
    { "id": "devices", "title": "Medical devices", "required": true },
    { "id": "social", "title": "Social history", "required": false }
  ]
}
```

`eu` (EEHRxF patient summary) and `us` (US Core) start as copies of `ips` with their own required
list and their own preferred units — mg/dL against mmol/L, °F against °C, dates as `MM/DD/YYYY`
against `DD.MM.YYYY`. The card never reformats the document; a pack may add a display unit beside the
recorded one, and says which is which.

**No region, no guessing.** A document with no `meta.profile.region` renders the `ips` pack and the
card header says `region not recorded — IPS assumed`.

## Mapping: kg/1 node → card section

| node kind | goes to | carries |
|---|---|---|
| `condition` | problems | label, `code` (ICD-10 in the demo), `status` (active/resolved), `when.from` |
| `medication` | medications | label (dose inside it today), `when.from`, who started it |
| `observation` | results, and `vitals` when the marker is a vital | `value`+`unit`, `ref_low`/`ref_high`, `flag`, `when` |
| `procedure` | procedures | label, `when`, the encounter it happened in |
| `encounter` | procedures' context, not its own section | who, where, when |
| `document` | the evidence behind every row; never a section of its own | `publisher`, `address`, `link` |
| — | allergies, immunizations, devices, social | **nothing maps today**: the document has no node kind for them |

## What the demo document cannot fill

Read from `kg_demo.json` today (62 nodes): conditions 3 with ICD-10 codes, observations 27 with
ranges, encounters 10, medications 5, procedures 2, documents 15. **No allergies, no immunizations,
no devices, no social-history node** — smoking appears only inside the prose of the 2006 check-up
document. So a card built now shows four sections saying `not recorded`, and that is the correct
output: the missing information is the finding.

## Missing data is drawn, not hidden

- a required section with no rows prints its title and `not recorded` — never disappears;
- a row that lacks a field prints the field's name and `not recorded` (a medication with no dose, a
  condition with no code);
- the footer lists every gap in one line, and the exported text ends with the same list under
  `MISSING`;
- a value the reader typed nowhere: the page has no inputs (SCRUM-77), so nothing here can be
  "corrected" in the browser.

## Scenarios

| # | do | expect |
|---|---|---|
| 1 | open the card for the demo document | sections in IPS order, four of them saying `not recorded` |
| 2 | check the medication rows | each with dose and since-date, `not recorded` where the label carries no dose |
| 3 | remove `meta.profile.region` and reopen | the header says `region not recorded — IPS assumed` |
| 4 | set `region: "us"` | the same facts in the US pack's order, units beside the recorded ones |
| 5 | click a linked item inside the card | it becomes the current record everywhere else |
| 6 | download | plain text, links flattened, `MISSING` block last |
