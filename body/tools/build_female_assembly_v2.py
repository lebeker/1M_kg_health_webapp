"""Rebuild assembly relationships in the final atlas coordinate frame.
No post-hoc per-part warps. Tubal shaft, funnel and fimbriae are one continuous hollow surface.
"""
import bpy,bmesh,math,json
from pathlib import Path
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'female-repair.blend'))
core={o.name:o for o in bpy.context.scene.objects if o.name in ['Uterus','Cervix','Vagina']}
for o in list(bpy.context.scene.objects):
 if o not in core.values():bpy.data.objects.remove(o,do_unlink=True)
made=list(core.values());anchors=[];metrics={}
def mat(name,color):
 m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=.52;return m
TU=mat('Tubal serosa',(.54,.24,.27));OV=mat('Ovarian cortex',(.62,.42,.36));LG=mat('Ligament',(.65,.47,.41));EX=mat('External mucosa',(.50,.22,.25));MU=mat('Mucosal wall',(.48,.18,.22))
def mesh(name,verts,faces,material):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.validate();me.update();bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
 o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o);o.data.materials.append(material)
 for f in me.polygons:f.use_smooth=True
 made.append(o);return o

def bvh(o):
 bm=bmesh.new();bm.from_mesh(o.data);t=BVHTree.FromBMesh(bm);bm.free();return t

def boolean(obj,other,operation='DIFFERENCE',name=None):
 bpy.context.view_layer.objects.active=obj;m=obj.modifiers.new('Continuous anatomical junction','BOOLEAN');m.operation=operation;m.solver='EXACT';m.object=other;bpy.ops.object.modifier_apply(modifier=m.name)
 for f in obj.data.polygons:f.use_smooth=True
 if name:obj.name=name

def cut_clearance(obj,cutter,gap=.00025):
 temporary=cutter.copy();temporary.data=cutter.data.copy();bpy.context.scene.collection.objects.link(temporary)
 normals=[v.normal.copy()for v in temporary.data.vertices]
 for v,n in zip(temporary.data.vertices,normals):v.co+=n*gap
 temporary.data.update();boolean(obj,temporary);bpy.data.objects.remove(temporary,do_unlink=True)
# The old upper vaginal wall crossed the cervical wall. Trim the vault around it.
cut_clearance(core['Vagina'],core['Cervix'])
for v in core['Vagina'].data.vertices:
 t=max(0,1-abs(v.co.z-.838)/.020);v.co.y+=.016*t*t*(3-2*t)
core['Vagina'].data.update()

def sample(points,n):
 # Centripetal Catmull-Rom plus arc-length sampling: no root overshoot from uneven stations.
 P=[Vector(p)for p in points];E=[2*P[0]-P[1]]+P+[2*P[-1]-P[-2]];dense=[]
 for i in range(len(P)-1):
  q=E[i:i+4];t=[0.]
  for j in range(3):t.append(t[-1]+max(1e-8,(q[j+1]-q[j]).length)**.5)
  for k in range(40):
   u=t[1]+(t[2]-t[1])*k/40
   a=[((t[j+1]-u)*q[j]+(u-t[j])*q[j+1])/(t[j+1]-t[j])for j in range(3)]
   b=[((t[j+2]-u)*a[j]+(u-t[j])*a[j+1])/(t[j+2]-t[j])for j in range(2)]
   dense.append(((t[2]-u)*b[0]+(u-t[1])*b[1])/(t[2]-t[1]))
 dense.append(P[-1]);length=[0.]
 for i in range(1,len(dense)):length.append(length[-1]+(dense[i]-dense[i-1]).length)
 out=[];i=0
 for k in range(n):
  u=length[-1]*k/(n-1)
  while i<len(dense)-2 and length[i+1]<u:i+=1
  out.append(dense[i].lerp(dense[i+1],(u-length[i])/max(1e-12,length[i+1]-length[i])))
 return out

def frames(P):
 tangents=[(P[min(i+1,len(P)-1)]-P[max(0,i-1)]).normalized()for i in range(len(P))]
 ref=Vector((0,1,0));n=(ref-tangents[0]*ref.dot(tangents[0])).normalized();out=[]
 for i,t in enumerate(tangents):
  if i:n=tangents[i-1].rotation_difference(t)@n;n=(n-t*n.dot(t)).normalized()
  out.append((t,n,t.cross(n).normalized()))
 return out

