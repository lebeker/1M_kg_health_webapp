"""Build the female surface from the Blender Studio CC0 base mesh.

The atlas skin is male and its crotch is a patchwork of separate islands; the CC0 scan's head is
a mannequin's. The Blender Studio base mesh is a clean female body with a real head, in an A-pose.
This script fits it to the atlas skeleton:

  * scale to the atlas height (1.743 m), centre on x, align the depth centre to the skeleton's;
  * rotate each arm rigidly about the shoulder so it lies on the skeleton's arm — the base mesh's
    arms hang ~16 degrees wider. The membership comes from the MESH's own arm axis, not the
    skeleton's: at the hand the mesh is 15 cm away from the bone, so a capsule around the bone
    misses the hand entirely and cutting by |x| slices the fingers;
  * shift each leg inward by the measured offset between the mesh's leg centres and the bones'
    at five heights (the base mesh stands ~3 cm wider below the knee);
  * widen the iliac band (the atlas pelvis is wider than the base mesh's hips);
  * relax the hand blockout, drop the eye spheres, export at multires level 1.

Run: Blender -b --python body/tools/build_female_skin_base.py
"""
import bpy
import bmesh
import numpy as np
from mathutils import Vector
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
BUNDLE = "/Users/denistatarenko/Work/other/1M_kg_health_assets/human-base/human_base_meshes_bundle.blend"
TARGET_HEIGHT = 1.743
OUT_NAME = "skin-female2"


def smoothstep(x):
    t = np.clip(x, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def seg_perp(P, A, B):
    AB = B - A
    L2 = AB @ AB
    u = ((P - A) @ AB) / L2
    perp = np.linalg.norm(P - (A + np.clip(u, 0, 1)[:, None] * AB), axis=1)
    return u, perp


bpy.ops.wm.open_mainfile(filepath=BUNDLE)
_bodies = [o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("body_female_realistic")]
KEEP = [_bodies[0].name]          # the eyes are separate spheres that glow through the 22 % shell
for o in list(bpy.data.objects):
    if o.name not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)

for name in KEEP:
    obj = bpy.data.objects[name]
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# the bundle is assembled from primitives that are not welded: merge the seams or every part
# boundary shows as a crack
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

# --- the skeleton, in Blender coordinates (z up) ---------------------------------------------
_before = {o.name for o in bpy.context.scene.objects}
bpy.ops.import_scene.gltf(filepath=str(MODELS / "bones.glb"))
bones = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.name not in _before)
bco = np.array([bones.matrix_world @ v.co for v in bones.data.vertices])

# the muscles are the layer the shell has to wrap: aim the fit at them, not at the bare bones,
# or the shell ends up narrower than the muscle mass and the muscles push through it
_mid = {o.name for o in bpy.context.scene.objects}
bpy.ops.import_scene.gltf(filepath=str(MODELS / "muscles.glb"))
muscles = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.name not in _mid)
mco = np.array([muscles.matrix_world @ v.co for v in muscles.data.vertices])

dy = (bco[:, 1].min() + bco[:, 1].max()) / 2 - (ys.min() + ys.max()) / 2 * scale
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        v.co.y += dy
    obj.data.update()

# --- legs: measure where each leg sits relative to its bones ---------------------------------
LEG_HEIGHTS = [0.08, 0.20, 0.35, 0.50, 0.62]
mesh_co = np.array([v.co[:] for v in body.data.vertices])
deltas = []
for h in LEG_HEIGHTS:
    bm_sel = (np.abs(mco[:, 2] - h) < 0.02) & (mco[:, 0] > 0.02)
    ms_sel = (np.abs(mesh_co[:, 2] - h) < 0.02) & (mesh_co[:, 0] > 0.02)
    if bm_sel.sum() > 5 and ms_sel.sum() > 5:
        deltas.append(float(mco[bm_sel, 0].mean() - mesh_co[ms_sel, 0].mean()))
    else:
        deltas.append(0.0)

