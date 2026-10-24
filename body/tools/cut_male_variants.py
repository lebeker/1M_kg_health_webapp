"""Cut the male genital supply out of the cardiovascular and nervous layers.

The atlas is male: the testicular vessels, the prostatic and penile branches and the penile
nerves have no place in the female body. The layers are single merged meshes, so the cut is
spatial and deliberately narrow:

  * anything within 4 mm of the external male organs (testis, epididymis, penis, prostate,
    seminal glands) — the penile arteries, the prostatic plexus, the dorsal nerves;
  * anything inside a narrow midline box below the pelvic brim (|x| < 34 mm, anterior half,
    z < 0.845) — the spermatic cord vessels on their way to the scrotum.

The ductus deferens is deliberately not part of the proximity mask: it runs beside the external
iliac vessels and would take them with it.

Run: Blender -b --python body/tools/cut_male_variants.py
"""
import bpy, bmesh
from pathlib import Path
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
RADIUS = 0.004
EXTERNAL = ("Testis", "Epididymis", "Seminal", "Prostate", "Glans", "Corpus")


def in_box(co):
    return abs(co.x) < 0.034 and co.z < 0.845 and co.y < 0.010


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(MODELS / "reproductive-male.glb"))
mask_objs = [o for o in bpy.context.scene.objects
             if o.type == "MESH" and o.name.startswith(EXTERNAL)]

verts_all, faces_all = [], []
for o in mask_objs:
    mw = o.matrix_world
    base = len(verts_all)
    verts_all += [mw @ v.co for v in o.data.vertices]
    faces_all += [tuple(base + i for i in p.vertices) for p in o.data.polygons]
mask = BVHTree.FromPolygons([tuple(v) for v in verts_all], faces_all, all_triangles=True)
print("mask objects", len(mask_objs), "tris", len(faces_all), flush=True)

for layer in ("cardio", "nervous"):
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{layer}.glb"))
    o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    me = o.data
    before = (len(me.vertices), len(me.polygons))

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.transform(bm, matrix=o.matrix_world, verts=bm.verts)
    doomed = [v for v in bm.verts if in_box(v.co) or mask.find_nearest(v.co, RADIUS)[0] is not None]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()

    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=str(MODELS / f"{layer}-female.glb"), export_format="GLB",
                              use_selection=True, export_apply=True, export_yup=True,
                              export_materials="EXPORT", export_normals=True)
    print(layer, "before", before, "after", (len(me.vertices), len(me.polygons)),
          "cut_vertices", len(doomed), flush=True)
