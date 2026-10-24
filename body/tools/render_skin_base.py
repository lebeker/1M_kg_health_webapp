"""Render the female surface: alone, over the skeleton, head close-up, crotch."""
import bpy
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/skin-base"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 28
scene.cycles.use_denoising = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.06, .065, .075, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .5
scene.view_settings.view_transform = "AgX"

cam_data = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.clip_start = .001

for name, loc, power in [("k", (-.9, -1.2, 2.4), 420), ("f", (.8, -.6, 1.6), 170), ("b", (0, 1.6, 1.4), 120)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .8
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.95)) - o.location).to_track_quat("-Z", "Y").to_euler()


def clear():
    for o in list(scene.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)


def load(name, colour, alpha=1.0):
    before = {o.name for o in scene.objects}
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{name}.glb"))
    new = [o for o in scene.objects if o.type == "MESH" and o.name not in before]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes["Principled BSDF"]
    n.inputs["Base Color"].default_value = (*colour, 1)
    n.inputs["Alpha"].default_value = alpha
    n.inputs["Roughness"].default_value = .55
    if alpha < 1:
        m.blend_method = "BLEND"
    for o in new:
        o.data.materials.clear()
        o.data.materials.append(m)
    return new


def shot(name, pos, target, scale):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


clear()
skin = load("skin-female", (.82, .72, .66))
shot("base-front", (0, -3, 0.88), (0, 0, 0.88), 1.95)
shot("base-side", (3, 0, 0.88), (0, 0, 0.88), 1.95)
shot("base-head", (0, -3, 1.55), (0, 0, 1.55), 0.34)
shot("base-crotch", (0, -3, 0.86), (0, 0, 0.86), 0.44)
shot("base-hand", (0.30, -3, 0.92), (0.30, 0, 0.92), 0.30)

clear()
load("bones", (.92, .90, .86))
load("skin-female", (.82, .72, .66), alpha=.30)
shot("base-both-front", (0, -3, 0.88), (0, 0, 0.88), 1.95)
shot("base-both-head", (0, -3, 1.56), (0, 0, 1.56), 0.30)

clear()
load("skin-female", (.82, .72, .66), alpha=.25)
load("muscles", (.70, .32, .30), alpha=.55)
shot("base-both-muscles", (0, -3, 1.15), (0, 0, 1.15), 1.10)
