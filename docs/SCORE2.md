# SCORE2 — the 10-year risk of cardiovascular disease

The first scale the plan asks for, and the number most likely to be acted on: the ESC's 2021 model
for the 10-year risk of fatal and non-fatal cardiovascular disease (myocardial infarction, stroke,
cardiovascular death) in people aged 40–69 without previous CVD. Code: `src/score2.ts`. Command:
`bun run score2`.

**Source.** SCORE2 working group and ESC Cardiovascular Risk Collaboration, *SCORE2 risk prediction
algorithms: new models to estimate 10-year risk of cardiovascular disease in Europe*, Eur Heart J
2021;42(25):2439–2454, doi:[10.1093/eurheartj/ehab309](https://doi.org/10.1093/eurheartj/ehab309).
Coefficients and baseline survival: Supplementary Methods Table 2. Recalibration scales:
Supplementary Methods Table 3. Hazard-ratio intervals: Supplementary Table 7. Worked examples:
Supplementary Methods Table 4.

## What it computes

Two sex-specific Cox models with an age interaction on every predictor. Age enters as
`cage = (age − 60) / 5`, systolic blood pressure as `(sbp − 120) / 20`, total cholesterol as
`tchol − 6`, HDL as `(hdl − 1.3) / 0.5`; cholesterol in mmol/L, pressure in mmHg.

```
linear predictor  lp = Σ βᵢ · xᵢ                       (Table 2, the eleven rows)
uncalibrated      p  = 1 − S0 ^ exp(lp)                (S0: 0.9605 men, 0.9776 women)
recalibrated      r  = 1 − exp(−exp(a + b · ln(−ln(1 − p))))   ((a, b): Table 3, by region and sex)
```

`r` is multiplied by 100 and printed as a percentage. The scale is `score2-10y/1`.

Diabetes is **not an input**. The published model carries a diabetes indicator because the
recalibration was fitted on whole populations, and the paper sets that indicator to zero for every
individual prediction; SCORE2 is not for people with diabetes (SCORE2-Diabetes is a separate
algorithm). The two rows are kept in `coefficients` so the table can be compared with the paper,
and they are multiplied by zero, so they cannot move a number.

## The region

The recalibration scale is chosen by the person's European risk region: `low`, `moderate`, `high` or
`very_high`, as the ESC defines them by country. The scale moves the whole risk curve, not a few
percentage points, so it is an argument with no default: `score2(input)` without a region refuses
to print.

The region is not in `kg.json`. Adding it is a change to the data contract (`docs/DATA-CONTRACT.md`,
`schema_version`), which is a lead-only card, so this card takes the region as a parameter and says
so. Until that field exists, whoever renders the panel asks the person once and passes the answer;
nothing in the template guesses a country from a timezone.

## The interval

Every number is printed with a 95% interval, and the interval is the model's, not a placeholder:

- the published 95% hazard-ratio intervals (Supplementary Table 7) give a standard error per
  coefficient: `se = (ln(hi) − ln(lo)) / (2 × 1.959964)`;
- the linear predictor's variance is `Σ (seᵢ · xᵢ)²`, i.e. the coefficients are treated as
  **independent**. The paper does not publish their covariance matrix, so this is an approximation
  and it is stated as one;
- the recalibration is a rescaling of the complementary log-log scale by `b`, so the interval is
  `1 − exp(−exp(a + b·z ∓ 1.959964·b·se_lp))`, which is monotone in `z` and therefore always
  brackets the point estimate.

What the interval does **not** cover: the uncertainty of the recalibration scales, the uncertainty
of the baseline survival, and the distance between a model and a person. Those are not published
with standard errors, so they cannot be propagated here without inventing them. The sentence
travels with every result in `limits`.

## What the model ignores

Carried in `limits` on every result, because a number without them is a claim the model cannot make:

- people with diabetes (see above);
- people with previous CVD, familial hypercholesterolaemia, chronic kidney disease, other rare
  lipid or blood-pressure disorders, and pregnant women — outside the published target population;
- ages outside 40–69: over 70 is SCORE2-OP (different coefficients, not this card), under 40 has no
  SCORE2 scale;
- time: the scales were fitted to contemporary European incidence. A 2015 record and a 2026 record
  are scored with the same coefficients; no trend is applied.

## The three known profiles the tests hold it to

| Profile | Source | Published | This code |
|---|---|---|---|
| man 50, smoker, SBP 140, TC 6.3, HDL 1.4 | supplement Table 4 | uncalibrated 5.41%; low 6.31, moderate 8.11, high 8.81, very high 15.06% | 5.41; 6.314, 8.107, 8.809, 15.058 |
| woman, same risk factors | supplement Table 4 | uncalibrated 3.32%; low 4.34, moderate 5.23, high 7.13, very high 14.14% | 3.316; 4.332, 5.227, 7.126, 14.127 |
| man 65, non-smoker, SBP 160, TC 5.5, HDL 1.2 | ESC calculator, high-risk region, read 2026-11-22 | 14% (whole percent) | 14.21% |

The third profile is deliberately a different age and risk-factor shape: the two Table 4 examples
share one set of risk factors, so on their own they could hide an error that only appears at a
different age. The ESC calculator prints whole percent, so that assertion allows half a point; the
exact value is pinned separately so a refactor cannot drift.

## Running it

```sh
bun run score2 tests/fixtures/score2/profile-a-male-50-smoker.json --region=high
bun run score2 <facts.json> --region=<low|moderate|high|very_high> --json
```

The facts file is flat JSON, named as the document names facts:

```json
{ "age": 65, "sex": "male", "current_smoker": false,
  "systolic_bp": 160, "total_cholesterol": 5.5, "hdl_cholesterol": 1.2 }
```

Exit 0 = a risk was printed, 1 = the input was refused (the message names the field), 2 = no facts
file or no region. The text output prints the region, the uncalibrated risk, the linear predictor
with its standard error, every row of the arithmetic with its published hazard ratio, and the
limits — so a reviewer can add up the same lines by hand.

## Why this is not a rule file

The rules engine (T14, `src/rules.ts`) adds independent deltas to a base number on one scale. SCORE2
is multiplicative: its predictors enter as `exp(Σβx)` and every one of them interacts with age, so
no set of additive deltas reproduces it. Writing one would be a model that looks like SCORE2 and is
not. The engine's `version` names the scale for exactly this reason; a later rule set that adjusts
this number (a treatment effect, a prediction that has been met) carries `score2-10y/1` and adds
percentage points to `risk`, in that unit, with its own citation.

`src/score2.ts` is a coefficient model with published citations and no free parameters; T16 (Lee
index) is additive and will be a rule set on the same engine. The explanation view (T17) therefore
has to handle two shapes: `Estimate` (base + deltas) and `Score2Risk` (a coefficient model). This
document, not the code, is where that split is decided.
