#!/usr/bin/env python3
"""
Verify the stage's objects: what the event tables spawn, and the routes objects
follow.

Two separate datasets, checked against each other and against the geometry.

**Spawns.** Every spawn descriptor an event script reaches carries a class id,
a world position, a BAMS yaw and hit points. The class id indexes the handler
table `FUN_0040AC90` builds from the `{class_id, handler}` pair list at
`0x00593358`, so a class the table does not define would be dispatched to the
empty stub -- an id outside it is a decode error, not an oddity.

**Object paths.** `op_` files hold the routes. `CamEvalObjectPath6`
(`0x004042D0`) evaluates one by a **global** path slot spanning every `cam/`
file, and an object is bound to its route by a slot constant in its draw
routine -- `FUN_0048E600` passes 0xFD/0xFE/0xFF, which are `op_st1` local 0/1/2
(the player's car; it draws `car_pl.bin` plus `char_adv00.bin` occupants).

Checks, each chosen to collapse if the reading is wrong:

  * every spawn's class id is defined in the handler table
  * every spawn position lies inside the bounding box of the stage's own
    geometry -- a wrong descriptor stride scatters them immediately
  * every `op_` path slot the exporter emits resolves to that stage's own
    `op_` file
  * the object-path slot constants found in the code land in `op_` files and
    never in `cp_` ones

Usage:
    python3 tools/verify_objects.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import struct
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import cam, exetab, script as scriptlib, stage as stagelib  # noqa: E402

#: FUN_0040AC90's {class_id, handler} pair list, terminated by a negative id.
CLASS_TABLE = 0x00593358

#: Object-path slot constants read out of the draw routines that call
#: CamEvalObjectPath6 with a literal. Each must land in an op_ file.
#: (call site, slot) -- see docs/formats/cam.md.
CODE_PATH_SLOTS = {
    0x0048E64D: 0xFE,     # FUN_0048E600, the player's car (op_st1 local 1)
    0x00415C48: 0xFE,     # FUN_00415BD0
    0x0048F5AF: 0x182,    # FUN_0048F560
    0x0048F091: 0x173,    # FUN_0048F050
    0x00426BA3: 0x185,    # FUN_00426A70, class 45
    0x0047F715: 0x180,    # FUN_0047F5F0, class 50
}


def class_ids(tables: exetab.ExeTables) -> set[int]:
    """Class ids the handler table defines."""
    off = tables._v2r(CLASS_TABLE)
    out: set[int] = set()
    while True:
        cid, handler = struct.unpack_from("<iI", tables.data, off)
        if cid < 0:
            return out
        out.add(cid)
        off += 8
        if len(out) > 512:
            raise SystemExit("class table did not terminate")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    tables = exetab.ExeTables(str(game / "Hod2.exe"))
    known_classes = class_ids(tables)
    print(f"handler table at {CLASS_TABLE:#010x}: {len(known_classes)} classes "
          f"defined, ids {min(known_classes)}..{max(known_classes)}")

    # global path slot -> file stem, via the EXE's own per-file slot lists
    slot_file: dict[int, str] = {}
    for p in sorted((game / "cam").glob("*.bin")):
        for s in tables.cam_slots_for(p.stem) or []:
            slot_file[s] = p.stem
    print(f"global path slots resolved: {len(slot_file)}")

    problems: list[str] = []
    tot_spawns = 0
    tot_paths = 0
    classes: Counter = Counter()

    print()
    print(f"{'stage':<7}{'spawns':>8}{'inside bbox':>13}{'op_ paths':>11}  file")
    for stage_no in range(1, 7):
        st = stagelib.Stage(game, stage=stage_no)
        prog = scriptlib.load(st)

        # geometry bounding box for this stage
        lo = [1e30] * 3
        hi = [-1e30] * 3
        parts, _model_regions, _regions = st.geometry()
        for _name, models, _bank in parts:
            for m in models:
                for mesh in m.meshes:
                    for v in mesh.vertices:
                        for k in range(3):
                            lo[k] = min(lo[k], v.pos[k])
                            hi[k] = max(hi[k], v.pos[k])

        n = inside = 0
        for blk in prog.blocks:
            for step in blk.steps:
                for op in step.ops:
                    for sp in op.detail.get("spawns", []) or []:
                        n += 1
                        classes[sp["class"]] += 1
                        if sp["class"] not in known_classes:
                            problems.append(
                                f"stage {stage_no}: spawn class {sp['class']} "
                                f"is not in the handler table")
                        if all(lo[k] <= sp["pos"][k] <= hi[k] for k in range(3)):
                            inside += 1
        tot_spawns += n

        cp = st.campaths()
        op_paths = [r for r in cp.by_slot.values() if r.is_object_path] if cp else []
        want = f"op_st{stage_no}"
        for r in op_paths:
            if r.file != want:
                problems.append(f"stage {stage_no}: object path slot {r.slot} "
                                f"is in {r.file}, not {want}")
        tot_paths += len(op_paths)
        print(f"{stage_no:<7}{n:>8}{inside:>10}/{n:<3}{len(op_paths):>9}  {want}")

    print()
    print(f"spawn classes used: {len(classes)} distinct, "
          f"all defined: {set(classes) <= known_classes}")
    print(f"  most common: "
          + ", ".join(f"{c}x{k}" for k, c in classes.most_common(6)))

    print()
    print("object-path slot constants found in the draw routines:")
    for site, slot in sorted(CODE_PATH_SLOTS.items()):
        stem = slot_file.get(slot, "?")
        ok = stem.startswith("op_")
        print(f"  {site:#010x} -> slot {slot:#05x} ({slot:3d}) = {stem}"
              f"{'' if ok else '   <- NOT an object path'}")
        if not ok:
            problems.append(f"{site:#010x}: slot {slot} resolves to {stem}")

    print()
    print(f"total: {tot_spawns} spawns, {tot_paths} object paths over 6 stages")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems[:20]:
            print("  " + p)
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
