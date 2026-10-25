"""Split the female shell into a body and a head.

The base mesh keeps a modelled nasal cavity, eye sockets and a mouth bag inside the head. Through a
45 % shell they read as a second face — four eyes, a pale mask, a septum in the air. No amount of
trimming fixes that honestly: the interior is what makes the head look like a head once it is opaque.

So the head is its own mesh and the app draws it opaque, while the body stays a 45 % shell.
"""
import trimesh
import numpy as np

SRC = "../models/skin-female2.glb"
DST = "../models/skin-female2.glb"
SPLIT_Y = 1.42                      # the base of the neck

s = trimesh.load(SRC)
shell = list(s.geometry.values())[0]

tri = shell.vertices[shell.faces]
cen = tri.mean(axis=1)
head_faces = (cen[:, 1] > SPLIT_Y) & (np.abs(cen[:, 0]) < 0.13) & (np.abs(cen[:, 2]) < 0.13)
body = shell.submesh([np.where(~head_faces)[0]], append=True)
head = shell.submesh([np.where(head_faces)[0]], append=True)
body.metadata["name"] = "skin-female2"
head.metadata["name"] = "skin-female2-head"

scene = trimesh.Scene()
scene.add_geometry(body, node_name="skin-female2", geom_name="skin-female2")
scene.add_geometry(head, node_name="skin-female2-head", geom_name="skin-female2-head")
scene.export(DST)
print("body", len(body.faces), "faces  head", len(head.faces), "faces ->", DST)
