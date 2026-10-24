import bpy
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
OUT = BASE / "shots/skin-inspect"
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 32
sc.cycles.use_denoising = True
sc.render.resolution_x = 700
sc.render.resolution_y = 700
sc.world = bpy.data.worlds.new("w")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (.07, .075, .085, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = .7
sc.view_settings.view_transform = "AgX"
for name, loc, power in [("k", (-.8, -1.2, 2.1), 260), ("f", (.8, -.7, 1.5), 110)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .5
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 1.62)) - o.location).to_track_quat("-Z", "Y").to_euler()
cd = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.type = "ORTHO"
cd.clip_start = .001
cd.ortho_scale = .32

for name, file, colour in [("male-skin2", "skin2.glb", (.85, .78, .72)),
                            ("male-bits", "skinbits2.glb", (.95, .55, .45))]:
    before = {o.name for o in sc.objects}
    bpy.ops.import_scene.gltf(filepath=str(MODELS / file))
    new = [o for o in sc.objects if o.type == "MESH" and o.name not in before]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*colour, 1)
    for o in new:
        o.data.materials.clear()
        o.data.materials.append(m)
    for pos, tag in [((0, -3, 1.63), "front"), ((3, 0, 1.63), "side")]:
        cam.location = pos
        cam.rotation_euler = (Vector((0, 0, 1.63)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = str(OUT / ("head-%s-%s.png" % (name, tag)))
        bpy.ops.render.render(write_still=True)
        print("RENDERED", name, tag, flush=True)
