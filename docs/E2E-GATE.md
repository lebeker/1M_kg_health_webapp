# The e2e gate

Owner, 2026-11-22: *"taking the host walk out of e2e was a bug fix, not permission to drop e2e."*
Every product card finishes with a clean-room run. This page is what makes that true rather than
remembered.

## The one sentence

A pull request that touches the app surface cannot merge without a green `e2e` commit status on its
own head, and that status is posted by exactly one thing: `bun run e2e` passing against that commit.

## How it is enforced, in the order it bites

| # | Where | What it does | What it cannot do |
|---|---|---|---|
| 1 | `scripts/card-template.ts` | a card that names app-surface paths and carries no `## e2e` block is refused before it exists | it only speaks for cards created through it |
| 2 | `.github/workflows/verify.yml` → `scripts/e2e/ci-gate.ts` | on a pull request, if the diff touches the surface and there is no green `e2e` status on the head, `verify` fails | GitHub still cannot run the agent, so the run itself is local |
| 3 | branch protection | `verify` is a required check on `main`; red `verify` means no merge, and auto-merge waits instead of landing | the required list is admin-only, so this file cannot read it back |
| 4 | `scripts/e2e/run.ts` | a passing run attaches its evidence to the card and posts the receipt; a red run posts `failure`, comments, and moves the card out of `review` | a card a live worker holds is blocked, not reopened — the worker owns that transition |

`bun scripts/e2e/gate.ts --commit <sha>` answers the same question locally, for a reviewer or a
worker about to push, and it answers it the same way CI does.

## What counts as app surface

`appSurface()` in `scripts/e2e/gate.ts`, one list used by the card template, the harness and CI.
It names directories, not files: a file list is a list somebody has to remember to extend, and the
first three things a file list quietly exempted were the models the page renders, the graph page's
own entry document, and the builder that writes the demo artifact.

| path | surface |
|---|---|
| `body/` | the page: header, timeline, columns, centre, right panel, the anatomy models it loads, the demo build and its artifact |
| `src/` | the graph view and the node panel |
| `index.html` | the graph page's entry document, which the viewer mounts into |
| `scripts/build-demo.ts` | the demo build: the builder that writes `body/demo.html` |
| `app.json` | the demo build: the app manifest |
| `package.json`, the lockfile, `vite.config.*`, `tsconfig.json` | the build itself |

`NOT_PRODUCT` is the whole allowlist inside those directories — `body/shots/`, `body/*.md`, and
`src/*.test.ts(x)`, things that cannot move the product on their own. Everything else under `body/`
or `src/` is surface, so a new file there is gated until somebody says otherwise in a diff anyone
can read. Everything outside the list — `docs/`, the rest of `scripts/`, `.github/`, tests,
screenshots — is not, so a tooling or documentation branch is exempt without anybody remembering
to exempt it.

## What a run has to be

`scripts/e2e/gate.ts` refuses a run that is not all four of these:

- **against this commit** — `report.json`'s `commit` equals the head being reviewed, in full;
- **clean** — `dirty: false`, because a run on a dirty tree is not evidence of any commit;
- **passing** — `passed: true` *and* every check green, so a report that says "passed" while a
  check is red is not a pass;
- **policy-complete** — `policy.no-host-apps`, `policy.stays-in-room` and `capture.browser-only`
  present and green. Absent is not the same as green: a run that never scanned its child's tool
  calls proves nothing about them.

## What the card gets

On a pass, `run.ts` comments and attaches, so the reviewer never has to open a directory to know
whether the run happened: replay counts for the clean room and the replay, DOM bytes and sha256 for
each, the screenshot paths, the card's own `expect` hits, and the three policy checks with the
number of child tool calls they scanned. On a failure it attaches the transcripts and the
screenshots, posts `e2e=failure`, and moves the card out of `review`.

## The room's boundary, unchanged

The clean room's `AGENTS.md` still states the rule — work only inside the room; no `find /`, no
`ls /`, no `/Volumes`, `/System`, `/Applications` or `/Users`, no `mdfind`, no `diskutil`, no
desktop applications — and `policy.ts` still vetoes it: one hit fails the run. `ROOM_RULES` and the
patterns are pinned by `scripts/e2e/policy.test.ts`, so the rule and the check that enforces it
cannot drift apart quietly.

## Two things this gate is not

**It is not `completion_contract: e2e`.** The Hermes kanban kernel accepts exactly three contract
values — `local-only`, `OWNER/REPO`, or an exact PR URL — and `validate_contract` raises on
anything else, so a card literally cannot be created with `e2e`. The repo contract is not a
substitute either: `kanban_pr_acceptance.py` reads the branch's *required* checks, and that list is
admin-only (both the GraphQL `branchProtectionRule` and `GET /rules/branches/main` come back empty
to a non-admin), so a non-`local-only` contract refuses **every** completion here, not just a bad
one. Requesting that change is a Hermes-side card for the owner, not something a worker can do from
a repo PR — see `docs/DELIVERY-LOOP.md` §3 and the SCRUM-53 handoff.

**It is not a sandbox.** The clean room is a directory, not a container. It is clean because
nothing in it points at the repo, and the scan is what makes the boundary a fact rather than a
request.

## Honest limits

- One run is a sample from the same class of model as the worker. The card's claim is written down
  and asserted in the page so that a weak run shows up as a failure, not so that a strong one is
  proved.
- The receipt is a commit status, which anybody with write access could post by hand. The gate's
  integrity rests on the same thing branch protection rests on: the identities are bots following
  this document, and a hand-posted status is a lie with an audit trail, not a bypass. Post it from
  `run.ts`.
- The CI step waits up to ten minutes for the status, because a worker pushes before it runs. A
  run that takes longer than that leaves `verify` red until it is re-run — the failure message says
  so, and re-running the job is the fix.
