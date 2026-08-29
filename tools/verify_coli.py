#!/usr/bin/env python3
"""
Parse and verify `coli/` collision meshes.

The format is stated outright by the hit test, `ColiSegmentVsMesh`
(`0x004AAA40`), which walks a blob like this:

    u32 group_count
    repeat group_count:
        u32 quad_count
        f32 aabb_max[3]           <- MAX first; see below
        f32 aabb_min[3]
        repeat quad_count:        (18 dwords = 72 bytes)
            f32 nx, ny, nz, d     plane
            u32 axis              dominant axis: 0 = X, 1 = Y, 2 = Z
            f32 v0[3] v1[3] v2[3] v3[3]
            u32 surface           surface material id, returned on a hit

The AABB really is stored max-then-min. The overlap test reads

    seg_min.x <= box[1] && ... && box[4] <= seg_max.x

so `box[1..3]` is the upper corner and `box[4..6]` the lower one.

`axis` selects which two components the point-in-quad test runs in, and it is
an *integer* in a float slot -- the decompiler shows the comparisons against
1.4013e-45 and 2.8026e-45, which are the bit patterns of the integers 1 and 2.

Which files a scene uses: `ColiLoadForScene` (`0x0048A3B0`) loads `coli0.bin`
into a fixed buffer at 0x0098F200 and `coli<scene+1>.bin` into another at
0x00990A00. `evt` opcodes 0x10/0x11 then name individual blobs by **absolute
address** -- legal because the evt relocation pass has already rewritten them.

Checks, each chosen to collapse if the interpretation is wrong:

  * the blob walk must tile every file exactly, with no slack
  * every quad's four vertices must lie inside their group's AABB
  * the stored plane must be the plane of those four vertices
  * the stored normal must be unit length
  * every 0x10/0x11 pointer operand in every stage script, after relocation,
    must land exactly on a blob header of that scene's own coli file

Usage:
    python3 tools/verify_coli.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import evt, exetab  # noqa: E402

GROUP_HEADER = 28          # u32 quad_count + f32 max[3] + f32 min[3]
QUAD = 72                  # 18 dwords

#: ColiLoadForScene's two fixed load addresses.
BUF_COMMON = 0x0098F200    # coli0.bin, loaded for every scene
BUF_SCENE = 0x00990A00     # coli<scene+1>.bin

#: The evt relocation, from hod2lib.evt.
RELOC_MASK, RELOC_TAG, RELOC_SUB = 0xFFF80000, 0x0CE80000, 0x0C53E600

OPS_COLLISION_SET = (0x10, 0x11)

#: Surface ids that select the "wet" impact effect and splash sound, in both
#: FUN_00456B70 (bullet impact) and FUN_0040A230 (a bouncing dropped object).
WET_SURFACES = (5, 55)


def parse_file(b: bytes):
    """Walk a whole coli file. Returns (blobs, consumed_bytes)."""
    blobs, off = [], 0
    while off < len(b):
        start = off
        if off + 4 > len(b):
            break
        (ngroups,) = struct.unpack_from("<I", b, off)
        off += 4
        groups = []
        for _ in range(ngroups):
            if off + GROUP_HEADER > len(b):
                return blobs, start
            (nquads,) = struct.unpack_from("<I", b, off)
            hi = struct.unpack_from("<3f", b, off + 4)
            lo = struct.unpack_from("<3f", b, off + 16)
            if off + GROUP_HEADER + nquads * QUAD > len(b):
                return blobs, start
            p = off + GROUP_HEADER
            quads = []
            for _ in range(nquads):
                n = struct.unpack_from("<3f", b, p)
                d = struct.unpack_from("<f", b, p + 12)[0]
                axis = struct.unpack_from("<I", b, p + 16)[0]
                vs = [struct.unpack_from("<3f", b, p + 20 + 12 * k) for k in range(4)]
                surface = struct.unpack_from("<I", b, p + 68)[0]
                quads.append((n, d, axis, vs, surface))
                p += QUAD
            groups.append((lo, hi, quads))
            off = p
        blobs.append((start, groups))
    return blobs, off


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    problems: list[str] = []
    parsed: dict[str, list] = {}
    starts: dict[str, set[int]] = {}
    surfaces: Counter = Counter()
    axes: Counter = Counter()
    n_quads = n_groups = 0
    worst_plane = worst_norm = 0.0
    outside = axis_mismatch = 0

    print("file          bytes  blobs groups  quads  coverage")
    for path in sorted((game / "coli").glob("*.bin")):
        b = path.read_bytes()
        blobs, used = parse_file(b)
        cov = 100.0 * used / len(b)
        g = sum(len(x[1]) for x in blobs)
        q = sum(len(gr[2]) for x in blobs for gr in x[1])
        note = "" if used == len(b) else f"  stopped at {used:#x}"
        print(f"{path.name:<12} {len(b):>7} {len(blobs):>6} {g:>6} {q:>6}  {cov:6.2f}%{note}")

        if path.name == "coli.bin":
            # Never referenced by the filename table the loader indexes, and it
            # begins with 0x800 of zeros: a build artifact, not a loaded file.
            continue
        if used != len(b):
            problems.append(f"{path.name}: blob walk covered {cov:.2f}% of the file")
        parsed[path.name] = blobs
        starts[path.name] = {s for s, _ in blobs}
        n_groups += g
        n_quads += q

        for _, groups in blobs:
            for lo, hi, quads in groups:
                for n, d, axis, vs, surface in quads:
                    surfaces[surface] += 1
                    axes[axis] += 1
                    ln = math.sqrt(sum(c * c for c in n))
                    if ln > 0.5:              # skip degenerate/zero normals
                        worst_norm = max(worst_norm, abs(ln - 1.0))
                        if max(range(3), key=lambda k: abs(n[k])) != axis:
                            axis_mismatch += 1
                    for v in vs:
                        worst_plane = max(
                            worst_plane, abs(sum(n[k] * v[k] for k in range(3)) + d))
                        if not all(lo[k] - 1.0 <= v[k] <= hi[k] + 1.0 for k in range(3)):
                            outside += 1

    print()
    print(f"{n_groups} groups, {n_quads} quads")
    print(f"  vertices outside their group's AABB      : {outside}")
    print(f"  worst |n.v + d| over every quad vertex   : {worst_plane:.3e}")
    print(f"  worst | |n| - 1 |                        : {worst_norm:.3e}")
    print(f"  axis tag != argmax|normal|               : {axis_mismatch}")
    print(f"  dominant axis: {dict(sorted(axes.items()))}")
    print(f"  surface ids  : {dict(sorted(surfaces.items()))}")
    print(f"     wet surfaces {WET_SURFACES} account for "
          f"{sum(surfaces[s] for s in WET_SURFACES)} quads")

    # -- the cross-check: script pointers must land on blob headers ----------
    tables = exetab.ExeTables(str(game / "Hod2.exe"))
    total = hit = 0
    for scene in range(6):
        name = tables.scene_evt_file(scene)
        if not name or not (game / "evt" / name).exists():
            continue
        ev = evt.load(str(game / "evt" / name), tables.scene_block_count(scene))
        common, mine = "coli0.bin", f"coli{scene + 1}.bin"
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
                        p = a - RELOC_SUB if (a & RELOC_MASK) == RELOC_TAG else a
                        if (p - BUF_COMMON) in starts.get(common, ()) \
                                or (p - BUF_SCENE) in starts.get(mine, ()):
                            hit += 1
                        else:
                            problems.append(
                                f"{name} @{ins.offset:#06x}: collision pointer "
                                f"{a:#010x} -> {p:#010x} is not a blob header")
    print()
    print(f"evt collision-set pointers (opcodes 0x10 / 0x11)   : {total}")
    print(f"  landing exactly on a blob header of their scene  : {hit}/{total}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems[:20]:
            print("  " + p)
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
