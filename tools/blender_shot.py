"""Render a glTF from an explicit eye/target, with the game's own projection.

    Blender -b -P tools/blender_shot.py -- <file.gltf> <out.png> \
        ex ey ez  tx ty tz  [roll_bams]

`blender_camview.py` drives one of the *baked* camera animations in the file,
which is the right check for the spline export. This takes the pose as
arguments instead, so the caller evaluates the path with `hod2lib` -- the same
evaluation the browser player uses -- and Blender only draws it. That makes the
render a check on the *scene*, not on the animation import.

Coordinates are glTF (Y-up); Blender's importer rotates the scene to Z-up, so
the eye and target are converted the same way: `(x, y, z) -> (x, -z, y)`.

Projection is the game's: 41.100 degrees vertical, 4:3, from
`SetupSceneProjection`. Materials are exported unlit, so Workbench FLAT +
TEXTURE reproduces what the game shows without inventing lights.
"""

import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 8:
    print("SHOT-FAIL: need <file.gltf> <out.png> ex ey ez tx ty tz [roll]")
    raise SystemExit(1)

path, out = argv[0], argv[1]
ex, ey, ez, tx, ty, tz = (float(v) for v in argv[2:8])
roll = float(argv[8]) if len(argv) > 8 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

# glTF Y-up -> Blender Z-up, matching what the importer did to the scene.
eye = Vector((ex, -ez, ey))
tgt = Vector((tx, -tz, ty))

cam_data = bpy.data.cameras.new("shot")
cam_data.sensor_fit = "VERTICAL"
cam_data.angle_y = 2.0 * int(0x1D3B * 0.5) * (math.tau / 65536.0)
cam_data.clip_start, cam_data.clip_end = 0.8, 8000.0
cam = bpy.data.objects.new("shot", cam_data)
bpy.context.scene.collection.objects.link(cam)
cam.location = eye
# Blender cameras look down local -Z with +Y up, exactly as the game's own
# camera matrix does (T(eye); RotZ(roll); RotY(yaw); RotX(pitch) with the yaw
# taken from eye - target, so its local +Z points backward).
q = (tgt - eye).to_track_quat("-Z", "Y")
if roll:
    from mathutils import Quaternion
    q = q @ Quaternion(Vector((0, 0, 1)), -roll * math.tau / 65536.0)
cam.rotation_euler = q.to_euler()
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "FLAT"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x, sc.render.resolution_y = 640, 480
sc.render.resolution_percentage = 100
sc.render.filepath = out
sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)

fwd = (tgt - eye).normalized()
print(f"eye {tuple(round(v, 1) for v in eye)}  "
      f"fwd {tuple(round(v, 2) for v in fwd)}")
print(f"-> {out}")
print("SHOT-OK")
