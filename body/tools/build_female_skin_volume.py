"""Construct a closed, fitted female envelope from source anatomy volumes.
The atlas skin is a thin multipart layer, not a body solid: flood-fill its interior before merging.
"""
import json,time,hashlib
from pathlib import Path
import numpy as np,trimesh
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
import fast_simplification
BASE=Path(__file__).resolve().parents[1];OUT=BASE/'models/repair';PITCH=.002;ORIGIN=np.array([-.38,-.27,-.016]);SHAPE=(382,256,894);started=time.time()
def read(file):
 m=trimesh.load(BASE/'models'/file,force='mesh',process=True);m.vertices=np.column_stack([m.vertices[:,0],-m.vertices[:,2],m.vertices[:,1]]);return m

def surface(m,label):
 print('voxelizing',label,len(m.faces),flush=True)
 cache=OUT/'volume-cache';cache.mkdir(exist_ok=True)
 key=hashlib.sha256(np.asarray(m.vertices).tobytes()+np.asarray(m.faces).tobytes()).hexdigest()[:16];file=cache/(key+'.npz')
 if file.exists():
  grid=np.load(file)['grid'];print('cached',label,flush=True);return grid
 grid=np.zeros(SHAPE,dtype=bool)
 for begin in range(0,len(m.faces),6000):
  part=m.submesh([np.arange(begin,min(begin+6000,len(m.faces)))],append=True,repair=False)
  vox=part.voxelized(PITCH,method='subdivide',edge_factor=1.1)
  idx=np.rint((vox.points-ORIGIN)/PITCH).astype(np.int32);valid=np.all((idx>=0)&(idx<np.array(SHAPE)),axis=1);idx=idx[valid];grid[idx[:,0],idx[:,1],idx[:,2]]=True
  if begin%24000==0:print('raster',label,begin,flush=True)
 np.savez_compressed(file,grid=grid)
 print('surface',label,int(grid.sum()),'sec',round(time.time()-started,1),flush=True);return grid
atlas=surface(read('skin.glb'),'atlas skin')
z=ORIGIN[2]+np.arange(SHAPE[2])*PITCH;x=ORIGIN[0]+np.arange(SHAPE[0])*PITCH;y=ORIGIN[1]+np.arange(SHAPE[1])*PITCH
# Temporarily seal the neck to stop open facial features venting the entire body cavity.
k=np.argmin(abs(z-1.45));atlas[:,:,k]=True
atlas=ndi.binary_closing(atlas,iterations=2);atlas=ndi.binary_fill_holes(atlas);atlas[:,:,k-2:]=False
# Crop the male external genital projection from this female-only envelope.
mask=(abs(x[:,None,None])<.038)&(y[None,:,None]<-.052)&((z[None,None,:]>.71)&(z[None,None,:]<.85));atlas[mask]=False
print('atlas solid litres',round(atlas.sum()*PITCH**3*1000,2),flush=True)
D=np.load(OUT/'female-surface-fit.npz');V=D['posed'].copy();original=D['original'];F=D['faces'];sourcez=original[:,2]
# Female face/head is aligned by landmarks, not closest-point deformation.
H=original.copy();H[:,2]=np.interp(sourcez,[0,1.46,1.50,1.54,1.60,1.65,1.743],[0,1.46,1.49,1.52,1.56,1.61,1.743]);t=np.clip((sourcez-1.46)/.07,0,1);t=t*t*(3-2*t);H[:,1]+=.038*t;H[:,0]*=1+.10*t;H[:,1]+=np.maximum(H[:,1],0)*.12*t
blend=np.clip((sourcez-1.43)/.035,0,1);blend=blend*blend*(3-2*blend);V=V*(1-blend[:,None])+H*blend[:,None]
# Match the perineal skin to the same pelvic floor while preserving its outer female form.
w=np.exp(-(V[:,0]/.04)**4-((V[:,2]-.824)/.038)**4-((V[:,1]-.005)/.06)**4);V[:,2]-=.024*w
female=surface(trimesh.Trimesh(vertices=V,faces=F,process=False),'posed female scan');female=ndi.binary_closing(female,iterations=1);female=ndi.binary_fill_holes(female)
print('female scan solid litres',round(female.sum()*PITCH**3*1000,2),flush=True)
# The scan supplies torso/pelvis and face; atlas-aligned limbs keep the existing joint pose.
width=np.interp(z,[0,.70,.97,1.06,1.30,1.40,1.46,1.8],[.18,.18,.18,.145,.145,.185,.18,.15])
region=((z[None,None,:]>.70)&(z[None,None,:]<1.46)&(abs(x[:,None,None])<width[None,None,:]))|(z[None,None,:]>=1.43)
female &= region;atlas |= female;del female,region,mask
# Include the actual underlying anatomy before the final clearance operation.
for file in ['bones.glb','muscles.glb']:
 s=surface(read(file),file);atlas|=s;del s
