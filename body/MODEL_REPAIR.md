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

## Second pass — the tract rebuilt for connection

The first replacement was connected in name only: the tube ended on the ovarian pole with the
fimbriae sprouting upward, the round ligaments hung in mid-air, and the vaginal vault showed a
capped ring under the cervix. `build_female_repair2.py` rebuilds it:

- one curved pear for uterus, cervix and vault instead of stacked rings;
- the tube leaves the uterine cornu, arches over the ovary and ends in an infundibulum aimed at
  the ovarian cap;
- 18 fimbriae sweep onto that cap and stop 0.8 mm above the cortex — no tips through the ovary;
- the round ligaments are dropped (as free tubes they read as wires); the ovarian ligament runs
  into both the uterus and the ovary;
- the urethra hugs the anterior vaginal wall, the clitoris sits under the pubis;
- 18 meshes, 122k triangles, 0 non-manifold edges, 0 surface crossings against the atlas bones
  and bladder. The adnexa still need the same medial/anterior fit compromise as the first build:
  the reference pelvis is male and its iliac fossa crowds them.

Reports: `models/repair/geometry-report-v3.json`, `fit-report-v3.json`; renders in
`shots/model-review-v3/`. Editable source: `models/repair/female-repair-v3.blend`.

## Female variants of the vascular and nervous layers

The atlas is male, so the female body was still carrying the testicular vessels, the prostatic
and penile branches and the penile nerves. Both layers are single merged meshes, so
`cut_male_variants.py` cuts them spatially: anything within 4 mm of the external male organs,
plus anything inside a narrow midline box below the pelvic brim (|x| < 34 mm, anterior half,
z < 0.845), which takes the spermatic cord vessels. The ductus deferens is left out of the
proximity mask on purpose — it runs beside the external iliac and would take it with it.

`models/cardio-female.glb` (50,343 verts) and `models/nervous-female.glb` (71,790 verts) are
loaded beside the male files and swapped by the sex switch. Renders: `shots/layer-cut/`.

## The female surface

`skin-female.glb` is no longer the CC0 Dan Ulrich scan. That scan is a different person in a
different pose, and its head is a mannequin shell — no face, about three times the skull, which is
the "3 times bigger than the scull" the review flagged. Nothing about it can be scaled into shape.

The surface is now built by `tools/build_female_skin_base.py` from the Blender Studio **Human Base
Meshes v1.2.0** bundle (CC0):

1. open the bundle, keep `GEO-body_female_realistic`, bake its transforms;
2. weld the seams — the bundle is assembled from primitives that are not welded (0.8 mm
   `remove_doubles`), otherwise every part boundary shows as a crack;
3. scale the 1.641 m cage to the atlas height, 1.743 m; centre on x; move the depth centre onto
   the skeleton's;
4. widen the iliac band by 10.5 % (the atlas pelvis is wider than the base mesh's hips);
5. relax the hand blockout with four smoothing passes so the shell reads as a hand;
6. drop the eye spheres (they glow through the 22 %-opacity shell) and export at multires level 1.

The arms are rotated 10° about the shoulder, rigidly, inside the arm cylinder. The selection must
be by distance to the arm bones, never by |x| — an |x| gate catches the outer thighs and folds the
legs into a skirt — and the hand needs its own test (|x| > 0.235 below the wrist): it is wider than
the cylinder, and cutting it slices the fingers off. A smooth axial fade over the first 10 cm
keeps the deltoid attached. Earlier attempts that rotated by an |x| gate, a height gate, a raw
distance mask, or a second rotation at the elbow each tore the armpit, sheared the hand or folded
the figure.

Result: **167,596 verts / 83,798 triangles / 6.37 MB**. Fit test: 51,772 of 51,778 skeleton
vertices lie inside the shell; the skin's widest point (33.6 cm) and the skeleton's (33.5 cm)
coincide. Reports and renders: `shots/skin-base/`, `shots/skin-audit/` (the old scan).

Rejected on the way here: remapping the atlas male skin into a female profile (the atlas skin is
343 separate islands — the result is plates), and cutting its genital faces out to cap the hole
with a mound (the cut rim is ragged and the patch floats). Both are recorded in `HISTORY.md`.

The male `skinbits` mesh (teeth, hair, nails) is loaded as the male variant, so the female view
does not show a male hair cap or a pubic tuft.
