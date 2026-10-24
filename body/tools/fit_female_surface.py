"""Retarget the CC0 female scan to the unchanged atlas envelope with landmark + ARAP fitting.
Candidate only. Uses scipy/trimesh in the existing geometry environment. Coordinates are Z-up.
"""
import json,time
from pathlib import Path
import numpy as np,trimesh
from scipy.spatial import cKDTree
from scipy.interpolate import RBFInterpolator
from scipy import sparse
from scipy.sparse.linalg import splu
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair'
def read(name):
 m=trimesh.load(BASE/'models'/name,force='mesh',process=True)
 m.vertices=np.column_stack([m.vertices[:,0],-m.vertices[:,2],m.vertices[:,1]])
 return m
m=read('skin-female.glb');target=read('skin.glb');P=np.asarray(m.vertices).copy();F=np.asarray(m.faces)
# Landmark cage: body midline anchors, then paired articulated limbs and feet.
source=[];dest=[]
def anchor(a,b):source.append(a);dest.append(b)
for z in [.02,.30,.60,.85,1.0,1.18,1.37,1.46]:
 for y in [-.09,.07]:anchor((0,y,z),(0,y,z))
for s in [-1,1]:
 for a,b in [((.17,0,1.40),(.18,0,1.40)),((.29,0,1.10),(.225,0,1.10)),((.405,-.025,.86),(.285,-.025,.84)),((.435,-.04,.78),(.31,-.04,.73)),((.44,-.025,.72),(.32,-.025,.65)),((.10,.025,.80),(.085,.025,.80)),((.125,.02,.48),(.085,.02,.49)),((.13,.015,.08),(.08,.015,.085)),((.13,-.065,.025),(.08,-.065,.025))]:anchor((s*a[0],a[1],a[2]),(s*b[0],b[1],b[2]))
# Bring the head back onto the skull while preserving facial relief during the fit.
for a,b in [((0,-.12,1.60),(0,-.105,1.60)),((0,.075,1.64),(0,.115,1.64)),((0,0,1.74),(0,0,1.74))]:anchor(a,b)
rbf=RBFInterpolator(np.array(source),np.array(dest)-np.array(source),kernel='thin_plate_spline',smoothing=.0002)
V=P+rbf(P)
# Female envelope target: original atlas pose, with continuous breast and pelvic contours.
Q=np.asarray(target.vertices).copy();norm=target.vertex_normals.copy()
x,y,z=Q.T
front=np.clip((-norm[:,1]-.1)/.7,0,1)
bust=np.exp(-((np.abs(x)-.065)/.043)**2-((z-1.285)/.057)**2)
Q[:,1]-=.043*bust*front
hip=np.exp(-((z-.91)/.12)**2)*np.clip((np.abs(x)-.07)/.05,0,1)
Q[:,0]+=np.sign(x)*.006*hip
# Exclude male external genital surface from the correspondence target.
keep=~((np.abs(Q[:,0])<.062)&(Q[:,2]>.69)&(Q[:,2]<.85)&(Q[:,1]<-.04))
target.vertices=Q
faces=target.faces[np.all(keep[target.faces],axis=1)]
target=trimesh.Trimesh(vertices=Q,faces=faces,process=False)
rng=np.random.default_rng(13)
points,faceids=trimesh.sample.sample_surface(target,260000,seed=13)
points=np.vstack([points,Q[keep]]);tn=np.vstack([target.face_normals[faceids],target.vertex_normals[keep]])
# A female perineal target keeps registration from pulling the scan toward male genitalia.
groin=(np.abs(V[:,0])<.07)&(V[:,2]>.70)&(V[:,2]<.85)
points=np.vstack([points,V[groin]]);tn=np.vstack([tn,m.vertex_normals[groin]])
kd=cKDTree(points)
edges=m.edges_unique;I=edges[:,0];J=edges[:,1];N=len(V)
rows=np.r_[I,J];cols=np.r_[J,I];adj=sparse.coo_matrix((np.ones(len(rows)),(rows,cols)),shape=(N,N)).tocsr();degree=np.asarray(adj.sum(axis=1)).ravel();L=sparse.diags(degree)-adj
lam=.65;solver=splu((L+lam*sparse.eye(N)).tocsc())
# Rest edges use the posed scan, keeping its local shape while the envelope adjusts.
rest=V.copy();restedge=rest[I]-rest[J]
start=time.time()
for iteration in range(32):
 deformed=V[I]-V[J]
 C=np.zeros((N,3,3));outer=deformed[:,:,None]*restedge[:,None,:]
 np.add.at(C,I,outer);np.add.at(C,J,outer)
 U,S,VT=np.linalg.svd(C);R=U@VT;bad=np.linalg.det(R)<0
 if np.any(bad):U[bad,:,-1]*=-1;R[bad]=U[bad]@VT[bad]
 b=np.zeros((N,3));rot=.5*np.einsum('nij,nj->ni',R[I]+R[J],restedge);np.add.at(b,I,rot);np.add.at(b,J,-rot)
 distances,idx=kd.query(V,k=1,workers=4);nearest=points[idx]
 # Relax correspondence updates to avoid foldovers at tight finger/face features.
 delta=nearest-V;length=np.linalg.norm(delta,axis=1);delta*=np.minimum(1,.012/np.maximum(length,1e-12))[:,None]
 result=solver.solve(b+lam*(V+delta));V=.8*result+.2*V
 if iteration%4==0:print('fit',iteration,'median_mm',round(float(np.median(distances))*1000,2),'p95_mm',round(float(np.quantile(distances,.95))*1000,2),'sec',round(time.time()-start,1),flush=True)
# Export with welded scan topology and newly computed smooth normals.
fitted=trimesh.Trimesh(vertices=V,faces=F,process=False);fitted.fix_normals()
np.savez_compressed(OUT/'female-surface-fit.npz',original=P,posed=rest,fitted=V,faces=F)
# Back to the viewer's Y-up frame.
fitted.vertices=np.column_stack([V[:,0],V[:,2],-V[:,1]])
fitted.visual=trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(baseColorFactor=[202,174,157,255],roughnessFactor=.65,metallicFactor=0))
fitted.export(OUT/'skin-female-candidate.glb')
report={'vertices':int(N),'triangles':int(len(F)),'watertight':bool(fitted.is_watertight),'consistent_winding':bool(fitted.is_winding_consistent),'median_target_distance_mm':float(np.median(distances)*1000),'p95_target_distance_mm':float(np.quantile(distances,.95)*1000),'max_displacement_mm':float(np.max(np.linalg.norm(V-P,axis=1))*1000)}
(OUT/'surface-fit-initial.json').write_text(json.dumps(report,indent=2));print(report,flush=True)
