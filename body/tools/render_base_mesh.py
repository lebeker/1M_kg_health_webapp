"""Render the Blender Studio female base body (CC0) for inspection."""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path("/Users/denistatarenko/Work/other/1M_kg_health_webapp/body/shots/base-mesh")
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath="/Users/denistatarenko/Work/other/1M_kg_health_assets/human-base/human_base_meshes_bundle.blend")

keep = {"GEO-body_female_realistic", "GEO-body_female_realistic.eye.L", "GEO-body_female_realistic.eye.R"}
for o in list(bpy.data.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

scene = bpy.context.scene
for o in keep:
    obj = bpy.data.objects[o]
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

body = bpy.data.objects["GEO-body_female_realistic"]
xs = [v.co.x for v in body.data.vertices]
zs = [v.co.z for v in body.data.vertices]
for o in keep:
    obj = bpy.data.objects[o]
    for v in obj.data.vertices:
        v.co.x -= (min(xs) + max(xs)) / 2
        v.co.z -= min(zs)

scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.05, .055, .065, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .5
scene.view_settings.view_transform = "AgX"

for name, loc, power in [("k", (-.8, -1.2, 2.2), 380), ("f", (.7, -.5, 1.5), 150)]:
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.size = .8
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.9)) - o.location).to_track_quat("-Z", "Y").to_euler()

cam_data = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.clip_start = .001


def shot(name, pos, target, scale):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


shot("base-front", (0, -3, 0.9), (0, 0, 0.9), 1.9)
shot("base-side", (3, 0, 0.9), (0, 0, 0.9), 1.9)
shot("base-head", (0, -3, 1.55), (0, 0, 1.55), 0.32)
shot("base-crotch", (0, -3, 0.85), (0, 0, 0.85), 0.40)
