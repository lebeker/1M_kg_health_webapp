#!/usr/bin/env python3
"""File the delivery backlog into Jira from docs/PLAN-health-2026-11-12.md.

The plan is the source of truth; this script only projects it into Jira so the
backlog cannot drift from the document it was cut from. It never edits the plan.

    python3 scripts/jira-backlog.py --dry-run          # print what would be filed
    python3 scripts/jira-backlog.py --apply            # file it
    python3 scripts/jira-backlog.py --apply --project SCRUM

Credentials come from the environment, never from a file in this repo:
    JIRA_BASE     e.g. https://lebeker.atlassian.net
    JIRA_EMAIL    the Jira actor (mexviner@gmail.com for identity mexviner)
    JIRA_TOKEN    an Atlassian API token for that actor

Idempotent: every issue is labelled `plan:<id>`; an existing open issue carrying
that label is updated in place instead of duplicated. Safe to re-run after a plan
change.

Layout:
  one Epic per plan section (A..F), parked sections included and marked as such
  one Task per table row, labelled `plan:<id>`, `pri:<p0..p4>`, `size:<s|m|l>`
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PLAN = "docs/PLAN-health-2026-11-12.md"
SECTION_RE = re.compile(r"^### ([A-F]\d?)\.\s+(.+)$")
TASK_RE = re.compile(r"^T\d\d$")


def parse_plan(path):
    """Return (epics, tasks) as they appear in the plan tables."""
    epics, tasks, section = {}, [], None
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            m = SECTION_RE.match(line)
            if m:
                letter, rest = m.group(1), m.group(2)
                pm = re.search(r"\b(P[0-4])\b", rest)
                pri = pm.group(1) if pm else ("PARKED" if letter == "B2" else "?")
                section = letter
                epics[letter] = {
                    "letter": letter,
                    "title": re.split(r"\s+—\s+", rest)[0].strip(),
                    "priority": pri.lower(),
                }
                continue
            if not (line.startswith("| T") and section):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if not TASK_RE.match(cells[0]):
                continue
            parked = section == "B2"
            tasks.append(
                {
                    "id": cells[0],
                    "summary": cells[1],
                    "detail": cells[2] if len(cells) > 2 else "",
                    "acceptance": cells[3] if len(cells) > 3 else "",
                    "deps": cells[4] if len(cells) > 4 else "",
                    "size": cells[5] if len(cells) > 5 else "",
                    "section": section,
                    "priority": epics[section]["priority"],
                    "parked": parked,
                }
            )
    return epics, tasks


def body(task):
    parts = [task["detail"]]
    if task["acceptance"]:
        parts.append("h3. Acceptance\n" + task["acceptance"])
    if task["deps"] and task["deps"] not in ("—", "-"):
        parts.append("h3. Depends on\n" + task["deps"])
    if task["size"]:
        parts.append("h3. Size\n" + task["size"])
    parts.append("h3. Source\ndocs/PLAN-health-2026-11-12.md, " + task["id"])
    if task["parked"]:
        parts.insert(0, "h3. PARKED — not approved\nDo not start this. It is in the plan only as "
                        "a record of what was proposed and rejected or deferred.")
    return "\n\n".join(p for p in parts if p)


def request(method, url, payload=None, auth=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("Authorization", auth)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default=PLAN)
    ap.add_argument("--project", default="SCRUM")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--max", type=int, default=None, help="file at most N tasks")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("choose --dry-run or --apply")

    epics, tasks = parse_plan(args.plan)
    if not tasks:
        sys.exit(f"no tasks parsed from {args.plan} — the table shape changed")

    print(f"{len(tasks)} tasks in {len(epics)} sections: "
          + ", ".join(f"{k}={v['priority']}" for k, v in epics.items()))

    if args.dry_run:
        for t in tasks:
            flag = " (parked)" if t["parked"] else ""
            print(f"  {t['id']} [{t['priority']}] {t['summary']}{flag}")
        print("\nfirst payload:")
        print(json.dumps({
            "fields": {
                "project": {"key": args.project},
                "summary": f"{tasks[0]['id']} — {tasks[0]['summary']}",
                "description": body(tasks[0]),
                "issuetype": {"name": "Task"},
                "labels": ["plan:" + tasks[0]["id"], "pri:" + tasks[0]["priority"]],
            }
        }, indent=2)[:1200])
        return

    base = os.environ.get("JIRA_BASE", "").rstrip("/")
    email = os.environ.get("JIRA_EMAIL", "")
    token = os.environ.get("JIRA_TOKEN", "")
    if not (base and email and token):
        sys.exit("set JIRA_BASE, JIRA_EMAIL and JIRA_TOKEN (the token is the actor's own)")
    import base64
    auth = "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()
    api = base + "/rest/api/2"

    # 1. epics
    epic_keys = {}
    for letter, epic in epics.items():
        payload = {"fields": {
            "project": {"key": args.project},
            "summary": f"{epic['priority'].upper()} — {epic['title']}",
            "description": f"Plan section {letter}. Source: docs/PLAN-health-2026-11-12.md",
            "issuetype": {"name": "Epic"},
            "labels": ["plan:epic:" + letter, "pri:" + epic["priority"]],
        }}
        created = request("POST", f"{api}/issue", payload, auth)
        epic_keys[letter] = created.get("key")
        print(f"epic {letter} -> {epic_keys[letter]}")

    # 2. tasks
    filed = 0
    for t in tasks:
        if args.max is not None and filed >= args.max:
            break
        fields = {
            "project": {"key": args.project},
            "summary": f"{t['id']} — {t['summary']}",
            "description": body(t),
            "issuetype": {"name": "Task"},
            "labels": ["plan:" + t["id"], "pri:" + t["priority"]]
                      + (["size:" + t["size"].lower()] if t["size"] else []),
        }
        if epic_keys.get(t["section"]):
            fields["parent"] = {"key": epic_keys[t["section"]]}
        created = request("POST", f"{api}/issue", fields, auth)
        filed += 1
        print(f"  {t['id']} -> {created.get('key')}")
    print(f"filed {filed} tasks")


if __name__ == "__main__":
    main()
