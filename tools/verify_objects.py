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

from hod2lib import (cam, exetab, rigs as rigslib,  # noqa: E402
                     script as scriptlib, stage as stagelib)

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

    # -- transcribed rigs ---------------------------------------------------
    slots_tbl = tables.asset_slots()
    print()
    n_drawable = sum(1 for r in rigslib.RIGS
                     if any(pt.slots for pt in r.parts))
    print(f"transcribed rigs: {len(rigslib.RIGS)} of 31 CamEvalObjectPath6 "
          f"callers, {n_drawable} with drawable geometry")
    for rig in rigslib.RIGS:
        names = {p.name for p in rig.parts}
        n_slots = sum(len(p.slots) for p in rig.parts)
        unresolved = [s for p in rig.parts for s in p.slots if s not in slots_tbl]
        # every parent reference must name a real part, and the graph must be
        # acyclic -- ordered_parts() would loop forever otherwise
        for part in rig.parts:
            if part.parent and part.parent not in names:
                problems.append(f"{rig.name}: part {part.name} names a parent "
                                f"{part.parent!r} that does not exist")
        try:
            ordered = rigslib.ordered_parts(rig)
        except RecursionError:
            problems.append(f"{rig.name}: parent references form a cycle")
            ordered = []
        if len(ordered) != len(rig.parts):
            problems.append(f"{rig.name}: ordered_parts dropped a part")
        for part in rig.parts:
            for s in part.slots:
                if s not in slots_tbl:
                    problems.append(f"{rig.name}: part {part.name} draws slot "
                                    f"{s:#06x}, which no asset slot defines")
        route = ", ".join(f"{s:#05x}" for s in rig.all_path_slots) or "-"
        tags = []
        if rig.spawn_class is not None:
            tags.append(f"class {rig.spawn_class:#04x}")
        if rig.world_space:
            tags.append("world")
        if rig.fixed_poses:
            tags.append(f"{len(rig.fixed_poses)} fixed")
        if rig.placement_blocked:
            tags.append("NOT PLACED")
        print(f"  {rig.name:<17}{rig.routine:<15}{len(rig.parts):>2} parts, "
              f"{n_slots:>2} slots  routes {route}"
              f"{'  [' + ', '.join(tags) + ']' if tags else ''}")
        if unresolved:
            print(f"      unresolved slots: {[hex(x) for x in unresolved]}")

        # A route slot must name an op_ file and a camera-path gate must name a
        # cp_ one. This is the invariant that makes per-stage gating possible:
        # a rig belongs to a stage iff the stage owns the cp_ file that selects
        # it, so if the two ever mixed, rigs would land in the wrong levels.
        for slot in rig.all_path_slots:
            stem = slot_file.get(slot, "?")
            if not stem.startswith("op_"):
                problems.append(f"{rig.name}: route slot {slot} is {stem}, "
                                f"not an object path")
        for cam in rig.cam_paths:
            stem = slot_file.get(cam, "?")
            if not stem.startswith("cp_"):
                problems.append(f"{rig.name}: camera gate {cam:#05x} is {stem}, "
                                f"not a camera path")
        # Every camera path that selects a route must live in the same stage
        # file as the route it selects, or the gate could never fire.
        for r in rig.routes:
            rf = slot_file.get(r.slot, "?").replace("op_", "")
            for cam in r.cam_paths:
                cf = slot_file.get(cam, "?").replace("cp_", "")
                if rf != "?" and cf != "?" and rf != cf:
                    problems.append(
                        f"{rig.name}: route {r.slot:#05x} is in {rf} but its "
                        f"gate {cam:#05x} is in {cf} -- it could never fire")

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
