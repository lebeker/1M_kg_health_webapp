# Explanations — why the number moved (T17)

The promise: **every change of an estimate has a Δ, a cause, and a source link.** This is the model
card for `src/explain.ts`, the code that produces those rows, and for `bun run explain`, the only
place they can be seen today.

Source of the task: `docs/PLAN-health-2026-11-12.md` rev 5, T17. The scales it explains are T15
(SCORE2, `docs/SCORE2.md`) and T16 (the Lee index, `docs/LEE.md`); the rules engine underneath is
T14 (`src/rules.ts`).

---

## What a row is

| Field | Rule set (`explainRules`) | Coefficient model (`explainScore2`) |
|---|---|---|
| `cause` | the rule's `id` — `cancer`, `age_70_74` | a term of Table 2 — `smoking`, `age_x_systolic_bp` |
| `delta` | what the rule added at one date and not the other, in the scale's unit | that term's share of the change, in percentage points |
| `source` | the rule's citation, as written | the paper, the table, the term, the log hazard ratio and its published interval |
| `link` | `sourceLink(source)` | `https://doi.org/10.1093/eurheartj/ehab309` |
| `evidence` | the facts the rule reads that differ between the two dates | the model inputs the term is built from that differ |
| `kind` / `reason` | `started`, or `stopped` and why (`no-match`, `missing-fact`, `type-mismatch`) | — |

A row is never a bare Δ. If a change cannot be named, it cannot be shown: `explainRules` refuses the
whole explanation when a rule that moved the number has a `source` that is not a link.

## A cause with no link is not a cause

`sourceLink` accepts exactly four shapes, case-insensitively:

```
https://…                      the URL itself
PMID:16478903 / 16478903       → https://pubmed.ncbi.nlm.nih.gov/16478903/
10.1001/jama.295.7.801         → https://doi.org/10.1001/jama.295.7.801
doi:10.1093/eurheartj/ehab309  → https://doi.org/10.1093/eurheartj/ehab309
```

Anything else — `Smith 2020`, `JAMA 2006;295(7):801`, `synthetic:demo-sex` — returns `null`, and an
explanation that needs it is refused with the rule id and the offending source. This is stricter
than T14, which refuses a rule with no `source` at all. The stricter rule is the honest one for a
*view*: "see Smith 2020" is not a place a reader can go, so printing it next to a number claims a
provenance the page cannot produce.

The existing rule files pass: every Lee row cites `PMID:16478903`, and SCORE2's terms cite the paper
by DOI. `tests/fixtures/rules/synthetic.json` deliberately does not, and is what the refusal test
uses.

## Rule sets: the rows add up, exactly

`explainRules` scores **both dates with the same rule set and the same base**, then reports the
rules whose contribution differs. Consequences, by construction rather than by care:

- two estimates from different rule files or different bases cannot be compared, because the caller
  never supplies estimates — it supplies facts, and this function computes both numbers;
- a rule that fires at both dates with the same weight is not a row: it is in `unchanged`, because it
  is part of the number but not of the move;
- the rows sum to `after.value - before.value`; the function throws if they do not, rather than
  print a table that does not reconcile with the number above it.

A fact that stops being supplied is not a fact that became false. The engine already refuses to
score a missing fact; the row says `kind: "stopped", reason: "missing-fact"`, so a lost point is
never read as a recovered person.

## SCORE2: the rows add up, and the split depends on the order

A coefficient model has no independent deltas: risk is
`1 - exp(-exp(a + b·ln(-ln(1 - S0^exp(lp)))))`, so a term's effect is a function of what the rest of
the linear predictor is. Printing it as a sum of fixed percentage points would be a different model
wearing SCORE2's name.

The one additive quantity on this scale is the linear predictor, `lp = Σ βᵢxᵢ`. So the rows are cut
from it:

1. each term's `logHrDelta` is exact and order-free — it is the term's change in `lp`;
2. each term's `delta` in percentage points is the change in risk from adding that `logHrDelta` in
   **Supplementary Methods Table 2's order**, one step after another;
3. the steps telescope, so the rows add to `change` exactly and the `logHrDelta`s add to
   `linearPredictorChange` exactly;
4. another order would split the same total differently. That is why `method` and the last line of
   `limits` say so, and why the total is printed next to the rows rather than left to be summed by
   a reader.

