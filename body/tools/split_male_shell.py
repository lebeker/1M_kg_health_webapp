"""Split the male shell into a body and a head, the same way as hers.

With the shell always drawn, a transparent head puts the atlas skull, teeth and eyeballs on display
through it — the same four-eyes artefact her head had. An opaque head fixes both sexes the same way.
"""
import trimesh
import numpy as np

SRC = "../models/skin.glb"
DST = "../models/skin.glb"
SPLIT_Y = 1.42                      # the base of the neck
RADIUS = 0.135                      # only the neck column: the shoulders stay with the body

s = trimesh.load(SRC)
shell = list(s.geometry.values())[0]
print("source", len(shell.vertices), "verts", len(shell.faces), "faces")

tri = shell.vertices[shell.faces]
cen = tri.mean(axis=1)
head_faces = (cen[:, 1] > SPLIT_Y) & (np.abs(cen[:, 0]) < RADIUS) & (np.abs(cen[:, 2]) < RADIUS)
body = shell.submesh([np.where(~head_faces)[0]], append=True)
head = shell.submesh([np.where(head_faces)[0]], append=True)

scene = trimesh.Scene()
scene.add_geometry(body, node_name="skin", geom_name="skin")
scene.add_geometry(head, node_name="skin-head", geom_name="skin-head")
scene.export(DST)
print("body", len(body.faces), "faces  head", len(head.faces), "faces ->", DST)
