"""Render the authored model directly in Blender, including separate layer/context views."""
import bpy,bmesh,math,sys
from pathlib import Path
from mathutils import Vector
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'shots/model-review';OUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BASE/'models/repair/female-repair.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1280;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Inspection studio')
scene.world.color=(.13,.13,.13);scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.066,.079,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-.5
model=[o for o in scene.objects if o.type=='MESH']
def area(name,location,power,size,color):
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
 o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=location;o.rotation_euler=(Vector((0,.025,.86))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large softbox',(-.18,-.22,1.15),3.0,.25,(1,.86,.79));area('Fill',(.21,-.05,.98),1.2,.2,(.73,.84,1));area('Rim',(.02,.20,1.02),2.0,.20,(1,.83,.74))
cam_data=bpy.data.cameras.new('Inspection camera');cam=bpy.data.objects.new('Inspection camera',cam_data);scene.collection.objects.link(cam);scene.camera=cam;cam_data.type='ORTHO';cam_data.lens=50;cam_data.clip_start=.001;cam_data.clip_end=10

def render(name,pos,target,scale):
 cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam_data.ortho_scale=scale;scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);print('RENDERED',name,flush=True)
render('female-front-final',(0,-.34,1.00),(0,.018,.863),.29)
render('female-side-final',(.34,-.01,.93),(0,.021,.859),.29)
# Open the old model, keep camera/light settings unchanged, and compare at identical scale.
for o in model:o.hide_render=True
bpy.ops.import_scene.gltf(filepath=str(BASE/'models/repair/reproductive-female-before.glb'))
old=[o for o in scene.objects if o.type=='MESH' and o not in model]
render('female-before-front',(0,-.34,1.00),(0,.018,.863),.29)
for o in old:o.hide_render=True
for o in model:o.hide_render=False
# Pelvic frame and bladder from the unchanged source GLBs.
previous=set(scene.objects)
bpy.ops.import_scene.gltf(filepath=str(BASE/'models/bones.glb'))
context=[o for o in scene.objects if o not in previous and o.type=='MESH']
for o in context:
 bpy.context.view_layer.objects.active=o;o.data=o.data.copy();o.data.transform(o.matrix_world);o.matrix_world.identity()
 bm=bmesh.new();bm.from_mesh(o.data);remove=[v for v in bm.verts if v.co.z<.76 or v.co.z>1.04 or abs(v.co.x)>.155];bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(o.data);bm.free()
 m=bpy.data.materials.new('Pelvic bone context');m.use_nodes=True;n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(.50,.56,.57,1);n.inputs['Roughness'].default_value=.7;o.data.materials.clear();o.data.materials.append(m)
previous=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(BASE/'models/organs.glb'))
for o in list(scene.objects):
 if o in previous or o.type!='MESH':continue
 if 'bladder' not in o.name.lower():bpy.data.objects.remove(o,do_unlink=True);continue
 m=bpy.data.materials.new('Bladder context');m.use_nodes=True;n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(.12,.36,.48,1);n.inputs['Roughness'].default_value=.6;o.data.materials.clear();o.data.materials.append(m)
render('female-pelvis-front-final',(0,-.45,1.05),(0,.025,.878),.34)
for o in context:
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.x>.001],context='VERTS');bm.to_mesh(o.data);bm.free()
render('female-pelvis-side-final',(.42,-.12,1.00),(0,.025,.878),.34)
