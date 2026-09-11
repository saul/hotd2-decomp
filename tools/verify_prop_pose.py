#!/usr/bin/env python3
"""Each class-0x41 generic prop is posed in the order its own routine poses it.

`render/breakables.ts` composes one rotation for every prop in the generic
family, and for a long time that one was `Ry.Rz.Rx` -- which is
`PropDrawOnlyType51`'s order and **only** its order. The other routines that
pose a prop from the spawn descriptor's three orientation words compose
`Rz.Ry.Rx`, and a prop with two non-zero angles comes out somewhere else
entirely. Nothing could see it: the port's own tables said nothing about
rotation order, so there was no second source to disagree with.

So the order is read out of the EXE here, per type, and checked against the
port's `GENERIC_POSE_ORDER`.

**How the order is read.** Each update routine's body is scanned for `E8`
calls to `MatrixTranslate` (0x004A9D80), `MatrixRotateX` / `Y` / `Z`
(0x004A99F0 / 0x004A9AE0 / 0x004A9BD0) and the two draw entry points
`AssetDrawSlot` (0x00418560) and `SubmitSlotWithSceneLightArray`
(0x004185E0). The **last run of rotations before the first draw** is the pose
the model is drawn with; each rotation in it is matched to the argument the
instruction before the call pushed, and only the three orientation words count:

* pitch -- `obj+0x1CC`, or `obj+0x64` for the types that pose from the actor
  fields instead;
* yaw -- `obj+0x1D0` / `obj+0x64 + 4`;
* roll -- `obj+0x1D4` / `obj+0x64 + 8`.

Matching the *argument* and not just the axis is what makes this readable at
all. `PropUpdateType19` (`FUN_00468F00`) rotates **Y by the literal `0xC000`,
then Z, then Y again, then X** -- a fixed quarter turn followed by an ordinary
`Rz.Ry.Rx`. Counted by axis alone it reads as a fourth distinct order; read
with its arguments it is the same `Rz.Ry.Rx` as its fifteen neighbours, plus a
constant. Types 8, 14, 49 and 67 pose twice, once for a part and once for the
body, and taking the run nearest the draw is what picks the body's.

**What this can and cannot fail.** It fails a `GENERIC_POSE_ORDER` row that
does not match the routine, and a type the renderer draws with no row at all.
It fails a member of `GENERIC_DESCRIPTOR_SLOT` -- in the port *or* in the
exporter -- whose routine never takes `obj+0x28C` into a draw, and it fails the
two copies of that set disagreeing with each other, which is the check the
stage 5 van needed and the one `tools/verify_prop_slots.py` cannot have because
it reads the same table it would be checking. The other direction is a **work
list and not a failure**: a type that does take `obj+0x28C` and is in neither
table may still have its slot overwritten by its own arm of the constructor's
switch, and which of them do has not been read. It fails a `GENERIC_SLOT_STRIP`
outright, in both copies, against the routines that add `obj+0x2A0` -- there is
no arm that writes that field, so that set is settled. And it fails
`render/breakables.ts` composing a prop's pose anywhere but from the table,
counted as one `rotateZ(p.roll)` / `rotateY(p.yaw)` / `rotateX(p.pitch)` site
each: the code this check was written for had two of each, one per arm, and
chose between them on the prop's *family*.
It also measures the blast radius, which is the number that makes it worth
having rather than a restatement of a table: how far each shipped spawn moves
between its own routine's order and the single `Ry.Rz.Rx` the renderer used
for all fifty, as the worst angle between the two poses' basis vectors.

**The order only matters when yaw and roll are both non-zero.** Rx is last in
every one of these compositions, so the only thing an order can disagree about
is whether Ry or Rz comes first -- and with either angle at zero the two
matrices are equal. That is why counting spawns with two or more non-zero
angles overstates it: type 5's four stage-2 spawns carry a pitch and a yaw and
no roll, and were never misplaced. **Four** spawns move by more than a degree,
all four `PropDrawOnlyType12` in stage 4, the worst by 19.65; the rest move by
fifths of a degree, because for types 31 and 33 the third orientation word is a
slot-strip length that the routine also applies as a roll.

    python3 tools/verify_prop_pose.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import math
import re
import struct
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

#: `game/class41/generic.ts` owns the port's copy; it is read, never duplicated.
GENERIC_TS = ROOT / "web" / "src" / "game" / "class41" / "generic.ts"
#: `hod2lib/bundle.ts` is the only writer of a bundle, and it keeps its own
#: copy of the strip set because it runs in the page with no `game/` import.
BUNDLE_TS = ROOT / "web" / "src" / "hod2lib" / "bundle.ts"
#: The one place a prop's pose is composed.
BREAKABLES_TS = ROOT / "web" / "src" / "render" / "breakables.ts"

MATRIX_TRANSLATE = 0x004A9D80
MATRIX_ROTATE = {0x004A99F0: "X", 0x004A9AE0: "Y", 0x004A9BD0: "Z"}
DRAW_ENTRIES = {0x00418560, 0x004185E0}

#: The two field groups a class-0x41 object's three orientation words live in.
#: `PlaceGenericProp` copies the descriptor's to `obj+0x1CC/1D0/1D4`; the types
#: whose object is really an enemy pose from the actor fields `obj+0x64/68/6C`,
#: which the spawn opcode wrote first. Same three numbers either way.
ORIENT_FIELD = {0x1CC: "pitch", 0x1D0: "yaw", 0x1D4: "roll",
                0x64: "pitch", 0x68: "yaw", 0x6C: "roll"}
AXIS_OF = {"pitch": "X", "yaw": "Y", "roll": "Z"}


def pushed_arg(data: bytes, at: int) -> tuple[str, int | None]:
    """What the instruction before the `CALL` at `at` pushed.

    Four forms cover every rotate call in the class: `PUSH imm32` / `imm8`,
    `PUSH dword ptr [base+disp]`, and `MOV r32,[base+disp]` followed by
    `PUSH r32` -- the last of which needs a short backward scan for the `MOV`,
    because the routines hoist two or three of them above their pushes.
    """
    if at - 5 >= 0 and data[at - 5] == 0x68:
        return "lit", struct.unpack_from("<I", data, at - 4)[0]
    if at - 2 >= 0 and data[at - 2] == 0x6A:
        return "lit", data[at - 1]
    if at - 6 >= 0 and data[at - 6] == 0xFF and (data[at - 5] & 0xF8) == 0xB0:
        return "fld", struct.unpack_from("<I", data, at - 4)[0]
    if at - 3 >= 0 and data[at - 3] == 0xFF and (data[at - 2] & 0xF8) == 0x70:
        return "fld", data[at - 1]
    if at - 1 >= 0 and 0x50 <= data[at - 1] <= 0x57:
        reg = data[at - 1] - 0x50
        for k in range(2, 40):
            j = at - 1 - k
            if j < 2:
                break
            if data[j] != 0x8B:
                continue
            modrm = data[j + 1]
            if ((modrm >> 3) & 7) != reg or (modrm & 7) == 4:
                continue
            if (modrm & 0xC0) == 0x40:
                return "fld", data[j + 2]
            if (modrm & 0xC0) == 0x80:
                return "fld", struct.unpack_from("<I", data, j + 2)[0]
        return "reg", reg
    return "?", None


def pose_order(tables, va: int, limit: int = 0x800) -> tuple[str, list[str]]:
    """The descriptor-sourced rotation order the routine at `va` draws with.

    Returns `"?"` -- {@link PoseOrder.Unread} -- rather than an order whenever
    the scan cannot see the whole story: no `AssetDrawSlot` inside `limit`
    bytes, or a rotation whose argument it could not attribute. **That refusal
    is the point.** A first version claimed an order for all fifty types, and
    for the four Original Mode collectibles it was claiming the last rotation
    it happened to see before running out of bytes -- which made the blast
    radius read 60 spawns and 44 "invented rotations" that were nothing of the
    kind. `[open]` is a useful answer and a guess is not (`L20`).
    """
    off = tables._v2r(va)
    if off is None:
        return "?", []
    runs: list[list[tuple[str, str]]] = []
    cur: list[tuple[str, str]] = []
    saw_draw = False
    i = 0
    while i < limit and off + i + 5 <= len(tables.data):
        if tables.data[off + i] != 0xE8:
            i += 1
            continue
        rel = struct.unpack_from("<i", tables.data, off + i + 1)[0]
        target = (va + i + 5 + rel) & 0xFFFFFFFF
        if target in DRAW_ENTRIES:
            saw_draw = True
            break
        axis = MATRIX_ROTATE.get(target)
        if axis is None:
            if target == MATRIX_TRANSLATE and cur:
                runs.append(cur)
                cur = []
            i += 5 if target == MATRIX_TRANSLATE else 1
            continue
        kind, value = pushed_arg(tables.data, off + i)
        if kind == "fld" and value in ORIENT_FIELD:
            cur.append((axis, ORIENT_FIELD[value]))
        elif kind == "lit":
            cur.append((axis, f"lit {value:#x}"))
        elif kind == "fld":
            cur.append((axis, f"obj+{value:#x}"))
        else:
            cur.append((axis, "?"))
        i += 5
    if cur:
        runs.append(cur)
    if not saw_draw:
        return "?", []
    if not runs:
        return "", []
    last = runs[-1]
    # A routine that poses more than once and whose FIRST draw is a sub-part
    # rather than the body: the run nearest that draw is the sub-part's pose,
    # and naming it the prop's would be wrong. `FUN_004717A0` (type 77) is the
    # one, posing a part on the descriptor's yaw and then a second on
    # `obj+0x1DC`. Refuse rather than pick.
    if not any(src in AXIS_OF for _, src in last):
        if any(src in AXIS_OF for run in runs[:-1] for _, src in run):
            return "?", [f"{a}<-{src}" for run in runs for a, src in run]
    last = runs[-1]
    if any(src == "?" for _, src in last):
        # The push could not be attributed to anything, so nothing is claimed
        # about the order. Two types are like this and both are honest `[open]`
        # rather than scanner noise: type 75 poses from the object path it
        # rides and type 41 takes one of its three from a register the short
        # backward scan cannot follow.
        return "?", [f"{a}<-{src}" for a, src in last]
    order = "".join(a for a, src in last if src in AXIS_OF)
    extra = [f"{a}<-{src}" for a, src in last if src not in AXIS_OF]
    return order, extra


def _rot(axis: str, bams: int) -> list[list[float]]:
    a = bams * 2 * math.pi / 65536
    c, s = math.cos(a), math.sin(a)
    if axis == "X":
        return [[1, 0, 0], [0, c, -s], [0, s, c]]
    if axis == "Y":
        return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def compose(order: str, pitch: int, yaw: int, roll: int) -> list[list[float]]:
    """The pose `order` builds, left to right as the engine calls it."""
    m = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    for axis in order:
        r = _rot(axis, {"X": pitch, "Y": yaw, "Z": roll}[axis])
        m = [[sum(m[i][k] * r[k][j] for k in range(3)) for j in range(3)]
             for i in range(3)]
    return m


def worst_angle(a: list[list[float]], b: list[list[float]]) -> float:
    """The largest angle between the two poses' three basis vectors."""
    out = 0.0
    for j in range(3):
        d = sum(a[i][j] * b[i][j] for i in range(3))
        out = max(out, math.degrees(math.acos(max(-1.0, min(1.0, d)))))
    return out


