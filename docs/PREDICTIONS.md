# Predictions — a forecast is a simulation, not a fact

A prediction is a node in the record: visible, dated, drawable. It is also the only node kind that
carries a number the record has not earned yet. That is the whole reason it gets its own file.

The card (T18, SCRUM-29) is one sentence: *target, horizon, condition, delta_median, source,
confidence; does not affect the estimate until its condition is met.* This is the long form of it.

## The shape

```json
{
  "id": "pred-ldl-2028",
  "kind": "prediction",
  "label": "LDL below 3.0 by 2028 on a statin",
  "target": "obs-ldl-2026-11",
  "horizon": "2028-01-01",
  "condition": { "fact": "on_statin", "op": "eq", "value": true },
  "delta_median": -1.1,
  "confidence": 0.6,
  "source": "src-discharge-2021",
  "confirmed": false
}
```

| field | what it says | why it is required |
|---|---|---|
| `target` | the id of the condition or observation the forecast is about | a forecast about nothing cannot be checked against anything |
| `horizon` | the date the forecast is about | it is the only date the node has — see "not an event" below |
| `condition` | the predicate that has to be met before the delta may count | without it the number moves the day the document is written |
| `delta_median` | the change it would make, in the unit of the scale it adjusts | a forecast with no size is a mood |
| `source` | the id of a `document` node in this document — the paper, note or letter the forecast came from | a number nobody can trace is a rumour with a date on it |
| `confidence` | 0..1 | the reader has to know how much to trust the delta |

`src/prediction.ts` (`PREDICTION_FIELDS`) and the schema's `$defs.node[prediction].required` are the
same list, and `scripts/kg-contract.test.ts` holds them together so one cannot drift from the other.

Blank is not a value. `target`, `source` and a condition's `fact` are required to name something, and
the gate refuses `""` and `"  "` alike, because `loadPredictions` and `conditionProblems` trim before
they answer: a forecast whose target is spaces would pass a gate that only counted characters and
then be refused by the loader. `source` says so twice — once as the rule
(`$defs.nonEmptyText`) and once from the check that would otherwise have resolved the id, so a blank
source and a source that points at no node do not read alike. The full set, and why each string is in
it or out of it, is DATA-CONTRACT §Node fields.

## It is not an event

Six kinds are events and carry `when`: condition, observation, encounter, medication, procedure,
document. A summary is a virtual marker; a prediction is a simulation. Neither is an event, and a
prediction therefore carries **no** `when` — its date is the `horizon`, and the day it was made is the
date printed on its source document.

The contract refuses a prediction that carries `when` anyway. Two dates on one node is how the
timeline ends up with two kinds of time, and this contract exists to prevent exactly that.

The contract also refuses two shapes a forecast can wear by mistake:

- a `target` that is not a condition or an observation in the same document (a forecast about a
  document or a drug names a thing that cannot carry the outcome it claims);
- a `horizon` before the date printed on its own document. A forecast is about a later date; one that
  looks back is a record in a forecast's clothes.

## The condition

A condition is a predicate over the **facts**, in the same vocabulary a rule's `when` uses — the
schema's `$defs.predicate`, evaluated by `src/rules.ts`:

```json
{ "fact": "on_statin", "op": "eq", "value": true }

{ "all": [ { "fact": "on_statin", "op": "eq", "value": true },
           { "any": [ { "fact": "ldl_cholesterol", "op": "lt", "value": 3 },
                      { "not": { "fact": "current_smoker", "op": "eq", "value": true } } ] } ] }
```

`op` is one of `eq ne lt le gt ge in exists`; `all`, `any` and `not` compose comparisons. `value`
follows the operator: one value for the six comparisons, a non-empty list for `in`, and nothing at all
for `exists`, which asks only whether the fact is known. The schema and `conditionProblems` decide
that shape the same way, so a condition that passes `bun run test:contract` is one the loader reads —
`scripts/kg-contract.test.ts` pins both readers against one table of shapes. A condition
is about facts — `age`, `on_statin`, `ldl_cholesterol` — never about dates. Dates live on nodes, and a
condition with a date in it would be the second kind of time this contract warns about.

One vocabulary for both, on purpose: "a forecast is live" and "a rule fires" must not be two
different questions answered by two different pieces of code.

## The gate

`src/prediction.ts` is the only thing that turns a prediction into a number.

