"""Build the female surface from the Blender Studio CC0 base mesh.

The atlas skin is male and its crotch is a patchwork of separate islands; the CC0 scan's head is
a mannequin's. The Blender Studio base mesh is a clean female body with a real head, in an A-pose:
it only needs to be scaled to the atlas height, centred, and its arms adducted to meet the
skeleton's arms.

Run: Blender -b --python body/tools/build_female_skin_base.py
"""
import bpy, numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
BUNDLE = "/Users/denistatarenko/Work/other/1M_kg_health_assets/human-base/human_base_meshes_bundle.blend"
# the bundle uses a non-ASCII hyphen in these names: match on the ASCII suffix instead
TARGET_HEIGHT = 1.743
ARM_DEGREES = 9.0
FOREARM_DEGREES = 17.0

bpy.ops.wm.open_mainfile(filepath=BUNDLE)
_bodies = [o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("body_female_realistic")]
BODY_NAME = _bodies[0].name
KEEP = [BODY_NAME]   # the eyes are separate spheres that glow through the 22%-opacity shell
for o in list(bpy.data.objects):
    if o.name not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)

# bake transforms, centre on x, feet on z=0
for name in KEEP:
    obj = bpy.data.objects[name]
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# the bundle's body is assembled from primitives that are not welded: merge the seams
import bmesh
for name in KEEP:
    obj = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

body = bpy.data.objects[KEEP[0]]
xs = np.array([v.co.x for v in body.data.vertices])
zs = np.array([v.co.z for v in body.data.vertices])
ys = np.array([v.co.y for v in body.data.vertices])
cx = (xs.min() + xs.max()) / 2
z0 = zs.min()
scale = TARGET_HEIGHT / (zs.max() - zs.min())

for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        v.co.x = (v.co.x - cx) * scale
        v.co.y = v.co.y * scale
        v.co.z = (v.co.z - z0) * scale
    obj.data.update()

# skeleton centre for the depth alignment
_before = {o.name for o in bpy.context.scene.objects}
bpy.ops.import_scene.gltf(filepath=str(MODELS / "bones.glb"))
bones = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.name not in _before)
bco = np.array([bones.matrix_world @ v.co for v in bones.data.vertices])
dy = (bco[:, 1].min() + bco[:, 1].max()) / 2 - (ys.min() + ys.max()) / 2 * scale
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        v.co.y += dy
    obj.data.update()
bpy.data.objects.remove(bones, do_unlink=True)

# adduct the arms to the skeleton's A-pose
pivot = Vector((0.185, 0.0, 1.400))
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        side = 1.0 if v.co.x >= 0 else -1.0
        ax = abs(v.co.x)
        if ax < 0.16 or v.co.z < 0.95:
            continue
        t = min(1.0, max(0.0, (ax - 0.16) / 0.10))
        w = t * t * (3 - 2 * t)
        px = pivot.x * side
        dx, dz = v.co.x - px, v.co.z - pivot.z
        a = np.radians(-ARM_DEGREES * side) * w
        v.co.x = px + dx * np.cos(a) - dz * np.sin(a)
        v.co.z = pivot.z + dx * np.sin(a) + dz * np.cos(a)
    obj.data.update()

# the forearm: the base mesh's hands splay out about 25 degrees wider than the skeleton's
elbow = Vector((0.250, 0.0, 1.105))
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        if v.co.z > 1.135:
            continue
        side = 1.0 if v.co.x >= 0 else -1.0
        w = min(1.0, max(0.0, (1.150 - v.co.z) / 0.13))
        w = w * w * (3 - 2 * w)
        px = elbow.x * side
        dx, dz = v.co.x - px, v.co.z - elbow.z
        a = np.radians(-FOREARM_DEGREES * side) * w
        v.co.x = px + dx * np.cos(a) - dz * np.sin(a)
        v.co.z = elbow.z + dx * np.sin(a) + dz * np.cos(a)
    obj.data.update()

# the male pelvis is wider than this base mesh's hips: widen the iliac band so the crests sit inside
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        g = np.exp(-(((v.co.z - 0.975) / 0.075) ** 2))
        v.co.x *= 1.0 + 0.105 * g
    obj.data.update()

# the base cage's hands are a blockout of separate prisms: relax that region so the shell reads as a hand
for name in KEEP:
    obj = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    hand = [v for v in bm.verts if abs(v.co.x) > 0.195 and v.co.z < 0.985]
    if hand:
        for _ in range(4):
            bmesh.ops.smooth_vert(bm, verts=hand, factor=0.55, use_axis_x=True,
                                  use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

# the bundle carries a multires at level 3: exporting that is 100 MB of mesh; one level is plenty
for name in KEEP:
    for m in bpy.data.objects[name].modifiers:
        if m.type == "MULTIRES":
            m.levels = 1
            m.render_levels = 1

bpy.ops.object.select_all(action="DESELECT")
for name in KEEP:
    bpy.data.objects[name].select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=str(MODELS / "skin-female.glb"), export_format="GLB",
                          use_selection=True, export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_normals=True)
print("WROTE skin-female.glb", len(body.data.vertices), "body verts, scale", round(scale, 4),
      "dy", round(dy, 4), flush=True)