#: `ADD r32, dword ptr [reg + 0x2A0]` -- the instruction that makes a draw a
#: strip. `03 /r` with mod=10 and disp32 0x2A0; the reg and base vary, so the
#: modrm byte is matched by its mod and its r/m rather than exactly.
STRIP_ADD_DISP = 0x2A0


def draws_a_strip(tables, va: int, limit: int = 0x800) -> bool:
    """Does the routine at `va` add `obj+0x2A0` to the slot it first draws?

    This is the **non-circular** half of `GENERIC_SLOT_STRIP`.
    `tools/verify_prop_slots.py` reads that set out of the exporter, so
    emptying it there would empty the check too -- the same blind spot that let
    the stage 5 van's missing slot through. Here it comes out of the EXE, so
    the exporter and the port are both pinned to what the routines do.
    """
    off = tables._v2r(va)
    if off is None:
        return False
    d = tables.data
    i = 0
    while i < limit and off + i + 6 <= len(d):
        if d[off + i] == 0xE8:
            rel = struct.unpack_from("<i", d, off + i + 1)[0]
            if ((va + i + 5 + rel) & 0xFFFFFFFF) in DRAW_ENTRIES:
                return False
            i += 5
            continue
        if (d[off + i] == 0x03 and (d[off + i + 1] & 0xC0) == 0x80
                and struct.unpack_from("<I", d, off + i + 2)[0]
                == STRIP_ADD_DISP):
            return True
        i += 1
    return False


