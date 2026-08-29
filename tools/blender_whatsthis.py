"""
Identify what you're looking at in Blender.

Paste into Blender's Scripting tab (or Text Editor) and press Run.

  - In Edit Mode with faces selected: reports those faces.
  - In Object Mode with an object selected: reports the whole object.

Output goes three places, so you never need a terminal:

  1. a new text datablock "hod2_report" -- open it in the Text Editor
     (the dropdown at the top of the Scripting tab's text area)
  2. ~/hod2_whatsthis.txt
  3. stdout, if Blender was launched from a terminal

Reports the segment, texture id, image file and UV/texel aspect for each
selected face, plus a ready-to-paste inspect_material.py command.
"""

import os

import bpy

LINES = []


def out(s=""):
    LINES.append(str(s))
    print(s)


def image_of(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            return n.image
    return None


def uv_bounds(poly, uv_layer):
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
        out("=" * 66)
        out(f"object       : {obj.name}")
        out(f"material     : {name}")
        if img:
            out(f"image        : {img.name}")
            out(f"filepath     : {img.filepath}")
            out(f"texture size : {img.size[0]} x {img.size[1]}"
                f"   aspect {img.size[0] / max(img.size[1], 1):.3f}")
        else:
            out("image        : <none>")

        if mat:
            out(f"blend mode   : {getattr(mat, 'blend_method', '?')}")
            out(f"backface cull: {getattr(mat, 'use_backface_culling', '?')}")

        if uv:
            u0, u1, v0, v1 = uv_bounds(poly, uv)
            su, sv = u1 - u0, v1 - v0
            out(f"face UV u    : [{u0:.3f}, {u1:.3f}]  span {su:.3f}")
            out(f"face UV v    : [{v0:.3f}, {v1:.3f}]  span {sv:.3f}")
            if img and sv > 1e-6 and img.size[1]:
                uv_a = su / sv
                tex_a = img.size[0] / img.size[1]
                ratio = uv_a / tex_a if tex_a else 0
                if 0.7 < ratio < 1.4:
                    verdict = "looks correct"
                elif ratio < 1:
                    verdict = f"STRETCHED {1 / ratio:.1f}x"
                else:
                    verdict = f"STRETCHED {ratio:.1f}x"
                out(f"UV aspect    : {uv_a:.3f}   texel aspect {tex_a:.3f}"
                    f"   ratio {ratio:.2f}  -> {verdict}")

        if "_tex" in name:
            out("")
            out("run this and paste me the output:")
            out(f"  python3 tools/inspect_material.py \\")
            out(f"      --game-dir \"/path/to/THE HOUSE OF THE DEAD 2\" \\")
            out(f"      --material {name}")


def flush():
    text = "\n".join(LINES) + "\n"

    # 1. a text datablock, visible in Blender's Text Editor
    name = "hod2_report"
    tb = bpy.data.texts.get(name) or bpy.data.texts.new(name)
    tb.clear()
    tb.write(text)

    # 2. a file on disk
    path = os.path.join(os.path.expanduser("~"), "hod2_whatsthis.txt")
    try:
        with open(path, "w") as fh:
            fh.write(text)
    except OSError as e:
        path = f"<could not write: {e}>"

    # 3. and make the result impossible to miss in the UI
    summary = f"hod2: wrote report to Text Editor block '{name}' and {path}"
    print(summary)
    try:
        def draw(self, _ctx):
            self.layout.label(text=summary)
        bpy.context.window_manager.popup_menu(draw, title="hod2", icon="INFO")
    except Exception:
        pass


obj = bpy.context.active_object
if obj is None or obj.type != "MESH":
    out("select a mesh object first")
else:
    me = obj.data
    if obj.mode == "EDIT":
        bpy.ops.object.mode_set(mode="OBJECT")
        sel = [p for p in me.polygons if p.select]
        bpy.ops.object.mode_set(mode="EDIT")
        if not sel:
            out("no faces selected -- in Edit Mode press 3 for face mode, "
                "Alt+A to deselect, then click a face")
        else:
            out(f"{len(sel)} face(s) selected")
            report(obj, sel)
    else:
        out(f"object mode: reporting all materials on {obj.name} "
            f"({len(me.polygons)} faces)")
        report(obj, me.polygons)

flush()
