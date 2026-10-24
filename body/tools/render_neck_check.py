import bpy
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/skin-inspect"
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 40
sc.cycles.use_denoising = True
sc.render.resolution_x = 700
sc.render.resolution_y = 700
sc.world = bpy.data.worlds.new("w")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (.08, .085, .095, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = .8
sc.view_settings.view_transform = "AgX"
for name, loc, power in [("k", (-.9, -1.2, 2.0), 300), ("f", (.9, -.8, 1.4), 130)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .5
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 1.48)) - o.location).to_track_quat("-Z", "Y").to_euler()
cd = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.type = "ORTHO"
cd.clip_start = .001
cd.ortho_scale = .34

before = {o.name for o in sc.objects}
bpy.ops.import_scene.gltf(filepath=str(MODELS / "skin-female2.glb"))
new = [o for o in sc.objects if o.type == "MESH" and o.name not in before]
m = bpy.data.materials.new("skin")
m.use_nodes = True
n = m.node_tree.nodes["Principled BSDF"]
n.inputs["Base Color"].default_value = (.87, .79, .74, 1)
n.inputs["Roughness"].default_value = .45
for o in new:
    o.data.materials.clear()
    o.data.materials.append(m)

for pos, tag in [((0, -3, 1.52), "front"), ((3, 0, 1.52), "side"), ((0, 3, 1.52), "back")]:
    cam.location = pos
    cam.rotation_euler = (Vector((0, 0, 1.52)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = str(OUT / ("neck-%s.png" % tag))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", tag, flush=True)
