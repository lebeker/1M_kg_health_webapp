# Add a prediction — PubMed → HR + CI → cohort check → node

The plan's line for T22 is one sentence: *Users add strategies themselves — PubMed → HR + CI → cohort
check → node; refuses without PMID; result stays `not confirmed` until reviewed.* This is the long
form of what ships: `skills/add-prediction/SKILL.md`, the script it carries
(`scripts/add_prediction.py`, python3 and nothing else), and the fixture pair that holds its output
against the contract.

The five built-in strategies (`docs/STRATEGIES.md`) are code: a card was reviewed, the numbers were
read back from PubMed, and the merge is the review. This skill is the other path — somebody brings a
paper and asks for it on their map — and the review is not a PR. So the four steps are the card, and
each one can stop.

| step | what it does | when it refuses |
|---|---|---|
| **PubMed** | fetches the `esummary` record for the PMID and compares the title and the year with the plan's | no PMID, a PMID that is not bare digits, a link that is not that PMID's page, a title or year that is not the record's, a PMID with no record |
| **HR + CI** | takes one ratio measure with its published interval and what it is `per` | an odds ratio; a measure that is not a ratio; a point estimate outside its own interval; a blank outcome, `per` or quote |
| **cohort check** | the person against the population that was studied | an age outside the paper's range, the wrong sex, an enrolment fact that is false — or unknown |
| **node** | writes the paper's `document`, the `prediction` and the `projected` edge | an id already in the document, a target that is not a condition or an observation, a horizon before the paper |

Exit 0 is a checked run; `--write` is the write. Exit 1 is a refusal with every problem named; exit 2
is a usage error or a PubMed that could not be reached — never a verdict.

## What is written

The shape is T19's, for a user's paper. `src/prediction.ts` already names the six fields a forecast
cannot do without, and `src/strategies.ts` already writes them for the built-ins; the skill writes the
same three objects, with no new field and no new kind:

```json
{
  "id": "src-pmid-36214590",
  "kind": "document",
  "label": "Bretthauer M, Løberg M, Wieszczy P, et al — colorectal cancer incidence",
  "when": "2022-10-27",
  "confirmed": false,
  "link": "https://pubmed.ncbi.nlm.nih.gov/36214590/",
  "pmid": "36214590",
  "citation": "Bretthauer M, Løberg M, Wieszczy P, et al.; NordICC Study Group. … N Engl J Med 2022;387(17):1547–56.",
  "effect": {
    "outcome": "colorectal cancer incidence",
    "measure": "risk ratio",
    "ratio": 0.82,
    "interval": { "level": 0.95, "low": 0.7, "high": 0.93 },
    "per": "invitation to one screening colonoscopy, at 10 years"
  }
}
```

```json
{
  "id": "pred-colonoscopy-36214590",
  "kind": "prediction",
  "label": "Have a screening colonoscopy: colorectal cancer is less likely within 10 years",
  "target": "cond-adenoma-2026-03",
  "horizon": "2036-03-04",
  "condition": { "fact": "screening_colonoscopy", "op": "eq", "value": true },
  "delta_median": -0.19845093872383832,
  "confidence": 0.8,
  "confirmed": false,
  "source": "src-pmid-36214590"
}
```

plus `{ "from": "pred-colonoscopy-36214590", "to": "cond-adenoma-2026-03", "label": "projected",
"confidence": 0.8, "source": "src-pmid-36214590" }`.

**Both nodes are `confirmed: false`, and the script has no path to any other value.** T19's shipped
documents carry `confirmed: true`, because the numbers were pinned in a reviewed PR and the reviewer
read them. Here nobody has read anything: the paper is real (the link opens it, the PMID resolves),
the numbers are the agent's transcription, and `confirmed` is a claim about a person reading, not
about a script succeeding. The report prints the abstract sentence the numbers came from so the
person doing the confirming has one thing to check instead of a whole paper.