def sweep(name,points,radius,material,n=64,segs=24,hollow=0):
 P=sample(points,n);fr=frames(P);verts=[];faces=[];shells=2 if hollow else 1
 for side in range(shells):
  for j,p in enumerate(P):
   r=radius(j/(n-1))if callable(radius)else radius
   if side:r-=hollow
   for i in range(segs):
    a=math.tau*i/segs;verts.append(tuple(p+r*(fr[j][1]*math.cos(a)+fr[j][2]*math.sin(a))))
  off=side*n*segs
  for j in range(n-1):
   for i in range(segs):
    a=off+j*segs+i;b=off+j*segs+(i+1)%segs;f=(a,b,b+segs,a+segs);faces.append(f[::-1]if side else f)
 if hollow:
  for j in [0,n-1]:
   for i in range(segs):
    a=j*segs+i;b=j*segs+(i+1)%segs;faces.append((a,a+n*segs,b+n*segs,b)if j==0 else(a,b,b+n*segs,a+n*segs))
 else:
  for j in [0,n-1]:
   k=len(verts);verts.append(tuple(P[j]))
   for i in range(segs):
    a=j*segs+i;b=j*segs+(i+1)%segs;faces.append((k,b,a)if j==0 else(k,a,b))
 return mesh(name,verts,faces,material)

def ellipsoid(name,center,radii,material,tilt=0,N=48,M=64):
 c=Vector(center);R=Matrix.Rotation(tilt,3,'X');verts=[tuple(c+R@Vector((0,0,radii[2])))];faces=[]
 for j in range(1,N):
  v=math.pi*j/N
  for i in range(M):
   a=math.tau*i/M;relief=1+.009*math.sin(7*a)*math.sin(5*v)
   p=Vector((radii[0]*math.sin(v)*math.cos(a)*relief,radii[1]*math.sin(v)*math.sin(a)*relief,radii[2]*math.cos(v)))
   verts.append(tuple(c+R@p))
 last=len(verts);verts.append(tuple(c+R@Vector((0,0,-radii[2]))))
 for i in range(M):faces.append((0,1+i,1+(i+1)%M));faces.append((last,1+(N-2)*M+(i+1)%M,1+(N-2)*M+i))
 for j in range(N-2):
  for i in range(M):
   a=1+j*M+i;b=1+j*M+(i+1)%M;faces.append((a,b,b+M,a+M))
 return mesh(name,verts,faces,material)

def attach(a,b,point,radius=.003):anchors.append({'a':a,'b':b,'center':list(point),'radius':radius})
uterine_tree=bvh(core['Uterus'])
previous=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(BASE/'models/bones.glb'));bpy.context.view_layer.update()
bones=next(o for o in bpy.context.scene.objects if o not in previous and o.type=='MESH');bm=bmesh.new();bm.from_mesh(bones.data);bmesh.ops.transform(bm,matrix=bones.matrix_world,verts=bm.verts);bone_tree=BVHTree.FromBMesh(bm);bm.free()
for o in list(bpy.context.scene.objects):
 if o not in previous:bpy.data.objects.remove(o,do_unlink=True)
def uterine_anchor(desired):
 p,n,index,distance=uterine_tree.find_nearest(Vector(desired));return p,n.normalized()
