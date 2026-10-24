# Archived interface experiment

This describes the earlier Forma experiment now at `constellation.html`. It is not the default viewer.
The simplified whole-body layers were rejected and should not replace the original atlas layers.
The performance measurements and screenshots below describe that experiment only.

# Forma — a personal health map

A standalone, buildless three.js illustration and graph editor. The body is the map; a `kg/1`
graph stores the connections. The React viewer in `src/` is independent and unchanged.

From the repository root:

```sh
python3 -m http.server 8770 --bind 127.0.0.1
# Open http://127.0.0.1:8770/body/
```

This is a static site: any static host works. ES modules and GLBs require HTTP rather than
`file://`. There is no application server, build step, CDN, remote font, or runtime API request.

## Art direction

Warm ivory, forest-green typography, a sage clay figure, terracotta cardiovascular structures,
eucalyptus lungs, ochre digestive structures, and muted plum urinary/reproductive structures.
Directional studio lights, a hemisphere fill, ACES tone mapping, and a painted contact shadow
keep the scene soft. Serif headings and restrained controls frame the illustration.

The surface is derived from the atlas, voxel-retopologised, relaxed, simplified and subdivided;
fine surface details are reduced. Both sex variants use this same schematic surface. The sex
prop swaps the underlying reproductive structures. This is an illustrative, androgynous map,
not an individually fitted body or a clinical atlas.

The runtime loads only `models/designed/`. The original GLBs in `models/` remain reference
material and are never fetched by the new page. The designed models have been decimated,
smoothed, regrouped, re-materialled, and stripped of atlas textures.

There are **21 general organ meshes**, plus **12 male / 8 female reproductive structures**.
Lungs retain their separate lobe surfaces and fissures. Kidney meshes include the renal pelvis
and ureter. Liver, stomach, and coiled intestines retain their atlas silhouettes. The heart is
assembled from the actual left/right ventricles, atria, ascending aorta and aortic arch.
The constellation also loads separate ventricular/atrial geometry and a purpose-modelled
three-leaflet valve. ECG and capsule objects are built as actual three.js geometry, not icons.

The organ catalogue is intentionally curated from the 104-part reference export: overlapping
mucosal shells, fine ducts, duplicate liver segments, and atlas annotation meshes are omitted.
The nervous layer contains the atlas brain; the current independently selectable organ catalogue
does not include a separate brain mesh.

## Navigation

- **Whole body:** a softly faded torso window reveals the organ map. Background systems are
  subdued; surface, muscles, skeleton, vessels, nerves, lymphatics, organs and reproduction remain
  independently toggleable.
- **Layer focus:** click a layer row or choose mode 02. That layer moves beside the body.
- **All apart:** all visible systems separate into a lineup. Hidden layers leave the lineup.
- The eye buttons only toggle visibility. The layer rail also collapses. Keys **1 / 2 / 3**
  select the modes; **Escape** leaves the constellation. Reset restores camera framing.
- Drag the figure to rotate; scroll to zoom. Click an exposed organ, its label, or a search result
  to open its constellation. Principal labels show live adjacent-node counts; other meshes show
  the same badge on hover and in search results.
- Constellations use a radial layout with a real 3D miniature per node. Each relation is labelled
  with its graph kind. Click a miniature to open details, then follow its connected records or
  explore that record's neighbourhood. Layout has no anatomical meaning.

## Graph input and fixture

Provide a graph before `app.js` runs:

```html
<script id="kg-graph" type="application/json">
{
  "schema": "kg/1",
  "meta": {
    "app": "health",
    "props": {
      "sex": { "type": "enum", "values": ["female", "male"], "default": "male" }
    }
  },
  "nodes": [
    { "id": "my-heart", "type": "organ", "label": "Heart", "level": 0,
      "weight": 1, "props": { "mesh": "heart", "description": "Organ record" } },
    { "id": "my-ecg", "type": "analysis", "label": "ECG", "level": 1,
      "weight": 1, "props": { "mesh": "ecg", "description": "Investigation note" } }
  ],
  "edges": [
    { "from": "my-heart", "to": "my-ecg", "kind": "measured-by", "power": 1 }
  ]
}
</script>
```

`props.mesh` binds a graph record to an organ mesh. Graph IDs may differ from mesh IDs.
As a fallback, exact node ID or organ label matches also bind an organ. The manifest
`models/designed/organs.json` lists stable mesh IDs, labels, systems and sex restrictions.
An embedded graph is authoritative: fixture records are not merged into it. Organs without
matching graph records remain visual context. The sex switch only appears if declared in
`meta.props.sex`.

The integration also accepts `<script id="kg-docs" type="application/json">…</script>` with
an array or object of documents. Documents with `node`, `nodeId`, or IDs listed in a node's
`props.docs` appear in its details. Text is escaped before display. The unresolved template
placeholders `__KG_GRAPH__` and `__KG_DOCS__` are treated as absent.

