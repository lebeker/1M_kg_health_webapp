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
| G1 contract | does the data obey `kg/1-health`? | `scripts/validate-kg.mjs` over fixtures (T04) — required CI check |
| G2 unit | does the code do what the card says? | project verify command: `bun run typecheck` + the card's own test |
| G3 agentic e2e | does a *user* get the promised outcome? | section 3 |
| G4 review | did a different identity read it? | PR approval; stale approvals dismissed on new commits |
| G5 merge | is it on `main`? | auto-merge armed by the author, merged by GitHub when G1–G4 are green |
| G6 ledger | does Jira say the same thing? | `scripts/jira-sync.py --apply`, then read the issue back |

## 3. Agentic e2e (the part that does not exist yet)

Not a unit test and not a screenshot diff: a fresh agent, no memory of the work, is asked to use the
product and has to be able to show the result.

**Clean room.** A throwaway directory with the `kg` skill installed and *nothing else* — no repo
checkout, no prior conversation, no fixture files. The agent's context is one prompt and the tools
that skill gives it.

**Prompt.** Derived from the card, not generic. If the card renders an analysis, the prompt is "show
me my last lipid panel"; if it changes the risk model, "what is my ten-year risk and where does the
number come from". The agent must *ask* the question, not be handed an answer.

**Load.** Here is the one place this design has to differ from the obvious reading: **the published
Pages build cannot be used for unmerged work.** Pages serves `main`; a card's work exists on a branch.
So the clean room loads a **build of the card's worktree** (`bun run build` → `dist/index.html`),
served from a local port. Same artifact that ships, just not yet public. Anything else tests the old
product and proves nothing.

**Show it.** Headless browser against that build; screenshot and the DOM of the state the prompt
asked for become the evidence. "It rendered" is not evidence unless there is a picture and a value.

**Close the loop.** The agent's `kg.json` from the clean room is wired into the branch build and the
flow is replayed: no crash, no regression in the acceptance scripts, and the specific claim of the
card is visible. Failures go back to the worker with the screenshot attached.

**Cost.** One extra agent run per card. Acceptable for P0/P1 cards; for `S`-sized chores the lead may
mark a card `e2e: light` (G2 + G3-with-a-single-prompt). The default is full.

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

| # | Requirement | State on 2026-11-20 |
|---|---|---|
| 1 | `liamijatovich` and `righ22` are repo collaborators with write | **missing** — they cannot push or open a PR |
| 2 | `main` is protected: PR, 1 approval from another identity, dismiss stale, no self-approval, auto-merge | **missing** — API returns 404, lead holds push not admin |
| 3 | A required CI check exists (G1/G2) | **missing** — no `.github/workflows` |
| 4 | The agentic e2e harness exists (section 3) | **missing** — to be built as its own card |
| 5 | Dispatcher running with per-profile concurrency caps | `hermes kanban dispatch`, not started |

Until 1 and 2 land, every card sits at `ready` and the loop is a queue with no exit.
