# Body view — the health webapp's first surface

Static prototype of the 3D body the health case is built on. No build step: `index.html`
plus eight GLB files in `models/`, loaded with three.js.

Open it through any static server (GLTF cannot be fetched over `file://`):

```bash
python3 -m http.server 8770 --bind 127.0.0.1
# http://127.0.0.1:8770/body/
```

## What it does

- **Three views** — one body (muscles translucent), one layer pulled out, all layers apart.
- **Legend** — collapsible rail, one row per layer *type*, each with a count and an eye that
  hides it. Hidden layers drop out of the spread lineup.
- **Organs** — 104 separate meshes, each with its own name and colour (liver brown, lungs pink,
  gut tan, kidneys red-brown). Click-through and per-organ nodes come next.
- **Sex switch** — wired to the `sex` app-prop; swaps the reproductive set (12 atlas meshes for
  male, 8 modelled organs for female). Clicking a legend *row* pulls that layer out of the body
  — the eye only hides it.

## The sex prop

The graph declares the props the app may render; the app reads them instead of hard-coding:

```json
"meta": {
  "app": "health",
  "props": {
    "sex": { "type": "enum", "values": ["female", "male"], "default": "male" }
  }
}
```

`kg set-meta --key props --value '{...}'` stores that as a JSON object (values that start with
`{` or `[` are parsed). The view derives the switch from `props.sex`, so a graph that does not
declare it gets no switch.

## The female model — modelled, because no atlas has one

Z-Anatomy ships **male genitalia only**. Its female collections exist by name and are empty:

| collection | meshes |
|---|---|
| `Female genital system'` | **0** |
| `Uterus'`, `Ovary'`, `Vagina'`, `Vulva'`, `Clitoris'` | **0** each |
| `Male genital system'` (for contrast, organs live in `8: Visceral systems`) | 12 meshes |

BodyParts3D has no female organs either (zero rows for uterus/ovary/vagina in its parts list).
So the female set is **modelled parametrically** in the atlas's own pelvis coordinates:
`Uterus`, `Cervix`, `Vagina`, `Vulva`, `Ovary.l/.r`, `Uterine tube.l/.r` — 8 organs, 2,614
triangles, 77KB (`../1M_kg_health_assets/build_female.py`). It is stylised, not scanned, and the
body surface around it is still the male-pattern skin. To replace it with anatomy:

1. **Slicer / OpenAnatomy "Female Pelvis" atlas** — CC BY, real scans, pelvis + pelvic organs.
   Would replace the modelled set with a scanned one, but still not a whole female body.
2. **Sketchfab CC BY** female anatomy models — usually whole-body, mixed quality, licence
   per-model, needs manual cleanup.
3. **Commission or buy** a female surface (with breasts) and female pelvis, merge into the same
   atlas — the only route to a *female body*, not just female organs.
4. **Ship male-only** and keep the switch out until there is data.

## Files

| file | what |
|---|---|
| `models/skin.glb`, `skinbits.glb` | body surface; teeth, hair, nails |
| `models/muscles.glb`, `bones.glb` | merged per layer |
| `models/cardio.glb`, `nervous.glb`, `lymphoid.glb` | vessels and nerves (mostly curves in the source) |
| `models/organs.glb` | 104 organs, one mesh each, coloured |
| `models/reproductive-male.glb` | 12 organs, from the atlas |
| `models/reproductive-female.glb` | 8 organs, modelled |
| `lib/` | three.js r146 (UMD) |
| `shots/` | the four states, 2× |

The mesh pipeline that produced these lives in `../1M_kg_health_assets/` (`export_v9.py` for the
layers, `export_organs2.py` for the organs).
