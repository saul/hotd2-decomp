#!/usr/bin/env python3
"""
Dump everything known about an exported material or mesh.

In Blender, click the stretched face, read the material name from the Material
Properties tab (e.g. "st1_03b_tex79_lambert"), then:

    python3 tools/inspect_material.py --game-dir "..." --material st1_03b_tex79_lambert

Or inspect every mesh in a segment that uses a given texture:

    python3 tools/inspect_material.py --game-dir "..." --part st1_03b --texture 79
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import container as C, exetab, nl1  # noqa: E402

BLEND = {0: "zero", 1: "one", 2: "other_col", 3: "inv_other_col",
         4: "src_alpha", 5: "inv_src_alpha", 6: "dst_alpha", 7: "inv_dst_alpha"}
LAYOUT = {1: "twiddled", 3: "VQ", 9: "rectangle", 13: "twiddled-rect"}
CLAMP = {0: "none", 1: "clamp V", 2: "clamp U", 3: "clamp both"}
FLIP = {0: "none", 1: "flip V", 2: "flip U", 3: "flip both"}
FILT = {0: "point/NEAREST", 1: "bilinear", 2: "trilinear A", 3: "trilinear B"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--material", help="e.g. st1_03b_tex79_lambert")
    ap.add_argument("--part", help="e.g. st1_03b")
    ap.add_argument("--texture", type=int)
    args = ap.parse_args()

    part, tex_id = args.part, args.texture
    if args.material:
        m = re.match(r"(.+)_tex(-?\d+)_", args.material)
        if not m:
            raise SystemExit(f"cannot parse material name: {args.material}")
        part, tex_id = m.group(1), int(m.group(2))
    if not part or tex_id is None:
        raise SystemExit("give --material, or --part and --texture")

    game = args.game_dir.expanduser().resolve()
    pol = game / "pol" / f"{part}.bin"
    if not pol.exists():
        raise SystemExit(f"no such segment: {pol}")

    print(f"segment      : {part}")
    print(f"texture id   : {tex_id}")

    tables = exetab.ExeTables(game / "Hod2.exe")
    ent = {e.index: e for e in tables.entries(part)}.get(tex_id)
    if ent:
        print(f"\n-- texture (from Hod2.exe descriptor table) --")
        print(f"  size       : {ent.width} x {ent.height}"
              f"   aspect {ent.width / ent.height:.3f}")
        print(f"  pixel fmt  : {['ARGB1555','RGB565','ARGB4444'][ent.pixfmt]}")
        print(f"  layout     : {ent.layout} ({LAYOUT.get(ent.layout,'?')})")
        print(f"  bank offset: {ent.offset}")
    else:
        print("\n  (no descriptor-table entry; sizes inferred from the model)")

    c = C.load(pol.read_bytes())
    models = nl1.parse_container(c)

    n = 0
    for mi, model in enumerate(models):
        for mesh in model.meshes:
            if mesh.texture_id != tex_id:
                continue
            n += 1
            us = [v.uv[0] for v in mesh.vertices]
            vs = [v.uv[1] for v in mesh.vertices]
            print(f"\n-- mesh {n}  (model {mi}, offset {mesh.offset:#x}) --")
            print(f"  verts/tris : {len(mesh.vertices)} / {len(mesh.triangles)}")
            print(f"  TSP size   : {mesh.texture_width} x {mesh.texture_height}"
                  + ("   <- half of real size, VQ" if mesh.vq_compressed else ""))
            print(f"  shading    : {mesh.shading_mode_name}")
            print(f"  list type  : {mesh.list_type}"
                  f"  ({'opaque' if mesh.list_type == 0 else 'translucent' if mesh.translucent else 'other'})")
            print(f"  blend      : {BLEND[mesh.src_blend]} / {BLEND[mesh.dst_blend]}"
                  + ("   ADDITIVE" if mesh.additive else ""))
            print(f"  clamp UV   : {mesh.clamp_uv} ({CLAMP[mesh.clamp_uv]})")
            print(f"  flip UV    : {mesh.flip_uv} ({FLIP[mesh.flip_uv]})")
            print(f"  filter     : {mesh.filter_mode} ({FILT[mesh.filter_mode]})")
            print(f"  ignore tex alpha : {mesh.ignore_texture_alpha}")
            print(f"  double sided     : {mesh.double_sided}")
            if us:
                su, sv = max(us) - min(us), max(vs) - min(vs)
                print(f"  UV u range : [{min(us):8.3f}, {max(us):8.3f}]  span {su:.2f}")
                print(f"  UV v range : [{min(vs):8.3f}, {max(vs):8.3f}]  span {sv:.2f}")
                if ent:
                    # A face is stretched when the UV aspect and the texel
                    # aspect disagree badly.
                    if sv > 1e-6:
                        uv_aspect = su / sv
                        tex_aspect = ent.width / ent.height
                        print(f"  UV aspect  : {uv_aspect:.3f}"
                              f"   texel aspect {tex_aspect:.3f}"
                              f"   ratio {uv_aspect / tex_aspect:.2f}")
                if (mesh.clamp_uv & 2 and su > 1.5) or (mesh.clamp_uv & 1 and sv > 1.5):
                    print("  !! clamped axis with UV span > 1 tile -- this smears")
            # per-strip culling, which drives winding
            culls = sorted({s.culling for s in mesh.strips})
            kinds = sorted({"tri-list" if s.is_triangle_list else "strip"
                            for s in mesh.strips})
            print(f"  strips     : {len(mesh.strips)}  culling={culls}  kinds={kinds}")

    if n == 0:
        print(f"\n  no mesh in {part} uses texture {tex_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
