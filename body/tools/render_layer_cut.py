"""Render the pelvic window of the cardio and nervous layers, male and female variants."""
import bpy, bmesh
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/layer-cut"
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1100
scene.render.resolution_y = 1000
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.02, .02, .025, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .4
scene.view_settings.view_transform = "AgX"

cam_data = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.clip_start = .001

lights = []
for name, loc, power, size in [("k", (-.3, -.4, 1.2), 60, .4), ("f", (.3, -.2, .9), 20, .4)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = size
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, .82)) - o.location).to_track_quat("-Z", "Y").to_euler()


def clip(o, zmin, zmax):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.transform(bm, matrix=o.matrix_world, verts=bm.verts)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < zmin or v.co.z > zmax], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    o.matrix_world.identity()


def load(name):
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{name}.glb"))
    o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    clip(o, .70, .98)
    m = bpy.data.materials.new("m")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (.75, .12, .12, 1)
    o.data.materials.clear()
    o.data.materials.append(m)
    return o


def shot(name, pos, target, scale):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


for variant in ("cardio", "cardio-female"):
    load(variant)
    shot(variant, (-.25, -.5, .95), (0, 0, .83), .34)
for variant in ("nervous", "nervous-female"):
    load(variant)
    shot(variant, (-.25, -.5, .95), (0, 0, .83), .34)