#: `obj+0x28C`, the asset slot `PlaceGenericProp`'s prologue fills in.
SLOT_FIELD = 0x28C
#: `obj+0x11C`, the word the prologue copies into it -- and the lifetime.
LIFETIME_FIELD = 0x11C
#: `desc+0x24` widened into `obj+0x1F4`: the OTHER lifetime, for the arms that
#: take it, which is what frees `obj+0x11C` to be a slot and nothing else.
F1F4_FIELD = 0x1F4
#: `PropExpireByStepLifetime` (`FUN_00466640`), the shared prologue.
EXPIRE_BY_STEP = 0x00466640

#: The empty band between a `+0x11C` that is a **lifetime in event steps** and
#: one that is an **asset slot**, and the fourth clause of the descriptor-slot
#: rule rests on it. `[measured]` over the class-0x41 spawns of all twelve
#: scenes: the words shipped are 0, 1, 2, 3, 4, 5, 7 and then 0x2B upwards to
#: 0x18BF, with **nothing at all** in between. `generic.ts` has said this since
#: it was written, for stage 2 and by eye; the check asserts it every run,
#: because the moment something lands in the band the rule is unsound and the
#: sets have to be settled another way.
SLOT_LIFETIME_GAP = (0x07, 0x2B)

#: `PlaceGenericProp`'s switch, read out of the image rather than assumed.
#:
#: ```
#: 00461da2  MOV EAX,[EBP+0x130c]              ; the descriptor's type
#: 00461da8  ADD EAX,-6                        ; index = type - 6
#: 00461dab  CMP EAX,0x47 / JA default
#: 00461db6  MOV DL, byte ptr [EAX + 0x462978] ; the byte index table
#: 00461dbc  JMP dword ptr [EDX*4 + 0x4628d4]  ; the arm table
#: ```
#:
#: So types 6..77 have an arm and types 5 and 78 fall to the default, which is
#: why type 5 has no switch arm at all and its `obj+0x28C` is the prologue's.
SWITCH_INDEX_TABLE = 0x00462978
SWITCH_ARM_TABLE = 0x004628D4
SWITCH_FIRST_TYPE = 6
SWITCH_TYPE_COUNT = 0x48


