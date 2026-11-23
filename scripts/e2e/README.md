# G3 — agentic end to end

One command, one fresh agent, evidence a reviewer can look at:

```sh
bun run e2e --card t_0042bfe2          # a card on the board
bun run e2e --card path/to/card.md    # a card written as a file
```

Exit 0 = the card's claim was visible in the product. Exit 1 = it was not (the card gets a
comment with the screenshots attached, its `e2e` status goes red, and the card leaves `review`).
Exit 2 = the card declares no user question.

A pass also does two things beyond writing the directory: it comments on the card with the replay
counts, the DOM bytes and sha256 per stage, the screenshots and the three policy checks, and it
posts one `e2e` commit status on the exact head it built. That status is the receipt
`scripts/e2e/ci-gate.ts` requires in CI — see `docs/E2E-GATE.md`. `--no-status` exists for a probe
run and takes the branch out of the gate with it.

## What it actually does

1. **Reads the card.** Nothing about the prompt is hard-coded: the card carries it (below).
2. **Builds the card's worktree** (`bun run build`), records `HEAD` and the sha256 of
   `dist/graph.html`. Pages serves `main`; a card's work is on a branch, so the published URL
   would test the old product.
3. **Makes a clean room**: a throwaway directory holding the `kg` skill (twice: once as the
   user's `kg/` folder, once as the agent's installed skill) and nothing else. The worktree's
   app is installed into it by the skill's own command, from a local mirror of that build:

   ```sh
   kg.py fetch-app <app> --url http://127.0.0.1:<port>/<app>.html --manifest-url …/app.json
   ```

   No repo checkout, no fixtures, no memory, no prior conversation, no board context (the
   child's `HERMES_*` environment is stripped), and its own `HOME`, so it cannot read another
   profile's memory or skills. The room is built in the system temp directory — not next to the
   repo and not inside `~/.hermes` — because an agent that walks up one directory from a room
   inside either of those is out of the clean room. Its `AGENTS.md` says which directories are
   in scope and that desktop applications (browsers included) are not.

   The room also gets the **app's own contract checker** (`check/validate.ts`, verbatim from
   the worktree, with `check/lib/` and the `check/schema/kg-1-health.schema.json` it reads
   beside it). The skill's `validate` checks the
   base kg/1 shape; this app adds rules (a `meta.profile`, a source behind every fact, a date
   on every event) that only the app's checker states. Without it in the room, an agent can
   produce a document the skill calls conformant and the app rejects — that happened, 15 issues
   deep, and the harness was judging the agent on rules it had no way to see. It carries the
   shape of a document, never its content, and the harness runs the same file afterwards.

   Everything the agent needs — `kg/`, `check/`, `storage/` — is inside the directory it starts
   in. The room's `AGENTS.md` says so, forbids searching outside it (`find /`, `ls /`,
   `/Volumes`, `/System`, `/Applications`, `/Users`, `mdfind`, `diskutil`), and
   `policy.stays-in-room` fails the run if a tool call did anyway: a `find /` walk crosses
   `/Volumes` and makes macOS ask the machine's owner for a permission it should never have been
   asked.

4. **Asks the question** with one `hermes chat -q` and lets the agent do whatever the skill
   tells it to do. The agent gets `terminal` and `file`; the harness never touches the graph
   while the agent is working.
5. **Shows it** in a second, narrowly scoped Hermes session: the capture session, pinned to the
   `browser` toolset, whose only tools it may call are `browser_navigate`, `browser_console` and
   `browser_vision`. It opens every page the card names, waits for the first render, reads the
   title, the header (the graph page) or the three column widths and record rows (the columns
   page), the visible text and a sha256 of the live DOM, answers the card's `expect`
   list in the page itself, and takes the screenshot. See **Why a browser session and not a
   driver** below.
6. **Replays**: the agent's `kg.json` is injected into the branch build
   (`dist/graph.html`, the same `#kg-graph` element the skill's `render` rewrites) and captured
   again; then `bun run verify` and the kg/1 contract over the agent's document run in the
   worktree. No crash, no regression, same claim visible.

## The two pages

The product has two built pages and they do not show the same thing, so a card says which one its
claim lives on:

| `page:` | artifact | what the run checks |
|---|---|---|
| `graph` (default) | `dist/graph.html` — the React viewer the skill installs | `#root` mounted, `<title>` equals the document's, the `N nodes · M edges` header matches the document |
| `case` | `dist/demo.html` — the columns page: timeline, record list, centre, right panel (widgets 19–25) | the page holds the document (`__documentState()`), the three columns are laid out with a record in the centre, and every stored row in the record list is dated in the document |
| `both` | both | both, and the card's `expect` text has to be visible on each |

The graph page is captured twice — the page the agent rendered in the clean room, and the replay
of its document in the branch build. The columns page is captured once: the branch's
`dist/demo.html` with the run's own document injected into its `#kg-graph` slot (`inject`, payload
only — the page keeps the title it ships with, because the page under test is the one the branch
builds). `lib/` and `models/` are linked beside the copy, because the page loads them relatively.
The clean room installs the graph app, so a case-page capture is always a replay of the branch
artifact — `report.json` says so per capture, under `pages[].kind`.

