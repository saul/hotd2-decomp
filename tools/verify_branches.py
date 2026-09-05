#!/usr/bin/env python3
"""Check that every branch trigger names a route the block actually has.

A branching stage works like this. A route record whose ``kind`` is 1 sends
the script to ``next[g_script_branch_var]``, and ``g_script_branch_var``
(``0x009C88A4``) is written by **gameplay** -- never by the script. So the
question "which way does the stage go?" is answered by an actor, and the
answer is a small integer that has to be a slot the record actually fills.

That gives a check the reading can fail. For every branch block in the six
shipped stages, work out what the actors spawned in it can write, and assert
that every value names a **live** slot of that block's own route record. A
route record has three slots and unused ones hold ``-1``; getting the civilian
operand wrong, the class 0x52 subtype table backwards, or the class 0x53 block
gate missing all put a write on a hole, which ends the scene instead of taking
a route.

The writers modelled here are the ones attached to a spawned actor:

* **class 0x10**, the civilian -- ``CivilianRunScript`` op 0x19
  (``SetRouteBranch``) stores the s16 at ``cmd+4``. The spawn's descriptor
  tail picks an entry, the entry picks a stream, and streams reach further
  streams through the pointer operands of ops 0x0E/0x0F/0x1E/0x1F, so the
  whole reachable set is walked.
* **class 0x21** -- ``FUN_00451980`` writes 1 when its last part is shot off,
  beside the rescue counters and the +400.
* **class 0x52** subtypes 2, 3 and 4 -- ``Class52BranchTriggerUpdate`` writes
  the signed byte at ``0x00564442 + subtype``, which is 2, 1, 2.
* **class 0x53** subtype >= 2 -- ``CatBranchTriggerUpdate`` writes 2, and
  **only while ``g_evt_block_index == 8``**. That gate is load-bearing: stage
  2 spawns one of these in blocks 3, 5, 8 and 11, and only block 8's record
  has a slot 2 to go to.

The **props** are the second half, and they answer the same question. Nine
class-0x41 types and one class-0x44 selector write the variable from inside
their own update routine, each behind a gate of its own: a block index, a
script flag, a scene, or an Original Mode item. Their values have to name a
live slot too, and the block they name has to be a block their placement can
actually reach.

Not modelled: ``PropUpdateType69``, which does not choose a route but
**promotes** one -- it turns an existing 1 into a 2 -- so it has no value of
its own to check.

**What this check does not discriminate**, said plainly: types 14 and 19 write
``1 - obj+0x11C`` and both shipped spawns carry 0, so writing ``obj+0x11C``
instead would give 0, which is also a live slot in both their blocks. The
subtraction is proved by the disassembly and not by the data. Everything else
here is discriminated -- flip the class 0x52 subtype table, drop the cat's
block gate, or change ``PropUpdateType25``'s 1 to a 2, and a write lands on a
hole.

    python3 tools/verify_branches.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import evt  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402
from hod2lib.stage import Stage  # noqa: E402

STAGES = (1, 2, 3, 4, 5, 6)

#: `Class52BranchTriggerUpdate`: the signed bytes at 0x00564442 + subtype.
#: Subtypes 0 and 1 are the wanderers and write nothing.
CLASS52_BRANCH = {2: 2, 3: 1, 4: 2}
#: `CatBranchTriggerUpdate` writes 2, and only in this event block.
CLASS53_BLOCK, CLASS53_BRANCH = 8, 2   # CatBranchTriggerUpdate
#: `FUN_00451980` pays the rescue and writes this.
CLASS21_BRANCH = 1

#: `ExeTables.ROUTE_BRANCH` -- a route record's `kind` for a fork.
ROUTE_BRANCH = 1

#: What the shipped data holds. A change here is a change in the reading.
#:
#: 14 rather than 16 because two of stage 2's class 0x53 spawns -- blocks 3
#: and 5 -- are excluded by `CLASS53_BLOCK`, so nothing is claimed to write in
#: those blocks at all. Drop that gate and this becomes 16 with block 5
#: failing, which is the check earning its keep: block 5's record is
#: `[21, 6, -1]` and a 2 there would end the scene.
EXPECT_BLOCKS = 14
EXPECT_CIVILIAN_WRITERS = 11


def civilian_writes(civ: dict, slot: int) -> list[int]:
    """Every value the stream this spawn's tail selects can write.

    Follows the pointer operands, because a civilian's on-shot and resume
    streams are part of what she can run.
    """
    entries = civ["entries"]
    if not 0 <= slot < len(entries):
        return []
    seen: set[int] = set()
    todo = [entries[slot]]
    out: list[int] = []
    while todo:
        i = todo.pop()
        if i in seen or not 0 <= i < len(civ["scripts"]):
            continue
        seen.add(i)
        for cmd in civ["scripts"][i]:
            if cmd["op"] == 0x19:
                out.append(cmd["args"][0])
            todo.extend(cmd.get("scripts") or [])
    return out


def block_spawns(evtf, blk):
    """Every spawn descriptor reachable from one block's programs."""
    for prog in blk.programs:
        for ins in prog:
            if ins.opcode not in evt.SPAWN_OPCODES:
                continue
            for word in ins.raw:
                off = evtf.to_offset(word)
                if off is None or not 0 <= off <= len(evtf.raw) - evt.SPAWN_HEADER:
                    continue
                yield evt.read_spawn(evtf, off, ins.opcode)


