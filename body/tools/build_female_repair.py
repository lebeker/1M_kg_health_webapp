"""Author a replacement female tract in the atlas pelvis, in metres (Blender Z-up).
Original procedural surfaces; no atlas geometry is modified. See body/MODEL_REPAIR.md.
Run Blender -b --python body/tools/build_female_repair.py.
"""
import bpy,bmesh,math,json,os
from pathlib import Path
from mathutils import Vector,Matrix
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair';OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
made=[]
def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=.49
 return m
UT=material('Uterine serosa',(.47,.17,.19));CX=material('Cervical tissue',(.51,.23,.25));VG=material('Vaginal wall',(.48,.19,.23));OV=material('Ovarian cortex',(.68,.49,.42));TU=material('Tubal serosa',(.57,.26,.29));LIG=material('Ligament',(.68,.51,.47));EXT=material('External tissue',(.56,.29,.27));MU=material('Mucosa',(.57,.22,.25))
def mesh(name,verts,faces,mat):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.validate();me.update()
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
 o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o);o.data.materials.append(mat)
 for p in me.polygons:p.use_smooth=True
 made.append(o);return o

def cubic(values,t):
 # Clamped Catmull-Rom interpolation; profile changes are continuous at authored stations.
 n=len(values);u=max(0,min(n-1,t*(n-1)));i=min(n-2,int(u));f=u-i
 p0=values[max(i-1,0)];p1=values[i];p2=values[i+1];p3=values[min(i+2,n-1)]
 return .5*((2*p1)+(-p0+p2)*f+(2*p0-5*p1+4*p2-p3)*f*f+(-p0+3*p1-3*p2+p3)*f*f*f)
def sample(points,n):return [cubic([Vector(p)for p in points],i/(n-1))for i in range(n)]
def loft(name,stations,mat,rings=72,segs=96,inner=None,fold=0,top=True,bottom=True):
 # Stations: x,y,z,lateral radius,anteroposterior radius. Ring axes remain anatomical.
 verts=[];faces=[]
 for side in range(2 if inner else 1):
  for j in range(rings):
   t=j/(rings-1);q=cubic([Vector(v)for v in stations],t)
   x,y,z,rx,ry=q
   if side:rx,ry=inner(t,rx,ry)
   for i in range(segs):
    a=i/segs*math.tau;r=1
    # Transverse vaginal rugae are part of the inner surface, not loose decoration.
    if side and fold:r+=fold*math.sin(t*math.pi*34+math.cos(a)*.9)*math.sin(math.pi*t)**.5
    verts.append((x+rx*math.cos(a)*r,y+ry*math.sin(a)*r,z))
  off=side*rings*segs
  for j in range(rings-1):
   for i in range(segs):
    a=off+j*segs+i;b=off+j*segs+(i+1)%segs
    f=(a,b,b+segs,a+segs);faces.append(tuple(reversed(f))if side else f)
 if inner:
  for j in [0,rings-1]:
   for i in range(segs):
    a=j*segs+i;b=j*segs+(i+1)%segs;c=b+rings*segs;d=a+rings*segs
    faces.append((a,d,c,b)if j==0 else(a,b,c,d))
 else:
  for j,enabled in [(0,bottom),(rings-1,top)]:
   if enabled:
    c=len(verts);q=cubic([Vector(v)for v in stations],j/(rings-1));verts.append(tuple(q[:3]))
    for i in range(segs):
     a=j*segs+i;b=j*segs+(i+1)%segs;faces.append((c,b,a)if j==0 else(c,a,b))
 return mesh(name,verts,faces,mat)
def tube(name,points,radius,mat,rings=90,segs=20,open_end=False):
 spine=sample(points,rings);verts=[];faces=[];prev=None
 for j,c in enumerate(spine):
  t=j/(rings-1);tangent=(spine[min(j+1,rings-1)]-spine[max(0,j-1)]).normalized()
  ref=Vector((0,1,0))if abs(tangent.y)<.92 else Vector((1,0,0))
  normal=tangent.cross(ref).normalized();binormal=tangent.cross(normal).normalized()
  if prev is not None and normal.dot(prev)<0:normal=-normal;binormal=-binormal
  prev=normal
  r=radius(t)if callable(radius)else radius
  for i in range(segs):
   a=i/segs*math.tau;v=c+r*(normal*math.cos(a)+binormal*math.sin(a));verts.append(tuple(v))
 for j in range(rings-1):
  for i in range(segs):
   a=j*segs+i;b=j*segs+(i+1)%segs;faces.append((a,b,b+segs,a+segs))
 if not open_end:
  for j in [0,rings-1]:
   c=len(verts);verts.append(tuple(spine[j]))
   for i in range(segs):
    a=j*segs+i;b=j*segs+(i+1)%segs;faces.append((c,b,a)if j==0 else(c,a,b))
 return mesh(name,verts,faces,mat)
