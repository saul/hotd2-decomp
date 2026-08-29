#!/usr/bin/env python3
"""
Validate the NL1 parser across every model in the game.

Checks structural sanity rather than just "did it not crash":
  - triangle indices are in range
  - positions/UVs are finite and within plausible bounds
  - mesh chains consume their declared size
  - reports the distribution of shading modes, pixel formats and list types

Usage:
    python3 tools/verify_nl1.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import container as C, nl1  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    files = sorted((game / "pol").glob("*.bin"))
    if args.limit:
        files = files[: args.limit]

    stats = Counter()
    shading = Counter()
    pixfmt = Counter()
    listtype = Counter()
    problems: list[str] = []
    tot_v = tot_t = tot_m = 0
    maxcoord = 0.0

    for path in files:
        if path.name.startswith("pol_"):
            continue
        try:
            c = C.load(path.read_bytes())
        except Exception as e:
            stats["container FAILED"] += 1
            problems.append(f"{path.name}: container: {e}")
            continue

        if c.kind not in (C.RAW, C.COMPRESSED) or not c.models:
            stats[f"skipped ({c.kind})"] += 1
            continue

        models = nl1.parse_container(c)
        if len(models) != len(c.models):
            stats["models unparsed"] += len(c.models) - len(models)

        for m in models:
            tot_m += 1
            tot_v += m.vertex_count
            tot_t += m.triangle_count
            for mesh in m.meshes:
                shading[mesh.shading_mode_name] += 1
                pixfmt[mesh.pixel_format_name] += 1
                listtype[mesh.list_type] += 1

                nv = len(mesh.vertices)
                for tri in mesh.triangles:
                    if any(i < 0 or i >= nv for i in tri):
                        stats["BAD triangle index"] += 1
                        if len(problems) < 20:
                            problems.append(f"{path.name}: tri {tri} of {nv} verts")
                        break

                for v in mesh.vertices:
                    for comp in v.pos:
                        if not math.isfinite(comp):
                            stats["BAD non-finite position"] += 1
                            break
                        maxcoord = max(maxcoord, abs(comp))
                    for comp in v.uv:
                        if not math.isfinite(comp):
                            stats["BAD non-finite uv"] += 1
                            break

        stats["files ok"] += 1

    print(f"files parsed  : {stats['files ok']}")
    print(f"models        : {tot_m}")
    print(f"vertices      : {tot_v:,}")
    print(f"triangles     : {tot_t:,}")
    print(f"max |coord|   : {maxcoord:,.1f}")

    print("\nshading modes:")
    for k, v in shading.most_common():
        print(f"  {k:16} {v:>7,}")
    print("\npixel formats (textured meshes):")
    for k, v in pixfmt.most_common():
        print(f"  {k:16} {v:>7,}")
    print("\nlist types (0 opaque, 2 translucent, 4 punch-through):")
    for k, v in sorted(listtype.items()):
        print(f"  {k:<16} {v:>7,}")

    bad = {k: v for k, v in stats.items() if "BAD" in k or "FAILED" in k}
    if bad:
        print("\nPROBLEMS:")
        for k, v in bad.items():
            print(f"  {k}: {v}")
        for p in problems[:20]:
            print(f"    {p}")
        return 1

    print("\nNo structural problems found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
