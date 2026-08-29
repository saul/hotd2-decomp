"""
Validate an exported glTF by importing it in Blender headless.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_check.py -- <file.gltf>

Reports object/vertex/triangle counts, material and image bindings, UV ranges
and the bounding box, then renders a preview PNG next to the .gltf.
"""

import sys
from pathlib import Path

import bpy  # type: ignore
import mathutils  # type: ignore

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    print("CHECK-FAIL: no .gltf given")
    sys.exit(1)

path = Path(argv[0])
render = "--render" in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.import_scene.gltf(filepath=str(path))
except Exception as e:  # noqa: BLE001
    print(f"CHECK-FAIL: import raised {e}")
    sys.exit(1)

# Camera and object path rails are edge-only LINE_STRIP meshes with no UVs
# and no faces by design; they are not geometry and must not be checked as if
# they were. See hod2lib.gltf._emit_paths.
objs = [o for o in bpy.context.scene.objects
        if o.type == "MESH" and not o.name.endswith("_rail")]
rails = [o for o in bpy.context.scene.objects
         if o.type == "MESH" and o.name.endswith("_rail")]
if not objs:
    print("CHECK-FAIL: no mesh objects imported")
    sys.exit(1)

total_v = total_t = 0
uv_min = [9e9, 9e9]
uv_max = [-9e9, -9e9]
bb_min = mathutils.Vector((9e9, 9e9, 9e9))
bb_max = mathutils.Vector((-9e9, -9e9, -9e9))
missing_uv = 0

for o in objs:
    me = o.data
    me.calc_loop_triangles()
    total_v += len(me.vertices)
    total_t += len(me.loop_triangles)

    if not me.uv_layers:
        missing_uv += 1
    else:
        for uvl in me.uv_layers[0].data:
            u, v = uvl.uv
            uv_min[0] = min(uv_min[0], u); uv_min[1] = min(uv_min[1], v)
            uv_max[0] = max(uv_max[0], u); uv_max[1] = max(uv_max[1], v)

    for corner in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(corner)
        bb_min = mathutils.Vector((min(bb_min[i], w[i]) for i in range(3)))
        bb_max = mathutils.Vector((max(bb_max[i], w[i]) for i in range(3)))

mats = list(bpy.data.materials)
imgs = list(bpy.data.images)
textured = [m for m in mats if m.use_nodes and any(
    n.type == "TEX_IMAGE" and n.image for n in m.node_tree.nodes)]
broken_img = [i.name for i in imgs if i.size[0] == 0 or i.size[1] == 0]

print("---- BLENDER IMPORT CHECK ----")
print(f"file            : {path.name}")
print(f"mesh objects    : {len(objs)}")
print(f"vertices        : {total_v:,}")
print(f"triangles       : {total_t:,}")
print(f"materials       : {len(mats)}  (with image texture: {len(textured)})")
print(f"images          : {len(imgs)}  (broken: {len(broken_img)})")
if broken_img:
    print(f"  broken        : {broken_img[:5]}")
print(f"objects w/o UVs : {missing_uv}")
if uv_max[0] > -9e8:
    print(f"UV range        : u [{uv_min[0]:.3f}, {uv_max[0]:.3f}]  "
          f"v [{uv_min[1]:.3f}, {uv_max[1]:.3f}]")
print(f"bbox min        : ({bb_min[0]:.1f}, {bb_min[1]:.1f}, {bb_min[2]:.1f})")
print(f"bbox max        : ({bb_max[0]:.1f}, {bb_max[1]:.1f}, {bb_max[2]:.1f})")
size = bb_max - bb_min
print(f"bbox size       : ({size[0]:.1f}, {size[1]:.1f}, {size[2]:.1f})")

problems = []
if total_t == 0:
    problems.append("no triangles")
if missing_uv:
    problems.append(f"{missing_uv} objects without UVs")
if broken_img:
    problems.append(f"{len(broken_img)} images failed to load")
if max(abs(size[i]) for i in range(3)) < 1e-3:
    problems.append("degenerate bounding box")

if render:
    scn = bpy.context.scene
    centre = (bb_min + bb_max) / 2.0
    radius = max(size[0], size[1], size[2]) or 1.0
    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    scn.collection.objects.link(cam)
    cam.location = centre + mathutils.Vector((radius, -radius, radius * 0.7))
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scn.camera = cam

    light_d = bpy.data.lights.new("sun", type="SUN")
    light_d.energy = 3.0
    light = bpy.data.objects.new("sun", light_d)
    scn.collection.objects.link(light)
    light.location = centre + mathutils.Vector((radius, -radius, radius * 2))

    # Engine choice matters and is not cosmetic.
    #
    # Blender's glTF importer cannot put two different wrap modes on an Image
    # Texture node, so for anything but plain REPEAT it sets
    # `extension = EXTEND` and emulates the real mode with shader nodes.
    # **Workbench does not evaluate shader nodes**, so under Workbench every
    # material with a clamped or mirrored axis renders clamped on *both* axes:
    # one row or column of texels smeared across the face. It looks exactly
    # like a UV bug in the exporter and is not one.
    #
    # So prefer EEVEE whenever the file is unlit -- KHR_materials_unlit shows
    # up as an Emission shader, which EEVEE renders without needing lights.
    # Fall back to Workbench only for lit files, where EEVEE would come out
    # almost black because the game ships no lights of its own.
    engines = scn.render.bl_rna.properties["engine"].enum_items.keys()
    unlit = any(any(n.type == "EMISSION" for n in m.node_tree.nodes)
                for m in bpy.data.materials if m.use_nodes)
    eevee = next((e for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE")
                  if e in engines), None)
    if unlit and eevee:
        scn.render.engine = eevee
        print("engine          : %s (unlit; Workbench would fake every "
              "non-REPEAT wrap mode)" % eevee)
    else:
        scn.render.engine = ("BLENDER_WORKBENCH" if "BLENDER_WORKBENCH" in engines
                             else list(engines)[0])
        print("engine          : Workbench (file is not unlit). Mirrored and "
              "clamped UV axes will render as if clamped on both.")
        try:
            shading = scn.display.shading
            shading.light = "FLAT"
            shading.color_type = "TEXTURE"
            shading.show_backface_culling = False
        except Exception:  # noqa: BLE001
            pass
    scn.render.resolution_x = 960
    scn.render.resolution_y = 540
    scn.render.filepath = str(path.with_suffix("")) + "_preview.png"
    try:
        bpy.ops.render.render(write_still=True)
        print(f"preview         : {scn.render.filepath}")
    except Exception as e:  # noqa: BLE001
        print(f"preview failed  : {e}")

print("CHECK-FAIL: " + "; ".join(problems) if problems else "CHECK-OK")
