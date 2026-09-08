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


#: `g_class20_idle_motions` -- 0x005647A4. The four clips
#: `OneHitTargetInit` (`FUN_00448ED0`) picks between with `rand() & 3` when the
#: spawn's tail names none. Read out of `.rdata`: `fd030000 ff030000 00040000
#: 01040000`. All four are ids character type 7 (`char_adv00.bin`) carries,
#: which is the corroboration that they are motion ids at all.
CLASS20_IDLE_MOTIONS: tuple[int, ...] = (1021, 1023, 1024, 1025)

#: The clip `OneHitTargetUpdate` (`FUN_00449020`) cues the frame the actor is
#: shot -- `ActorSetMotionBlended(obj+0x194, 0x3DC, 0, 5)` -- and
#: `OneHitTargetPlayDeathClip` then holds on its last frame.
CLASS20_DEATH_MOTION: int = 988

#: How each class chooses the motion it starts in, from its handler.
#:
#: ``("table", base, stride, at, kind)`` reads the spawn's parameter tail at
#: *at* as *kind* to get a variant, then takes the ``u16`` at
#: ``base + variant * stride``. ``("literal", id)`` is a constant,
#: ``("param", at, kind)`` is read straight from the tail,
#: ``("param_or", at, kind, default)`` is the same for a field whose **zero is
#: a value and not an absence** -- class 0x20's, where it means "pick one of
#: four at random" -- and ``("block", ptr_at, field)`` follows a pointer in the
#: tail to a command block and reads a ``s16`` from it.
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
#: Every clip class 0x19's twenty-four states name as a literal, read out of
#: `g_class19_states`' routines: 0x65 and 0x7A/0x7B are the three strikes,
#: 0x69 the death, 0x6B the fighting idle, 0x6C..0x6E the walks, 0x6F and 0x73
#: the two flinches, 0x70 the charge, 0x71 the knock-down, 0x72 the rise, 0x74
#: and 0x75 the landing pair, 0x76 the look, 0x78 the stand, and 0x7C/0x7D the
#: entrance and the roar.
#:
#: They are baked because **an unbaked clip is an actor that waits for ever**:
#: half of this class's states leave on
#: `obj+0x19C == g_motion_play_length[obj+0x1B4] - 1`, and with no clip that
#: length is 0 and the cursor never reaches it. `Boss4StateDeath` writes
#: `g_script_flags[32]` on frame 0x46 of clip 0x69, so without 0x69 in the
#: bundle the gate behind the stage-4 boss cannot open at all.
BOSS4_CLIPS: tuple[int, ...] = (
    0x65, 0x69, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F, 0x70, 0x71, 0x72,
    0x73, 0x74, 0x75, 0x76, 0x78, 0x7A, 0x7B, 0x7C, 0x7D,
)


