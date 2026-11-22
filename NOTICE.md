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
| `body/lib/three.min.js`, `body/lib/OrbitControls.js`, `body/lib/GLTFLoader.js` | three.js r146 and two of its examples | **MIT**, © 2010-2022 Three.js Authors | header of each file |
| `body/lib/d3-*.min.js` | d3-force-3d and the d3 modules it needs | **ISC**, © Mike Bostock, © Vasco Asturiano | header of each file |
| `node_modules/` (installed, never shipped) | sigma, graphology, 3d-force-graph, React, Vite, Biome, TypeScript | each under the licence declared by its own package (`MIT`, `ISC`, `Apache-2.0`) | that package's `LICENSE` |

The published viewer artefact carries code only — `dist/index.html`, `app.json` and
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
  <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/> — the open atlas Z-Anatomy is based in part
  on. Original set licensed **CC BY-SA 2.1 JP**.
- **Blender Studio — Human Base Meshes v1.2.0** — <https://www.blender.org/download/demo-files/> —
  the base for the fitted female surface (`skin-female2.glb`). Licensed **CC0 1.0**.
- **"Body female realistic"** — a body scan on Wikimedia Commons by Dan Ulrich, Paul Kotelevets,
  Tonatiuh de San Julián and Julien Kaspar; the earlier CC0 surface, kept in `body/models/repair/`
  as a source. Licensed **CC0 1.0**.
- **three.js** — <https://threejs.org> — rendered the layers, the organ nodes and the edges, and
  produced the inspection renders in `body/shots/`. Licensed **MIT**.
- **d3** — <https://d3js.org> — the force layout behind the graph view, and **d3-force-3d** by Vasco
  Asturiano — <https://github.com/vasturiano/d3-force-3d>. Licensed **ISC**.

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
