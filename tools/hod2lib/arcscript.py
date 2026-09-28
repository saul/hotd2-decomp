"""Three-stage arc motion scripts: the twelve dwords an actor leaps on.

`InstallArcMotionScript` (`FUN_0044DA60`) copies twelve dwords into the
actor's slot and `ActorArcStep` plays them as a windup, a flight and a
landing -- nearly always one clip cut three ways. Class 0x31 names them from its attack tables and class
0x30 from one state, so the reader sits here rather than in either -- which is
also what keeps `combat` and `class31` from importing each other.
"""

from __future__ import annotations

import struct


#: A three-stage arc motion script, the 12 dwords `InstallArcMotionScript`
#: (`FUN_0044DA60`) copies into the actor's slot: ``{s32 motion, s32 start
#: frame, s32 fade, s32 threshold} x 3``. `ActorArcStep` plays stage 0 at the
#: start of the arc, stage 1 once the clip frame reaches stage 0's threshold,
#: stage 2 once it reaches stage 1's, and reports the arc over once it reaches
#: stage 2's. Some installable scripts switch clips from one stage to the
#: next, so a stage's clip is its own (`verify_combat.py` check 16 counts
#: them).
ARC_SCRIPT_STAGES = 3

#: The arc scripts that are named by a state rather than by an attack entry.
#: `ThrowerStateLeapAside` picks between the first four,
#: `ThrowerStateLeapToSurface` uses one per state id, `ThrowerStateLeapToPoint`
#: the three `drop`s and `ThrowerStatePathFollow` the three `path_style`s.
CLASS31_ARC_SCRIPTS = {
    "aside": 0x00564AC8,             # every character but 0x16 and 0x18
    "aside_attack3": 0x00564AF8,     # ...unless obj+0x131A is 3
    "aside_zsass": 0x005649A8,       # character type 0x16
    "aside_zslman": 0x00564D08,      # character type 0x18: see the stride below
    "wall_left": 0x00564A68,         # state 14
    "wall_right": 0x00564A38,        # state 15
    "ceiling": 0x00564A98,           # state 16
    # `ThrowerStateLeapToPoint`'s three, and the reason a `zstin` comes
    # through a window without a leg moving today. The state picks
    # `drop_zskamere` for character type 0x17 and flips a coin between the
    # other two, which are BYTE FOR BYTE the same twelve dwords -- motion 300
    # cut at 50..55, 56..63 and 64..98. The draw is still taken, because a
    # `rand()` the port skips shifts the shared stream for everything after it.
    "drop": 0x00564918,
    "drop_alt": 0x00564948,
    # `g_class31_arc_path_c17` as well: `ThrowerStatePathFollow` pushes the
    # same address for character type 0x17 (`PUSH 0x565e28` at `0x0044EED2`),
    # so one key serves both states.
    "drop_zskamere": 0x00565E28,
    # `ThrowerStatePathFollow`'s three, one per waypoint style word -- the
    # `s16` at waypoint `+0x02`: 1 takes `0x00565E58`, 2 `0x00565E88`, and
    # anything else `0x00565EB8` (`0x0044EE80`..`0x0044EEA4`). The route over
    # stage 2's rooftops is all but its first leg on style 1, which is motion
    # 301 held on frame 12 for all three stages.
    "path_style0": 0x00565EB8,
    "path_style1": 0x00565E58,
    "path_style2": 0x00565E88,
}

#: `ZombieStateArcScriptedEntrance`'s two arc motion scripts, in the same
#: twelve-dword shape as class 0x31's. The state picks by character type, not
#: by anything in the descriptor: type 0 takes the first and every other type
#: the second.
CLASS30_ARC_SCRIPTS = {
    "entrance_type0": 0x00567898,
    "entrance_other": 0x00567958,
}

#: One arc motion script's twelve dwords.
CLASS31_ARC_SCRIPT_BYTES = ARC_SCRIPT_STAGES * 4 * 4

#: `ThrowerStateLeapAside`'s character-0x18 scripts, one per surface row, sit
#: **0x60 apart, not 0x30**: the listing names 0x00564D08 for row 0 and the
#: default (`MOV ESI` at 0x0044BAB1), 0x00564D68 for row 1 (0x0044BAD0),
#: 0x00564DC8 for row 2 (0x0044BAC4) and 0x00564E28 for row 3 (0x0044BAB8).
#: Between each pair lies one of zslman's pounce scripts -- the ones
#: `g_class31_melee_attacks` set 3 names for attack 3 -- and reading at a
#: script's own width gave rows 1 to 3 a pounce and its neighbour's leap.
#: `verify_combat.py` check 16 reads the four immediates.
CLASS31_ASIDE_ZSLMAN_STRIDE = 0x60

#: Where `ThrowerStateLeapAside` names each of those four, row by row: the
#: address of the imm32 in each `MOV ESI, imm32` (`BE xx xx xx xx`).
CLASS31_ASIDE_ZSLMAN_IMM = (0x0044BAB2, 0x0044BAD1, 0x0044BAC5, 0x0044BAB9)


def arc_script(tables, addr: int) -> list[dict] | None:
    """The 12 dwords at *addr* as three ``{motion, start, fade, until}`` stages."""
    o = tables._v2r(addr) if addr else None
    if o is None or o + CLASS31_ARC_SCRIPT_BYTES > len(tables.data):
        return None
    v = struct.unpack_from("<12i", tables.data, o)
    out = [{"motion": v[i * 4], "start": v[i * 4 + 1],
            "fade": v[i * 4 + 2], "until": v[i * 4 + 3]}
           for i in range(ARC_SCRIPT_STAGES)]
    return out if out[0]["motion"] > 0 else None
