# Notice

This repository is a **collection**, not a single-licence project. The code is MIT; the anatomy
models are share-alike; part of the body surface is public domain. A reader who wants to reuse one
piece should not have to guess which rules came with it, so this file is the map: a path, its
licence, and where the licence text lives. The full texts sit in `LICENSES/`.

| path | what it is | licence | text |
|---|---|---|---|
| `src/`, `scripts/`, `index.html`, `app.json`, `body/*.html`, `body/app.js`, `body/store.js`, `body/fixture.js`, `body/style.css`, `body/lib/main-view.js`, `body/lib/state-list.js`, `body/lib/timeline-step.js`, `body/tools/`, `skills/` | the application, the build and test tools, the skills | **MIT**, © 2026 Denis Tatarenko | `LICENSE`, `LICENSES/MIT.txt` |
| `body/models/*.glb` (except the female surface and the female reproductive set), `body/models/skin-texture.png`, `body/models/repair/*.blend` for the atlas layers | the anatomy atlas as shipped and the sources it is re-exported from | **CC BY-SA 4.0** — share-alike travels with every derivative | `LICENSES/CC-BY-SA-4.0.txt` |
| `body/models/skin-female2.glb`, `body/models/repair/female-surface-fitted.blend`, the fitted female surface under `body/models/repair/` | the female body surface | **CC0 1.0** — no conditions | `LICENSES/CC0-1.0.txt` |
| `body/models/reproductive-female.glb`, `body/models/repair/female-repair.blend`, `body/models/repair/female-repair-v3.blend`, `body/models/repair/female-system-v2.blend` | the female reproductive geometry authored in this repository | **MIT**, same as the code | `LICENSE` |
| `*.md`, `docs/` (including the wireframes and the published case pages) | documentation and design material | **MIT**, same as the code | `LICENSE` |
| `body/lib/three.min.js` | three.js r146, the renderer | **MIT**, © 2010-2022 three.js authors — this file does carry its own SPDX notice | `LICENSES/MIT-three-examples.txt`, and its header |
| `body/lib/OrbitControls.js`, `body/lib/GLTFLoader.js` | two of three.js's own examples, vendored unminified | **MIT**, © 2010-2022 three.js authors — neither file carries a notice of its own, so this row is the only notice that travels | `LICENSES/MIT-three-examples.txt` |
| `body/lib/d3-dispatch.min.js`, `body/lib/d3-quadtree.min.js`, `body/lib/d3-timer.min.js` | the d3 v3.0.1 modules the force layout needs | **ISC**, © 2010-2021 Mike Bostock — the files name the holder but not the licence | `LICENSES/ISC-d3.txt` |
| `body/lib/d3-force-3d.min.js` | d3-force-3d v3.0.6, the force layout itself | **MIT**, © 2017 Vasco Asturiano — **not** ISC; the minified file carries a URL and no notice | `LICENSES/MIT-d3-force-3d.txt` |
| `body/lib/d3-octree.min.js` | d3-octree v1.1.0, the layout's spatial index | **MIT**, © 2017 Vasco Asturiano — **not** ISC; the minified file carries a URL and no notice | `LICENSES/MIT-d3-octree.txt` |
| `node_modules/` (installed, never shipped) | sigma, graphology, 3d-force-graph, React, Vite, Biome, TypeScript | each under the licence declared by its own package (`MIT`, `ISC`, `Apache-2.0`) | that package's `LICENSE` |

The published viewer artefact carries code only — `dist/graph.html`, `app.json` and
`viewer.version` — so a download of it is MIT. The models never travel in it; they are served
beside the page from `body/models/`. See `docs/RELEASE.md`.

## Attribution

The models in `body/models/` are the reason this file exists. They are credited here, at the root,
because attribution that lives only inside a subdirectory README is attribution a redistributor
never reads. `body/README.md` keeps the model-by-model detail; this is the line that must travel.

- **Z-Anatomy** — <https://github.com/Z-Anatomy/Models-of-human-anatomy> — by its contributors.
  The layers `bones`, `muscles`, `cardio`, `nervous`, `lymphoid`, `organs`, `skin` and `skinbits`
  are exports of its atlas. Licensed **CC BY-SA 4.0**.
- **BodyParts3D** — the Database Center for Life Science (DBCLS), Japan —
  <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html> — the open atlas Z-Anatomy is based
  in part on. Original set licensed **CC BY-SA 2.1 JP**.
- **Blender Studio — Human Base Meshes v1.2.0** — <https://www.blender.org/download/demo-files/> —
  the base for the fitted female surface (`skin-female2.glb`). Licensed **CC0 1.0**.
- **"Body female realistic"** — a body scan on Wikimedia Commons by Dan Ulrich, Paul Kotelevets,
  Tonatiuh de San Julián and Julien Kaspar; the earlier CC0 surface, kept in `body/models/repair/`
  as a source. Licensed **CC0 1.0**.
- **three.js** — <https://threejs.org> — rendered the layers, the organ nodes and the edges, and
  produced the inspection renders in `body/shots/`. Licensed **MIT**.
- **d3** — <https://d3js.org> — the d3 v3 modules behind the graph view (`d3-dispatch`,
  `d3-quadtree`, `d3-timer`), licensed **ISC**, © Mike Bostock; and **d3-force-3d** /
  **d3-octree** by Vasco Asturiano — <https://github.com/vasturiano/d3-force-3d>,
  <https://github.com/vasturiano/d3-octree> — licensed **MIT**, © 2017 Vasco Asturiano. The two are
  often assumed to be one licence because they are vendored side by side in `body/lib/`; they are
  not, and the rows above name the right one for each file.

The 104-organ export, the eight layered exports, the female reproductive geometry and everything
under `body/tools/` were authored in this repository; `HISTORY.md` records what was tried and what
was rejected on the way.

## What share-alike means here

If you redistribute the anatomy models — changed or unchanged — you must name Z-Anatomy and
BodyParts3D, keep **CC BY-SA 4.0** on what you redistribute, and licence your own changes to those
models under the same terms. That obligation attaches to the models and to derivatives of them. It
does not reach the code: a viewer that draws those models is a separate work, and this one is MIT.
Putting MIT code and CC BY-SA models in one repository does not relicense either part — the
repository is a collection, and this file is the boundary.