```ts
const predictions = loadPredictions(doc.nodes)   // refuses a malformed forecast, all of them or none
const gate = applyPredictions({ version: 'score2-10y/1', predictions, facts })
gate.delta    // the sum of the deltas whose condition is met — zero when none is
gate.applied  // rows that may move the estimate, each with its verdict `met`
gate.withheld // rows that may not, each with why
```

Three verdicts, and only one of them is arithmetic:

| verdict | when | the estimate |
|---|---|---|
| `met` | every comparison is true | takes the delta |
| `unmet` | a comparison is false | stays where it was; the row is withheld, `reason: "no-match"` |
| `unknown` | a fact is missing, or is of the wrong type | stays where it was; withheld as `missing-fact` / `type-mismatch` |

`unknown` is the one that matters. "We do not know whether he is on a statin" is not "he is on a
statin" — and it is not "he is not", either. The forecast stays visibly pending instead of firing on
a guess or being quietly dropped, and `not` over an unknown comparison is still unknown: the negation
of "we do not know" is not "yes".

A withheld row is not an error. It is the sentence the product is built on: *this is what we
forecast, this is what it would do, and this is why it has not happened yet.*

### One call, one scale

`delta_median` is a number in the unit of the scale it adjusts, and the document does not carry that
scale. So the caller supplies the `version` — `score2-10y/1` for risk points, `lee-4y-points/1` for
index points — exactly as `applyRules` takes a rule set rather than a bare array. Two scales' deltas
must never be added by accident, and the only way to make that hard is to make the unit part of the
call.

## What this file does not do

- **It does not read the document.** `scripts/lib/kg-contract.ts` validates shape; `loadPredictions`
  reads `kind: "prediction"` nodes out of a document's `nodes` array and refuses the malformed ones.
  Everything about cross-references is the contract's job, not the gate's.
- **It does not decide what the facts are.** The caller supplies them. Matching a label or an ICD-10
  code to `on_statin` is a mapping with its own error rate, and it is recorded work, not a guess.
- **It does not read the clock.** A horizon is compared with facts the caller chose, never with
  "now", so re-running last month's estimates reproduces last month's numbers.
- **It does not print a probability.** `delta_median` is a median change, not a chance that something
  happens; `confidence` is trust in the delta, not a p-value. The interval belongs to the paper the
  `source` names, and arrives with the strategies that cite one (T19).
- **It does not order the timeline.** Rows come back in `id` order so a reordered JSON file cannot
  move a floating-point sum. Which forecast is shown first is a rendering decision, not this one.

## How it is checked

- `bun test src/prediction.test.ts` — 25 cases: each of the six fields missing, a prose condition, a
  duplicate id, a malformed set refused as a whole, and the gate's three verdicts, including the
  negation over an unknown fact and the "any file order, same number" check.
- `bun run test:contract` — five invalid fixtures (`prediction-without-condition`, `prediction-with-when`,
  `prediction-target-not-in-document`, `prediction-horizon-before-its-document`,
  `prediction-condition-as-prose`) that must be rejected, the two valid documents that now carry a
  full forecast (`health-man-65.json`, `health-prediction.json`), and one table of condition shapes
  that the schema and `conditionProblems` both have to accept, and one they both have to refuse —
  so the gate's condition language cannot drift away from the loader's.
- `bun run verify` — everything above plus lint, types, the branch-name self-test and the build.

## What comes next

- **T19, five built-in strategies** (SCRUM-30): statin/LDL, smoking, colonoscopy, HbA1c, blood
  pressure — each with a PMID and an interval. The PMID and the interval do not go in the
  prediction: `source` is the id of a `document` node, so a strategy writes (or reuses) the `document`
  node that carries the citation and its date, and points `source` at it; `delta_median` carries only
  the median change, because the published interval belongs to the document the strategy cites, not
  to this field.
- **T22, the `add-prediction` skill** (SCRUM-33): PubMed → HR + CI → cohort check → node, refusing
  without a PMID — recorded on the `document` node it writes next to the prediction, which is the
  only place in this contract a PMID can live — and the forecast stays `not confirmed` until a human
  reads it.
- **The history.** When a condition is met, the estimate moves and the history has to say which
  prediction moved it (the plan's P1 snapshot work, T08/T13, still parked). The gate already returns
  the `applied` rows that make that sentence writable.
