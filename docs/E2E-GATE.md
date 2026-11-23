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
| 1 | `scripts/card-template.ts` | a card that names app-surface paths and carries no `## e2e` block is refused before it exists; `--check` asks the same of a card already on the board, and a card carrying no `## surface` section is reported as unchecked (exit 2), not as exempt | the `## surface` section is still the card's own claim — a card that writes `- none` is taken at its word until CI looks at its actual diff |
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

Each entry names the page the change is visible on — `pagesFor()` reads that — because the product
has two built pages and a receipt for one is not a receipt for the other.

| path | surface | page |
|---|---|---|
| `body/` | the page: header, timeline, columns, centre, right panel, the anatomy models it loads, the demo build and its artifact | case |
| `src/` | the graph view and the node panel | graph |
| `graph.html` | the graph page's entry document, which the viewer mounts into | graph |
| `index.html` | the published root page: what GitHub Pages answers `/` with | case |
| `case.html` | the published case page, the alias the docs name | case |
| `scripts/build-demo.ts`, `scripts/build-case.ts` | the case build: the builders that write `dist/demo.html` and the published root page | case |
| `app.json` | the demo build: the app manifest, which also names the app the clean room installs | case + graph |
| `package.json`, the lockfile, `vite.config.*`, `tsconfig.json` | the build itself, which emits both pages | case + graph |

`NOT_PRODUCT` is the whole allowlist inside those directories — `body/shots/`, any `body/**/*.md`,
and `src/*.test.ts(x)`, things that cannot move the product on their own. Everything else under `body/`
or `src/` is surface, so a new file there is gated until somebody says otherwise in a diff anyone
can read. Everything outside the list — `docs/`, the rest of `scripts/`, `.github/`, tests,
screenshots — is not, so a tooling or documentation branch is exempt without anybody remembering
to exempt it.

## What a run has to be

`scripts/e2e/gate.ts` refuses a run that is not all five of these:

- **against this commit** — `report.json`'s `commit` equals the head being reviewed, in full;
- **clean** — `dirty: false`, because a run on a dirty tree is not evidence of any commit;
- **passing** — `passed: true` *and* every check green, so a report that says "passed" while a
  check is red is not a pass;
- **policy-complete** — `policy.no-host-apps`, `policy.stays-in-room` and `capture.browser-only`
  present and green. Absent is not the same as green: a run that never scanned its child's tool
  calls proves nothing about them;
- **on the right page** — the run captured every page the card names. `report.json` records the
  page of each capture (`pages[].kind`) and what the card asked for (`card.page`); a card that
  asked for the columns page and a run that only opened the graph page is refused, whether the
  caller says so or the report contradicts itself. A report written before the field existed is
  read as a graph run, which is what it was.

`bun scripts/e2e/gate.ts --commit <sha> --pages case` asks for a specific page; `--files <paths>`
prints which pages a diff's receipt has to have opened.

That last rule is what CI reads from the receipt: `run.ts` puts the page marker in the status
description (`G3 [case] PASS — …`, `[graph]`, `[case+graph]`), and `ci-gate.ts` refuses a diff that
moves the columns page when the green status on its head does not say a case-page run made it. An
unmarked receipt still satisfies a graph-only diff — every status posted before the field existed
is graph-page evidence — but it can never authorise a columns-page change. That was the hole: a
`body/` pull request merged on a green run of a page the card never mentioned.

## What the card gets

On a pass, `run.ts` comments and attaches, so the reviewer never has to open a directory to know
whether the run happened: the page each capture was (graph or case), replay counts for the clean
room and the replay (records drawn and column widths on the columns page), DOM bytes and sha256 for
each, the screenshot paths and which route took each one, the card's own `expect` hits per page, and
the three policy checks with the number of child tool calls they scanned. On a failure it attaches
the transcripts and the screenshots, posts `e2e=failure`, and moves the card out of `review`.

A run can be green with an evidence gap on it. A missing photograph — `browser_vision` deadlocked,
the bundled `agent-browser` binary was not there either — is recorded in `report.json`'s
`evidence_gaps`, printed as `gap`, and named in the commit status (`PASS — 1 evidence gap`). It is
not a red check, because a capture tool that does not answer says nothing about the product; the
checks that do (`*.dom`, `*.browser`, `*.claim`, `*.records`) stay hard, and a page that was never
read is still a failure. The rule lives in `scripts/e2e/receipt.ts` and is applied on both sides of
the gate — `run.ts` writes it, `gate.ts` reads it — so a receipt cannot be green to one and red to
the other.

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
- **The gate does not gate itself.** `scripts/e2e/**`, `scripts/card-template.ts` and
  `.github/workflows/verify.yml` sit outside `APP_SURFACE`, so a pull request that deletes the
  receipt step from `verify.yml`, or makes `ci-gate.ts` exit 0, is a change to the gate itself that
  merges on an ordinary second-identity approval with no clean-room run behind it — `bun
  scripts/e2e/gate.ts --files scripts/e2e/ci-gate.ts .github/workflows/verify.yml` says `no e2e
  needed`. The reviewer of a diff that touches those paths therefore checks the receipt step and
  `ci-gate.ts` by hand. Whether they should join the surface list (cost: a clean-room run for every
  gate-maintenance branch) is an owner trade-off recorded on card t_036c0001, not something this
  list decides by itself.

## Why `completion_contract` stays `local-only`

Settled 2026-11-23, twice, after two cards asked the owner to decide it. Neither answer needs the
owner or the kernel, so this section exists to stop the question coming back.

`hermes_cli/kanban_pr_acceptance.py::collect_acceptance` resolves a non-`local-only` contract by
reading the required status checks of the PR's base branch. `main` is protected by classic branch
protection, not by rulesets — `rules/branches/main` returns `[]`, while
`branches/main/protection` carries `branch-name`, `verify` and `sync-selftest`. Reading that
endpoint needs repository admin, and a worker identity does not have it: it can see
`"protected": true` and gets an empty required set, so `collect_acceptance` returns
*"No repository-required checks are configured"* and **refuses every completion**. A repo contract
therefore does not gate the bad completions, it blocks all of them.

What was learned the hard way: verifying that path as `lebeker` proves nothing, because `lebeker` is
the owner. The card that reported it was right and the dismissal was wrong.

The gate is CI and it is already upstream of completion:

1. `verify` is a required check on `main`.
2. `verify` runs the e2e receipt step and fails without a green `e2e` status on the PR head.
3. `e2e` is posted only by `scripts/e2e/run.ts` passing against that head.

So a PR that can merge is a PR that passed a clean-room run, and a card that cannot merge cannot
honestly be done. Product cards keep `completion_contract: local-only` and land their PR; the merge
gate does the gating.

If a future card wants kernel-level completion gating, it is a kernel change the owner must
authorise — but it buys nothing until workers can read the protection rule, and today they cannot.
