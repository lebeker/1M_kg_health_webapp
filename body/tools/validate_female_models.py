"""Verify assembly connectivity, forbidden intersections, endpoint frames and skin enclosure.
Explicit anatomical attachment patches are reported separately, never counted as a clean disjoint pair.
"""
import bpy,bmesh,json,math,sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(OUT/'reproductive-female-v2.glb'));bpy.context.view_layer.update()
models=[o for o in bpy.context.scene.objects if o.type=='MESH'];interfaces=json.loads((OUT/'assembly-v2-interfaces.json').read_text());out={'organs':{},'interfaces':[],'forbidden_contacts':[],'tube_endings':interfaces['tube_endings']}
def tree(o):
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.transform(bm,matrix=o.matrix_world,verts=bm.verts);t=BVHTree.FromBMesh(bm,epsilon=1e-8);bm.free();return t
T={o.name:tree(o)for o in models}
for o in models:
 bm=bmesh.new();bm.from_mesh(o.data);fv=[set(v.index for v in f.verts)for f in bm.faces];pairs=T[o.name].overlap(T[o.name]);bad=[(a,b)for a,b in pairs if a<b and not fv[a].intersection(fv[b])]
 remaining=set(bm.verts);components=0
 while remaining:
  todo=[remaining.pop()];components+=1
  while todo:
   v=todo.pop()
   for e in v.link_edges:
    w=e.other_vert(v)
    if w in remaining:remaining.remove(w);todo.append(w)
 out['organs'][o.name]={'self_crossings':len(bad),'components':components,'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges)};bm.free()
for i,a in enumerate(models):
 for b in models[i+1:]:
  pairs=T[a.name].overlap(T[b.name]);allowed=[p for p in interfaces['interfaces']if{p['a'],p['b']}=={a.name,b.name}];forbidden=[]
  for fa,fb in pairs:
   # Use both intersecting face centroids; reject intersections away from declared junctions.
   pa=a.matrix_world@a.data.polygons[fa].center;pb=b.matrix_world@b.data.polygons[fb].center
   if not any((pa-Vector(p['center'])).length<p['radius'] and(pb-Vector(p['center'])).length<p['radius']for p in allowed):forbidden.append((fa,fb))
  if pairs:out['interfaces'].append({'a':a.name,'b':b.name,'surface_contacts':len(pairs),'outside_attachment_patches':len(forbidden)})
  if forbidden:out['forbidden_contacts'].append({'a':a.name,'b':b.name,'count':len(forbidden)})
# Keep at least 1 mm between every ovarian surface and its ipsilateral tube.
for suffix in ['l','r']:
 ov=next(o for o in models if o.name=='Ovary.'+suffix);tu=next(o for o in models if o.name=='Uterine tube.'+suffix)
 distance=min(T[ov.name].find_nearest(tu.matrix_world@v.co)[3]for v in tu.data.vertices)
 out['tube_endings'][suffix]['ovary_clearance_mm']=distance*1000
# Skeleton and bladder clearance of the assembly, using unchanged reference geometry.
references={}
for name in ['bones','muscles','organs','cardio','nervous','lymphoid']:
 old=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(BASE/'models'/(name+'.glb')))
 added=[o for o in bpy.context.scene.objects if o not in old and o.type=='MESH'];references[name]=added;bpy.context.view_layer.update()
bpy.context.view_layer.update()
for o in models:
 pairs=sum((T[o.name].overlap(tree(b))for b in references['bones']),[])
 out['organs'][o.name]['bone_crossings']=len(pairs)
 if pairs:
  pts=[o.data.vertices[v].co for i,j in pairs for v in o.data.polygons[i].vertices]
  out['organs'][o.name]['bone_crossing_bounds']=[[min(p[k]for p in pts)for k in range(3)],[max(p[k]for p in pts)for k in range(3)]]
 bladder=[b for b in references['organs']if'bladder'in b.name.lower()]
 bpairs=sum((T[o.name].overlap(tree(b))for b in bladder),[])
 out['organs'][o.name]['bladder_crossings']=len(bpairs)
 expected=0
 if o.name=='Female urethra':
  expected=sum((o.matrix_world@o.data.polygons[a].center-Vector((0,.011,.830))).length<.005 for a,b in bpairs)
 out['organs'][o.name]['unexpected_bladder_crossings']=len(bpairs)-expected
# Skin is checked against each reference layer and each organ, not merely against a target shell.
if '--assembly-only' not in sys.argv:
 old=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/'skin-female-candidate.glb'))
 skin=next(o for o in bpy.context.scene.objects if o not in old and o.type=='MESH');st=tree(skin)
 bm=bmesh.new();bm.from_mesh(skin.data);out['skin']={'vertices':len(bm.verts),'faces':len(bm.faces),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges)};bm.free()
 for group,objects in references.items():
  if group=='organs':objects=[o for o in objects if not o.name.lower().startswith(('urethra','ejaculatory'))]
  collisions=[]
  for o in objects:
   pairs=st.overlap(tree(o))
   if pairs:
    pts=[skin.matrix_world@skin.data.vertices[v].co for i,j in pairs for v in skin.data.polygons[i].vertices]
    collisions.append({'mesh':o.name,'triangle_contacts':len(pairs),'bounds':[[min(p[k]for p in pts)for k in range(3)],[max(p[k]for p in pts)for k in range(3)]]})
  out['skin'][group+'_contacts']=collisions

(OUT/'female-models-validation.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2),flush=True)
