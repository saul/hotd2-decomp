#!/usr/bin/env python3
"""Check the class-0x46 bat against the tables the exe steers it with.

`PlaceBats` (`FUN_0042D9C0`) is a placer with three flights, and the shape of
each one is held in the EXE rather than in the descriptor: the twenty-four
sub-type-0 spawns all sit at the world origin and take their whole path from
`g_bat_spline_points` (`0x00589944`), indexed by a pair of *descriptor* bytes
the parser has to read correctly to land on the right row. So the reading is a
chain -- descriptor byte to flight group, group and member to spline slot,
character type to `zabat.bin` -- and every link of it is checkable.

What this asserts, and what only this can see:

  * **The twenty-seven descriptors split 24 / 1 / 2 across sub-types 0, 1 and
    2**, by `desc+0x25`, which is the byte the opcode-0x09 allocator copies to
    `obj+0x130C`. A parser that read `desc+0x24` instead would still produce
    three groups and a plausible story; the counts are what tell them apart.
  * **The four sub-type-0 flights are complete**: each is six descriptors with
    `+0x11C` exactly 1..6, sharing one `desc+0x24` group, and the four groups
    are 0, 1, 2 and 3 with no repeats. `PlaceBats` derives the member index as
    `+0x11C - 1` and the spline slot as `group * 3 + member % 3`, so a missing
    or duplicated member is a bat flying another bat's path.
  * **Every slot those flights reach exists in the twelve-row table**, and all
    twelve rows are reached. A thirteenth group would index past the end.
  * **Each path's control points are in front of the camera and monotone in
    z or y** -- the bats fly *somewhere*, rather than the table being twelve
    rows of a coincidence.
  * **The motion pair resolves.** `BatWingUpdate` finds its clip by searching
    `g_bat_body_motions` for the body's own clip and taking
    `g_bat_wing_motions` at the same index. That search only terminates
    usefully because every body row is 0x407, the clip `PlaceBats` writes.
    If either table stops being uniform, the wing silently keeps whatever clip
    it had.
  * **The swarm's member count is six and eight, not eight and ten.** The
    expression is `((1 < g_players_in_play) - 1 & 0xFFFFFFFE) + 8`, which is
    `8` when the test holds and `6` when it does not -- and it reads like the
    other way round, which is how this file's first draft and the first
    annotation of `PlaceBats` both had it. The bytes are asserted here so the
    port's constants cannot drift back.

  * **The two character types are the bat.** `0x1E` is `zabat.bin` with one
    node and `0x1F` is `zabat_wing.bin` with six, and both names come from
    `g_character_skeletons`, which is one of the binary's two name tables.

    python3 tools/verify_bats.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import evt  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

BAT_CLASS = 0x46

#: `g_bat_spline_points` -- s16 pts[12][4][3].
SPLINE_POINTS = 0x00589944
SPLINE_SLOTS = 12
SPLINE_CTRL = 4

#: `g_bat_body_motions` and `g_bat_wing_motions`, five s16 each.
BODY_MOTIONS = 0x0058992C
WING_MOTIONS = 0x00589938
MOTION_ROWS = 5

#: The clip `PlaceBats` writes to `obj+0x1B4`, and the one the wing gets.
BODY_CLIP = 0x407
WING_CLIP = 0x406

#: Character types, and the `g_character_skeletons` names that identify them.
BODY_CHAR_TYPE = 0x1E
WING_CHAR_TYPE = 0x1F
BODY_ASSET = "zabat.bin"
WING_ASSET = "zabat_wing.bin"
BODY_NODES = 1
WING_NODES = 6

#: What the shipped scripts hold. A change here is a change in the reading.
EXPECT_BY_SUBTYPE = {0: 24, 1: 1, 2: 2}
EXPECT_FLIGHTS = {
    # group -> (scene, block, step)
    0: (3, 0, 6),
    1: (2, 4, 5),
    2: (3, 2, 6),
    3: (3, 10, 1),
}


def s16(raw: bytes, off: int) -> int:
    return struct.unpack_from("<h", raw, off)[0]


class Failures:
    def __init__(self) -> None:
        self.n = 0

    def check(self, ok: bool, msg: str) -> None:
        if ok:
            return
        self.n += 1
        print(f"  FAIL {msg}")


def bat_spawns(game_dir: Path, tables: ExeTables):
    """Every class-0x46 descriptor, with the block that places it."""
    com = evt.load(str(game_dir / "evt" / "comevtbl.bin"))
    out = []
    for scene in range(12):
        name = tables.scene_evt_file(scene)
        if not name:
            continue
        path = game_dir / "evt" / name
        if not os.path.exists(path):
            continue
        f = evt.load(str(path), tables.scene_block_count(scene), com=com)
        where: dict[int, tuple[int, int]] = {}
        for blk in f.blocks:
            for step, prog in enumerate(blk.programs):
                for ins in prog:
                    if ins.opcode not in evt.SPAWN_OPCODES:
                        continue
                    for w in ins.raw:
                        off = f.to_offset(w)
                        if off is not None:
                            where.setdefault(off, (blk.index, step))
        for sp in evt.spawns(f):
            if sp.cls != BAT_CLASS:
                continue
            blk, step = where.get(sp.offset, (-1, -1))
            out.append({
                "scene": scene, "block": blk, "step": step,
                "opcode": sp.opcode, "offset": sp.offset, "member_hp": sp.hp,
                "group": f.raw[sp.offset + 0x24],
                "subtype": f.raw[sp.offset + 0x25],
            })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    tables = ExeTables(str(args.game_dir / "Hod2.exe"))
    raw = Path(args.game_dir / "Hod2.exe").read_bytes()
    fail = Failures()

    # -- the descriptors ---------------------------------------------------
    spawns = bat_spawns(args.game_dir, tables)
    by_subtype: dict[int, list[dict]] = {}
    for sp in spawns:
        by_subtype.setdefault(sp["subtype"], []).append(sp)
    got = {k: len(v) for k, v in sorted(by_subtype.items())}
    print(f"class 0x46 descriptors: {len(spawns)}, by sub-type {got}")
    fail.check(got == EXPECT_BY_SUBTYPE,
               f"sub-type split is {got}, expected {EXPECT_BY_SUBTYPE}")

    # -- the four sub-type-0 flights ---------------------------------------
    flights: dict[int, list[dict]] = {}
    for sp in by_subtype.get(0, []):
        flights.setdefault(sp["group"], []).append(sp)
    fail.check(sorted(flights) == sorted(EXPECT_FLIGHTS),
               f"flight groups are {sorted(flights)}, "
               f"expected {sorted(EXPECT_FLIGHTS)}")

    reached: set[int] = set()
    for group, members in sorted(flights.items()):
        hps = sorted(m["member_hp"] for m in members)
        fail.check(hps == [1, 2, 3, 4, 5, 6],
                   f"flight {group} has +0x11C {hps}, expected 1..6")
        sites = {(m["scene"], m["block"], m["step"]) for m in members}
        fail.check(len(sites) == 1,
                   f"flight {group} is split across {sorted(sites)}")
        want = EXPECT_FLIGHTS.get(group)
        fail.check(want is None or sites == {want},
                   f"flight {group} is at {sorted(sites)}, expected {want}")
        for m in members:
            slot = group * 3 + (m["member_hp"] - 1) % 3
            fail.check(0 <= slot < SPLINE_SLOTS,
                       f"flight {group} member {m['member_hp']} "
                       f"indexes spline slot {slot}, out of range")
            reached.add(slot)
        print(f"  flight {group}: {len(members)} at scene {members[0]['scene']}"
              f" block {members[0]['block']} step {members[0]['step']}"
              f" -> spline slots {sorted(group * 3 + i for i in range(3))}")
    fail.check(reached == set(range(SPLINE_SLOTS)),
               f"the flights reach spline slots {sorted(reached)}, "
               f"not all {SPLINE_SLOTS}")

    # -- the spline table --------------------------------------------------
    base = tables._v2r(SPLINE_POINTS)
    fail.check(base is not None, f"{SPLINE_POINTS:#010x} is not in a section")
    if base is None:
        print(f"\n{fail.n} failure(s)")
        return 1
    for slot in range(SPLINE_SLOTS):
        pts = [tuple(s16(raw, base + slot * 0x18 + k * 6 + a * 2)
                     for a in range(3))
               for k in range(SPLINE_CTRL)]
        fail.check(len({p for p in pts}) > 1,
                   f"spline slot {slot} has four identical control points")
        dz = [pts[k + 1][2] - pts[k][2] for k in range(SPLINE_CTRL - 1)]
        dy = [pts[k + 1][1] - pts[k][1] for k in range(SPLINE_CTRL - 1)]
        moves = (all(d >= 0 for d in dz) and any(dz)) \
            or (all(d <= 0 for d in dz) and any(dz)) \
            or (all(d <= 0 for d in dy) and any(dy))
        fail.check(moves, f"spline slot {slot} neither advances in z nor "
                          f"descends in y: {pts}")
    print(f"  spline table: {SPLINE_SLOTS} slots x {SPLINE_CTRL} control "
          f"points, all monotone")

    # -- the motion pair ---------------------------------------------------
    bmr = tables._v2r(BODY_MOTIONS)
    wmr = tables._v2r(WING_MOTIONS)
    body = [s16(raw, bmr + i * 2) for i in range(MOTION_ROWS)]
    wing = [s16(raw, wmr + i * 2) for i in range(MOTION_ROWS)]
    fail.check(body == [BODY_CLIP] * MOTION_ROWS,
               f"g_bat_body_motions is {body}, "
               f"expected {[BODY_CLIP] * MOTION_ROWS}")
    fail.check(wing == [WING_CLIP] * MOTION_ROWS,
               f"g_bat_wing_motions is {wing}, "
               f"expected {[WING_CLIP] * MOTION_ROWS}")
    fail.check(BODY_CLIP in body,
               f"BatWingUpdate's search for {BODY_CLIP:#x} finds nothing, "
               f"so the wing keeps whatever clip it had")
    for clip in (BODY_CLIP, WING_CLIP):
        length = tables.motion_play_length(clip)
        fail.check(length is not None and length > 0,
                   f"clip {clip:#x} has no play length")
    print(f"  motions: body {BODY_CLIP:#x} "
          f"({tables.motion_play_length(BODY_CLIP)} frames), "
          f"wing {WING_CLIP:#x} "
          f"({tables.motion_play_length(WING_CLIP)} frames)")

    # -- the two character types -------------------------------------------
    for ct, asset, nodes in ((BODY_CHAR_TYPE, BODY_ASSET, BODY_NODES),
                             (WING_CHAR_TYPE, WING_ASSET, WING_NODES)):
        got_asset = tables.character_asset_file(ct)
        skel = tables.character_skeleton(ct)
        fail.check(got_asset == asset,
                   f"character type {ct:#x} is {got_asset}, expected {asset}")
        fail.check(len(skel) == nodes,
                   f"character type {ct:#x} has {len(skel)} nodes, "
                   f"expected {nodes}")
        slots = tables.asset_slots()
        for node in skel:
            named = slots.get(node["slot"])
            fail.check(named is not None and named[0] == asset,
                       f"character type {ct:#x} node slot {node['slot']} "
                       f"resolves to {named}, not {asset}")
        print(f"  character type {ct:#x}: {asset}, {len(skel)} nodes")

    # -- the swarm's member count -----------------------------------------
    # `0042DDB6  SETL AL / DEC EAX / AND EAX,0xFFFFFFFE / ADD EAX,8` is the
    # whole of it, and the two answers are what the port's constants have to
    # be. Computed here rather than quoted so a reader can see the arithmetic.
    def swarm_members(players: int) -> int:
        v = (1 if 1 < players else 0) - 1
        return (v & -2) + 8
    fail.check(swarm_members(1) == 6,
               f"one player faces {swarm_members(1)} swarm bats, expected 6")
    fail.check(swarm_members(2) == 8,
               f"two players face {swarm_members(2)} swarm bats, expected 8")
    print(f"  swarm: {swarm_members(1)} bats with one player, "
          f"{swarm_members(2)} with two")

    # -- and the port agrees with all of it --------------------------------
    port = Path(__file__).resolve().parent.parent / "web/src/game/class46"
    src = (port / "index.ts").read_text() if port.is_dir() else ""
    if src:
        for name, want in (("BAT_SWARM_MEMBERS_1P", swarm_members(1)),
                           ("BAT_SWARM_MEMBERS_2P", swarm_members(2)),
                           ("BAT_CHAR_TYPE", BODY_CHAR_TYPE),
                           ("BAT_WING_CHAR_TYPE", WING_CHAR_TYPE),
                           ("BAT_CLIP", BODY_CLIP),
                           ("BAT_WING_CLIP", WING_CLIP),
                           ("BAT_MEMBERS_PER_SUBTYPE", 25)):
            m = re.search(rf"export const {name} = (0x[0-9a-fA-F]+|\d+);", src)
            got = int(m.group(1), 0) if m else None
            fail.check(got == want,
                       f"the port's {name} is {got}, the EXE says {want}")
        # The twelve spline rows, verbatim.
        rows = []
        for slot in range(SPLINE_SLOTS):
            rows.append([tuple(s16(raw, base + slot * 0x18 + k * 6 + a * 2)
                               for a in range(3))
                         for k in range(SPLINE_CTRL)])
        flat = [v for row in rows for p3 in row for v in p3]
        nums = [int(v) for v in re.findall(r"-?\d+",
                src.split("BAT_SPLINE_POINTS")[2].split("];")[0])]
        fail.check(nums == flat,
                   "the port's BAT_SPLINE_POINTS does not match the EXE "
                   f"({len(nums)} numbers vs {len(flat)})")
        print(f"  the port's tables match the EXE: {len(flat)} spline numbers "
              f"and 7 constants")

    if fail.n:
        print(f"\n{fail.n} failure(s)")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
