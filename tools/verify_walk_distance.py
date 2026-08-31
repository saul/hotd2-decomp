#!/usr/bin/env python3
"""Is the scripted walk-in really a distance at descriptor tail +0x04?

`ZombieStateWalkDistance` (`FUN_00457220`, class 0x30 state 15) and
`ThrowerStateWalkDistance` (`FUN_0044E2A0`, class 0x31 state 18) both latch a
**float** from tail ``+0x04`` and walk until the 2D distance from where they
started reaches it. The reading is only worth anything if that word is a
distance in every record that names the state -- a wrong offset, or a state
index that means something else for one of the two classes, would show up as
garbage floats rather than as a crash.

So: read tail ``+0x04`` at every spawn descriptor in the game whose initial
state is one of the two, and check that what comes out is a plausible walk.
The check that can fail is the strict one -- **every one of them is an exact
integer** -- which is not something a misread offset produces: the neighbouring
word, tail ``+0x08``, is the next record's bytes and reads as denormal noise.

    python3 tools/verify_walk_distance.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import evt as evtlib, script as scriptlib, stage as stagelib  # noqa: E402
from hod2lib.characters import WALK_DISTANCE_STATES  # noqa: E402

#: Nothing in the shipped data walks less than a pace or further than a room.
MIN_WALK = 1.0
MAX_WALK = 200.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    rows: list[tuple[int, int, int, float, float]] = []
    for n in range(1, 7):
        try:
            prog = scriptlib.Program(stagelib.Stage(game, stage=n))
        except Exception as exc:                       # noqa: BLE001
            print(f"stage {n}: unreadable ({exc})")
            continue
        for rec in evtlib.spawns(prog.evt):
            want = WALK_DISTANCE_STATES.get(rec.cls, ())
            if (rec.param(2, "i8") or 0) not in want:
                continue
            rows.append((n, rec.cls, rec.offset,
                         rec.param(4, "f32"), rec.param(8, "f32")))

    if not rows:
        print("FAIL  no spawn in the game starts in a walk-distance state")
        return 1

    bad = [r for r in rows
           if r[3] is None or not math.isfinite(r[3])
           or not (MIN_WALK <= r[3] <= MAX_WALK)]
    nonint = [r for r in rows if r[3] is not None and math.isfinite(r[3])
              and r[3] != int(r[3])]
    # The adjacent-array trap, stated as a check: the word *after* the distance
    # belongs to the next descriptor, so it must NOT also look like a distance.
    plausible_next = [r for r in rows if r[4] is not None
                      and math.isfinite(r[4]) and MIN_WALK <= r[4] <= MAX_WALK]

    per_class: dict[int, int] = {}
    for r in rows:
        per_class[r[1]] = per_class.get(r[1], 0) + 1
    print(f"{len(rows)} spawns start in a walk-distance state: "
          + ", ".join(f"class 0x{c:02X} x{k}" for c, k in sorted(per_class.items())))
    vals = sorted({r[3] for r in rows if r[3] is not None})
    print(f"distances: {', '.join(f'{v:g}' for v in vals)}")

    ok = True
    if bad:
        ok = False
        print(f"FAIL  {len(bad)} of {len(rows)} are not a distance in "
              f"[{MIN_WALK}, {MAX_WALK}]:")
        for n, cls, at, d, _ in bad[:10]:
            print(f"        stage {n} class 0x{cls:02X} at {at}: {d!r}")
    else:
        print(f"  ok    all {len(rows)} are in [{MIN_WALK}, {MAX_WALK}]")

    if nonint:
        ok = False
        print(f"FAIL  {len(nonint)} of {len(rows)} are not exact integers:")
        for n, cls, at, d, _ in nonint[:10]:
            print(f"        stage {n} class 0x{cls:02X} at {at}: {d!r}")
    else:
        print(f"  ok    all {len(rows)} are exact integers")

    # This one reports rather than fails: it is evidence about the *next*
    # record, and a neighbour that happens to start with a small float is
    # possible without the reading being wrong.
    print(f"  note  tail+0x08 reads as a plausible distance in "
          f"{len(plausible_next)} of {len(rows)} -- it is the next "
          f"descriptor, and should mostly be noise")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
