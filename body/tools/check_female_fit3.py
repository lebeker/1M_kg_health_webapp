"""Validate the v3 tract: manifold meshes, no crossings with the atlas bones or bladder."""
import bpy, bmesh, json, sys, shutil
from pathlib import Path
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(BASE / "models/repair/female-repair-v3.blend"))
model = [o for o in bpy.context.scene.objects if o.type == "MESH"]


def tree(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.transform(bm, matrix=o.matrix_world, verts=bm.verts)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


bpy.ops.import_scene.gltf(filepath=str(BASE / "models/bones.glb"))
bone = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o not in model)
bt = tree(bone)
out = {}
for o in model:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bad = sum(not e.is_manifold for e in bm.edges)
    bm.free()
    pairs = tree(o).overlap(bt)
    out[o.name] = {"bone_surface_crossings": len(pairs), "nonmanifold_edges": bad}
    if pairs:
        pts = [o.matrix_world @ o.data.vertices[i].co for a, b in pairs for i in o.data.polygons[a].vertices]
        out[o.name]["crossing_bounds"] = [[min(p[i] for p in pts) for i in range(3)],
                                          [max(p[i] for p in pts) for i in range(3)]]

prev = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(BASE / "models/organs.glb"))
bladder = next(o for o in bpy.context.scene.objects if o not in prev and o.type == "MESH" and "bladder" in o.name.lower())
bt = tree(bladder)
for o in model:
    out[o.name]["bladder_surface_crossings"] = len(tree(o).overlap(bt))

(BASE / "models/repair/fit-report-v3.json").write_text(json.dumps(out, indent=2))
bad = {k: v for k, v in out.items() if v["bone_surface_crossings"] or v["bladder_surface_crossings"] or v["nonmanifold_edges"]}
print(json.dumps({"meshes": len(out), "problems": bad}, indent=2), flush=True)

if "--install" in sys.argv:
    assert not bad, "v3 fails validation"
    shutil.copyfile(BASE / "models/repair/reproductive-female-v3.glb", BASE / "models/reproductive-female.glb")
    print("INSTALLED v3", flush=True)
