"""
Render an exported level through one of its own `cam/` camera paths.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_camview.py \
        -- extract/stage2/stage2.gltf cp_st2_50_cam 90

Arguments after `--`:
    <file.gltf> <camera node name> [frame] [--engine eevee|workbench] [--rails]

This is the visual check that the `cam/` spline recovery is right: if the
keyframe layout, the Hermite evaluation, the look-at construction or the
coordinate space were wrong, the frame would not look like a shot from the
game.

Lighting
--------
HOTD2 bakes all illumination into its textures and per-mesh base colour, and
level geometry ships with no light sources. A lit render of it is therefore
black unless you either export with ``--unlit`` (KHR_materials_unlit) or use
flat shading. This script defaults to Workbench + FLAT + TEXTURE, which needs
neither.

Frames
------
glTF animation time is in seconds. Blender's default scene is 24 fps, so the
game's 60 Hz frame numbers do not line up with Blender frame numbers until the
scene fps is set to 60 -- which this script does. Pass the *game* frame.

Prints the mean luminance of the result, so "it rendered black" is a
measurement rather than an impression.
"""

import sys
from pathlib import Path

import bpy  # type: ignore
import mathutils  # type: ignore

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    print("CAMVIEW-FAIL: need <file.gltf> <camera name> [frame]")
    sys.exit(1)

path = Path(argv[0])
camname = argv[1]
frame = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 0
# Default to EEVEE when the file is unlit.
#
# Blender's glTF importer cannot express a non-REPEAT wrap mode on the Image
# Texture node when the two axes differ, so it sets `extension = EXTEND` and
# emulates the real mode with Math/SeparateXYZ/CombineXYZ nodes. **Workbench
# does not evaluate shader nodes** -- it reads the image node's `extension`
# directly -- so under Workbench every material with a clamped or mirrored
# axis renders clamped on *both* axes. That smears one row or column of texels
# across the whole face, and turns faces whose UVs run negative solid black.
#
# It is a convincing artifact: it looks exactly like a UV bug in the exporter,
# and cost most of Session 13 to run down. EEVEE evaluates the nodes and is
# correct. Workbench is still available with --engine workbench and is fine
# for geometry-only checks.
engine = "eevee"
if "--engine" in argv:
    engine = argv[argv.index("--engine") + 1].lower()
show_rails = "--rails" in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.import_scene.gltf(filepath=str(path))
except Exception as e:  # noqa: BLE001
    print(f"CAMVIEW-FAIL: import raised {e}")
    sys.exit(1)

sc = bpy.context.scene
sc.render.fps = 60

# KHR_materials_unlit shows up as an Emission shader; a lit render of this
# game is black because it ships no light sources.
_unlit = any(any(n.type == "EMISSION" for n in m.node_tree.nodes)
             for m in bpy.data.materials if m.use_nodes)

cam = bpy.data.objects.get(camname)
if cam is None:
    have = sorted(o.name for o in sc.objects if o.type == "CAMERA")
    print(f"CAMVIEW-FAIL: no camera {camname!r}")
    print(f"  {len(have)} available, e.g. {have[:8]}")
    sys.exit(1)
sc.camera = cam

if not show_rails:
    for ob in sc.objects:
        if ob.type == "MESH" and ob.name.endswith("_rail"):
            ob.hide_render = True

sc.frame_set(frame)
bpy.context.view_layer.update()

# Report what is actually in front of the camera. A correct camera looks at
# geometry; a wrong one stares into the void, and that is worth distinguishing
# from a lighting problem.
mw = cam.matrix_world
eye = mw.translation
fwd = (mw.to_quaternion() @ mathutils.Vector((0, 0, -1))).normalized()
deps = bpy.context.evaluated_depsgraph_get()
hit, loc, _n, _i, obj, _m = sc.ray_cast(deps, eye, fwd)
print(f"camera   {camname}  game frame {frame}  ({frame / 60.0:.2f}s)")
print(f"  eye    ({eye.x:9.1f},{eye.y:9.1f},{eye.z:9.1f})  [Blender Z-up]")
print(f"  fwd    ({fwd.x:6.2f},{fwd.y:6.2f},{fwd.z:6.2f})")
print(f"  looks at: {obj.name + ' @ ' + format((loc - eye).length, '.1f') + ' units' if hit else 'NOTHING'}")

if engine.startswith("eevee") and not _unlit:
    print("  note: file is not unlit -- EEVEE will render it black (the game "
          "ships no lights). Re-export with --unlit, or use --engine workbench.")
    engine = "workbench"

if engine.startswith("eevee"):
    sc.render.engine = [e for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE")
                        if e in sc.render.bl_rna.properties["engine"].enum_items][0]
    # See hod2lib.gltf.DRAW_ORDER: the engine sorts its translucent pass
    # back-to-front, glTF cannot carry render order, and Blender sorts blended
    # surfaces per object -- so two coincident translucent copies of the same
    # shell, which this game's models genuinely contain, resolve arbitrarily
    # and one paints over the other as a large flat wrong-coloured face.
    # Hashed transparency resolves per fragment instead.
    for _mat in bpy.data.materials:
        for _attr, _val in (("surface_render_method", "DITHERED"),
                            ("blend_method", "HASHED")):
            if hasattr(_mat, _attr):
                try:
                    setattr(_mat, _attr, _val)
                except (TypeError, AttributeError):
                    pass
else:
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "TEXTURE"

sc.render.resolution_x, sc.render.resolution_y = 640, 480
sc.render.image_settings.file_format = "PNG"
out = path.parent / f"view_{camname}_{frame}.png"
sc.render.filepath = str(out)
bpy.ops.render.render(write_still=True)

img = bpy.data.images.load(str(out))
px = list(img.pixels)
n = len(px) // 4
lum = sum(px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] for i in range(n)) / (3 * n)
print(f"  -> {out}")
print(f"  mean luminance {lum:.4f}")
if lum < 0.01:
    print("CAMVIEW-FAIL: image is black. Re-export with --unlit, or use "
          "--engine workbench (the default).")
    sys.exit(1)
print("CAMVIEW-OK")
