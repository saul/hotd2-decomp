"""Class 0x31's four behaviour sets.

Everything here is indexed by ``obj+0x130C``, which `EnemyThrowerInit` takes
straight from the descriptor tail's byte +1 -- **not** by the body condition
that indexes class 0x30's equivalents in `combat`. That is why the two classes
have separate tables at separate addresses and why this is a separate module.
"""

from __future__ import annotations

import struct

from .arcscript import (CLASS31_ARC_SCRIPTS, CLASS31_ARC_SCRIPT_BYTES,
                        arc_script)
from .combat import (ATTACK_ENTRY, ATTACK_PICK_PER_ZONE, ATTACK_ZONE_COMBOS,
                     REACT_GROUPS, THROW_TABLE)


#: Class 0x31's own tables, four **behaviour sets** deep.
#:
#: Every one of these is indexed by ``obj+0x130C``, which `EnemyThrowerInit`
#: takes straight from the descriptor tail's byte +1 -- **not** by the body
#: condition (`ActorBodyConditionFromHands` has exactly one caller, and it is
#: class 0x30's state 2). Stage 2 gives the `zstin` spawns set 0 and the
#: `zsass` spawns set 1, and the motion sets identify the other two: set 2's
#: first entry is 0x1BA, the motion `EnemyThrowerInit` starts character type
#: 0x17 in, and set 3's clips are the 0x208 family that `ThrowerStateThrow`
#: and `ThrowerStateWaitForPermit` reach for when the character is 0x18.
#:
#: ==== ============== =============================================
#: set  character      how it fights
#: ==== ============== =============================================
#: 0    `zstin`        leaps at walls and the ceiling, then pounces
#: 1    `zsass`        throws
#: 2    `zskamere`     [open]
#: 3    `zslman`       [open]
#: ==== ============== =============================================
CLASS31_SETS = 4

#: ``PTR_DAT_005929F0[set]`` -> six motion ids:
#:
#: ===== ======================================================
#: index what reads it
#: ===== ======================================================
#: 0, 1  the stand `ThrowerStateWaitForPermit` picks between at
#:       random, and index 1 is also the pause
#:       `ThrowerStateStrikeOnTheSpot` plays between strikes
#: 2, 3  the walk/idle `ThrowerStateStandAndDecide` and
#:       `ThrowerStateWalkDistance` play, picked by
#:       ``obj+0x34`` bit 27
#: 4     the landing clip `ThrowerStateLeapAside` and
#:       `ThrowerStateWithdraw` play
#: 5     `[open]` -- no reader found
#: ===== ======================================================
CLASS31_MOTION_SETS = 0x005929F0

CLASS31_MOTION_SET_LEN = 6

#: ``PTR_PTR_00592A10[set]`` -> 0x10-byte attack entries, indexed
#: ``obj+0x131A + stance * 4``. `ThrowerStrikeConnect` reads the last three
#: fields and `ThrowerLoadAttackArcScript` the first:
#:
#: ===== ==== ====================================================
#: +0x00 u32  pointer to the three-stage arc motion script
#: +0x04 s32  frame of that clip on which the hit lands, or -1 for
#:            "when the arc reaches its landing phase"
#: +0x08 s32  the reaction the *player* plays when hit
#: +0x0C u32  cancel mask -- if every zone named here is destroyed
#:            the strike whiffs
#: ===== ==== ====================================================
CLASS31_ATTACK_TABLE = 0x00592A10

#: The stance rows: ``bit6 + 2*(bit7 + 2*bit17) + 3*bit8`` of ``obj+0x136C``,
#: so 0 the ground, 1 one wall, 2 the other, 3 the ceiling, and 4 the same
#: four again while a leap is in progress (bit 17). The rows are **not all the
#: same length** -- set 0 and set 3 carry five stances, sets 1 and 2 share a
#: single one -- and they sit end to end with no count, so the reader bounds
#: each row by the start of the next thing in the block. Reading a fixed eight
#: walks into the neighbour, which is the adjacent-array trap.
CLASS31_STANCES = 8

CLASS31_ATTACKS_PER_STANCE = 4

