#!/usr/bin/env python3
"""Keep Jira in step with the Kanban queue — the card moves, Jira moves.

Jira is the ledger a human reads; Kanban is what a bot claims. This is the seam between them: it
reads card state from the board and applies it to the matching Jira issue (assignee, status,
comment), so nobody updates Jira by hand and Jira never drifts from what actually happened.

    python3 scripts/jira-sync.py --dry-run     # show the plan, write nothing
    python3 scripts/jira-sync.py --apply       # do it (cron-safe, idempotent)
    python3 scripts/jira-sync.py --apply --strict   # a missing assignee mapping is fatal
    python3 scripts/jira-sync.py --dry-run --card t_92632684   # one card only (gate checks, repair)

Card -> issue is found by the ticket the card names: a `Task: SCRUM-<n>` line in the body first, then
any single `SCRUM-<n>` in the body, and the comments only when the body names none. So the link lives
on the card itself, not in a side table — but a status comment that merely mentions another ticket
("… came out of the SCRUM-40 bootstrap") can never move the card onto that ticket. A card that leaves
two or more candidates at the level that decides, or two cards that claim the same issue, is a
*warning and a skip*: an ambiguous link that silently writes is worse than no write, because it moves
a ticket nobody was talking about.

State mapping (three-column workflow: To Do / In Progress / Done):

    ready, todo, scheduled  -> To Do          (no transition if already there)
    running                 -> In Progress    + comment: worker <profile> claimed it
    review                  -> In Progress    + comment: ready for review, with the card summary
    blocked                 -> unchanged      + comment: why, with the block reason
    changes_requested       -> unchanged      + comment: what the reviewer wants
    done                    -> Done           + comment: closing summary — *gated*, see below

`blocked` and `changes_requested` leave the status alone *on purpose*, so they are not warnings.

**Done is the one gated state.** Jira is the ledger a human reads, and a Done there says "this reached
main". A card's status alone does not say that — a card can be closed while its PR is still open — and
there is no supported transition back out of Done, so a wrong write cannot be undone. The sync
therefore resolves the card's pull request (its branch, else any PR whose body *opens* with
`Task: <card-id>`) and writes Done only on evidence the work is on `origin/main`:

    MERGED PR whose merge commit is reachable from origin/main        -> Done
    `no-change-needed: <commit>` in a card comment, commit on origin/main -> Done
    OPEN PR, or a PR closed without merging                           -> no transition; `pending-merge`
    anything else: no PR, unreachable commit, gh unavailable          -> no transition; `no-merge-evidence`

A refusal posts a comment saying why and leaves the status as it was. It is logged on its own line, so
`grep pending-merge` over a run log lists every card the ledger is waiting on.

**A status never moves backwards.** `running -> review -> running` is the normal rework path, and
`ready` after a reviewer's changes is normal too: a card that maps to *To Do* while its issue is *In
Progress* holds, and so does a card that maps to *In Progress* while its issue is *Done*. Otherwise one
rework cycle would drag the ledger back and forth, and a Done issue dragged back would be a lie about a
merge that happened. Holds are logged as `status-not-moved-backwards` and commented once.

Three things this does that the old version did not:

* **Assignment.** The card's assignee profile is mapped to a Jira account id through
  `scripts/jira-identities.json` and set on the issue. A profile with no mapping is a warning, not a
  silent skip, because the ledger showing the wrong owner is worse than showing none.
* **A comment even when the status does not change.** `review` and `blocked` both sit in *In
  Progress*; the old version treated "status already correct" as "nothing to do" and dropped the
  review and block comments entirely.
* **Read-back.** Every write is followed by a read of the field it changed. A write that Jira
  accepted but did not apply is an error here, not a success.

Every comment carries `[sync:<state>:<digest>]`, where the digest covers the body, so re-running
never repeats a comment and a *new* block reason or a new review summary still posts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
BOARD = os.environ.get("KANBAN_BOARD", "health")
MCP_CLI = os.environ.get("MCP_PROXY_CLI", "/Users/denistatarenko/Work/other/MCP/query-mcp.js")
MCP_USER = os.environ.get("MCP_USER", "mex")
IDENTITY_MAP_PATH = os.environ.get("JIRA_IDENTITIES", os.path.join(HERE, "jira-identities.json"))
JIRA_KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
# A card that declares its ticket — `Task: SCRUM-40` on its own line — has said which issue it is
# about, and that declaration outranks any other ticket the body goes on to mention.
TICKET_DECLARATION_RE = re.compile(r"(?im)^[ \t]*task[ \t]*:[ \t]*([A-Z][A-Z0-9]+-\d+)\b")

TARGET_STATUS = {
    "ready": "To Do",
    "todo": "To Do",
    "scheduled": "To Do",
    "running": "In Progress",
    "review": "In Progress",
    "done": "Done",
}

# States that hold the Jira status where it is *by design*. They comment, but they are not a warning:
# `blocked` is a card-level state on an issue that is still in progress, and a review that came back
# with changes is still being worked. Anything else without a mapping (a typo, a new column) warns.
STATUS_HELD = ("blocked", "changes_requested")

# The three-column workflow, ordered. A transition that would move down this scale is refused: the
# ledger records progress, and a board flap (running -> review -> running, done -> ready after an
# unblock) must not drag it backwards. See `backwards_reason`.
STATUS_RANK = {"To Do": 0, "In Progress": 1, "Done": 2}

# States that say something a human needs to read, even when the status column does not move.
COMMENT_STATES = ("running", "review", "blocked", "changes_requested", "done")

# A card that has been archived is out of the flow: nothing is written for it, and — the reason this
# is a constant rather than an `if` in one loop — it does not get to claim an issue either. Two
# decomposer cards left behind by a mistake still named SCRUM-41, and their lingering claim silenced
# the real card's sync for as long as they sat in the table.
ARCHIVED = "archived"

STEP_ASSIGN = "assign"
STEP_TRANSITION = "transition"
STEP_COMMENT = "comment"


class StepFailed(RuntimeError):
    """A write was rejected, or accepted without taking effect (read-back disagreed)."""


@dataclass
class Step:
    kind: str
    value: Any
    note: str = ""


@dataclass
class Plan:
    card_id: str
    card_state: str
    key: str
    steps: list[Step] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # Why a status write was refused (`pending-merge: …`, `no-merge-evidence: …`,
    # `unverifiable: …`, `status-not-moved-backwards: …`). Logged on its own line by `run`, so a run
    # log names every card the ledger is waiting on rather than only the ones it moved.
    holds: list[str] = field(default_factory=list)

    @property
    def actionable(self) -> bool:
        return bool(self.steps)


def marker_for(state: str, body: str) -> str:
    """A plain token, no punctuation: Jira's Markdown→ADF path eats `[` and `*`, and a marker that
    arrives mangled cannot be used to prove the write landed."""
    digest = hashlib.sha1(body.encode("utf-8")).hexdigest()[:8]
    return f"sync:{state}:{digest}"


def summarise(detail: dict, state: str, extra: str = "") -> str:
    """The prose half of a state comment: plain text, no markup to lose.

    The run summary is only used when it belongs to *this* state — the latest run's summary of a card
    that was blocked yesterday is not the reason it is running today. `extra` is a line the caller
    insists on, and `done` uses it to name the evidence that allowed the Done write.
    """
    task = detail.get("task") or {}
    run = detail.get("run") or {}
    run_status = run.get("status")
    run_summary = (run.get("summary") or "").strip()
    card = f"`{task.get('id')}`"
    who = f"`{task.get('assignee')}`"

    if state == "blocked":
        reason = (
            (task.get("block_reason") or "").strip()
            or (run_summary if run_status == "blocked" else "")
            or (task.get("last_failure_error") or "").strip()
            or "no reason recorded on the card"
        )
        return f"Blocked: {reason}"
    if state == "review":
        text = f"Ready for review: card {card}, worker {who}."
        return f"{text}\n\n{run_summary[:1200]}" if run_status == "done" and run_summary else text
    if state == "changes_requested":
        text = f"Changes requested on card {card}, worker {who}."
        return f"{text}\n\n{run_summary[:1200]}" if run_summary else text
    if state == "done":
        text = f"Done: card {card}, worker {who}."
        body = f"{text}\n\n{run_summary[:1200]}" if run_summary else text
        return f"{body}\n\n{extra}" if extra else body
    if state == "running":
        return f"In progress: worker {who} claimed card {card}."
    return f"Card {card} moved to {state}."


def comment_for(detail: dict, state: str, extra: str = "") -> tuple[str, str]:
    """(marker, full comment body). The marker covers the prose, so an identical comment is skipped
    and a changed one (a new block reason, a new review summary) posts again."""
    body = summarise(detail, state, extra)
    marker = marker_for(state, body)
    return marker, f"{marker}\n\n{body}"


def held_comment(detail: dict, state: str, reason: str) -> tuple[str, str]:
    """The comment that stands in for a write the sync refused.

    A hold is not a state: the card is where it is, and this says which write was not made and why, on
    the issue a human reads. Deduped like every other comment, so a card that sits held all night gets
    one comment per distinct reason rather than one per run.
    """
    task = detail.get("task") or {}
    card = f"`{task.get('id')}`"
    body = (
        f"Held: card {card} is {state}; the Jira status was left alone.\n\n{reason}\n\n"
        "This is the sync refusing to write a status the board does not support, not a failure."
    )
    marker = marker_for("held", body)
    return marker, f"{marker}\n\n{body}"


@dataclass(frozen=True)
class KeyResolution:
    """A card's ticket, or why it has none. `problem` is set only when the card is *ambiguous*: it
    names tickets but not one of them can be chosen, which is a skip with a warning, never a guess."""

    key: str | None = None
    problem: str = ""

    @property
    def ambiguous(self) -> bool:
        return bool(self.problem)


def keys_in(text: str | None, pattern: re.Pattern[str] = JIRA_KEY_RE) -> list[str]:
    """Distinct ticket keys in one blob, in order of appearance."""
    found: list[str] = []
    for match in pattern.finditer(text or ""):
        if match.group(0) not in found:
            found.append(match.group(0))
    return found


def declared_keys(text: str | None) -> list[str]:
    """Tickets the card *declares* — `Task: SCRUM-40` lines — as distinct keys."""
    found: list[str] = []
    for match in TICKET_DECLARATION_RE.finditer(text or ""):
        if match.group(1) not in found:
            found.append(match.group(1))
    return found


def resolve_key(detail: dict) -> KeyResolution:
    """The card's ticket, in three levels of confidence.

    1. **A declaration** — `Task: SCRUM-40` on its own line. A card body that names its ticket has
       said which issue it is about, and the tickets it mentions afterwards ("read SCRUM-40 and
       SCRUM-41", "blocked by SCRUM-18") are context, not claims. Two *different* declarations is
       still a contradiction, and then nothing is written.
    2. **One ticket anywhere in the body**, for bodies written before the convention.
    3. **The comments**, and only when the body names nothing at all.

    Anything that leaves two or more candidates at the level that decides is a skip with a warning —
    never a first-match guess. Reading the body before the comments is what keeps one card from
    stealing another card's issue: comments quote other tickets constantly, which is exactly how a
    card in `ready` used to drive a finished ticket back to *To Do*.
    """
    task = detail.get("task") or {}
    body = task.get("body")

    declarations = declared_keys(body)
    if len(declarations) == 1:
        return KeyResolution(key=declarations[0])
    if len(declarations) > 1:
        return KeyResolution(problem=(
            f"the card declares {len(declarations)} tickets ({', '.join(declarations)}); "
            "which one it belongs to is undecidable, so nothing is written"
        ))

    body_keys = keys_in(body)
    if len(body_keys) == 1:
        return KeyResolution(key=body_keys[0])
    if len(body_keys) > 1:
        return KeyResolution(problem=(
            f"the card body names {len(body_keys)} tickets ({', '.join(body_keys)}) and none of them "
            "is declared as `Task: <ticket>`; nothing is written"
        ))

    comment_keys: list[str] = []
    for comment in detail.get("comments") or []:
        for key in keys_in(comment.get("body")):
            if key not in comment_keys:
                comment_keys.append(key)
    if len(comment_keys) == 1:
        return KeyResolution(key=comment_keys[0])
    if len(comment_keys) > 1:
        return KeyResolution(problem=(
            f"the card body names no ticket and its comments name {len(comment_keys)} "
            f"({', '.join(comment_keys)}); nothing is written"
        ))
    return KeyResolution()


# ---------------------------------------------------------------------------------------------
# The Done gate.
#
# Jira Done is a claim about `main`. The board's `done` is a claim about a worker having finished, and
# the two are not the same thing: on 2026-11-22 card `t_5c1a18ff` was closed done at 00:15 while PR #8
# was still OPEN with zero reviews, and the sync would have written SCRUM-12 Done for code that was not
# on main. There is no transition back out of Done, so the write cannot be corrected afterwards — the
# gate has to refuse rather than guess.
#
# Everything here is pure; the live half (`MergeResolver`) only fetches the inputs: `gh pr list` and
# `git merge-base --is-ancestor <sha> origin/main`.
# ---------------------------------------------------------------------------------------------

# A card names its branch in its body (`Required branch: fix/SCRUM-43_sync-merged-gate`) and the board
# records it in `tasks.branch_name`. Either is enough to ask GitHub about that branch — but a branch
# that was renamed before its first push (every `wt/` name is) does not exist on GitHub, which is why
# the PR-body fallback exists and why a missing branch is not an error.
BRANCH_RE = re.compile(r"\b((?:fix|feat|chore)/[A-Z][A-Z0-9]+-\d+_[A-Za-z0-9._-]+)")

# The one way a card says "no diff was needed": a line of its own naming the commit that already
# satisfies the acceptance. A commit hash mentioned in prose is *not* a declaration — the whole point
# of the third allowed case is that it is deliberate and auditable.
NO_CHANGE_RE = re.compile(r"(?im)^[ \t]*no[- ]change[- ]needed[ \t]*:[ \t]*`?([0-9a-fA-F]{7,40})`?[ \t]*$")


@dataclass(frozen=True)
class PullRequest:
    """The fields of a PR this gate reads. Deliberately small: a state and a commit, nothing to judge."""

    number: int
    state: str               # OPEN | CLOSED | MERGED, upper-cased
    merge_commit: str = ""   # the commit on main; empty until merged
    branch: str = ""
    body: str = ""


@dataclass(frozen=True)
class MergeEvidence:
    """Whether a Done write is allowed, and the one line that says why.

    `kind` is set only on success (`merged-pr`, `no-change-needed`). A refusal carries a token so a run
    log greps cleanly: `pending-merge` for a PR that exists and is not merged, `no-merge-evidence` for a
    card with no evidence at all, `unverifiable` for evidence that cannot be checked against
    origin/main.
    """

    kind: str = ""
    reason: str = ""
    token: str = ""
    pr_number: int | None = None
    commit: str = ""

    @property
    def ok(self) -> bool:
        return bool(self.kind)

    def log_line(self) -> str:
        return f"{self.token or 'no-merge-evidence'}: {self.reason}"


def branch_of(detail: dict, card: dict | None = None) -> str:
    """The branch this card was worked on, or '' — the board's record first, then the card body."""
    recorded = str((detail.get("task") or {}).get("branch_name") or (card or {}).get("branch_name") or "").strip()
    if recorded:
        return recorded
    match = BRANCH_RE.search(str((detail.get("task") or {}).get("body") or ""))
    return match.group(1) if match else ""


def declares_card(pr: PullRequest, card_id: str) -> bool:
    """A PR claims a card by *opening* with `Task: <card-id>`; a mention further down does not count."""
    lines = (pr.body or "").strip().splitlines()
    return bool(lines) and lines[0].strip() == f"Task: {card_id}"


def resolve_pull_requests(card_id: str, branch: str, prs: Iterable[PullRequest]) -> list[PullRequest]:
    """Every PR that could be this card's, newest first: branch matches ahead of body matches.

    More than one is normal — a card whose first PR was closed and re-opened has several — so the gate
    reads them all and prefers merged evidence instead of picking one and hoping.
    """
    by_branch = sorted((pr for pr in prs if branch and pr.branch == branch), key=lambda p: p.number, reverse=True)
    by_body = sorted((pr for pr in prs if declares_card(pr, card_id)), key=lambda p: p.number, reverse=True)
    ordered: list[PullRequest] = []
    for pr in by_branch + by_body:
        if all(seen.number != pr.number for seen in ordered):
            ordered.append(pr)
    return ordered


def declared_no_change(detail: dict) -> tuple[str, str]:
    """(commit, problem) from the card's comments: the commit a card declares already satisfies it.

    Two different declarations are a contradiction, not a choice: the same rule as `resolve_key` — an
    ambiguous claim that silently writes is worse than no write.
    """
    found: list[str] = []
    for comment in detail.get("comments") or []:
        for match in NO_CHANGE_RE.finditer(str(comment.get("body") or "")):
            sha = match.group(1).lower()
            if sha not in found:
                found.append(sha)
    if len(found) == 1:
        return found[0], ""
    if len(found) > 1:
        return "", (
            f"the card declares {len(found)} different no-change-needed commits "
            f"({', '.join(found)}); which one it means is undecidable, so nothing is written"
        )
    return "", ""


def evaluate_merge_gate(card_id: str, detail: dict, prs: Iterable[PullRequest],
                        on_main: Callable[[str], bool], branch: str = "") -> MergeEvidence:
    """May this done card be written as Done? Pure — `on_main` is injected, so the test is offline."""
    candidates = resolve_pull_requests(card_id, branch, prs)

    merged = [pr for pr in candidates if pr.state == "MERGED" and pr.merge_commit]
    for pr in merged:
        if on_main(pr.merge_commit):
            return MergeEvidence(
                kind="merged-pr",
                pr_number=pr.number,
                commit=pr.merge_commit,
                reason=f"PR #{pr.number} is MERGED at {pr.merge_commit[:9]}, reachable from origin/main",
            )
    if merged:
        pr = merged[0]
        return MergeEvidence(
            token="unverifiable",
            pr_number=pr.number,
            commit=pr.merge_commit,
            reason=(f"PR #{pr.number} is MERGED at {pr.merge_commit[:9]}, but that commit is not reachable "
                    "from origin/main; fetch it and re-run"),
        )

    open_prs = [pr for pr in candidates if pr.state == "OPEN"]
    if open_prs:
        pr = open_prs[0]
        return MergeEvidence(
            token="pending-merge", pr_number=pr.number,
            reason=f"PR #{pr.number} is still OPEN, so there is no merge to record",
        )

    closed = [pr for pr in candidates if pr.state == "CLOSED"]
    if closed:
        pr = closed[0]
        return MergeEvidence(
            token="pending-merge", pr_number=pr.number,
            reason=f"PR #{pr.number} was CLOSED without being merged, so there is no merge to record",
        )

    commit, problem = declared_no_change(detail)
    if problem:
        return MergeEvidence(token="no-merge-evidence", reason=problem)
    if commit:
        if on_main(commit):
            return MergeEvidence(
                kind="no-change-needed", commit=commit,
                reason=f"no-change-needed: the acceptance was already satisfied by {commit[:9]} on origin/main",
            )
        return MergeEvidence(
            token="unverifiable", commit=commit,
            reason=(f"the card declares no-change-needed: {commit[:9]}, but that commit is not reachable "
                    "from origin/main"),
        )

    where = f"branch {branch!r}" if branch else "no branch recorded"
    return MergeEvidence(
        token="no-merge-evidence",
        reason=(f"no pull request resolves to this card ({where}, or a body opening 'Task: {card_id}') and "
                "no 'no-change-needed: <commit>' line in its comments"),
    )


def backwards_reason(current: str | None, target: str) -> str:
    """Why this transition must not be written, or '' when it may.

    `running -> review -> running` is the normal rework path, and a `ready` card whose issue is still
    *In Progress* is what that looks like from the ledger's side. Moving it back to *To Do* makes Jira
    claim work was not started after it was started; moving a *Done* issue back is a lie about a merge
    that happened, and there is no way to undo either.
    """
    if not current:
        return ""
    now = STATUS_RANK.get(current)
    want = STATUS_RANK.get(target)
    if now is None or want is None or want >= now:
        return ""
    return (f"status-not-moved-backwards: Jira says {current} and the card maps to {target}; "
            "the status is left where it is")


def load_identity_map(path: str = IDENTITY_MAP_PATH) -> dict[str, str | None]:
    """profile -> Jira account id. A null value means "known to exist, id not yet recorded"."""
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except FileNotFoundError:
        return {}
    profiles = raw.get("profiles") or {}
    return {name: (entry or {}).get("account_id") for name, entry in profiles.items()}


@dataclass
class JiraState:
    status: str | None
    assignee_id: str | None
    comments: str  # every existing comment body, concatenated: only used for marker lookup


def build_plan(card: dict, detail: dict, state: JiraState, identities: dict[str, str | None],
               key: str, evidence: MergeEvidence | None = None) -> Plan:
    """What this card needs, decided without touching Jira. Pure: no network, no clock.

    `evidence` is the Done gate's verdict for a *done* card and is ignored for every other state. It is
    required in practice: `None` is read as "nothing proves the work reached main", so a caller that
    forgets to resolve it gets a refusal instead of an unearned Done.
    """
    plan = Plan(card_id=str(card.get("id")), card_state=str(card.get("status")), key=key)
    task = detail.get("task") or {}
    card_state = plan.card_state

    profile = task.get("assignee") or card.get("assignee")
    if profile:
        account = identities.get(profile)
        if account:
            if state.assignee_id != account:
                plan.steps.append(Step(STEP_ASSIGN, account, note=f"{profile} <- {account}"))
        else:
            plan.warnings.append(
                f"no Jira account id for profile '{profile}' — add it to {os.path.basename(IDENTITY_MAP_PATH)} "
                "(see docs/DELIVERY-LOOP.md §6); the assignee is left alone"
            )

    target = TARGET_STATUS.get(card_state)
    held = ""
    if target is None:
        if card_state not in STATUS_HELD:
            plan.warnings.append(f"card state '{card_state}' has no Jira mapping; status left alone")
    elif state.status != target:
        if card_state == "done":
            verdict = evidence or MergeEvidence(
                token="no-merge-evidence",
                reason="no merge evidence was resolved for this card, and a Done write needs it",
            )
            if not verdict.ok:
                held = verdict.log_line()
        if not held:
            held = backwards_reason(state.status, target)
        if not held:
            plan.steps.append(Step(STEP_TRANSITION, target, note=f"{state.status or '?'} -> {target}"))

    if held:
        plan.holds.append(held)
        marker, body = held_comment(detail, card_state, held)
        if marker not in state.comments:
            plan.steps.append(Step(STEP_COMMENT, body, note=marker))
    elif card_state in COMMENT_STATES:
        extra = evidence.reason if (card_state == "done" and evidence and evidence.ok) else ""
        marker, body = comment_for(detail, card_state, extra)
        if marker not in state.comments:
            plan.steps.append(Step(STEP_COMMENT, body, note=marker))

    return plan


class JiraClient:
    """The two reads and three writes the sync needs, over the MCP proxy."""

    def __init__(self, call: Callable[[str, dict], Any]):
        self._call = call

    def read(self, key: str) -> JiraState:
        issue = self._call("jira_get_issue", {
            "issue_key": key,
            "fields": "status,assignee",
            "include": "comments",
            "comment_limit": 100,
        })
        if not isinstance(issue, dict) or issue.get("_error"):
            raise StepFailed(f"cannot read {key}: {str(issue)[:200]}")
        status = (issue.get("status") or {}).get("name")
        assignee = (issue.get("assignee") or {})
        account = assignee.get("account_id") or assignee.get("accountId") if isinstance(assignee, dict) else None
        return JiraState(status=status, assignee_id=account, comments=json.dumps(issue.get("comments") or issue.get("comment") or ""))

    def set_assignee(self, key: str, account: str) -> None:
        out = self._call("jira_update_issue", {"issue_key": key, "fields": json.dumps({"assignee": account})})
        if _failed(out):
            raise StepFailed(f"assignee write rejected: {str(out)[:300]}")

    def transition(self, key: str, target: str) -> None:
        available = self._call("jira_get_transitions", {"issue_key": key})
        transitions = available if isinstance(available, list) else (available or {}).get("transitions") or []
        match = None
        for item in transitions:
            to_status = item.get("to_status") or (item.get("to") or {}).get("name") or item.get("name")
            if to_status == target:
                match = item
                break
        if match is None:
            ids = [str((t.get("to") or {}).get("name") or t.get("to_status")) for t in transitions]
            raise StepFailed(f"no transition to '{target}' (available: {', '.join(ids) or 'none'})")
        out = self._call("jira_transition_issue", {"issue_key": key, "transition_id": str(match["id"])})
        if _failed(out):
            raise StepFailed(f"transition rejected: {str(out)[:300]}")

    def comment(self, key: str, body: str) -> None:
        out = self._call("jira_add_comment", {"issue_key": key, "body": body})
        if _failed(out):
            raise StepFailed(f"comment rejected: {str(out)[:300]}")


def _failed(out: Any) -> bool:
    if isinstance(out, dict) and out.get("_error"):
        return True
    blob = json.dumps(out)[:2000] if not isinstance(out, str) else out[:2000]
    return '"operations_failed"' in blob and '"operations_failed": []' not in blob


def apply_plan(client: JiraClient, plan: Plan, log: Callable[[str], None] = print) -> bool:
    """Run the plan and read every write back. Returns True only if Jira agrees with all of it."""
    ok = True
    for step in plan.steps:
        if step.kind == STEP_ASSIGN:
            client.set_assignee(plan.key, step.value)
            after = client.read(plan.key)
            if after.assignee_id != step.value:
                log(f"    FAIL assignee read-back: Jira says {after.assignee_id}, wanted {step.value}")
                ok = False
            else:
                log(f"    ok   assignee {step.note}")
        elif step.kind == STEP_TRANSITION:
            client.transition(plan.key, step.value)
            after = client.read(plan.key)
            if after.status != step.value:
                log(f"    FAIL status read-back: Jira says {after.status}, wanted {step.value}")
                ok = False
            else:
                log(f"    ok   status {step.note}")
        elif step.kind == STEP_COMMENT:
            client.comment(plan.key, step.value)
            after = client.read(plan.key)
            if step.note not in after.comments:
                log(f"    FAIL comment read-back: {step.note} is not on the issue")
                ok = False
            else:
                log(f"    ok   comment {step.note}")
    return ok


def gh_pull_requests(repo: str = REPO_ROOT) -> list[PullRequest]:
    """Every PR in the repo, in one call — the gate needs all of them to find a card's branch."""
    proc = subprocess.run(
        ["gh", "pr", "list", "--state", "all", "--limit", "400",
         "--json", "number,state,mergeCommit,headRefName,body"],
        cwd=repo, capture_output=True, text=True, timeout=180,
    )
    if proc.returncode != 0:
        raise StepFailed(f"gh pr list failed: {(proc.stderr or proc.stdout).strip()[:300]}")
    try:
        raw = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise StepFailed(f"gh pr list returned unparsable JSON: {exc}") from exc
    prs: list[PullRequest] = []
    for item in raw:
        merge = item.get("mergeCommit") or {}
        prs.append(PullRequest(
            number=int(item.get("number") or 0),
            state=str(item.get("state") or "").upper(),
            merge_commit=str(merge.get("oid") or ""),
            branch=str(item.get("headRefName") or ""),
            body=str(item.get("body") or ""),
        ))
    return prs


def fetch_origin_main(repo: str = REPO_ROOT) -> None:
    """A merge commit can only be checked against a ref that has been fetched.

    Squash-merged PRs are the usual case here, and their `mergeCommit` is the squash commit on main;
    a stale local `origin/main` would read a real merge as unreachable and refuse a Done it should
    write. One fetch per run, and a failure is a warning rather than fatal: the gate then refuses,
    which is the safe direction.
    """
    proc = subprocess.run(["git", "-C", repo, "fetch", "--quiet", "origin", "main"],
                          capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise StepFailed(f"git fetch origin main failed: {(proc.stderr or proc.stdout).strip()[:300]}")


def on_origin_main(sha: str, repo: str = REPO_ROOT) -> bool:
    """Is this commit an ancestor of origin/main? No ref, no commit, no evidence."""
    if not sha:
        return False
    proc = subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", sha, "origin/main"],
                          capture_output=True, text=True, timeout=60)
    return proc.returncode == 0


class MergeResolver:
    """The live half of the Done gate: fetch the inputs once, then answer per card.

    Every decision is `evaluate_merge_gate`; this class only runs `gh`, `git fetch` and
    `git merge-base`, all of which are injected in the tests and never run there.
    """

    def __init__(self, repo: str = REPO_ROOT, log: Callable[[str], None] = print,
                 prs: list[PullRequest] | None = None, on_main: Callable[[str], bool] | None = None):
        self.repo = repo
        self.log = log
        self._prs = prs
        self._on_main = on_main or (lambda sha: on_origin_main(sha, repo))
        self._fetched = False

    def pull_requests(self) -> list[PullRequest]:
        if self._prs is None:
            self._prs = gh_pull_requests(self.repo)
        return self._prs

    def _refresh(self) -> None:
        if self._fetched:
            return
        self._fetched = True
        try:
            fetch_origin_main(self.repo)
        except StepFailed as exc:
            self.log(f"  WARNING {exc} — merges may read as unreachable, and a Done write will be refused")

    def __call__(self, card: dict, detail: dict) -> MergeEvidence:
        self._refresh()
        card_id = str(card.get("id"))
        return evaluate_merge_gate(
            card_id, detail, self.pull_requests(), self._on_main, branch=branch_of(detail, card),
        )


def kanban(board: str, *args: str) -> str:
    proc = subprocess.run(["hermes", "kanban", "--board", board, *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise StepFailed(f"kanban {' '.join(args)} failed: {proc.stderr.strip()[:400]}")
    return proc.stdout


# ---------------------------------------------------------------------------------------------
# Reading the board.
#
# The `hermes kanban` CLI refuses board access from inside a worker run ("delegate child contexts
# cannot mutate Kanban tasks or boards"), which is exactly where a sync is likely to be invoked from.
# So the board is read straight out of its SQLite file: read-only SELECTs against the schema the
# kernel owns, no subprocess, no mutation, and the same rows `hermes kanban show --json` reports.
# ---------------------------------------------------------------------------------------------

def board_db(board: str) -> str:
    candidates = [
        os.path.expanduser(f"~/.hermes/kanban/boards/{board}/kanban.db"),
        os.path.expanduser("~/.hermes/kanban.db"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    raise StepFailed(f"no board database for '{board}' (looked in {', '.join(candidates)})")


def _connect(board: str):
    import sqlite3

    conn = sqlite3.connect(board_db(board), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def list_cards(board: str) -> list[dict]:
    conn = _connect(board)
    try:
        rows = conn.execute("SELECT id, status, assignee, branch_name FROM tasks ORDER BY id").fetchall()
    finally:
        conn.close()
    return [{"id": row["id"], "status": row["status"], "assignee": row["assignee"],
             "branch_name": row["branch_name"]} for row in rows]


def card_detail(board: str, card_id: str) -> dict:
    conn = _connect(board)
    try:
        row = conn.execute(
            "SELECT id, status, assignee, body, branch_name, last_failure_error FROM tasks WHERE id = ?",
            (card_id,),
        ).fetchone()
        if row is None:
            raise StepFailed(f"card {card_id} is not on board '{board}'")
        run = conn.execute(
            "SELECT status, outcome, summary FROM task_runs WHERE task_id = ? "
            "ORDER BY started_at DESC, id DESC LIMIT 1",
            (card_id,),
        ).fetchone()
        comments = conn.execute(
            "SELECT author, body FROM task_comments WHERE task_id = ? ORDER BY created_at, id", (card_id,)
        ).fetchall()
        blocked = conn.execute(
            "SELECT payload FROM task_events WHERE task_id = ? AND kind = 'blocked' ORDER BY created_at DESC, id DESC LIMIT 1",
            (card_id,),
        ).fetchone()
    finally:
        conn.close()
    block_reason = ""
    if blocked and blocked["payload"]:
        try:
            block_reason = (json.loads(blocked["payload"]) or {}).get("reason") or ""
        except json.JSONDecodeError:
            block_reason = ""
    return {
        "task": {
            "id": row["id"],
            "status": row["status"],
            "assignee": row["assignee"],
            "body": row["body"],
            "branch_name": row["branch_name"],
            "last_failure_error": row["last_failure_error"],
            "block_reason": block_reason,
        },
        "run": {
            "status": run["status"] if run else None,
            "outcome": run["outcome"] if run else None,
            "summary": run["summary"] if run else "",
        },
        "comments": [{"author": c["author"], "body": c["body"]} for c in comments],
    }


def mcp_call(tool: str, args: dict[str, Any]) -> Any:
    env = dict(os.environ)
    env.update({
        "USER_ID": MCP_USER,
        "SERVER_TYPE": "jira",
        "REQUEST_METHOD": "tools/call",
        "TOOL_NAME": tool,
        "TOOL_ARGS": json.dumps(args),
        "REQUEST_TIMEOUT_MS": "60000",
        "BASE_URL": "http://127.0.0.1:3000",
    })
    proc = subprocess.run(["node", MCP_CLI], cwd=os.path.dirname(MCP_CLI), env=env,
                          capture_output=True, text=True, timeout=120)
    try:
        outer = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"_error": (proc.stdout or proc.stderr)[-300:]}
    result = outer.get("result") or {}
    if result.get("isError"):
        return {"_error": (result.get("content") or [{}])[0].get("text", "")[:300]}
    structured = result.get("structuredContent") or {}
    inner = structured.get("result")
    if isinstance(inner, str):
        try:
            return json.loads(inner)
        except json.JSONDecodeError:
            return {"_text": inner[:300]}
    return structured


def evidence_for(card_id: str, card_state: str, card: dict, detail: dict,
                 evidence_of: Callable[[dict, dict], MergeEvidence] | None) -> MergeEvidence | None:
    """The Done gate's verdict, for a done card only — nothing else maps to a status that needs proof."""
    if card_state != "done":
        return None
    if evidence_of is None:
        return MergeEvidence(
            token="no-merge-evidence",
            reason="the sync has no merge resolver in this invocation, so nothing proves the work reached main",
        )
    try:
        return evidence_of(card, detail)
    except StepFailed as exc:
        return MergeEvidence(token="no-merge-evidence", reason=f"cannot resolve merge evidence: {exc}")


def run(apply: bool, strict: bool, cards: Iterable[dict], detail_of: Callable[[str], dict],
        client: JiraClient, identities: dict[str, str | None], log: Callable[[str], None] = print,
        evidence_of: Callable[[dict, dict], MergeEvidence] | None = None) -> int:
    """Sync every card and return the process exit code.

    Keys are resolved for the whole board before anything is written, because ambiguity is a
    *board-level* property: one card's body and another card's comment can point at the same issue,
    and neither of them should get to move it. A card that resolves to an issue another card already
    claims is skipped with a warning; the fix is a card body that names its own ticket.

    `evidence_of` resolves the Done gate for a done card. With none supplied, a done card cannot write
    Done at all: the gate fails closed, because the alternative is an unearned Done that cannot be
    undone.
    """
    actions = 0
    failures = 0
    warnings = 0
    cards = list(cards)  # two passes: resolve every key, then write

    details: dict[str, dict] = {}
    resolutions: dict[str, KeyResolution] = {}
    claims: dict[str, list[str]] = {}
    for card in cards:
        card_id = str(card.get("id"))
        if str(card.get("status")) == ARCHIVED:
            continue  # an archived card is out of the flow: it neither claims an issue nor writes one
        try:
            details[card_id] = detail_of(card_id)
        except StepFailed as exc:
            log(f"  {card_id} {str(card.get('status')):<9} — cannot read the card: {exc}")
            failures += 1
            continue
        resolution = resolve_key(details[card_id])
        resolutions[card_id] = resolution
        if resolution.ambiguous:
            log(f"  {card_id} {str(card.get('status')):<9} — AMBIGUOUS {resolution.problem}")
            warnings += 1
        elif resolution.key:
            claims.setdefault(resolution.key, []).append(card_id)

    contested: dict[str, list[str]] = {key: ids for key, ids in claims.items() if len(ids) > 1}
    for key in sorted(contested):
        ids = contested[key]
        log(f"  {key} is claimed by {len(ids)} cards ({', '.join(ids)}); none of them writes it")
        warnings += len(ids)

    for card in cards:
        card_id = str(card.get("id"))
        card_state = str(card.get("status"))
        if card_state == ARCHIVED:
            log(f"  {card_id} {card_state:<9} — archived, skipped")
            continue
        detail = details.get(card_id)
        if detail is None:
            continue  # unreadable card, already counted
        resolution = resolutions[card_id]
        if resolution.ambiguous:
            continue  # already logged and counted
        key = resolution.key
        if not key:
            log(f"  {card_id} {card_state:<9} — no Jira key on the card, skipped")
            continue
        if key in contested:
            continue  # already logged and counted

        try:
            state = client.read(key)
        except StepFailed as exc:
            log(f"  {card_id} {card_state:<9} {key} — {exc}")
            failures += 1
            continue

        plan = build_plan(card, detail, state, identities, key, evidence=evidence_for(card_id, card_state, card, detail, evidence_of))
        for hold in plan.holds:
            log(f"  {card_id} {card_state:<9} {key} — {hold}")
        for warning in plan.warnings:
            log(f"  {card_id} {card_state:<9} {key} — WARNING {warning}")
            warnings += 1

        if not plan.actionable:
            log(f"  {card_id} {card_state:<9} {key} — in step ({state.status})")
            continue

        summary = ", ".join(f"{step.kind} {step.note}" for step in plan.steps)
        log(f"  {card_id} {card_state:<9} {key} — {summary}")
        actions += len(plan.steps)
        if not apply:
            continue
        try:
            if not apply_plan(client, plan, log):
                failures += 1
        except StepFailed as exc:
            log(f"    FAIL {exc}")
            failures += 1

    verb = "applied" if apply else "would be applied"
    log(f"\n{actions} step(s) {verb}, {failures} failure(s), {warnings} warning(s)")
    if failures:
        return 1
    if strict and warnings:
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Keep Jira in step with the Kanban board.")
    parser.add_argument("--apply", action="store_true", help="write to Jira (default: read only)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and write nothing")
    parser.add_argument("--strict", action="store_true", help="exit non-zero on warnings too")
    parser.add_argument("--board", default=BOARD, help="Kanban board slug (default: health)")
    parser.add_argument(
        "--card", action="append", default=[], metavar="CARD_ID",
        help="sync only this card (repeatable). Use it to verify the gate or repair one card without "
             "touching the Jira mapping of every other card on the board",
    )
    args = parser.parse_args(argv)

    apply = args.apply and not args.dry_run
    board = args.board

    identities = load_identity_map()
    if not identities:
        print(f"WARNING: no identity map at {IDENTITY_MAP_PATH}; assignees will not be synced", file=sys.stderr)

    client = JiraClient(mcp_call)
    try:
        cards = list_cards(board)
    except StepFailed as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    if args.card:
        wanted = {card_id.strip() for entry in args.card for card_id in entry.split(",") if card_id.strip()}
        missing = wanted - {str(c.get("id")) for c in cards}
        if missing:
            print(f"FAIL: not on board '{board}': {', '.join(sorted(missing))}", file=sys.stderr)
            return 2
        cards = [c for c in cards if str(c.get("id")) in wanted]

    evidence_of = MergeResolver(log=print) if any(str(c.get("status")) == "done" for c in cards) else None

    return run(
        apply=apply,
        strict=args.strict,
        cards=cards,
        detail_of=lambda card_id: card_detail(board, card_id),
        client=client,
        identities=identities,
        evidence_of=evidence_of,
    )


if __name__ == "__main__":
    sys.exit(main())
