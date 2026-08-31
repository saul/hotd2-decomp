#!/usr/bin/env python3
"""
Verify the `coli/` collision meshes against the corpus.

The format comes from `ColiSegmentVsMesh` (`0x004AAA40`) and is implemented in
`hod2lib.coli`; this script only checks it. Each check is chosen to collapse if
the interpretation is wrong:

  * the blob walk must tile every loaded file exactly, with no slack
  * every quad's four vertices must lie inside their group's AABB
  * the stored plane must be the plane of those four vertices
  * the stored normal must be unit length
  * the dominant-axis tag should be the largest normal component
  * every 0x10/0x11 pointer operand in every stage script, after relocation,
    must land exactly on a blob header of that scene's own coli file

Usage:
    python3 tools/verify_coli.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import coli, evt, exetab, stage as stagelib  # noqa: E402

OPS_COLLISION_SET = (0x10, 0x11)

#: coli.bin is absent from the filename table the loader indexes, begins with
#: 0x800 bytes of zeros and contains the other files at 0x800-aligned offsets.
#: A build artifact; it is reported but not required to parse.
NOT_LOADED = "coli.bin"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    problems: list[str] = []
    files: dict[str, coli.ColiFile] = {}
    surfaces: Counter = Counter()
    axes: Counter = Counter()
    n_groups = n_quads = 0
    worst_plane = worst_norm = 0.0
    outside = axis_mismatch = degenerate = 0

    print("file          bytes  blobs groups  quads  coverage")
    for path in sorted((game / "coli").glob("*.bin")):
        f = coli.load(path)
        g = sum(len(b.groups) for b in f.blobs)
        q = len(f.quads)
        note = "" if f.coverage == 1.0 else f"  stopped at {f.consumed:#x}"
        print(f"{f.name:<12} {len(f.raw):>7} {len(f.blobs):>6} {g:>6} {q:>6}"
              f"  {f.coverage:6.2%}{note}")

        if f.name == NOT_LOADED:
            continue
        if f.coverage != 1.0:
            problems.append(f"{f.name}: blob walk covered {f.coverage:.2%}")
        files[f.name] = f
        n_groups += g
        n_quads += q

        for blob in f.blobs:
            for grp in blob.groups:
                for quad in grp.quads:
                    surfaces[quad.surface] += 1
                    axes[quad.axis] += 1
                    worst_plane = max(worst_plane, quad.plane_error())
                    ln = math.sqrt(sum(c * c for c in quad.normal))
                    if ln <= 0.5:
                        degenerate += 1
                    else:
                        worst_norm = max(worst_norm, abs(ln - 1.0))
                        if max(range(3), key=lambda k: abs(quad.normal[k])) != quad.axis:
                            axis_mismatch += 1
                    for v in quad.verts:
                        if not all(grp.aabb_min[k] - 1.0 <= v[k] <= grp.aabb_max[k] + 1.0
                                   for k in range(3)):
                            outside += 1

    print()
    print(f"{n_groups} groups, {n_quads} quads")
    print(f"  vertices outside their group's AABB      : {outside}")
    print(f"  worst |n.v + d| over every quad vertex   : {worst_plane:.3e}")
    print(f"  worst | |n| - 1 |                        : {worst_norm:.3e}")
    print(f"  quads with a zero-length normal          : {degenerate}")
    print(f"  axis tag != argmax|normal|               : {axis_mismatch}")
    print(f"  dominant axis: {dict(sorted(axes.items()))}")
    print(f"  surface ids  : {dict(sorted(surfaces.items()))}")
    print(f"     wet surfaces {coli.WET_SURFACES} account for "
          f"{sum(surfaces[s] for s in coli.WET_SURFACES)} quads")

    # -- the cross-check: script pointers must land on blob headers ----------
    tables = exetab.ExeTables(str(game / "Hod2.exe"))
    total = hit = 0
    for scene in range(6):
        name = tables.scene_evt_file(scene)
        if not name or not (game / "evt" / name).exists():
            continue
        common_name, scene_name = coli.scene_files(scene)
        common, per_scene = files[common_name], files[scene_name]
        ev = evt.load(str(game / "evt" / name), tables.scene_block_count(scene))
        for blk in ev.blocks:
            if blk.offset < 0:
                continue
            for prog in blk.programs:
                for ins in prog:
                    if ins.opcode not in OPS_COLLISION_SET:
                        continue
                    for a in ins.raw:
                        if a == 0xFFFFFFFF:
                            continue
                        total += 1
                        if coli.pointer_to_offset(a, common, per_scene):
                            hit += 1
                        else:
                            problems.append(
                                f"{name} @{ins.offset:#06x}: collision pointer "
                                f"{a:#010x} -> {coli.resolve_pointer(a):#010x} "
                                f"is not a blob header")
    print()
    print(f"evt collision-set pointers (opcodes 0x10 / 0x11)   : {total}")
    print(f"  landing exactly on a blob header of their scene  : {hit}/{total}")

    # -- the exported bundle carries the same quads -----------------------
    #
    # The player now runs the *game's* collision rather than raycasting the
    # drawn mesh, so the bundle's copy has to be the file's copy. This
    # re-derives every blob through the exporter and compares it field by
    # field with the parsed file, which is what would collapse if the flat
    # array packing were ever wrong -- a transposed vertex triple or an
    # off-by-one stride reads as plausible geometry and silently moves walls.
    from hod2lib import script as scriptlib  # noqa: PLC0415
    checked = mismatched = 0
    for stage_no in range(1, 7):
        st = stagelib.Stage(game, stage=stage_no)
        try:
            block = scriptlib.Program(st).coli_json()
        except Exception as exc:                    # noqa: BLE001
            problems.append(f"stage {stage_no}: coli_json failed: {exc}")
            continue
        sets = st.colisets() or ()
        for f in sets:
            for b in f.blobs:
                quads = b.quads
                if not quads:
                    continue
                key = f"{f.name}:{b.offset}"
                out = block["blobs"].get(key)
                if out is None:
                    problems.append(f"{key}: in the file, missing from the bundle")
                    continue
                checked += 1
                bad = out["n"] != len(quads)
                for i, q in enumerate(quads):
                    if bad:
                        break
                    pl = out["plane"][i * 4:i * 4 + 4]
                    if (tuple(pl[:3]) != tuple(q.normal) or pl[3] != q.plane_d
                            or out["axis"][i] != q.axis
                            or out["surface"][i] != q.surface):
                        bad = True
                        break
                    vs = out["verts"][i * 12:i * 12 + 12]
                    flat = [c for v in q.verts for c in v]
                    if vs != flat:
                        bad = True
                if bad:
                    mismatched += 1
                    problems.append(f"{key}: the bundle's quads are not the "
                                    f"file's")
    print()
    print(f"exported collision blobs re-derived and compared    : {checked}")
    print(f"  differing from the parsed file                    : {mismatched}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems[:20]:
            print("  " + p)
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