With no embedded graph, `fixture.js` supplies the heart, left ventricle, right atrium, aortic
valve, hypertension, ECG, echocardiogram, beta-blocker and cardiologist. The heart initially has
8 adjacent records. A retinopathy example links the eye to a condition shared with the heart's
hypertension neighbourhood. Organ anchors are added from the manifest. Fixture records are
explicitly demonstration data, not a patient's history or treatment recommendations.

## Async store interface

All persistence lives behind `store.js`. Consumers receive copies, never internal mutable state.
The module exposes:

```js
await initStore(organAnchors);       // Once, before reading
await listNodes();                  // All node records
await listEdges();                  // All edge records
await getGraph();                   // Full kg/1 document including meta
await addNode({ label, type, props, id?, level?, weight? });
await addEdge({ from, to, kind, power? });
await removeNode(id);               // Also removes every incident edge
await removeEdge({ from, to, kind });
await addConnectedNode(node, from, kind); // Atomic create + attach
const unsubscribe = subscribe(() => { /* refresh derived views */ });
```

Node labels must be nonempty and IDs unique. Edges require existing endpoints, reject
self-links, and deduplicate identical `(from, to, kind)` triples. Writing storage happens before
publishing the updated state. A full or unavailable store causes the edit to reject visibly;
failed atomic creation never leaves an orphan node behind.

Storage uses `health-map:kg1:v1:demo` for the fixture and a deterministic source-specific key
for each embedded graph. It survives reloads on the same browser origin. No graph is uploaded.
Reset demo edits by removing that one key from browser storage. Changes on another origin or
another device are separate; there is no synchronisation or multi-user conflict handling yet.

**Add a connection** opens the editor. Choose a name, type, relation, target record, and note,
then **Create & connect**. The same editor can connect an existing record to any other organ.
Deleting a non-organ record removes all of its links. Badges and constellations refresh from the
store after each successful edit.

## Rebuild the art

Blender 4.5 is used offline only. `tools/build_models.py` reads the reference GLBs and the
original atlas `Startup.blend`; adjust its `ATLAS` path for another machine. `build_details.py`
exports chamber miniatures independently and creates the valve mesh.

```sh
~/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python body/tools/build_models.py
~/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python body/tools/build_details.py
```

The pipeline evaluates shared meshes into independent datablocks, then combines organs through
bmesh rather than relying on selection-sensitive atlas joins. The clinical source and original
reference exports are not modified.

## Verification

The three required **1280×800, 1×** screenshots are:

- `shots/final-body.png`
- `shots/final-layer.png`
- `shots/final-heart.png`

The first and second visual review
passes are retained under `shots/review/`; they led to corrected color management, reduced
lighting exposure, separated labels, softer surface topology and dedicated chamber miniatures.

`shots/validation.json` records browser checks and measured performance. On this machine,
headless Chrome using Metal at 1280×800 delivered approximately **60 fps** over 240 frames,
with a 95th percentile frame interval of **16.8 ms** and all layer visibility toggles enabled.
The loaded page was **6.44 MB uncompressed**, below the 8 MB budget. Performance is a local
measurement, not a guarantee for every device. No console exceptions or error log entries were
recorded during the tested flows.

Tests cover form-based creation, attachment to multiple organs, reload persistence and badge
increments, cascade deletion, layer toggles, sex variants, search, every mesh's graph binding,
caller-supplied IDs, document notes, and embedded-graph isolation.

```sh
node body/tools/store.test.mjs
# Start the static server first. Requires Python websocket-client and local Chrome.
FORMA_QA_EXTRA=body/tools/integration_checks.py python3 body/tools/browser_qa.py review
```

## Attribution and share-alike

Atlas-derived geometry, including the edited body surface, body systems, general organs,
chamber miniatures and male reproductive structures, is derived from
[Z-Anatomy — Models of human anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy),
by the Z-Anatomy contributors, based in part on BodyParts3D by the Database Center for Life
Science. The original atlas and **our edited atlas-derived GLBs remain licensed under
[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)**.
Retain attribution, describe modifications and distribute further adaptations of these models
under the same licence. Our modifications are listed above and the reproducible source scripts
are provided here. This geometry licence does not change the application's source-code licence.

The modelled female reproductive structures derive from the project's earlier swept-surface
models, smoothed and simplified here. The unused `models/skin-female.glb` reference is the
CC0 Blender Studio / Wikimedia scan by Dan Ulrich, Paul Kotelevets, Tonatiuh de San Julián and
Julien Kaspar; it is not loaded by this illustration. three.js r146 and its vendored loaders and
controls retain their upstream MIT notices in `lib/`.
