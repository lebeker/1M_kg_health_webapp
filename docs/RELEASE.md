# Release

What "public" means for this repository, and what a reader of a published version is entitled to
assume. The card behind it is T26 in `docs/PLAN-health-2026-11-12.md`, whose acceptance is four
nouns — **rename, licences, attribution, `.gitignore` for models** — and `scripts/release.test.ts`
is where each of them is a check rather than a promise.

## 1. What is published

| surface | where | built by |
|---|---|---|
| the repository | <https://github.com/lebeker/1M_kg_health_webapp>, Pages from `main` at the root | `git push` |
| the main page | `…/body/` — the health view, the demo, the anatomy | committed source |
| the viewer artefact | `dist` branch, tag `viewer-v<package.json version>` — `viewer.html`, `viewer.version`, `app.json` | `bun run build:local && bun run release` |

The artefact is **three files and nothing else**: the single-file build, its provenance stamp and
the app's declaration. No models, no Blender sources, no test fixtures. `scripts/release.test.ts`
pins that count, because "we only publish the page" is exactly the kind of claim that quietly stops
being true.

## 2. The name — `health-viewer`

One identity, three places, and they must agree:

| place | value |
|---|---|
| `app.json` → `id` | `health-viewer` — what a skill matches on |
| `app.json` → `title` | `Health map` — what a person reads |
| `package.json` → `name` | `health-viewer` — what the artefact's `viewer.version` carries |
| `.github` repo | `lebeker/1M_kg_health_webapp` |

The React viewer in this repository began as the science viewer (`kg-viewer`), and its two worked
cases are still published under `docs/lynkuet/` and `docs/catmap/`; they are the parent project's,
not this app's. A skill never routes on the npm name, so the rename is about the artefact saying
which app it is: a `viewer.version` that says `kg-viewer` is a health page claiming to be a
research map.

Renaming the GitHub repository itself is an owner action and is **not** part of this card; the
manifest URL in `app.json` and the Pages address both still name the repository as it is.

## 3. Licences

Four licences, one per kind of material. The map is `NOTICE.md`; the texts are in `LICENSES/`; the
code's licence is the root `LICENSE`.

| material | licence | text |
|---|---|---|
| the application, tools, skills, docs | MIT | `LICENSE`, `LICENSES/MIT.txt` |
| the anatomy atlas and the layers exported from it | CC BY-SA 4.0 | `LICENSES/CC-BY-SA-4.0.txt` |
| the female body surface | CC0 1.0 | `LICENSES/CC0-1.0.txt` |
| vendored three.js and d3 | MIT / ISC | the header of each file under `body/lib/` |

The root `LICENSE` stays a plain MIT text: a licence a tool recognises is worth more than a licence
with a preamble. What MIT covers, and what it does not, is `NOTICE.md`'s job.

## 4. Attribution

The CC BY-SA models must name their authors wherever they are redistributed. That credit lives in
`NOTICE.md` § Attribution — Z-Anatomy, BodyParts3D (DBCLS), Blender Studio's CC0 base meshes and
the Wikimedia scan's four authors, with URLs — and `body/README.md` keeps the model-by-model detail.
`NOTICE.md` is at the root because a redistributor reads the root.

## 5. Models — content, and the reason they are not in the artefact

`body/index.html` loads **sixteen** models from `body/models/`, 39.8 MB in total:

```
skin  skinbits2  skin-female2  skinbits-female
muscles  bones  cardio  cardio-female  nervous  nervous-female  lymphoid
organs  heart  spleen  reproductive-male  reproductive-female
```

They are committed on purpose. They are not build output of this repository — they are content the
page renders, and a fresh clone has to open the main page without a network call to somewhere else.
They also do not travel in the release artefact, which is code only.

`.gitignore` therefore keeps out what a *rebuild* drops beside them, not the models themselves:

- Blender backups and temporary saves (`*.blend1`, `*.blend2`, `*.blend@`)
- candidate exports that were never installed (`body/models/repair/reproductive-female.glb`)
- derived volume caches (`*.npz`, `body/models/repair/volume-cache/`)
- Python caches from `body/tools/*.py`

The test also checks the other direction: **no model the page loads may be ignored**. A rule that
hides a shipped model is a fresh clone with an empty body and no error until the network tab is
opened — the failure is worse than the size it saved.

Moving the models out of git (a download path with the explicit size question, T28) or out of this
repository is a product decision, not a release chore, and it is not taken here.

## 6. Publishing a version

From `main`, after the merge — never from a pull-request branch, because the artefact records the
commit it was built from and a tag is a promise about a version:

```sh
bun install
bun run verify
bun run build:local
bun run release          # dist branch + tag viewer-v<version>; needs an authenticated gh for the release page
```

`package.json` version is the tag. Bump it before publishing; `scripts/release.mjs` warns when it
has to move an existing tag, and a moved tag is a broken promise even when the bytes are fine. The
`kg` catalogue (`1M_kg_skill/scripts/apps.json`) points at the newest tag, and `node scripts/bundle.mjs`
rewrites that pointer next to the viewer — so publishing is two steps: this repository, then the
catalogue.

## 7. Verifying the release

```sh
bun run test:release      # scripts/release.test.ts, also part of `bun run test`
```

It checks the name in `package.json` / `app.json` / the built page, the existence and wording of the
four licence texts and the notice, the attribution names and URLs, the published model set (present,
tracked, not ignored), and that `release.mjs` stages exactly the three artefact files.

## 8. Not done here, and whose decision it is

- **The GitHub repository name.** `1M_kg_health_webapp` is a working title; renaming a repository
  changes its Pages URL, the `manifest_url` in `app.json` and every catalogue entry that points at
  it. Owner action, one card of its own.
- **`docs/index.html`, `docs/lynkuet/`, `docs/catmap/`.** These are the science viewer's published
  cases, inherited with the source. They are still served at `…/docs/` and still describe a research
  map. Replacing them with a health landing page, or removing them, deletes published URLs — a
  decision for the owner, not a side effect of a rename.
- **The 95 MB of `body/models/` sources and 77 MB of `body/shots/` renders.** Removing them from the
  tree would make the repository a sane download for a stranger, and would also break
  `body/README.md`'s promise that the editable Blender source is in the repository. That trade is
  the owner's.
