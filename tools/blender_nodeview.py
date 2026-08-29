"""
Render one node subtree of an exported glTF in isolation.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_nodeview.py \
        -- extract/stage1/stage1.gltf st1_vehicle_253 /tmp/rig.png

Arguments after `--`: <file.gltf> <node name prefix> <out.png>

Everything whose object name starts with the prefix is kept; everything else is
hidden. The camera is framed on the kept objects' world bounding box, so this
works for a rig, one part, or a whole segment.

Environment:
    RIGANG      camera azimuth in radians (default 0)
    RIGENGINE   `eevee` (default) or `workbench`

**EEVEE is the default deliberately.** Blender's glTF importer cannot put two
different wrap modes on an Image Texture node, so for anything but plain REPEAT
it sets `extension = EXTEND` and emulates the real mode with shader nodes.
Workbench does not evaluate shader nodes, so under Workbench every material
with a clamped or mirrored axis renders clamped on *both* axes -- one row or
column of texels smeared across the face. It looks exactly like a UV bug in the
exporter and is not one; see docs/re/method.md.
"""

import sys, math, bpy, mathutils
argv = sys.argv[sys.argv.index("--")+1:]
path, prefix, out = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
sc = bpy.context.scene
# hide everything except the rig subtree
keep = [o for o in sc.objects if o.name.startswith(prefix)]
if not keep:
    print("RIG-FAIL: no objects with prefix", prefix); sys.exit(1)
for o in sc.objects:
    o.hide_render = not o.name.startswith(prefix)
# world bbox of the kept objects
lo = mathutils.Vector((1e30,)*3); hi = mathutils.Vector((-1e30,)*3)
for o in keep:
    if o.type != "MESH": continue
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        lo = mathutils.Vector((min(lo[i], w[i]) for i in range(3)))
        hi = mathutils.Vector((max(hi[i], w[i]) for i in range(3)))
ctr = (lo + hi) / 2
rad = max((hi - lo).length / 2, 1.0)
print(f"{len(keep)} objects, world bbox {list(round(v,1) for v in lo)} .. "
      f"{list(round(v,1) for v in hi)}")
cam_data = bpy.data.cameras.new("rigcam"); cam = bpy.data.objects.new("rigcam", cam_data)
sc.collection.objects.link(cam); sc.camera = cam
d = rad * 3.0
import os
ang = float(os.environ.get("RIGANG","0"))
cam.location = ctr + mathutils.Vector((d*math.cos(ang), d*math.sin(ang), d*0.5))
dir = (ctr - cam.location).normalized()
cam.rotation_euler = dir.to_track_quat('-Z', 'Y').to_euler()
import os
if os.environ.get("RIGENGINE","eevee") == "workbench":
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"; sc.display.shading.color_type = "TEXTURE"
else:
    sc.render.engine = [e for e in ("BLENDER_EEVEE_NEXT","BLENDER_EEVEE")
                        if e in sc.render.bl_rna.properties["engine"].enum_items][0]
    w = bpy.data.worlds.new("w"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (1,1,1,1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = w
    # The engine draws its translucent pass sorted back-to-front (see
    # gltf.DRAW_ORDER). glTF cannot carry that, and Blender sorts blended
    # surfaces per object, so two coincident translucent copies of the same
    # shell -- which this game's models genuinely contain -- resolve
    # arbitrarily and one paints over the other. Dithered/hashed transparency
    # resolves per fragment instead, which is not the engine's order either
    # but does not produce the large flat wrong-surface artefacts.
    for mat in bpy.data.materials:
        for attr, val in (("surface_render_method", "DITHERED"),
                          ("blend_method", "HASHED")):
            if hasattr(mat, attr):
                try:
                    setattr(mat, attr, val)
                except (TypeError, AttributeError):
                    pass
sc.render.resolution_x, sc.render.resolution_y = 800, 600
sc.render.film_transparent = False
sc.render.image_settings.file_format = "PNG"; sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RIG-OK ->", out)