#: ``PTR_DAT_00592A20[set][(rand()>>4) % 10 + (obj+0x1318 & 7) * 10]`` -- which
#: attack index to use, by destroyed zones. The same shape as class 0x30's
#: :data:`ATTACK_PICK_TABLE`, read a byte at a time out of an int array.
CLASS31_ATTACK_PICKS = 0x00592A20

#: The same address as :data:`THROW_TABLE`, under the name the *melee* reader
#: uses. `ThrowerStateCloseAndStrike` (class 0x31 state 24) indexes it by
#: ``obj+0x131A`` and reads all four fields; `ThrowerStateThrow` reads entries 0
#: and 1 as the right and left hand. Eight entries a row.
CLASS31_THROW_TABLE = THROW_TABLE

CLASS31_THROW_ENTRIES = 8

#: ``PTR_PTR_00592A60[set]`` -> three band pointers, each to 80 ints laid out
#: ``[destroyed zones 0..7][10]``. `ThrowerPickNextState` draws a **state id**
#: out of it and offers it to `ThrowerTryEnterState`. Band 0 is never reached:
#: the router only ever produces band 1 (40 < d <= 50) or band 2.
CLASS31_STATE_PICKS = 0x00592A60

CLASS31_BANDS = 3

CLASS31_PICKS = ATTACK_PICK_PER_ZONE * ATTACK_ZONE_COMBOS

#: ``PTR_DAT_00592A70[set][g_react_group[bone]]`` -- the stumble, eight groups.
CLASS31_REACTIONS = 0x00592A70

#: The pose frame a class-0x31 corpse freezes on, keyed by the clip it died in.
#: `ThrowerStateCorpseSink` and `ThrowerStateCorpseBlink` pick between the two
#: entries with ``rand() % 17 >> 4``, so the second comes up once in seventeen.
#:
#: The general table at `g_class31_corpse_frames` (0x00592A80) covers motions
#: 0x3D9..0x3E0, and **class 0x31 never plays one of those** -- every use of it
#: reads outside the array. Only these four special cases are real, so only
#: these are exported and the port keeps the current frame otherwise.
CLASS31_CORPSE_FRAMES = {
    0x11E: 0x00592AD8,      # character 0x16's death clip
    0x11D: 0x00592AD0,      # ...0x18's and 0x19's
    0x1BC: 0x00592AC8,      # ...0x17's
    0x3A6: 0x00592AC0,      # the airborne clip of sets 0 and 3
}

#: The motion ids class 0x31's states name as **literals** rather than through
#: a table, so nothing collects them from the data. Every one is read out of the
#: routine beside it; `bake` refuses a clip that belongs to another skeleton,
#: so the whole list is offered to every class-0x31 character rather than
#: filtered here.
#:
#: Leaving these out is not a subtle failure: a `zstin` that leaps onto a wall
#: has no idle for the stance it arrives in, so `ThrowerSetMotionIfIdle`
#: refuses the clip and it holds whatever it was playing.
CLASS31_LITERAL_MOTIONS = {
    # `ThrowerStateStandAndDecide` (state 7): the idle per stance, and
    # character type 0x18's own three.
    0x138, 0x137, 0x131, 0x20F, 0x20C, 0x212,
    # `ThrowerStateWaitForPermit` (state 8), the same shape plus its default.
    0x129, 0x124, 0x134, 0x127, 0x208, 0x1FD, 0x1F3, 0x205,
    # `ThrowerStateLeapAside` (state 10), character 0x18's four.
    0x211, 0x20E, 0x214, 0x20B,
    # `ThrowerStateFallToSurface` (state 11): the fall and the two landings.
    # Each is a pair `(-(char != 0x17) & delta) + base`, so 0x3A5/0x3A9 for
    # every type but 0x17 and 0x1BC/0x1BA for that one -- and 0x1BC and 0x1BA
    # are bank 20, `zskamere`'s own, so `bake` rightly refuses them elsewhere.
    0x1BC, 0x3A5, 0x1BA, 0x3A9,
    # State 3, the death clip, per character type.
    0x11E, 0x11D,
    # `ThrowerStateStrikeOnTheSpot` (state 32).
    0x1B8,
    # `ThrowerStateGrabPlayer` (state 27): the ride, the two grabs, the finish.
    0x1E9, 0x1E5, 0x1E7, 0x1E8,
    # `ThrowerStateKnockedTumbling` (state 33): the tumble and the get-up.
    0x215, 0x1FE, 0x1F4, 0x206, 0x216, 0x1FF, 0x1F5, 0x207,
    # `ThrowerStateThrow`'s character-0x18 branch.
    0x1F7, 0x1F6, 0x1FC, 0x1FB, 0x1F2, 0x1F1, 0x204, 0x203,
}


