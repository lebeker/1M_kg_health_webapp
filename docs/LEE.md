# Lee index — four-year mortality, in points

The second scale the plan asks for, and the first one that is a rule set: the paper weighted
independent predictors and a person's index is their sum. Code: `src/lee.ts`. Command: `bun run lee`.

**Source.** Lee SJ, Lindquist K, Segal MR, Covinsky KE, *Development and validation of a prognostic
index for 4-year mortality in older adults*, JAMA 2006;295(7):801–808,
doi:[10.1001/jama.295.7.801](https://doi.org/10.1001/jama.295.7.801), PMID:16478903.

The paper carries an erratum (JAMA. 2006 Apr 26;295(16):1900). Its text was not reachable in the run
that wrote this file, so the weights below are the ones the paper prints as PubMed holds them, and
`LEE_ROWS` is the single place a weight appears: if the erratum moved a weight, the fix is one line
there and one fixture in `src/lee.test.ts`.

## What it computes

Twelve predictors, weighted, added:

| Item | Points | Fact |
|---|---|---|
| age 60–64 / 65–69 / 70–74 / 75–79 / 80–84 / 85+ | 1 / 2 / 3 / 4 / 5 / 7 | `age` |
| male sex | 2 | `sex` |
| diabetes | 1 | `diabetes` |
| cancer | 2 | `cancer` |
| lung disease | 2 | `lung_disease` |
| heart failure | 2 | `heart_failure` |
| current tobacco use | 2 | `current_smoker` |
| body mass index under 25 | 1 | `bmi` |
| difficulty bathing | 2 | `difficulty_bathing` |
| difficulty walking several blocks | 2 | `difficulty_walking_several_blocks` |
| difficulty managing money | 2 | `difficulty_managing_money` |
| difficulty pushing large objects | 1 | `difficulty_pushing_large_objects` |

The index is 0–26. Seventeen rows, twelve items: age is six rows, every other item is one.

The paper also prints what the points mean, and those four rows are copied into `BANDS` unchanged:
0–5 points → less than 4% four-year mortality in the validation cohort, 6–9 → 15%, 10–13 → 42%,
14 or more → 64%. **A band is a group's observed risk, not this person's probability.** That is why
the band is a string ("64%") attached to a range of points and not a `risk` number: a number would
be multiplied, printed in a chart, and read as a prognosis. In the paper's own words the index
discriminates with c = 0.84 in development and 0.82 in validation, which is another way of saying
that individuals are misclassified.

The cohort: 11,701 community-dwelling US adults over 50 from the 1998 wave of the Health and
Retirement Study, developed against death by 31 December 2002, validated in 8,009 of them.

## The two lists the card asks for

`lee(facts)` returns both, in the paper's order, and neither is optional:

- **`deficits`** — the deficit list. Every row that scored, with its points and its citation. This is
  what "how many deficits" means: the list *is* the index, and the index is its sum. A test holds
  `points === Σ deficit.points` for every fixture.
- **`absent`** — every row that was supplied and did not score, with the engine's reason. A zero is
  a fact too: "no heart failure" is a different row from "nobody asked about heart failure".
- **`ignored`** — every fact supplied that this index does not read. One facts record can serve
  several scales (`age`, `sex` and `current_smoker` are shared with SCORE2), so an unread key is
  named rather than dropped, and a refusal lists it too: a misspelt `diabetis` shows up twice —
  once as the missing `diabetes`, once as a fact nobody read.
- **`limits`** — the model-level "what the model ignores", below. It travels with the number.

## Why this one is a rule set and SCORE2 is not

SCORE2's predictors enter as `exp(Σβx)` with an age interaction on every row: no sum of independent
deltas reproduces it, so it ships as a coefficient table (`docs/SCORE2.md`). The Lee index is the
opposite case: the paper weighted independent predictors and the index is their sum, which is
exactly what the T14 engine does (`src/rules.ts`).

So the twelve weights are `LEE_ROWS`, and `LEE_RULES` is the same table loaded through
`loadRules` **when the module loads**: a typo in a condition, a duplicated id or a weight that is
not a finite number breaks the build instead of shipping a number nobody checked. `applyRules`
takes the set, never the rows, so the estimate names its scale:

```
version   lee-4y-points/1      (points, not a percentage)
base      0
value     base + Σ delta      = the index
```

`confidence` is 1 on every row, and that is a statement about the delta, not about the model: the
weight is copied from the paper, so there is nothing estimated here to be unsure of. A per-item
number below 1 would be a figure this file invented. The uncertainty that matters — a group's
mortality against one person's future — is in `limits`, with the c-statistic.

## The refusals

The index is a count over *known* items, so a missing fact is not a zero. The engine would correctly
skip a rule whose fact is absent, and a skipped rule scores 0, which means "this deficit is not
there" — a different person. Therefore:

| Input | What happens |
|---|---|
| any of the twelve missing | refused, naming the field, so one run lists all of them |
| `"diabetes": "yes"` | refused: the engine would call it a type mismatch and score it as absent |
| age under 60 | refused: the paper's cohort is over 50, but its printed bands start at 60–64 |
| age 60.5, or 121 | refused: a typo is not a patient (the top band is 85 and over) |
| BMI missing, zero or negative | refused |
| a fact another scale needs (`systolic_bp`) | read by neither scale here: listed in `ignored` |

## What the model ignores — the explicit list

`LIMITS` in `src/lee.ts`, printed by the CLI with every index:

1. the bands are a group's observed four-year mortality, not a probability for one person; c = 0.82
   out of sample, so individuals are misclassified;
2. the cohort is community-dwelling US adults over 50 (HRS 1998, deaths to 2002-12-31); it is not
   validated for nursing-home residents or inpatients, and the mortality is United States mortality;
3. each condition counts once at one weight — severity, duration, control and treatment are not
   scored, so a cancer in remission and an active cancer add the same 2 points;
4. the functional items are self-reported difficulty, not measured performance: no gait speed, grip
   strength or test battery;
5. conditions outside the twelve carry no weight — hypertension and chronic kidney disease among
   them — and neither do social or psychological measures (living alone, income, depression);
6. age is scored only in the printed bands, so under 60 the index refuses rather than add 0;
7. the index does not read the document: no ICD-10 mapping, no free-text label match, no
   height/weight join;
8. missing is not "no": all twelve are required;
9. no cause of death, no time to death inside the four years, and no answer to "what if this is
   treated".

Item 7 is the one that needs a follow-up card, not a workaround: matching a condition's ICD-10
code or free-text label to "diabetes", "cancer", "lung disease" or "heart failure" is a mapping with
its own error rate, and computing a BMI from two observations that may be years apart is the same
kind of decision. Both are recorded in the plan's estimate backlog (Charlson/Elixhauser from the
ICD-10 history). Until then, whoever renders the panel supplies the twelve facts and says where
they came from.

