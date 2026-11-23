# Body layers and model repair

`index.html` is the original standalone three.js body viewer, restored from commit `2bb386c`.
Its eight-layer rail, eye toggles, sex switch, skin control, collapse button and three view modes
are retained. The React app is unchanged.

It is also the template: the document goes into its `#kg-graph` placeholder, and the page never
fetches one. The case page is that same template with the case document in the placeholder, written
by the repository's second build target (see the root README) into `dist/` output, with the page's
`lib/` beside it. Open `index.html` for the empty start, the built page for the case.

```sh
python3 -m http.server 8770 --bind 127.0.0.1
# http://127.0.0.1:8770/body/
```

The viewer loads the original files directly from `models/`. **Skin, skin bits, female surface,
muscles, skeleton, cardiovascular, nervous, lymphatic, the 104 common organ meshes and the male
reproductive set are preserved byte-for-byte.** It does not load `models/designed/`.
`models/repair/original-integrity.json` records SHA-256 checks against the original commit.

The layer rail is populated before GLBs load, refreshed as each layer arrives, and loading
failures are shown in the footer. `window.__ready()` requires successful loading;
`window.__loadErrors()` returns missing/failed model names. A failed asset no longer leaves an
empty rail with no explanation.

## Replacement female reproductive geometry

`models/reproductive-female.glb` now contains **19 separately named meshes, 117,456 triangles**,
authored in the atlas's metre-scale coordinates. It replaces the earlier eight-part, low-resolution
swept model. The new source is `models/repair/female-repair.blend`.

- Uterus with a rounded fundus, broad corpus, tapering isthmus and anteflexion over the bladder.
- A separate cervix with a cervical canal; vaginal walls with a superior vault and inner rugae.
- Two curved uterine tubes with flared infundibula and individual fimbrial projections.
- Two almond-shaped ovaries with subtle cortical relief and a medial hilum.
- Paired ovarian and round ligaments.
- Separate labia majora, labia minora, vestibular bulbs, and a clitoral body/glans/crura assembly.
- A short female urethra.

Female mode hides the male urethra and two ejaculatory ducts in the common atlas export and
shows the new female urethra instead. Male mode retains those original parts. Counts reflect
the active anatomy: 104 common meshes in male mode, 101 in female mode, and 12 / 19 meshes in
the male / female reproductive variants.

The model is placed against the unchanged atlas bladder, symphysis, sacrum and hip bones.
The final mesh passes the authored-model manifold checks and the triangle-surface crossing
check against the atlas bones and bladder. These are geometric checks, not clinical validation:
the atlas skeleton remains male, and the separate CC0 female surface is not retargeted to it.

See [MODEL_REPAIR.md](MODEL_REPAIR.md) for the build, fitting iterations, references and exact
verification limits. Blender inspection renders are in `shots/model-review/`:

- `female-front-final.png`, `female-side-final.png`
- `female-pelvis-front-final.png`, `female-pelvis-side-final.png`
- `female-before-front.png` — the earlier model, at the same inspection scale

## Rebuilding and checking

```sh
~/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python body/tools/build_female_repair.py
~/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python body/tools/check_female_fit.py -- --install
~/Applications/Blender.app/Contents/MacOS/Blender -b -t 6 --python body/tools/render_female_repair.py
node body/tools/viewer-regression.test.mjs
```

The source-level regression test loads all GLBs through the actual vendored GLTFLoader and
exercises the viewer's event handlers and scene state. It covers all eight layer rows, eye
visibility, three modes, sex variants, sex-specific common parts, skin visibility and collapse.
DOM, renderer and orbit controls are test adapters: **this is not a live browser/WebGL test**.
Current geometry was rendered directly in Blender. Browser access was declined during the
previous work and was not bypassed for this repair.

## Split regression (T24)

```sh
bun run test:split                 # curl-checks the server, starts one on 8770 if it is dead
node body/tools/split-regression.mjs --root <tree> --port 8771   # run it on another tree
```

