"""
Builds the BrightSmile 3D molar in Blender and exports it as public/models/molar.glb.

Headless (from the frontend folder):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
      --python assets-src/tooth/build_molar.py -- [--preview <folder>]
Live (Blender open): exec() this file with __name__ != "__main__", then call build(), look(),
render_sheet(folder) and export() one by one.

How it works:
  1. A coarse "cage" of quads: a box for the crown (its top shaped into four soft cusps around a
     "+" groove), extruded down into a short trunk, which splits into three roots.
  2. A Subdivision Surface modifier smooths the cage. Think of the cage as a wire frame inside a
     balloon: the balloon follows the wires softly, so a few dozen points give one smooth surface.
  3. Export: the modifier is applied, and a little "ambient occlusion" (how hidden each point is,
     e.g. between the roots) is stored per vertex in COLOR_0. The website colours the tooth with
     its own shader, so no material is exported.

Axes: Blender is Z-up and the tooth's front faces -Y. The glTF exporter turns that into y-up with
the front facing +z, which is what the website's camera looks at.
"""

import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "models", "molar.glb"))

# ---------- the shape ----------
N = 8  # cage squares per crown side (even, so the top has a centre point for the groove)
HX, HY = 1.08, 0.98  # crown half-width (left-right) and half-depth (front-back)
ROUND = 0.45  # 0 = square crown seen from above, 1 = round
# crown rings from the neck up: (height, width scale). The top ring's height comes from top_height().
RINGS = [(0.0, 0.74), (0.5, 0.97), (1.0, 1.0), (None, 0.92)]
TRUNK = (-0.4, 0.72)  # the root trunk under the neck: (height, width scale)
ARCH = 0.3  # how high the space between the roots arches up into the trunk
# root ring sizes along the root (0 = where it leaves the trunk, 1 = tip)
ROOT_STEPS = [(0.15, 1.05), (0.35, 1.0), (0.55, 0.88), (0.72, 0.72), (0.87, 0.52), (1.0, 0.27)]
# Four roots, one under each corner of the crown. Each: the trunk squares it grows from (u and v ranges,
# -1..1; front is v = -1), the way it leans out (x, y), how its cross-section is stretched (x, y),
# its length, and how much it twists from base to tip (radians). They differ a little on purpose:
# real roots are never copies of each other.
ROOTS = [
    dict(u=(-1, -0.25), v=(-1, -0.25), lean=(-1.0, -0.45), stretch=(0.9, 1.05), length=1.5, twist=0.25),  # front-left
    dict(u=(0.25, 1), v=(-1, -0.25), lean=(1.0, -0.35), stretch=(0.86, 1.08), length=1.38, twist=-0.2),  # front-right
    dict(u=(-1, -0.25), v=(0.25, 1), lean=(-0.8, 0.7), stretch=(0.92, 1.0), length=1.3, twist=-0.15),  # back-left
    dict(u=(0.25, 1), v=(0.25, 1), lean=(0.7, 0.8), stretch=(0.95, 0.95), length=1.42, twist=0.2),  # back-right
]
SPLAY = 0.34  # how far the roots lean out
BEND = Vector((0.14, 0.04, 0))  # all root tips curve a little the same way, as real roots do
LUMPS = 0.03  # gentle unevenness over the whole surface, so it doesn't look machine-made
GROOVE_CREASE = 0.75  # 0 = the grooves melt away when smoothed, 1 = knife-sharp
SUBDIV = 3  # smoothing levels (each level = 4x the faces)

# the four cusps: (u, v, height). Uneven on purpose: the front-left one is the tallest, as on a real molar.
CUSPS = [(-0.5, -0.48, 0.3), (0.5, -0.5, 0.26), (-0.47, 0.5, 0.24), (0.5, 0.47, 0.2)]


def top_height(u, v):
    """Height of the biting surface: four pointed cusps, a sharp "+" groove between them, a rim."""
    cusp = sum(h * math.exp(-((u - a) ** 2 + (v - b) ** 2) / 0.08) for a, b, h in CUSPS)
    edge = max(abs(u), abs(v))
    groove = max(math.exp(-u * u / 0.02), math.exp(-v * v / 0.02)) * (1 - 0.6 * edge * edge)  # fades toward the rim
    rim = edge**4
    return 1.3 + cusp - 0.26 * groove - 0.15 * rim


def plan(u, v):
    """Square grid -> rounded square (seen from above)."""
    return u * (1 - ROUND * (1 - math.sqrt(1 - v * v / 2))), v * (1 - ROUND * (1 - math.sqrt(1 - u * u / 2)))