for suffix,s in [('l',1),('r',-1)]:
 center=Vector((s*.044,-.001,.902));ovary=ellipsoid('Ovary.'+suffix,center,(.010,.0065,.014),OV,math.radians(25))
 bvh_ov=bvh(ovary)
 # A continuous path has a final vertical tangent: the funnel faces the ovarian superior pole.
 pole=center+Matrix.Rotation(math.radians(25),3,'X')@Vector((0,0,.014))
 opening=pole+Vector((0,0,.009))
 root,normal,_,_=uterine_tree.ray_cast(Vector((s*.040,.014,.918)),(Vector((0,.012,.900))-Vector((s*.040,.014,.918))).normalized());start=root-normal*.00045
 # Choose a smooth cubic arch with a bounded bend radius and reference clearance.
 end=opening+Vector((0,0,.005));best=None;diagnostics=[]
 for dx in [.020,.035,.050]:
  for dy in [-.010,-.025,-.040]:
   for dz in [.015,.030,.045]:
    for h in [.015,.025,.040]:
     a=start;b=root+Vector((s*dx,dy,dz));c=end+Vector((0,0,h));d=end;path=[];min_radius=1.;clear=True;distances=[1.,1.,1.]
     for k in range(65):
      t=k/64;u=1-t;p=a*u**3+3*b*u*u*t+3*c*u*t*t+d*t**3
      v=3*((b-a)*u*u+2*(c-b)*u*t+(d-c)*t*t);acc=6*((c-2*b+a)*u+(d-2*c+b)*t)
      bend=v.cross(acc).length;radius=v.length**3/max(bend,1e-12);min_radius=min(min_radius,radius);path.append(p)
      if p.z>.960 or abs(p.x)>.066:clear=False
      if (p-root).length>.009:
       ds=[uterine_tree.find_nearest(p)[3],bone_tree.find_nearest(p)[3],bvh_ov.find_nearest(p)[3]];distances=[min(a,b)for a,b in zip(distances,ds)]
       if min(ds)<.0035:clear=False
     diagnostics.append((min_radius,distances,(dx,dy,dz,h)))
     if clear and min_radius>.004:
      score=min_radius-.10*max(p.z for p in path)
      if best is None or score>best[0]:best=(score,(a,b,c,d),min_radius)
 if best is None:
  print('ARCH DIAGNOSTICS',sorted(diagnostics,key=lambda row:min(row[1]),reverse=True)[:8],flush=True)
  raise RuntimeError('No non-piercing tubal arch found for '+suffix)
 a,b,c,d=best[1];dense=[]
 for k in range(501):
  t=k/500;u=1-t;dense.append(a*u**3+3*b*u*u*t+3*c*u*t*t+d*t**3)
 lengths=[0.]
 for j in range(1,len(dense)):lengths.append(lengths[-1]+(dense[j]-dense[j-1]).length)
 shaft=[];j=0
 for k in range(128):
  distance=lengths[-1]*k/127
  while j<len(dense)-2 and lengths[j+1]<distance:j+=1
  shaft.append(dense[j].lerp(dense[j+1],(distance-lengths[j])/max(1e-12,lengths[j+1]-lengths[j])))
 print('Tube',suffix,'minimum bend radius mm',best[2]*1000,flush=True)
 P=shaft+[opening+Vector((0,0,.005*(1-j/24)))for j in range(1,25)];fr=frames(P);N=len(P);M=132;verts=[];faces=[]
 for side in range(2):
  for j,p in enumerate(P):
   terminal=max(0,(j-(len(shaft)-1))/24);u=j/(len(shaft)-1)
   r=(.0019+.0013*math.sin(min(1,u)*math.pi*.82)**2)if not terminal else .0023+.0035*terminal
   if side:r-=.0004
   for i in range(M):
    a=math.tau*i/M;finger=((.5+.5*math.cos(11*a))**5)*.0025*max(0,(terminal-.55)/.45)**2
    p2=p+fr[j][0]*finger+r*(fr[j][1]*math.cos(a)+fr[j][2]*math.sin(a));verts.append(tuple(p2))
  off=side*N*M
  for j in range(N-1):
   for i in range(M):
    a=off+j*M+i;b=off+j*M+(i+1)%M;f=(a,b,b+M,a+M);faces.append(f[::-1]if side else f)
 for j in [0,N-1]:
  for i in range(M):
   a=j*M+i;b=j*M+(i+1)%M;faces.append((a,a+N*M,b+N*M,b)if j==0 else(a,b,b+N*M,a+N*M))
 tube=mesh('Uterine tube.'+suffix,verts,faces,TU);attach('Uterus',tube.name,root,.004)
 metrics[suffix]={'opening_center':list(opening),'ovarian_pole':list(pole),'terminal_axis':list(fr[-1][0]),'axis_toward_ovary_dot':fr[-1][0].dot((pole-opening).normalized())}
 # Ovarian support ends at the medial hilum, with a short buried attachment only.
 hilum=center+Vector((-s*.0097,0,0));lr,ln,_,_=uterine_tree.ray_cast(hilum,(Vector((0,.012,.900))-hilum).normalized())
 direction=(hilum-lr).normalized();ligament=sweep('Ovarian ligament.'+suffix,[lr-direction*.0003,hilum+direction*.0003],.00115,LG)
 attach('Uterus',ligament.name,lr,.003);attach(ovary.name,ligament.name,hilum,.003)
 # Round ligament runs anterior to the ovary, instead of piercing it.
 origin=Vector((s*.035,-.025,.895));rr,rn,_,_=uterine_tree.ray_cast(origin,(Vector((0,.012,.900))-origin).normalized())
 ligament=sweep('Round ligament.'+suffix,[rr-rn*.0003,rr+rn*.004,(s*.036,-.022,.897),(s*.052,-.031,.882),(s*.070,-.042,.859)],.00115,LG,n=80)
 attach('Uterus',ligament.name,rr,.003)

