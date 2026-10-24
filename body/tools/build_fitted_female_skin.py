"""Reconstruct a fitted female envelope from atlas-aligned limbs and the CC0 scan's torso/head.
The original male surface is read only. Candidate output, never installs automatically.
"""
import bpy,bmesh,math,json
from pathlib import Path
from mathutils import Vector
import numpy as np
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(BASE/'models/skin.glb'))
base=next(o for o in bpy.context.scene.objects if o.type=='MESH');base.data=base.data.copy();base.data.transform(base.matrix_world);base.matrix_world.identity();base.name='Atlas aligned envelope'
# First reconstruct the atlas regions into a closed envelope; only then perform local cuts.
bpy.context.view_layer.objects.active=base
m=base.modifiers.new('Close reference envelope','REMESH');m.mode='VOXEL';m.voxel_size=.002;m.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=m.name)
print('Closed atlas reference',len(base.data.polygons),flush=True)
def cut_box(center,scale,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=2,location=center);c=bpy.context.object;c.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  m=c.modifiers.new('Soft anatomical cut','BEVEL');m.width=bevel;m.segments=4;bpy.ops.object.modifier_apply(modifier=m.name)
 bpy.context.view_layer.objects.active=base;m=base.modifiers.new('Local female surface replacement','BOOLEAN');m.operation='DIFFERENCE';m.solver='EXACT';m.object=c;bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(c,do_unlink=True)
cut_box((0,0,1.7),(.3,.3,.22))
cut_box((0,-.15,.78),(.038,.095,.070),.012)
print('Base prepared',flush=True)
D=np.load(OUT/'female-surface-fit.npz');original=D['original'];posed=D['posed'];F=D['faces']
def part(name,V,keep):
 me=bpy.data.meshes.new(name);me.from_pydata(V.tolist(),[],F.tolist());me.update();o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o)
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.delete(bm,geom=[v for v in bm.verts if not keep[v.index]],context='VERTS');bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=.00002)
 boundary=[e for e in bm.edges if e.is_boundary]
 if boundary:bmesh.ops.holes_fill(bm,edges=boundary,sides=0)
 bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free();return o
V=posed.copy();x,y,z=V.T
# Lower the perineal patch into the same pelvis as the authored reproductive assembly.
w=np.exp(-(x/.040)**4-((z-.824)/.038)**4-((y-.005)/.06)**4);V[:,2]-=.024*w
width=np.interp(V[:,2],[.70,.97,1.06,1.30,1.40,1.46],[.18,.18,.145,.145,.185,.18])
keep=(V[:,2]>.70)&(V[:,2]<1.46)&(abs(V[:,0])<width)
torso=part('Scan torso and pelvic surface',V,keep)
# Keep the scan's face, aligning its facial height/depth to the existing skull landmarks.
H=original.copy();z=H[:,2].copy();H[:,2]=np.interp(z,[0,1.46,1.50,1.54,1.60,1.65,1.743],[0,1.46,1.49,1.52,1.56,1.61,1.743])
t=np.clip((z-1.46)/.07,0,1);t=t*t*(3-2*t);H[:,1]+=.038*t;H[:,0]*=1+.10*t
H[:,1]+=np.maximum(H[:,1],0)*.12*t
head=part('Scan head aligned to skull',H,z>1.45)
print('Female scan patches prepared',flush=True)
# Union/resurface at millimetre resolution; the resulting female shell has a single topology.
# Exact volume unions avoid cancellation between overlapping scan/reference shells.
for patch in [torso,head]:
 bpy.context.view_layer.objects.active=patch
 m=patch.modifiers.new('Close female source patch','REMESH');m.mode='VOXEL';m.voxel_size=.0015;m.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=m.name)
 bpy.context.view_layer.objects.active=base;m=base.modifiers.new('Integrate female source anatomy','BOOLEAN');m.operation='UNION';m.solver='EXACT';m.object=patch;bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(patch,do_unlink=True)
 print('Integrated female source patch',flush=True)
o=base;o.name='Female fitted skin'
m=o.modifiers.new('Millimetre envelope reconstruction','REMESH');m.mode='VOXEL';m.voxel_size=.0015;m.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=m.name)
print('Envelope reconstructed',len(o.data.polygons),flush=True)
m=o.modifiers.new('Soft tissue transitions','SMOOTH');m.factor=.45;m.iterations=8;bpy.ops.object.modifier_apply(modifier=m.name)
# A light surface offset restores clearance lost through smoothing.
o.data.update()
normals=[v.normal.copy()for v in o.data.vertices]
for v,n in zip(o.data.vertices,normals):v.co+=n*.001
print('Clearance restored',flush=True)
m=o.modifiers.new('Surface budget without pose loss','DECIMATE');m.ratio=min(1,210000/max(1,len(o.data.polygons)));bpy.ops.object.modifier_apply(modifier=m.name)
o.data.validate(verbose=True,clean_customdata=True)
for f in o.data.polygons:f.use_smooth=True
o.data.update();material=bpy.data.materials.new('Female skin');material.use_nodes=True;b=material.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(.58,.43,.35,1);b.inputs['Roughness'].default_value=.65;o.data.materials.clear();o.data.materials.append(material)
bm=bmesh.new();bm.from_mesh(o.data);bad=sum(not e.is_manifold for e in bm.edges);bm.free()
report={'vertices':len(o.data.vertices),'faces':len(o.data.polygons),'nonmanifold_edges':bad,'voxel_mm':1.5,'source':'CC0 scan head/torso + unchanged atlas pose/envelope reference'}
bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
bpy.ops.export_scene.gltf(filepath=str(OUT/'skin-female-candidate.glb'),export_format='GLB',use_selection=True,export_apply=True,export_normals=True,export_texcoords=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'female-surface-fitted.blend'));(OUT/'surface-reconstruction.json').write_text(json.dumps(report,indent=2));print(report,flush=True)
