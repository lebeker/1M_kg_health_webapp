#!/usr/bin/env python3
"""Keep Jira in step with the Kanban queue — the card moves, Jira moves.

Jira is the ledger a human reads; Kanban is what a bot claims. This is the seam
between them: it reads card state from the board and applies it to the matching
Jira issue (transition, comment), so nobody has to update Jira by hand and Jira
never drifts from what actually happened.

    python3 scripts/jira-sync.py --dry-run     # show what would change
    python3 scripts/jira-sync.py --apply       # do it (cron-safe, idempotent)

Card -> Jira issue is found by the `SCRUM-<n>` key in the card body or in any of
its comments, so the link lives on the card itself, not in a side table.

State mapping (this project has a three-column workflow: To Do / In Progress / Done):
    ready, todo, scheduled  -> To Do           (no-op if already there)
    running                 -> In Progress     + comment "worker <profile> claimed it"
    review                  -> In Progress     + comment with the PR link from latest_summary
    blocked                 -> unchanged       + comment with the block reason
    done                    -> Done            + comment with the closing summary

Every comment carries a `[sync:<card-state>]` marker and is skipped if the same
marker already sits on the issue, so re-running never spams the ticket.
"""
import argparse
import json
import os
import re
import subprocess
import sys

BOARD = os.environ.get("KANBAN_BOARD", "health")
MCP_CLI = os.environ.get("MCP_PROXY_CLI", "/Users/denistatarenko/Work/other/MCP/query-mcp.js")
MCP_USER = os.environ.get("MCP_USER", "mex")
JIRA_KEY_RE = re.compile(r"\bSCRUM-\d+\b")
MARKER = "[sync:{state}]"

TARGET_STATUS = {
    "ready": "To Do",
    "todo": "To Do",
    "scheduled": "To Do",
    "running": "In Progress",
    "review": "In Progress",
    "done": "Done",
}


def kanban(*args):
    p = subprocess.run(["hermes", "kanban", "--board", BOARD, *args],
                       capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(f"kanban {' '.join(args)} failed: {p.stderr.strip()[:400]}")
    return p.stdout


def cards():
    out = kanban("ls", "--json")
    return json.loads(out)


def card_detail(card_id):
    return json.loads(kanban("show", card_id, "--json"))


def jira_key(detail):
    task = detail.get("task") or {}
    for blob in [task.get("body") or ""] + [c.get("body") or "" for c in detail.get("comments") or []]:
        m = JIRA_KEY_RE.search(blob)
        if m:
            return m.group(0)
    return None


def jira(tool, args):
    env = dict(os.environ)
    env.update({"USER_ID": MCP_USER, "SERVER_TYPE": "jira", "REQUEST_METHOD": "tools/call",
                "TOOL_NAME": tool, "TOOL_ARGS": json.dumps(args),
                "REQUEST_TIMEOUT_MS": "60000", "BASE_URL": "http://127.0.0.1:3000"})
    p = subprocess.run(["node", MCP_CLI], cwd=os.path.dirname(MCP_CLI), env=env,
                       capture_output=True, text=True, timeout=90)
    try:
        outer = json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"_error": (p.stdout or p.stderr)[-300:]}
    result = outer.get("result") or {}
    if result.get("isError"):
        return {"_error": (result.get("content") or [{}])[0].get("text", "")[:300]}
    sc = result.get("structuredContent") or {}
    inner = sc.get("result")
    if isinstance(inner, str):
        try:
            return json.loads(inner)
        except json.JSONDecodeError:
            return {"_text": inner[:300]}
    return sc


def current_status(key):
    got = jira("jira_get_issue", {"issue_key": key, "fields": "status,summary"})
    if not isinstance(got, dict):
        return None
    status = got.get("status") or {}
    return status.get("name") if isinstance(status, dict) else None


def transition(key, target):
    avail = jira("jira_get_transitions", {"issue_key": key})
    if not isinstance(avail, list):
        return False, f"no transitions readable: {str(avail)[:120]}"
    for t in avail:
        if t.get("to_status") == target or (t.get("to") or {}).get("name") == target:
            out = jira("jira_transition_issue", {"issue_key": key, "transition_id": str(t["id"])})
            return ("error" not in json.dumps(out)[:40]), str(out)[:120]
    return False, f"no transition to '{target}'"


def already_synced(key, state):
    got = jira("jira_get_issue", {"issue_key": key, "fields": "comment",
                                  "include": "comments", "comment_limit": 50})
    blob = json.dumps(got)
    return MARKER.format(state=state) in blob


def summarise(detail, state):
    latest = (detail.get("latest_summary") or "").strip()
    task = detail.get("task") or {}
    head = f"{MARKER.format(state=state)} Kanban card `{task.get('id')}` moved to **{state}**"
    if state == "running":
        head += f", worker `{task.get('assignee')}`"
    if latest:
        head += "\n\n" + latest[:1200]
    return head


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not (args.apply or args.dry_run):
        ap.error("choose --dry-run or --apply")

    actions = 0
    for card in cards():
        detail = card_detail(card["id"])
        key = jira_key(detail)
        state = card["status"]
        if not key:
            print(f"  {card['id']} {state:<9} — no Jira key on the card, skipped")
            continue
        target = TARGET_STATUS.get(state)
        if not target:
            print(f"  {card['id']} {state:<9} {key} — state has no mapping, left alone")
            continue
        now = current_status(key)
        verb = "no-op" if now == target else f"{now} -> {target}"
        print(f"  {card['id']} {state:<9} {key}  {verb}")
        if now == target or args.dry_run:
            continue
        ok, msg = transition(key, target)
        print(f"      transition {'ok' if ok else 'FAILED'}: {msg}")
        if ok and state in ("running", "review", "blocked", "done") and not already_synced(key, state):
            jira("jira_add_comment", {"issue_key": key, "body": summarise(detail, state)})
            print("      comment posted")
        actions += 1
    print(f"{actions} transition(s) {'applied' if args.apply else 'would be applied'}")


if __name__ == "__main__":
    main()
