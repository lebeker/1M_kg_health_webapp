import bpy,bmesh,json,sys
from pathlib import Path
from mathutils import Vector
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'shots/fit-audit';OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1100;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.045,.052,.063,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.4
for pos,power,size in [((-2,-3,3),230,3),((2,-1,2),130,2),((1,2,3),220,2)]:
 d=bpy.data.lights.new('Softbox','AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new('Softbox',d);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,.87))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('Camera');camera=bpy.data.objects.new('Camera',d);scene.collection.objects.link(camera);scene.camera=camera;d.type='ORTHO';d.ortho_scale=2.0

def load(file,color):
 before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(BASE/'models'/file));objs=[o for o in scene.objects if o not in before and o.type=='MESH']
 for o in objs:
  m=bpy.data.materials.new(file);m.use_nodes=True;n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=.65;o.data.materials.clear();o.data.materials.append(m)
 return objs
bones=load('bones.glb',(.62,.63,.56));organs=load('organs.glb',(.48,.20,.17));female=load('repair/skin-female-candidate.glb' if '--candidate' in sys.argv else 'skin-female.glb',(.30,.47,.42));male=load('skin.glb',(.25,.31,.42))
for o in male:o.hide_render=True
for o in organs:
 if o.name.lower().startswith(('urethra','ejaculatory')):o.hide_render=True

def render(name,pos):
 camera.location=pos;camera.rotation_euler=(Vector((0,0,.87))-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/((name.replace('before','candidate') if '--candidate' in sys.argv else name)+'.png'));bpy.ops.render.render(write_still=True)
render('female-skin-before-front',(0,-4,1.0));render('female-skin-before-side',(4,0,1.0))
# Render the pose relationship with the surface as a translucent overlay.
for o in female:
 n=o.data.materials[0].node_tree.nodes['Principled BSDF'];n.inputs['Alpha'].default_value=.22
render('female-skin-before-overlay',(0,-4,1.0))
for o in female:o.hide_render=True
for o in male:o.hide_render=False
render('atlas-envelope-reference',(0,-4,1.0))
