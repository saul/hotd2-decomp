#!/usr/bin/env python3
"""
Export a HOTD2 level (or any pol/ asset) to glTF 2.0 with textures.

    python3 tools/export_level.py --game-dir "..." --name st2_01
    python3 tools/export_level.py --game-dir "..." --stage 2      # whole stage
    python3 tools/export_level.py --game-dir "..." --list

Output goes to extract/<name>/<name>.gltf plus <name>.bin and textures/*.png.
Open the .gltf directly in Blender.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import cam, container as C, evt, exetab, gltf, nl1, texbank  # noqa: E402

#: stage number -> scene id, the event system's own index
STAGE_TO_SCENE = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}

_TABLES: exetab.ExeTables | None = None


def get_tables(game: Path) -> exetab.ExeTables | None:
    global _TABLES
    if _TABLES is None:
        exe = game / "Hod2.exe"
        if exe.exists():
            _TABLES = exetab.ExeTables(exe)
    return _TABLES


def load_asset(game: Path, name: str):
    """Return (models, bank) for a pol/ asset and its paired tex/ bank."""
    pol = game / "pol" / f"{name}.bin"
    if not pol.exists():
        raise SystemExit(f"no such asset: {pol}")

    c = C.load(pol.read_bytes())
    if not c.models:
        raise SystemExit(f"{name}: no models ({c.kind})")
    models = nl1.parse_container(c)

    bank = None
    tex = game / "tex" / f"{name}.bin"
    if tex.exists():
        tc = C.load(tex.read_bytes())
        data = tc.data if tc.kind == C.COMPRESSED else tex.read_bytes()

        # The exe's descriptor table is authoritative; fall back to the
        # prefix-sum guess only for banks it does not list.
        tables = get_tables(game)
        entries = tables.entries(name) if tables else []
        if entries:
            bank = texbank.bank_from_exe(data, entries)
        else:
            descs = texbank.harvest_descriptors(models)
            if descs:
                bank = texbank.solve_layout(data, descs)
    return models, bank


def load_cam_paths(game: Path, stage: int | None, name: str | None):
    """cam/ files belonging to a stage: cp_stN (camera) and op_stN (objects).

    Returns [] when the asset has no matching camera file, which is normal --
    only the six stages and a handful of cutscenes have one.
    """
    stems: list[str] = []
    if stage is not None:
        stems = [f"cp_st{stage}", f"op_st{stage}"]
    elif name:
        # st2_07 -> stage 2
        import re
        m = re.match(r"st(\d+)_", name)
        if m:
            stems = [f"cp_st{m.group(1)}", f"op_st{m.group(1)}"]

    out = []
    for stem in stems:
        p = game / "cam" / f"{stem}.bin"
        if p.exists():
            out.append(cam.load(str(p)))
    return out


def stage_geometry(game: Path, stage: int, scene: int, original: bool = False):
    """The authoritative geometry set for a stage, from Hod2.exe.

    Globbing `st<N>_*` is wrong in both directions: it misses files the stage
    genuinely draws (`st3.bin`, and all of stage 6's reused `st5_*` geometry)
    and includes entries no region ever draws.

    The real set is the union of

      * every asset slot named by any of the scene's *regions* -- the sliding
        window the game streams and draws along the rail
        (`ExeTables.scene_regions`), and
      * every slot the event script loads with opcode 0x50.

    Whole-file loads (opcode 0x52) are deliberately excluded: those are
    spawnable actors -- enemies, characters -- instantiated at runtime from
    spawn descriptors, not placed scenery.

    With *original* set, the mode-1 region id tables are used instead --
    Original Mode. Region membership is byte-identical between the two modes;
    only a handful of id entries point at different models, swapping in the
    `st_org00..st_org03` files (and on stage 1, alternate `st1_*` entries) that
    Arcade Mode never draws. See `docs/formats/pipeline.md`.

    Returns (parts, model_regions, regions) where *parts* is the usual
    (name, models, bank) list, *model_regions* maps (part, model index) to the
    region ids that draw it, and *regions* is the raw region table.
    """
    tables = get_tables(game)
    if tables is None:
        raise SystemExit("Hod2.exe is required to resolve the stage geometry set")

    slots = tables.asset_slots()
    regions = tables.scene_regions(scene, original)

    wanted: dict[str, set[int]] = {}
    slot_regions: dict[tuple[str, int], set[int]] = {}
    for ri, region in enumerate(regions):
        for slot, _mode in region:
            rec = slots.get(slot)
            if not rec:
                continue
            wanted.setdefault(rec[0], set()).add(rec[1])
            slot_regions.setdefault(rec, set()).add(ri)

    evt_name = tables.scene_evt_file(scene)
    if evt_name and (game / "evt" / evt_name).exists():
        ev = evt.load(str(game / "evt" / evt_name), tables.scene_block_count(scene))
        for blk in ev.blocks:
            if blk.offset < 0:
                continue
            for prog in blk.programs:
                for ins in prog:
                    if ins.opcode in evt.SLOT_OPCODES and ins.raw:
                        rec = slots.get(ins.raw[0])
                        if rec:
                            wanted.setdefault(rec[0], set()).add(rec[1])

    draw_modes = tables.scene_draw_modes(scene, original)
    slot_of: dict[tuple[str, int], int] = {v: k for k, v in slots.items()}
    parts, model_regions = [], {}
    for fname in sorted(wanted):
        stem = fname[:-4] if fname.endswith(".bin") else fname
        pol = game / "pol" / fname
        if not pol.exists():
            continue
        cont = C.load(pol.read_bytes())
        bank = _bank_for(game, stem, cont)
        models, order = [], sorted(wanted[fname])
        for entry in order:
            if entry >= cont.model_count:
                continue
            try:
                got = nl1.parse(cont.model(entry))
            except Exception:
                continue
            for m in (got if isinstance(got, list) else [got]):
                slot_id = slot_of.get((fname, entry))
                model_regions[(stem, len(models))] = {
                    "regions": sorted(slot_regions.get((fname, entry), ())),
                    "draw_mode": draw_modes.get(slot_id, 0) if slot_id is not None else 0,
                }
                models.append(m)
        if models:
            parts.append((stem, models, bank))
    return parts, model_regions, regions


def _bank_for(game: Path, stem: str, cont):
    tex = game / "tex" / f"{stem}.bin"
    if not tex.exists():
        return None
    tc = C.load(tex.read_bytes())
    data = tc.data if tc.kind == C.COMPRESSED else tex.read_bytes()
    tables = get_tables(game)
    entries = tables.entries(stem) if tables else []
    if entries:
        return texbank.bank_from_exe(data, entries)
    return None


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
        targets = sorted(
            p.stem for p in (game / "pol").glob(f"st{args.stage}_*.bin")
            if not p.stem.startswith("pol_"))
        if not targets:
            raise SystemExit(f"no assets for stage {args.stage}")

        scene = STAGE_TO_SCENE.get(args.stage)
        model_regions, regions = {}, []
        if args.glob_geometry or scene is None:
            parts = []
            for n in targets:
                models, bank = load_asset(game, n)
                parts.append((n, models, bank))
        else:
            parts, model_regions, regions = stage_geometry(
                game, args.stage, scene, original=args.original)
        for n, models, _b in parts:
            print(f"  + {n}: {len(models)} models, "
                  f"{sum(m.vertex_count for m in models):,} verts, "
                  f"{sum(m.triangle_count for m in models):,} tris")

        cam_files = [] if args.no_cameras else load_cam_paths(game, args.stage, None)
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
                                 fold_mirror_uv=args.fold_mirror_uv)
        if regions:
            import json
            slots = get_tables(game).asset_slots()
            side = out_dir / f"{name}_regions.json"
            side.write_text(json.dumps({
                "scene": scene,
                "game_mode": 1 if args.original else 0,
                "note": "region id -> asset slots resident and drawn. Set by evt "
                        "opcode 0x29; consecutive regions overlap, which is why "
                        "a whole-stage export shows interpenetrating geometry "
                        "the game never displays.",
                "regions": [
                    [{"slot": s_, "draw_mode": m,
                      "file": slots.get(s_, ("?", 0))[0],
                      "entry": slots.get(s_, ("?", 0))[1]} for s_, m in reg]
                    for reg in regions],
            }, indent=1))
            print(f"  {len(regions)} regions -> {side.name}")
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
    models, bank = load_asset(game, name)
    out_dir = args.out / name
    cam_files = [] if args.no_cameras else load_cam_paths(game, None, name)
    info = gltf.export_level(name, [(name, models, bank)], out_dir,
                             write_textures=not args.no_textures,
                             uv_check=args.uv_check,
                             cam_files=cam_files, cam_step=args.cam_step,
                             unlit=args.unlit, fold_mirror_uv=args.fold_mirror_uv)
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
