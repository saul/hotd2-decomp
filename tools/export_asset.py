#!/usr/bin/env python3
"""Export one `pol/` asset file to glTF, laid out so every model is visible.

For identifying what a thing *is*. A spawn class names a character type, the
type names a skeleton in the EXE, and the skeleton's nodes name asset slots --
which resolve to a file and an entry index. Dumping that file answers "what
does this actually look like" without going through a stage.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import gltf, stage as stagelib  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stem", help="asset file stem, e.g. cat")
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / "THE HOUSE OF THE DEAD 2")
    ap.add_argument("--out", type=Path, default=Path("extract/assets"))
    ap.add_argument("--spacing", type=float, default=0.0,
                    help="lay models out along X at this pitch; 0 = as authored")
    ap.add_argument("--unlit", action="store_true", default=True)
    args = ap.parse_args()

    models, bank = stagelib.load_asset(args.game_dir, args.stem)
    if not models:
        print(f"no models in {args.stem}")
        return 1

    if args.spacing:
        # Shift each model along X so the parts do not pile up at the origin.
        # The bind pose lives in the motion data, not in the model, so an
        # as-authored dump of a skinned character overlaps everything.
        for i, m in enumerate(models):
            dx = i * args.spacing
            for mesh in m.meshes:
                for v in mesh.vertices:
                    v.pos = (v.pos[0] + dx, v.pos[1], v.pos[2])

    out = args.out / args.stem
    out.mkdir(parents=True, exist_ok=True)
    info = gltf.export_level(args.stem, [(args.stem, models, bank)], out,
                            unlit=args.unlit)
    print(f"{args.stem}: {len(models)} models, {info['meshes']} meshes, "
          f"{info['materials']} materials -> {info['gltf']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
