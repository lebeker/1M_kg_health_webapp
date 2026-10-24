"""Render the female surface beside the skeleton at the same camera, plus a head close-up."""
import bpy, bmesh
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/skin-audit"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
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

for name, loc, power, size in [("k", (-.9, -1.2, 2.4), 400, .8), ("f", (.8, -.6, 1.6), 160, .8)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = size
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.95)) - o.location).to_track_quat("-Z", "Y").to_euler()


def clear():
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)


def load(name, colour, alpha=1.0):
    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{name}.glb"))
    o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes["Principled BSDF"]
    n.inputs["Base Color"].default_value = (*colour, 1)
    n.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        m.blend_method = "BLEND"
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


# surface alone, front and side
clear()
load("skin-female", (.82, .62, .55))
shot("skin-front", (0, -3, 0.9), (0, 0, 0.9), 1.9)
shot("skin-side", (3, 0, 0.9), (0, 0, 0.9), 1.9)
shot("skin-head", (0, -3, 1.62), (0, 0, 1.62), 0.36)
shot("skin-head-side", (3, 0, 1.62), (0, 0, 1.62), 0.36)

# bones alone, same camera
clear()
load("bones", (.9, .88, .82))
shot("bones-front", (0, -3, 0.9), (0, 0, 0.9), 1.9)
shot("bones-head", (0, -3, 1.62), (0, 0, 1.62), 0.36)

# surface with the skeleton inside
clear()
load("bones", (.95, .9, .7))
load("skin-female", (.85, .55, .5), alpha=.28)
shot("both-front", (0, -3, 0.9), (0, 0, 0.9), 1.9)
shot("both-head", (0, -3, 1.62), (0, 0, 1.62), 0.36)