def crown(bm):
    """The crown as a closed box of quads, N x N squares on each face, one ring per RINGS entry.
    Returns the edges along the "+" groove on top, so they can be kept sharp."""
    nz = len(RINGS) - 1
    verts = {}

    def vert(i, j, k):
        if (i, j, k) not in verts:
            u, v = 2 * i / N - 1, 2 * j / N - 1
            z, s = RINGS[k]
            x, y = plan(u, v)
            verts[i, j, k] = bm.verts.new((HX * s * x, HY * s * y, top_height(u, v) if z is None else z))
        return verts[i, j, k]

    quads = []
    for a in range(N):
        for b in range(N):
            quads.append([(a, b, 0), (a + 1, b, 0), (a + 1, b + 1, 0), (a, b + 1, 0)])
            quads.append([(a, b, nz), (a + 1, b, nz), (a + 1, b + 1, nz), (a, b + 1, nz)])
        for k in range(nz):
            for c in (0, N):
                quads.append([(a, c, k), (a + 1, c, k), (a + 1, c, k + 1), (a, c, k + 1)])
                quads.append([(c, a, k), (c, a + 1, k), (c, a + 1, k + 1), (c, a, k + 1)])
    for q in quads:
        bm.faces.new([vert(*c) for c in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    m = N // 2  # the groove lines run through the middle of the top, stopping well short of the rim
    lines = [((m, c, nz), (m, c + 1, nz)) for c in range(2, N - 2)] + [((c, m, nz), (c + 1, m, nz)) for c in range(2, N - 2)]
    return [bm.edges.get((verts[a], verts[b])) for a, b in lines]


def extrude(bm, faces):
    """Extrude a group of faces (the new ones start where the old ones were); returns the new faces."""
    ret = bmesh.ops.extrude_face_region(bm, geom=faces)
    new_faces = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.delete(bm, geom=faces, context="FACES")  # the originals stay behind otherwise
    return new_faces


def build():
    bm = bmesh.new()
    # how sharp the smoothing keeps each edge (made first: adding a layer later invalidates edge references)
    crease = bm.edges.layers.float.new("crease_edge")
    for e in crown(bm):
        e[crease] = GROOVE_CREASE
    # trunk: the whole underside moves down and narrows a little
    bottom = [f for f in bm.faces if f.calc_center_median().z < 0.01 and f.normal.z < -0.5]
    trunk = extrude(bm, bottom)
    z0, s0 = TRUNK
    for v in {v for f in trunk for v in f.verts}:
        v.co = Vector((v.co.x / RINGS[0][1] * s0, v.co.y / RINGS[0][1] * s0, z0))

    # roots: each grows from a block of trunk squares, in ROOT_STEPS rings that lean out, taper, twist
    # a little, and bend toward the same side near the tip
    for r in ROOTS:
        (u0, u1), (v0, v1) = r["u"], r["v"]
        sx, sy = HX * s0, HY * s0
        faces = []
        for f in trunk:
            if not f.is_valid:  # already extruded into an earlier root
                continue
            c = f.calc_center_median()
            u, v = c.x / sx, c.y / sy
            if u0 <= u <= u1 and v0 <= v <= v1:
                faces.append(f)
        ring = [v.co.copy() for v in {v for f in faces for v in f.verts}]
        centre = sum(ring, Vector()) / len(ring)
        lean = Vector((*r["lean"], 0)).normalized()
        prev_c, prev_s, prev_t = centre.copy(), 1.0, 0.0
        for i, (t, s) in enumerate(ROOT_STEPS):
            faces = extrude(bm, faces)
            c = centre + lean * SPLAY * (1.2 * t - 1.0 * t * t) + BEND * t**3 + Vector((0, 0, -r["length"] * t))
            wx, wy = r["stretch"] if i == 0 else (1, 1)  # stretched once, then the shape carries down
            a = r["twist"] * (t - prev_t)
            ca, sa = math.cos(a), math.sin(a)
            for v in {v for f in faces for v in f.verts}:
                ox, oy = (v.co.x - prev_c.x) * wx, (v.co.y - prev_c.y) * wy
                v.co = c + Vector((ox * ca - oy * sa, ox * sa + oy * ca, 0)) * (s / prev_s)
            prev_c, prev_s, prev_t = c, s, t

    # the trunk's underside left between the roots: lift it so it becomes a rounded arch. The farther
    # a point is from a root (counted in cage steps), the higher it rises: a round "∩", not a flat
    # shelf. Points on the outside edge rise less and tuck in a little, so the sides curve in smoothly.
    flat = {v for v in bm.verts if abs(v.co.z - z0) < 1e-4}
    root_top = {v for v in flat if any(w.co.z < z0 - 1e-4 for f in v.link_faces for w in f.verts)}
    hops, layer = {v: 0 for v in root_top}, list(root_top)
    while layer:  # breadth-first: neighbours of the root tops are 1 step away, their neighbours 2...
        nxt = []
        for v in layer:
            for e in v.link_edges:
                w = e.other_vert(v)
                if w in flat and w not in hops:
                    hops[w] = hops[v] + 1
                    nxt.append(w)
        layer = nxt
    for v in flat:
        if v in root_top:
            continue
        lift = ARCH * min(1.0, 0.4 * hops.get(v, 3))
        if all(abs(w.co.z - z0) < 1e-4 for f in v.link_faces for w in f.verts):
            v.co.z += lift
        else:
            v.co = Vector((v.co.x * 0.9, v.co.y * 0.9, z0 + lift * 0.7))

    # gentle lumps: every cage point is nudged by smooth noise (the same every run)
    for v in bm.verts:
        v.co += noise.noise_vector(v.co * 1.6 + Vector((3.1, 7.7, 1.3))) * LUMPS

    me = bpy.data.meshes.new("Molar")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("Molar", me)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = True
    sub = obj.modifiers.new("Smooth", "SUBSURF")
    sub.levels = sub.render_levels = SUBDIV
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


# ---------- look (for previews only; the website has its own shader) ----------
def look(obj):
    scene = bpy.context.scene
    mat = bpy.data.materials.new("Enamel")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.86, 0.85, 0.81, 1)
    b.inputs["Roughness"].default_value = 0.32
    b.inputs["Coat Weight"].default_value = 0.6
    b.inputs["Coat Roughness"].default_value = 0.12
    b.inputs["Subsurface Weight"].default_value = 0.15
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.02, 0.022, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    for name, loc, energy, size in (("Key", (-3, -4, 5), 900, 4), ("Fill", (4, -3, 1), 300, 5), ("Rim", (0, 5, 3), 500, 3)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, -0.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(lo)

    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 4.2
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 360
    scene.view_settings.view_transform = "AgX"


# (name, camera yaw in degrees around the tooth, camera pitch: 0 = level, 90 = from above)
VIEWS = [("front", 0, 5), ("left", -90, 5), ("right", 90, 5), ("top", 0, 90), ("bottom", 0, -90),
         ("front_left_45", -45, 10), ("front_right_45", 45, 10), ("top_angled", -20, 40)]


def render_sheet(folder):
    scene, cam = bpy.context.scene, bpy.context.scene.camera
    os.makedirs(folder, exist_ok=True)
    target = Vector((0, 0, -0.2))
    shots = []
    for name, yaw, pitch in VIEWS:
        y, p = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
        cam.location = target + d * 10
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(folder, f"molar_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        shots.append(path)
    imgs = [bpy.data.images.load(p, check_existing=False) for p in shots]
    w, h = imgs[0].size
    cols = 4
    rows = math.ceil(len(imgs) / cols)
    sheet = np.zeros((h * rows, w * cols, 4), dtype=np.float32)
    for i, im in enumerate(imgs):
        r = rows - 1 - i // cols  # image rows start at the bottom
        sheet[r * h : (r + 1) * h, (i % cols) * w : (i % cols + 1) * w] = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        bpy.data.images.remove(im)
    out = bpy.data.images.new("sheet", w * cols, h * rows)
    out.pixels = sheet.ravel()
    out.filepath_raw = os.path.join(folder, "sheet.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    return os.path.join(folder, "sheet.png")


# ---------- export ----------
def bake_ao(obj, rays=48, reach=0.7):
    """Per-vertex ambient occlusion: the share of short rays from each point that escape the tooth."""
    me = obj.data
    bvh = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
    rng = random.Random(7)
    dirs = []
    while len(dirs) < rays:
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if 0.01 < d.length <= 1:
            dirs.append(d.normalized())
    attr = me.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
    for v in me.vertices:
        n = v.normal
        o = v.co + n * 0.002
        free = total = 0
        for d in dirs:
            c = d.dot(n)
            if c <= 0:
                d, c = -d, -c
            total += c
            if bvh.ray_cast(o, d, reach)[0] is None:
                free += c
        a = free / total
        attr.data[v.index].color = (a, a, a, 1)


def export(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    final = obj.copy()
    final.data = obj.data.copy()
    final.name = "MolarExport"
    bpy.context.scene.collection.objects.link(final)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = final
    final.select_set(True)
    final.modifiers["Smooth"].levels = SUBDIV - 1  # one level fewer for the web: plenty with smooth normals
    bpy.ops.object.modifier_apply(modifier="Smooth")
    final.data.materials.clear()
    bake_ao(final)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
    )
    tris = sum(len(p.vertices) - 2 for p in final.data.polygons)
    bpy.data.objects.remove(final)
    return {"path": OUT, "kb": os.path.getsize(OUT) // 1024, "triangles": tris}


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    molar = build()
    print("MOLAR", export(molar))
    if "--preview" in args:
        look(molar)
        print("MOLAR previews", render_sheet(args[args.index("--preview") + 1]))
