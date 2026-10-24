# HISTORY — every asset, tool and attempt behind the health map

A record of what we pulled in, what we tried to build ourselves, and why each thing was kept or
dropped. Newest decisions at the bottom.

## What this is for

The health case is **not** a medical atlas. The body is a schematic map: an androgynous figure
with layers, organs as simple shapes, and — when you click an organ — a constellation of separate
organ nodes. Position inside that constellation does not have to be anatomical. What matters is
the graph: users add their own nodes (diseases, analyses, protocols), the same way papers work in
science-kg, and the graph behaves as a database. Assets (scans, documents) live beside it, not in
it. Detailed models (3D4Medical and friends) are a different product with a different price.

## Sources

| source | licence | what it actually contains | verdict |
|---|---|---|---|
| **Z-Anatomy** (`Startup.blend`, 307MB, from the Z-Anatomy repo) | models **CC BY-SA 4.0**, code GPL-3 | 7,184 objects in nine system collections (skeletal, muscular, cardio, nervous, lymphoid, visceral, regions, teeth, hair, nails); 4.1M triangles; **male only** — its female genital collections exist by name and hold zero meshes | **in use**: every layer except the female tract and female surface |
| **BodyParts3D** (`isa_BP3D_4.0_obj_99.zip`, 143MB) | CC BY-SA 2.1 JP | ~3,000 named parts, no layers, no materials; parts list has **zero** rows for uterus, ovary, vagina, vulva, clitoris, breast | rejected — no layers, no female organs |
| **Blender Studio Human Base Meshes v1.2.0** (`human_base_meshes_bundle.blend`, 50MB, blender.org download) | **CC0** | a clean female base body (`GEO-body_female_realistic`, 10,582-vert cage, multires level 3, A-pose, 1.64 m) plus eyes; a stylized sibling at 12,502 verts | **in use** as the female surface: fitted to the atlas skeleton and exported at level 1 (167,596 verts / 83,798 tris / 6.37MB) |
| **Blender Studio body scan** — "Body female realistic by Dan Ulrich" on Wikimedia Commons (Dan Ulrich, Paul Kotelevets, Tonatiuh de San Julián, Julien Kaspar) | **CC0** | a real female body, 5.4M triangles, watertight, A-pose, 1.64 m; **its head is a mannequin's — roughly 3× the skull, no face** | superseded: the pose fits the skeleton no better than the atlas and the head is unusable |
| **MakeHuman / MPFB2** | output CC0, code AGPL | procedural humans with sliders for gender, age, height, head size, complexion, pose; needs the asset pack (GBs) plus the Blender addon | evaluated, not used — the CC0 scan was faster and looks better; revisit when proportions/pose must be dialled per user |
| **Sketchfab — "Female reproductive system" by Ebers** (`445e5d3977d848419253a4058137555f`) | **Standard**, `isDownloadable: false`, store price **$149** | 238,542 faces, the best-looking tract we found | unusable — paid store model, no download even when logged in |
| **AnatomyTOOL Open3DModel** | **non-commercial** | female pelvis and organ scans | blocked from this machine (connection returns 000, same as the user's VPN block); licence rules it out for a paid product anyway |
| **NIH 3D Print Exchange** | public domain per model | searched for tracts and pelvises; nothing better than the above | not used |

## Our own builds

| attempt | what it did | outcome |
|---|---|---|
| `export_layers.py` … `export_v4.py` | `object.join()` + `transform_apply` per layer | dead: Z-Anatomy's left/right parts share mesh datablocks → `Cannot apply to a multi user` on hundreds of objects |
| `export_v5.py` | accumulate evaluated meshes into one bmesh with world matrices baked in | worked, but 46MB per layer (materials + unmerged verts) |
| `export_v9.py` | + weld, single material, `recalc_face_normals` | **shipped**: 8 layer GLBs, 4.1M → 645k triangles, 15MB; normals fix removed a hard vertical seam |
| `export_organs2.py` | per-organ export with curated sex keys | **shipped**: 104 organs, per-organ colour, 6.3MB; the first run produced 12.8MB and two identical "sex variants" |
| `build_female.py` | ellipsoids and cones for uterus, ovaries, vagina | rejected — disconnected eggs, wrong placement |
| `build_female2.py` | metaballs merged into one surface | rejected — 696 polygons, blobby, uncontrollable |
| `build_female3.py` / `build_female4.py` | swept surfaces: elliptical rings along a spine, anchored to the bladder, later to bone landmarks (symphysis, ischial tuberosity) | **shipped**: 8 organs, 3.6k triangles, mottled mucosa texture; needed three placement passes |
| `make_female_skin.py` (v1) | gaussian push of the crotch into the body | rejected — crumpled ring, bulge stayed |
| `make_female_skin2.py` | clamp the bulge to a plane fitted through the surrounding ring | rejected — inverted triangles, black shading |
| `make_female_skin3.py` / `…4.py` | cut the genital faces, fill the hole, smooth | rejected — fan cap shades black, spikes at the rim |
| `make_female_skin5.py` / `…6.py` | cut and dilate the cut, add breast mounds | rejected — rim spikes, mounds read as a seam |
| `make_female_body.py` | decimate the CC0 scan, fit height to the atlas body, rotate Z-up → Y-up, export GLB | **shipped** as `skin-female.glb` (97k triangles) |

## Lessons we paid for

- Z-Anatomy is the only open atlas that ships layers, and it is male-only. Its female collections
  are empty shells — check the mesh count before trusting a collection name.
- Never deform a decimated, welded body surface to change sex: cutting leaves spikes, filling the
  hole produces a fan that shades black, and pushing vertices inverts triangles. A different body
  needs a different mesh.
- Place anatomy against landmarks (bladder bbox, pubic symphysis, ischial tuberosity), never by eye.
  The first tract sat 5.5 cm below the pelvic floor because the numbers were invented.
- A surface from another body cannot wrap this skeleton without retargeting. That is acceptable
  here, because the map is schematic — but it means "skin" is a reference surface, not an envelope.

## Direction as of 2026-10-23

Schematic and cartoonish beats detailed: an androgynous body, organs as simple shapes, click an
organ to open its constellation of organ nodes with real organ silhouettes. The graph is the
database; scans and documents are assets beside it.

## Designed map — 2026-10-24

`body/` now uses the **Forma** direction: ivory canvas, sage sculpted surface, restrained clay
system colors, soft studio lighting, three layer views, and organ constellations containing real
3D miniatures. The old atlas exports remain reference files; runtime loads only
`body/models/designed/` (about 6.44 MB for the complete page and its loaded assets).

- Surface: atlas reference → voxel retopology → relaxation → decimation → final subdivision.
  One schematic androgynous surface is shared across the sex variants.
- Organs: curated 21 general organs from the 104-part reference, grouped to avoid overlapping
  membranes and duplicate liver segments, plus the existing 12 male / 8 female structures.
- Heart: independently evaluated source ventricles and atria, ascending aorta and aortic arch.
  Chamber miniatures export independently; the valve is a dedicated three-leaflet model.
- Source object selection and collection visibility made the first chamber exports disappear.
  Evaluate into independent mesh datablocks, combine with bmesh, and export new objects rather
  than carrying hidden atlas collection state forward. Source curves must be converted too.
- The first screenshots washed out because material color-space conversion and high light
  exposure compounded. Runtime hex colors now convert from sRGB to linear and lighting is lower.
- Three visual review passes corrected light, color, label collisions, silhouette smoothing,
  chamber miniatures and separated-layer framing. Final screenshots are in `body/shots/`;
  the first two passes are retained in `body/shots/review/`.
- `body/store.js` provides async graph methods with local persistence; `fixture.js` supplies
  the heart neighbourhood only when no graph is embedded. Create/connect, reload, multi-organ
  attachment, cascade delete, graph IDs, docs and sex props were exercised in Chrome.
- Local Metal/Chrome measurement at 1280×800: about 60 fps over 240 frames, 16.8 ms p95,
  all layer visibility toggles enabled, no console errors during the checked flows.

Rebuild scripts and tests are under `body/tools/`; art, API, fixture and attribution details are
in `body/README.md`. The React app and source reference assets were not changed.

## Correction after model review — 2026-10-24

The Forma pass above was rejected: it degraded good atlas geometry and prioritised interface
work while failing to replace the inadequate female tract. Its 6.44 MB / 60 fps measurements
refer to that experiment, not to the current default viewer.

- Restored the original `body/index.html` viewer and direct use of the original GLBs. The ten
  preserved system/surface/organ/male files match `2bb386c` byte-for-byte. The earlier interface
  is moved aside to `body/constellation.html`.
- Populated the layer rail before loading, added explicit failed-file reporting, and exercised
  the actual vendored GLTFLoader and original event handlers in a source-level regression test.
  This is not a live browser render test; browser access was previously declined.
- Replaced the female reproductive model with 19 independently named authored meshes,
  117,456 triangles, including cervical/vaginal walls, inner rugae, tubal infundibula/fimbriae,
  ovaries, ligaments, external anatomy and a short female urethra. Editable Blender source and
  before/after renders are included. The old eight-part tract is retained for comparison.
- Used pelvis landmarks and then BVH triangle crossing tests, rather than judging placement
  only from the front. Initial placement intersected bone. Anteflexion and adnexal placement
  were corrected without altering the skeleton. Final authored meshes are manifold and have
  zero reported surface crossings with the unchanged atlas bones and bladder. The atlas
  skeletal pelvis is still male; these checks do not establish clinical or patient-specific fit.
- Female mode hides the shared atlas's male urethra and ejaculatory ducts; male mode retains
  them. Female common-organ count is 101, male 104; reproductive variants are 19 / 12 meshes.

See `body/MODEL_REPAIR.md`, `body/models/repair/` and `body/tools/build_female_repair.py`.
The preview server is intentionally left running for the user's review.

## Female surface — 2026-10-24

The CC0 Dan Ulrich scan is gone from the runtime. Measured against the atlas skeleton it is a
different person in a different pose: arms further out, hands 16 cm wide of the bones, and a head
that is a mannequin's shell — no face, roughly three times the skull, exactly the "3 times bigger
than the scull" the review called out. No scaling fixes that, because the head is not a head.

Two attempts before the switch, both recorded as rejected:

| second attempt | what it did | outcome |
|---|---|---|
| `build_female_skin_atlas.py` (deleted) | remap the **atlas male** skin into a female profile: height-banded taper, breast push, genital shrink | rejected — the atlas skin is 343 separate islands (hair clumps, finger parts); remapping leaves plates and torn seams |
| same file, second pass | cut the genital faces out and cap the opening with an ellipsoid mound | rejected — the cut boundary is ragged, the patch floats; every variant reads as a hole with an egg in it |

The surface now comes from `body/tools/build_female_skin_base.py`, which opens the Blender Studio
bundle and does, in order: bake transforms, weld the seams (`remove_doubles` at 0.8 mm — the bundle
is assembled from primitives that are not welded), scale to 1.743 m, centre on x, align the depth
centre to the skeleton, adduct the arms 9 degrees, swing the forearms in 17 degrees about the
elbow (the base mesh's forearms flare 16 cm wider than this skeleton's), widen the iliac band by
10.5 % (the atlas pelvis is wider than the base mesh's hips), relax the hand blockout with four
smoothing passes, drop the eye spheres (they glow through a 22 %-opacity shell), and export at
multires level 1.

Result: **167,596 verts / 83,798 triangles / 6.37 MB**. Every skeleton vertex but 1,179 of 51,778
lies inside the shell; of those, 1,163 are the toe tips. The skull sits inside the head with a
plausible soft-tissue layer, the limbs wrap the bones, and the crotch is a female mound.

`skinbits` (teeth, hair, nails) is loaded as the **male** variant, so the female view no longer
shows a male hair cap or a tuft of pubic hair at the crotch.