# Active female organ surfaces, excluding the male-only shared ducts and annotation planes.
scene=trimesh.load(BASE/'models/organs.glb',force='scene');parts=[]
for node in scene.graph.nodes_geometry:
 transform,geom=scene.graph[node];name=node.lower()
 if name.startswith(('urethra','ejaculatory'))or'.j' in name:continue
 m=scene.geometry[geom].copy();m.apply_transform(transform);parts.append(m)
common=trimesh.util.concatenate(parts);common.vertices=np.column_stack([common.vertices[:,0],-common.vertices[:,2],common.vertices[:,1]])
s=surface(common,'common organs');atlas|=s;del s
# Close residual source-region seams, fill internal voids and provide a true soft-tissue margin.
atlas=ndi.binary_closing(atlas,iterations=2);atlas=ndi.binary_fill_holes(atlas)
structure=ndi.generate_binary_structure(3,2);atlas=ndi.binary_dilation(atlas,structure=structure,iterations=2)
# Keep only the connected whole-body volume, dropping source annotation fragments if any.
labels,count=ndi.label(atlas);sizes=np.bincount(labels.ravel());sizes[0]=0;keep=sizes.argmax();atlas=labels==keep;del labels
assert not(atlas[0].any()or atlas[-1].any()or atlas[:,0].any()or atlas[:,-1].any()or atlas[:,:,0].any()or atlas[:,:,-1].any()),'Body volume touches grid boundary'
print('final body litres',round(atlas.sum()*PITCH**3*1000,2),'components',count,flush=True)
field=ndi.gaussian_filter(atlas.astype(np.float32),sigma=.65);del atlas
vertices,faces,normals,values=marching_cubes(field,level=.45,spacing=(PITCH,)*3,allow_degenerate=False,gradient_direction='ascent');vertices+=ORIGIN;del field,values,normals
m=trimesh.Trimesh(vertices=vertices,faces=faces,process=False);trimesh.smoothing.filter_taubin(m,lamb=.45,nu=.48,iterations=6)
print('Marching surface',len(m.faces),'closed',m.is_watertight,flush=True)
assert m.is_watertight,'Volumetric source must be closed'
raw=m.copy()
v,f=fast_simplification.simplify(np.asarray(m.vertices,dtype=np.float64),np.asarray(m.faces,dtype=np.int32),target_count=260000,agg=2)
m=trimesh.Trimesh(vertices=v,faces=f,process=False)
print('Simplified surface',len(m.faces),'closed',m.is_watertight,flush=True)
if not m.is_watertight:m=raw
m.fix_normals(multibody=True)
if m.volume<0:m.invert()
assert m.is_watertight,'Candidate skin is not closed'
np.savez_compressed(OUT/'female-skin-final.npz',vertices=m.vertices,faces=m.faces)
report={'vertices':len(m.vertices),'triangles':len(m.faces),'watertight':bool(m.is_watertight),'consistent_winding':bool(m.is_winding_consistent),'volume_litres':float(m.volume*1000),'pitch_mm':PITCH*1000,'construction':'female scan form in atlas pose; solid filled envelope plus reference anatomy clearance'}
m.vertices=np.column_stack([m.vertices[:,0],m.vertices[:,2],-m.vertices[:,1]]);m.visual=trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(baseColorFactor=[205,176,159,255],roughnessFactor=.65,metallicFactor=0));m.export(OUT/'skin-female-candidate.glb');(OUT/'surface-reconstruction.json').write_text(json.dumps(report,indent=2));print(report,'seconds',round(time.time()-started,1),flush=True)
