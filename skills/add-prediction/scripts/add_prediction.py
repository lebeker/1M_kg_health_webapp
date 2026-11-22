#!/usr/bin/env python3
"""add-prediction — one published effect, from PubMed to a node.

A prediction is a simulation, and the only node kind that carries a number the record has not
earned (`docs/PREDICTIONS.md`). Five built-in strategies ship in `src/strategies.ts`; this script
is the write path for the paper a user brings — the sixth, or the fiftieth.

The order is the card's — **PubMed → HR + CI → cohort check → node** — and every step can stop.

  1. **PubMed.** The paper must have a PMID. The plan carries it, and by default the script fetches
     the record from PubMed's E-utilities and compares the title and the year with what the
     plan says: a citation that does not match its PMID is a copy error, and this is where it is
     caught. `--offline` skips the fetch and the report says the PMID is unverified — unverified is
     not verified-by-absence.
  2. **HR + CI.** The effect is a ratio measure (hazard ratio, risk ratio, relative risk, rate
     ratio) with its published interval, and what it is `per`. A point estimate outside its own
     interval is a transcription error. An odds ratio is refused: it is not a relative risk, and the
     conversion between them is not this skill's claim to make.
  3. **Cohort check.** A published effect belongs to the population that was studied. The plan says
     who that was — an age range, a sex, and any facts the enrolment required — and the person is
     `meta.profile` in the document plus the facts the caller supplies. A dimension outside the
     paper's population refuses the write, and so does a dimension nobody answered (a missing year
     of birth, a missing fact): unknown is not yes.
  4. **Node.** The script writes the `document` node that carries the paper (`pmid`, `citation`,
     `link`, `effect`) and the `prediction` node that carries the forecast (T18's six fields), plus
     the `projected` edge to the node it is about. Both nodes are `confirmed: false`: no human has
     read them yet, and `confirmed` is a claim about a person reading, never about a script
     succeeding. Confirming is a separate act, done by whoever reviews the paper.

What the script will not do: invent a number (every value comes from the plan, which the agent
fills from the abstract), accept a `condition` it cannot read, write over an existing id, or turn
`confirmed` on.

Usage:

    python3 add_prediction.py --graph kg.json --plan plan.json                 # check and print
    python3 add_prediction.py --graph kg.json --plan plan.json --write          # append the nodes
    python3 add_prediction.py --graph kg.json --plan plan.json --facts facts.json --offline
    python3 add_prediction.py --graph kg.json --plan plan.json --pubmed-url <base>

Exit 0 = checked (and written, with `--write`); 1 = refused, with every problem named; 2 = usage,
an unreadable file, or a PubMed that could not be reached.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # `from __future__ import annotations` keeps the annotations unevaluated, so this import is for
    # the type checker only and the script still runs on the python3 a user happens to have.
    from typing import TypeGuard

DEFAULT_PUBMED = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

#: A measure this skill will take a delta from. Every one of them is a ratio, which is what
#: `delta_median = ln(ratio)` needs; an odds ratio is deliberately absent, see `effect_problems`.
RATIO_MEASURES = ("hazard ratio", "risk ratio", "relative risk", "rate ratio")

SEXES = ("any", "female", "male")
OPS = ("eq", "ne", "lt", "le", "gt", "ge", "in", "exists")
PREDICTION_TARGET_KINDS = ("condition", "observation")
PROVENANCE_KIND = "document"
APP_ID = "health-viewer"

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_USAGE = 2


class Unreachable(Exception):
    """PubMed could not be reached or did not answer — a usage-level wall, not a verdict."""


def refuse(about: str, problems: list[str]) -> int:
    """Print a refusal as one header plus every problem, so one run names all of them."""
    print(f"refused: {about} — {len(problems)} problem(s)", file=sys.stderr)
    for problem in problems:
        print(f"  - {problem}", file=sys.stderr)
    return EXIT_REFUSED


# --------------------------------------------------------------------------------------------
# Small predicates, in the same words `src/rules.ts` uses.
# --------------------------------------------------------------------------------------------


def is_object(value: object) -> TypeGuard[dict]:
    return isinstance(value, dict)


def is_non_empty(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and value.strip() != ""


def is_number(value: object) -> TypeGuard[float]:
    # `bool` is an `int` in Python and not a `number` in JSON; a `true` where a ratio belongs is a
    # bug, not a ratio of one.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def is_fact_value(value: object) -> TypeGuard[float | str | bool]:
    return is_number(value) or isinstance(value, (str, bool))


def is_calendar_date(value: object) -> TypeGuard[str]:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def predicate_problems(when: object, path: str) -> list[str]:
    """Every reason a condition over the facts is malformed — a port of `conditionProblems`."""
    if not is_object(when):
        return [f"{path}: a condition is an object"]

    shapes = [key for key in ("fact", "all", "any", "not") if key in when]
    if not shapes:
        if "op" in when or "value" in when:
            return [f"{path}.fact: a comparison names one fact"]
        return [f"{path}: a condition is exactly one of fact, all, any or not — found none"]
    if len(shapes) != 1:
        return [f"{path}: a condition is exactly one of fact, all, any or not — found {', '.join(shapes)}"]

    shape = shapes[0]
    if shape in ("all", "any"):
        children = when[shape]
        if not isinstance(children, list) or not children:
            return [f"{path}.{shape}: a condition that can never fire (an empty {shape}) is a bug, not a rule"]
        problems: list[str] = []
        for index, child in enumerate(children):
            problems.extend(predicate_problems(child, f"{path}.{shape}[{index}]"))
        return problems
    if shape == "not":
        return predicate_problems(when["not"], f"{path}.not")

    problems = []
    for key in when:
        if key not in ("fact", "op", "value"):
            problems.append(f'{path}: unknown key "{key}" in a comparison')
    if not is_non_empty(when.get("fact")):
        problems.append(f"{path}.fact: a comparison names one fact")
    op = when.get("op")
    if not isinstance(op, str) or op not in OPS:
        problems.append(f"{path}.op: must be one of {', '.join(OPS)}")
        return problems
    if op == "exists":
        if "value" in when:
            problems.append(f"{path}: exists takes no value — it asks only whether the fact is there")
        return problems
    if op == "in":
        value = when.get("value")
        if not isinstance(value, list) or not value or not all(is_fact_value(item) for item in value):
            problems.append(f"{path}.value: in takes a non-empty list of numbers, strings or booleans")
        return problems
    if not is_fact_value(when.get("value")):
        problems.append(f"{path}.value: must be a number, a string or a boolean")
    return problems


def evaluate_predicate(when: dict, facts: dict) -> object:
    """Three-valued, exactly as `evaluatePredicate` answers: true, `no-match`, or an unknown reason.

    "We do not know whether he is on a statin" is not "he is on a statin" — and it is not "he is
    not", either, which is why the cohort check refuses on anything but `true`.
    """
    if "all" in when:
        unknown = None
        for child in when["all"]:
            verdict = evaluate_predicate(child, facts)
            if verdict is True:
                continue
            if verdict == "no-match":
                return "no-match"
            unknown = unknown or verdict
        return unknown or True
    if "any" in when:
        unknown = None
        for child in when["any"]:
            verdict = evaluate_predicate(child, facts)
            if verdict is True:
                return True
            if verdict != "no-match":
                unknown = unknown or verdict
        return unknown or "no-match"
    if "not" in when:
        verdict = evaluate_predicate(when["not"], facts)
        if verdict is True:
            return "no-match"
        if verdict == "no-match":
            return True
        return verdict

    fact = when["fact"]
    op = when["op"]
    if op == "exists":
        return True if fact in facts else "missing-fact"
    if fact not in facts:
        return "missing-fact"
    actual = facts[fact]
    expected = when.get("value")

    if op == "in":
        items = expected if isinstance(expected, list) else []
        comparable = [item for item in items if type(item) is type(actual)]
        if not comparable:
            return "type-mismatch"
        return True if actual in comparable else "no-match"

    if isinstance(expected, list) or expected is None:
        return "type-mismatch"
    if type(expected) is not type(actual):
        return "type-mismatch"
    if op == "eq":
        return True if actual == expected else "no-match"
    if op == "ne":
        return True if actual != expected else "no-match"
    if not isinstance(actual, (int, float)) or isinstance(actual, bool):
        return "type-mismatch"
    if not isinstance(expected, (int, float)) or isinstance(expected, bool):
        return "type-mismatch"
    if op == "lt":
        return True if actual < expected else "no-match"
    if op == "le":
        return True if actual <= expected else "no-match"
    if op == "gt":
        return True if actual > expected else "no-match"
    if op == "ge":
        return True if actual >= expected else "no-match"
    return "type-mismatch"


# --------------------------------------------------------------------------------------------
# The plan: what the agent read out of the paper, and where the forecast goes.
# --------------------------------------------------------------------------------------------


def paper_problems(paper: object) -> list[str]:
    if not is_object(paper):
        return ["paper: missing — the PMID, title, citation, date and link of the paper"]

    problems: list[str] = []
    pmid = paper.get("pmid")
    if not is_non_empty(pmid):
        problems.append(
            "paper.pmid: missing PMID — this skill refuses a strategy without one: an effect nobody can "
            "trace is a rumour with a date on it"
        )
    elif not re.fullmatch(r"\d{7,8}", pmid):
        problems.append(f'paper.pmid: "{pmid}" is not a PubMed id — bare digits, e.g. 21067804')

    if not is_non_empty(paper.get("title")):
        problems.append("paper.title: missing — the paper's title as PubMed prints it, so the PMID can be checked against it")
    if not is_non_empty(paper.get("citation")):
        problems.append("paper.citation: missing — authors, title, journal, year; a link alone is not a citation")

    when = paper.get("when")
    if not is_calendar_date(when):
        problems.append(f'paper.when: must be the date printed on the paper, YYYY-MM-DD, got "{when}"')

    link = paper.get("link")
    if not is_non_empty(link):
        problems.append("paper.link: missing — where a reader can open the paper")
    elif is_non_empty(pmid) and re.fullmatch(r"\d{7,8}", pmid):
        expected = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        if link != expected:
            problems.append(
                f'paper.link: "{link}" is not "{expected}" — the link and the PMID have to be the same paper, '
                "and this is the cheapest place to notice that they are not"
            )
    return problems


def effect_problems(effect: object) -> list[str]:
    if not is_object(effect):
        return ["effect: missing — the published ratio, its interval, what it is per, and the sentence they came from"]

    problems: list[str] = []
    if not is_non_empty(effect.get("outcome")):
        problems.append("effect.outcome: missing — the outcome the paper measured, in its own words")

    measure = effect.get("measure")
    if not is_non_empty(measure):
        problems.append("effect.measure: missing — hazard ratio, risk ratio, relative risk or rate ratio, as printed")
    elif measure.strip().lower() == "odds ratio":
        problems.append(
            "effect.measure: an odds ratio is not a relative risk — it is not refused because it is weaker "
            "evidence, but because the conversion from one to the other is a claim about the outcome's "
            "frequency that this skill will not invent; find a paper that prints a risk or hazard ratio"
        )
    elif measure.strip().lower() not in RATIO_MEASURES:
        problems.append(
            f'effect.measure: "{measure}" is not a ratio this skill takes a delta from — one of '
            f"{', '.join(RATIO_MEASURES)}"
        )

    ratio = effect.get("ratio")
    if not is_number(ratio) or ratio <= 0:
        problems.append("effect.ratio: the published point estimate, a finite positive number")

    interval = effect.get("interval")
    if not is_object(interval):
        problems.append("effect.interval: missing — a point estimate with no interval is a number with no uncertainty")
    else:
        level = interval.get("level")
        low = interval.get("low")
        high = interval.get("high")
        if not is_number(level) or not (0 < level < 1):
            problems.append("effect.interval.level: a level between 0 and 1, e.g. 0.95")
        if not is_number(low) or low <= 0:
            problems.append("effect.interval.low: the published lower bound, a finite positive number")
        if not is_number(high) or high <= 0:
            problems.append("effect.interval.high: the published upper bound, a finite positive number")
        if is_number(low) and is_number(high) and is_number(ratio) and not (low <= ratio <= high):
            problems.append(
                f"effect: the point estimate {ratio} is outside its own interval {low}–{high} — one of the "
                "three was copied wrongly"
            )

    if not is_non_empty(effect.get("per")):
        problems.append(
            "effect.per: missing — a relative risk is per a change (per 1.0 mmol/L of LDL lowering, per "
            "10 mmHg of pressure); a ratio without it is applied to the wrong thing"
        )
    if not is_non_empty(effect.get("quote")):
        problems.append(
            "effect.quote: missing — the sentence of the abstract the numbers were read from; it is what the "
            "reviewer checks instead of re-reading the whole paper"
        )
    return problems


def study_problems(study: object) -> list[str]:
    if not is_object(study):
        return ["study: missing — who the paper studied, so the cohort check has something to check against"]

    problems: list[str] = []
    if not is_non_empty(study.get("design")):
        problems.append("study.design: missing — what kind of study it was (randomised trial, meta-analysis, cohort, …)")
    if not is_non_empty(study.get("population")):
        problems.append("study.population: missing — who was studied, in one sentence")

    age = study.get("age")
    if "age" not in study:
        problems.append(
            "study.age: missing — the age range the paper enrolled, {min, max}, or null when the paper prints none"
        )
    elif age is not None:
        if not is_object(age):
            problems.append("study.age: a {min, max} object, or null when the paper prints no range")
        else:
            low = age.get("min")
            high = age.get("max")
            if not is_number(low) or not is_number(high):
                problems.append("study.age: min and max are numbers, the range the paper enrolled")
            elif not (0 <= low < high <= 130):
                problems.append("study.age: the range needs 0 <= min < max <= 130, in whole years")

    if study.get("sex") not in SEXES:
        problems.append(f"study.sex: one of {', '.join(SEXES)} — who the paper enrolled")

    requires = study.get("requires")
    if not isinstance(requires, list):
        problems.append("study.requires: a list of conditions on the facts the enrolment required (may be empty)")
    else:
        for index, predicate in enumerate(requires):
            problems.extend(predicate_problems(predicate, f"study.requires[{index}]"))
    return problems


def plan_problems(plan: object) -> list[str]:
    if not is_object(plan):
        return ["plan: one JSON object per strategy — id, label, target, horizon, condition, confidence, limits, paper, effect, study"]

    problems: list[str] = []
    if "when" in plan:
        problems.append(
            "when: a prediction has no `when` — it is not an event. Its date is the `horizon`, and the day it "
            "was made is the date printed on its source document"
        )
    if "confirmed" in plan:
        problems.append(
            "confirmed: the plan does not take a confirmation — the skill writes `confirmed: false`, and a human "
            "who has read the paper turns it on. A confirmation that arrives with the plan is not a review"
        )

    plan_id = plan.get("id")
    if not is_non_empty(plan_id):
        problems.append("id: missing — the prediction's node id; it is never reused for different content")
    elif re.search(r"\s", plan_id):
        problems.append(f'id: "{plan_id}" contains whitespace — node ids are written, quoted and typed')

    if not is_non_empty(plan.get("label")):
        problems.append("label: missing — the forecast in one sentence, as the person reading it would say it")

    if "condition" not in plan:
        problems.append(
            "condition: missing — a forecast with nothing to wait for moves the estimate the day it is written"
        )
    else:
        problems.extend(predicate_problems(plan["condition"], "condition"))

    confidence = plan.get("confidence")
    if not is_number(confidence) or not (0 <= confidence <= 1):
        problems.append("confidence: a number from 0 to 1 — this skill's trust in the delta, not a p-value")

    limits = plan.get("limits")
    if not isinstance(limits, list) or not limits:
        problems.append("limits: at least one — what the effect does not cover travels with the number")
    elif not all(is_non_empty(limit) for limit in limits):
        problems.append("limits: every entry must say something")

    if not is_non_empty(plan.get("target")):
        problems.append("target: missing — the id of the condition or observation in this document the forecast is about")

    horizon = plan.get("horizon")
    if not is_calendar_date(horizon):
        problems.append(f'horizon: must be a date, YYYY-MM-DD, got "{horizon}"')

    problems.extend(paper_problems(plan.get("paper")))
    problems.extend(effect_problems(plan.get("effect")))
    problems.extend(study_problems(plan.get("study")))
    return problems


# --------------------------------------------------------------------------------------------
# The document: what it already says, and whether the forecast belongs in it.
# --------------------------------------------------------------------------------------------


def document_id(pmid: str) -> str:
    return f"src-pmid-{pmid}"


def folded(text: object) -> str:
    """A sentence comparable across two writes of it: case, quotes and whitespace out."""
    return " ".join(text.split()).strip().lower() if isinstance(text, str) else ""


def reused_effect_problems(source_id: str, existing: dict, effect: dict) -> list[str]:
    """Every way a second forecast's numbers disagree with the paper already in the document.

    A document node is one paper's published effect, and a second forecast from that paper reads
    the numbers the first one recorded. Two plans citing one PMID with different ratios are not two
    forecasts of one effect; they are one of them being wrong, and the document is the copy a reader
    has already seen.
    """
    recorded = existing.get("effect")
    if not is_object(recorded):
        return [
            f"{source_id}: the paper is already in this document without its `effect`, so a second "
            "forecast would carry numbers the document does not record — add the paper's effect to "
            f"{source_id} first, or use a fresh document"
        ]

    problems: list[str] = []
    for field in ("outcome", "measure", "per"):
        if folded(recorded.get(field)) != folded(effect.get(field)):
            problems.append(
                f'{source_id}: the plan\'s effect.{field} is {effect.get(field)!r}, the document records '
                f"{recorded.get(field)!r} — this paper is already here with its published effect, and a "
                "second forecast reads it rather than replacing it"
            )

    recorded_interval = recorded.get("interval")
    plan_interval = effect.get("interval")
    if not is_object(recorded_interval):
        recorded_interval = {}
    if not is_object(plan_interval):
        plan_interval = {}
    if recorded.get("ratio") != effect.get("ratio"):
        problems.append(
            f"{source_id}: the plan's effect.ratio is {json.dumps(effect.get('ratio'))}, the document "
            f"records {json.dumps(recorded.get('ratio'))} — one of the two numbers is not this paper's"
        )
    for field in ("level", "low", "high"):
        if recorded_interval.get(field) != plan_interval.get(field):
            problems.append(
                f"{source_id}: the plan's effect.interval.{field} is {json.dumps(plan_interval.get(field))}, "
                f"the document records {json.dumps(recorded_interval.get(field))} — one of the two numbers "
                "is not this paper's"
            )
    return problems


def graph_problems(plan: dict, graph: object) -> tuple[list[str], dict | None]:
    """Refusals that need the document: app, ids, the target, the horizon, the profile."""
    if not is_object(graph):
        return (["graph: the document is one JSON object with meta, nodes and edges"], None)

    problems: list[str] = []
    meta = graph.get("meta")
    if not is_object(meta):
        problems.append("graph.meta: missing — a health document's envelope")
    elif meta.get("app") != APP_ID:
        problems.append(
            f'graph.meta.app: "{meta.get("app")}" is not {APP_ID} — a prediction belongs in a health map, and '
            "nothing else here would draw it"
        )

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list):
        problems.append("graph.nodes: missing — the nodes array the forecast is appended to")
        nodes = []
    if not isinstance(edges, list):
        problems.append("graph.edges: missing — the edges array the projected edge is appended to")

    by_id = {node.get("id"): node for node in nodes if is_object(node) and is_non_empty(node.get("id"))}

    plan_id = plan.get("id")
    if is_non_empty(plan_id) and plan_id in by_id:
        problems.append(f"id: a node with id \"{plan_id}\" is already in this document — a forecast is never rewritten under the same id")

    target = plan.get("target")
    if is_non_empty(target) and target not in by_id:
        problems.append(f'target: "{target}" is not a node in this document')
    elif is_non_empty(target):
        kind = by_id[target].get("kind")
        if kind not in PREDICTION_TARGET_KINDS:
            problems.append(
                f'target: "{target}" is a {kind} node, expected condition or observation — a forecast about a '
                "document or a drug names a thing that cannot carry the outcome it claims"
            )

    paper = plan.get("paper")
    horizon = plan.get("horizon")
    if is_object(paper) and is_calendar_date(horizon) and is_calendar_date(paper.get("when")):
        if horizon < paper["when"]:
            problems.append(
                f"horizon: {horizon} is before {paper['when']}, the date printed on the paper — a forecast is "
                "about a later date, never an earlier one"
            )

    pmid = paper.get("pmid") if is_object(paper) else None
    effect = plan.get("effect")
    if is_non_empty(pmid) and re.fullmatch(r"\d{7,8}", pmid):
        existing = by_id.get(document_id(pmid))
        if existing is not None and existing.get("pmid") != pmid:
            problems.append(
                f'{document_id(pmid)} is already in this document as a different paper (pmid '
                f'"{existing.get("pmid")}") — two papers cannot share one document id'
            )
        elif existing is not None and is_object(effect):
            # A second forecast from the same paper reuses its document node untouched — including
            # when a human has already confirmed it — but only the numbers that node records.
            problems.extend(reused_effect_problems(document_id(pmid), existing, effect))

    profile = meta.get("profile") if is_object(meta) else None
    if not is_object(profile):
        problems.append("graph.meta.profile: missing — the cohort check reads sex and year of birth from it")
    return (problems, meta if is_object(meta) else None)


def target_date(graph: dict, target: object) -> str | None:
    """The date the forecast applies to the person: the target record's own `when`.

    A cohort's age range is about the moment of the action, not the moment of the outcome — a
    59-year-old invited to one screening colonoscopy is inside a trial that enrolled 55–64, even
    though the 10-year risk it measured is about her at 69. Reading the clock would make the check
    irreproducible, so the date comes from the record: the target's `when`, or the start of its
    interval.
    """
    node = next((item for item in graph.get("nodes", []) if is_object(item) and item.get("id") == target), None)
    if not is_object(node):
        return None
    when = node.get("when")
    if is_calendar_date(when):
        return when
    if is_object(when) and is_calendar_date(when.get("from")):
        return when["from"]
    return None


def cohort_checks(plan: dict, meta: dict, facts: dict, reference: str | None) -> list[dict]:
    """The person against the paper's population — every dimension pass, fail, unknown or not-checked.

    Three dimensions, and each answers with the words it found: the age on the target record's date,
    the sex, and every fact the enrolment required. A `fail` says the person is not who the paper
    studied; an `unknown` says nobody knows yet, which refuses just as hard, because a forecast
    applied to somebody the paper did not study is a guess wearing a citation. `not-checked` is for a
    dimension the paper does not print at all: it refuses nothing and claims nothing.
    """
    checks: list[dict] = []
    study = plan.get("study") if is_object(plan.get("study")) else {}
    profile = meta.get("profile") if is_object(meta.get("profile")) else {}

    year_of_birth = profile.get("year_of_birth")
    age_range = study.get("age")
    if age_range is None:
        checks.append(
            {
                "dimension": "age",
                "verdict": "not-checked",
                "detail": "the paper prints no age range, so there is nothing to check the person against; "
                f"who was studied is {study.get('population')!r}",
            }
        )
    elif not is_object(age_range):
        checks.append(
            {
                "dimension": "age",
                "verdict": "unknown",
                "detail": "study.age is neither a range nor null — the cohort check cannot be made, which is a refusal",
            }
        )
    else:
        low = age_range.get("min")
        high = age_range.get("max")
        if not is_number(year_of_birth):
            checks.append(
                {
                    "dimension": "age",
                    "verdict": "unknown",
                    "detail": "meta.profile.year_of_birth is not in the document, so the person's age is unknown — "
                    "a cohort check that cannot be made is a refusal",
                }
            )
        elif reference is None:
            checks.append(
                {
                    "dimension": "age",
                    "verdict": "unknown",
                    "detail": f'the target "{plan.get("target")}" carries no date, so the person\'s age when the '
                    "forecast applies is unknown",
                }
            )
        else:
            age = int(reference[:4]) - int(year_of_birth)
            if is_number(low) and is_number(high) and low <= age <= high:
                checks.append(
                    {
                        "dimension": "age",
                        "verdict": "pass",
                        "detail": f"{age} in {reference[:4]}, inside the paper's {int(low)}–{int(high)}",
                    }
                )
            else:
                checks.append(
                    {
                        "dimension": "age",
                        "verdict": "fail",
                        "detail": f"{age} in {reference[:4]} is outside the paper's "
                        f"{int(low) if is_number(low) else '?'}–{int(high) if is_number(high) else '?'}: an effect "
                        "measured in people who were not this person is not a forecast for them",
                    }
                )

    sex = study.get("sex")
    person_sex = profile.get("sex")
    if sex == "any" and person_sex in ("female", "male"):
        checks.append({"dimension": "sex", "verdict": "pass", "detail": f"{person_sex}; the paper enrolled any"})
    elif sex in ("female", "male") and person_sex == sex:
        checks.append({"dimension": "sex", "verdict": "pass", "detail": f"{person_sex}, as the paper enrolled"})
    elif person_sex not in ("female", "male"):
        checks.append(
            {
                "dimension": "sex",
                "verdict": "unknown",
                "detail": "meta.profile.sex is missing or not female/male, so the paper's population cannot be "
                "compared with the person",
            }
        )
    else:
        checks.append(
            {
                "dimension": "sex",
                "verdict": "fail",
                "detail": f"the paper studied {sex}; meta.profile.sex is {person_sex}",
            }
        )

    requires = study.get("requires") if isinstance(study.get("requires"), list) else []
    for index, predicate in enumerate(requires):
        verdict = evaluate_predicate(predicate, facts)
        fact = predicate.get("fact", "(composite)") if is_object(predicate) else "(malformed)"
        path = f"study.requires[{index}]"
        if verdict is True:
            checks.append(
                {
                    "dimension": path,
                    "verdict": "pass",
                    "detail": f"{fact} = {json.dumps(facts.get(fact))}, as the paper's enrolment required",
                }
            )
        elif verdict == "no-match":
            checks.append(
                {
                    "dimension": path,
                    "verdict": "fail",
                    "detail": f"the paper enrolled people where {fact} = {json.dumps(predicate.get('value'))}; "
                    f"the facts say {json.dumps(facts.get(fact))} — the person is outside the population studied",
                }
            )
        else:
            reason = {
                "missing-fact": "is not recorded",
                "type-mismatch": "is recorded as the wrong type",
            }.get(str(verdict), "cannot be evaluated")
            checks.append(
                {
                    "dimension": path,
                    "verdict": "unknown",
                    "detail": f"the fact {fact} {reason}, so whether the person belongs to the paper's population "
                    "is unknown — and unknown is not a yes",
                }
            )
    return checks


# --------------------------------------------------------------------------------------------
# PubMed: the PMID is an identifier, not a claim.
# --------------------------------------------------------------------------------------------


def title_key(text: str) -> str:
    """A title comparable across the record and the plan: markup, curly quotes and whitespace out."""
    plain = html.unescape(text)
    plain = re.sub(r"<[^>]+>", "", plain)
    plain = (
        plain.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    return re.sub(r"\s+", " ", plain).strip().lower().rstrip(" .")


def fetch_pmid(base: str, pmid: str, timeout: float) -> dict:
    """The PubMed record for one PMID, or `Unreachable`. A record that is not there is a refusal."""
    url = f"{base}?db=pubmed&id={pmid}&retmode=json"
    request = urllib.request.Request(url, headers={"User-Agent": "add-prediction/1 (health-viewer)"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            body = response.read()
    except urllib.error.HTTPError as error:
        raise Unreachable(f"{url}: HTTP {error.code}") from error
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise Unreachable(f"{url}: {error}") from error
    if status != 200:
        raise Unreachable(f"{url}: HTTP {status}")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise Unreachable(f"{url}: not a PubMed JSON response ({error})") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("result"), dict):
        raise Unreachable(f"{url}: not a PubMed JSON response")
    if "error" in payload:
        raise Unreachable(f"{url}: PubMed said {payload['error']}")

    record = payload["result"].get(pmid)
    if not isinstance(record, dict):
        raise LookupError(pmid)
    return record


def verify_pmid(plan: dict, base: str, timeout: float) -> dict:
    """Fetch the record and hold the plan's title and year against it. Refuses on a mismatch."""
    paper = plan["paper"]
    try:
        record = fetch_pmid(base, paper["pmid"], timeout)
    except LookupError as error:
        raise LookupError(
            f"paper.pmid: {paper['pmid']} does not resolve to a PubMed record — check the number on "
            "https://pubmed.ncbi.nlm.nih.gov/ before anything is written"
        ) from error

    problems: list[str] = []
    published = record.get("title") if isinstance(record.get("title"), str) else ""
    if title_key(published) != title_key(paper["title"]):
        problems.append(
            f"paper.title: PubMed's title for PMID {paper['pmid']} is {published!r}; the plan says "
            f"{paper['title']!r} — one of the two is the wrong paper"
        )

    pubdate = record.get("pubdate") if isinstance(record.get("pubdate"), str) else ""
    match = re.search(r"\b(\d{4})\b", pubdate)
    year = match.group(1) if match else ""
    if year and year != paper["when"][:4]:
        problems.append(
            f"paper.when: PubMed prints {pubdate!r} for PMID {paper['pmid']}, the plan says {paper['when']} — "
            "the date printed on the paper is the date the forecast is made on"
        )
    if problems:
        raise ValueError("\n".join(problems))

    return {
        "verified": True,
        "pmid": paper["pmid"],
        "title": published,
        "year": year,
        "journal": record.get("fulljournalname", ""),
    }


