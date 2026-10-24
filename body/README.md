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
rather than copied from atlas female collections (which are empty). three.js r146 and the
vendored controls/loaders retain their MIT notices in `lib/`.
