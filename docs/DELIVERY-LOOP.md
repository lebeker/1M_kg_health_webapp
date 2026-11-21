# Delivery loop

How work moves from "in the backlog" to "merged and Done", who may touch what, and which gate a card
has to pass before it moves. Written 2026-11-20. Owner of the loop: the lead (identity `mex`).

Two stores, one direction each:

| Store | Role | Written by |
|---|---|---|
| Jira `SCRUM` | the ledger a human reads | `scripts/jira-sync.py`, from card state |
| Kanban board `health` | the queue a bot claims from | the lead; workers move their own card |
| `docs/PLAN-health-2026-11-12.md` | the plan of record (T01–T28) | the owner |

A Jira issue is never the trigger. A card is. `scripts/jira-batch` fills Jira from the plan;
`scripts/jira-sync.py` keeps it honest afterwards.

---

## 1. The loop

```
                 ┌──────────────────────────────────────────────┐
  backlog ──▶ todo (deps unmet) ──▶ ready ──▶ running ──▶ review ─┤
                 ▲                    │           │          │     │
                 │                    │           │          ├─▶ changes requested ──▶ ready
                 │                    │           │          └─▶ approved ──▶ merge ──▶ done
                 └────────────────────┴───────────┴──── blocked (needs a human, stops here)
```

Rules that make it a loop and not a queue with extra steps:

1. **Order comes from the dependency graph, not from a human reading the board.** 21 edges cut from
   the plan's Deps column. `ready` = every parent is `done`. The lead does not "pick the next card";
   the graph does, and priority breaks ties.
2. **One card, one branch, one PR, one worktree.** Two workers never edit the same file: every card
   that touches `body/index.html` is assigned to the same identity, and those cards are chained.
3. **A card that changes the shape of the work is lead-only.** T04 (the `kg/1-health` contract) and
   anything that edits the plan, the schema or the release criteria. A worker may not start a
   feature before it; the graph already enforces that, the assignment makes it visible.
4. **Nothing merges without an approval from a different identity.** Enforced by branch protection,
   not by a prompt — a bot cannot approve its own PR and cannot approve the PR of a bot that
   approved it (ring: `mex → lia → right → mex`).
5. **`done` is a platform fact, not a claim.** Card goes `done` only after the merge commit is on
   `main` and the sync has moved the Jira issue to Done.

## 2. Gates

Every card passes these in order. A gate that fails sends the card back to `ready` with the reason as
a comment; three consecutive failures block the card for a human.

| Gate | Question it answers | How it is checked |
|---|---|---|
| G0 acceptance | does the card state its own test? | the card body carries the plan's Acceptance text verbatim; no acceptance → card is blocked, not started |
| G1 contract | does the data obey `kg/1-health`? | `bun run test:contract` — `docs/DATA-CONTRACT.md` over `tests/fixtures/kg/` (valid must pass, invalid must fail). T04 replaces the checker behind the same command | 
| G2 unit | does the code do what the card says? | `bun run verify` = lint (`biome lint src scripts`) + `bun run typecheck` + `bun run test` + the contract gate + the branch-name self-test |
| G3 agentic e2e | does a *user* get the promised outcome? | section 3 |
| G4 review | did a different identity read it? | PR approval; stale approvals dismissed on new commits |
| G5 merge | is it on `main`? | auto-merge armed by the author, merged by GitHub when G1–G4 are green |
| G6 ledger | does Jira say the same thing? | `python3 scripts/jira-sync.py --apply`, which reads every write back |

### What CI runs, and what it must not

`.github/workflows/verify.yml`, required on `main`. The three check names are the contract with branch
protection, so they do not change without changing the protection rule:

| check | what it proves | why it is here |
|---|---|---|
| `branch-name` | the head branch matches `(fix\|feat\|chore)/<JIRA-TICKET>_<desc>` | the same function a worker runs locally (`bun scripts/check-branch-name.ts`); a rule that only lives in CI is discovered after the push |
| `verify` | lint, types, unit tests, contract fixtures, build | deterministic, no network beyond `bun install`, no model |
| `sync-selftest` | the Jira sync's mapping, comments and read-back logic (`python3 -m unittest`) | the sync writes to the ledger; a regression there is a lie in Jira, not a red test |

**GitHub never runs an agent.** G3 is local by design (section 3, card E01): a check that needs a
model is not a check. So CI is the deterministic half of the loop, and the evidence for G3 is a
screenshot, a DOM and a `kg.json` in the card's own evidence directory, tied to the commit under
review — not a green tick.

## 3. Agentic e2e (G3)

Not a unit test and not a screenshot diff: a fresh agent, no memory of the work, is asked to use the
product and has to be able to show the result. Built as E01 (SCRUM-41):

```sh
bun run e2e --card t_0042bfe2      # exit 0 = the card's claim was visible, 1 = it was not, 2 = no prompt
```