# --------------------------------------------------------------------------------------------
# The nodes.
# --------------------------------------------------------------------------------------------


def build_nodes(plan: dict, graph: dict) -> tuple[dict, dict, dict, bool]:
    """The paper's document node, the forecast, and the edge — the shape T19 writes, for a user's paper."""
    paper = plan["paper"]
    effect = plan["effect"]
    pmid = paper["pmid"]
    source_id = document_id(pmid)

    existing = next((node for node in graph["nodes"] if is_object(node) and node.get("id") == source_id), None)
    reused = existing is not None

    document = existing or {
        "id": source_id,
        "kind": PROVENANCE_KIND,
        "label": f"{paper['citation'].split('.')[0]} — {effect['outcome']}",
        "when": paper["when"],
        "confirmed": False,
        "link": paper["link"],
        "pmid": pmid,
        "citation": paper["citation"],
        "effect": {
            "outcome": effect["outcome"],
            "measure": effect["measure"],
            "ratio": effect["ratio"],
            "interval": {
                "level": effect["interval"]["level"],
                "low": effect["interval"]["low"],
                "high": effect["interval"]["high"],
            },
            "per": effect["per"],
        },
    }

    prediction = {
        "id": plan["id"],
        "kind": "prediction",
        "label": plan["label"],
        "target": plan["target"],
        "horizon": plan["horizon"],
        "condition": plan["condition"],
        "delta_median": math.log(effect["ratio"]),
        "confidence": plan["confidence"],
        "confirmed": False,
        "source": source_id,
    }

    edge = {
        "from": plan["id"],
        "to": plan["target"],
        "label": "projected",
        "confidence": plan["confidence"],
        "source": source_id,
    }
    return document, prediction, edge, reused


