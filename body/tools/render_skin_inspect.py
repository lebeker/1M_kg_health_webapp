"""Close inspection of the current female surface: arms, shoulder, legs."""
import bpy
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/skin-inspect"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 28
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.05, .055, .065, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .55
scene.view_settings.view_transform = "AgX"

cam_data = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.clip_start = .001

for name, loc, power in [("k", (-.9, -1.3, 2.3), 420), ("f", (.9, -.7, 1.6), 180), ("b", (0, 1.7, 1.3), 140)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .8
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, .95)) - o.location).to_track_quat("-Z", "Y").to_euler()


def load(name, colour, alpha=1.0):
    before = {o.name for o in scene.objects}
    bpy.ops.import_scene.gltf(filepath=str(MODELS / (name + ".glb")))
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
    cam_data.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


load("skin-female2", (.83, .74, .68))
shot("skin-front", (0, -3, .88), (0, 0, .88), 1.9)
shot("skin-side", (3, 0, .88), (0, 0, .88), 1.9)
shot("skin-arm", (0.32, -3, 1.10), (0.32, 0, 1.10), .55)
shot("skin-legs", (0, -3, .40), (0, 0, .40), .80)
shot("skin-hand", (0.33, -3, .90), (0.33, 0, .90), .40)
