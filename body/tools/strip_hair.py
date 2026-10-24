"""Strip the hair from the atlas skinbits and from the male atlas skin.

skinbits.glb is 58 loose parts: an 8,085-vertex scalp cap, 21 pubic tufts, ~35 tooth/nail parts.
skin.glb carries its own hair cap as a 3,789-vertex island on top of the head. Both caps are fitted
to the male head and fit nothing else, so both are removed: skinbits2.glb keeps teeth and nails,
skin2.glb is the same body with a bald head.
"""
import numpy as np
import trimesh

BASE = "/Users/denistatarenko/Work/other/1M_kg_health_webapp/body/models/"


def parts_of(path, min_verts=12):
    s = trimesh.load(BASE + path, force='scene')
    g = list(s.geometry.values())[0]
    return g, [p for p in g.split(only_watertight=False) if len(p.vertices) >= min_verts]


# --- skinbits: drop the scalp cap and the pubic tufts ------------------------------------------
mesh, parts = parts_of("skinbits.glb")
keep, hair, pubic = [], 0, 0
for p in parts:
    c = p.vertices.mean(axis=0)
    if len(p.vertices) > 2000 and p.bounds[0][1] > 1.45:
        hair += 1
        continue
    if (0.78 < c[1] < 0.96) and c[2] > 0.02 and abs(c[0]) < 0.10:
        pubic += 1
        continue
    keep.append(p)
out = trimesh.util.concatenate(keep)
out.export(BASE + "skinbits2.glb")
print("WROTE skinbits2.glb parts", len(keep), "hair", hair, "pubic", pubic, "verts", len(out.vertices), flush=True)

# --- male skin: drop the hair cap island, keep every other island (the atlas is a patchwork) ---
mesh, parts = parts_of("skin.glb", min_verts=1)   # keep the tiny patches: the atlas is a patchwork
keep, hair = [], 0
for p in parts:
    lo, hi = p.bounds
    if len(p.vertices) > 2000 and lo[1] > 1.45 and hi[1] > 1.70:
        hair += 1
        continue
    # loose strand fragments that were separate islands above the crown
    if len(p.vertices) < 400 and p.vertices.mean(axis=0)[1] > 1.66:
        hair += 1
        continue
    keep.append(p)
out = trimesh.util.concatenate(keep)
out.export(BASE + "skin2.glb")
print("WROTE skin2.glb parts", len(keep), "hair", hair, "verts", len(out.vertices), flush=True)
