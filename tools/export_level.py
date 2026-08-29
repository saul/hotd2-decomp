#!/usr/bin/env python3
"""
Export a HOTD2 level (or any pol/ asset) to glTF 2.0 with textures.

    python3 tools/export_level.py --game-dir "..." --name st2_01
    python3 tools/export_level.py --game-dir "..." --stage 2      # whole stage
    python3 tools/export_level.py --game-dir "..." --list

Output goes to extract/<name>/<name>.gltf plus <name>.bin and textures/*.png.
Open the .gltf directly in Blender.

The "what is a stage" resolution -- regions, geometry set, draw modes, cam
files -- lives in `hod2lib.stage`, shared with the browser player's bundle
builder so the two cannot disagree about what a stage contains.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import gltf, stage as stagelib  # noqa: E402

STAGE_TO_SCENE = stagelib.STAGE_TO_SCENE


def _coli_json(st, sets) -> dict:
    """The stage's collision meshes, as a sidecar.

    Both files the scene loads are emitted whole, with every quad's plane,
    vertices and surface id, so a consumer can build a debug mesh and lay it
    over the exported geometry -- the coordinate space is the same.

    `activated` lists the blobs the event script actually switches on with
    opcodes 0x10/0x11, because a file holds more blobs than any one run uses
    and the script is what selects them.
    """
    from hod2lib import coli as colilib, script as scriptlib

    files = {}
    for f in sets:
        files[f.name] = [
            {
                "offset": b.offset,
                "aabb_min": list(g.aabb_min),
                "aabb_max": list(g.aabb_max),
                "quads": [
                    {"plane": list(q.normal) + [q.plane_d],
                     "axis": q.axis,
                     "verts": [list(v) for v in q.verts],
                     "surface": q.surface}
                    for q in g.quads
                ],
            }
            for b in f.blobs for g in b.groups
        ]

    activated: list[dict] = []
    try:
        prog = scriptlib.load(st)
    except Exception:                      # no evt for this scene
        prog = None
    if prog is not None:
        for blk in prog.blocks:
            for step in blk.steps:
                for op in step.ops:
                    if op.opcode in scriptlib.COLLISION_SET_OPCODES:
                        for m in op.detail.get("meshes", []):
                            if "file" in m:
                                activated.append({
                                    "block": blk.index, "offset": op.offset,
                                    "set": op.detail.get("set"),
                                    "file": m["file"], "blob": m["offset"],
                                    "quads": m.get("quads"),
                                    "surfaces": m.get("surfaces", []),
                                })

    return {
        "scene": st.scene,
        "note": "coli/ collision meshes. ColiLoadForScene loads coli0.bin for "
                "every scene plus coli<scene+1>.bin. Quads are 4 coplanar "
                "verts with a stored plane and a surface id; ids 5 and 55 are "
                "wet. Coordinates match the exported geometry. See "
                "docs/formats/coli.md.",
        "wet_surfaces": list(colilib.WET_SURFACES),
        "files": files,
        "activated": activated,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--name", help="asset base name, e.g. st2_01")
    ap.add_argument("--stage", type=int, help="export every st<N>_* segment")
    ap.add_argument("--list", action="store_true", help="list level assets")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent / "extract")
    ap.add_argument("--no-textures", action="store_true")
    ap.add_argument("--keep-collapsed-uv", action="store_true",
                    help="keep triangles whose UV area is zero (they render as "
                         "hard directional streaks; dropped by default)")
    ap.add_argument("--original", action="store_true",
                    help="export Original Mode geometry (game mode 1) instead "
                         "of Arcade. Same regions, but a few slots resolve to "
                         "the st_org* models Arcade never draws")
    ap.add_argument("--glob-geometry", action="store_true",
                    help="use the old st<N>_* glob instead of the exe's region "
                         "tables. Wrong in both directions; kept for comparison")
    ap.add_argument("--no-coli", action="store_true",
                    help="skip the coli/ collision sidecar")
    ap.add_argument("--no-cameras", action="store_true",
                    help="skip cam/ camera and object paths")
    ap.add_argument("--cam-step", type=float, default=2.0,
                    help="frames between baked camera keys (default 2, i.e. 30 Hz)")
    ap.add_argument("--fold-mirror-uv", action="store_true",
                    help="apply the CPU UV fold the game uses on devices "
                         "without D3DTADDRESS_MIRROR. Off by default because "
                         "it destroys texturing on targets that mirror properly")
    ap.add_argument("--unlit", action="store_true",
                    help="mark materials KHR_materials_unlit. The game bakes "
                         "all lighting into its textures and ships no lights, "
                         "so this is the faithful model - and it stops "
                         "Blender's Rendered view from being black")
    ap.add_argument("--uv-check", action="store_true",
                    help="replace every texture with a UV checkerboard, so "
                         "stretched or rotated faces are visually obvious")
    ap.add_argument("--glb", action="store_true",
                    help="write a single self-contained .glb instead of "
                         ".gltf + .bin + a directory of PNGs")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()

    if args.list:
        names = sorted(p.stem for p in (game / "pol").glob("st*.bin")
                       if not p.stem.startswith("pol_"))
        for n in names:
            print(n)
        return 0

    if args.stage is not None:
        # A stage is split across many pol/ files. Merge them into one glTF,
        # each segment its own parent node, so the whole level opens at once.
        scene = STAGE_TO_SCENE.get(args.stage)
        model_regions, regions = {}, []
        st = None
        if args.glob_geometry or scene is None:
            targets = sorted(
                p.stem for p in (game / "pol").glob(f"st{args.stage}_*.bin")
                if not p.stem.startswith("pol_"))
            if not targets:
                raise SystemExit(f"no assets for stage {args.stage}")
            parts = []
            for n in targets:
                models, bank = stagelib.load_asset(game, n)
                parts.append((n, models, bank))
        else:
            st = stagelib.Stage(game, stage=args.stage, scene=scene,
                                original=args.original)
            parts, model_regions, regions = st.geometry()
        for n, models, _b in parts:
            print(f"  + {n}: {len(models)} models, "
                  f"{sum(m.vertex_count for m in models):,} verts, "
                  f"{sum(m.triangle_count for m in models):,} tris")

        if args.no_cameras:
            cam_files = []
        elif st is not None:
            cam_files = st.cam_files()
        else:
            cam_files = stagelib.load_cam_paths(game, args.stage, None)
        name = (f"stage{args.stage}"
                + ("_original" if args.original and not args.glob_geometry else "")
                + ("_uvcheck" if args.uv_check else ""))
        out_dir = args.out / name
        info = gltf.export_level(name, parts, out_dir,
                                 write_textures=not args.no_textures,
                                 uv_check=args.uv_check,
                                 keep_collapsed_uv=args.keep_collapsed_uv,
                                 cam_files=cam_files, cam_step=args.cam_step,
                                 unlit=args.unlit, model_regions=model_regions,
                                 fold_mirror_uv=args.fold_mirror_uv,
                                 glb=args.glb)
        if regions:
            side = out_dir / f"{name}_regions.json"
            side.write_text(json.dumps({
                "scene": scene,
                "game_mode": 1 if args.original else 0,
                "note": "region id -> asset slots resident and drawn. Set by evt "
                        "opcode 0x29; consecutive regions overlap, which is why "
                        "a whole-stage export shows interpenetrating geometry "
                        "the game never displays.",
                "regions": st.region_json(),
            }, indent=1))
            print(f"  {len(regions)} regions -> {side.name}")

        if st is not None and not args.no_coli:
            sets = st.colisets()
            if sets:
                side = out_dir / f"{name}_coli.json"
                side.write_text(json.dumps(_coli_json(st, sets), indent=1))
                nq = sum(len(f.quads) for f in sets)
                print(f"  collision: {sets[0].name} + {sets[1].name}, "
                      f"{nq} quads -> {side.name}")
        vert = sum(m.vertex_count for _, ms, _ in parts for m in ms)
        tri = sum(m.triangle_count for _, ms, _ in parts for m in ms)
        print(f"\n{name}: {len(parts)} segments, {vert:,} verts, "
              f"{tri - info['dropped_collapsed_uv']:,} tris, "
              f"{info['materials']} materials, {info['textures']} textures")
        if info['dropped_collapsed_uv']:
            print(f"  dropped {info['dropped_collapsed_uv']:,} collapsed-UV "
                  f"triangles ({100 * info['dropped_collapsed_uv'] / max(tri, 1):.1f}%)")
        if info['folded_mirror_uv']:
            print(f"  folded {info['folded_mirror_uv']:,} out-of-range UVs on "
                  f"mirrored axes")
        if info['paths']:
            print(f"  {info['paths']} cam/ paths -> {info['cameras']} animated "
                  f"cameras + rails ({', '.join(c.name for c in cam_files)})")
        print(f"  -> {info['gltf']}")
        return 0

    if not args.name:
        raise SystemExit("give --name, --stage or --list")

    name = args.name
    try:
        models, bank = stagelib.load_asset(game, name)
    except (FileNotFoundError, ValueError) as exc:
        raise SystemExit(str(exc))
    out_dir = args.out / name
    cam_files = [] if args.no_cameras else stagelib.load_cam_paths(game, None, name)
    info = gltf.export_level(name, [(name, models, bank)], out_dir,
                             write_textures=not args.no_textures,
                             uv_check=args.uv_check,
                             cam_files=cam_files, cam_step=args.cam_step,
                             unlit=args.unlit, fold_mirror_uv=args.fold_mirror_uv,
                             glb=args.glb)
    tri = sum(m.triangle_count for m in models)
    vert = sum(m.vertex_count for m in models)
    bank_note = f"  bank: {len(bank.offsets)} textures" if bank else ""
    print(f"{name}: {len(models)} models, {vert:,} verts, {tri:,} tris, "
          f"{info['materials']} materials, {info['textures']} textures{bank_note}")
    if info['paths']:
        print(f"  {info['paths']} cam/ paths -> {info['cameras']} animated "
              f"cameras + rails ({', '.join(c.name for c in cam_files)})")
    print(f"  -> {info['gltf']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