MOTION_RULES: dict[int, tuple] = {
    # `Boss4Init` (`FUN_004917E0`) seats the clip as a literal:
    # `MOV dword ptr [ECX + 0x20], 0x7C` at `0x0049183E`, where `ECX` is
    # `obj+0x194` and `+0x20` is `obj+0x1B4`. Clip 124 is in motion bank 7,
    # which is `boss4.bin`'s. Without this rule the four class-0x19 spawns
    # resolve to a character with no motion and the exporter emits them as
    # markers, so the boss is placed and never built.
    0x19: ("literal", 0x7C),
    # `SetPiecePropInit` (`FUN_00482CE0`) reads the motion straight out of the
    # parameter tail -- `obj+0x1B4 = (s16)tail+0x0A` -- with no variant table in
    # between. Without this rule the 48 set-piece props resolve to a character
    # with no motion, and the client skips anything it cannot pose.
    0x24: ("param", 0x0A, "i16"),
    # `OneHitTargetInit` (`FUN_00448ED0`) reads `obj+0x1B4 = (s16)tail+0x06`,
    # and **zero there means it draws one of four at random**:
    # `if (tail+6 == 0) obj+0x1B4 = g_class20_idle_motions[rand() & 3]`. The
    # exporter cannot make that draw -- it is the port's, from `ctx.rng`, or
    # the save state would not restore -- so the rule names the first of the
    # four as the clip the placement is posed in and
    # :data:`CLASS20_IDLE_MOTIONS` gets all four baked. The authored value
    # travels separately, in the placement's `class20` block.
    0x20: ("param_or", 0x06, "i16", CLASS20_IDLE_MOTIONS[0]),
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
    # `Class14Init` (`FUN_00475E90`) writes `state->animSlot = 0xB` and then
    # `char->motion = *(s16 *)g_class14_anim_slots[0xB]`, which is 33. Without
    # a rule here the stage-2 boss resolves to a character with no motion and
    # no skeleton is built for it at all -- stage 5, whose only class-0x14
    # spawn is its own, had no character type 71 in its bundle.
    0x14: ("literal", 33),
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


#: A class-0x25 command is eight bytes, or sixteen when it carries a point.
#: `ScriptedHumanoidUpdate` (`FUN_004842A0`) advances the cursor by `+2` dwords
#: for every opcode but 7, 8 and `4` in mode 4, which take `+4`.
def humanoid_cmd_len(op: int, mode: int) -> int:
    if op == 8 or op == 7:
        return 16
    if op == 4 and mode == 4:
        return 16
    return 8


def humanoid_block_offset(evt, spawn_rec) -> int | None:
    """The file offset of a class-0x25 spawn's command block, or ``None``.

    `ScriptedHumanoidInit` (`FUN_004840D0`) reads a pointer out of the
    parameter tail at ``+0x0C``; the block's header is four ``s16`` and the
    commands start at ``+0x08``.
    """
    if evt is None:
        return None
    raw = evt.raw
    tail = spawn_rec.offset + 0x24
    if tail + 0x10 > len(raw):
        return None
    blk = evt.to_offset(struct.unpack_from("<I", raw, tail + 0x0C)[0])
    if blk is None or blk + 8 > len(raw):
        return None
    return blk


#: The ``op 10`` modes that are a **test**, rather than the marker that ends
#: one. `ScriptedHumanoidUpdate` (`FUN_004842A0`) at ``0x0048478C`` compares
#: the mode against 0, 1 and 2 and falls straight through for anything else --
#: ``SUB EAX,EBX; JZ; DEC EAX; JZ; DEC EAX; JNZ <next command>`` (``2bc3``,
#: ``746a``, ``48``, ``7437``, ``48``, ``0f85b4fbffff``). Mode ``-2`` is
#: therefore not a fourth comparison: it is the ``endif`` marker the skip below
#: scans for, and running one costs a cursor step and nothing else.
HUMANOID_IF_MODES = frozenset((0, 1, 2))


def humanoid_skip_target(raw, off: int) -> int | None:
    """Where ``op 10`` resumes when ``g_active_player`` does not match.

    `ScriptedHumanoidUpdate` (`FUN_004842A0`) walks **eight bytes at a time**
    from the command after the ``op 10`` until it reads ``-2`` where a mode
    goes, and carries on after that one: ``MOV CX, word ptr [ESI + 0x2]; ADD
    ESI, 0x8; CMP CX, -0x2`` (``668b4e02``, ``83c608``, ``6683f9fe``) at
    ``0x004847B6``, then the same three instructions in a loop at
    ``0x004847C7``.

    The stride is a literal 8 and **not** :func:`humanoid_cmd_len`: a 16-byte
    command inside a skipped arm would be read by the engine as two 8-byte
    ones. That is the engine's own arithmetic and it is transcribed rather than
    corrected -- ``tools/verify_scripted_clips.py`` checks that every target it
    lands on is a real command boundary in the shipped scripts.

    Returns ``None`` only if the scan runs off the end of the file, which no
    shipped program does.
    """
    p = off + 8
    while p + 8 <= len(raw):
        mode = struct.unpack_from("<h", raw, p + 2)[0]
        p += 8
        if mode == -2:
            return p
    return None


def humanoid_command_offsets(evt, spawn_rec) -> list[int]:
    """Every command offset the block reaches, sorted, jumps followed.

    One walk, shared by the two things that need it: `bundle` emits the
    commands and `characters` bakes the clips they name. It was two, and the
    second one did not exist -- which is the whole of B13. `op 2` and `op 3`
    name a motion the actor plays for the rest of its program, and nothing
    added those to the bake list, so 118 of the 263 (program, clip) pairs the
    six stages carry had no frames at all. An unbaked clip is not a cosmetic
    gap here: `MotionPlayLength` is 0, so `op 1` mode 2 -- *hold when the clip
    reaches its last frame* -- can never fire and the VM parks on it for ever
    with the skeleton stuck on whatever pose it last had.

    **``op 10`` has two successors and only one of them is the next command.**
    It is the engine's ``if (g_active_player == mode)``, and the arm it skips
    to is reached by no other edge -- so a walk that only fell through stopped
    at the ``op 18`` inside the *first* arm and emitted a four-command program
    whose every path ended in `ActorKill`. Stage 3's block 2 places the two
    player characters that way.
    """
    blk = humanoid_block_offset(evt, spawn_rec)
    if blk is None:
        return []
    raw = evt.raw
    order: list[int] = []
    seen: set[int] = set()
    pending = [blk + 8]
    while pending:
        p = pending.pop(0)
        while p not in seen and p + 8 <= len(raw):
            seen.add(p)
            order.append(p)
            op, mode, _a, _b = struct.unpack_from("<4h", raw, p)
            if op in (18, -1):
                break
            if op == 15:
                t = evt.to_offset(struct.unpack_from("<I", raw, p + 4)[0])
                if t is not None:
                    pending.append(t)
                break
            if op == 10 and mode in HUMANOID_IF_MODES:
                t = humanoid_skip_target(raw, p)
                if t is not None:
                    pending.append(t)
            p += humanoid_cmd_len(op, mode)
    order.sort()
    return order


def humanoid_motion_ids(evt, spawn_rec) -> list[int]:
    """Every clip a class-0x25 program can put on the actor.

    The block header's ``+0x04`` -- which :func:`motion_for` already returns --
    plus every `op 2` and `op 3` operand. Both opcodes write ``obj+0x1B4``
    through `ActorSetMotion` / `ActorSetMotionBlended`, and the actor plays
    that clip until the next one; there is no third way for the VM to change
    it.
    """
    out: list[int] = []
    blk = humanoid_block_offset(evt, spawn_rec)
    if blk is None:
        return out
    raw = evt.raw
    hdr = struct.unpack_from("<4h", raw, blk)
    if hdr[2] > 0:
        out.append(hdr[2])
    for off in humanoid_command_offsets(evt, spawn_rec):
        op, _mode, a, _b = struct.unpack_from("<4h", raw, off)
        if op in (2, 3) and a > 0:
            out.append(a)
    return out


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
    if rule[0] == "param_or":
        # A tail field whose **zero is a real value** rather than an absence --
        # class 0x20's, where it means "draw one of four at random". The
        # default keeps the placement posable; the port makes the draw.
        _, at, kind, default = rule
        mid = spawn_rec.param(at, kind)
        return default if mid is None or mid <= 0 else mid
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