def join(name,objects,mat):
 bm=bmesh.new()
 for o in objects:bm.from_mesh(o.data)
 bmesh.ops.recalc_face_normals(bm,faces=bm.faces);me=bpy.data.meshes.new(name);bm.to_mesh(me);bm.free()
 for o in objects:made.remove(o);bpy.data.objects.remove(o,do_unlink=True)
 o=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(o);o.data.materials.append(mat)
 for p in me.polygons:p.use_smooth=True
 made.append(o);return o

# Broad rounded fundus and tapering uterine corpus; anteflexed above the bladder.
uterus=loft('Uterus',[(0,.058,.881,.011,.008),(0,.054,.888,.014,.010),(0,.048,.897,.019,.0125),(0,.040,.908,.024,.015),(0,.033,.920,.027,.016),(0,.029,.928,.024,.013),(0,.027,.934,.014,.007),(0,.026,.936,.001,.0006)],UT,rings=84,segs=96)
# Cervix extends into the vaginal vault; a real lumen remains in the mesh.
cervix=loft('Cervix',[(0,.058,.858,.007,.006),(0,.059,.862,.012,.009),(0,.059,.869,.013,.010),(0,.058,.877,.0115,.0085),(0,.058,.881,.011,.008)],CX,rings=48,segs=72,inner=lambda t,x,y:(.0024+.0005*math.cos(t*math.pi),.0016))
# Flattened, curved canal with superior fornices and an inferior vestibular opening.
vagina=loft('Vagina',[(0,-.009,.787,.010,.0045),(0,.001,.799,.012,.006),(0,.014,.817,.013,.0065),(0,.032,.837,.013,.007),(0,.049,.852,.014,.008),(0,.059,.864,.017,.010),(0,.061,.870,.015,.009)],VG,rings=96,segs=64,inner=lambda t,x,y:(x-.0018,max(.002,y-.0018)),fold=.10)

for suffix,s in [('l',1),('r',-1)]:
 # Almond-shaped cortex with low relief and a visible medial hilum, not an egg primitive.
 verts=[];faces=[];N=44;M=64
 for j in range(N+1):
  v=math.pi*j/N
  for i in range(M):
   a=math.tau*i/M;sv=max(.0001,math.sin(v));relief=1+.018*math.sin(7*a+2*v)*math.sin(9*v)+.012*math.cos(11*a-4*v)
   x=s*(.052+.0105*sv*math.cos(a)*relief);y=.037+.007*sv*math.sin(a)*relief;z=.905+.015*math.cos(v)
   # A shallow hilum runs along the medial edge.
   x+=s*.0015*max(0,-math.cos(a))**8*sv
   verts.append((x,y,z))
 for j in range(N):
  for i in range(M):
   a=j*M+i;b=j*M+(i+1)%M;faces.append((a,b,b+M,a+M))
 for j in [0,N]:
  c=len(verts);verts.append((s*.052,.037,.905+.015*math.cos(math.pi*j/N)))
  for i in range(M):
   a=j*M+i;b=j*M+(i+1)%M;faces.append((c,b,a)if j==0 else(c,a,b))
 ovary=mesh('Ovary.'+suffix,verts,faces,OV)
 # The tube arches over the ovary. The distal funnel stays separate from ovarian cortex.
 pts=[(s*.024,.031,.924),(s*.034,.028,.932),(s*.047,.027,.942),(s*.060,.032,.944),(s*.070,.041,.935),(s*.069,.045,.925),(s*.060,.043,.920)]
 shaft=tube('tube-shaft',pts,lambda t:.0019+.0018*math.sin(t*math.pi*.8)**2,TU,rings=112,segs=20)
 funnel=tube('infundibulum',[(s*.066,.044,.924),(s*.062,.043,.921),(s*.058,.042,.920)],lambda t:.003+.0037*t,TU,rings=20,segs=36,open_end=True)
 bpy.context.view_layer.objects.active=funnel
 wall=funnel.modifiers.new('Infundibular wall','SOLIDIFY');wall.thickness=.0004;wall.offset=-1
 bpy.ops.object.modifier_apply(modifier=wall.name)
 fingers=[]
 for k in range(11):
  a=math.tau*k/11;center=Vector((s*.058,.042,.920));direction=Vector((s*.003*math.cos(a),.004*math.sin(a),-.003-.004*abs(math.cos(a))))
  start=center+Vector((s*.0062*math.cos(a),.0062*math.sin(a),0))
  end=start+direction
  fingers.append(tube('fimbria',[tuple(start),tuple(start+direction*.5+Vector((0,.001,-.001))),tuple(end)],lambda t:.00075*(1-.85*t),TU,rings=14,segs=8))
 join('Uterine tube.'+suffix,[shaft,funnel,*fingers],TU)
 # Ovarian ligament provides anatomical support without falsely fusing tube and ovary.
 tube('Ovarian ligament.'+suffix,[(s*.019,.046,.909),(s*.031,.041,.905),(s*.044,.037,.902)],lambda t:.0015+.0004*math.sin(math.pi*t),LIG,rings=40,segs=12)
 tube('Round ligament.'+suffix,[(s*.023,.023,.918),(s*.040,.005,.905),(s*.061,-.023,.886),(s*.072,-.039,.859)],lambda t:.0012+.0003*math.sin(math.pi*t),LIG,rings=58,segs=12)

