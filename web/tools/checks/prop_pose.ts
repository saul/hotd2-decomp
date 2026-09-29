/**
 * Each class-0x41 generic prop is posed in the order its own routine poses it,
 * and the port's descriptor-slot and slot-strip sets are the routines' sets.
 *
 *     node tools/run_ts.mjs tools/checks/prop_pose.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `render/breakables.ts` composes one rotation for every prop in the generic
 * family, from `GENERIC_POSE_ORDER` in `game/class41/generic.ts`. The routines
 * that pose a prop from the spawn descriptor's three orientation words mostly
 * compose `Rz.Ry.Rx`; `PropDrawOnlyType51` and a handful of others compose `Ry.Rz.Rx`,
 * and a prop with two non-zero angles posed in the other order comes out
 * somewhere else entirely. The table is the only thing in the port that says
 * which, so the order is read out of the EXE here, per type, and checked
 * against it.
 *
 * **How the order is read.** Each update routine's body is scanned for `E8`
 * calls to `MatrixTranslate` (0x004A9D80), `MatrixRotateX` / `Y` / `Z`
 * (0x004A99F0 / 0x004A9AE0 / 0x004A9BD0) and the two draw entry points
 * `AssetDrawSlot` (0x00418560) and `SubmitSlotWithSceneLightArray`
 * (0x004185E0). The **last run of rotations before the first draw** is the
 * pose the model is drawn with; each rotation in it is matched to the argument
 * the instruction before the call pushed, and only the three orientation words
 * count:
 *
 * * pitch -- `obj+0x1CC`, or `obj+0x64` for the types that pose from the actor
 *   fields instead;
 * * yaw -- `obj+0x1D0` / `obj+0x64 + 4`;
 * * roll -- `obj+0x1D4` / `obj+0x64 + 8`.
 *
 * Matching the *argument* and not just the axis is what makes this readable at
 * all. `PropUpdateType19` (`FUN_00468F00`) rotates **Y by the literal
 * `0xC000`, then Z, then Y again, then X** -- a fixed quarter turn followed by
 * an ordinary `Rz.Ry.Rx`. Counted by axis alone it reads as a fourth distinct
 * order; read with its arguments it is the same `Rz.Ry.Rx` as its neighbours,
 * plus a constant. Types 8, 14, 49 and 67 pose twice, once for a part and once
 * for the body, and taking the run nearest the draw is what picks the body's.
 * Where the scan cannot see the whole story -- no draw inside its window, a
 * push it cannot attribute, a first draw that is a sub-part's -- it reads the
 * type as `PoseOrder.Unread` and claims no order (`L20`).
 *
 * **What this can and cannot fail.** It fails a `GENERIC_POSE_ORDER` row that
 * does not match the routine, and a type the renderer draws with no row at
 * all. It fails a member of `GENERIC_DESCRIPTOR_SLOT` -- in the port *or* in
 * the exporter (`hod2lib/bundle.ts`) -- whose routine never takes `obj+0x28C`
 * into a draw, and it fails the two copies of that set disagreeing with each
 * other; `verify_prop_slots` reads the same table it would be checking and
 * cannot see either. The other direction is a **work list and not a
 * failure**: a type that passes every code clause and whose shipped words are
 * lifetime-shaped is printed as `[open]`. It fails a `GENERIC_SLOT_STRIP`
 * outright, in both copies, against the routines that add `obj+0x2A0` -- no
 * arm writes that field, so that set is settled. And it fails
 * `render/breakables.ts` composing a prop's pose anywhere but from the table,
 * counted as one `rotateZ(p.roll)` / `rotateY(p.yaw)` / `rotateX(p.pitch)`
 * site each: two of any is a second, hard-coded order chosen on something
 * other than the type. That count reads the renderer's source text, since
 * the shape of the code is the fact.
 *
 * **The descriptor-slot rule** has four clauses. Three come from the code: the
 * routine's first draw takes `obj+0x28C`; its arm of `PlaceGenericProp`'s
 * switch does not overwrite the field (a `MOV word` of an immediate, of a
 * register not loaded from the placer's `+0x11C`, or a `CALL
 * PickOriginalModeItem`); and it does not age `obj+0x11C` as a lifetime unless
 * the arm moved the lifetime to `+0x1F4`. The fourth comes from the shipped
 * scripts of all twelve scenes: every `+0x11C` word a type's spawns carry lies
 * above the empty band `0x07 < w < 0x2B` that separates a lifetime in event
 * steps from an asset slot. The band itself is asserted over the whole
 * shipped population, never derived from either set, so removing a type from
 * the table cannot move the threshold.
 *
 * It also measures the blast radius, which asserts nothing: how far each
 * shipped spawn moves between its own routine's order and a single `Ry.Rz.Rx`
 * for the whole family, as the worst angle between the two poses' basis
 * vectors. **The order only matters when yaw and roll are both non-zero** --
 * Rx is last in every one of these compositions, so the only thing an order
 * can disagree about is whether Ry or Rz comes first, and with either angle at
 * zero the two matrices are equal. For types 31 and 33 the third orientation
 * word is a slot-strip length that the routine also applies as a roll.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { repoRoot } from "../lib/bundle_root";
import { i32, u32 } from "../../src/hod2lib/bytes";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as evtlib from "../../src/hod2lib/evt";
import * as scriptlib from "../../src/hod2lib/script";
import { Stage } from "../../src/hod2lib/stage";
import {
  GENERIC_DESCRIPTOR_SLOT as BUNDLE_DESCRIPTOR_SLOT,
  GENERIC_SLOT_STRIP as BUNDLE_SLOT_STRIP,
} from "../../src/hod2lib/bundle";
import {
  GENERIC_DESCRIPTOR_SLOT, GENERIC_POSE_ORDER, GENERIC_SLOT_STRIP, PoseOrder,
} from "../../src/game/class41/generic";

/** The one place a prop's pose is composed; its source text is what is read. */
const BREAKABLES_TS = join(repoRoot(), "web", "src", "render", "breakables.ts");

