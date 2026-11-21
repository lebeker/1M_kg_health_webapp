# G3 — agentic end to end

One command, one fresh agent, evidence a reviewer can look at:

```sh
bun run e2e --card t_0042bfe2          # a card on the board
bun run e2e --card path/to/card.md    # a card written as a file
```

Exit 0 = the card's claim was visible in the product. Exit 1 = it was not (the card gets a
comment with the screenshot attached). Exit 2 = the card declares no user question.

## What it actually does

1. **Reads the card.** Nothing about the prompt is hard-coded: the card carries it (below).
2. **Builds the card's worktree** (`bun run build`), records `HEAD` and the sha256 of
   `dist/index.html`. Pages serves `main`; a card's work is on a branch, so the published URL
   would test the old product.
3. **Makes a clean room**: a throwaway directory holding the `kg` skill (twice: once as the
   user's `kg/` folder, once as the agent's installed skill) and nothing else. The worktree's
   app is installed into it by the skill's own command, from a local mirror of that build:

   ```sh
   kg.py fetch-app <app> --url http://127.0.0.1:<port>/<app>.html --manifest-url …/app.json
   ```

   No repo checkout, no fixtures, no memory, no prior conversation, no board context (the
   child's `HERMES_*` environment is stripped), and its own `HOME`, so it cannot read another
   profile's memory or skills. The room lives outside the repo (`--out`, default
   `~/.hermes/e2e`), so `ls ..` from the agent's shell finds evidence, not the product source.
4. **Asks the question** with one `hermes chat -q` and lets the agent do whatever the skill
   tells it to do. The harness never touches the graph while the agent is working.
5. **Shows it**: screenshots the page the agent rendered, and reads the DOM back — page title,
   `N nodes · M edges`, and the card's expected text. A picture and a value, not "it rendered".
6. **Replays**: the agent's `kg.json` is injected into the branch build
   (`dist/index.html`, the same `#kg-graph` element the skill's `render` rewrites) and the page
   is captured again; then `bun run verify` and the kg/1 contract over the agent's document run
   in the worktree. No crash, no regression, same claim visible.

## The card contract

The card states its own user question, in the same body that carries its acceptance:

```markdown
## e2e
prompt: show me my last lipid panel
expect: LDL cholesterol, mmol/L
```

- `prompt` — one sentence a user would say. It is the card's, not the harness's: a card about
  the state-at-date panel asks for a date, a card about the risk model asks for the number and
  where it comes from.
- `expect` — optional text that must be visible in the page when the card is really done. Each
  entry is asserted as a case-insensitive substring of the rendered page's text. Without it the
  harness still checks that the document renders (title, counts, no errors) — but it cannot
  check the card's own claim, so a card with a UI claim should always have one.
- `e2e: light` anywhere in the body marks a card smaller than `M`: G2 plus one prompt, no
  replay. Only the lead marks a card light.

A card without a prompt is refused, not guessed at — G0 says a card that does not state its own
test is blocked, not started. The harness prints the block to add and exits 2.

## The evidence directory

`~/.hermes/e2e/<label>-<card>-<timestamp>/` (or `--out`):

| file | what it is |
|---|---|
| `card.json` | card id, prompt, mode, branch, commit, build sha256, dirty flag |
| `build.html` | the exact artifact under test |
| `agent.log` | the fresh agent's whole transcript |
| `kg.json` | the document the clean room produced |
| `cleanroom.png`, `cleanroom.dom.html` | the page the agent rendered, and its DOM |
| `replay.png`, `replay.dom.html` | the same document in the branch build |
| `contract.txt`, `verify.txt` | G1 and G2 output |
| `report.json` | every check, pass/fail, plus the paths above |
| `room/` | with `--keep-room`, the clean room as it was left |

## Requirements

- `hermes` on `PATH` or `HERMES_BIN`; Python 3 for the skill; `bun` for the build.
- The `kg` skill checkout: `$KG_SKILL` or `--kg-skill` (default `../1M_kg_skill`).
- Chrome or Chromium: `$CHROME_PATH` or a standard install. No npm package is installed; the
  harness speaks the DevTools protocol over the browser's own websocket.
- A model endpoint. The clean room gets a private `HERMES_HOME` with one config file and no
  keys; it points at the local endpoint the machine already serves
  (`E2E_MODEL`, `E2E_PROVIDER`, `E2E_BASE_URL`; defaults `deepseek-v4.1-flash:cloud` on
  `http://127.0.0.1:11434/v1`).

Nothing here runs in `.github/workflows/verify.yml`: a check that needs a model is not a
deterministic check, and the CI comment says so on purpose. G3 runs locally, or headless on
any machine that has those four things.

## Honest limits

- One run is a sample. The model is the same class as the worker, not a different vendor; a
  hostile or very weak model could pass a weak `expect:` or fail a good one. That is why the
  card's claim is written down and asserted, rather than judged from a screenshot by eye.
- The clean room is a directory, not a container: the agent *could* wander out of it. It is
  clean because nothing there points at the repo, not because it is jailed.
- `--prompt` overrides the card so a harness bug can be debugged. It is recorded as
  `prompt_source: override` in `card.json`, and an override run is not card evidence.
