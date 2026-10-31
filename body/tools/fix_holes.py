import bpy, bmesh, json

SRC = "/Users/denistatarenko/Work/other/1M_kg_health_webapp/body/models/organs.glb"
OUT = "/tmp/organs-closed.glb"

# a lumen is a real opening: an airway, a gut, a vessel. Everything else that is open is a defect.
TUBES = ("bronch", "trachea", "pharynx", "larynx", "intestin", "colon", "duoden", "jejun",
         "ileum", "rectum", "ureter", "urethra", "esophag", "oesophag", "artery", "vein",
         "sinus", "duct", "papilla", "canal", "meatus", "tube", "vessel")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

filled, skipped = [], []
for ob in bpy.context.scene.objects:
    if ob.type != "MESH":
        continue
    name = ob.name
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    boundary = [e for e in bm.edges if len(e.link_faces) == 1]
    if not boundary:
        bm.free()
        continue
    if any(t in name.lower() for t in TUBES):
        skipped.append((name, len(boundary)))
        bm.free()
        continue
    before = len(bm.faces)
    try:
        bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    except Exception as e:
        print("ERR", name, e)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    after = len(bm.faces)
    bm.to_mesh(me)
    me.update()
    bm.free()
    filled.append((name, len(boundary), after - before))

print("FILLED", len(filled))
for f in filled:
    print("FILL", json.dumps({"name": f[0], "boundary": f[1], "facesAdded": f[2]}))
print("LEFT_OPEN_TUBES", len(skipped))

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False,
                          export_apply=True, export_yup=True)
print("WROTE", OUT)