const MATRIX_TRANSLATE = 0x004a9d80;
const MATRIX_ROTATE: ReadonlyMap<number, string> =
  new Map([[0x004a99f0, "X"], [0x004a9ae0, "Y"], [0x004a9bd0, "Z"]]);
const DRAW_ENTRIES: ReadonlySet<number> = new Set([0x00418560, 0x004185e0]);

/**
 * The two field groups a class-0x41 object's three orientation words live in.
 * `PlaceGenericProp` copies the descriptor's to `obj+0x1CC/1D0/1D4`; the types
 * whose object is really an enemy pose from the actor fields `obj+0x64/68/6C`,
 * which the spawn opcode wrote first. Same three numbers either way.
 */
const ORIENT_FIELD: ReadonlyMap<number, string> = new Map([
  [0x1cc, "pitch"], [0x1d0, "yaw"], [0x1d4, "roll"],
  [0x64, "pitch"], [0x68, "yaw"], [0x6c, "roll"],
]);
const ORIENT_WORDS: ReadonlySet<string> = new Set(["pitch", "yaw", "roll"]);

type Pushed = ["lit" | "fld" | "reg" | "?", number | null];

/**
 * What the instruction before the `CALL` at file offset `at` pushed.
 *
 * Four forms cover every rotate call in the class: `PUSH imm32` / `imm8`,
 * `PUSH dword ptr [base+disp]`, and `MOV r32,[base+disp]` followed by
 * `PUSH r32` -- the last of which needs a short backward scan for the `MOV`,
 * because the routines hoist two or three of them above their pushes.
 */
function pushedArg(d: Uint8Array, at: number): Pushed {
  if (at - 5 >= 0 && d[at - 5] === 0x68) return ["lit", u32(d, at - 4)];
  if (at - 2 >= 0 && d[at - 2] === 0x6a) return ["lit", d[at - 1]!];
  if (at - 6 >= 0 && d[at - 6] === 0xff && (d[at - 5]! & 0xf8) === 0xb0) {
    return ["fld", u32(d, at - 4)];
  }
  if (at - 3 >= 0 && d[at - 3] === 0xff && (d[at - 2]! & 0xf8) === 0x70) {
    return ["fld", d[at - 1]!];
  }
  if (at - 1 >= 0 && d[at - 1]! >= 0x50 && d[at - 1]! <= 0x57) {
    const reg = d[at - 1]! - 0x50;
    for (let k = 2; k < 40; k++) {
      const j = at - 1 - k;
      if (j < 2) break;
      if (d[j] !== 0x8b) continue;
      const modrm = d[j + 1]!;
      if (((modrm >> 3) & 7) !== reg || (modrm & 7) === 4) continue;
      if ((modrm & 0xc0) === 0x40) return ["fld", d[j + 2]!];
      if ((modrm & 0xc0) === 0x80) return ["fld", u32(d, j + 2)];
    }
    return ["reg", reg];
  }
  return ["?", null];
}

/** Lower-case hex with a `0x` prefix and no padding: `0x1a`. */
function px(v: number): string {
  return `0x${v.toString(16)}`;
}

/** The target of the `E8`/`E9` at file offset `o`, which is `va` in the image. */
function callTarget(d: Uint8Array, o: number, va: number): number {
  return (va + 5 + i32(d, o + 1)) >>> 0;
}

/**
 * The descriptor-sourced rotation order the routine at `va` draws with: a
 * string of axes, `""` for none, or `"?"` -- `PoseOrder.Unread` -- whenever the
 * scan cannot see the whole story: no draw inside `limit` bytes, or a
 * rotation whose argument it could not attribute. Claiming the last rotation
 * seen before the window ran out is a guess, and a guess is not an answer.
 */
