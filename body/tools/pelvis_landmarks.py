import bpy,json
from pathlib import Path
from mathutils import Vector
P=Path('/Users/denistatarenko/Work/other/1M_kg_health_assets/zanat/Z-Anatomy/Startup.blend')
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(str(P),link=False) as (src,dst):
 names=[n for n in src.objects if any(k in n.lower() for k in ['symphysis','rectum','anal canal','urinary bladder','hip bone','sacrum','perineal body']) and not n.endswith(('.g','.j','.t','.s','.i'))]
 print('NAMES',names,flush=True);dst.objects=names
out={}
for o in dst.objects:
 if o is None or o.type not in ['MESH','CURVE']:continue
 bpy.context.scene.collection.objects.link(o);o.hide_viewport=False;o.hide_set(False)
bpy.context.view_layer.update()
for o in bpy.context.scene.objects:
 if o.type not in ['MESH','CURVE']:continue
 ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh()
 pts=[o.matrix_world@v.co for v in me.vertices]
 if not pts:continue
 lo=[min(p[i] for p in pts)for i in range(3)];hi=[max(p[i] for p in pts)for i in range(3)]
 out[o.name]={'min':lo,'max':hi};print(o.name,[round(x,4)for x in lo],[round(x,4)for x in hi],flush=True)
 ev.to_mesh_clear()
Path('/Users/denistatarenko/Work/other/1M_kg_health_webapp/body/models/repair/landmarks.json').write_text(json.dumps(out,indent=2))