# External anatomy: four folded labial surfaces, a body/glans/crura clitoral assembly,
# and paired vestibular bulbs. These are distinct anatomical objects in the export.
for suffix,s in [('l',1),('r',-1)]:
 for minor in [False,True]:
  verts=[];faces=[];N=70;M=30
  for j in range(N+1):
   t=j/N;envelope=max(.0001,math.sin(math.pi*t))**.7
   y=-.050+.072*t
   center_x=s*((.005 if minor else .014)*envelope+.0015)
   center_z=.796-.012*t+.002*math.sin(math.pi*t)
   for i in range(M):
    a=math.tau*i/M;width=(.0023 if minor else .006)*envelope+.00025;height=(.006 if minor else .008)*envelope+.00025
    # A wavy free margin distinguishes the thinner inner folds.
    wave=.0009*math.sin(t*math.pi*8)*max(0,math.sin(a))**4 if minor else 0
    verts.append((center_x+width*math.cos(a),y,center_z+height*math.sin(a)+wave))
  for j in range(N):
   for i in range(M):
    a=j*M+i;b=j*M+(i+1)%M;faces.append((a,b,b+M,a+M))
  for j in [0,N]:
   c=len(verts);verts.append((s*.0015,-.050+.072*j/N,.796-.012*j/N))
   for i in range(M):
    a=j*M+i;b=j*M+(i+1)%M;faces.append((c,b,a)if j==0 else(c,a,b))
  mesh(('Labium minus.'if minor else'Labium majus.')+suffix,verts,faces,MU if minor else EXT)
 tube('Vestibular bulb.'+suffix,[(s*.010,-.031,.801),(s*.015,-.012,.800),(s*.014,.008,.791)],lambda t:.001+.0035*math.sin(math.pi*t)**.65,MU,rings=44,segs=20)
clitoris=[tube('clitoral-body',[(0,-.039,.817),(0,-.047,.812),(0,-.046,.806)],lambda t:.0024+.0008*math.sin(t*math.pi),EXT,rings=40,segs=24)]
for s in [-1,1]:clitoris.append(tube('crus',[(0,-.039,.817),(s*.012,-.021,.806),(s*.025,.003,.797)],lambda t:.002*(1-.6*t),EXT,rings=44,segs=16))
join('Clitoris',clitoris,EXT)
# The atlas's shared urethra is male-specific; this short female urethra replaces it in female mode.
tube('Female urethra',[(0,.002,.830),(0,-.010,.817),(0,-.028,.803)],.0022,MU,rings=44,segs=20)

# Anteflex the uterine body and adnexa over the bladder. This keeps their authored
# dimensions while avoiding the sacral promontory of the atlas reference pelvis.
pivot=Vector((0,.058,.881));rotation=Matrix.Rotation(math.radians(35),3,'X')
for o in made:
 if o.name=='Uterus' or o.name.startswith(('Ovary.','Uterine tube.','Ovarian ligament.','Round ligament.')):
  for v in o.data.vertices:
   p=v.co.copy();weight=1.
   if o.name=='Uterus':
    t=max(0,min(1,(p.z-.881)/.014));weight=t*t*(3-2*t)
   elif o.name.startswith('Round ligament.'):
    t=max(0,min(1,(abs(p.x)-.023)/.020));weight=1-t*t*(3-2*t)
   v.co=p.lerp(pivot+rotation@(p-pivot),weight)
 if o.name.startswith(('Ovary.','Uterine tube.','Ovarian ligament.')):
  for v in o.data.vertices:
   t=max(0,min(1,(abs(v.co.x)-.023)/.022));w=t*t*(3-2*t)
   v.co.y-=.030*w;v.co.z+=.012*w
 if o.name.startswith('Ovary.'):
  for v in o.data.vertices:v.co.x-=math.copysign(.008,v.co.x)

# Uniform scale is metres, world positions already match the unchanged atlas layers.
for o in made:
 o['source']='Original authored female anatomy repair';o['units']='metres'
bpy.ops.object.select_all(action='DESELECT')
for o in made:o.select_set(True)
bpy.context.view_layer.objects.active=uterus
bpy.ops.export_scene.gltf(filepath=str(OUT/'reproductive-female.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_normals=True,export_texcoords=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'female-repair.blend'))
report={}
for o in made:
 o.data.calc_loop_triangles();bm=bmesh.new();bm.from_mesh(o.data)
 report[o.name]={'vertices':len(o.data.vertices),'triangles':len(o.data.loop_triangles),'boundary_edges':sum(e.is_boundary for e in bm.edges),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'min':[min(v.co[i]for v in o.data.vertices)for i in range(3)],'max':[max(v.co[i]for v in o.data.vertices)for i in range(3)]}
 bm.free()
(OUT/'geometry-report.json').write_text(json.dumps(report,indent=2))
print('CREATED',len(made),'meshes',sum(v['triangles']for v in report.values()),'triangles',flush=True)
