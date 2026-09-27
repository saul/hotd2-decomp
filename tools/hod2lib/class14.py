"""Class 0x14's tables -- the stage-2 boss.

Every one of these is ``.rdata`` that `Class14Update` (``FUN_00476150``) and
the routines under it index directly, so they travel in the bundle
(``characters.class14``) rather than as constants in ``game/class14/``. Each
address is the one the consuming instruction names; see
``docs/re/boss-hierophant.md`` for the reading. ``web/src/hod2lib/class14.ts``
is the same module in TypeScript and is what writes the bundle.
"""

from __future__ import annotations

import struct

#: ``g_class14_anim_slots`` -- 30 pointers into ``g_class14_anim_cues``.
CLASS14_ANIM_SLOTS = 0x00596408
CLASS14_ANIM_SLOT_COUNT = 30
#: ``g_class14_damage_cones`` -- 40 x ``{s16 maxYaw, rotX, minPitch, maxPitch}``.
CLASS14_DAMAGE_CONES = 0x00596480
CLASS14_DAMAGE_CONE_COUNT = 40
#: ``g_class14_window_timing`` -- 8 x ``{s16 openHold, shutHold; f32 openRate, closeRate}``.
CLASS14_WINDOW_TIMING = 0x005965C0
CLASS14_WINDOW_TIMING_COUNT = 8
#: ``g_class14_summon_delays_a`` / ``_b`` -- 16 bytes each, by adaptive rank.
CLASS14_SUMMON_DELAYS_A = 0x00596620
CLASS14_SUMMON_DELAYS_B = 0x00596630
#: ``g_class14_summon_counts`` -- 16 rows of 3 bytes, ``[rank*3 + round]``.
CLASS14_SUMMON_COUNTS = 0x00596640
#: ``g_class14_phase_hp_frac`` -- 10 floats, by phase.
CLASS14_PHASE_HP_FRAC = 0x00596670
#: ``g_class14_bone_damage`` -- 16 rows of 2 signed bytes, ``[rank*2 + players-1]``.
CLASS14_BONE_DAMAGE = 0x00596698
CLASS14_RANKS = 16
CLASS14_PHASES = 10


def _anim_cue(tables, va: int) -> dict | None:
    """One ``g_class14_anim_cues`` record: the motion, then ``{frame, code}``
    pairs until a frame of -1, then the code that holds past the last pair."""
    o = tables._v2r(va)
    if o is None:
        return None
    d = tables.data
    motion = struct.unpack_from("<h", d, o)[0]
    cues: list[list[int]] = []
    p = o + 2
    for _ in range(32):
        if p + 4 > len(d):
            break
        frame, code = struct.unpack_from("<hh", d, p)
        if frame == -1:
            return {"motion": motion, "cues": cues, "end_code": code}
        cues.append([frame, code])
        p += 4
    return None


def class14_tables(tables) -> dict:
    """Class 0x14's ``.rdata``, read where the routines read it.

    Empty when there is no executable -- the client then has no boss tables
    and the boss cannot be damaged, which is what a bundle without them should
    do.
    """
    if tables is None:
        return {}
    d = tables.data

    def at(va: int) -> int:
        o = tables._v2r(va)
        if o is None:
            raise ValueError(f"class14: {va:#x} unmapped")
        return o

    anim_slots = []
    for i in range(CLASS14_ANIM_SLOT_COUNT):
        ptr = tables._u32(CLASS14_ANIM_SLOTS + i * 4) or 0
        anim_slots.append(_anim_cue(tables, ptr))
    o = at(CLASS14_DAMAGE_CONES)
    cones = [list(struct.unpack_from("<4h", d, o + i * 8))
             for i in range(CLASS14_DAMAGE_CONE_COUNT)]
    o = at(CLASS14_WINDOW_TIMING)
    timing = []
    for i in range(CLASS14_WINDOW_TIMING_COUNT):
        oh, sh, orate, crate = struct.unpack_from("<hhff", d, o + i * 12)
        timing.append({"open_hold": oh, "shut_hold": sh,
                       "open_rate": orate, "close_rate": crate})
    c = at(CLASS14_SUMMON_COUNTS)
    counts = [list(d[c + r * 3:c + r * 3 + 3]) for r in range(CLASS14_RANKS)]
    pf = at(CLASS14_PHASE_HP_FRAC)
    frac = list(struct.unpack_from(f"<{CLASS14_PHASES}f", d, pf))
    bd = at(CLASS14_BONE_DAMAGE)
    damage = [list(struct.unpack_from("<2b", d, bd + r * 2))
              for r in range(CLASS14_RANKS)]
    da = at(CLASS14_SUMMON_DELAYS_A)
    db = at(CLASS14_SUMMON_DELAYS_B)
    return {
        "anim_slots": anim_slots,
        "damage_cones": cones,
        "window_timing": timing,
        "summon_delays_a": list(d[da:da + CLASS14_RANKS]),
        "summon_delays_b": list(d[db:db + CLASS14_RANKS]),
        "summon_counts": counts,
        "phase_hp_frac": frac,
        "bone_damage": damage,
    }