def _next_block(tables, base: int, count: int, after: int,
                this: int) -> int:
    """Where the row at *this* ends: the next row's start, or *after*'s first.

    The rows of these tables are packed end to end with no count, so a fixed
    length reads the neighbour's entries as if they were this row's -- which
    is exactly the adjacent-array trap. Bounding by the next start recovers
    set 0's five stances and sets 1 and 2's single one.
    """
    ends = set()
    for k in range(count):
        v = _ptr_row(tables, base, k)
        if v and v > this:
            ends.add(v)
        v = _ptr_row(tables, after, k)
        if v and v > this:
            ends.add(v)
    return min(ends) if ends else this


def _ptr_row(tables, base: int, i: int) -> int | None:
    o = tables._v2r(base)
    if o is None or o + (i + 1) * 4 > len(tables.data):
        return None
    return struct.unpack_from("<I", tables.data, o + i * 4)[0]


def class31_tables(tables) -> dict:
    """Class 0x31's four behaviour sets -- see :data:`CLASS31_SETS`.

    Everything here is read from the routine that consumes it, and the routine
    is named in each constant's own comment. The arc scripts are resolved and
    inlined rather than left as addresses, because the client has no way to
    dereference one.
    """
    if tables is None:
        return {}
    sets = []
    for i in range(CLASS31_SETS):
        row: dict = {"set": i}
        o = tables._v2r(_ptr_row(tables, CLASS31_MOTION_SETS, i) or 0)
        row["motions"] = (
            list(struct.unpack_from(f"<{CLASS31_MOTION_SET_LEN}i",
                                    tables.data, o)) if o is not None else [])
        # The attack entries, flattened to [stance][index] with the arc script
        # resolved in place. An entry whose script pointer is null is a hole --
        # the pick table never names it.
        ptr_row = _ptr_row(tables, CLASS31_ATTACK_TABLE, i) or 0
        o = tables._v2r(ptr_row)
        attacks: dict[str, dict[str, dict]] = {}
        if o is not None:
            n = min(CLASS31_STANCES * CLASS31_ATTACKS_PER_STANCE,
                    (_next_block(tables, CLASS31_ATTACK_TABLE, CLASS31_SETS,
                                 CLASS31_ATTACK_PICKS, ptr_row) - ptr_row)
                    // ATTACK_ENTRY)
            if n > 0 and o + n * ATTACK_ENTRY <= len(tables.data):
                for k in range(n):
                    ptr, hit, hurt, mask = struct.unpack_from(
                        "<IiiI", tables.data, o + k * ATTACK_ENTRY)
                    script = arc_script(tables, ptr)
                    if script is None:
                        continue
                    stance, idx = divmod(k, CLASS31_ATTACKS_PER_STANCE)
                    attacks.setdefault(str(stance), {})[str(idx)] = {
                        "script": script, "hit_frame": hit,
                        "player_motion": hurt, "cancel_mask": mask & 0xFFFF}
        row["attacks"] = attacks
        # `g_class31_throws` in the raw, per set. `throw_tables` reads the same
        # two rows for the projectile, keyed by the hand; `ThrowerStateCloseAndStrike`
        # reads them as a **melee** attack -- strike clip, approach clip, the
        # distance it closes to, and the frame the hit lands on.
        ptr_throw = _ptr_row(tables, CLASS31_THROW_TABLE, i) or 0
        o = tables._v2r(ptr_throw)
        strikes: dict[str, dict] = {}
        if o is not None:
            n = min(CLASS31_THROW_ENTRIES,
                    (_next_block(tables, CLASS31_THROW_TABLE, CLASS31_SETS,
                                 CLASS31_ATTACK_TABLE, ptr_throw) - ptr_throw)
                    // ATTACK_ENTRY)
            for k in range(max(0, n)):
                a = o + k * ATTACK_ENTRY
                if a + ATTACK_ENTRY > len(tables.data):
                    break
                strike, lunge = struct.unpack_from("<2h", tables.data, a)
                dist, = struct.unpack_from("<f", tables.data, a + 4)
                hit, hurt, mask = struct.unpack_from("<3h", tables.data, a + 8)
                if strike <= 0:
                    continue
                strikes[str(k)] = {"strike": strike, "lunge": lunge,
                                   "distance": dist, "hit_frame": hit,
                                   "player_motion": hurt,
                                   "cancel_mask": mask & 0xFFFF}
        row["strikes"] = strikes
        o = tables._v2r(_ptr_row(tables, CLASS31_ATTACK_PICKS, i) or 0)
        row["attack_picks"] = (
            list(struct.unpack_from(f"<{CLASS31_PICKS}i", tables.data, o))
            if o is not None and o + CLASS31_PICKS * 4 <= len(tables.data)
            else [])
        # The state picks are a pointer to a pointer: one band pointer each.
        bands: dict[str, list[int]] = {}
        b = tables._v2r(_ptr_row(tables, CLASS31_STATE_PICKS, i) or 0)
        if b is not None:
            for band in range(CLASS31_BANDS):
                ptr, = struct.unpack_from("<I", tables.data, b + band * 4)
                o = tables._v2r(ptr)
                if o is None or o + CLASS31_PICKS * 4 > len(tables.data):
                    continue
                bands[str(band)] = list(struct.unpack_from(
                    f"<{CLASS31_PICKS}i", tables.data, o))
        row["state_picks"] = bands
        o = tables._v2r(_ptr_row(tables, CLASS31_REACTIONS, i) or 0)
        row["reactions"] = (
            list(struct.unpack_from(f"<{REACT_GROUPS}i", tables.data, o))
            if o is not None and o + REACT_GROUPS * 4 <= len(tables.data)
            else [])
        sets.append(row)

    corpse = {}
    for motion, addr in CLASS31_CORPSE_FRAMES.items():
        o = tables._v2r(addr)
        if o is not None and o + 8 <= len(tables.data):
            corpse[str(motion)] = list(struct.unpack_from("<2i", tables.data, o))

    scripts = {k: arc_script(tables, a)
               for k, a in CLASS31_ARC_SCRIPTS.items() if k != "aside_zslman"}
    # Character 0x18's is four scripts, one per surface stance, so it goes in
    # flat rather than nested -- the client indexes it by name.
    for st in range(4):
        scripts[f"aside_zslman_{st}"] = arc_script(
            tables, CLASS31_ARC_SCRIPTS["aside_zslman"]
            + st * CLASS31_ARC_SCRIPT_BYTES)
    return {"sets": sets, "corpse_frames": corpse,
            "scripts": {k: v for k, v in scripts.items() if v},
            "note": (
                "Class 0x31's behaviour, four sets deep, indexed by the "
                "descriptor tail's byte +1 (obj+0x130C). Set 0 is zstin, "
                "which is the wall-crawler.")}


def class31_motion_ids(block: dict) -> list[int]:
    """Every clip the class-0x31 tables can reach, for the bake list."""
    out: list[int] = []
    for row in block.get("sets", []):
        out += [m for m in row.get("motions", []) if 0 < m < 4096]
        out += [m for m in row.get("reactions", []) if 0 < m < 4096]
        for e in row.get("strikes", {}).values():
            out += [e["strike"], e["lunge"]]
        for stance in row.get("attacks", {}).values():
            for e in stance.values():
                out += [st["motion"] for st in e["script"]]
    for script in block.get("scripts", {}).values():
        if script:
            out += [st["motion"] for st in script]
    out += sorted(CLASS31_LITERAL_MOTIONS)
    return sorted({m for m in out if 0 < m < 4096})