`scripts/e2e/README.md` is the manual. The four parts that decide whether this is a real gate:

**Clean room.** A throwaway directory with the `kg` skill installed and *nothing else* — no repo
checkout, no prior conversation, no fixture files. The agent's context is one prompt and the tools
that skill gives it. The harness gives the child a private `HERMES_HOME` (one skill, one config file,
no memory), strips the board and session environment, and starts its shell in the room; the only
thing shared with the machine is the model endpoint.

**Prompt.** Carried by the card, in an `## e2e` block beside its acceptance — one sentence a user
would say, plus the text that must be visible when the card is done:

```markdown
## e2e
prompt: show me my last lipid panel
expect: LDL cholesterol, mmol/L
```

A card about rendering asks for a picture of a record; a card about the risk model asks for
"what is my ten-year risk and where does the number come from". Nothing is hard-coded in the harness:
a card with no prompt exits 2 and is blocked at G0 instead of being guessed at.

**Load.** **The published Pages build cannot be used for unmerged work.** Pages serves `main`; a
card's work exists on a branch. So the clean room loads a **build of the card's worktree**
(`bun run build` → `dist/index.html`) and installs it with the skill's own `fetch-app --url` from a
local mirror of that build. Same artifact that ships, same install path a user takes, just not yet
public. Anything else tests the old product and proves nothing.

**Show it and close the loop.** Headless Chrome against the page the agent rendered: a screenshot,
the DOM, the page title, the `N nodes · M edges` header and the card's expected text, all written to
`.e2e/<card>-<timestamp>/` next to the agent's `kg.json` and its transcript. Then that `kg.json` is
injected into the branch build and replayed: no crash, `bun run verify` green, the kg/1 contract over
the agent's own document, the same claim visible. Failures come back to the worker as a card comment
with the screenshot and the transcript attached, and the command exits non-zero.

**Cost.** One extra agent run per card. Acceptable for P0/P1 cards; for cards smaller than `M` the
lead may mark a card `e2e: light` — G2 plus the single prompt, no replay. The default is full. CI
never runs this: a check that needs a model is not a check (see the note above), so G3's evidence is
the evidence directory, tied to the commit under review.

## 4. Who does what

| Identity | Role in this repo |
|---|---|
| `mex` | lead: order, splits, lead-only cards, the sync, the first review in the ring |
| `lia` | the contract, the estimates engine, docs |
| `right` | everything in `body/index.html` (serialised), tests, demo data |
| owner | approvals that need a human, scope decisions, the five open questions |

Role is a phase of a card, never a property of an identity: any of the three can review any card it
did not author.

## 5. Manager duties (the only manual steps left)

- Keep the graph honest: a new card means new edges, or the loop will run it out of order.
- Split anything `L` before it starts; an `L` card that reaches `review` was mis-sized.
- Mark lead-only cards.
- Read the board once a day: `hermes kanban --board health ls` and the Jira board. Bounce rate —
  how many cards come back from review — is the number worth watching, not throughput.

## 6. What must be true before the loop can run

State as of 2026-11-21 (bootstrap card SCRUM-40):

| # | Requirement | State |
|---|---|---|
| 1 | `liamijatovich` and `righ22` are repo collaborators with write | **done** — both have `push` |
| 2 | `main` is protected: PR, 1 approval from another identity, dismiss stale, no self-approval, auto-merge | **done** — `main` reports `"protected": true` and a repo-admin applied the auto-merge setting; `mex` cannot read the protection payload (admin-only), so the settings are recorded in §8 and verified by PR behaviour (`REVIEW_REQUIRED` on an otherwise green PR) |
| 3 | A required CI check exists (G1/G2) | **done** — `.github/workflows/verify.yml` on `chore/SCRUM-40_delivery-workflow`: `branch-name`, `verify`, `sync-selftest` |
| 4 | The agentic e2e harness exists (section 3) | **pending a recorded run** — E01 (SCRUM-41) builds it (`bun run e2e --card <id>`, `scripts/e2e/README.md`); the row flips when a full clean-room + replay run is green on the commit that carries it |
| 5 | Dispatcher running with per-profile concurrency caps | config ready (§7), dispatcher start is the parent's call |

## 7. Branch names, roles and how many runs a bot may have at once

**Branch name.** `(fix|feat|chore)/<JIRA-TICKET>_<optional-short-description>`, e.g. `feat/SCRUM-15`
and `feat/SCRUM-15_schema-validator`. Lower-case words joined by single hyphens, no spaces, ≤40
characters, no trailing underscore. `main`/`master` are exempt because nobody opens a PR from them.

The rule is a function (`scripts/lib/branch-name.ts`), not a workflow snippet, so it can be checked
before the push: `bun scripts/check-branch-name.ts`. The same function is the `branch-name` CI check.
A project-linked card's default branch (`<project-slug>/<task-id>`) does **not** satisfy it, so a card
that is dispatched as a project worktree must rename its branch to the ticket name before pushing;
that is the card body's job to state, and the `branch-name` check is what makes it true.