function poseOrder(exe: ExeTables, va: number, limit = 0x800): [string, string[]] {
  const d = exe.data;
  const off = exe.v2r(va);
  if (off === null) return ["?", []];
  const runs: [string, string][][] = [];
  let cur: [string, string][] = [];
  let sawDraw = false;
  let i = 0;
  while (i < limit && off + i + 5 <= d.length) {
    if (d[off + i] !== 0xe8) {
      i += 1;
      continue;
    }
    const target = callTarget(d, off + i, va + i);
    if (DRAW_ENTRIES.has(target)) {
      sawDraw = true;
      break;
    }
    const axis = MATRIX_ROTATE.get(target);
    if (axis === undefined) {
      if (target === MATRIX_TRANSLATE && cur.length) {
        runs.push(cur);
        cur = [];
      }
      i += target === MATRIX_TRANSLATE ? 5 : 1;
      continue;
    }
    const [kind, value] = pushedArg(d, off + i);
    if (kind === "fld" && ORIENT_FIELD.has(value!)) cur.push([axis, ORIENT_FIELD.get(value!)!]);
    else if (kind === "lit") cur.push([axis, `lit ${px(value!)}`]);
    else if (kind === "fld") cur.push([axis, `obj+${px(value!)}`]);
    else cur.push([axis, "?"]);
    i += 5;
  }
  if (cur.length) runs.push(cur);
  if (!sawDraw) return ["?", []];
  if (!runs.length) return ["", []];
  const last = runs[runs.length - 1]!;
  // A routine that poses more than once and whose FIRST draw is a sub-part
  // rather than the body: the run nearest that draw is the sub-part's pose,
  // and naming it the prop's would be wrong. `FUN_004717A0` (type 77) poses a
  // part on the descriptor's yaw and then a second on `obj+0x1DC`. Refuse
  // rather than pick.
  if (!last.some(([, src]) => ORIENT_WORDS.has(src))
      && runs.slice(0, -1).some((run) => run.some(([, src]) => ORIENT_WORDS.has(src)))) {
    return ["?", runs.flatMap((run) => run.map(([a, src]) => `${a}<-${src}`))];
  }
  // A push the scan could not attribute: nothing is claimed about the order.
  // Type 75 poses from the object path it rides and type 41 takes one of its
  // three from a register the short backward scan cannot follow.
  if (last.some(([, src]) => src === "?")) {
    return ["?", last.map(([a, src]) => `${a}<-${src}`)];
  }
  const order = last.filter(([, src]) => ORIENT_WORDS.has(src)).map(([a]) => a).join("");
  const extra = last.filter(([, src]) => !ORIENT_WORDS.has(src)).map(([a, src]) => `${a}<-${src}`);
  return [order, extra];
}

type Mat3 = number[][];

function rot(axis: string, bams: number): Mat3 {
  const a = bams * 2 * Math.PI / 65536;
  const cs = Math.cos(a);
  const s = Math.sin(a);
  if (axis === "X") return [[1, 0, 0], [0, cs, -s], [0, s, cs]];
  if (axis === "Y") return [[cs, 0, s], [0, 1, 0], [-s, 0, cs]];
  return [[cs, -s, 0], [s, cs, 0], [0, 0, 1]];
}

/** The pose `order` builds, left to right as the engine calls it. */
function compose(order: string, pitch: number, yaw: number, roll: number): Mat3 {
  let m: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const axis of order) {
    const r = rot(axis, axis === "X" ? pitch : axis === "Y" ? yaw : roll);
    m = [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
      m[i]![0]! * r[0]![j]! + m[i]![1]! * r[1]![j]! + m[i]![2]! * r[2]![j]!));
  }
  return m;
}

