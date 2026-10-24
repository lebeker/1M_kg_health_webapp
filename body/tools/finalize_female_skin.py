"""Reduce the closed envelope with topology-preserving Blender collapse; keep raw on failure."""
import bpy,bmesh,json
from pathlib import Path
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(OUT/'skin-female-candidate.glb'));bpy.context.view_layer.update()
o=next(o for o in bpy.context.scene.objects if o.type=='MESH');o.data=o.data.copy();o.data.transform(o.matrix_world);o.matrix_world.identity();bpy.context.view_layer.objects.active=o
raw=o.data.copy();m=o.modifiers.new('Preserve closed surface topology','DECIMATE');m.ratio=min(1,260000/len(o.data.polygons));m.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=m.name)
bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=.0000001);bmesh.ops.dissolve_degenerate(bm,edges=bm.edges,dist=.00000001)
boundary=[e for e in bm.edges if e.is_boundary]
if boundary:bmesh.ops.holes_fill(bm,edges=boundary,sides=0)
remaining=set(bm.verts);components=[]
while remaining:
 todo=[remaining.pop()];component=[]
 while todo:
  v=todo.pop();component.append(v)
  for e in v.link_edges:
   w=e.other_vert(v)
   if w in remaining:remaining.remove(w);todo.append(w)
 components.append(component)
components.sort(key=len,reverse=True)
if len(components)>1:bmesh.ops.delete(bm,geom=[v for c in components[1:]for v in c],context='VERTS')
print('Skin surface components retained',1,'removed internal/fragments',len(components)-1,flush=True)
bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bad=sum(not e.is_manifold for e in bm.edges);bm.to_mesh(o.data);bm.free()
if bad:
 o.data=raw;print('Keeping closed full-resolution surface; simplified candidate had',bad,'nonmanifold edges',flush=True)
else:print('Closed reduced surface',len(o.data.vertices),len(o.data.polygons),flush=True)
o.name='Female fitted skin';o.data.validate(clean_customdata=True);o.data.update()
for p in o.data.polygons:p.use_smooth=True
bpy.ops.object.select_all(action='DESELECT');o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'skin-female-candidate.glb'),export_format='GLB',use_selection=True,export_apply=True,export_normals=True,export_texcoords=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'female-surface-fitted.blend'))