The `projected` edge carries the paper as its `source`, because the relation came from the same
document: DATA-CONTRACT says every edge carries `source` and `confidence` when they are known.
**T19's five built-in `projected` edges do not carry a `source`** — that is a small difference between
the two writers, recorded here rather than copied; nothing depends on it today.

## A second forecast from a paper already in the document

One document node per paper, under `src-pmid-<pmid>`. A second plan citing that PMID does not write a
second paper node: the existing one is reused, byte for byte, and only the new `prediction` and its
edge are appended. Reuse is the normal case for a paper somebody already reviewed — the document node
is `confirmed: true` by then, and the skill has no business rewriting it, so the read-back only
vouches for the forecast it wrote. `tests/fixtures/add-prediction/graph-reviewed.json` is that state
(the after-fixture with the paper and its first forecast confirmed) and the test writes a second
forecast into a copy of it.

The plan's `effect` has to agree with the numbers the reused node records — `outcome`, `measure`,
`ratio`, `interval` and `per`, compared after folding case and whitespace on the prose fields. A
disagreement is exit 1 and names both values: two plans citing one PMID with different ratios are not
two forecasts of one effect, they are one of them being wrong, and the document is the copy a reader
has already seen.

## PubMed: the PMID is an identifier, not a claim

The record is fetched from PubMed's E-utilities, which needs no key and no registration:

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=<pmid>&retmode=json
```

The plan's `paper.title` is compared with the record's `title` after normalisation — HTML markup out
(`<i>Colonoscopy</i>`), entity references decoded, curly quotes flattened, whitespace collapsed, a
trailing period dropped, case folded. Everything else has to match word for word. The record's
`pubdate` has to name the same year as `paper.when`. A wrong PMID and a wrong title are the same
failure caught from two ends: one of the three is not the paper the forecast claims to cite.

`paper.link` must be exactly `https://pubmed.ncbi.nlm.nih.gov/<pmid>/`. That is the third tie between
the identifier and the address, and it is the one a reader clicks.

`--offline` skips the fetch. The report then says the PMID was **not** checked, in those words; an
unverified identifier is not a verified one, and a run that hides which it was is worse than either.
An unreachable PubMed (no network, DNS, a 500, a body that is not esummary JSON) is exit 2 and writes
nothing: the PMID is unverified, not wrong.

## HR + CI: four measures, one number

`measure` is `hazard ratio`, `risk ratio`, `relative risk` or `rate ratio` — the words a paper prints
for a ratio between two risks. An **odds ratio is refused**, and the refusal says why: turning an OR
into a relative risk assumes a baseline frequency of the outcome, and that assumption belongs to an
analysis somebody writes down, not to a skill that is adding a line to a chart.

`ratio` is the point estimate and `interval` is the published interval — `low <= ratio <= high` at
`level`. A point estimate outside its own interval is the only arithmetic the abstract lets a reader
check, and the skill treats it as the copy error it almost always is.

`delta_median` is `ln(ratio)`, because the gate sums deltas and only the log makes a product of ratios
add up (`docs/PREDICTIONS.md` §Why the delta is a logarithm; `docs/STRATEGIES.md`). The interval does
**not** travel onto the prediction: it belongs to the paper, so it lives in `effect` on the document
node, which is also the only place in this contract a PMID can live.

The **scale** — `mve-log-rr/1`, `crc-log-rr/1` — is not written to the node at all. T18's decision is
that the document does not carry it: the caller names it when it calls `applyPredictions`, exactly as
`applyRules` takes a rule set rather than a bare array. The skill asks the agent to know which scale
its `per` implies and to say it in the report; the gate is still the only thing that may add two
deltas, and it can only add them within one scale.

## The cohort check: unknown is not yes

A published ratio belongs to the population that was studied, and applying it to somebody else is a
guess wearing a citation. Three dimensions, each answering `pass`, `fail`, `unknown` or
`not-checked`:

