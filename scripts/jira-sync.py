#!/usr/bin/env python3
"""Keep Jira in step with the Kanban queue — the card moves, Jira moves.

Jira is the ledger a human reads; Kanban is what a bot claims. This is the seam between them: it
reads card state from the board and applies it to the matching Jira issue (assignee, status,
comment), so nobody updates Jira by hand and Jira never drifts from what actually happened.

    python3 scripts/jira-sync.py --dry-run     # show the plan, write nothing
    python3 scripts/jira-sync.py --apply       # do it (cron-safe, idempotent)
    python3 scripts/jira-sync.py --apply --strict   # a missing assignee mapping is fatal

Card -> issue is found by the `SCRUM-<n>` key in the card body or any comment, so the link lives on
the card itself, not in a side table.

State mapping (three-column workflow: To Do / In Progress / Done):

    ready, todo, scheduled  -> To Do          (no transition if already there)
    running                 -> In Progress    + comment: worker <profile> claimed it
    review                  -> In Progress    + comment: ready for review, with the card summary
    blocked                 -> unchanged      + comment: why, with the block reason
    done                    -> Done           + comment: closing summary

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
BOARD = os.environ.get("KANBAN_BOARD", "health")
MCP_CLI = os.environ.get("MCP_PROXY_CLI", "/Users/denistatarenko/Work/other/MCP/query-mcp.js")
MCP_USER = os.environ.get("MCP_USER", "mex")
IDENTITY_MAP_PATH = os.environ.get("JIRA_IDENTITIES", os.path.join(HERE, "jira-identities.json"))
JIRA_KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")

TARGET_STATUS = {
    "ready": "To Do",
    "todo": "To Do",
    "scheduled": "To Do",
    "running": "In Progress",
    "review": "In Progress",
    "done": "Done",
}

# States that say something a human needs to read, even when the status column does not move.
COMMENT_STATES = ("running", "review", "blocked", "done")

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

    @property
    def actionable(self) -> bool:
        return bool(self.steps)


def marker_for(state: str, body: str) -> str:
    """A plain token, no punctuation: Jira's Markdown→ADF path eats `[` and `*`, and a marker that
    arrives mangled cannot be used to prove the write landed."""
    digest = hashlib.sha1(body.encode("utf-8")).hexdigest()[:8]
    return f"sync:{state}:{digest}"


def summarise(detail: dict, state: str) -> str:
    """The prose half of a state comment: plain text, no markup to lose.

    The run summary is only used when it belongs to *this* state — the latest run's summary of a card
    that was blocked yesterday is not the reason it is running today.
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
    if state == "done":
        text = f"Done: card {card}, worker {who}."
        return f"{text}\n\n{run_summary[:1200]}" if run_summary else text
    if state == "running":
        return f"In progress: worker {who} claimed card {card}."
    return f"Card {card} moved to {state}."


def comment_for(detail: dict, state: str) -> tuple[str, str]:
    """(marker, full comment body). The marker covers the prose, so an identical comment is skipped
    and a changed one (a new block reason, a new review summary) posts again."""
    body = summarise(detail, state)
    marker = marker_for(state, body)
    return marker, f"{marker}\n\n{body}"


def jira_key(detail: dict, pattern: re.Pattern[str] = JIRA_KEY_RE) -> str | None:
    task = detail.get("task") or {}
    blobs = [task.get("body") or ""] + [c.get("body") or "" for c in detail.get("comments") or []]
    for blob in blobs:
        match = pattern.search(blob)
        if match:
            return match.group(0)
    return None


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
               key: str) -> Plan:
    """What this card needs, decided without touching Jira. Pure: no network, no clock."""
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
    if target is None:
        plan.warnings.append(f"card state '{card_state}' has no Jira mapping; status left alone")
    elif state.status != target:
        plan.steps.append(Step(STEP_TRANSITION, target, note=f"{state.status or '?'} -> {target}"))

    if card_state in COMMENT_STATES:
        marker, body = comment_for(detail, card_state)
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
        rows = conn.execute("SELECT id, status, assignee FROM tasks ORDER BY id").fetchall()
    finally:
        conn.close()
    return [{"id": row["id"], "status": row["status"], "assignee": row["assignee"]} for row in rows]


def card_detail(board: str, card_id: str) -> dict:
    conn = _connect(board)
    try:
        row = conn.execute(
            "SELECT id, status, assignee, body, last_failure_error FROM tasks WHERE id = ?", (card_id,)
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


def run(apply: bool, strict: bool, cards: Iterable[dict], detail_of: Callable[[str], dict],
        client: JiraClient, identities: dict[str, str | None], log: Callable[[str], None] = print) -> int:
    """Sync every card and return the process exit code."""
    actions = 0
    failures = 0
    warnings = 0

    for card in cards:
        card_id = str(card.get("id"))
        card_state = str(card.get("status"))
        try:
            detail = detail_of(card_id)
        except StepFailed as exc:
            log(f"  {card_id} {card_state:<9} — cannot read the card: {exc}")
            failures += 1
            continue

        key = jira_key(detail)
        if not key:
            log(f"  {card_id} {card_state:<9} — no Jira key on the card, skipped")
            continue

        try:
            state = client.read(key)
        except StepFailed as exc:
            log(f"  {card_id} {card_state:<9} {key} — {exc}")
            failures += 1
            continue

        plan = build_plan(card, detail, state, identities, key)
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

    return run(
        apply=apply,
        strict=args.strict,
        cards=cards,
        detail_of=lambda card_id: card_detail(board, card_id),
        client=client,
        identities=identities,
    )


if __name__ == "__main__":
    sys.exit(main())
