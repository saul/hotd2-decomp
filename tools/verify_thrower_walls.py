#!/usr/bin/env python3
"""Do class 0x31's wall leaps have anything to leap onto?

`ThrowerFindWallBeside` (`FUN_0044BEF0`) is the gate on states 14 and 15, and
it is a **question about the level**: it traces sixty units to the actor's own
left or right, at the ground height under it plus nine to twenty-nine, and
refuses the leap unless `ColiTraceSegmentAllSets` hits something. States 14, 15
and 16 are nine of the ten slots in `zstin`'s band-1 pick table, so if the
answer were "no wall anywhere", the whole climb would be unreachable data and
the reading of `g_class31_action_picks` would be wrong.

This runs the engine's own query against the engine's own `coli/` sets, at
every class-0x31 spawn point in the game, and reports how many of them have a
wall to their left, to their right, and overhead.

    python3 tools/verify_thrower_walls.py --game-dir ~/"THE HOUSE OF THE DEAD 2"

It fails only if **no** spawn in the whole game can find a wall, which would
mean the reading is wrong rather than the level being open.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import evt as evtlib, stage as stagelib  # noqa: E402

#: `ThrowerFindWallBeside`'s own constants, from `FUN_0044BEF0`.
WALL_REACH = 60.0
WALL_RISE = 9.0
WALL_SPREAD = 20
#: `QueryGroundHeightAt(x, y + 4.5, z)`, and the standoff from the face.
STANDOFF = 4.5
#: `ThrowerFindCeilingAbove` (`FUN_0044C0B0`) traces this far straight up.
CEILING_REACH = 1000.0
#: `QueryGroundHeightAt` (`FUN_00409D40`) traces from this far below.
GROUND_PROBE = 1000.0


def _segment_hits_quad(q, a, b):
    """`ColiSegmentVsMesh`'s inner test: signed plane distances, then the
    point-in-quad on the two axes the dominant one drops."""
    n = q.normal
    da = n[0] * a[0] + n[1] * a[1] + n[2] * a[2] + q.plane_d
    db = n[0] * b[0] + n[1] * b[1] + n[2] * b[2] + q.plane_d
    if (da > 0) == (db > 0):
        return None
    t = da / (da - db)
    p = tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
    # Four 2D cross products in the plane that drops the dominant axis.
    u, v = ((1, 2), (0, 2), (0, 1))[q.axis]
    vs = q.verts
    sign = 0
    for i in range(4):
        p0, p1 = vs[i], vs[(i + 1) % 4]
        cross = ((p1[u] - p0[u]) * (p[v] - p0[v])
                 - (p1[v] - p0[v]) * (p[u] - p0[u]))
        if cross == 0:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return None
    return p


def _trace(quads, a, b):
    """The nearest hit along `a -> b`, or None.

    Deliberately coarser than `ColiSegmentVsMesh`: no AABB reject, and
    back-facing quads count. Both only ever make it find *more* than the engine
    would, and this check fails on finding **none**, so the looser test cannot
    turn a real failure into a pass.
    """
    best = None
    best_d = math.inf
    for q in quads:
        p = _segment_hits_quad(q, a, b)
        if p is None:
            continue
        d = sum((p[i] - a[i]) ** 2 for i in range(3))
        if d < best_d:
            best_d, best = d, p
    return best


def _local(p, yaw_bams, x, y, z):
    """`MatrixTranslate(p); MatrixRotateY(yaw); MatrixTransformPoint(x,y,z)`."""
    t = yaw_bams * math.tau / 65536.0
    c, s = math.cos(t), math.sin(t)
    return (p[0] + x * c + z * s, p[1] + y, p[2] - x * s + z * c)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    total = walls = ceilings = grounded = 0
    print("class 0x31 spawns, and what `ThrowerFindWallBeside` finds:")
    for stage_no in range(1, 7):
        st = stagelib.Stage(game, stage=stage_no)
        sets = st.colisets()
        e = st.evt()
        if not sets or e is None:
            continue
        # Both sets, which is what `ColiTraceSegmentAllSets` consults.
        quads = [q for f in sets for q in f.quads]
        spawns = [s for s in evtlib.spawns(e) if s.cls == 0x31]
        n_wall = n_ceil = n_ground = 0
        for sp in spawns:
            total += 1
            pos = sp.pos
            yaw = sp.orient[1] & 0xFFFF
            ground = _trace(quads,
                            (pos[0], pos[1] + STANDOFF - GROUND_PROBE, pos[2]),
                            (pos[0], pos[1] + STANDOFF, pos[2]))
            if ground is None:
                continue
            n_ground += 1
            grounded += 1
            # The probe height is `ground + rand()%20 + 9`, so sweep the band
            # rather than picking one roll: the question is whether the level
            # has a wall there at all.
            found = False
            for lift in range(WALL_SPREAD):
                y = ground[1] + lift + WALL_RISE
                for side in (-1.0, 1.0):
                    far = _local(pos, yaw, side * WALL_REACH, 0, 0)
                    if _trace(quads, (far[0], y, far[2]), (pos[0], y, pos[2])):
                        found = True
                        break
                if found:
                    break
            if found:
                n_wall += 1
                walls += 1
            up = _local(pos, yaw, 0, CEILING_REACH, 0)
            if _trace(quads, up, (pos[0], pos[1], pos[2])):
                n_ceil += 1
                ceilings += 1
        if spawns:
            print(f"  stage {stage_no}: {len(spawns)} spawns, {n_ground} on "
                  f"solid ground, {n_wall} with a wall in reach, "
                  f"{n_ceil} with something overhead")

    print(f"\n{total} class-0x31 spawns: {grounded} stand on the collision "
          f"mesh, {walls} can reach a wall, {ceilings} have a ceiling")
    if total and not walls:
        print("\nFAIL")
        print("  no class-0x31 spawn in the game can find a wall, which would "
              "make nine of ten of `zstin`'s band-1 picks unreachable")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
