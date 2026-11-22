# SCRUM-28 — what moves it names the factors, from a record a fresh agent built

PRODUCT CLAIM, NOT A SMOKE TEST. T17's `what moves it` (widget 21) was drawn from every observation
track and printed eight lab panels at `+0.0`; the owner's audit (2026-11-22) asked for the factors
that move the forecast instead. This fixture asks the product, through the page a fresh agent
renders from one sentence, whether the panel now names those factors and carries the record behind
each — and whether it says, in as many words, that no record here carries an effect size (the
sentence the fix adds; the pre-fix page never printed it).

The document is synthetic, labelled as such in the prompt and in the record. Nothing here is a
patient.

A hit is a case-insensitive substring of the whole page, so `LDL` or `blood pressure` can also come
from the analysis in the centre column: the row-level evidence is the screenshot the run attaches,
not the hit list. The hit that cannot pass by accident is the note, which exists only after this
change.

## Acceptance
The panel's `what moves it` names the factors the record carries — LDL, blood pressure, statin —
and the section states that no record in this document carries an effect size, instead of printing
a column of `+0.0`.

## e2e
page: case
prompt: Build me a health record I can look at — an invented patient labelled synthetic: born 1961, male; one visit on 2024-03-05 with a lipid panel whose LDL cholesterol is 4.1 mmol/L against a reference of 0 to 3.0, flagged high, and a blood pressure of 158/96 that day; and atorvastatin 20 mg started 2023-01-10.
expect: no record here carries an effect size, LDL, blood pressure, statin
