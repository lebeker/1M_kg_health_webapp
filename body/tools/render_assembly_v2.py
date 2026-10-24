"""Render the authored model directly in Blender, including separate layer/context views."""
import bpy,bmesh,math,sys
from pathlib import Path
from mathutils import Vector
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'shots/fit-audit';OUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BASE/'models/repair/female-system-v2.blend'))
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
render('assembly-v2-oblique',(.25,-.32,.96),(0,.012,.86),.27)
render('assembly-v2-side',(.34,-.01,.93),(0,.021,.859),.29)
render('assembly-v2-tubal-ending',(.11,-.09,.90),(.044,-.007,.923),.055)
