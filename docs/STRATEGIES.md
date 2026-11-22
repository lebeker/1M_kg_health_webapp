# Strategies — five forecasts, each with a PMID and an interval

The plan's line for T19 is one sentence: *Statin/LDL, smoking, colonoscopy, HbA1c, blood pressure;
each with a PMID and an interval* — "the demo must show the mechanics". This is the long form of what
ships: five strategies in `src/strategies.ts`, a command (`bun run strategies`), and a demo document
(`tests/fixtures/kg/valid/health-strategies.json`) in which all five are placed on one record and
accepted by the contract gate.

A **strategy** is a template for one forecast, and each of its parts answers a question somebody will
ask:

| part | what it says | why it is required |
|---|---|---|
| `when` | the condition over the facts that has to be met (`on_statin`, `screening_colonoscopy`) | without it the number moves the day it is written (T18) |
| `effect` | the published outcome, measure, ratio, interval, and what the ratio is **per** | a relative risk means nothing without the change it is per |
| `source` | the paper: PMID, citation, PubMed link, the date printed on it | a number nobody can trace is a rumour with a date on it |
| `scale` | the outcome's log relative risk, e.g. `mve-log-rr/1` | a delta's unit; two outcomes must never share a sum |
| `limits` | what the effect does not cover | it travels with the number, every time |
| `confidence` | 0..1 | this module's trust that the delta is a forecast for a person |

## The five

Every number below is copied from the paper's abstract, read back from PubMed on 2026-11-22, and
pinned in `src/strategies.test.ts` so a transcription error is a failing test and not a demo.

