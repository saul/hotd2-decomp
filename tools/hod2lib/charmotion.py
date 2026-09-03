"""Which motion a spawn starts in, and the baked frames of it.

``obj+0x1B4`` is the motion id and a class handler is the only thing that
writes it, so a class earns a rule here the same way it earns a character-type
rule in `spawnres`: by having its handler read. There is deliberately no
fallback -- see the note on :data:`MOTION_RULES` and the module docstring of
`characters`.
"""

from __future__ import annotations

import math
import struct

from . import mot as motlib


#: How each class chooses the motion it starts in, from its handler.
#:
#: ``("table", base, stride, at, kind)`` reads the spawn's parameter tail at
#: *at* as *kind* to get a variant, then takes the ``u16`` at
#: ``base + variant * stride``. ``("literal", id)`` is a constant,
#: ``("param", at, kind)`` is read straight from the tail, and
#: ``("block", ptr_at, field)`` follows a pointer in the tail to a command
#: block and reads a ``s16`` from it.
#:
#: Class ``0x30`` -- the zombie, and the single largest population in the game
#: -- is `FUN_00452DA0`, which opens with the assignment::
#:
#:     if (obj[0x130C] == 4) obj[0x1B4] = 0x41E;   /* 1054, hzom.bin */
#:     else                  obj[0x1B4] = 0x3BC;   /*  956,  zom.bin */
#:
#: Both are real ids in real zombie banks, which is the corroboration. The
#: ``0x41E`` branch tests a field the allocator fills differently per spawn
#: opcode and is **not** taken here: 956 is the common path, and guessing the
#: rarer one wrong would be worse than always taking the default. Every
#: class-0x30 character type is 16-bone, so one motion serves all the skins --
#: which is what a shared `zom.bin` implies anyway.
#:
#: Class ``0x53`` -- the cat -- is `FUN_00431250`::
#:
#:     psVar2 = obj->params;                       /* obj+0x1390 */
#:     obj[0x6d] = *(short *)(0x00589A64 + *psVar2 * 10);   /* obj+0x1B4 */
#:
#: The table is five ``u16`` per variant, ``0xFFFF``-terminated -- a little
#: playlist -- and the handler takes the first. Every id in it falls inside
#: `nya.bin`'s 762..773, which is the corroboration that it is a motion table
#: and not something else with a convenient stride.
#: ``("by_char", {char_type: id}, default)`` is a constant chosen by the
#: character type, which is how `EnemyThrowerInit` does it:
#: ``obj+0x1B4 = (char == 0x17) ? 0x1BA : 0x3A8``. Same shape as
#: `EnemyZombieInit`'s, which is why class 0x30's is a plain literal.
MOTION_RULES: dict[int, tuple] = {
    # `SetPiecePropInit` (`FUN_00482CE0`) reads the motion straight out of the
    # parameter tail -- `obj+0x1B4 = (s16)tail+0x0A` -- with no variant table in
    # between. Without this rule the 48 set-piece props resolve to a character
    # with no motion, and the client skips anything it cannot pose.
    0x24: ("param", 0x0A, "i16"),
    # `ScriptedHumanoidInit` (`FUN_004840D0`) follows a pointer: the tail at
    # `+0x0C` names a command block, and the block's `+0x04` is the motion the
    # actor opens in. 137 of these, and without a rule they resolve to a
    # character the client cannot pose and so does not draw.
    0x25: ("block", 0x0C, 0x04),
    # `CivilianInit` (`FUN_0048A3E0`) writes `model+0x20 = 0x294` -- motion
    # **660**, from `people.bin` -- before it runs a line of script, and the
    # script's op 0x00 takes over from there. Without a rule the 47 civilians
    # resolved to a character with no motion and the client drew none of them,
    # so the whole class was invisible even once it was ported.
    0x10: ("literal", 0x294),
    0x30: ("literal", 0x3BC),
    0x31: ("by_char", {0x17: 0x1BA}, 0x3A8),
    0x53: ("table", 0x00589A64, 10, 0x00, "i16"),
}

#: `mot/` is authored at 30 Hz against the engine's 60 Hz clock -- see the note
#: on `g_motion_play_length` in docs/formats/mot.md, which runs at about twice
#: the frame count. The exact relation is open, so this is stated as the
#: playback rate rather than baked into the frame data.
MOTION_FPS = 30.0