#: The prop writers, as ``type -> (value, blocks, scenes)``.
#:
#: ``value`` of ``None`` means "1 minus the descriptor's +0x11C", which is how
#: types 14 and 19 let the level author name the default route.  ``blocks`` of
#: ``None`` means the routine has no block gate and fires wherever its object
#: is standing, so the spawn's own block is used.  ``scenes`` of ``None`` means
#: no scene gate.
PROP_WRITERS: dict[int, tuple] = {
    0x0E: (None, None, None),        # PropUpdateType14
    0x13: (None, None, None),        # PropUpdateType19
    0x19: (1, (0x17,), None),        # PropUpdateType25
    0x38: (2, (9,), None),           # PropUpdateType56
    0x46: (2, (4,), (2,)),           # OriginalItemPropUpdate
    0x47: (2, (4,), (2,)),           # OriginalItemPropUpdate
    0x49: (2, (7,), None),           # PropUpdateType73
    0x4C: (2, (5, 0x0E), None),      # PropUpdateType76
}

#: `PropUpdateType40`: the sub-kind whose pair opens a route, and what it says.
FRAGMENT_SUBKIND, FRAGMENT_BRANCH = 9, 2
#: `ChainSegmentUpdate`: the chain group, its block, and its value.
CHAIN_GROUP, CHAIN_BLOCK, CHAIN_BRANCH = 1, 0x16, 2
#: `StoryModeSwitchUpdate`'s scene-and-block table, and the 2 every arm writes.
STORY_SWITCH_ROUTES = ((0, 4), (1, 1), (1, 3), (1, 0x0C), (4, 4))
STORY_SWITCH_BRANCH = 2
#: What the shipped data holds for the prop half.
EXPECT_PROP_WRITES = 31


