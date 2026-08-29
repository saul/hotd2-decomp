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

from hod2lib import container as C, exetab, gltf, nl1, texbank  # noqa: E402

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

        parts = []
        for n in targets:
            models, bank = load_asset(game, n)
            parts.append((n, models, bank))
            print(f"  + {n}: {len(models)} models, "
                  f"{sum(m.vertex_count for m in models):,} verts, "
                  f"{sum(m.triangle_count for m in models):,} tris")

        name = f"stage{args.stage}" + ("_uvcheck" if args.uv_check else "")
        out_dir = args.out / name
        info = gltf.export_level(name, parts, out_dir,
                                 write_textures=not args.no_textures,
                                 uv_check=args.uv_check,
                                 keep_collapsed_uv=args.keep_collapsed_uv)
        vert = sum(m.vertex_count for _, ms, _ in parts for m in ms)
        tri = sum(m.triangle_count for _, ms, _ in parts for m in ms)
        print(f"\n{name}: {len(parts)} segments, {vert:,} verts, "
              f"{tri - info['dropped_collapsed_uv']:,} tris, "
              f"{info['materials']} materials, {info['textures']} textures")
        if info['dropped_collapsed_uv']:
            print(f"  dropped {info['dropped_collapsed_uv']:,} collapsed-UV "
                  f"triangles ({100 * info['dropped_collapsed_uv'] / max(tri, 1):.1f}%)")
        print(f"  -> {info['gltf']}")
        return 0

    if not args.name:
        raise SystemExit("give --name, --stage or --list")

    name = args.name
    models, bank = load_asset(game, name)
    out_dir = args.out / name
    info = gltf.export_level(name, [(name, models, bank)], out_dir,
                             write_textures=not args.no_textures,
                             uv_check=args.uv_check)
    tri = sum(m.triangle_count for m in models)
    vert = sum(m.vertex_count for m in models)
    bank_note = f"  bank: {len(bank.offsets)} textures" if bank else ""
    print(f"{name}: {len(models)} models, {vert:,} verts, {tri:,} tris, "
          f"{info['materials']} materials, {info['textures']} textures{bank_note}")
    print(f"  -> {info['gltf']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