/** The largest angle, in degrees, between the two poses' three basis vectors. */
function worstAngle(a: Mat3, b: Mat3): number {
  let out = 0;
  for (let j = 0; j < 3; j++) {
    const dot = a[0]![j]! * b[0]![j]! + a[1]![j]! * b[1]![j]! + a[2]![j]! * b[2]![j]!;
    out = Math.max(out, Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
  }
  return out;
}

/**
 * `ADD r32, dword ptr [reg + 0x2A0]` -- the instruction that makes a draw a
 * strip. `03 /r` with mod=10 and disp32 0x2A0; the reg and base vary, so the
 * modrm byte is matched by its mod and its r/m rather than exactly.
 */
const STRIP_ADD_DISP = 0x2a0;

/**
 * Does the routine at `va` add `obj+0x2A0` to the slot it first draws?
 *
 * The **non-circular** source for `GENERIC_SLOT_STRIP`: `verify_prop_slots`
 * reads that set out of the exporter, so emptying it there would empty that
 * check too. Here it comes out of the EXE, so the exporter and the port are
 * both pinned to what the routines do.
 */
function drawsAStrip(exe: ExeTables, va: number, limit = 0x800): boolean {
  const d = exe.data;
  const off = exe.v2r(va);
  if (off === null) return false;
  let i = 0;
  while (i < limit && off + i + 6 <= d.length) {
    if (d[off + i] === 0xe8) {
      if (DRAW_ENTRIES.has(callTarget(d, off + i, va + i))) return false;
      i += 5;
      continue;
    }
    if (d[off + i] === 0x03 && (d[off + i + 1]! & 0xc0) === 0x80
        && u32(d, off + i + 2) === STRIP_ADD_DISP) {
      return true;
    }
    i += 1;
  }
  return false;
}

/** `obj+0x28C`, the asset slot `PlaceGenericProp`'s prologue fills in. */
const SLOT_FIELD = 0x28c;
/** `obj+0x11C`, the word the prologue copies into it -- and the lifetime. */
const LIFETIME_FIELD = 0x11c;
/**
 * `desc+0x24` widened into `obj+0x1F4`: the OTHER lifetime, for the arms that
 * take it, which is what frees `obj+0x11C` to be a slot and nothing else.
 */
const F1F4_FIELD = 0x1f4;
/** `PropExpireByStepLifetime` (`FUN_00466640`), the shared prologue. */
const EXPIRE_BY_STEP = 0x00466640;
/**
 * `PickOriginalModeItem` (`FUN_004629C0`): the call cases 0x46, 0x47 and 0x48
 * make, which writes the chosen item's model over `obj+0x28C`. A call is an
 * overwrite a literal-store scan cannot see.
 */
const PICK_ORIGINAL_MODE_ITEM = 0x004629c0;

/**
 * The empty band between a `+0x11C` that is a **lifetime in event steps** and
 * one that is an **asset slot**, which the fourth clause of the
 * descriptor-slot rule rests on. `[measured]` over the class-0x41 spawns of
 * all twelve scenes; the check asserts it every run, because the moment
 * something lands in the band the rule is unsound and the sets have to be
 * settled another way.
 */
const SLOT_LIFETIME_GAP: readonly [number, number] = [0x07, 0x2b];

/**
 * `PlaceGenericProp`'s switch, read out of the image rather than assumed.
 *
 * ```
 * 00461da2  MOV EAX,[EBP+0x130c]              ; the descriptor's type
 * 00461da8  ADD EAX,-6                        ; index = type - 6
 * 00461dab  CMP EAX,0x47 / JA default
 * 00461db6  MOV DL, byte ptr [EAX + 0x462978] ; the byte index table
 * 00461dbc  JMP dword ptr [EDX*4 + 0x4628d4]  ; the arm table
 * ```
 *
 * So types 6..77 have an arm and types 5 and 78 fall to the default, which is
 * why type 5 has no switch arm at all and its `obj+0x28C` is the prologue's.
 */
const SWITCH_INDEX_TABLE = 0x00462978;
const SWITCH_ARM_TABLE = 0x004628d4;
const SWITCH_FIRST_TYPE = 6;
const SWITCH_TYPE_COUNT = 0x48;

/** type -> the address of its arm of `PlaceGenericProp`'s switch. */
function switchArms(exe: ExeTables): Map<number, number> {
  const d = exe.data;
  const bt = exe.v2r(SWITCH_INDEX_TABLE);
  const jt = exe.v2r(SWITCH_ARM_TABLE);
  if (bt === null || jt === null) throw new Error("PlaceGenericProp's switch tables are not in the image");
  const idx = Array.from({ length: SWITCH_TYPE_COUNT }, (_, i) => d[bt + i]!);
  const arms = Array.from({ length: Math.max(...idx) + 1 }, (_, k) => u32(d, jt + 4 * k));
  return new Map(idx.map((x, i) => [SWITCH_FIRST_TYPE + i, arms[x]!]));
}

/**
 * Was `reg` loaded from `[EBP+0x11C]` just before the write at `off+i`?
 *
 * `MOV r16, word ptr [EBP+0x11C]` is `66 8B /r` with a disp32, and the arms
 * that use it put it within a few instructions of the store.
 */
function loadedFromPlacerSlot(d: Uint8Array, off: number, i: number, reg: number): boolean {
  for (let k = 2; k < 40; k++) {
    const o = off + i - k;
    if (o < 0) break;
    if (d[o] === 0x66 && d[o + 1] === 0x8b && (d[o + 2]! & 0xc0) === 0x80
        && ((d[o + 2]! >> 3) & 7) === reg && u32(d, o + 3) === LIFETIME_FIELD) {
      return true;
    }
  }
  return false;
}

/**
 * `[takes obj+0x28C away from the descriptor, replaces obj+0x11C with +0x1F4]`
 * for the switch arm at `va`.
 *
 * Three forms of write, and not all of them are an overwrite:
 *
 * * `MOV word ptr [ESI+0x28C], imm16` always is.
 * * `CALL PickOriginalModeItem` always is: it copies the chosen item's model
 *   over the field, which is what rules out 70, 71 and 72.
 * * `MOV word ptr [ESI+0x28C], r16` is an overwrite **unless** that register
 *   was loaded from `[EBP+0x11C]`, the placer's own copy: those arms re-write
 *   the value the prologue already put there. Type **43**'s is one that is
 *   not. Its arm computes the value:
 *
 *   ```
 *   00462330  SBB EDX,EDX          ; 0 or -1 from the compare above
 *   00462332  AND EDX,0xffffe617   ; -0x19E9
 *   00462338  ADD EDX,0x19E8
 *   0046233e  MOV word ptr [ESI+0x28C],DX
 *   ```
 *
 *   so the field ends up `0x19E8` -- the ordinary breakable model -- or
 *   `0xFFFF`, the engine's draw-nothing, and never the descriptor's slot.
 *
 * An unconditional `JMP` is followed, with what is left of the window.
 */
function armFacts(exe: ExeTables, va: number | undefined, limit = 0x180): [boolean, boolean] {
  if (va === undefined) return [false, false];
  const d = exe.data;
  const off = exe.v2r(va);
  if (off === null) return [false, false];
  let lit = false;
  let life = false;
  let i = 0;
  while (i < limit && off + i + 9 <= d.length) {
    const o = off + i;
    if (d[o] === 0x66 && d[o + 1] === 0xc7 && (d[o + 2]! & 0xc0) === 0x80
        && u32(d, o + 3) === SLOT_FIELD) {
      lit = true;
      i += 9;
      continue;
    }
    if (d[o] === 0x66 && d[o + 1] === 0x89 && (d[o + 2]! & 0xc0) === 0x80
        && u32(d, o + 3) === SLOT_FIELD) {
      const reg = (d[o + 2]! >> 3) & 7;
      if (!loadedFromPlacerSlot(d, off, i, reg)) lit = true;
      i += 7;
      continue;
    }
    if (d[o] === 0x66 && d[o + 1] === 0x8b && (d[o + 2]! & 0xc0) === 0x80
        && u32(d, o + 3) === F1F4_FIELD) {
      life = true;
      i += 7;
      continue;
    }
    if (d[o] === 0xe8 && callTarget(d, o, va + i) === PICK_ORIGINAL_MODE_ITEM) {
      lit = true;
      i += 5;
      continue;
    }
    if (d[o] === 0xc3) break;
    if (d[o] === 0xe9) {
      const [a, b] = armFacts(exe, va + i + 5 + i32(d, o + 1), limit - i);
      return [lit || a, life || b];
    }
    i += 1;
  }
  return [lit, life];
}

/**
 * Does the routine at `va` age `obj+0x11C` -- shared prologue, or inlined?
 *
 * `PropDrawOnlyType53` and `PropUpdateType43` both inline a variant of
 * `PropExpireByStepLifetime`, so a check for the `CALL` alone misses them.
 * The inline form's tell is `CMP r16, word ptr [reg + 0x11C]`.
 */
function chargesLifetime(exe: ExeTables, va: number, limit = 0x800): boolean {
  const d = exe.data;
  const off = exe.v2r(va);
  if (off === null) throw new Error(`update routine ${hex(va, 8)} is not in the image`);
  let i = 0;
  while (i < limit && off + i + 7 <= d.length) {
    const o = off + i;
    if (d[o] === 0xe8) {
      const tgt = callTarget(d, o, va + i);
      if (tgt === EXPIRE_BY_STEP) return true;
      if (DRAW_ENTRIES.has(tgt)) return false;
      i += 5;
      continue;
    }
    if (d[o] === 0x66 && d[o + 1] === 0x3b && (d[o + 2]! & 0xc0) === 0x80
        && u32(d, o + 3) === LIFETIME_FIELD) {
      return true;
    }
    i += 1;
  }
  return false;
}

/**
 * Does the routine at `va` pass `obj+0x28C` to its first draw?
 *
 * `MOVSX r32, word ptr [reg + 0x28C]` -- `0F BF /r` with mod=10 and a disp32
 * of 0x28C -- is how every one of them loads it, because the field is an s16
 * and `AssetDrawSlot` takes an int.
 *
 * `GENERIC_DESCRIPTOR_SLOT` exists in two copies, one in
 * `game/class41/generic.ts` and one in `hod2lib/bundle.ts`, and a type
 * missing from both carries no model in the bundle and has nothing for the
 * renderer to clone -- which from the level is indistinguishable from a
 * placement that was never emitted. This is the third source, and it is the
 * routines.
 */
function drawsItsSlot(exe: ExeTables, va: number, limit = 0x800): boolean {
  const d = exe.data;
  const off = exe.v2r(va);
  if (off === null) return false;
  let i = 0;
  let seen = false;
  while (i < limit && off + i + 7 <= d.length) {
    if (d[off + i] === 0xe8) {
      if (DRAW_ENTRIES.has(callTarget(d, off + i, va + i))) return seen;
      i += 5;
      continue;
    }
    if (d[off + i] === 0x0f && d[off + i + 1] === 0xbf && (d[off + i + 2]! & 0xc0) === 0x80
        && u32(d, off + i + 3) === SLOT_FIELD) {
      seen = true;
      i += 7;
      continue;
    }
    i += 1;
  }
  return false;
}

/**
 * How many places `render/breakables.ts` rotates a prop by each angle. One
 * site per angle is what a table-driven pose looks like; two is a second
 * order hard-coded beside it, and it does not matter which two.
 */
function rendererPoseSites(text: string): Record<string, number> {
  return {
    roll: (text.match(/rotateZ\(\s*p\.roll/g) ?? []).length,
    yaw: (text.match(/rotateY\(\s*p\.yaw/g) ?? []).length,
    pitch: (text.match(/rotateX\(\s*p\.pitch/g) ?? []).length,
  };
}

/** What `PoseOrder` member each derived order is spelled as in the port. */
const SPELLING: Readonly<Record<string, string>> = {
  ZYX: "RollYawPitch", YZX: "YawRollPitch", Y: "YawOnly", Z: "RollOnly",
  ZX: "RollPitch", YX: "YawPitch", "": "NoRotation", "?": "Unread",
};

/** The `PoseOrder` member whose value is `v`. */
function memberName(v: PoseOrder): string | undefined {
  return Object.entries(PoseOrder).find(([, x]) => x === v)?.[0];
}

const sorted = (xs: Iterable<number>): number[] => [...xs].sort((a, b) => a - b);
const setText = (xs: Iterable<number>): string => `[${sorted(xs).join(", ")}]`;
const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

// ---------------------------------------------------------------------------

const c = new Checker("prop_pose");
const { source, exe } = await openGame(gameDirOrSkip("prop_pose"));

const generic = new Map<number, number>();
for (const r of exe.class41Dispatch()) {
  if (r.ctor === ExeTables.GENERIC_PROP_CTOR) generic.set(r.type, r.update);
}
const derived = new Map<number, [string, string[]]>();
for (const [ty, va] of generic) derived.set(ty, poseOrder(exe, va));

// -- the pose table, row by row ---------------------------------------------
//
// The PoseOrder members spell the orders they name: the renderer composes
// from the member's value, so a row can only be right if the spelling is.
for (const [order, name] of Object.entries(SPELLING)) {
  c.eq((PoseOrder as Record<string, string>)[name], order,
       `PoseOrder.${name} is the order ${JSON.stringify(order)}`);
}
for (const ty of sorted(derived.keys())) {
  const [order] = derived.get(ty)!;
  const va = px(generic.get(ty)!);
  const spelled = SPELLING[order];
  const value = GENERIC_POSE_ORDER[ty];
  const have = value === undefined ? undefined : memberName(value);
  const what = `type ${ty} (${va}) poses ${order || "nothing"}`;
  if (have === undefined) {
    c.fail(`${what} and has no GENERIC_POSE_ORDER row`);
  } else if (spelled === undefined) {
    c.fail(`${what}, which PoseOrder cannot spell`);
  } else if (have !== spelled) {
    c.fail(`${what} (PoseOrder.${spelled}) and the port says PoseOrder.${have}`);
  } else {
    c.ok(true, `${what}: GENERIC_POSE_ORDER says PoseOrder.${have}`);
  }
}

// -- the descriptor-slot set, derived -----------------------------------------
const arms = switchArms(exe);
const drawn = new Set(sorted(generic.keys()).filter((ty) => drawsItsSlot(exe, generic.get(ty)!)));
const facts = new Map([...generic.keys()].map((ty) => [ty, armFacts(exe, arms.get(ty))]));
const ages = new Map([...generic].map(([ty, va]) => [ty, chargesLifetime(exe, va)]));
c.note(`types whose first draw takes obj+0x28C: ${setText(drawn)}`);
for (const ty of drawn) {
  const [lit, from1f4] = facts.get(ty)!;
  const notes: string[] = [];
  if (lit) notes.push("its arm takes obj+0x28C away from the descriptor");
  if (from1f4) notes.push("its arm takes the lifetime from +0x1F4");
  if (ages.get(ty)) notes.push("it ages obj+0x11C");
  c.note(`   type ${String(ty).padStart(3)} ${px(generic.get(ty)!)}: `
         + (notes.length ? notes.join("; ") : "no arm write, no lifetime"));
}

// Three clauses from the code; the fourth, from the shipped scripts, is below.
const codeSays = new Set([...drawn].filter((ty) =>
  !facts.get(ty)![0] && (facts.get(ty)![1] || !ages.get(ty))));

const portSlot = new Set(GENERIC_DESCRIPTOR_SLOT);
const bundleSlot = new Set(BUNDLE_DESCRIPTOR_SLOT);
c.ok(sameSet(portSlot, bundleSlot),
     sameSet(portSlot, bundleSlot)
       ? `the two copies of GENERIC_DESCRIPTOR_SLOT agree: ${setText(portSlot)}`
       : `the two copies of GENERIC_DESCRIPTOR_SLOT disagree: the port has `
         + `${setText(portSlot)} and the exporter ${setText(bundleSlot)}. The port `
         + `decides what draws and the exporter decides what travels, so a prop `
         + `in one and not the other is invisible either way`);

// -- the strip set, out of the EXE rather than out of either table -----------
const strips = new Set(sorted(generic.keys()).filter((ty) => drawsAStrip(exe, generic.get(ty)!)));
c.note(`types whose first draw adds obj+0x2A0: ${setText(strips)}`);
const gameStrips = new Set(GENERIC_SLOT_STRIP);
const bundleStrips = new Set(BUNDLE_SLOT_STRIP);
c.ok(sameSet(gameStrips, strips),
     `GENERIC_SLOT_STRIP in generic.ts is ${setText(gameStrips)} and the routines say ${setText(strips)}`);
c.ok(sameSet(bundleStrips, strips),
     `GENERIC_SLOT_STRIP in bundle.ts is ${setText(bundleStrips)} and the routines say ${setText(strips)}`
     + (sameSet(bundleStrips, strips) ? "" : " -- the exporter would carry the wrong number of frames"));

// -- the renderer composes one pose, from the table --------------------------
const breakables = readFileSync(BREAKABLES_TS, "utf8");
const sites = rendererPoseSites(breakables);
c.ok(breakables.includes("GENERIC_POSE_ORDER"),
     breakables.includes("GENERIC_POSE_ORDER")
       ? "breakables.ts reads GENERIC_POSE_ORDER"
       : "breakables.ts does not read GENERIC_POSE_ORDER, so whatever order it "
         + "composes is not the routines'");
for (const [angle, n] of Object.entries(sites)) {
  c.ok(n === 1, `breakables.ts rotates by \`p.${angle}\` in ${n} place${n === 1 ? "" : "s"}`
       + (n === 1 ? "" : "; a pose driven by GENERIC_POSE_ORDER has one, and more "
                        + "than one is a second hard-coded order"));
}

const byOrder = new Map<string, number[]>();
for (const [ty, [order]] of derived) {
  if (!byOrder.has(order)) byOrder.set(order, []);
  byOrder.get(order)!.push(ty);
}
c.note(`${generic.size} class-0x41 types share PlaceGenericProp; pose orders:`);
for (const order of [...byOrder.keys()].sort()) {
  const tys = byOrder.get(order)!;
  c.note(`  ${(order || "(none)").padEnd(6)} PoseOrder.${(SPELLING[order] ?? "???").padEnd(13)} `
         + `${String(tys.length).padStart(2)} types ${setText(tys)}`);
}

// -- the blast radius, and the shipped +0x11C words --------------------------
const moved: [number, number, number, number][] = [];
let invented = 0;
let scenes = 0;
/** type -> the set of `+0x11C` words the shipped scripts give it. */
const shipped = new Map<number, Set<number>>();
for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
  let prog: scriptlib.Program;
  try {
    prog = await scriptlib.load(await Stage.create(source, { scene }));
  } catch (e) {
    c.note(`scene ${scene} did not load: ${(e as Error).message}`);
    continue;
  }
  if (prog.evt === null) continue;
  scenes++;
  const raw = prog.evt.raw;
  const seen = new Set<number>();
  for (const blk of prog.blocks) {
    for (const step of blk.steps) {
      for (const op of step.ops) {
        const sps = (op.detail.spawns ?? []) as { class: number; at: number }[];
        for (const sp of sps) {
          if (sp.class !== 0x41) continue;
          const off = sp.at;
          if (seen.has(off) || off + 0x26 > raw.length) continue;
          seen.add(off);
          const ty = raw[off + 0x25]!;
          if (!derived.has(ty)) continue;
          const rec = evtlib.readSpawn(prog.evt, off, op.opcode);
          if (!shipped.has(ty)) shipped.set(ty, new Set());
          shipped.get(ty)!.add(rec.hp);
          const order = derived.get(ty)![0];
          if (order === "?") continue;
          const [p, y, r] = rec.orient;
          const ang: Record<string, number> = { X: p, Y: y, Z: r };
          const dev = worstAngle(compose(order, p, y, r), compose("YZX", p, y, r));
          if (dev > 1e-6) moved.push([dev, ty, scene, blk.index]);
          if ("XYZ".split("").some((a) => ang[a] && !order.includes(a))) invented++;
        }
      }
    }
  }
}
moved.sort((a, b) => b[0] - a[0]);
const big = moved.filter((e) => e[0] >= 1.0);
c.note(`${scenes} scenes: ${moved.length} generic spawns are posed differently by their `
       + `own order than by one Ry.Rz.Rx, ${big.length} of them by a degree or more`);
for (const [dev, ty, scene, blk] of moved.slice(0, 12)) {
  c.note(`  ${dev.toFixed(2).padStart(7)} deg  type ${String(ty).padStart(3)} PoseOrder.`
         + `${(SPELLING[derived.get(ty)![0]] ?? "???").padEnd(13)} scene ${scene} block ${blk}`);
}
// A fact about the shipped data, not about the port: the level author gave the
// descriptor an angle on an axis the type's routine never reads. The renderer
// follows the routine, so these draw unrotated about that axis -- which is
// what the engine does with them.
c.note(`${invented} spawns carry a non-zero angle on an axis their own routine `
       + `never rotates, so nothing draws it`);

// -- the fourth clause, and the assertion -------------------------------------
//
// A word at or below the gap is a lifetime in event steps; a word at or above
// it is an asset slot. The threshold is a constant inside the gap, and the gap
// is asserted over the WHOLE shipped population -- not against either set.
// Deriving it from one of the sets would make the threshold come from the
// thing being checked: remove a type from the table and its slot becomes the
// gap's ceiling, so the check would report the gap closing rather than the
// missing type.
const all = [...shipped.values()].flatMap((vs) => [...vs]);
const below = sorted(all.filter((v) => v <= SLOT_LIFETIME_GAP[0]));
const inside = sorted(all.filter((v) => SLOT_LIFETIME_GAP[0] < v && v < SLOT_LIFETIME_GAP[1]));
const above = sorted(all.filter((v) => v >= SLOT_LIFETIME_GAP[1]));
c.note(`shipped +0x11C: ${below.length} words at or below ${px(SLOT_LIFETIME_GAP[0])} `
       + `(lifetimes, max ${px(Math.max(0, ...below))}), ${above.length} at or above `
       + `${px(SLOT_LIFETIME_GAP[1])} (asset slots, min ${px(above.length ? Math.min(...above) : 0)}), `
       + `${inside.length} in between`);
c.ok(inside.length === 0,
     inside.length === 0
       ? `the slot/lifetime gap ${px(SLOT_LIFETIME_GAP[0])}..${px(SLOT_LIFETIME_GAP[1])} `
         + `is empty in every shipped +0x11C word`
       : `the slot/lifetime gap has closed: `
         + `${[...new Set(inside)].slice(0, 8).map(px).join(", ")} fall between `
         + `${px(SLOT_LIFETIME_GAP[0])} and ${px(SLOT_LIFETIME_GAP[1])}, so \`+0x11C\` can no `
         + `longer be told apart by its value and the fourth clause is unsound`);

const slotShaped = new Set([...codeSays].filter((ty) => {
  const ws = shipped.get(ty);
  return ws !== undefined && ws.size > 0 && Math.min(...ws) >= SLOT_LIFETIME_GAP[1];
}));
const missing = sorted([...slotShaped].filter((ty) => !portSlot.has(ty)));
const extra = sorted([...portSlot].filter((ty) => !slotShaped.has(ty)));
c.ok(sameSet(slotShaped, portSlot),
     `GENERIC_DESCRIPTOR_SLOT is ${setText(portSlot)} and the routines plus the `
     + `shipped data say ${setText(slotShaped)}`
     + (missing.length
       ? `; ${setText(missing)} pass obj+0x28C to a draw, are not overwritten by `
         + `their own arm, do not charge obj+0x11C as a lifetime unless the arm has `
         + `replaced it with +0x1F4, and carry slot-shaped words -- so their models `
         + `do not travel and nothing draws them`
       : "")
     + (extra.length ? `; ${setText(extra)} do not qualify` : ""));
const openTypes = sorted([...codeSays].filter((ty) => !slotShaped.has(ty)));
if (openTypes.length) {
  c.note(`[open] ${openTypes.length} type(s) pass every code clause and fail the data one: `
         + setText(openTypes));
  for (const ty of openTypes) {
    c.note(`      type ${ty} carries ${sorted(shipped.get(ty) ?? []).map(px).join(", ")}`
           + ` -- a lifetime by value, a slot by its routine`);
  }
}

c.finish();
