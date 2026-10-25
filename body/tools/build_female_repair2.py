"""Author a replacement female tract in the atlas pelvis, in metres (Blender Z-up).

Second repair pass: the uterus is a curved pear rather than a stack of rings, the tube leaves
the uterine cornu and arches over the ovary, the infundibulum opens *toward* the ovary's lateral
surface, and the fimbriae are swept onto the ovarian cortex instead of sprouting from its pole.
Ligaments end in tissue (cornu, hilum, labium), never in mid-air.

Run: Blender -b --python body/tools/build_female_repair2.py
"""
import bpy, bmesh, math
from pathlib import Path
from mathutils import Vector, Matrix

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "models/repair"
OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
made = []


def material(name, colour):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*colour, 1)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = 0.49
    return m


SEROSA = material("Uterine serosa", (0.47, 0.17, 0.19))
CERVIX_M = material("Cervical tissue", (0.51, 0.23, 0.25))
VAGINA_M = material("Vaginal wall", (0.48, 0.19, 0.23))
OVARY_M = material("Ovarian cortex", (0.60, 0.36, 0.34))
TUBE_M = material("Tubal serosa", (0.57, 0.26, 0.29))
LIG_M = material("Ligament", (0.68, 0.51, 0.47))
EXT_M = material("External tissue", (0.56, 0.29, 0.27))
MUCOUS = material("Mucosa", (0.57, 0.22, 0.25))


def mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    made.append(o)
    return o


