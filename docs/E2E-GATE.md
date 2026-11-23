# The e2e is a reviewer's step; the pipeline only checks the record

GitHub cannot run the real end-to-end check. The run needs a model — an agent that installs the KG
skill, fills a `kg.json`, opens the page and looks at it — and a runner has no model. Any job that
pretends otherwise is decorative: it would test a fixture and call it a person.

So the split is:

| who | does | leaves |
|---|---|---|
| reviewer — a person, or an agent with a model, locally | clone `lebeker/1M_kg_skill` into an empty directory, put this repo's `body/` template in it, render a `kg.json` through the skill, open the page, look at all three columns and the summary | a chat log, a screenshot, and `review/verdict.json` |
| CI — `bun run review:gate` | reads the verdict, and refuses to believe it if the page moved since | green, or red with the reason |

That is the whole gate. There is no receipt, no clean-room harness and no browser driving in the
pipeline, because none of those can run where the model isn't.

## The record

`review/verdict.json`:

```json
{
  "reviewer": "Denis Tatarenko",
  "when": "2026-11-23T19:12:41.512Z",
  "passed": true,
  "conclusions": "three columns at 1280, all three collapse to rails and expand, the summary reads as a story",
  "surface": "3f9a1c6b0e7d2a84",
  "tested_sha": "6b1bb64…",
  "artifacts": ["review/artifacts/2026-11-23/chat.log"]
}
```

Written by whoever ran it, never by CI:

```sh
bun scripts/review.ts --pass --conclusions "what you actually saw" --artifact review/artifacts/chat.log
bun scripts/review.ts --fail --conclusions "the forecast panel is empty below the fold"
```

## Why `surface` and not a commit sha

The commit carrying the verdict has a different sha from the one that was reviewed — you cannot sign
a commit before it exists. So the verdict names the **surface**: a hash of the files that decide what
the page looks like — `body/`, `src/`, `kg_demo.json`, `scripts/build-demo.ts`, `scripts/build-case.ts`
(`SURFACE_PATHS` in `scripts/lib/review.ts`).

- Adding the verdict does not move the surface, so the verdict stays valid for its own commit.
- Changing the template, the demo document or either build script does, so every older verdict goes
  stale and `verify` is red until somebody runs the e2e again.

That is the enforcement: a page nobody looked at cannot be green, and a page that changed after
somebody looked at it is not green either.

## What `verify` is red for

- `review/verdict.json` missing — nobody ran it.
- `passed: false` — they ran it, it failed, and their sentence is printed in the log.
- `surface` mismatch — the page moved since the review.
- an artifact named in the verdict that is not in the tree.

`verify` is a required check on `main`, so none of these can be merged around — except by the owner
bypassing branch protection. The repository cannot prevent that, and history shows it happening:
`6b1bb64` and the three before it landed with `Bypassed rule violations` in the push output.

## Honest limits

- A verdict is a person's word with a timestamp and a hash attached. It is not a proof that the page
  was good — it is proof that somebody was shown it and said so, which is all a reviewer step ever is.
- The surface list is a decision, not a law: a file that changes the page but sits outside those paths
  (the anatomy models under `body/models/`, for instance, are inside `body/` and covered) would go
  unreviewed. Extend `SURFACE_PATHS` when the page grows a new input.
- The gate cannot tell a careful verdict from a careless one. It can only make the careless one
  visible, in a file, named.
