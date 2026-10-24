import bpy,bmesh,json
from pathlib import Path
from mathutils.bvhtree import BVHTree
BASE=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(BASE/'models/repair/female-repair.blend'))
objs=[o for o in bpy.context.scene.objects if o.type=='MESH'];trees={};faces={};report={'self':{},'pairs':[]}
for o in objs:
 bm=bmesh.new();bm.from_mesh(o.data);trees[o.name]=BVHTree.FromBMesh(bm,epsilon=1e-8);faces[o.name]=[set(v.index for v in f.verts)for f in bm.faces]
 pairs=trees[o.name].overlap(trees[o.name]);bad=[(a,b)for a,b in pairs if a<b and not faces[o.name][a].intersection(faces[o.name][b])]
 # Number of topological components, not just number of object names.
 remaining=set(bm.verts);parts=[]
 while remaining:
  todo=[remaining.pop()];size=0
  while todo:
   v=todo.pop();size+=1
   for e in v.link_edges:
    w=e.other_vert(v)
    if w in remaining:remaining.remove(w);todo.append(w)
  parts.append(size)
 report['self'][o.name]={'crossings':len(bad),'components':len(parts)};bm.free()
for i,a in enumerate(objs):
 for b in objs[i+1:]:
  overlaps=trees[a.name].overlap(trees[b.name])
  if overlaps:report['pairs'].append({'a':a.name,'b':b.name,'crossings':len(overlaps)})
(BASE/'models/repair/assembly-before.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