## The card contract

The card states its own user question, in the same body that carries its acceptance:

```markdown
## e2e
page: case
prompt: show me my last lipid panel
expect: LDL cholesterol, mmol/L
```

- `prompt` — one sentence a user would say. It is the card's, not the harness's: a card about
  the state-at-date panel asks for a date, a card about the risk model asks for the number and
  where it comes from.
- `page` — `graph` (default), `case` or `both`; see **The two pages** above. A card whose claim
  is only visible on the columns page and does not say `page: case` gets a graph-page receipt, and
  `scripts/e2e/gate.ts` refuses it — that mismatch is the loophole this field closes.
- `view` — `record` (default) or `profile`, and only on a `page: case` card. The profile view sits
  behind the header's second button, so its text is not in the page until something opens it: the
  probe opens it through the page's own `__openProfile()` hook, records which view the matched text
  came from (`report.json` `pages[].view`, `pages[].profile_open`) and the receipt says
  `(profile view)`. `case.view` is a hard check, so a `view: profile` card whose capture read the
  record column is red whatever its `expect` needles found — they *will* be found, because the
  profile view's copy also sits in the record column and the docs panel. `view: profile` beside
  `page: graph` or `page: both` is refused before anything runs.
- `expect` — optional text that must be visible in the page when the card is really done. Each
  entry is matched, case-insensitively, against the page's own `innerText` **inside the page**,
  and the browser's answer is what the harness asserts — the model never retypes it. The graph
  itself is drawn on a `<canvas>`, so node labels are not in `innerText`: an `expect` has to be
  text the DOM carries (the title, the `N nodes · M edges` header, legend entries, a rendered
  panel). Without `expect` the harness still checks the page renders and is titled, but it
  cannot check the card's own claim — that check fails, on purpose.
- `e2e: light` anywhere in the body marks a card smaller than `M`: G2 plus one prompt, no
  replay. Only the lead marks a card light.

A card without a prompt is refused, not guessed at — G0 says a card that does not state its own
test is blocked, not started. The harness prints the block to add and exits 2.

## The evidence directory

`~/.hermes/e2e/<label>-<card>-<timestamp>/` (or `--out`, which must be outside the repo):

| file | what it is |
|---|---|
| `card.json` | card id, prompt, mode, `pages`, branch, commit, build sha256 (graph and case), dirty flag |
| `build.html` | the exact artifact under test |
| `agent.jsonl` | the fresh agent's record stream — every tool call it made |
| `kg.json` | the document the clean room produced |
| `cleanroom.values.json`, `cleanroom.png` | what the browser read from the page the agent rendered, and the screenshot |
| `replay.values.json`, `replay.png` | the same for the document inside the branch build |
| `case.html`, `case.values.json`, `case.png` | on a `page: case` (or `both`) card: the branch's columns page with this run's document injected, what the browser read from it, and the screenshot. `lib/` and `models/` are symlinks to the worktree's build output |
| `capture.jsonl`, `capture.prompt.txt`, `capture.tools.json` | the capture session's brief, its record stream and the `browser_*` calls it made |
| `contract.txt`, `verify.txt` | G1 and G2 output |
| `report.json` | every check, pass/fail, plus the paths above |
| `room/` | with `--keep-room`, the clean room as it was left — its `storage/`, the app's `check/` and what was installed |

A screenshot is the file the capture tool wrote, copied here; it is not re-rendered by the harness.
`report.json`'s `browser.routes` says which route took each one (`browser_vision` or
`agent-browser`), and `evidence_gaps` lists every capture the run could not make — a gap on a green
receipt is a record, not a failure.

## Why a browser session and not a driver

Owner policy: bots do not launch, attach to or control desktop applications. A harness that
starts Chrome — headless or not, CDP or not, from TypeScript, Python or a shell — is doing
exactly that, and its picture is of a browser the harness chose rather than the managed one.

So the page is opened by Hermes's own `browser_*` tools in a session of their own: headless,
throwaway profile, `use_real_profile: false`, extension control off, no `computer_use`. The
session is pinned to the `browser` toolset — not `browser` plus `terminal`: Hermes builds the
browser toolset from its `browser_*` tools and offers it when it can find the `agent-browser`
CLI, which the harness puts on that session's `PATH`; it needs no shell for that, and giving it
one would hand a host shell (and `browser_exec`) to a session whose job is three calls. The
harness reads the session's `--format stream-json` record and pairs each page with the
`browser_navigate` / `browser_console` / `browser_vision` calls that produced it. Every child
session — the clean-room agent too — is scanned afterwards: a tool call that names a browser
binary, `osascript`, `open -a`, a remote-debugging port, Playwright or Puppeteer fails
`policy.no-host-apps`, because a child that starts its own browser is not evidence.