# above the hips the two legs merge into the pelvis: fade the shift out there
LEG_TOP = 0.78
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        d = float(np.interp(v.co.z, LEG_HEIGHTS, deltas))
        fade = 1.0 - smoothstep((v.co.z - (LEG_TOP - 0.10)) / 0.10)
        v.co.x += np.sign(v.co.x) * d * fade
    obj.data.update()

# --- arms: rotate each arm rigidly about the shoulder onto the skeleton's arm ----------------
# the MESH's arm axis: shoulder joint -> centroid of the mesh's hand
hand_sel = (mesh_co[:, 2] > 0.86) & (mesh_co[:, 2] < 0.94) & (mesh_co[:, 0] > 0.28)
hand_c = np.array([mesh_co[hand_sel, 0].mean(), 0.0, mesh_co[hand_sel, 2].mean()])
bone_hand_sel = (mco[:, 2] > 0.84) & (mco[:, 2] < 0.95) & (mco[:, 0] > 0.24)
bone_hand_c = np.array([mco[bone_hand_sel, 0].mean(), 0.0, mco[bone_hand_sel, 2].mean()])

SHOULDER = np.array([0.190, 0.0, 1.400])
BONE_SHOULDER = np.array([0.195, 0.0, 1.400])
angle_mesh = np.arctan2(hand_c[0] - SHOULDER[0], SHOULDER[2] - hand_c[2])
angle_bone = np.arctan2(bone_hand_c[0] - BONE_SHOULDER[0], BONE_SHOULDER[2] - bone_hand_c[2])
ARM_TURN = angle_bone - angle_mesh     # negative = towards the midline

for name in KEEP:
    obj = bpy.data.objects[name]
    P = np.array([v.co[:] for v in obj.data.vertices])
    Q = P.copy()
    Q[:, 0] = np.abs(Q[:, 0])
    A = SHOULDER
    B = np.array([hand_c[0], 0.0, hand_c[2]])
    u, perp = seg_perp(Q, A, B)
    axial = smoothstep(u * np.linalg.norm(B - A) / 0.05)
    # one smooth capsule around the MESH's own arm axis: wide enough for the hand (it lies along
    # that axis), so the whole arm turns as one piece — a separate hand test left a step at the
    # wrist that read as a twisted forearm
    radial = 1.0 - smoothstep((perp - 0.085) / 0.035)
    # the hand lies PAST the end of the axis, where the distance-to-segment grows with the
    # fingers: without forcing it the palm turns and the fingers stay behind (a claw)
    hand = (Q[:, 0] > 0.190) & (Q[:, 2] < 0.965) & (Q[:, 2] > 0.700)
    w = np.maximum(axial * radial, hand.astype(float))
    # never touch the thigh — but the fingers hang below 0.80 too, so keep anything well
    # lateral: zeroing by height alone left the fingers behind and stretched the hand
    w[(Q[:, 2] < 0.80) & (Q[:, 0] < 0.260)] = 0.0
    for i, v in enumerate(obj.data.vertices):
        if w[i] <= 0.0:
            continue
        sidev = 1.0 if v.co.x >= 0 else -1.0
        sx, sz = SHOULDER[0] * sidev, SHOULDER[2]
        dx, dz = v.co.x - sx, v.co.z - sz
        a = ARM_TURN * w[i] * sidev
        v.co.x = sx + dx * np.cos(a) - dz * np.sin(a)
        v.co.z = sz + dx * np.sin(a) + dz * np.cos(a)
    obj.data.update()

# --- hands ------------------------------------------------------------------------------------
# The base mesh's hand is a low-poly mitten made of SEPARATE prisms hanging palm-to-thigh. Twisting
# it towards the atlas' palm-forward pose tears it into blades (a ramp shears the prisms apart, a
# rigid twist opens the web between thumb and palm), so the hand keeps the pose it was modelled in.

