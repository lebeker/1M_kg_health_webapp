# HANDOVER — 1M_kg_health_webapp

## DESCRIPTION

`1M_kg_health_webapp` is the 3D layer of the `kg` skill's health case: a schematic, cartoonish,
androgynous body whose layers (skin, muscles, bones, cardio-vascular, nervous, lymphoid) and organs
are **nodes of a graph**, not decoration. The body is the map, the graph is the database.

- Repo: `~/Work/other/1M_kg_health_webapp` (own git repo, GitHub `lebeker`, Pages from `/body`)
- Live: https://lebeker.github.io/1M_kg_health_webapp/body/
- Stack: one file, `body/index.html` — three.js r146, `d3-force-3d`, no build step
- Models: `body/models/*.glb` (atlas organs, skin, layers) + `skin-texture.png`
- Tests: `body/tools/probe.py` (CDP driver), `acceptance.py`, `acceptance_mouse.py`,
  `acceptance_organs.py`, `stability.py`, `stress.py`
- Tags (reset points): `health-20261030q-pre-refactor` (`7a15d39`),
  `health-20261031d` (`05e448d`, user-approved UI: hexagon, organs in front, body root row)

How it works, in one paragraph: `LAYERS` are the seven body layers; `ORGAN_TREE` is the organ
hierarchy (circulatory/heart 17 parts, airway·lungs 36, digestive 45, urinary 10, reproductive 14,
nose·pharynx 16 = 138). `state.out` says which layers stand outside the body, `state.nodeOut` says
which organ nodes and which single meshes have been taken out. `buildOrganNodes()` turns the rows of
that tree into `THREE.Group` nodes with an edge each; `layout()` places layers on a ring and the
graph beside the body; `updateEdges()` draws the lines; `updateAnalyses()` places the document marks.

## GOAL

Make the organ graph behave like a **proper force graph over a body map**:

1. **Split works.** "Split into systems" puts the six organ systems on screen as separate nodes, close
   to the `organs` set, and the camera frames body + set + nodes in one view.
2. **Edges are between nodes.** Every edge starts and ends on a node — never on another edge, never in
   empty space. A parent node always exists.
3. **A split organ keeps its centre.** A splittable organ (digestive, lungs, heart, …) that has parts
   taken out keeps a **transparent copy of the whole organ** at its node, so its edges radiate from an
   organ and every part has somewhere to be put back into.
4. **Everything is placed by forces, not by slots.** Nodes that carry edges — organ nodes, sub-organ
   nodes and the analysis documents — get their positions from springs/repulsion, not from fixed
   angles, margin boxes or hash scatter.
5. **Sizes are stable.** An organ's size does not change when some of its parts are taken out.

## LIST OF PROBLEMS

1. **Split leaves the graph looking like one model.** The six systems used to be scattered inside a
   one-unit blob, and the camera fit asked for a 21-unit stand-off, so the result read as a frozen,
   tiny picture. *Partially fixed:* systems are now seeded on a Fibonacci sphere around the set
   (radius 1.65), pulled by a spring toward the set and pushed apart by collision; the split camera is
   capped at 9 units. Spread measured 1.65.
2. **The frame is off-centre.** The body sits at the left edge and part of the graph falls outside the
   view; the horizontal shift for the left panel (`dx`) does not cancel the bbox centre. *Open.*
3. **A split organ has no transparent centre.** When a system is expanded into its parts, the edges
   meet at an empty point. A ghost of the whole organ is now built for any node that has parts out
   (opacity 0.22, drawn from each part's home transform), but it only appears once a *part* is out,
   and its placement has not been checked on screen. *Open.*
4. **Organ size depends on what is left.** With only the liver and the pancreas still "in", they were
   scaled up to fill the node because the fit box was measured over the meshes present. The box is now
   measured over **all** parts of the organ (their home transforms), so the scale is constant. *Fixed
   in code, not yet seen on screen.*
5. **Edges attach beside the model.** `updateEdges()` draws from `node.position`; for a split organ the
   meshes sit at anatomical offsets, so the line starts beside the organ. A `hubLocal()` fix existed and
   was reverted with the whole tree. *Open.*
6. **Sub-organ edges had no node at their parent end.** `pn.parent` is a *row*, not a node, so
   `pn.parent.node` was `undefined` and the line fell back to a bare point. *Fixed once, reverted with
   the tree; must be re-applied.*
7. **Document marks do not hold their spring.** Measured distances after the relaxation are
   1.6 / 2.1 / 3.7 / 4.1 / 4.2 instead of one value — something after `updateAnalyses()` still moves
   them. *Open.*
8. **A refactor was interrupted.** `paint()` still allocates a `MeshStandardMaterial` per mesh and never
   disposes; `state.organsOut` has two writers (one faked by the Escape handler); `layout()` is still
   ~150 lines mixing slots, visibility, ghost, head cut and camera.

## LIST OF ISSUES

1. `body/index.html` is one 2,700-line file with no module boundaries; every fix touches the same
   function. Splitting `layout()` into `placeLayers / applyVisibility / frameCamera` is the first
   structural step.
2. No regression test covers the **split** path end-to-end: `acceptance_*` check selection, panel,
   timeline and visibility, but nothing asserts "six nodes, six edges, all inside the frame, no edge
   without an endpoint". That is why a broken split shipped twice.
3. No test asserts **edge endpoints are on models** (`|edge start − model centre| < ε`).
4. The dev server (`python3 -m http.server 8770`) dies silently; every headless run that returns
   `ready: False` has been a dead server, not a broken page. Check `curl` before believing a failure.
5. `body/models/organs.glb` carries a hole fix (stomach and 12 other meshes closed with
   `bmesh.ops.holes_fill`; 60 → 47 open meshes, the rest are lumens by design). The script is not in
   the repo — only `/tmp/fix_holes.py` — and should be committed as `body/tools/fix_holes.py`.
6. The reverted tag `health-20261031d` is the last known-good state. Anything that breaks the split
   again should be reverted to it rather than patched forward.
7. Git policy: **no force pushes, tags are never moved**; reverts are normal commits.
