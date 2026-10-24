"""Restyle atlas references into a compact, smooth clay illustration. Run in Blender 4.5.
Derived geometry: CC BY-SA 4.0, see ../README.md. Sources remain unmodified.
"""
import bpy, bmesh, re, json, math
from pathlib import Path
from mathutils import Vector
BASE=Path(__file__).resolve().parents[1]; SRC=BASE/'models'; OUT=SRC/'designed'
ATLAS=Path('/Users/denistatarenko/Work/other/1M_kg_health_assets/zanat/Z-Anatomy/Startup.blend')
OUT.mkdir(exist_ok=True)
manifest=[]
def clean(): bpy.ops.wm.read_factory_settings(use_empty=True)
def load(name):
 bpy.ops.import_scene.gltf(filepath=str(SRC/(name+'.glb')))
 return [o for o in bpy.context.scene.objects if o.type=='MESH']
def bake(o):
 o.hide_set(False);o.hide_viewport=False;o.hide_render=False
 bpy.context.view_layer.update()
 ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get())
 mesh=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=False,depsgraph=bpy.context.evaluated_depsgraph_get())
 mesh.transform(o.matrix_world)
 o.modifiers.clear();o.data=mesh;o.matrix_world.identity()
 bpy.context.view_layer.objects.active=o
def smooth(o,target=2000,iterations=3,voxel=None):
 bpy.context.view_layer.objects.active=o
 o.data=o.data.copy()
 if voxel:
  m=o.modifiers.new('Sculpted unified surface','REMESH'); m.mode='VOXEL'; m.voxel_size=voxel; m.use_smooth_shade=True
  bpy.ops.object.modifier_apply(modifier=m.name)
 m=o.modifiers.new('Relaxed clay','SMOOTH'); m.factor=.7; m.iterations=iterations
 bpy.ops.object.modifier_apply(modifier=m.name)
 if len(o.data.polygons)>target:
  m=o.modifiers.new('Illustration topology','DECIMATE'); m.ratio=target/len(o.data.polygons)
  bpy.ops.object.modifier_apply(modifier=m.name)
 for p in o.data.polygons: p.use_smooth=True
 o.data.materials.clear()
def mat(o,color):
 m=bpy.data.materials.new('Clay');m.diffuse_color=(*color,1);m.use_nodes=True
 n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=.62
 o.data.materials.clear();o.data.materials.append(m)
def export(name,objs):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objs:o.hide_set(False);o.hide_viewport=False;o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_texcoords=False,export_normals=True)
 print('EXPORTED',name,(OUT/(name+'.glb')).stat().st_size,flush=True)
def join(objs,name):
 bm=bmesh.new()
 for src in objs:
  bm.from_mesh(src.data)
 bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=.00003)
 bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
 me=bpy.data.meshes.new(name);bm.to_mesh(me);bm.free()
 o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o)
 for src in objs:bpy.data.objects.remove(src,do_unlink=True)
 for p in me.polygons:p.use_smooth=True
 return o
def record(o,id,label,system,color,sex=None):
 o.name=id;mat(o,color)
 manifest.append({'id':id,'type':'organ','label':label,'level':0,'weight':1,'props':{'mesh':id,'system':system,**({'sex':sex} if sex else {})}})

# Surface: voxel retopology removes atlas tessellation, seams and fine surface detail.
clean();o=load('skin')[0];bake(o)
for v in o.data.vertices:
 x,y,z=v.co
 if .70<z<.89 and abs(x)<.07:
  t=max(0,1-abs(z-.795)/.095)*max(0,1-abs(x)/.07)
  v.co.y=max(y,-.045-.05*(1-t))
smooth(o,12000,14,.007)
m=o.modifiers.new('Soft final silhouette','SUBSURF');m.levels=1;bpy.ops.object.modifier_apply(modifier=m.name)
o.name='surface';mat(o,(.63,.69,.65));export('surface',[o])

for name,target,color in [('bones',21000,(.82,.76,.62)),('muscles',24000,(.57,.28,.23)),('cardio',21000,(.55,.14,.12)),('nervous',23000,(.75,.50,.17)),('lymphoid',15000,(.27,.48,.38))]:
 clean();objs=load(name)
 for o in objs:bake(o);smooth(o,target,2);mat(o,color)
 export(name,objs)