| dimension | pass | fail | unknown |
|---|---|---|---|
| age | the person's age in the year of the **target record's date** is inside the paper's range | outside it | no `year_of_birth`, or the target carries no date |
| sex | `any`, or exactly the person's sex | the paper studied one sex and the person is the other | `meta.profile.sex` missing or not `female`/`male` |
| each `study.requires` predicate | true of the facts | false of them | the fact is missing or of the wrong type |

`fail` and `unknown` both refuse. The difference is what the refusal tells the agent to do: a `fail`
says this paper is not this person's; an `unknown` names the fact or the year of birth that would have
to be recorded first.

The age is read at the **target record's date**, not the horizon. Eligibility is about the moment of
the action — a 59-year-old invited to one screening colonoscopy is inside a trial that enrolled 55–64,
even though the ten-year risk it measured is about her at 69. The date comes from the document (the
target's `when`, or the start of its interval) and never from the clock, so re-running the skill
reproduces the same verdict.

`not-checked` exists for one case: `study.age: null`, a paper that prints no age range. It refuses
nothing and claims nothing, and the report counts it separately — "2 of 2 checks inside" and "1 of 2
inside, 1 not checked" are different sentences and should not read the same.

## The plan, and why it is one file

`SKILL.md` carries the field-by-field table; the fixture is
`tests/fixtures/add-prediction/plan-nordicc.json`. Two rules shape it:

- **Nothing in the plan is defaulted.** `effect.quote` is required because the review is "does this
  sentence say that number", not "read the paper again". `study.population` is required because the
  cohort check has to have something to say when it does not check a dimension.
- **Two things the plan may not contain.** `when` (a prediction is not an event: its date is the
  `horizon`, and the day it was made is the date printed on the paper) and `confirmed` (a
  confirmation that arrives with the plan is not a review). Both are refused by name.

## How it is checked

- `bun test scripts/add-prediction.test.ts` — 45 cases. The happy path (offline, and again with
  `--write`); the app's own `validateKg` over the written document; the committed fixture equal to
  what the skill writes, node for node; deterministic bytes; a second run refused; a second forecast
  reusing the first's document node, and a second forecast into a document whose paper a human has
  already confirmed (reused untouched, exit 0); a second forecast whose numbers disagree with the
  reused paper refused before anything is written; every refusal above, each asserting the sentence a
  person can act on; and the PubMed step against a stub record served by a real process — a match, a
  wrong title, a wrong year, a PMID with no record, an unreachable host and an HTTP 500.
- `bun run test:contract` — `tests/fixtures/kg/valid/health-add-prediction.json` is the
  before-document plus what the skill writes, so G1 refuses the build if the skill ever produces a
  document the app would not accept. `tests/fixtures/add-prediction/graph-before.json` is the input
  the test runs it on.
- `scripts/skills.test.ts` — frontmatter, the code block in `SKILL.md` byte-identical to the `.py`,
  stdlib-only imports, and `app.json` naming the skill under `requires.skills`.
- **Run against the live PubMed.** The NordICC plan was run once with the network on 2026-11-22:
  `PMID 36214590 verified: 'Effect of Colonoscopy Screening on Risks of Colorectal Cancer and Related
  Death.' (2022)`, cohort `2 of 2`, delta `ln 0.82 = -0.198451`. The abstract sentence in
  `effect.quote` is copied from that run's `efetch`, not from the fixture.

## What this does not do

- **No absolute risk.** `exp(delta)` is a relative change; the baseline is SCORE2's job.
- **No horizon chosen for you.** The paper's follow-up is not a claim about a person; the `horizon` is
  the caller's, and a horizon before the paper's own date is refused.
- **No facts derived from the record.** Mapping a prescription to `on_statin` or a note to
  `type_2_diabetes` is recorded work with its own error rate; the facts come in as a file, the same
  way `bun run strategies --facts` takes them.
- **No confirmation.** The skill cannot turn `confirmed` on, and the human who does it is outside this
  repository's tests.
- **No panel for a prediction.** The right panel's candidates are still marked *not approved* in
  `docs/WIDGETS.md`; the nodes exist and the gate reads them, and nothing draws them yet.