def switch_arms(tables) -> dict[int, int]:
    """type -> the address of its arm of `PlaceGenericProp`'s switch."""
    bt = tables._v2r(SWITCH_INDEX_TABLE)
    jt = tables._v2r(SWITCH_ARM_TABLE)
    idx = [tables.data[bt + i] for i in range(SWITCH_TYPE_COUNT)]
    arms = [struct.unpack_from("<I", tables.data, jt + 4 * k)[0]
            for k in range(max(idx) + 1)]
    return {SWITCH_FIRST_TYPE + i: arms[idx[i]]
            for i in range(SWITCH_TYPE_COUNT)}


def arm_facts(tables, va: int | None, limit: int = 0x180) -> tuple[bool, bool]:
    """`(takes obj+0x28C away from the descriptor, replaces obj+0x11C with +0x1F4)`.

    Two forms of write, and only one of them is an overwrite:

    * `MOV word ptr [ESI+0x28C], imm16` always is — nine writes across seven
      arms, which is what rules out types 13, 34 and 67.
    * `MOV word ptr [ESI+0x28C], r16` is an overwrite **unless** that register
      was loaded from `[EBP+0x11C]`, the placer's own copy: those arms are
      re-writing the value the prologue already put there. Type **43**'s is the
      one that is not. Its arm computes the value:

      ```
      00462330  SBB EDX,EDX          ; 0 or -1 from the compare above
      00462332  AND EDX,0xffffe617   ; -0x19E9
      00462338  ADD EDX,0x19E8
      0046233e  MOV word ptr [ESI+0x28C],DX
      ```

      so the field ends up `0x19E8` — the ordinary breakable model — or
      `0xFFFF`, the engine's draw-nothing. A detector that only looked for an
      immediate called that the descriptor's slot, which it is not.
    """
    if va is None:
        return (False, False)
    d = tables.data
    off = tables._v2r(va)
    if off is None:
        return (False, False)
    lit = life = False
    i = 0
    while i < limit and off + i + 9 <= len(d):
        o = off + i
        if (d[o] == 0x66 and d[o + 1] == 0xC7 and (d[o + 2] & 0xC0) == 0x80
                and struct.unpack_from("<I", d, o + 3)[0] == SLOT_FIELD):
            lit = True
            i += 9
            continue
        if (d[o] == 0x66 and d[o + 1] == 0x89 and (d[o + 2] & 0xC0) == 0x80
                and struct.unpack_from("<I", d, o + 3)[0] == SLOT_FIELD):
            reg = (d[o + 2] >> 3) & 7
            if not _loaded_from_placer_slot(d, off, i, reg):
                lit = True
            i += 7
            continue
        if (d[o] == 0x66 and d[o + 1] == 0x8B and (d[o + 2] & 0xC0) == 0x80
                and struct.unpack_from("<I", d, o + 3)[0] == F1F4_FIELD):
            life = True
            i += 7
            continue
        if d[o] == 0xC3:
            break
        if d[o] == 0xE9:
            tgt = va + i + 5 + struct.unpack_from("<i", d, o + 1)[0]
            a, b = arm_facts(tables, tgt, limit - i)
            return (lit or a, life or b)
        i += 1
    return (lit, life)