def check_prop_writers(game, scene_of) -> tuple[int, list[str]]:
    """Every prop writer's value against the record of the block it fires in.

    Returns ``(checked, failures)``.  A write into a block that is not a branch
    at all is skipped rather than failed: the variable is cleared at the next
    step boundary and nothing ever reads it, which is what most of the 28
    `PropUpdateType40` placements are doing.
    """
    checked, bad = 0, []
    for stage in STAGES:
        st = Stage(game, stage=stage)
        evtf, routes = st.evt(), st.routes
        raw, scene = evtf.raw, scene_of(stage)
        for blk in evtf.blocks:
            if blk.offset < 0:
                continue
            for sp in block_spawns(evtf, blk):
                writes = []
                if sp.cls == 0x41:
                    ctor = struct.unpack_from("<b", raw, sp.offset + 0x25)[0]
                    word = struct.unpack_from("<b", raw, sp.offset + 0x24)[0]
                    if ctor in PROP_WRITERS:
                        value, blocks, scenes = PROP_WRITERS[ctor]
                        if scenes is not None and scene not in scenes:
                            continue
                        if value is None:
                            value = 1 - sp.hp
                        for b in (blocks if blocks is not None
                                  else (blk.index,)):
                            writes.append((b, value, f"class41 type {ctor:#04x}"))
                    elif ctor == 40 and word == FRAGMENT_SUBKIND:
                        writes.append((blk.index, FRAGMENT_BRANCH,
                                       "PropUpdateType40 sub-kind 9"))
                    elif ctor == 24 and word == CHAIN_GROUP:
                        writes.append((CHAIN_BLOCK, CHAIN_BRANCH,
                                       "ChainSegmentUpdate group 1"))
                elif sp.cls == 0x44 and sp.hp == 17:
                    for s_, b in STORY_SWITCH_ROUTES:
                        if s_ == scene:
                            writes.append((b, STORY_SWITCH_BRANCH,
                                           "StoryModeSwitchUpdate"))
                for block, value, who in writes:
                    if not 0 <= block < len(routes):
                        continue
                    rec = routes[block]
                    if rec[0] != ROUTE_BRANCH:
                        continue          # nothing reads it; see the docstring
                    live = [i for i in range(3) if rec[1 + i] >= 0]
                    checked += 1
                    if value in live:
                        print(f"  ok  stage {stage} block {block}: next="
                              f"{list(rec[1:])}, {value}={who}")
                    else:
                        bad.append(f"FAIL stage {stage} block {block}: next="
                                   f"{list(rec[1:])} but {who} writes {value}, "
                                   "which names no route")
    return checked, bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()
    exe = game / "Hod2.exe"
    if not exe.exists():
        raise SystemExit(f"no Hod2.exe under {args.game_dir}")
    civ = ExeTables(exe).civilian_scripts()

    streams_with_op19 = sum(
        1 for s in civ["scripts"] if any(c["op"] == 0x19 for c in s))
    print(f"{streams_with_op19} of {len(civ['scripts'])} civilian streams run "
          f"op 0x19 (SetRouteBranch)")
    bad = 0
    if streams_with_op19 != EXPECT_CIVILIAN_WRITERS:
        print(f"FAIL expected {EXPECT_CIVILIAN_WRITERS}")
        bad += 1
    values = {c["args"][0] for s in civ["scripts"] for c in s if c["op"] == 0x19}
    print(f"  and every one of them passes {sorted(values)}")
    if values != {1}:
        print("FAIL a civilian was thought to only ever ask for route 1")
        bad += 1

    checked = 0
    for stage in STAGES:
        st = Stage(game, stage=stage)
        evtf, routes = st.evt(), st.routes
        for blk in evtf.blocks:
            if blk.offset < 0 or routes[blk.index][0] != ROUTE_BRANCH:
                continue
            rec = routes[blk.index]
            live = [i for i in range(3) if rec[1 + i] >= 0]
            writes: dict[int, str] = {}
            for sp in block_spawns(evtf, blk):
                if sp.cls == 0x10:
                    for v in civilian_writes(civ, sp.param(1, "i8")):
                        writes[v] = "civilian op 0x19"
                elif sp.cls == 0x21:
                    writes[CLASS21_BRANCH] = "class 0x21 rescue"
                elif sp.cls == 0x52:
                    sub = sp.param(0, "i16")
                    if sub in CLASS52_BRANCH:
                        writes[CLASS52_BRANCH[sub]] = f"class 0x52 sub {sub}"
                elif sp.cls == 0x53 and blk.index == CLASS53_BLOCK:
                    writes[CLASS53_BRANCH] = "class 0x53"
            if not writes:
                continue
            checked += 1
            holes = [v for v in writes if v not in live]
            names = ", ".join(f"{v}={writes[v]}" for v in sorted(writes))
            if holes:
                bad += 1
                print(f"FAIL stage {stage} block {blk.index}: next="
                      f"{list(rec[1:])} but {names} -- {holes} name no route")
            else:
                print(f"  ok  stage {stage} block {blk.index}: next="
                      f"{list(rec[1:])}, {names}")

    print(f"\n{checked} branch blocks have a trigger spawned in them; every "
          f"value they can write names a live route slot")
    if checked != EXPECT_BLOCKS:
        print(f"FAIL expected {EXPECT_BLOCKS} -- a trigger class or a route "
              "record has moved")
        bad += 1

    print("\nand the props, which write from inside their own routines:")
    prop_checked, prop_bad = check_prop_writers(game, lambda n: n - 1)
    for line in prop_bad:
        print(line)
    bad += len(prop_bad)
    print(f"\n{prop_checked} prop writes land in a branch block; every one "
          f"names a live route slot")
    if prop_checked != EXPECT_PROP_WRITES:
        print(f"FAIL expected {EXPECT_PROP_WRITES} -- a gate or a route record "
              "has moved")
        bad += 1
    print("clean" if not bad else f"{bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