The capture session's scope is a check as well, not only a prompt: `capture.browser-only` fails
the run if it called anything other than those three tools. An allowlist rather than a
`browser_*` prefix, because the toolset it is offered also carries `browser_exec` (arbitrary code
on the host), and a tool is not made safe by the first word of its name.

Two routes take the picture, and the receipt names which one did. The first is the session's own
`browser_vision`. The second exists because the first can be broken in a way the product is not:
on 2026-11-23 `browser_vision` timed out at 30 s on every call — three attempts, `https://example.com`
included — while the same bundled `agent-browser` binary photographed the page in 2.1 s. So when the
session leaves no usable PNG, the harness spawns that binary itself (its own headless Chromium,
`open` then `screenshot`, absolute output paths only) and records `agent-browser` as the route. The
owner-policy patterns are applied to the binary *before* it is spawned (`hostAppHit`): a path naming
a desktop application is refused, and nothing goes through a shell, so `open -a` and `osascript` are
unreachable rather than merely discouraged. `E2E_CAPTURE_PROBE=broken` breaks this route on purpose,
which is how the gap path is exercised end to end.

The direct route passes the CLI a `PATH` and deliberately *not* `AGENT_BROWSER_EXECUTABLE_PATH`:
pointing that variable at the packaged `Google Chrome for Testing` — the value Hermes gives its own
browser — makes this CLI's `open` answer in 1.4 s and its `screenshot` never return (40 s by hand,
killed at 60 s in the harness, measured 2026-11-23). Left unset, the same CLI launches the Chromium
it manages itself, visible in `ps` as `~/.hermes/tools/chromium-…/Google Chrome for Testing
--headless=new` and never `/Applications/Google Chrome.app`, and photographs the same 2 MB page in
2.7 s. So the browser is still the harness's, chosen by the harness's own CLI.

A page that was never *read* is still a red run: `case.browser`, `case.dom`, `case.claim` and the
rest assert the product and stay hard. A page that could not be *photographed* is not: the
screenshot check carries `hard: false`, lands in `evidence_gaps` on `report.json`, prints as `gap`,
and does not stop the receipt from going green (`receipt.ts` says why in one place). The commit
status says how many gaps there were, so a green receipt never claims a photograph it does not have.

The consequences a reviewer should know:

- There is no pre-load console-error capture. A page that throws before a listener could be
  attached is caught structurally instead: `ready` (the app mounted and left its first-frame
  state), `mounted` (elements under `#root`), `not-empty` (the viewer did not fall back to "no
  graph yet"), and `bun run verify` for the deterministic side.
- The capture session is a model like any other. If it stops following its brief, the run goes
  red with the transcript attached; it is never quietly repaired by the harness.

## Requirements

- `hermes` on `PATH` or `HERMES_BIN`; Python 3 for the skill; `bun` for the build.
- The `kg` skill checkout: `$KG_SKILL` or `--kg-skill` (default `../1M_kg_skill`).
- Hermes's own browser toolset installed (`hermes pm install chromium agent-browser`, which the
  installer does by default). Both live under `~/.hermes/tools`; the capture session, which has
  a private home, is handed their paths so it can be offered the `browser_*` tools. Override
  with `E2E_CHROMIUM` / `E2E_AGENT_BROWSER`.
- A model endpoint. Both children get a private `HERMES_HOME` with one config file and no keys;
  it points at the local endpoint the machine already serves (`E2E_MODEL`, `E2E_PROVIDER`,
  `E2E_BASE_URL`; defaults `deepseek-v4.1-flash:cloud` on `http://127.0.0.1:11434/v1`).

Nothing here runs in `.github/workflows/verify.yml`: a check that needs a model is not a
deterministic check, and the CI comment says so on purpose. G3 runs locally, or headless on
any machine that has those four things.

What CI does run is `scripts/e2e/ci-gate.ts`: it reads the receipt this harness posts, and fails a
pull request whose diff moves the app surface without one. That is the gate — `docs/E2E-GATE.md`.

## Honest limits

- One run is a sample. The model is the same class as the worker, not a different vendor; a
  hostile or very weak model could pass a weak `expect:` or fail a good one. That is why the
  card's claim is written down and asserted, rather than judged from a screenshot by eye.
- The clean room is a directory, not a container: the agent *could* wander out of it. It is
  clean because nothing there points at the repo, not because it is jailed — which is why the
  boundary is also a check (`policy.stays-in-room`): a tool call that searches from `/`, lists
  `/`, names `/Volumes`, `/System`, `/Applications`, `/Users`, runs `mdfind` or `diskutil` fails
  the run. A rule in a prompt is a request; the scan is what makes it true.
- `--prompt` overrides the card so a harness bug can be debugged. It is recorded as
  `prompt_source: override` in `card.json`, and an override run is not card evidence.
