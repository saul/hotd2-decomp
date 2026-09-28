#!/usr/bin/env python3
"""Does a clip's root translation move the object, or offset the pose?

`SkeletonApplyRootMotion` (`FUN_00410C50`) answers both halves of that in one
routine, and Ghidra shows neither of them whole (`L37`). It is handed a pointer
to the current frame's three root floats and tests `model+0x64` bit 1 **twice**:

    00410d2f  TEST byte ptr [ECX + 0x64],0x2     ; move the object?
              ... delta = root - baseline, through
              ... T(obj+0x40) Rz Ry Rx(obj+0x6C..0x64) S(model+0x116C),
              ... written back to obj+0x40 / obj+0x48
    00410e5f  MOV EAX,[0x009ca0a0]               ; the arm does NOT return:
    00410e69  MOV [EAX+0x1160],EDX               ;   baseline = root, and
    00410e93  CALL dword ptr [ECX + 0x115c]      ;   fall into the shared tail
              ... T(obj+0x40); the actor's rotation; S(model+0x116C)
    00411005  TEST byte ptr [ECX + 0x64],0x2     ; pose which part of it?
    00411009  JZ   0x00411020
    0041100b  PUSH 0 / [ESI+4] / 0               ;   set -> T(0, root.y, 0)
    00411020  PUSH [ESI+8] / [ESI+4] / [ESI]     ;   clear -> T(root)

So a clip's root translation **either moves the object or offsets the pose,
never both and never neither**, and one bit decides which. The port had only
the first arm -- `render/characters/pose.ts` posed the height and nothing else
whatever the bit said -- and for a clip whose root never changes the delta is
zero, so nothing took the horizontal part at all. Stage 2's rescue target rode
its car 11.943 units out over the bonnet for as long as that lasted.

This checks the reading two ways, both of which can fail:

* **the bytes.** Eight instructions, quoted as hex at their addresses: the two
  gate tests, the fall-through Ghidra hides, the two `MatrixTranslate` argument
  pushes, `ActorBuildSkinnedModel`'s unconditional `model+0x64 = 3`, and
  `RescueTargetInit`'s `AND EDX,0xFFFFFFFD` that takes bit 1 straight back out.
  A different build, or an address off by one, fails here rather than quietly
  agreeing;
* **the population.** The second arm can only move an actor whose clip has a
  non-zero **absolute** horizontal root, so the blast radius of implementing it
  is exactly measurable: decode every motion block in the game and count them.
  992 of 1058 are exactly zero, which is why the missing arm hid so long. Then
  pair every clip the shipped class-0x10 scripts set against the wait word that
  governs it, because class 0x10 is the only thing besides class 0x21 that ever
  clears the bit -- and assert that the set of clips it can play with the gate
  clear **and** a non-zero horizontal root is the small, named list below.

The second half is the part that would have caught this: it names every actor
in the shipped game the fix can move, and there are four.

**And the offset is drawn at the character's size.** Both translates sit
under `MatrixScale(model+0x116C)`, which the draw tail pushes between the
actor's rotation and the pose translate:

    00410fea  MOV EAX,[EDX+0x116C]; PUSH EAX x3  ; model+0x116C
    00410ff7  CALL MatrixScale                   ; before 0x0041100B/0x00411020

and `ActorBuildSkinnedModel` writes that field from the character type alone,
through a jump table this check decodes rather than trusts: types 30 and 31
at 0.6 and 0.7, 32..56 at 0.9, everything else 1.0. So the posed offset the
engine draws is the clip's times the size of whoever plays it, and the check
finds who does -- every class-0x10 spawn in the six stages whose script can
reach a posed clip -- and asserts they are all people at 0.9: **2.593 units
drawn, of the 2.882 authored.** The port drew the 2.882 for as long as it drew
every skinned actor at 1.0. `SkeletonWalkNode`'s radius store, the other place
the size is read as a size, is held too: the bone's hit radius is the table's
times it, at build.

    python3 tools/verify_root_pose.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import evt as evtlib  # noqa: E402
from hod2lib import mot as motlib, stage as stagelib  # noqa: E402
from hod2lib.actorscript import civilian_motion_ids  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

#: The instruction stream, address -> (hex bytes, what it is). Every one of
#: these was read off the disassembly; none came from the pseudocode, which
#: shows the gated arm returning where it in fact falls through.
INSTRUCTIONS = {
    0x00410D2F: ("f6416402",
                 "SkeletonApplyRootMotion's gate: TEST [ECX+0x64],2"),
    0x00410E5F: ("a1a0a09c00",
                 "the gated arm does not return -- MOV EAX,[g_skeleton_model]"),
    0x00410E69: ("899060110000",
                 "...baseline = root: MOV [EAX+0x1160],EDX"),
    0x00410E93: ("ff915c110000",
                 "...and into the shared tail: CALL [ECX+0x115C]"),
    0x00411005: ("f6416402", "the same gate again, for the pose translate"),
    0x00411009: ("7415", "JZ to the whole-root arm"),
    0x0041100B: ("8b5604", "gate SET: MOV EDX,[ESI+4], pushed as (0, y, 0)"),
    0x00411020: ("8b4608", "gate CLEAR: MOV EAX,[ESI+8], the first of (x,y,z)"),
    0x004104C5: ("c7466403000000",
                 "ActorBuildSkinnedModel: MOV [ESI+0x64],3 -- on for everyone"),
    0x00451759: ("83e2fd",
                 "RescueTargetInit: AND EDX,0xFFFFFFFD -- and off for class 0x21"),
    # -- the size both translates are drawn at ------------------------------
    0x00410FEA: ("8b826c110000",
                 "the draw tail: MOV EAX,[EDX+0x116C], the model's size"),
    0x00410FF0: ("505050", "...pushed three times"),
    0x00410FF7: ("e8c48c0900",
                 "...into MatrixScale (0x004A9CC0), before the pose translate"),
    0x00410451: ("0fbf4660",
                 "ActorBuildSkinnedModel: MOVSX EAX,[ESI+0x60], the type"),
    0x00410455: ("83c0e2", "...ADD EAX,-0x1E"),
    0x00410458: ("83f81a", "...CMP EAX,0x1A: types 30..56 take the table"),
    0x0041045B: ("7733", "...and the rest JA to the 1.0 arm"),
    0x00410490: ("c7866c1100000000803f",
                 "the 1.0 arm: MOV [ESI+0x116C],0x3F800000"),
    0x00410837: ("d98100130000",
                 "SkeletonWalkNode: FLD [ECX+0x1300], g_cur_actor's size"),
    0x0041083D: ("d848fc", "...FMUL [EAX-4], the sphere row's radius"),
    0x00410840: ("d95e78", "...FSTP [ESI+0x78], the record's radius"),
}

#: `ActorBuildSkinnedModel`'s switch: the index bytes, one per type from 30,
#: and the jump table they index. Decoded below, not quoted.
SCALE_FIRST_TYPE, SCALE_TYPES = 30, 27
SCALE_INDEX, SCALE_JUMPS = 0x00410568, 0x0041055C

#: What the decode has to come to: `ActorModelScale` in
#: `web/src/game/root_motion.ts`, which transcribes it.
def expected_scale(char_type: int) -> float:
    f = lambda v: struct.unpack("<f", struct.pack("<f", v))[0]  # noqa: E731
    if char_type == 30:
        return f(0.6)
    if char_type == 31:
        return f(0.7)
    if 32 <= char_type <= 56:
        return f(0.9)
    return 1.0


#: The size of every character that can pose `CIVILIAN_POSED_CLIPS`, and the
#: offset the engine therefore draws. `[proved]` by enumeration below.
CIVILIAN_POSED_SCALE = expected_scale(48)
CIVILIAN_POSED_DRAWN = 2.5935

#: `CivilianWait.RootMotion` -- bit 0x00100000 of the wait word that opened the
#: block, which `CivilianRunScript` (`FUN_0048B9E0`) copies into `model+0x64`
#: bit 1 on every clip *change*.
CIVILIAN_ROOT_MOTION = 0x00100000

#: Op 0x2C is the wait; ops 0x00 and 0x01 are the two clip changes.
CIV_OP_WAIT, CIV_OPS_SET_MOTION = 0x2C, (0x00, 0x01)

BANK_NAME, BANK_IDS, BANK_COUNT = 0x004D1B00, 0x004E2B14, 0x004E2BDC
MOTION_BANK_OF = 0x004E2C40

#: A clip root this far off the origin is a real offset rather than authoring
#: noise. Nothing in the game lands between 0.0 and 0.5: the 1058 blocks are
#: 992 at exactly zero, two at 0.06 and 0.43, and 64 above 2.8.
OFFSET_UNITS = 0.5

#: `RescueTargetInit` (`FUN_00451720`) installs this clip as a literal.
CLASS21_MOTION = 0x3E6
CLASS21_ROOT = (0.0, 15.692, 11.943)

#: Every motion the shipped class-0x10 scripts set inside a block whose wait
#: word does **not** ask for root motion, and whose absolute horizontal root is
#: therefore posed rather than walked. `[proved]` by enumeration below; three
#: clips, one `people.bin` root, 2.882 units of it.
CIVILIAN_POSED_CLIPS = {596, 598, 600}
CIVILIAN_POSED_ROOT = (-0.104, 0.805, -2.880)

#: What the whole game holds, so the two halves cannot drift apart silently.
EXPECT_BLOCKS = 1058
EXPECT_ZERO = 992


def load_all_blocks(game: Path):
    """Every motion block in the game, decoded at its own implied stride."""
    tb = stagelib.get_tables(game)
    raw = tb.data
    fn, ids, cnt = (tb._v2r(BANK_NAME), tb._v2r(BANK_IDS), tb._v2r(BANK_COUNT))
    mb = tb._v2r(MOTION_BANK_OF)
    out: dict[int, tuple[str, tuple[float, float, float], float, bool]] = {}
    for b in sorted({raw[mb + m] for m in range(2048)
                     if mb + m < len(raw) and raw[mb + m] < 64}):
        p = struct.unpack_from("<I", raw, fn + b * 4)[0]
        name = tb._cstr(p) if p else None
        n = struct.unpack_from("<H", raw, cnt + b * 2)[0]
        if not name or not (0 < n <= 4096):
            continue
        io = tb._v2r(struct.unpack_from("<I", raw, ids + b * 4)[0])
        if io is None or not (game / "mot" / name).is_file():
            continue
        mids = list(struct.unpack_from(f"<{n}h", raw, io))
        bank = motlib.load_bank(game, name, mids)
        if bank is None:
            continue
        for m in mids:
            bones = bank.implied_bone_count(m)
            if not bones:
                continue
            frames = bank.frames(m, bones)
            if not frames:
                continue
            r0 = frames[0].root
            const = all(abs(f.root[0] - r0[0]) < 1e-6
                        and abs(f.root[2] - r0[2]) < 1e-6 for f in frames)
            out[m] = (name, r0, math.hypot(r0[0], r0[2]), const)
    return out


def civilian_gate_by_clip(exe: Path) -> tuple[dict[int, set[bool]], int, int]:
    """Each clip the scripts set, against the gate of the block that set it."""
    scripts = ExeTables(exe).civilian_scripts()["scripts"]
    by_clip: dict[int, set[bool]] = {}
    on = off = 0
    for cmds in scripts:
        wait = 0
        for c in cmds:
            op = c["op"]
            if op == CIV_OP_WAIT and c["args"]:
                wait = c["args"][0] & 0xFFFFFFFF
                if wait & CIVILIAN_ROOT_MOTION:
                    on += 1
                else:
                    off += 1
            elif op in CIV_OPS_SET_MOTION and c["args"]:
                by_clip.setdefault(c["args"][0], set()).add(
                    bool(wait & CIVILIAN_ROOT_MOTION))
    return by_clip, on, off


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()
    exe = game / "Hod2.exe"
    if not exe.exists():
        print(f"no Hod2.exe under {game}")
        return 3

    problems: list[str] = []

    # -- the bytes ---------------------------------------------------------
    data = exe.read_bytes()
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    coff = e_lfanew + 4
    nsec, = struct.unpack_from("<H", data, coff + 2)
    optsz, = struct.unpack_from("<H", data, coff + 16)
    opt = coff + 20
    imgbase, = struct.unpack_from("<I", data, opt + 28)
    secs = []
    for i in range(nsec):
        o = opt + optsz + i * 40
        vsz, va, rsz, ra = struct.unpack_from("<IIII", data, o + 8)
        secs.append((va, max(vsz, rsz), ra))

    def at(va: int, n: int) -> bytes:
        rva = va - imgbase
        for sva, size, ra in secs:
            if sva <= rva < sva + size:
                return data[ra + (rva - sva):ra + (rva - sva) + n]
        return b""

    for va, (hexb, what) in sorted(INSTRUCTIONS.items()):
        want = bytes.fromhex(hexb)
        got = at(va, len(want))
        if got != want:
            problems.append(f"{va:#010x}: expected {hexb} ({what}), "
                            f"found {got.hex() or '<unmapped>'}")
    print(f"{len(INSTRUCTIONS)} instructions of the two arms and the size, "
          f"{len(INSTRUCTIONS) - len(problems)} matching their bytes")

    # -- the size, decoded from the switch rather than quoted --------------
    # `MOV CL,[EAX+0x410568]; JMP [ECX*4+0x41055C]`, and each arm a
    # `MOV dword ptr [ESI+0x116C], imm32` -- `c7 86 6c 11 00 00` and the float.
    index = at(SCALE_INDEX, SCALE_TYPES)
    jumps = [struct.unpack("<I", at(SCALE_JUMPS + 4 * i, 4) or b"\0" * 4)[0]
             for i in range(max(index or b"\0") + 1)]
    scale: dict[int, float] = {}
    for i, k in enumerate(index):
        arm = at(jumps[k], 10)
        if len(arm) != 10 or arm[:6] != bytes.fromhex("c7866c110000"):
            problems.append(f"type {SCALE_FIRST_TYPE + i}: jump arm "
                            f"{jumps[k]:#010x} is not a store to +0x116C "
                            f"({arm.hex()})")
            continue
        scale[SCALE_FIRST_TYPE + i] = struct.unpack("<f", arm[6:])[0]
    wrong = [t for t, v in scale.items() if v != expected_scale(t)]
    for t in wrong:
        problems.append(f"type {t}: the switch stores {scale[t]!r}, the port "
                        f"says {expected_scale(t)!r}")
    runs: dict[float, list[int]] = {}
    for t, v in sorted(scale.items()):
        runs.setdefault(v, []).append(t)
    print(f"ActorBuildSkinnedModel's size switch, types {SCALE_FIRST_TYPE}.."
          f"{SCALE_FIRST_TYPE + SCALE_TYPES - 1}: "
          + ", ".join(f"{v:.8g} for {min(ts)}..{max(ts)}"
                      for v, ts in runs.items())
          + f"; {len(scale) - len(wrong)} of {SCALE_TYPES} as the port has them")

    # -- the population ----------------------------------------------------
    blocks = load_all_blocks(game)
    if len(blocks) != EXPECT_BLOCKS:
        problems.append(f"{len(blocks)} motion blocks decoded, "
                        f"expected {EXPECT_BLOCKS}")
    zero = [m for m, v in blocks.items() if v[2] == 0.0]
    offset = sorted(m for m, v in blocks.items() if v[2] > OFFSET_UNITS)
    if len(zero) != EXPECT_ZERO:
        problems.append(f"{len(zero)} blocks with an exactly zero horizontal "
                        f"root, expected {EXPECT_ZERO}")
    print(f"{len(blocks)} motion blocks: {len(zero)} have an exactly zero "
          f"horizontal root on frame 0, {len(offset)} are over "
          f"{OFFSET_UNITS} units off it")

    # Class 0x21's own clip, which is the report this check was written for.
    if CLASS21_MOTION not in blocks:
        problems.append(f"motion {CLASS21_MOTION:#x} did not decode")
    else:
        name, r0, h, const = blocks[CLASS21_MOTION]
        if not const:
            problems.append(f"motion {CLASS21_MOTION:#x}'s root is not "
                            "constant -- the delta would have taken it")
        if any(abs(a - b) > 5e-4 for a, b in zip(r0, CLASS21_ROOT)):
            problems.append(f"motion {CLASS21_MOTION:#x} root {r0} != "
                            f"{CLASS21_ROOT}")
        print(f"class 0x21's clip {CLASS21_MOTION:#x} in {name}: root "
              f"({r0[0]:.3f}, {r0[1]:.3f}, {r0[2]:.3f}), "
              f"{'constant' if const else 'NOT constant'}, "
              f"{h:.3f} units of horizontal pose offset")

    # -- and who else the second arm can move ------------------------------
    by_clip, waits_on, waits_off = civilian_gate_by_clip(exe)
    posed = {m for m, gates in by_clip.items()
             if False in gates and m in blocks
             and blocks[m][2] > OFFSET_UNITS}
    print(f"class 0x10: {waits_on} wait words ask for root motion and "
          f"{waits_off} do not; of the {len(by_clip)} clips the scripts set, "
          f"{len(posed)} can be posed with a non-zero horizontal root")
    if posed != CIVILIAN_POSED_CLIPS:
        problems.append(
            f"the clips class 0x10 poses a horizontal root for are "
            f"{sorted(posed)}, expected {sorted(CIVILIAN_POSED_CLIPS)} -- "
            "the blast radius of the second arm has changed and the port's "
            "comments name the old set")
    for m in sorted(posed):
        name, r0, h, const = blocks[m]
        if any(abs(a - b) > 5e-4 for a, b in zip(r0, CIVILIAN_POSED_ROOT)):
            problems.append(f"motion {m} in {name} root {r0} != "
                            f"{CIVILIAN_POSED_ROOT}")
        print(f"  motion {m} in {name}: ({r0[0]:.3f}, {r0[1]:.3f}, "
              f"{r0[2]:.3f}), {h:.3f} units")

    # -- ...and who poses them, at what size -------------------------------
    # Every class-0x10 spawn in the six stages: `{i8 char_type; i8 script}` at
    # the descriptor's `+0x24`, and the script's reachable clips. The offset
    # the engine draws is the clip's times that character's size.
    civ = ExeTables(exe).civilian_scripts()
    authored = max((blocks[m][2] for m in posed), default=0.0)
    players: list[tuple[int, int, int]] = []
    for n in range(1, 7):
        ev = stagelib.Stage(game, stage=n).evt()
        if ev is None:
            problems.append(f"stage {n}: no evt")
            continue
        for rec in evtlib.spawns(ev):
            if rec.cls != 0x10 or rec.offset + 0x26 > len(ev.raw):
                continue
            ct, entry = struct.unpack_from("<bb", ev.raw, rec.offset + 0x24)
            if set(civilian_motion_ids(civ, entry)) & posed:
                players.append((n, rec.offset, ct))
    if not players:
        problems.append("no class-0x10 spawn reaches a posed clip -- the "
                        "pairing below asserted nothing")
    for n, off, ct in players:
        size = scale.get(ct, 1.0)
        drawn = size * authored
        print(f"  stage {n} spawn {off:#x}, character type {ct}: size "
              f"{size:.8g}, so {drawn:.4f} units drawn of the {authored:.4f} "
              "authored")
        if size != CIVILIAN_POSED_SCALE or abs(drawn - CIVILIAN_POSED_DRAWN) \
                > 5e-4:
            problems.append(f"stage {n} spawn {off:#x} (type {ct}) poses a "
                            f"clip at size {size}, drawing {drawn:.3f} units "
                            f"-- the port's notes say {CIVILIAN_POSED_DRAWN}")

    print()
    if problems:
        for p in problems[:20]:
            print("  " + p)
        if len(problems) > 20:
            print(f"  ... and {len(problems) - 20} more")
        print(f"\n{len(problems)} problems")
        return 1
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
