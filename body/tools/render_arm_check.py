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
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.07, .075, .085, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .7
scene.view_settings.view_transform = "AgX"
for name, loc, power in [("k", (-.9, -1.2, 2.2), 300), ("f", (.8, -.6, 1.5), 120), ("b", (0, 1.4, 1.8), 90)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .6
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 1.2)) - o.location).to_track_quat("-Z", "Y").to_euler()
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
    m = bpy.data.materials.new(name + str(alpha))
    m.use_nodes = True
    n = m.node_tree.nodes["Principled BSDF"]
    n.inputs["Base Color"].default_value = (*colour, 1)
    n.inputs["Alpha"].default_value = alpha
    n.inputs["Roughness"].default_value = .5
    if alpha < 1:
        m.blend_method = "BLEND"
    for o in new:
        o.data.materials.clear()
        o.data.materials.append(m)
    return new


def shot(name, pos, target, scale):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cd.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


# female arm, straight on and from the front at hand level
load("skin-female2.glb", (.86, .78, .72))
shot("arm-front", (0, -3, 1.10), (0, 0, 1.10), .70)
shot("hand-front", (.31, -3, .86), (.31, 0, .86), .28)
shot("hand-side", (3, .02, .86), (.31, 0, .86), .28)
shot("hand-top", (.31, .001, 3), (.31, 0, .86), .28)
