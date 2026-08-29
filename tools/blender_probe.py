"""
Point at a pixel in a game-camera view and say what geometry is there.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_probe.py \
        -- extract/stage2/stage2.gltf cp_st2_35_cam 60 0.08 0.45

Arguments after `--`:
    <file.gltf> <camera name> <frame> <sx> <sy> [<sx> <sy> ...]

`sx`/`sy` are normalised screen coordinates with (0,0) at the **top left** of
the rendered image, matching how you would read a pixel off the PNG.

For each probe it raycasts from the camera through that pixel and reports the
object, material, texture image, the hit face's UV span, and the world-units
per texel along u and v -- the anisotropy that shows up as a stretched face.

This is the headless counterpart to `blender_whatsthis.py`: that one needs you
to click a face in the GUI, this one takes the pixel coordinates you read off a
render, so a stretched face seen in a screenshot can be traced back to a mesh
without leaving the terminal.
"""

import sys
from pathlib import Path

import bpy  # type: ignore
import mathutils  # type: ignore

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 5:
    print("PROBE-FAIL: need <file.gltf> <camera> <frame> <sx> <sy> [...]")
    sys.exit(1)

path = Path(argv[0])
camname = argv[1]
frame = int(argv[2])
sweep = "--sweep" in argv
if sweep:
    N = 48
    coords = [((x + 0.5) / N, (y + 0.5) / (N * 3 // 4))
              for y in range(N * 3 // 4) for x in range(N)]
else:
    coords = [(float(argv[i]), float(argv[i + 1])) for i in range(3, len(argv) - 1, 2)]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path))
sc = bpy.context.scene
sc.render.fps = 60
sc.render.resolution_x, sc.render.resolution_y = 640, 480

cam = bpy.data.objects.get(camname)
if cam is None:
    print(f"PROBE-FAIL: no camera {camname!r}")
    sys.exit(1)
sc.camera = cam
for ob in sc.objects:
    if ob.type == "MESH" and ob.name.endswith("_rail"):
        ob.hide_viewport = True
sc.frame_set(frame)
bpy.context.view_layer.update()

deps = bpy.context.evaluated_depsgraph_get()
mw = cam.matrix_world
eye = mw.translation
# Frame corners in camera space, at the near plane, then to world.
corners = cam.data.view_frame(scene=sc)      # tr, br, bl, tl (camera space)
tr, br, bl, tl = [mw @ c for c in corners]


def image_of(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            return n.image
    return None


worst = []

for sx, sy in coords:
    if sweep:
        top = tl.lerp(tr, sx); bot = bl.lerp(br, sx)
        target = top.lerp(bot, sy)
        hit, loc, _n, face_i, obj, _m = sc.ray_cast(deps, eye, (target - eye).normalized())
        if not hit or not obj.data.uv_layers.active:
            continue
        me = obj.data; poly = me.polygons[face_i]
        uvl = me.uv_layers.active.data
        mat = obj.material_slots[poly.material_index].material if obj.material_slots else None
        img = image_of(mat)
        ws = [obj.matrix_world @ me.vertices[me.loops[li].vertex_index].co
              for li in poly.loop_indices]
        uvs = [tuple(uvl[li].uv) for li in poly.loop_indices]
        if len(ws) < 3:
            continue
        e1, e2 = ws[1] - ws[0], ws[2] - ws[0]
        d1 = (uvs[1][0] - uvs[0][0], uvs[1][1] - uvs[0][1])
        d2 = (uvs[2][0] - uvs[0][0], uvs[2][1] - uvs[0][1])
        det = d1[0] * d2[1] - d1[1] * d2[0]
        sw, sh = (img.size if img else (1, 1))
        if abs(det) < 1e-12:
            worst.append((float("inf"), obj.name, mat.name if mat else "-", sx, sy,
                          abs(det) / 2, 0.0, 0.0))
            continue
        du = (e1 * d2[1] - e2 * d1[1]) / det
        dv = (e2 * d1[0] - e1 * d2[0]) / det
        wpu = du.length / max(sw, 1)
        wpv = dv.length / max(sh, 1)
        r = max(wpu, wpv) / max(min(wpu, wpv), 1e-9)
        worst.append((r, obj.name, mat.name if mat else "-", sx, sy,
                      abs(det) / 2, wpu, wpv))
        continue
    top = tl.lerp(tr, sx)
    bot = bl.lerp(br, sx)
    target = top.lerp(bot, sy)
    direction = (target - eye).normalized()
    hit, loc, _n, face_i, obj, _m = sc.ray_cast(deps, eye, direction)
    print(f"\n== probe ({sx:.3f},{sy:.3f}) ==")
    if not hit:
        print("  nothing")
        continue
    print(f"  object   {obj.name}   @ {(loc - eye).length:.1f} units")
    me = obj.data
    poly = me.polygons[face_i]
    mat = obj.material_slots[poly.material_index].material if obj.material_slots else None
    img = image_of(mat)
    print(f"  material {mat.name if mat else '-'}")
    print(f"  image    {img.name if img else '-'}"
          f"  {img.size[0]}x{img.size[1]}" if img else "  image    -")
    uvl = me.uv_layers.active.data if me.uv_layers.active else None
    if uvl is None:
        print("  no UV layer")
        continue
    ws = [obj.matrix_world @ me.vertices[me.loops[li].vertex_index].co
          for li in poly.loop_indices]
    uvs = [tuple(uvl[li].uv) for li in poly.loop_indices]
    print(f"  verts    {[tuple(round(c, 1) for c in v) for v in ws]}")
    print(f"  uvs      {[tuple(round(c, 4) for c in v) for v in uvs]}")
    if len(ws) >= 3 and img:
        # world units per texel along u and v, via the texel->world Jacobian
        e1, e2 = ws[1] - ws[0], ws[2] - ws[0]
        d1 = (uvs[1][0] - uvs[0][0], uvs[1][1] - uvs[0][1])
        d2 = (uvs[2][0] - uvs[0][0], uvs[2][1] - uvs[0][1])
        det = d1[0] * d2[1] - d1[1] * d2[0]
        print(f"  uv area  {abs(det) / 2:.3e}")
        if abs(det) > 1e-12:
            du = (e1 * d2[1] - e2 * d1[1]) / det       # world per unit u
            dv = (e2 * d1[0] - e1 * d2[0]) / det       # world per unit v
            wpu = du.length / max(img.size[0], 1)
            wpv = dv.length / max(img.size[1], 1)
            print(f"  world/texel  u {wpu:.4f}  v {wpv:.4f}  "
                  f"anisotropy {wpu / wpv if wpv else float('inf'):.2f}")
if sweep:
    worst.sort(key=lambda t: -t[0])
    from collections import Counter
    hist = Counter()
    for r, *_ in worst:
        hist[">64" if r > 64 else ">16" if r > 16 else ">4" if r > 4 else "<=4"] += 1
    print(f"\nsweep: {len(worst)} hits   stretch histogram {dict(hist)}")
    print("worst 25 by texel aspect ratio:")
    seen = set()
    n = 0
    for r, obj, mat, sx, sy, area, wpu, wpv in worst:
        key = (obj, mat)
        if key in seen:
            continue
        seen.add(key)
        print(f"  {r:9.1f}  ({sx:.3f},{sy:.3f})  {obj:<22} {mat:<32} "
              f"uvarea {area:.2e}  w/texel u {wpu:.4f} v {wpv:.4f}")
        n += 1
        if n >= 25:
            break
print("\nPROBE-OK")
