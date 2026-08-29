"""
Identify what you're looking at in Blender.

Paste into Blender's Scripting tab (or Text Editor) and press Run.

  - In Edit Mode with faces selected: reports those faces.
  - In Object Mode with an object selected: reports the whole object.

Prints the segment, texture id, image file and UV/texel aspect for each
selected face, plus a ready-to-paste inspect_material.py command.
"""

import bpy


def image_of(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            return n.image
    return None


def uv_bounds(me, poly, uv_layer):
    us, vs = [], []
    for li in poly.loop_indices:
        u, v = uv_layer[li].uv
        us.append(u)
        vs.append(v)
    return min(us), max(us), min(vs), max(vs)


def report(obj, polys):
    me = obj.data
    uv = me.uv_layers.active.data if me.uv_layers.active else None
    seen = set()

    for poly in polys:
        mat = (obj.material_slots[poly.material_index].material
               if poly.material_index < len(obj.material_slots) else None)
        name = mat.name if mat else "<none>"
        if name in seen:
            continue
        seen.add(name)

        img = image_of(mat)
        print("=" * 66)
        print(f"object       : {obj.name}")
        print(f"material     : {name}")
        if img:
            print(f"image        : {img.name}")
            print(f"filepath     : {img.filepath}")
            print(f"texture size : {img.size[0]} x {img.size[1]}"
                  f"   aspect {img.size[0] / max(img.size[1], 1):.3f}")
        else:
            print("image        : <none>")

        if mat:
            print(f"blend mode   : {getattr(mat, 'blend_method', '?')}")
            print(f"backface cull: {getattr(mat, 'use_backface_culling', '?')}")

        if uv:
            u0, u1, v0, v1 = uv_bounds(me, poly, uv)
            su, sv = u1 - u0, v1 - v0
            print(f"face UV u    : [{u0:.3f}, {u1:.3f}]  span {su:.3f}")
            print(f"face UV v    : [{v0:.3f}, {v1:.3f}]  span {sv:.3f}")
            if img and sv > 1e-6 and img.size[1]:
                uv_a = su / sv
                tex_a = img.size[0] / img.size[1]
                ratio = uv_a / tex_a if tex_a else 0
                verdict = ("looks correct" if 0.7 < ratio < 1.4
                           else f"STRETCHED {1 / ratio:.1f}x" if ratio < 1
                           else f"STRETCHED {ratio:.1f}x")
                print(f"UV aspect    : {uv_a:.3f}   texel aspect {tex_a:.3f}"
                      f"   ratio {ratio:.2f}  -> {verdict}")

        # material name is "<segment>_tex<N>_<shading>"
        parts = name.rsplit("_tex", 1)
        if len(parts) == 2:
            print("\nrun this and paste me the output:")
            print(f"  python3 tools/inspect_material.py \\\n"
                  f"      --game-dir \"/path/to/THE HOUSE OF THE DEAD 2\" \\\n"
                  f"      --material {name}")


obj = bpy.context.active_object
if obj is None or obj.type != "MESH":
    print("select a mesh object first")
else:
    me = obj.data
    if obj.mode == "EDIT":
        bpy.ops.object.mode_set(mode="OBJECT")
        sel = [p for p in me.polygons if p.select]
        bpy.ops.object.mode_set(mode="EDIT")
        if not sel:
            print("no faces selected -- select a face in Edit Mode")
        else:
            print(f"{len(sel)} face(s) selected")
            report(obj, sel)
    else:
        print(f"object mode: reporting all {len(me.polygons)} faces of {obj.name}")
        report(obj, me.polygons)