`split-regression.mjs` presses the viewer's own "split into systems" button in a Node VM, then
asserts the four things a working split has: six systems, six edges, every edge endpoint on a node
(and none in another edge's span), and every node inside the camera frame once the movement
settles. The page, its scripts and the GLBs come over the local HTTP server, so a missing file is
that server's 404 and not a broken page; the harness curls the server first and exits 2 with an
instruction when it is dead (LIST OF ISSUES 4). Exit 1 means the split is wrong.

It is part of `bun run verify` and of the CI `verify` job. The frame it asserts is `splitFrame()` in
`index.html`: the six systems and the set are fitted in 3D, aimed at their own centre, so the ball
of each node stays inside the frustum clear of the rail and the open panel. Framing them as a flat
box in the body's plane and aiming at z = 0 is what left five of six systems off screen
(LIST OF PROBLEMS 2).

## The timeline — time is the navigator (T07)

The strip under the header runs from birth to forty years past today: year ticks outside a ±2-year
window around today, month ticks inside it, future ticks painted by the annual risk at that age, and
one click anywhere selects that calendar day (no wheel scroll — the strip is not a scroller). The
ruler's arithmetic lives in `lib/timeline-step.js` for the player and in `index.html` for the
geometry.

**Widget 6 (the player) lives in the main view's header**, at the centre column's top-right, as
`wireframe-health-v11-analysis.svg` draws it — not in the page bar with the graph button and the
profile. `start` / `prev` / `next` / `end` step between **events**, and a step opens the record it
lands on, so stopping on an event never reads "no record on this date".

A click on a bare stretch between two events keeps the column: it collapses to its own header
(`#main.bare`), because the player is the navigator and must not vanish under the reader's hand. The
body is not drawn — an empty panel would be a lie — and the header says `no record on this date`
(`no records` for an empty document). The ✕ closes the whole column deliberately; the next date the
reader picks brings it back.

## State at date — the left list (T10)

The left column is one list, newest on top: the future above, the past below, no FUTURE/PAST
captions, and the row the reader picked marked black. It mixes what the document holds — analyses,
diagnoses, decisions — with two rows the page makes itself: an annual marker stamped `01-01` of
the year after the one it covers, and the today summary, which is the first row and is generated at
launch, never stored as an event. Clicking a row moves the ruler to that day and scrolls the row to
the middle of the panel. The page opens on the list's first row — today's summary — so the centre is
filled on the first paint; the list marks and the centre draws through one rule, `currentRow()`, so a
marked row and an empty centre can never sit beside each other.

Every row carries two lines, as v11 draws them: the date and the row's kind, then **the record's own
one line** — `LDL cholesterol 4.2 mmol/L · +3 more` for a panel titled "Lipid panel", `City Heart
Centre · Dr Iryna Savchenko` for a visit whose title only repeats its date, `Hyperlipidaemia` for a
diagnosis, where the label is the fact. The line is one line: the row is clipped with an ellipsis and
carries the whole text in its `title`. It is never prose the page invented — the numbers, places and
names are the document's — and it is never blank, because the label stands in when the record has
nothing else to say. A record the document marks `confirmed: false` says `not confirmed` on that line.

The today row's line is what moved and what was ignored, v11's `3 moved, 1 ignored`: a **track whose
newest reading differs from the reading before it** counts as moved (`lipids 5.2 → 5.6`), and
something the document **advised that no dated record carries** counts as ignored. Advice that has a
date is done or still ahead, and is not ignored. The case page reads `6 moved, 0 ignored`.

The row's marker is the same rule in one dot: solid for a record that has happened, dashed for one
that has not — and the four lines of the `NOTES` block under the list say exactly that, in the
wireframe's words. It is a legend, not a second list: nothing in it is a row, a count or a click.

The rules (order, annual marker, today row, the one line, moved/ignored) live in `lib/state-list.js`,
pure and DOM-free, so `scripts/state-list.test.ts` can state them as dates. The page only decides what
a row looks like. The body's layer rail now sits under the list in the same column; the collapse
button folds the whole column, which is the width the stage's framing maths has always assumed.

## Main view — the centre (T11)

Picking a record opens it in the centre, over the body. The event decides the layout: an analysis
opens its panel as a table (marker, value, reference, flag — a lipid panel is four rows, a single
test is one) with the lab, its address, a link to the original scan, the plain-language meaning and
the linked items; a diagnosis opens its verdict (an official note with doctor, clinic and links, or
a generated one with the `not confirmed` badge and no doctor link) and, separately, what was decided
— tests, drugs, diet, activity, restrictions; a summary opens plan versus fact, and carries no links
and no assignments. Records that are not a state — a decision, a visit, a drug, a document — get
their own facts instead of a panel they do not have.

The four marks carry the card's meaning: the yellow triangle says check before acting (a generated
note, or a doctor's note a later test contradicts), the skull says dangerous, do not act, a red `!`
on an assignment says a known side effect or low trust in the generator, and a yellow `!` says
plausible but unverified. Model advice is red until there is no alternative, a real diagnosis stands
behind it, or the reader applied it and it helped.

The rules live in `lib/main-view.js`, pure and DOM-free, so `scripts/main-view.test.ts` states them
as data; `docs/MAIN-VIEW.md` lists the optional keys the views read. `window.__mainView()` returns
what the page drew, for the acceptance run; the ✕ hides the view and nothing else — the record stays
selected and its row stays marked.

## Earlier interface experiment

The Forma/constellation experiment has been moved to `constellation.html`; it is not the
entry point. Its notes are in `CONSTELLATION_EXPERIMENT.md`. Its simplified system models and
performance screenshots describe that experiment only, and should not be treated as verification
of the restored high-resolution viewer. The graph/store work remains available there for later
integration without replacing working atlas geometry.

## Attribution

The unchanged atlas models are from [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy),
by its contributors, based in part on BodyParts3D by the Database Center for Life Science.
These models and atlas-derived adaptations remain under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The separate female surface is the CC0 Blender Studio/Wikimedia scan by Dan Ulrich,
Paul Kotelevets, Tonatiuh de San Julián and Julien Kaspar.

The new female reproductive surfaces are original procedural model geometry, authored here
rather than copied from atlas female collections (which are empty). three.js r146 is MIT and the
two examples vendored beside it are MIT as well, but the vendored copies do not all carry their
own notice: `three.min.js` does, `OrbitControls.js` and `GLTFLoader.js` do not, and the d3 files
name a holder but not a licence. The notices that have to travel are therefore in
[`LICENSES/`](../LICENSES/), mapped file by file in [`NOTICE.md`](../NOTICE.md).

The repository-wide licence map — which path is MIT, CC BY-SA 4.0 or CC0, and the full texts —
is [`NOTICE.md`](../NOTICE.md) and [`LICENSES/`](../LICENSES/). This section is the model-specific
detail behind it.