bpy.data.objects.remove(bones, do_unlink=True)
bpy.data.objects.remove(muscles, do_unlink=True)

# --- the head sits 5 cm behind the atlas head (the base mesh's neck leans back) ---------------
# without this the face pokes out of the shell and the shell reads as a helmet
HEAD_SHIFT = +0.040  # Blender +y is glTF -z (the viewer's front): the sign was inverted, which
                     # is why every "forward" move pushed the head BACK in the app
HEAD_DROP = -0.008
HEAD_SCALE = 0.94    # the base mesh's cranium is ~6 % larger than the atlas head
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        # a SHORT blend at the top of the neck: a long one pulled the jaw and stretched the head
        w = smoothstep((v.co.z - 1.480) / 0.055)   # above the neck: moving the neck itself read as a tilt
        if w > 0:
            # rigid: scale about the neck joint, then move; blend in over the neck
            y0, z0 = 0.02, 1.47
            sy = y0 + (v.co.y - y0) * (1 + (HEAD_SCALE - 1) * w)
            sz = z0 + (v.co.z - z0) * (1 + (HEAD_SCALE - 1) * w)
            v.co.x *= 1 + (HEAD_SCALE - 1) * w
            v.co.y = sy + HEAD_SHIFT * w
            v.co.z = sz + HEAD_DROP * w
    obj.data.update()

# --- skin allowance ---------------------------------------------------------------------------
# measured against the muscle layer the shell was 0.5-2.6 cm INSIDE it at the arms, chest and
# hands, so the muscles pushed through. Push the shell out by up to 3 cm on the lateral surfaces.
for name in KEEP:
    obj = bpy.data.objects[name]
    for v in obj.data.vertices:
        w = smoothstep((abs(v.co.x) - 0.100) / 0.060)
        v.co.x += np.sign(v.co.x) * 0.018 * w
    obj.data.update()