Both numbers are produced by the model's own `calibrate()` (`src/score2.ts`), exported for exactly
this purpose: a number and its explanation evaluate one function, so they cannot drift apart while
both look right.

A change of `sex` is refused — SCORE2 publishes two sex-specific models, so that is a change of
model, not a change in an estimate. The region is a single argument for both dates for the same
reason: it is where a person lives, not something they did.

## Usage

```
bun run explain lee   tests/fixtures/explain/lee-before.json tests/fixtures/explain/lee-after.json
bun run explain score2 tests/fixtures/explain/score2-before.json tests/fixtures/explain/score2-after.json --region=high
bun run explain rules <set.json> <before.json> <after.json> --unit=points
```

`--json` prints the object a view consumes. Exit 0 = an explanation was printed (a change or none),
1 = refused (the message names every problem), 2 = usage.

The two lee fixtures are one man at 68 and at 70: a new age band, a cancer recorded, smoking
stopped, difficulty bathing appeared. The index moves 8 → 11 and the band 6–9 → 10–13, in five rows
(−2 +3 +2 −2 +2). The score2 fixtures are the supplement's worked example ten years on: 8.809% →
7.091% in the high-risk region, −1.718 percentage points over nine terms, +8.146 of it age and −6.912
smoking.

The whole page is printed at one precision, and it is the model's own: `risk` is 3dp, so the two
estimates, the change and every row are 3dp. That is not cosmetic. The first check a reader runs is
to subtract the two estimates above the rows, and a page that prints them at 2dp while the change is
3dp answers 1.72 where the page says 1.718 — a 0.002pp disagreement on the one surface whose whole
purpose is to be checkable. `scripts/explain.test.ts` parses the three numbers off the page and
subtracts them, so the display cannot drift back.

## Where this meets the panel (2026-11-22)

The owner's audit found `what moves it` (widget 21) listing ALT, blood count, HbA1c and fasting
glucose at `+0.0`. That section is now drawn from the factors the projection is explained by (LDL,
blood pressure, age, statin, smoking, steps) plus every record that records an effect, with the
record's link beside it; a record with no effect size shows a dash and the section says why. See
`docs/MAIN-VIEW.md`.

What the panel still does not draw is **these** rows — the Lee and SCORE2 explanation rows above,
with their causes in the model's own vocabulary (`age_70_74`, `age_x_systolic_bp`) and their
citations. The reason is structural, not cosmetic: the page is plain JavaScript over a `kg/1-health`
document, the models that produce these rows are TypeScript over a **facts** record (`src/rules.ts`,
`src/explain.ts`), and nothing yet turns a document into facts for them. So on the demo — a document
with no `delta`, no `evidence` and no `prediction` — the factors are listed with what the record
says, and no number is invented for them. Drawing the model rows needs that document→facts bridge
and a decision on which scale the panel reports (years today; Lee is points, SCORE2 is a 10-year
percentage). Both are recorded as follow-up work, not guessed here.

## What this does not do

- **It renders nothing.** The drift view is T13 in the plan and is parked with T08 behind the
  owner's decision; rev 5 forbids any task depending on them. So the rows exist, are tested and
  can be printed. The panel draws the *factor* rows described above, not these model rows.
- **It does not choose the two dates.** An explanation compares two fact records; which dates those
  are, and where the facts come from, is the caller's modelling decision. That includes the
  documented gap in `docs/LEE.md`: matching an ICD-10 code or a free-text label to `diabetes`,
  `cancer`, `lung disease` or `heart failure` is a separate card (Charlson/Elixhauser), and a BMI
  needs two observations on the same day.
- **It does not explain a change of scale.** A rule set whose `version` changes is a different
  scale; the engine already refuses to mix two sets in one call, and this file adds nothing that
  could.
- **It is not a medical device.** It explains arithmetic over published weights and coefficients;
  it does not say what a change means for a person.

## Where the pieces are

| File | What it is |
|---|---|
| `src/explain.ts` | the two explanation shapes, `sourceLink`, the refusals |
| `src/explain.test.ts` | 31 tests: links, row-by-row Lee drift, both sums for SCORE2, the refusals |
| `scripts/explain.ts` | the command above |
| `scripts/explain.test.ts` | the command's page: rows printed, printed triple reconciles, refusals at the boundary, byte-identical second run |
| `tests/fixtures/explain/` | the two dates for each scale |
| `src/score2.ts` | `calibrate()` and `inputFromFacts()` — shared so a number and its explanation cannot diverge |
