"""Render the v3 tract: front, side, top, and a close-up of the right adnexa."""
import bpy, math
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "shots/model-review-v3"
OUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BASE / "models/repair/female-repair-v3.blend"))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new("studio")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.05, .06, .075, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = .55
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -.3

def area(name, loc, power, size, colour):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.shape = "DISK"
    d.size = size
    d.color = colour
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, .02, .86)) - o.location).to_track_quat("-Z", "Y").to_euler()

area("key", (-.20, -.24, 1.10), 4.0, .25, (1, .87, .80))
area("fill", (.22, -.06, .95), 1.3, .22, (.72, .84, 1))
area("rim", (.02, .22, 1.00), 2.2, .20, (1, .82, .72))

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.clip_start = .001
cam_data.clip_end = 10

def render(name, pos, target, scale):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.ortho_scale = scale
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)

render("v3-front", (0, -.40, 1.00), (0, .02, .872), .245)
render("v3-side", (.40, -.01, .95), (0, .02, .872), .245)
render("v3-top", (0, .001, 1.25), (0, .02, .872), .22)
render("v3-adnexa", (0, -.30, .96), (.052, .034, .912), .085)
render("v3-adnexa-side", (.30, .034, .96), (.052, .034, .912), .085)
render("v3-vulva", (0, -.28, .83), (0, -.026, .796), .075)
