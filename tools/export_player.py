#!/usr/bin/env python3
"""
Build the static bundle the browser stage player loads.

    python3 tools/export_player.py --game-dir "..." --all
    python3 tools/export_player.py --game-dir "..." --stage 2
    python3 tools/export_player.py --game-dir "..." --stage 2 --original

Output lands in ``extract/player/``. Serve that directory (or point the dev
server at it) and open the player; see ``web/README.md``.

Every format is parsed here, in Python, exactly once. The client re-implements
none of them -- it loads glTF, evaluates Hermite curves and walks the resolved
event script. See docs/PLAYER_PLAN.md for why that split was chosen.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import bundle, stage as stagelib  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--stage", type=int, action="append",
                    help="stage number; repeatable")
    ap.add_argument("--all", action="store_true", help="every stage, 1-6")
    ap.add_argument("--original", action="store_true",
                    help="also build the Original Mode (game mode 1) variant")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent
                    / "extract" / "player")
    ap.add_argument("--gltf", action="store_true",
                    help="write .gltf + .bin + loose PNGs instead of one .glb. "
                         "Easier to inspect; ~1300 files and a fetch storm")
    ap.add_argument("--no-textures", action="store_true")
    ap.add_argument("--lit", action="store_true",
                    help="do not mark materials KHR_materials_unlit. The game "
                         "bakes its illumination into textures and the "
                         "per-mesh base colour, so unlit is the faithful "
                         "default")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    if not (game / "Hod2.exe").exists():
        raise SystemExit(f"no Hod2.exe under {game}")

    wanted = sorted(set(args.stage or ())) or ([1, 2, 3, 4, 5, 6]
                                               if args.all else [])
    if not wanted:
        raise SystemExit("give --stage N (repeatable) or --all")

    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    entries = []
    for n in wanted:
        modes = [False, True] if args.original else [False]
        for original in modes:
            try:
                st = stagelib.Stage(game, stage=n, original=original)
            except (ValueError, FileNotFoundError) as exc:
                print(f"stage {n}: {exc}", file=sys.stderr)
                continue
            print(f"stage {n}{' (Original Mode)' if original else ''}")
            entries.append(bundle.build_stage(
                st, out,
                glb=not args.gltf,
                write_textures=not args.no_textures,
                unlit=not args.lit,
                progress=print))
            c = entries[-1]["counts"]
            print(f"  -> {c['models']} models, {c['triangles']:,} tris, "
                  f"{c['textures']} textures, {c['regions']} regions, "
                  f"{c['blocks']} blocks ({c['branch_points']} branch points), "
                  f"{c['cam_paths']} cam paths, {c['spawns']} spawns")

    if not entries:
        raise SystemExit("nothing was built")

    path = bundle.write_manifest(
        out, entries, game_dir=game,
        notes={
            "unlit": not args.lit,
            "geometry": "gltf" if args.gltf else "glb",
            "cameras": "raw Hermite curves in <stage>.cam.json; the client "
                       "evaluates and draws the rails itself",
        })
    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"\n{len(entries)} stage bundles, {total / 1e6:.1f} MB -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
