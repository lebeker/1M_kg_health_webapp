# Model repair — 24 October 2026

## Scope correction

The first Forma pass degraded working atlas layers while leaving the inadequate female set
substantially unchanged. That was the wrong tradeoff. This repair restores the original viewer
and original whole-body meshes, then replaces the female reproductive model itself.

`index.html` again uses `models/*.glb`; the simplified `models/designed/` assets are excluded
from the default page. Ten original GLBs match commit `2bb386c` exactly. Only
`models/reproductive-female.glb` is replaced. The earlier UI is retained at `constellation.html`.

## Authored model

The replacement is a 19-mesh assembly, 117,456 triangles, with no image textures. It uses
continuous sampled surfaces with explicit walls, rims and caps rather than a stack of Blender
primitives. Organs have separate object names and can be selected independently in Blender.

The uterus has a broad rounded fundus, a tapering corpus and a flexed lower body. Cervical and
vaginal walls include real luminal surfaces. Vaginal folds are geometric relief on the inner
wall. Fallopian tubes include an isthmus, wider ampulla, distal funnel, and individual fimbriae;
the distal ends remain separate from the ovarian cortex. Ovaries have authored almond profiles
and shallow cortical relief. External anatomy is modelled as folded surfaces and an articulated
clitoral assembly. The short female urethra replaces the long male one in female mode.

The previous model is retained in `models/repair/reproductive-female-before.glb` for comparison.
The editable final file is `models/repair/female-repair.blend`.

## Placement and iterations

Measurements came from the existing atlas: bladder bounds, pubic symphysis, hip bones and sacrum
are recorded in `models/repair/landmarks.json`. Coordinates use metres with Blender Z-up;
GLB export converts to the viewer's Y-up convention.

The first isolated render was incorrectly framed and too bright. The next inspection showed
clearer organ shapes, but triangle intersection checks exposed pelvic collisions. The uterine
body and adnexa were anteflexed over the bladder; the ovaries were moved into the pelvic cavity;
the round-ligament attachments and clitoral crura were adjusted. This retained the original
skeleton instead of deforming it to hide fit errors.

The final checks report:

- 19 meshes; 117,456 triangles.
- Zero non-manifold edges in the authored meshes.
- Zero triangle-surface crossings against the atlas bone mesh.
- Zero triangle-surface crossings against the atlas bladder mesh.
- Every preserved original GLB matches its baseline SHA-256 hash.
- Actual vendored GLTFLoader parses all current models; viewer scene/event regression passes.

Reports are `geometry-report.json`, `fit-report.json` and `original-integrity.json` under
`models/repair/`. Surface-crossing tests do not establish tissue-volume clearance, clinical
accuracy or a fit to the separate female scan. The reference skeletal pelvis is still the
atlas's male pelvis. The new anatomy is an authored map model, not a female patient scan.

Front, side, and pelvic-context renders are under `shots/model-review/`. The side context is a
**render-only cutaway** of the near half of the reference bones so placement can be inspected.
It does not modify or replace the shipped skeleton GLB.

## Rebuild

`build_female_repair.py` generates the source `.blend`, candidate GLB and mesh report in
`models/repair/`. `check_female_fit.py` loads the candidate and the unchanged atlas geometry.
With `-- --install`, it installs the candidate as `models/reproductive-female.glb` only when
all authored meshes are manifold and the crossing checks pass. `render_female_repair.py`
renders the candidate, the retained earlier model, and the pelvic context through Cycles.
The landmark extractor requires the original `Startup.blend` path in `pelvis_landmarks.py`.

The earlier `build_models.py` whole-body simplification script is not part of this repair and
must not be used to overwrite the preserved atlas layers.

## Anatomy references

These references informed structure and relationships; no textbook mesh or image was copied:

- [OpenStax, ovarian reproductive anatomy](https://openstax.org/books/anatomy-and-physiology-2e/pages/27-2-anatomy-and-physiology-of-the-ovarian-reproductive-system):
  uterus, cervix, tubes, fimbriae, ovaries and external structures.
- [NCBI Bookshelf, anatomy of the uterus](https://www.ncbi.nlm.nih.gov/books/NBK470297/):
  fundus/corpus/isthmus/cervix and anteversion/anteflexion.
- [NCBI Bookshelf, anatomy of the fallopian tube](https://www.ncbi.nlm.nih.gov/sites/books/NBK547660/):
  tubal regions and distal separation from the ovary.

## Verification limit

The UI regression test uses real GLB parsing and three.js scene objects, with test adapters for
the DOM, renderer and orbit controls. Blender renders verify model shape and placement.
No new live browser or frame-rate claim is made for this restored viewer: earlier browser
access was declined, and that restriction was respected. The old 6.44 MB / 60 fps report belongs
to the removed default experiment, not this restored full-resolution model set.
