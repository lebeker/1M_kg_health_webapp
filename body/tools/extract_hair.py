"""Extract the atlas hair cap on its own, so the female shell can wear it.

skinbits.glb holds the male scalp cap (8,085 verts, one island) together with teeth, nails and the
pubic tufts. The female head is fitted to the same atlas head, so the same cap sits on it.
"""
import trimesh

BASE = "/Users/denistatarenko/Work/other/1M_kg_health_webapp/body/models/"
s = trimesh.load(BASE + "skinbits.glb", force='scene')
g = list(s.geometry.values())[0]
parts = [p for p in g.split(only_watertight=False) if len(p.vertices) >= 12]
caps = [p for p in parts if len(p.vertices) > 2000 and p.bounds[0][1] > 1.45]
print("islands", len(parts), "caps", len(caps), "verts", [len(c.vertices) for c in caps])
cap = trimesh.util.concatenate(caps)
cap.export(BASE + "hair-male.glb")
print("WROTE hair-male.glb", len(cap.vertices), "verts", flush=True)
