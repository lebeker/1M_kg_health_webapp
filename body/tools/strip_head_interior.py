"""The base mesh keeps the eyeballs and the mouth bag inside the head. Through a 45 % shell the mouth
bag reads as a pale second face, and the eyeballs sit proud of the lids — four eyes.

So: drop the mouth bag. Keep the eyeballs, but seat them in their sockets: a hair smaller than the
opening and pushed back along -z, so the lid edge closes over them instead of the ball poking through.
"""
import trimesh
import numpy as np

SRC = "../models/skin-female2.glb"
DST = "../models/skin-female2.glb"

s = trimesh.load(SRC)
mesh = list(s.geometry.values())[0]
comp = mesh.split(only_watertight=False)
keep, dropped, seated = [], [], []
for c in comp:
    b = c.bounds
    ctr = (b[0] + b[1]) / 2
    inside_head = b[0][1] > 1.40 and b[1][1] < 1.70
    interior = inside_head and abs(ctr[0]) < 0.055 and ctr[2] > 0.0 and len(c.vertices) < 1200
    if not interior:
        keep.append(c)
        continue
    # an eyeball is a ball about 2.5 cm across, sitting at eye height; the rest is mouth bag
    wide = (b[1][2] - b[0][2]) < 0.035 and ctr[1] > 1.59      # a ball 2.5 cm across, not the mouth bag
    if wide:
        c.apply_translation(-c.centroid)
        c.apply_scale(0.93)
        c.apply_translation(np.array([ctr[0], ctr[1] - 0.0015, ctr[2] - 0.0045]))
        keep.append(c)
        seated.append((len(c.vertices), np.round(ctr, 3).tolist()))
    else:
        dropped.append((len(c.vertices), np.round(b, 3).tolist()))

print("kept", len(keep), "eyeballs seated", len(seated), "mouth bag dropped", len(dropped))
for d in seated:
    print("  seated", d)
out = trimesh.util.concatenate(keep)
out.export(DST)
print("wrote", DST, len(out.vertices), "verts", len(out.faces), "faces")