def write_graph(path: Path, graph: dict) -> None:
    """One atomic replace, formatted the way the rest of the documents are."""
    text = json.dumps(graph, indent=2, ensure_ascii=False) + "\n"
    handle, temporary = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def read_json(path: Path, what: str) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ValueError(f"{what} {path}: {error.strerror or error}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"{what} {path}: not JSON ({error})") from error


# --------------------------------------------------------------------------------------------
# The program.
# --------------------------------------------------------------------------------------------


def report_text(report: dict) -> str:
    cohort = report["cohort"]
    inside = sum(1 for check in cohort if check["verdict"] == "pass")
    unchecked = sum(1 for check in cohort if check["verdict"] == "not-checked")
    pmid = report["pmid"]
    effect = report["effect"]
    counted = f"{inside} of {len(cohort)} checks inside the paper's population"
    if unchecked:
        counted += f" ({unchecked} not checked: the paper prints nothing to check)"
    lines = [
        f"add-prediction — {report['prediction']['id']}",
        "",
        (
            f"  PubMed   PMID {pmid['pmid']} verified: {pmid['title']!r} ({pmid['year']})"
            if pmid["verified"]
            else f"  PubMed   PMID {pmid['pmid']} NOT checked against PubMed ({pmid['reason']}) — the title and "
            "the year are the plan's, not the record's"
        ),
        f"  effect   {effect['measure']} {effect['ratio']:g} "
        f"({int(round(effect['interval']['level'] * 100))}% CI {effect['interval']['low']:g}–"
        f"{effect['interval']['high']:g}) per {effect['per']} — {effect['outcome']}",
        f"  cohort   {counted}",
    ]
    for check in cohort:
        lines.append(f"           {check['dimension']}: {check['detail']}")
    node = report["prediction"]
    source_line = (
        f"           source {node['source']} (the paper)"
        + (" — already in the document, reused" if report["document_reused"] else " — written" if report["wrote"] else " — will be appended by --write")
    )
    lines.extend(
        [
            f"  node     {node['id']} → {node['target']}, horizon {node['horizon']}",
            f"           delta_median ln({effect['ratio']:g}) = {node['delta_median']:.6f}, confidence {node['confidence']:g}",
            source_line,
        ]
    )
    if report["document_reused"]:
        lines.extend(
            [
                "  review   the forecast is `not confirmed`; the paper's node was already in the document and",
                "           is left as it stands. Read the abstract, check the sentence the numbers came from,",
                "           then confirm the forecast:",
            ]
        )
    else:
        lines.extend(
            [
                "  review   both nodes are `not confirmed`. Read the abstract, check the sentence the numbers came",
                "           from, then confirm them in the document:",
            ]
        )
    lines.append(f'           "{effect["quote"]}"')
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="add one published strategy to a health map, refusing without a PMID")
    parser.add_argument("--graph", required=True, help="the kg.json to check against (and to append to with --write)")
    parser.add_argument("--plan", required=True, help="one strategy: paper, effect, study, and where the forecast goes")
    parser.add_argument("--facts", help="flat facts record for the cohort check's enrolment conditions")
    parser.add_argument("--write", action="store_true", help="append the nodes; without it the run only checks and prints")
    parser.add_argument("--offline", action="store_true", help="do not ask PubMed; the report says the PMID is unverified")
    parser.add_argument("--pubmed-url", default=DEFAULT_PUBMED, help=f"PubMed E-utilities esummary base (default {DEFAULT_PUBMED})")
    parser.add_argument("--timeout", type=float, default=10.0, help="seconds to wait for PubMed")
    parser.add_argument("--json", action="store_true", help="print the report as JSON instead of prose")
    args = parser.parse_args(argv)

    graph_path = Path(args.graph)
    try:
        plan = read_json(Path(args.plan), "plan")
        graph = read_json(graph_path, "graph")
        facts = read_json(Path(args.facts), "facts") if args.facts else {}
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_USAGE
    if not is_object(facts):
        print("error: facts: a flat record of numbers, strings and booleans", file=sys.stderr)
        return EXIT_USAGE

    problems = plan_problems(plan)
    if problems:
        return refuse(f"the plan {args.plan}", problems)

    graph_problems_found, meta = graph_problems(plan, graph)
    if graph_problems_found:
        return refuse(f"the document {args.graph}", graph_problems_found)

    # The readers above refuse anything that is not an object with a `meta.profile`, so these are the
    # narrowed values; the asserts are the type checker's copy of that fact, not a second check.
    assert is_object(plan) and is_object(graph) and is_object(meta)

    cohort = cohort_checks(plan, meta, facts, target_date(graph, plan.get("target")))
    # `not-checked` is a dimension the paper does not print: it claims nothing and refuses nothing.
    # `fail` and `unknown` both refuse — one says the person is outside the population, the other
    # says nobody knows, and a forecast does not get to treat the second as a yes.
    outside = [check for check in cohort if check["verdict"] in ("fail", "unknown")]
    if outside:
        return refuse(
            "the cohort check",
            [f"{check['dimension']} ({check['verdict']}): {check['detail']}" for check in outside],
        )

    if args.offline:
        pmid = {"verified": False, "pmid": plan["paper"]["pmid"], "title": plan["paper"]["title"], "year": plan["paper"]["when"][:4], "reason": "offline"}
    else:
        try:
            pmid = verify_pmid(plan, args.pubmed_url, args.timeout)
        except Unreachable as error:
            print(
                f"error: PubMed is unreachable — {error}\n"
                "       nothing was written. An unverified PMID is not a verified one; run again when the "
                "network is there, or pass --offline and say in the report that the PMID was not checked.",
                file=sys.stderr,
            )
            return EXIT_USAGE
        except LookupError as error:
            return refuse("the PubMed lookup", [str(error)])
        except ValueError as error:
            return refuse("the PubMed record against the plan", [str(line) for line in str(error).splitlines()])

    document, prediction, edge, reused = build_nodes(plan, graph)
    report = {
        "ok": True,
        "wrote": False,
        "document_reused": reused,
        "pmid": pmid,
        "effect": plan["effect"],
        "cohort": cohort,
        "document": document,
        "prediction": prediction,
        "edge": edge,
        "review": {
            "required": True,
            "confirmed": False,
            # A reused paper's node is not rewritten, so it is not part of what the review has to
            # confirm: it already carries whatever confirmation a person gave it the first time.
            "ids": [prediction["id"]] if reused else [document["id"], prediction["id"]],
            "message": (
                "the forecast is written `confirmed: false`; the paper was already in the document and its "
                "node is left as it stands — a human reads the paper and confirms the forecast"
                if reused
                else "both nodes are written `confirmed: false`; a human reads the paper and confirms them"
            ),
        },
    }

    if args.write:
        document_added = not reused
        graph["nodes"].append(prediction) if not document_added else graph["nodes"].extend([document, prediction])
        graph["edges"].append(edge)
        try:
            write_graph(graph_path, graph)
        except OSError as error:
            print(f"error: could not write {graph_path}: {error}", file=sys.stderr)
            return EXIT_USAGE

        # Read the write back: an id that is not there, or a `confirmed: true`, is a script that
        # reported success and did something else.
        try:
            written = read_json(graph_path, "graph")
        except ValueError as error:
            print(f"error: written, but not readable back — {error}", file=sys.stderr)
            return EXIT_USAGE
        back = {node.get("id"): node for node in written.get("nodes", []) if is_object(node)}
        read_back = back.get(prediction["id"])
        if read_back is None:
            print(f"error: written, but {prediction['id']} is not in {graph_path} on read-back", file=sys.stderr)
            return EXIT_USAGE
        # Only the nodes this run wrote are this script's to vouch for. A reused document node is
        # the caller's: a human may have confirmed the paper on the first forecast, and that is the
        # normal state a second forecast arrives in — it is not a thing this script wrote.
        confirmed_somewhere = read_back.get("confirmed") is not False or (
            document_added and back.get(document["id"], {}).get("confirmed") is not False
        )
        if confirmed_somewhere:
            print("error: a node came back confirmed, which this script never writes", file=sys.stderr)
            return EXIT_USAGE
        report["wrote"] = True

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(report_text(report))
        if not args.write:
            print("\n  dry run — pass --write to append the nodes to the document")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
