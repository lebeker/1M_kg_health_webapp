# Product

## One sentence

A health map takes everything a person has been told about their body — lab values, diagnoses,
visits, drugs — and answers three questions on any date: **what is going on, how bad is it, and what
happens next.**

## Three questions, three columns

| Question | Column | What answers it |
|---|---|---|
| what is going on | left + centre | state on the selected date; the selected event in full |
| how bad is it | right, top | an estimate with an interval, and what moves it |
| what happens next | right, bottom | what was recommended, what we still do not know |

The user never switches modes. The event decides the layout: an analysis opens a panel, a diagnosis
opens a verdict, a summary opens plan versus fact.

## Who it is for

A person who has a folder of PDFs, screenshots and printouts, can read the words but cannot read the
medicine. They are not looking for a diagnosis engine and not for a dashboard. They want to know
whether the thing they were told last year still holds.

Secondary: a caregiver holding someone else's history, and a researcher who needs provenance for
every claim.

## What it refuses to do

| Refusal | Why |
|---|---|
| diagnose | a wrong diagnosis is worse than no diagnosis; the app explains what a doctor wrote |
| prescribe | treatment is a decision with a licence behind it |
| invent a number | every number carries a source, or it is not drawn |
| show a single-point forecast | "you have 15.2 years" is a lie with a decimal point; intervals only |
| score a person against a population without saying so | the estimate is a cohort median, labelled as one |
| hide what it does not know | a missing edge is shown, not smoothed over |
| be a pretty graph first | a picture that answers nothing is a poster, not a product |

## What "good" looks like

| Signal | Target |
|---|---|
| a new document becomes a node without a human typing a field | one confirmation, not a form |
| a user can say what changed since last year without scrolling | one screen |
| every number on screen has a click behind it that shows the source | 100% |
| a past date never shows knowledge we did not have | the ghost state, always |
| an empty profile does not look broken | honest empty state, not zeros |

## Not the product

- The 3D body. It answers "where", and "where" is the least asked of the three questions. It stays as
  an optional view behind a button, with a size warning, and it is P4.
- The graph as a centrepiece. It is a button, not a home screen.
- A calendar. There is already a timeline.
- A feed of cards. There is already a list.
- An editor. The agent writes; the human confirms.
- A social network. Sharing comes with the service, later, if ever.

## Where the product ends and the skill begins

The skill decides **what is true** and writes it down. The template decides **what it looks like**.
The moment the template starts guessing facts — a default age, a sample lab value, a plausible
interval — the split is gone and both halves become untrustworthy.

## Honest position today

There is a working renderer, an honest defect list, three wireframes and no data. The app stores six
sample values in HTML, has no `kg.json`, and its `app.json` still declares a research field map. It is
a prototype that knows what it wants to be, which is more than most prototypes.