def _loaded_from_placer_slot(d: bytes, off: int, i: int, reg: int) -> bool:
    """Was `reg` loaded from `[EBP+0x11C]` just before the write at `off+i`?

    `MOV r16, word ptr [EBP+0x11C]` is `66 8B /r` with a disp32, and the arms
    that use it put it within a few instructions of the store.
    """
    for k in range(2, 40):
        o = off + i - k
        if o < 0:
            break
        if (d[o] == 0x66 and d[o + 1] == 0x8B and (d[o + 2] & 0xC0) == 0x80
                and ((d[o + 2] >> 3) & 7) == reg
                and struct.unpack_from("<I", d, o + 3)[0] == LIFETIME_FIELD):
            return True
    return False


def charges_lifetime(tables, va: int, limit: int = 0x800) -> bool:
    """Does the routine age `obj+0x11C` -- shared prologue, or inlined?

    `PropDrawOnlyType53` and `PropUpdateType43` both inline a variant of
    `PropExpireByStepLifetime`, so a check for the `CALL` alone misses them.
    The inline form's tell is `CMP r16, word ptr [reg + 0x11C]`.
    """
    d = tables.data
    off = tables._v2r(va)
    i = 0
    while i < limit and off + i + 7 <= len(d):
        o = off + i
        if d[o] == 0xE8:
            tgt = (va + i + 5
                   + struct.unpack_from("<i", d, o + 1)[0]) & 0xFFFFFFFF
            if tgt == EXPIRE_BY_STEP:
                return True
            if tgt in DRAW_ENTRIES:
                return False
            i += 5
            continue
        if (d[o] == 0x66 and d[o + 1] == 0x3B and (d[o + 2] & 0xC0) == 0x80
                and struct.unpack_from("<I", d, o + 3)[0] == LIFETIME_FIELD):
            return True
        i += 1
    return False


def draws_its_slot(tables, va: int, limit: int = 0x800) -> bool:
    """Does the routine at `va` pass `obj+0x28C` to its first draw?

    `MOVSX r32, word ptr [reg + 0x28C]` -- `0F BF /r` with mod=10 and a disp32
    of 0x28C -- is how every one of them loads it, because the field is an s16
    and `AssetDrawSlot` takes an int.

    **This is the check the stage 5 van needed.** `GENERIC_DESCRIPTOR_SLOT`
    exists in two copies, one in `game/class41/generic.ts` and one in
    `hod2lib/bundle.ts`, and the van's type 51 was missing from both: the
    exporter carried no model for the slot and the renderer had nothing to
    clone, which from the level is indistinguishable from a placement that was
    never emitted. Nothing could disagree with a table that was the only
    source. This is the third source, and it is the routines.
    """
    off = tables._v2r(va)
    if off is None:
        return False
    d = tables.data
    i = 0
    seen = False
    while i < limit and off + i + 7 <= len(d):
        if d[off + i] == 0xE8:
            rel = struct.unpack_from("<i", d, off + i + 1)[0]
            if ((va + i + 5 + rel) & 0xFFFFFFFF) in DRAW_ENTRIES:
                return seen
            i += 5
            continue
        if (d[off + i] == 0x0F and d[off + i + 1] == 0xBF
                and (d[off + i + 2] & 0xC0) == 0x80
                and struct.unpack_from("<I", d, off + i + 3)[0] == SLOT_FIELD):
            seen = True
            i += 7
            continue
        i += 1
    return False


def port_set_keys(name: str, path: Path) -> set[int]:
    """The numeric keys of one `Partial<Record<number, …>>` table in the port."""
    text = path.read_text(encoding="utf-8")
    m = re.search(name + r"[^=]*=\s*\{(.*?)\n\};", text, re.S)
    if not m:
        raise SystemExit(f"{path}: {name} not found")
    return {int(e, 0) for e in
            re.findall(r"(?:^|[{,\s])(0x[0-9a-fA-F]+|\d+)\s*:", m.group(1))}


def port_set(name: str, path: Path) -> set[int]:
    """One `new Set([...])` or `= [...]` in the port or the exporter."""
    text = path.read_text(encoding="utf-8")
    m = re.search(name + r"[^=]*=\s*(?:new Set\()?\[([^\]]*)\]", text)
    if not m:
        raise SystemExit(f"{path}: {name} not found")
    return {int(x, 0) for x in m.group(1).replace("\n", " ").split(",")
            if x.strip()}