def cubic(values, t):
    n = len(values)
    u = max(0, min(n - 1, t * (n - 1)))
    i = min(n - 2, int(u))
    f = u - i
    p0, p1, p2, p3 = values[max(i - 1, 0)], values[i], values[i + 1], values[min(i + 2, n - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)


def sample(points, n):
    return [cubic([Vector(p) for p in points], i / (n - 1)) for i in range(n)]


def loft(name, stations, mat, rings=72, segs=96, inner=None, fold=0.0, top=True, bottom=True):
    verts, faces = [], []
    for side in range(2 if inner else 1):
        for j in range(rings):
            t = j / (rings - 1)
            q = cubic([Vector(v) for v in stations], t)
            x, y, z, rx, ry = q
            if side:
                rx, ry = inner(t, rx, ry)
            for i in range(segs):
                a = i / segs * math.tau
                r = 1.0
                if side and fold:
                    r += fold * math.sin(t * math.pi * 34 + math.cos(a) * 0.9) * math.sin(math.pi * t) ** 0.5
                verts.append((x + rx * math.cos(a) * r, y + ry * math.sin(a) * r, z))
        off = side * rings * segs
        for j in range(rings - 1):
            for i in range(segs):
                a = off + j * segs + i
                b = off + j * segs + (i + 1) % segs
                f = (a, b, b + segs, a + segs)
                faces.append(tuple(reversed(f)) if side else f)
    if inner:
        for j in [0, rings - 1]:
            for i in range(segs):
                a = j * segs + i
                b = j * segs + (i + 1) % segs
                c = b + rings * segs
                d = a + rings * segs
                faces.append((a, d, c, b) if j == 0 else (a, b, c, d))
    else:
        for j, enabled in [(0, bottom), (rings - 1, top)]:
            if enabled:
                c = len(verts)
                q = cubic([Vector(v) for v in stations], j / (rings - 1))
                verts.append(tuple(q[:3]))
                for i in range(segs):
                    a = j * segs + i
                    b = j * segs + (i + 1) % segs
                    faces.append((c, b, a) if j == 0 else (c, a, b))
    return mesh(name, verts, faces, mat)


def frames(spine):
    """Parallel transport: a frame that turns with the spine and never flips."""
    tangents = []
    for j in range(len(spine)):
        t = (spine[min(j + 1, len(spine) - 1)] - spine[max(0, j - 1)])
        tangents.append(t.normalized())
    n = Vector((0, 1, 0))
    if abs(n.dot(tangents[0])) > 0.9:
        n = Vector((1, 0, 0))
    n = (n - tangents[0] * n.dot(tangents[0])).normalized()
    out = []
    for j, t in enumerate(tangents):
        if j:
            n = (n - t * n.dot(t)).normalized()
        b = t.cross(n).normalized()
        out.append((t, n, b))
    return out


def tube(name, points, radius, mat, rings=90, segs=20, open_end=False, open_start=False,
         squash=None):
    spine = sample(points, rings)
    fr = frames(spine)
    verts, faces = [], []
    for j, c in enumerate(spine):
        t = j / (rings - 1)
        r = radius(t) if callable(radius) else radius
        n, b = fr[j][1], fr[j][2]
        for i in range(segs):
            a = i / segs * math.tau
            v = c + r * (n * math.cos(a) + b * math.sin(a))
            if squash:
                v = c + v - c
            verts.append(tuple(v))
    for j in range(rings - 1):
        for i in range(segs):
            a = j * segs + i
            b = j * segs + (i + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    if not open_end:
        for j in ([0] if not open_start else []):
            c = len(verts)
            verts.append(tuple(spine[j]))
            for i in range(segs):
                a = j * segs + i
                b = j * segs + (i + 1) % segs
                faces.append((c, b, a))
    if not open_end:
        c = len(verts)
        verts.append(tuple(spine[-1]))
        for i in range(segs):
            a = (rings - 1) * segs + i
            b = (rings - 1) * segs + (i + 1) % segs
            faces.append((c, a, b))
    return mesh(name, verts, faces, mat)


def join(name, objects, mat):
    bm = bmesh.new()
    for o in objects:
        bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for o in objects:
        made.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    made.append(o)
    return o


def bezier(p0, p1, p2, n=16):
    return [tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2) for t in (i / (n - 1) for i in range(n))]


# ---------------------------------------------------------------- uterus, cervix, vagina
# A curved pear: the corpus leans forward over the bladder (y falls as z rises).
uterus = loft("Uterus", [
    (0, .060, .856, .0090, .0075),
    (0, .059, .865, .0118, .0095),
    (0, .057, .874, .0112, .0092),
    (0, .055, .881, .0102, .0084),
    (0, .051, .889, .0150, .0115),
    (0, .045, .898, .0195, .0140),
    (0, .038, .907, .0225, .0158),
    (0, .031, .916, .0238, .0165),
    (0, .025, .923, .0210, .0145),
    (0, .020, .928, .0140, .0098),
    (0, .017, .931, .0045, .0035),
], SEROSA, rings=96, segs=96)

cervix = loft("Cervix", [
    (0, .060, .852, .0080, .0068),
    (0, .060, .858, .0105, .0085),
    (0, .059, .866, .0115, .0092),
    (0, .058, .873, .0108, .0088),
    (0, .057, .877, .0100, .0082),
    (0, .056, .881, .0088, .0074),
], CERVIX_M, rings=48, segs=72,
    inner=lambda t, x, y: (.0026 + .0004 * math.cos(t * math.pi), .0017))

vagina = loft("Vagina", [
    (0, -.014, .787, .0100, .0042),
    (0, -.005, .795, .0118, .0056),
    (0, .006, .806, .0124, .0062),
    (0, .019, .820, .0128, .0066),
    (0, .032, .834, .0134, .0070),
    (0, .044, .846, .0152, .0080),
    (0, .054, .856, .0174, .0094),
    (0, .059, .861, .0150, .0092),
    (0, .061, .865, .0126, .0088),
    (0, .0615, .868, .0116, .0084),
], VAGINA_M, rings=96, segs=64,
    inner=lambda t, x, y: (x - .0018, max(.002, y - .0018)), fold=.10)

# ---------------------------------------------------------------- adnexa
for suffix, s in (("l", 1), ("r", -1)):
    # Almond ovary, long axis vertical, hilum on the medial face.
    verts, faces = [], []
    N, M = 44, 64
    cx, cy, cz = s * .0525, .0370, .9050
    rx, ry, rz = .0105, .0072, .0145
    for j in range(N + 1):
        v = math.pi * j / N
        for i in range(M):
            a = math.tau * i / M
            sv = max(.0001, math.sin(v))
            relief = 1 + .015 * math.sin(7 * a + 2 * v) * math.sin(9 * v) + .010 * math.cos(11 * a - 4 * v)
            x = cx + s * rx * sv * math.cos(a) * relief
            y = cy + ry * sv * math.sin(a) * relief
            z = cz + rz * math.cos(v)
            x += s * .0012 * max(0.0, -math.cos(a)) ** 8 * sv
            verts.append((x, y, z))
    for j in range(N):
        for i in range(M):
            a = j * M + i
            b = j * M + (i + 1) % M
            faces.append((a, b, b + M, a + M))
    for j in [0, N]:
        c = len(verts)
        verts.append((cx, cy, cz + rz * math.cos(math.pi * j / N)))
        for i in range(M):
            a = j * M + i
            b = j * M + (i + 1) % M
            faces.append((c, b, a) if j == 0 else (c, a, b))
    ovary = mesh("Ovary." + suffix, verts, faces, OVARY_M)

    # Tube: cornu -> isthmus -> ampulla arching over the ovary -> funnel facing its lateral face.
    shaft = tube("tube-shaft", [
        (s * .016, .032, .912), (s * .022, .030, .918), (s * .029, .028, .924),
        (s * .037, .026, .930), (s * .045, .026, .934), (s * .052, .029, .935),
        (s * .058, .033, .932), (s * .0605, .034, .9305), (s * .059, .036, .927),
        (s * .057, .036, .9245),
    ], lambda t: .0017 + .0010 * math.sin(math.pi * t) ** 1.2, TUBE_M, rings=120, segs=24)

    # Infundibulum: a cone widening from the ampulla to a rim 4.5 mm across, aimed at the ovary.
    apex = Vector((s * .0570, .0360, .9245))
    rim_c = Vector((s * .0565, .0360, .9210))
    axis = (rim_c - apex).normalized()
    u = axis.cross(Vector((0, 0, 1)))
    if u.length < 1e-6:
        u = axis.cross(Vector((1, 0, 0)))
    u.normalize()
    v = axis.cross(u).normalized()
    funnel = tube("infundibulum", [tuple(apex), tuple(apex.lerp(rim_c, .55) + u * .0015),
                                   tuple(rim_c)], lambda t: .0019 + .0034 * t ** 1.4,
                  TUBE_M, rings=26, segs=48)

    # Fimbriae: from the rim onto the ovarian cortex, ending 0.6 mm above the surface.
    fingers = []
    oc = Vector((cx, cy, cz))
    oa, ob, ocr = rx, ry, rz
    for k in range(18):
        phi = math.tau * k / 18
        rim = rim_c + .0050 * (u * math.cos(phi) + v * math.sin(phi))
        # Targets sit on the ovarian cap, within 35 deg of its upper pole: the fringe drapes
        # over the top and stops there, instead of wrapping down the sides and piercing through.
        alpha = math.radians(8 + 27 * (k % 3) / 2)
        d = Vector((math.sin(alpha) * math.cos(phi), math.sin(alpha) * math.sin(phi),
                    math.cos(alpha)))
        t = 1.0 / math.sqrt((d.x / oa) ** 2 + (d.y / ob) ** 2 + (d.z / ocr) ** 2)
        target = oc + d * t + d * .0008
        mid = rim.lerp(target, .5) + (rim - oc).normalized() * .0018
        fingers.append(tube("fimbria", bezier(rim, mid, target, 18),
                            lambda t: .00060 * (1 - .7 * t) + .00015, TUBE_M, rings=18, segs=10))
    join("Uterine tube." + suffix, [shaft, funnel, *fingers], TUBE_M)

    # Ovarian ligament: cornu to the ovarian hilum.
    tube("Ovarian ligament." + suffix,
         [(s * .015, .044, .909), (s * .026, .043, .905), (s * .036, .041, .900), (s * .047, .039, .895)],
         lambda t: .0014 + .0004 * math.sin(math.pi * t), LIG_M, rings=40, segs=14)

    # (Round ligaments are omitted: inside the pelvis they are a membrane, and as free
    # tubes they read as wires. The ovarian ligament is the one that carries meaning here.)

# ---------------------------------------------------------------- vulva
# Mons pad.
verts, faces = [], []
N, M = 32, 48
for j in range(N + 1):
    vv = math.pi * j / N
    for i in range(M):
        a = math.tau * i / M
        sv = max(.0001, math.sin(vv))
        verts.append((.0130 * sv * math.cos(a), -.050 + .007 * sv * math.sin(a), .810 + .008 * math.cos(vv)))
for j in range(N):
    for i in range(M):
        a = j * M + i
        b = j * M + (i + 1) % M
        faces.append((a, b, b + M, a + M))
for j in [0, N]:
    c = len(verts)
    verts.append((0, -.050, .810 + .008 * math.cos(math.pi * j / N)))
    for i in range(M):
        a = j * M + i
        b = j * M + (i + 1) % M
        faces.append((c, b, a) if j == 0 else (c, a, b))
mesh("Mons pubis", verts, faces, EXT_M)

for suffix, s in (("l", 1), ("r", -1)):
    # Labia majora: a rounded pad from the mons to the posterior commissure.
    tube("Labium majus." + suffix, [
        (s * .016, -.052, .808), (s * .020, -.040, .800), (s * .021, -.026, .792),
        (s * .018, -.014, .787), (s * .010, -.006, .784),
    ], lambda t: .0072 * (0.55 + 0.45 * math.sin(math.pi * t) ** .5), EXT_M, rings=56, segs=28)

    # Labia minora: thinner folds inside the majora, meeting at the frenulum.
    tube("Labium minus." + suffix, [
        (s * .007, -.050, .807), (s * .010, -.038, .799), (s * .010, -.024, .792),
        (s * .007, -.013, .788), (s * .003, -.007, .786),
    ], lambda t: .0022 * (0.6 + 0.4 * math.sin(math.pi * t) ** .5), MUCOUS, rings=52, segs=18)

    # Vestibular bulb: erectile tissue beside the introitus.
    tube("Vestibular bulb." + suffix, [
        (s * .008, -.036, .799), (s * .012, -.022, .795), (s * .011, -.010, .790),
    ], lambda t: .0012 + .0032 * math.sin(math.pi * t) ** .6, MUCOUS, rings=40, segs=20)

# Clitoris: glans at the anterior commissure, body and crura behind it.
clit = [tube("clitoral-body", [(0, -.028, .816), (0, -.038, .810), (0, -.047, .805)],
             lambda t: .0028 + .0006 * math.sin(t * math.pi), EXT_M, rings=36, segs=24),
        tube("glans", [(0, -.047, .805), (0, -.053, .802)], lambda t: .0030 * (1 - .35 * t),
             EXT_M, rings=20, segs=20)]
for s in (-1, 1):
    clit.append(tube("crus", [(0, -.030, .812), (s * .010, -.016, .805), (s * .016, -.003, .801)],
                     lambda t: .0016 * (1 - .5 * t), EXT_M, rings=36, segs=12))
join("Clitoris", clit, EXT_M)

# Her urethra: four points, from the bladder neck down to the vestibule, in front of the vagina.
# The atlas ships one male tube (8.6 cm, out through the penis); it is male-only in the app, so this
# is the only one she has, and its top point sits on the bladder so the bladder never hangs in the air.
tube("Female urethra", [(0, .010, .833), (0, .004, .822), (0, -.004, .812), (0, -.012, .804),
                        (0, -.018, .800)],
     lambda t: .0020 + .0004 * (1 - t), MUCOUS, rings=48, segs=18)

# ---------------------------------------------------------------- fit to the atlas pelvis
# The reference pelvis is male, and its iliac fossa crowds the adnexa. Shift the lateral end of
# each adnexal organ medially, forward and up, fading to zero at the uterine cornu so the tube
# stays attached to the uterus.
def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


for o in made:
    if o.name.startswith(("Ovary.", "Uterine tube.", "Ovarian ligament.")):
        for v in o.data.vertices:
            w = smooth((abs(v.co.x) - .020) / .018)
            if w <= 0:
                continue
            v.co.x -= math.copysign(.006 * w, v.co.x)
            v.co.y -= .030 * w
            v.co.z += .006 * w

# ---------------------------------------------------------------- export
for o in made:
    o["source"] = "Original authored female anatomy, second repair"
    o["units"] = "metres"
bpy.ops.object.select_all(action="DESELECT")
for o in made:
    o.select_set(True)
bpy.context.view_layer.objects.active = uterus
bpy.ops.export_scene.gltf(filepath=str(OUT / "reproductive-female-v3.glb"), export_format="GLB",
                          use_selection=True, export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_normals=True, export_texcoords=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "female-repair-v3.blend"))

report = {}
for o in made:
    o.data.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(o.data)
    report[o.name] = {
        "vertices": len(o.data.vertices),
        "triangles": len(o.data.loop_triangles),
        "boundary_edges": sum(e.is_boundary for e in bm.edges),
        "nonmanifold_edges": sum(not e.is_manifold for e in bm.edges),
        "min": [min(v.co[i] for v in o.data.vertices) for i in range(3)],
        "max": [max(v.co[i] for v in o.data.vertices) for i in range(3)],
    }
    bm.free()
(OUT / "geometry-report-v3.json").write_text(__import__("json").dumps(report, indent=2))
print("CREATED", len(made), "meshes", sum(v["triangles"] for v in report.values()), "triangles", flush=True)
