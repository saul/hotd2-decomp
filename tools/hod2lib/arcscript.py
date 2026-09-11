"""Three-stage arc motion scripts: the twelve dwords an actor leaps on.

`InstallArcMotionScript` (`FUN_0044DA60`) copies twelve dwords into the
actor's slot and `ActorArcStep` plays them as one clip cut into windup,
flight and landing. Class 0x31 names them from its attack tables and class
0x30 from one state, so the reader sits here rather than in either -- which is
also what keeps `combat` and `class31` from importing each other.
"""

from __future__ import annotations

import struct


#: A three-stage arc motion script, the 12 dwords `InstallArcMotionScript`
#: (`FUN_0044DA60`) copies into the actor's slot: ``{s32 motion, s32 start
#: frame, s32 fade, s32 threshold} x 3``. `ActorArcStep` plays stage 0 at the
#: start of the arc, stage 1 once the clip frame passes stage 0's threshold,
#: stage 2 once it passes stage 1's, and reports the arc over once it passes
#: stage 2's. Every script in the program names the **same motion** in all
#: three stages, so it is one clip cut into windup / flight / landing.
ARC_SCRIPT_STAGES = 3

#: The arc scripts that are named by a state rather than by an attack entry.
#: `ThrowerStateLeapAside` picks between the first four and
#: `ThrowerStateLeapToSurface` uses one per state id.
CLASS31_ARC_SCRIPTS = {
    "aside": 0x00564AC8,             # every character but 0x16 and 0x18
    "aside_attack3": 0x00564AF8,     # ...unless obj+0x131A is 3
    "aside_zsass": 0x005649A8,       # character type 0x16
    "aside_zslman": 0x00564D08,      # character type 0x18, then +0x60 a stance
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
    "drop_zskamere": 0x00565E28,
}

#: `ZombieStateArcScriptedEntrance`'s two arc motion scripts, in the same
#: twelve-dword shape as class 0x31's. The state picks by character type, not
#: by anything in the descriptor: type 0 takes the first and every other type
#: the second.
CLASS30_ARC_SCRIPTS = {
    "entrance_type0": 0x00567898,
    "entrance_other": 0x00567958,
}

#: `ThrowerStateLeapAside`'s character-0x18 block is one script per stance.
CLASS31_ARC_SCRIPT_BYTES = ARC_SCRIPT_STAGES * 4 * 4


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