def renderer_pose_sites() -> dict[str, int]:
    """How many places `render/breakables.ts` rotates a prop by each angle.

    **The check the bug itself would have failed.** The renderer had two arms,
    one `Rz.Ry.Rx` and one `Ry.Rz.Rx`, and chose between them on the prop's
    *family* -- so every one of the fifty generic types got the second, which
    is type 51's alone. Nothing could see it, because a hard-coded order is
    not a claim anything could disagree with.

    One site per angle is what a table-driven pose looks like. Two is the
    shape that was wrong, and it does not matter which two.
    """
    text = BREAKABLES_TS.read_text(encoding="utf-8")
    return {
        "roll": len(re.findall(r"rotateZ\(\s*p\.roll", text)),
        "yaw": len(re.findall(r"rotateY\(\s*p\.yaw", text)),
        "pitch": len(re.findall(r"rotateX\(\s*p\.pitch", text)),
    }


def port_table() -> dict[int, str]:
    """`GENERIC_POSE_ORDER`, read out of the port rather than copied."""
    text = GENERIC_TS.read_text(encoding="utf-8")
    m = re.search(r"export const GENERIC_POSE_ORDER[^=]*=\s*\{(.*?)\n\};",
                  text, re.S)
    if not m:
        raise SystemExit(f"{GENERIC_TS}: GENERIC_POSE_ORDER not found")
    out: dict[int, str] = {}
    for line in m.group(1).splitlines():
        e = re.match(r"\s*(\d+):\s*PoseOrder\.(\w+)", line.split("//")[0])
        if e:
            out[int(e.group(1))] = e.group(2)
    return out


