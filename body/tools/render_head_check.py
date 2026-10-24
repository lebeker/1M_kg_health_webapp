import bpy
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/skin-inspect"
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.06, .065, .075, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .6
scene.view_settings.view_transform = "AgX"
for name, loc, power in [("k", (-.8, -1.1, 2.2), 240), ("f", (.7, -.6, 1.6), 110)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .5
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 1.6)) - o.location).to_track_quat("-Z", "Y").to_euler()
cd = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cd)
scene.collection.objects.link(cam)
scene.camera = cam
cd.type = "ORTHO"
cd.clip_start = .001


def load(name, colour, alpha=1.0):
    before = {o.name for o in scene.objects}
    bpy.ops.import_scene.gltf(filepath=str(MODELS / name))
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


def shot(name, pos, target, scale):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cd.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


load("muscles.glb", (.72, .34, .32))
load("skin-female2.glb", (.86, .78, .72), alpha=.40)
shot("head-front", (0, -3, 1.60), (0, 0, 1.60), .32)
shot("head-side", (3, 0, 1.60), (0, 0, 1.60), .32)
load("skin.glb", (.60, .60, .66), alpha=.35)
shot("head-side-male", (3, 0, 1.60), (0, 0, 1.60), .32)