#: Class 0x30's parameter tail also carries a **scripted entrance**.
#:
#: ``FUN_00452DA0`` copies ``params[2]`` to ``obj+0x1310``, which is the index
#: `FUN_004533F0` dispatches through the 54-state table at ``0x00592AE8``. State
#: **21** (`FUN_004577F0`) is a one-shot motion cue::
#:
#:     if (sub == 0) {
#:         PlayMotion(obj+0x194, params[+0x04]);   /* the entrance motion */
#:         obj[0x1330] = params[+0x08];            /* a start delay */
#:         sub++;
#:     }
#:     if (sub <= 1 && --obj[0x1330] > 0) return;  /* hold */
#:     if (obj[0x19C] >= play_length[obj[0x1B4]] - 1) {
#:         obj[0x1310] = params[3];                /* then this state */
#:         if (params[3] == 21) obj[0x1310] = 1;   /* 21 means "walk" */
#:     }
#:
#: The two zombies inside the stage-2 van are exactly this: state 21, motion
#: **923** from `zom.bin`, delays of **0 and 10 frames** so they come out one
#: after the other, then state 1. Motion 923 is a jump: its root translation
#: runs z 0 to -15.7 while y arcs 8.2 to 17.4 and back, which is a body
#: leaving a van and landing. The idle 956 has z = 0 and a flat y throughout.
#:
#: `[open]` whether the delay also freezes the animation. It gates the state
#: *transition* and clears bit 0x4000 of ``obj+0x34`` when it expires, which
#: reads like an animation-paused bit, but that is not established. Holding the
#: first frame for the delay is what reproduces the stagger, and that is what is
#: done here.
MOTION_STATE_CUE = 21

#: More than this and a bake is not worth its bytes; the longest motion in the
#: game is well inside it.
MAX_BAKED_FRAMES = 600


def motion_for(tables, spawn_rec, cls: int) -> int | None:
    """The motion id a class handler starts this spawn in, or None."""
    rule = MOTION_RULES.get(cls)
    if rule is None:
        return None
    if rule[0] == "literal":
        return rule[1]
    if rule[0] == "block":
        _, ptr_at, field = rule
        evt = getattr(spawn_rec, "evt", None)
        if evt is None:
            return None
        raw = evt.raw
        base = spawn_rec.offset + 0x24 + ptr_at
        if base + 4 > len(raw):
            return None
        off = evt.to_offset(struct.unpack_from("<I", raw, base)[0])
        if off is None or off + field + 2 > len(raw):
            return None
        mid = struct.unpack_from("<h", raw, off + field)[0]
        return None if mid <= 0 else mid
    if rule[0] == "param":
        mid = spawn_rec.param(rule[1], rule[2])
        return None if mid is None or mid <= 0 else mid
    if rule[0] == "by_char":
        _, per_char, default = rule
        ct = spawn_rec.param(0x00, "i8")
        return per_char.get(ct, default)
    if rule[0] != "table":
        return None
    _, base, stride, at, kind = rule
    variant = spawn_rec.param(at, kind)
    if variant is None or variant < 0:
        return None
    r = tables._v2r(base + variant * stride)
    if r is None or r + 2 > len(tables.data):
        return None
    mid = struct.unpack_from("<H", tables.data, r)[0]
    return None if mid == 0xFFFF else mid


def intro_for(tables, spawn_rec, cls: int) -> tuple[int, int] | None:
    """A scripted entrance motion and its delay, or None."""
    if cls != 0x30:
        return None
    if spawn_rec.param(2, "i8") != MOTION_STATE_CUE:
        return None
    motion = spawn_rec.param(0x04, "i32")
    delay = spawn_rec.param(0x08, "i32") or 0
    bank = tables.motion_bank_of(motion) if motion and motion > 0 else None
    if bank is None or bank not in tables.motion_banks():
        return None
    return (motion, max(0, delay))


def bake(game_dir, tables, motion_id: int, bone_count: int) -> dict | None:
    """Decode a motion into flat arrays the client can index cheaply."""
    bank_id = tables.motion_bank_of(motion_id)
    banks = tables.motion_banks()
    if bank_id not in banks:
        return None
    fname, ids = banks[bank_id]
    bank = motlib.load_bank(game_dir, fname, ids)
    if bank is None:
        return None
    # A motion belongs to the skeleton its own block size implies. Reading it
    # at any other stride walks into the next motion's data and returns
    # plausible-looking garbage rather than failing -- which is how `kame.bin`
    # motion 441, a 24-bone clip, reached a 16-bone character's bundle as
    # denormals and a NaN. This is the check the old `bone_count == 16` guards
    # were standing in for, stated directly.
    implied = bank.implied_bone_count(motion_id)
    if implied is not None and implied != bone_count:
        return None
    frames = bank.frames(motion_id, bone_count)
    if not frames:
        return None
    frames = frames[:MAX_BAKED_FRAMES]
    root: list[float] = []
    rot: list[int] = []
    for f in frames:
        root.extend(f.root)
        for b in f.bones:
            rot.extend(b)
    # A motion read with the wrong bone count decodes into whatever follows it
    # in the bank, which shows up as denormals and NaN rather than as an error.
    # Motion 441 of `kame.bin` reached the stage-2 bundle that way and made the
    # JSON unparseable. Refuse it here: a motion whose root is not finite was
    # not read correctly, whatever the stride said.
    if not all(math.isfinite(v) for v in root):
        return None
    # `g_motion_play_length[motion]`, and the reason it is carried rather than
    # derived: every cue the scripts express in clip frames is in these units,
    # they run at about twice the authored frames, and the exact value is
    # `2n - 2` or `2n - 3` with no rule that says which.
    play = tables.motion_play_length(motion_id)
    out = {"bank": fname, "frames": len(frames), "fps": MOTION_FPS,
           "root": root, "rot": rot}
    if play is not None and play > 0:
        out["play"] = play
    return out
