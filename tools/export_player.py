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
import json
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
            if c.get("degraded"):
                print(f"  -> {c['degraded']} DEGRADED: this bundle is missing "
                      f"parts of the game (see the warnings above, and "
                      f"`degraded` in the manifest entry)", file=sys.stderr)

    if not entries:
        raise SystemExit("nothing was built")

    # **The manifest is the whole bundle's index, and a partial export used to
    # replace it.** `--stage 2` after a `--all` left a manifest naming stage 2
    # alone, and the player simply had no other stages -- silently, because
    # every other stage's files were still sitting on disk beside it. So carry
    # forward any entry this run did not rebuild whose files are still there,
    # and say which, rather than dropping it.
    #
    # A carried entry names its own files, so `--gltf` and `--glb` bundles can
    # sit side by side; the top-level `notes` cannot say that, and describes
    # this run. Rebuild everything if that matters.
    built = {e["name"] for e in entries}
    kept = []
    old_path = out / "manifest.json"
    if old_path.exists():
        try:
            previous = json.loads(old_path.read_text()).get("stages", [])
        except (OSError, ValueError) as exc:                   # noqa: PERF203
            print(f"manifest.json unreadable, starting fresh ({exc})",
                  file=sys.stderr)
            previous = []
        for e in previous:
            if e.get("name") in built:
                continue
            files = [e.get(k) for k in ("geometry", "cam", "script")]
            if not all(f and (out / e["name"] / f).exists() for f in files):
                continue
            entries.append(e)
            kept.append(e["name"])
    if kept:
        print(f"carried forward from the previous manifest: {', '.join(kept)}")
    entries.sort(key=lambda e: (e.get("stage", 0), e.get("name", "")))

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

    # **A degraded export fails. There is no flag for this.**
    #
    # It was tempting to put it behind `--strict` and leave the default
    # permissive, and that would have reproduced F16 one level up: a switch
    # nobody passes is a check that never fires, which is the whole finding.
    # If anything under `hod2lib` answered a failure with an empty result then
    # this bundle is missing part of the game, and a tool that prints a
    # warning and exits 0 is telling the next person it went fine.
    #
    # The files are still written. That is deliberate -- an incomplete bundle
    # is often exactly what you want to *look at* while finding out why -- but
    # the exit code says what it is.
    short = {e["name"]: e["counts"]["degraded"] for e in entries
             if e.get("counts", {}).get("degraded")}
    if short:
        where = ", ".join(f"{n} ({k})" for n, k in sorted(short.items()))
        print(f"degraded: {where}", file=sys.stderr)
        print("the bundle is written but incomplete; this is a failure",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
