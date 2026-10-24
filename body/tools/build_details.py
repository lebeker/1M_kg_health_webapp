"""Export independently evaluated chamber meshes and a modelled three-leaflet valve."""
import bpy,bmesh,math
from pathlib import Path
from mathutils import Matrix,Vector
BASE=Path(__file__).resolve().parents[1]
ATLAS=Path('/Users/denistatarenko/Work/other/1M_kg_health_assets/zanat/Z-Anatomy/Startup.blend')
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(str(ATLAS),link=False) as (src,dst):dst.objects=['Left ventricle','Right atrium']
made=[]
for src in dst.objects:
 bpy.context.scene.collection.objects.link(src);src.hide_set(False);src.hide_viewport=False;src.hide_render=False
 bpy.context.view_layer.update()
 ev=src.evaluated_get(bpy.context.evaluated_depsgraph_get());me=bpy.data.meshes.new_from_object(ev);me.transform(src.matrix_world)
 name={'Left ventricle':'left-ventricle','Right atrium':'right-atrium'}[src.name]
 # New objects deliberately inherit no atlas visibility/collection state.
 o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o)
 bpy.context.view_layer.objects.active=o
 m=o.modifiers.new('Small sculpt','DECIMATE');m.ratio=min(1,1800/max(1,len(me.polygons)));bpy.ops.object.modifier_apply(modifier=m.name)
 for p in o.data.polygons:p.use_smooth=True
 made.append(o)
 bpy.data.objects.remove(src,do_unlink=True)
# A dedicated 3D aortic valve object: scalloped ring and three curved leaflets.
verts=[];faces=[]
for j in range(13):
 t=j/12*math.tau
 for i in range(65):
  a=i/64*math.tau;r=.46+.048*math.cos(t);verts.append((r*math.cos(a),r*math.sin(a),.048*math.sin(t)))
for j in range(12):
 for i in range(64):
  a=j*65+i;faces.append((a,a+1,a+66,a+65))
for leaf in range(3):
 start=len(verts)
 for j in range(13):
  v=j/12
  for i in range(25):
   u=i/24;angle=(leaf+u)*math.tau/3;radius=.45*(1-v)+.035*v
   z=.09*math.sin(u*math.pi)*v+.13*math.sin(v*math.pi)
   verts.append((radius*math.cos(angle),radius*math.sin(angle),z))
 for j in range(12):
  for i in range(24):
   a=start+j*25+i;faces.append((a,a+1,a+26,a+25))
me=bpy.data.meshes.new('Three-leaflet valve');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('aortic-valve',me);bpy.context.scene.collection.objects.link(o)
# Turn toward the viewer in the exported Y-up frame.
me.transform(Matrix.Rotation(math.pi/2,4,'X'))
for p in me.polygons:p.use_smooth=True
made.append(o)
for o in made:
 m=bpy.data.materials.new('Terracotta clay');m.diffuse_color=(.65,.20,.17,1);o.data.materials.clear();o.data.materials.append(m)
bpy.ops.object.select_all(action='DESELECT')
for o in made:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(BASE/'models/designed/objects.glb'),export_format='GLB',use_selection=True,export_normals=True,export_texcoords=False)
print([(o.name,len(o.data.polygons))for o in made],flush=True)