clean();objs=load('organs')
# Deliberately grouped atlas parts keep their real anatomy but remove overlapping membranes.
recipes=[
 ('lung-right','Right lung','respiratory',lambda n:'lobe of right lung' in n,(.40,.61,.57)),
 ('lung-left','Left lung','respiratory',lambda n:'lobe of left lung' in n,(.40,.61,.57)),
 ('liver','Liver','digestive',lambda n:n=='liver',(.57,.27,.20)),
 ('stomach','Stomach','digestive',lambda n:n=='stomach',(.73,.43,.29)),
 ('intestine','Small intestine','digestive',lambda n:n in ['jejunum','duodenum'],(.72,.49,.34)),
 ('colon','Large intestine','digestive',lambda n:'colon' in n and 'taenia' not in n,(.59,.37,.27)),
 ('kidney-left','Left kidney','urinary',lambda n:n in ['kidney.l','ureter.l','renal pelvis.l'],(.53,.24,.28)),
 ('kidney-right','Right kidney','urinary',lambda n:n in ['kidney.r','ureter.r','renal pelvis.r'],(.53,.24,.28)),
 ('bladder','Bladder','urinary',lambda n:n=='urinary bladder',(.66,.53,.32)),
 ('pancreas','Pancreas','digestive',lambda n:n=='pancreas',(.76,.56,.25)),
 ('gallbladder','Gallbladder','digestive',lambda n:n=='gallbladder',(.36,.49,.24)),
 ('thyroid','Thyroid','endocrine',lambda n:n=='thyroid gland',(.60,.37,.45)),
 ('trachea','Trachea','respiratory',lambda n:n=='trachea',(.49,.62,.60)),
 ('oesophagus','Oesophagus','digestive',lambda n:n=='oesophagus',(.66,.43,.32)),
 ('adrenal-left','Left adrenal gland','endocrine',lambda n:n=='suprarenal gland.l',(.72,.53,.27)),
 ('adrenal-right','Right adrenal gland','endocrine',lambda n:n=='suprarenal gland.r',(.72,.53,.27)),
 ('tongue','Tongue','digestive',lambda n:n=='tongue',(.63,.36,.37))]
made=[]
for id,label,system,match,color in recipes:
 selected=[o for o in objs if o.name in bpy.context.scene.objects and match(re.sub(r'\.\d+$','',o.name).lower())]
 if not selected: print('MISSING',id);continue
 for o in selected:bake(o);smooth(o,1800 if 'lung' not in id else 1400,4)
 objs=[o for o in objs if o not in selected]
 o=join(selected,id);record(o,id,label,system,color);made.append(o)
# Append real atlas chambers, vessels, spleen, eyes and cortex.
with bpy.data.libraries.load(str(ATLAS),link=False) as (src,dst):
 names=['Right ventricle','Left ventricle','Right atrium','Left atrium','Ascending aorta','Aortic arch','Spleen','Anterior segment of eyeball.r','Posterior segment of eyeball.r','Anterior segment of eyeball.l','Posterior segment of eyeball.l']
 names += [n for n in src.objects if ('hemisphere' in n.lower() or 'cerebrum' in n.lower()) and not n.endswith(('.j','.g','.t'))]
 dst.objects=[n for n in names if n in src.objects]
extra=[]
for o in dst.objects:
 if not o or o.type not in ['MESH','CURVE']:continue
 bpy.context.scene.collection.objects.link(o);o.hide_viewport=False;o.hide_render=False;o.hide_set(False)
 if o.type=='CURVE':
  bpy.context.view_layer.update()
  me=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
  name=o.name;matrix=o.matrix_world.copy();bpy.data.objects.remove(o,do_unlink=True)
  o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o);o.matrix_world=matrix
 bake(o);smooth(o,2600,3);extra.append(o)

for id,label,system,match,col in [
 ('heart','Heart','cardiovascular',lambda n:any(k in n.lower() for k in ['ventricle','atrium','aorta','aortic']),(.65,.20,.17)),
 ('spleen','Spleen','lymphatic',lambda n:n=='Spleen',(.42,.29,.42)),
 ('eye-left','Left eye','sensory',lambda n:'eyeball.l' in n,(.55,.66,.66)),
 ('eye-right','Right eye','sensory',lambda n:'eyeball.r' in n,(.55,.66,.66)),
 ('brain','Brain','nervous',lambda n:'hemisphere' in n.lower() or 'cerebrum' in n.lower(),(.66,.53,.53))]:
 selected=[o for o in extra if o.name in bpy.context.scene.objects and match(o.name)]
 if selected:
  extra=[o for o in extra if o not in selected]
  o=join(selected,id);record(o,id,label,system,col);made.append(o)
export('organs',made)
# Run build_details.py next for the independently evaluated chambers and valve.
for sex in ['male','female']:
 clean();objs=load('reproductive-'+sex)
 for i,o in enumerate(objs):
  bake(o);smooth(o,900,4);label=re.sub(r'\.\d+$','',o.name).replace('_m','')
  id='reproductive-'+sex+'-'+str(i);record(o,id,label,'reproductive',(.59,.37,.45),sex)
 export('reproductive-'+sex,objs)
(OUT/'organs.json').write_text(json.dumps(manifest,indent=2))
print('MANIFEST',len(manifest),flush=True)