| id | what somebody does | outcome | published | PMID |
|---|---|---|---|---|
| `statin-ldl` | a statin, LDL cholesterol down 1.0 mmol/L | major vascular events | rate ratio 0.78 (95% CI 0.76–0.80) per 1.0 mmol/L | [21067804](https://pubmed.ncbi.nlm.nih.gov/21067804/) |
| `quit-smoking` | stop smoking (having smoked ≥20 pack-years), within 5 years | incident cardiovascular disease | hazard ratio 0.61 (0.49–0.76) vs continuing | [31429895](https://pubmed.ncbi.nlm.nih.gov/31429895/) |
| `colonoscopy-screening` | invitation to one screening colonoscopy | colorectal cancer incidence at 10 years | risk ratio 0.82 (0.70–0.93) | [36214590](https://pubmed.ncbi.nlm.nih.gov/36214590/) |
| `intensive-hba1c` | an intensive glycaemic target | composite microvascular complications | risk ratio 0.88 (0.79–0.97) | [22115901](https://pubmed.ncbi.nlm.nih.gov/22115901/) |
| `bp-lowering` | antihypertensive treatment, systolic pressure down 10 mmHg | major cardiovascular disease events | relative risk 0.80 (0.77–0.83) per 10 mmHg | [26724178](https://pubmed.ncbi.nlm.nih.gov/26724178/) |

The citations, in the order the fixture writes them:

- Cholesterol Treatment Trialists' (CTT) Collaboration. *Efficacy and safety of more intensive
  lowering of LDL cholesterol: a meta-analysis of data from 170,000 participants in 26 randomised
  trials.* Lancet 2010;376(9753):1670–81.
- Duncan MS, Freiberg MS, Greevy RA Jr, Kundu S, Vasan RS, Tindle HA. *Association of smoking
  cessation with subsequent risk of cardiovascular disease.* JAMA 2019;322(7):642–50.
- Bretthauer M, Løberg M, Wieszczy P, et al.; NordICC Study Group. *Effect of colonoscopy screening
  on risks of colorectal cancer and related death.* N Engl J Med 2022;387(17):1547–56.
- Hemmingsen B, Lund SS, Gluud C, Vaag A, Almdal T, Hemmingsen C, Wetterslev J. *Intensive glycaemic
  control for patients with type 2 diabetes: systematic review with meta-analysis and trial
  sequential analysis of randomised clinical trials.* BMJ 2011;343:d6898.
- Ettehad D, Emdin CA, Kiran A, Anderson SG, Callender T, Emberson J, Chalmers J, Rodgers A, Rahimi K.
  *Blood pressure lowering for prevention of cardiovascular disease and death: a systematic review
  and meta-analysis.* Lancet 2016;387(10022):957–67.

## Why the delta is a logarithm

The paper prints 0.78. The forecast's `delta_median` is `ln 0.78 = −0.2485`, and that is not a
rounding of the paper — it is the only form in which the gate's arithmetic is right.

The gate (T18, `applyPredictions`) **sums** the deltas whose condition is met. On the ratio scale,
summing is wrong: two ratios of 0.78 and 0.80 together are `0.78 × 0.80 = 0.624`, not `0.58`. The
additive quantity is the log:

```
ln 0.78 + ln 0.80 = −0.2485 + −0.2231 = −0.4716       exp(−0.4716) = 0.624
```

So each strategy carries the published ratio and interval, and the prediction carries the log of the
ratio. `exp(gate.delta)` puts the product back on the scale the paper printed. It is the same move
`docs/EXPLANATIONS.md` makes on SCORE2's linear predictor: the rows are cut from the one quantity on
the scale that adds up.

## One scale per outcome

`mve-log-rr/1` is shared by `statin-ldl` and `bp-lowering` — both are about major vascular events, so
their deltas may be added. The other three are about different outcomes and get their own scale
(`cvd-log-rr/1`, `crc-log-rr/1`, `microvascular-log-rr/1`), so a colonoscopy's effect on colorectal
cancer can never be summed into a statin's effect on heart attacks. `gateStrategies` makes the call
once per scale, which is T18's rule ("one call, one scale") applied where the temptation to break it
lives.

## The interval

The interval on each strategy is the **published interval from the paper**, printed with the ratio
it belongs to and stored on the `document` node the strategy writes:

```json
{
  "id": "src-ctt-2010",
  "kind": "document",
  "when": "2010-11-13",
  "link": "https://pubmed.ncbi.nlm.nih.gov/21067804/",
  "pmid": "21067804",
  "citation": "…Lancet 2010;376(9753):1670–81.",
  "effect": {
    "outcome": "major vascular events",
    "measure": "rate ratio",
    "ratio": 0.78,
    "interval": { "level": 0.95, "low": 0.76, "high": 0.8 },
    "per": "1.0 mmol/L lower LDL cholesterol"
  }
}
```

That placement is deliberate and is the handoff `docs/PREDICTIONS.md` wrote for this card: the
prediction's six fields include `source`, which is the id of a `document` node, and nowhere else in
this contract can a PMID live. `delta_median` carries only the median change.

Three things the interval is **not**:

- not an interval for a person. It is the uncertainty of a published average effect; the distance
  between a trial population and one patient is not in it, and neither is the uncertainty of the
  assumption that the person achieves the `per` (a 1.0 mmol/L LDL drop, a 10 mmHg pressure drop).
- not combined. Two met strategies on one scale produce one combined ratio (`exp` of the sum) and
  **no** combined interval: multiplying two published intervals would assume an independence nobody
  measured, so the command prints the combined ratio and each paper's own interval, and stops there.
- not a screening cadence. The colonoscopy strategy's interval belongs to the trial's *effect*
  (measured at 10 years); the surveillance interval for a person with adenomas is a guideline
  question this card does not answer.

## What none of the five claims

Carried in `limits` on every strategy and printed with every number, because a strategy without them
is a claim it cannot make:

- **No absolute risk.** `exp(delta)` is a relative change. "Your ten-year risk falls from 8% to 6.2%"
  needs a baseline, and the baseline is SCORE2's (`score2-10y/1`), not this file's.
- **No horizon.** A forecast's date is the caller's (`--plan` file); the papers' follow-up windows
  differ and this module does not turn any of them into a claim about a person. The demo's horizons
  are demo data.
- **No population beyond the paper's.** Each strategy says who was studied: raised-risk trial
  participants (statin), heavy ever smokers (≥20 pack-years) in Framingham, Massachusetts, with
  self-reported smoking (smoking), 55–64-year-olds in three European countries invited once
  (colonoscopy), adults with type 2 diabetes (HbA1c), 123 trials pooled by meta-regression (blood
  pressure).
- **The weakest evidence is labelled as such.** `quit-smoking` is an association in a cohort, not a
  randomised effect, and its confidence is 0.7. `intensive-hba1c` is the least certain of the five: no
  mortality benefit (risk ratio 1.02, 0.91–1.13), a trial sequential analysis that did not reach a
  firm answer, and a real cost — severe hypoglycaemia (risk ratio 2.39, 1.71–3.34). Its confidence is
  0.6.
- **No `confidence` from the paper.** The five confidences are this module's judgement, set by hand,
  and they are not derived from the papers. They are shown so a reader can argue with them.

## The demo document

`tests/fixtures/kg/valid/health-strategies.json` is the mechanics shown end to end: one invented
record — a 1961-born man with an LDL of 4.9 mmol/L, an HbA1c of 7.4%, a systolic pressure of 152, a
tobacco-use condition and a removed adenoma — plus the five papers and the five forecasts, each
drawn onto the node it is about by a `projected` edge. It is a *valid* fixture, so `bun run
test:contract` refuses the build if the strategies ever write a document the contract would not
accept, and `scripts/strategies.test.ts` holds its five predictions equal to `materialise()`'s output
node for node, so the fixture cannot drift from the code.

```sh
bun run strategies                                                   # the five: PMID, interval, limits
bun run strategies --plan=tests/fixtures/strategies/placements-demo.json --json   # the nodes
bun run strategies --plan=… --facts=tests/fixtures/strategies/facts-all-met.json  # the gate
```

With all five conditions met the gate prints four groups:

```
  mve-log-rr/1  2 met, 0 withheld  ·  combined 0.6240
  crc-log-rr/1  1 met, 0 withheld  ·  combined 0.8200
  cvd-log-rr/1  1 met, 0 withheld  ·  combined 0.6100
  microvascular-log-rr/1  1 met, 0 withheld  ·  combined 0.8800
```

With only `on_statin` known, one forecast moves and the other four are withheld as `missing-fact` —
nothing fires on a guess, and every row says why. A fact of the wrong type (`on_statin: "yes"`) is
`type-mismatch`, which is neither met nor unmet.

## What this does not do yet

- **Nothing draws these.** There is no panel for a prediction and no drift view: `src/App.tsx` does
  not read `kind: "prediction"`, and the right panel's candidates are marked *not approved* in
  `docs/WIDGETS.md`. The nodes exist, the gate exists, and the command prints exactly what a view
  would draw; the screen is a separate card.
- **The facts are still the caller's.** Mapping a prescription to `on_statin` or a note to
  `current_smoker` is recorded work with its own error rate — the same gap `docs/LEE.md` names for
  the ICD-10 history.
- **T22** (`add-prediction`) is **shipped** — `skills/add-prediction/SKILL.md`,
  `docs/ADD-PREDICTION.md`: the write path for a strategy a user adds (PubMed → HR + CI → cohort check
  → node, refusing without a PMID, both nodes left `not confirmed`). The five here are the built-in
  half of that story; the skill writes its own document and prediction through the same six fields.

## How it is checked

- `bun test src/strategies.test.ts` — the five, their PMIDs and intervals, the pinned published
  numbers, every refusal (no PMID, a ratio outside its own interval, a blank citation, a scale that
  is not a log ratio, no limits, a duplicate id, an unplaced strategy, a horizon before the paper was
  printed), and the gate's three verdicts across four scales.
- `bun test scripts/strategies.test.ts` — the CLI's output equal to the module's, the demo fixture
  equal to the module's nodes and accepted by the contract, the refusals at the boundary (exit 1, the
  strategy named) and the usage errors (exit 2).
- `bun run test:contract` — the demo document among the valid fixtures.
- `bun run verify` — everything above plus lint, types, the branch-name self-test and the build.