## Usage

```
bun run lee tests/fixtures/lee/profile-b-man-80-heavy.json [--json]
```

The facts file is flat JSON, named the way the document names facts:

```json
{ "age": 80, "sex": "male", "bmi": 23.5, "diabetes": true, "cancer": true,
  "lung_disease": false, "heart_failure": false, "current_smoker": true,
  "difficulty_bathing": true, "difficulty_walking_several_blocks": true,
  "difficulty_managing_money": false, "difficulty_pushing_large_objects": false }
```

Exit 0 = an index was printed, 1 = the facts were refused (the message names every missing or
malformed item), 2 = no facts file. The text output prints the index against the ceiling, the band
as the paper prints it, every row that scored with its weight and citation, every row supplied and
absent, every fact given and not read, and the nine limits — so a reviewer can add the same lines by
hand from the table above.

A `note` key in a fixture is prose for a human and is dropped by the CLI before the index sees it;
nothing else is dropped.

## For T17

The explanation (`src/explain.ts`, `docs/EXPLANATIONS.md`) scores both dates with `LEE_RULES` and
reports every rule whose contribution changed, with the points it added or gave back, the citation
and a link to PubMed:

```
bun run explain lee tests/fixtures/explain/lee-before.json tests/fixtures/explain/lee-after.json
```

The index must never be printed as a percentage — its version says points, and its band is a string
on purpose — and a delta must never be added to a number whose scale it does not name. The same
command with `score2` prints the other shape, which is not a sum of points and is not explained as
one.