**Who may do what.** Role is a phase of a card, never a property of an identity: any of the three can
implement one card and review another. What an identity may *not* do is approve its own work — that
is GitHub's rule, enforced at the platform, not a prompt.

**Concurrency, per identity.** `lia` and `right` each get **one implementation run plus one
independent review run**, and never two implementations. The dispatcher enforces this with
`kanban.max_in_progress_per_profile: 1`, and what that setting actually does is stricter than the
name suggests: it counts *every* `status = 'running'` row per assignee
(`hermes_cli/kanban_db_dispatch.py`, the `per_profile_running` query) and applies the same cap to
both the `ready` and the `review` lane — a claimed review is itself a `running` row
(`claim_review_task` moves `review → running`). So a profile has **one run in flight at a time, full
stop**: while it implements one card its review of another waits in the queue, and while it reviews,
its next implementation waits. That can never produce two implementations, which is the hard
requirement; it also means the dev-plus-review pairing is serialized, not concurrent. Making those two
lanes genuinely parallel would need a role-aware count (implementation rows capped at one *plus* one
review row), which the dispatcher does not have today — do not assume `2` gets you there, it would
allow two implementations. `mex` takes product cards one at a time.

**Field ownership.** Two stores, one writer each, so nothing is updated by two places:

| field | owner | written by |
|---|---|---|
| card status, assignee, comments, runs | Kanban board `health` | the worker that owns the card; the lead creates and splits |
| Jira status | `scripts/jira-sync.py` | derived from card status (§ mapping in the script docstring) |
| Jira assignee | `scripts/jira-sync.py` | derived from card assignee via `scripts/jira-identities.json` |
| Jira comments | `scripts/jira-sync.py` | running / review / blocked / changes_requested / done, deduped by marker |
| plan, contract, gates | `docs/PLAN-health-2026-11-12.md`, `docs/DATA-CONTRACT.md`, this file | the owner (lead) |

The card's assignee is the identity that owes the *next action*, and the Jira assignee follows it: while
a card sits in `review` the issue is assigned to the reviewer, and it moves back with the card if the
reviewer requests changes. That is deliberate — the ledger answers "who is holding this now", not
"who wrote it first"; the author is in the PR and in the comments.

A human never edits a status in Jira by hand: if the two disagree, the card is the truth and the sync
is re-run.

## 8. Bootstrap record (SCRUM-40, 2026-11-21)

Done by `mex` on branch `chore/SCRUM-40_delivery-workflow`:

- PRs #1–#4 (the unlanded commits and the three docs/scripts branches) consolidated into one branch
  and one PR, so the work lands in one reviewed merge instead of four overlapping ones.
- CI added: lint, typecheck, unit, contract fixtures, branch-name, sync self-test.
- The Jira sync repaired: assignee mapping, a comment when the status does not move, read-back after
  every write, and a non-zero exit when a write does not land. Verified against the live project:
  SCRUM-40 moved to *In Progress* with its assignee read back, SCRUM-41 got a blocked comment while
  its status stayed *To Do*.
- The branch-name rule added and tested (15 cases in the CLI, plus unit tests).

**Two operations only a repository admin can perform — now applied.** `mex` holds `push`, so both
return `404 Not Found` from `mex` (GitHub hides admin-only endpoints from non-admins); a repo admin
applied them on 2026-11-21. This is the exact payload that is meant to be live, kept here so it can be
re-checked rather than re-invented:

```sh
# 1. allow auto-merge at the repository level (needed before a bot can arm it)
gh api -X PATCH repos/lebeker/1M_kg_health_webapp -f allow_auto_merge=true

# 2. protect main: PR required, 1 approval from another identity, stale approvals dismissed,
#    last pusher cannot approve, the three CI checks required
gh api -X PUT repos/lebeker/1M_kg_health_webapp/branches/main/protection \
  -H 'Accept: application/vnd.github+json' --input - <<'JSON'
{
  "required_status_checks": {"strict": true, "contexts": ["branch-name", "verify", "sync-selftest"]},
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

`require_last_push_approval` is what stops a reviewer pushing a fix and approving it in one move;
`dismiss_stale_reviews` is what stops an approval covering code it never saw. Neither has a
substitute in an agent's instructions.

**The operator value is filled in.** `scripts/jira-identities.json` now carries verified `account_id`s
for all three identities — `mex`, `lia` (`712020:40bb33bc-…`), `right` (`617d6aad3e3753006f48c6d3`) —
so the sync assigns every card instead of warning about two of them. Jira Cloud still refuses the
lookup from this token (`Could not find account ID for user: <email>`), which is why the ids are
committed rather than resolved at run time; `scripts/test_jira_sync.py` pins them so a later edit
cannot quietly put a null back and turn the assignee into a silent no-op.
