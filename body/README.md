# Body layers and model repair

`index.html` is the original standalone three.js body viewer, restored from commit `2bb386c`.
Its eight-layer rail, eye toggles, sex switch, skin control, collapse button and three view modes
are retained. The React app is unchanged.

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

## State at date — the left list (T10)

The left column is one list, newest on top: the future above, the past below, no FUTURE/PAST
captions, and the row the reader picked marked black. It mixes what the document holds — analyses,
diagnoses, decisions — with two rows the page makes itself: an annual marker stamped `01-01` of
the year after the one it covers, and the today summary, which is the first row and is generated at
launch, never stored as an event. Clicking a row moves the ruler to that day and scrolls the row to
the middle of the panel.

The rules (order, annual marker, today row) live in `lib/state-list.js`, pure and DOM-free, so
`scripts/state-list.test.ts` can state them as dates. The page only decides what a row looks like.
The body's layer rail now sits under the list in the same column; the collapse button folds the
whole column, which is the width the stage's framing maths has always assumed.

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