#: What `PoseOrder` member each derived order is spelled as in the port.
SPELLING = {"ZYX": "RollYawPitch", "YZX": "YawRollPitch", "Y": "YawOnly",
            "Z": "RollOnly", "ZX": "RollPitch", "YX": "YawPitch",
            "": "NoRotation", "?": "Unread"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", type=Path, default=None)
    args = ap.parse_args()
    if args.game_dir is None:
        print("SKIP  verify_prop_pose: needs --game-dir")
        return 3
    game = args.game_dir.expanduser().resolve()

    from hod2lib import stage as stagelib, script as scriptlib, evt as evtlib

    tables = stagelib.get_tables(game)
    if tables is None:
        print(f"SKIP  verify_prop_pose: no Hod2.exe under {game}")
        return 3

    ctor = tables.GENERIC_PROP_CTOR
    rows = tables.class41_dispatch()
    generic = {r["type"]: r["update"] for r in rows if r["ctor"] == ctor}
    derived = {ty: pose_order(tables, va) for ty, va in generic.items()}

    want = port_table() if GENERIC_TS.exists() else {}
    bad: list[str] = []

    for ty, (order, extra) in sorted(derived.items()):
        spelled = SPELLING.get(order)
        have = want.get(ty)
        if have is None:
            bad.append(f"type {ty} ({generic[ty]:#08x}) poses {order or 'nothing'} "
                       f"and has no GENERIC_POSE_ORDER row")
        elif spelled is None:
            bad.append(f"type {ty} ({generic[ty]:#08x}) poses {order}, which "
                       f"PoseOrder cannot spell")
        elif have != spelled:
            bad.append(f"type {ty} ({generic[ty]:#08x}) poses {order} "
                       f"(PoseOrder.{spelled}) and the port says PoseOrder.{have}")
        del extra

    # -- the descriptor-slot set, derived and asserted ----------------------
    arms = switch_arms(tables)
    drawn = {ty for ty, va in generic.items() if draws_its_slot(tables, va)}
    facts = {ty: arm_facts(tables, arms.get(ty)) for ty in generic}
    ages = {ty: charges_lifetime(tables, va) for ty, va in generic.items()}
    print(f"types whose first draw takes obj+0x28C: {sorted(drawn)}")
    for ty in sorted(drawn):
        lit, from1f4 = facts[ty]
        note = []
        if lit:
            note.append("its arm takes obj+0x28C away from the descriptor")
        if from1f4:
            note.append("its arm takes the lifetime from +0x1F4")
        if ages[ty]:
            note.append("it ages obj+0x11C")
        print(f"   type {ty:3d} {generic[ty]:#08x}: "
              + ("; ".join(note) if note else "no arm write, no lifetime"))

    # Three clauses from the code, and the fourth from the shipped scripts,
    # because the code alone does not settle it -- see `slot_shaped` below.
    code_says = {ty for ty in drawn
                 if not facts[ty][0] and (facts[ty][1] or not ages[ty])}

    both = {}
    for where, path in (("game/class41/generic.ts", GENERIC_TS),
                        ("hod2lib/bundle.ts", BUNDLE_TS)):
        both[where] = port_set("GENERIC_DESCRIPTOR_SLOT", path)
    if both["game/class41/generic.ts"] != both["hod2lib/bundle.ts"]:
        bad.append(
            f"the two copies of GENERIC_DESCRIPTOR_SLOT disagree: the port has "
            f"{sorted(both['game/class41/generic.ts'])} and the exporter "
            f"{sorted(both['hod2lib/bundle.ts'])}. The port decides what draws "
            f"and the exporter decides what travels, so a prop in one and not "
            f"the other is invisible either way")

    # -- the strip set, out of the EXE rather than out of either table ------
    strips = {ty for ty, va in generic.items() if draws_a_strip(tables, va)}
    game_strips = port_set("GENERIC_SLOT_STRIP", GENERIC_TS)
    bundle_strips = port_set("GENERIC_SLOT_STRIP", BUNDLE_TS)
    print(f"types whose first draw adds obj+0x2A0: {sorted(strips)}")
    if game_strips != strips:
        bad.append(f"GENERIC_SLOT_STRIP in {GENERIC_TS.name} is "
                   f"{sorted(game_strips)} and the routines say "
                   f"{sorted(strips)}")
    if bundle_strips != strips:
        bad.append(f"GENERIC_SLOT_STRIP in {BUNDLE_TS.name} is "
                   f"{sorted(bundle_strips)} and the routines say "
                   f"{sorted(strips)} -- the exporter would carry the wrong "
                   f"number of frames")

    # -- the renderer composes one pose, from the table ---------------------
    sites = renderer_pose_sites()
    print(f"render/breakables.ts pose sites: "
          f"{', '.join(f'{k} x{v}' for k, v in sites.items())}")
    if "GENERIC_POSE_ORDER" not in BREAKABLES_TS.read_text(encoding="utf-8"):
        bad.append(f"{BREAKABLES_TS.name} does not read GENERIC_POSE_ORDER, so "
                   f"whatever order it composes is not the routines'")
    for angle, n in sites.items():
        if n != 1:
            bad.append(f"{BREAKABLES_TS.name} rotates by `p.{angle}` in {n} "
                       f"places; a pose driven by GENERIC_POSE_ORDER has one, "
                       f"and more than one is a second hard-coded order")

    counts = defaultdict(list)
    for ty, (order, _) in derived.items():
        counts[order].append(ty)
    print(f"{len(generic)} class-0x41 types share PlaceGenericProp; pose orders:")
    for order in sorted(counts):
        print(f"  {order or '(none)':6} PoseOrder.{SPELLING.get(order, '???'):13} "
              f"{len(counts[order]):2d} types {sorted(counts[order])}")

    # -- the blast radius --------------------------------------------------
    moved: list[tuple[float, int, int, int]] = []
    invented = 0
    scenes = 0
    #: type -> the set of `+0x11C` words the shipped scripts give it. The
    #: fourth clause of the descriptor-slot rule is measured from this.
    shipped: dict[int, set[int]] = defaultdict(set)
    for scene in range(tables.SCENE_COUNT):
        try:
            st = stagelib.Stage(game, scene=scene)
            prog = scriptlib.load(st)
        except Exception:
            continue
        if prog.evt is None:
            continue
        scenes += 1
        raw = prog.evt.raw
        seen = set()
        for blk in prog.blocks:
            for step in blk.steps:
                for op in step.ops:
                    for sp in op.to_json().get("spawns", []) or []:
                        if sp.get("class") != 0x41:
                            continue
                        off = sp["at"]
                        if off in seen or off + 0x26 > len(raw):
                            continue
                        seen.add(off)
                        ty = (raw[off + 0x25] << 24) >> 24
                        if ty not in derived:
                            continue
                        shipped[ty].add(evtlib.read_spawn(
                            prog.evt, off, op.opcode).hp)
                        order = derived[ty][0]
                        if order == "?":
                            continue
                        rec = evtlib.read_spawn(prog.evt, off, op.opcode)
                        p_, y_, r_ = rec.orient
                        ang = {"X": p_, "Y": y_, "Z": r_}
                        dev = worst_angle(compose(order, p_, y_, r_),
                                          compose("YZX", p_, y_, r_))
                        if dev > 1e-6:
                            moved.append((dev, ty, scene, blk.index))
                        if [a for a in "XYZ" if ang[a] and a not in order]:
                            invented += 1
    moved.sort(key=lambda e: -e[0])
    big = [e for e in moved if e[0] >= 1.0]
    print(f"\n{scenes} scenes: {len(moved)} generic spawns are posed differently "
          f"by their own order than by one Ry.Rz.Rx, {len(big)} of them by a "
          f"degree or more")
    for dev, ty, scene, blk in moved[:12]:
        print(f"  {dev:7.2f} deg  type {ty:3d} PoseOrder."
              f"{SPELLING.get(derived[ty][0], '???'):13} scene {scene} block {blk}")
    # A fact about the shipped data, not about the port: the level author gave
    # the descriptor an angle on an axis the type's routine never reads. The
    # renderer follows the routine, so these draw unrotated about that axis --
    # which is what the engine does with them.
    print(f"{invented} spawns carry a non-zero angle on an axis their own "
          f"routine never rotates, so nothing draws it")

    # -- the fourth clause, and the assertion -------------------------------
    #
    # `code_says` is the three code clauses. It is not enough on its own, and
    # type 72 is why: `FUN_00470750` takes `obj+0x28C` into the draw it makes
    # for its first 25 frames, its arm writes no literal over that field and it
    # never ages `obj+0x11C` -- every code clause passes -- and its one shipped
    # spawn carries `+0x11C == 1`. The engine hands `AssetDrawSlot` a 1.
    #
    # So the fourth clause is the shipped data, and the gap it rests on is
    # enormous and worth printing every run: across all twelve scenes the seven
    # descriptor-slot types' words run 0x2B..0x18BF and **every other type's
    # are 0, 1, 2, 3, 4, 5 and 7**. Nothing in between. A word below the gap is
    # a lifetime in event steps; a word above it is an asset slot.
    # The threshold is a constant inside the gap, and the gap is asserted over
    # the WHOLE shipped population -- not against either set. Deriving it from
    # one of the sets would make the threshold come from the thing being
    # checked: remove a type from the table and its slot becomes the gap's
    # ceiling, so the check would report the gap closing rather than the
    # missing type. That is `verify_prop_slots.py`'s circularity one layer in,
    # and both wrong versions of this were caught by its own mutation test.
    port = both["game/class41/generic.ts"]
    below = sorted(v for vs in shipped.values() for v in vs
                   if v <= SLOT_LIFETIME_GAP[0])
    inside = sorted(v for vs in shipped.values() for v in vs
                    if SLOT_LIFETIME_GAP[0] < v < SLOT_LIFETIME_GAP[1])
    above = sorted(v for vs in shipped.values() for v in vs
                   if v >= SLOT_LIFETIME_GAP[1])
    print(f"shipped +0x11C: {len(below)} words at or below "
          f"{SLOT_LIFETIME_GAP[0]:#04x} (lifetimes, max "
          f"{max(below, default=0):#04x}), {len(above)} at or above "
          f"{SLOT_LIFETIME_GAP[1]:#06x} (asset slots, min "
          f"{min(above, default=0):#06x}), {len(inside)} in between")
    if inside:
        bad.append(
            f"the slot/lifetime gap has closed: "
            f"{[hex(v) for v in sorted(set(inside))[:8]]} fall between "
            f"{SLOT_LIFETIME_GAP[0]:#04x} and {SLOT_LIFETIME_GAP[1]:#06x}, so "
            f"`+0x11C` can no longer be told apart by its value and this "
            f"check's fourth clause is unsound")
    slot_shaped = {ty for ty in code_says
                   if shipped.get(ty)
                   and min(shipped[ty]) >= SLOT_LIFETIME_GAP[1]}
    if slot_shaped != port:
        missing = sorted(slot_shaped - port)
        extra = sorted(port - slot_shaped)
        bad.append(
            f"GENERIC_DESCRIPTOR_SLOT is {sorted(port)} and the routines plus "
            f"the shipped data say {sorted(slot_shaped)}"
            + (f"; {missing} pass obj+0x28C to a draw, are not overwritten by "
               f"their own arm, do not charge obj+0x11C as a lifetime unless "
               f"the arm has replaced it with +0x1F4, and carry slot-shaped "
               f"words -- so their models do not travel and nothing draws them"
               if missing else "")
            + (f"; {extra} do not qualify" if extra else ""))
    open_types = sorted(code_says - slot_shaped)
    if open_types:
        print(f"[open] {len(open_types)} type(s) pass every code clause and "
              f"fail the data one: {open_types}")
        for ty in open_types:
            print(f"      type {ty} carries "
                  f"{sorted(hex(v) for v in shipped.get(ty, ()))} -- a "
                  f"lifetime by value, a slot by its routine")

    if bad:
        for line in bad[:40]:
            print(f"  {line}")
        print(f"\nFAIL {len(bad)} of the class-0x41 generic tables disagree "
              f"with the routines they describe")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