# One continuous vestibular/labial tissue surface. Fold ridges share this topology.
N=56;M=160;verts=[];faces=[]
for side in range(2):
 for j in range(N):
  t=j/(N-1)
  for i in range(M):
   a=math.tau*i/M
   x=((1-t)*.010+t*.026)*math.cos(a);y=(1-t)*(-.009+.0045*math.sin(a))+t*(-.012+.047*math.sin(a))
   z=(1-t)*.787+t*(.801-.003*math.sin(a))
   sides=abs(math.cos(a))**1.5
   z-=sides*(.0035*math.exp(-((t-.18)/.075)**2)+.0065*math.exp(-((t-.63)/.20)**2))
   if side:z+=.0015
   verts.append((x,y,z))
 off=side*N*M
 for j in range(N-1):
  for i in range(M):
   a=off+j*M+i;b=off+j*M+(i+1)%M;f=(a,b,b+M,a+M);faces.append(f[::-1]if side else f)
for j in [0,N-1]:
 for i in range(M):
  a=j*M+i;b=j*M+(i+1)%M;faces.append((a,b,b+N*M,a+N*M)if j==0 else(a,a+N*M,b+N*M,b))
vulva=mesh('Vulva',verts,faces,EX);attach('Vagina','Vulva',(0,-.009,.787),.012)
# Deep vestibular bulbs remain above the fold surface and medial to the crura.
for suffix,s in [('l',1),('r',-1)]:ellipsoid('Vestibular bulb.'+suffix,(s*.012,-.025,.813),(.0023,.011,.0025),MU,N=32,M=32)
# True boolean union at the clitoral branch junction, not three overlapping shells.
clitoris=sweep('Clitoris',[(0,-.039,.814),(0,-.046,.807),(0,-.045,.798)],lambda t:.0025-.0004*t,EX,n=60)
for s in [-1,1]:
 branch=sweep('temporary crus',[(s*.0004,-.039,.813),(s*.013,-.019,.806),(s*.020,.005,.804)],lambda t:.0018-.0007*t,EX,n=64)
 boolean(clitoris,branch,'UNION');made.remove(branch);bpy.data.objects.remove(branch,do_unlink=True)
attach('Clitoris','Vulva',(0,-.045,.798),.005)
# Find the actual vestibular surface, bore its urethral opening, then dock the hollow urethra.
vt=bvh(vulva);point,n,index,d=vt.ray_cast(Vector((0,-.029,.84)),Vector((0,0,-1)))
if point is None:raise RuntimeError('Urethral docking surface missing')
urethra=sweep('Female urethra',[(0,.011,.830),(0,-.006,.815),point+Vector((0,0,.006)),point],.0022,MU,n=64,hollow=.0010)
bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.0022,depth=.03,location=point)
cutter=bpy.context.object;boolean(vulva,cutter);bpy.data.objects.remove(cutter,do_unlink=True);attach('Female urethra','Vulva',point,.0035)
# Trim remaining exposed clitoral/fold contact into a small seated interface.
# The only external clitoral contact is its declared glans/hood interface.
attach('Uterus','Cervix',(0,.058,.881),.014)
attach('Cervix','Vagina',(0,.059,.865),.018)
for o in made:
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=.0000003);bmesh.ops.dissolve_degenerate(bm,edges=bm.edges,dist=.0000001)
 boundary=[e for e in bm.edges if e.is_boundary]
 if boundary:bmesh.ops.holes_fill(bm,edges=boundary,sides=0)
 bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(o.data);bm.free();o.data.validate(clean_customdata=True);o.data.update();o['units']='metres'
bpy.ops.object.select_all(action='DESELECT')
for o in made:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'reproductive-female-v2.glb'),export_format='GLB',use_selection=True,export_apply=True,export_normals=True,export_texcoords=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'female-system-v2.blend'))
(OUT/'assembly-v2-interfaces.json').write_text(json.dumps({'interfaces':anchors,'tube_endings':metrics},indent=2))
print('ASSEMBLY',len(made),'objects',flush=True)