# the base cage's hand is a blockout of separate prisms: relax it so the shell reads as a hand
for name in KEEP:
    obj = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    hand_verts = [v for v in bm.verts if abs(v.co.x) > 0.195 and 0.72 < v.co.z < 0.985]
    if hand_verts:
        for _ in range(2):
            bmesh.ops.smooth_vert(bm, verts=hand_verts, factor=0.35, use_axis_x=True,
                                  use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

# --- neck: no Adam's apple, no creases ---------------------------------------------------------
# The CC0 base mesh is modelled off a female figure, but the throat still carries a larynx bump of
# the male blockout, and the low cage folds the neck. Flatten the throat by pushing it back onto
# the neck's cylinder, then relax a WIDE band with a feathered weight — smoothing a narrow band
# leaves a crease at the edge of the smoothed set, which is what reads as a broken neck.
def smooth_feathered(bm, sel, weights, rounds, factor):
    for _ in range(rounds):
        moves = []
        for v, w in zip(sel, weights):
            if w <= 0.0:
                continue
            nb = [e.other_vert(v).co for e in v.link_edges]
            if not nb:
                continue
            avg = sum(nb, Vector((0, 0, 0))) / len(nb)
            moves.append((v, v.co.lerp(avg, factor * w)))
        for v, co in moves:
            v.co = co


for name in KEEP:
    obj = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(obj.data)

    # 1. the Adam's apple: bring the front of the larynx back to the neck's surface
    throat = []
    for v in bm.verts:
        if 1.360 < v.co.z < 1.485 and v.co.y < -0.020 and abs(v.co.x) < 0.055:
            w = smoothstep((v.co.z - 1.360) / 0.030) * smoothstep((1.485 - v.co.z) / 0.030)
            w *= smoothstep((-0.020 - v.co.y) / 0.020) * smoothstep((0.055 - abs(v.co.x)) / 0.020)
            if w > 0 and v.co.y < -0.055:
                v.co.y = -0.055 + (v.co.y + 0.055) * (1.0 - 0.75 * w)
                throat.append(w)
    # 2. a wide, feathered relax over the whole neck so no crease survives
    neck, nw = [], []
    for v in bm.verts:
        if 1.270 < v.co.z < 1.520 and abs(v.co.x) < 0.115 and -0.120 < v.co.y < 0.120:
            f = (min(smoothstep((v.co.z - 1.270) / 0.060),
                     smoothstep((1.520 - v.co.z) / 0.060)) *
                 smoothstep((0.115 - abs(v.co.x)) / 0.045) *
                 smoothstep((0.120 - abs(v.co.y)) / 0.045))
            if f > 0:
                neck.append(v)
                nw.append(f)
    smooth_feathered(bm, neck, nw, 8, 0.45)
    print("REGION throat %d neck %d" % (len(throat), len(neck)), flush=True)

    # 3. the back of the skull as "hair": one soft mass, swollen 10 % and smoothed
    HEAD_C = Vector((0.0, 0.015, 1.600))
    back, bw = [], []
    for v in bm.verts:
        if v.co.z > 1.500:
            w = (smoothstep((v.co.y - 0.010) / 0.070) *
                 smoothstep((v.co.z - 1.500) / 0.060) *
                 smoothstep((0.125 - abs(v.co.x)) / 0.050))
            if w > 0:
                d = v.co - HEAD_C
                v.co = HEAD_C + d * (1.0 + 0.105 * w)
                back.append(v)
                bw.append(w)
    smooth_feathered(bm, back, bw, 6, 0.5)
    print("REGION back %d" % len(back), flush=True)

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

# --- hair: a hairline step ---------------------------------------------------------------------
# There is no female hair mesh to wear, and the atlas cap is a pile of separate strands that
# explodes when scaled onto a differently-shaped cranium. Instead push everything above a hairline
# out by ~1.1 cm: the rim where the push starts reads as the hair's edge and the silhouette above
# it reads as a short bob.
HAIR_C = Vector((0.0, 0.020, 1.600))
for name in KEEP[:1]:
    obj = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    moved = []
    for v in bm.verts:
        if v.co.z < 1.500:
            continue
        # the hairline runs lower at the back (a nape) and higher over the forehead
        hz = 1.648 - 0.55 * (v.co.y + 0.050)
        w = smoothstep((v.co.z - hz) / 0.008)
        if w <= 0.0:
            continue
        d = v.co - HAIR_C
        v.co = HAIR_C + d * (1.0 + 0.165 * w)
        moved.append(v)
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=moved, factor=0.35, use_axis_x=True,
                              use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print("HAIRLINE %d verts" % len(moved), flush=True)

# The bundle carries a multires at level 3: exporting that is 100 MB of mesh, one level is plenty.
# Apply the level and WELD what is left: the modifier's output is unwelded (4 verts per quad), so
# every quad exports with its own normal — flat shading, which is what looked like inverted normals
# and made the shell read as dark, faceted planes in the app.
for name in KEEP:
    obj = bpy.data.objects[name]
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        if m.type == "MULTIRES":
            m.levels = 1
            m.render_levels = 1
            bpy.ops.object.modifier_apply(modifier=m.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.update()
    print("WELDED %s %d verts %d polys" % (name, len(obj.data.vertices), len(obj.data.polygons)), flush=True)

bpy.ops.object.select_all(action="DESELECT")
for name in KEEP:
    bpy.data.objects[name].select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=str(MODELS / (OUT_NAME + ".glb")), export_format="GLB",
                          use_selection=True, export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_normals=True)
print("WROTE", OUT_NAME + ".glb", len(body.data.vertices), "cage verts",
      "scale %.4f dy %.4f turn %.2f deg leg deltas %s"
      % (scale, dy, np.degrees(ARM_TURN), [round(d, 4) for d in deltas]), flush=True)
