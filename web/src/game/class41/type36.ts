/**
 * Class 0x41 type 36 — three flickers of an animated effect strip that
 * wink on and off at random around one fixed point in stage 3.
 *
 * One shipped descriptor (`0x0CFC`), placed three times by stage 3's script
 * — block 1 steps 0 and 1 and block 3 step 0 — at the origin with a
 * one-step lifetime. The routine never reads its own position: every part
 * is drawn at `(-995 + x, -12 + y, -2970.7)` for a small per-part `(x, y)`.
 *
 * What it draws: `g_scene_tick_counter % 24 + 0x161B`, which is
 * `eff_2.bin[31..54]`, a 24-frame strip every part shows in step. `[open]`
 * what the strip depicts.
 *
 * The whole routine is `0x0046B480`..`0x0046B5EC` — **not** the 0x840 bytes
 * up to `0x0046BCC0`: a second, unrelated routine sits between --
 * `PropUpdateType37` (`FUN_0046B5F0`), whose one reference is a `DATA` push in
 * constructor 37 (`0x004632F0`); it is not `g_class41_updates[37]`, which is
 * `NoOpStub`. See `class41/type37.ts`. The pseudocode returns inside the loop at `MatrixStackPop`, which
 * Ghidra marks no-return (`L35`); the reseed and the loop's tail are the
 * disassembly's:
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {       // inline lifetime
 *     if ((s16)obj->+0x11C < (s8)++obj->+0x197) ActorKill();   // JMP
 *     obj->+0x196 = g_evt_step_index;
 * }
 * for (i = 0; i < 3; i++) {                             // EBX = 3
 *     if (--obj->+0x2A0[i] > 0) continue;               // 0x0046B4DE JG
 *     MatrixStackPush(0);
 *     MatrixTranslate(obj->+0x22C[i].x - 995.0,          // [0x005690E8]
 *                     obj->+0x22C[i].y - 12.0,           // [0x004D1D20]
 *                     -2970.7);                          // PUSH 0xC539AB33
 *     MatrixScale(0.2, obj->+0x2C0[i] * 0.2, 0.2);       // [0x004D1D24]
 *     MaxOfThreeToNoOpStub(0.2, obj->+0x2C0[i] * 0.2, 0.2);
 *     AssetDrawSlot((u32)g_scene_tick_counter % 0x18 + 0x161B);
 *     MatrixStackPop(1);                                 // Ghidra stops here
 *     if (obj->+0x2A0[i] > -12) continue;                // 0x0046B575 CMP -0xC
 *     obj->+0x2A0[i]   = rand() % 0x1F;
 *     obj->+0x22C[i].x = (float)(rand() % 7);
 *     obj->+0x22C[i].y = (float)(rand() % 5);
 *     obj->+0x2C0[i]   = rand() % 0x29 * 0.01f + 0.8f;   // [0x004D5464] [0x004C43A8]
 * }
 * ```
 *
 * `obj+0x2A0[i]` is the dword at `+0x2A0 + 4i`, `obj+0x22C[i]` the vec3 at
 * `+0x22C + 12i` (its z is never read) and `obj+0x2C0[i]` the float at
 * `+0x2C0 + 4i`.
 *
 * So each part counts its timer down and shows on every frame it reads 0
 * down to -12 — **13 frames** after a wait, 12 when the timer was already
 * 0 — and on the frame it reads -12 it draws a new timer of 0..30, a new
 * spot and a new height. The frame it reseeds on it still draws, at the old
 * spot. The timers start at 0 (the arm does not seed them), so all three
 * parts show from the first frame, for twelve frames, in lockstep.
 *
 * **The arm and the reseed draw from different ranges**: the arm seeds the
 * spot from `rand() % 9` and `rand() % 11`, the reseed from `% 7` and `% 5`,
 * so the first showing of each part can sit up to two units further right
 * and six higher than any later one. That is the code.
 *
 * No hit arm, no `AND` on `obj+0x34` and no `RegisterForShotTest`: it cannot
 * be shot, and `ActorKill` (`FUN_004A7040`) is its only exit — the inline
 * lifetime has no scene-1 sweep, and stage 3 is scene 2 anyway.
 *
 * `[proved]` all of it from `disassemble_bytes 0x0046B480..0x0046B5EC` and
 * the arm at `0x0046216C`; every float constant was read out of the image.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixScale, MatrixTranslate } from "../matrix";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";
import { PropWords } from "./words";

/**
 * The words of the object {@link PropUpdateType36} keeps that no shared
 * field carries: parts 0..2's spot as `+0x22C + 12i` (x) and
 * `+0x230 + 12i` (y), and parts 1 and 2's height as `+0x2C4`/`+0x2C8`.
 * Part 0's height is `+0x2C0`, {@link BreakableProp.shake}; the three
 * timers are `+0x2A0`/`+0x2A4`/`+0x2A8`, {@link BreakableProp.storyItem},
 * {@link BreakableProp.removeFlag} and {@link BreakableProp.cueCursorB}.
 */
interface Type36Words {
  /** Part 0's spot, whole units right of -995. */
  o22c: number;
  /** Part 0's spot, whole units above -12. */
  o230: number;
  /** Part 1's spot, x and y. */
  o238: number;
  o23c: number;
  /** Part 2's spot, x and y. */
  o244: number;
  o248: number;
  /** Parts 1 and 2's height factor, as part 0's is `shake`. */
  o2c4: number;
  o2c8: number;
}
const TYPE36_WORDS_ZERO: Type36Words = {
  o22c: 0, o230: 0, o238: 0, o23c: 0, o244: 0, o248: 0, o2c4: 0, o2c8: 0,
};

/** `MOV EBX, 3` — how many parts. */
export const TYPE36_PARTS = 3;

/** The strip: `g_scene_tick_counter % 0x18 + 0x161B`, `eff_2.bin[31..54]`. */
export const TYPE36_STRIP_SLOT = 0x161b;
export const TYPE36_STRIP_FRAMES = 0x18;

/** `FSUB [0x005690E8]` — the parts' X is their spot less this. */
export const TYPE36_BASE_X = 995.0;
/** `FSUB [0x004D1D20]` — and their Y their height less this. */
export const TYPE36_BASE_Y = 12.0;
/** `PUSH 0xC539AB33` — every part's Z. */
export const TYPE36_Z = Math.fround(-2970.7);
/** `PUSH 0x3E4CCCCD` twice and `FMUL [0x004D1D24]` — the draw scale. */
export const TYPE36_DRAW_SCALE = Math.fround(0.2);

/** `CMP EAX,-0xC; JG` — a part reseeds on the frame its timer reads this. */
export const TYPE36_SHOW_END = -12;
/** `rand() % 0x1F` — the next wait. */
export const TYPE36_WAIT_SPREAD = 0x1f;
/** `rand() % 7`, `rand() % 5` — the reseed's spot. */
export const TYPE36_RESEED_X_SPREAD = 7;
export const TYPE36_RESEED_Y_SPREAD = 5;
/** `rand() % 9`, `rand() % 11` — the arm's spot, a wider box. */
export const TYPE36_SEED_X_SPREAD = 9;
export const TYPE36_SEED_Y_SPREAD = 11;
/** `rand() % 0x29 * [0x004D5464] + [0x004C43A8]` — 0.8 .. 1.2. */
export const TYPE36_HEIGHT_SPREAD = 0x29;
export const TYPE36_HEIGHT_STEP = Math.fround(0.01);
export const TYPE36_HEIGHT_BASE = Math.fround(0.8);

/** `rand() % 0x29 * 0.01f + 0.8f`, as the `FSTP float` leaves it. */
function Type36Height(rng: Rng): number {
  return Math.fround(rng.int(TYPE36_HEIGHT_SPREAD) * TYPE36_HEIGHT_STEP
                     + TYPE36_HEIGHT_BASE);
}

/**
 * Part `i`'s three words, wherever the port keeps each of them.
 *
 * `[port-only]` as a *view*: in the engine they are three strided arrays in
 * the object and the loop walks them with pointers; the port keeps the
 * words that have a shared field in that field.
 */
interface Type36Part {
  timer: number;
  x: number;
  y: number;
  height: number;
}
function Type36GetPart(p: BreakableProp, w: Type36Words, i: number):
    Type36Part {
  switch (i) {
    case 0: return { timer: p.storyItem, x: w.o22c, y: w.o230,
                     height: p.shake };
    case 1: return { timer: p.removeFlag, x: w.o238, y: w.o23c,
                     height: w.o2c4 };
    default: return { timer: p.cueCursorB, x: w.o244, y: w.o248,
                      height: w.o2c8 };
  }
}
function Type36SetPart(p: BreakableProp, w: Type36Words, i: number,
                       v: Type36Part): void {
  switch (i) {
    case 0:
      p.storyItem = v.timer; w.o22c = v.x; w.o230 = v.y; p.shake = v.height;
      break;
    case 1:
      p.removeFlag = v.timer; w.o238 = v.x; w.o23c = v.y; w.o2c4 = v.height;
      break;
    default:
      p.cueCursorB = v.timer; w.o244 = v.x; w.o248 = v.y; w.o2c8 = v.height;
      break;
  }
}

/**
 * `PlaceGenericProp` case 0x24's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x0046216C`
 * of `PlaceGenericProp`'s switch (entry 19 of `g_place_generic_prop_arms`),
 * reached by the switch and not called:
 *
 * ```
 * 0046216c  LEA EDI,[ESI+0x2c0] ; ADD ESI,0x230 ; MOV EBX,3
 * 0046217d  CALL _rand ; CDQ ; IDIV 9    ; FILD ; FSTP [ESI-4]   (+0x22C+12i)
 * 00462195  CALL _rand ; CDQ ; IDIV 0xb  ; FILD ; FSTP [ESI]     (+0x230+12i)
 * 004621ac  CALL _rand ; CDQ ; IDIV 0x29 ; FILD ; FMUL [0x004d5464]
 *           FADD [0x004c43a8] ; FSTP [EDI-4]                     (+0x2C0+4i)
 * 004621d7  JNZ 0x0046217d ; POP EDI ; POP ESI ; POP EBP ; POP EBX ; RET
 * ```
 *
 * Three draws per part, x then y then height, part 0 first — nine in all.
 * It seeds **nothing else**: not the timers at `+0x2A0 + 4i`, which
 * `ActorClearGameFields` (`FUN_004A73D0`) left at 0, and no shot radius.
 */
export function PlaceGenericPropType36(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       rng: Rng): void {
  // `[port-only]` The engine's timers are zero because `ActorClearGameFields`
  // zeroed them; `PlaceGenericProp` restores that for `+0x2A0` but the port's
  // struct starts `+0x2A4` at the story switch's -1, so it is put back here.
  p.removeFlag = 0;
  const w = PropWords(p, TYPE36_WORDS_ZERO);
  for (let i = 0; i < TYPE36_PARTS; i++) {
    const part = Type36GetPart(p, w, i);
    part.x = rng.int(TYPE36_SEED_X_SPREAD);
    part.y = rng.int(TYPE36_SEED_Y_SPREAD);
    part.height = Type36Height(rng);
    Type36SetPart(p, w, i, part);
  }
}

/**
 * `PropUpdateType36` — `FUN_0046B480`. One prop, one 60 Hz frame.
 */
export function PropUpdateType36(p: BreakableProp, rng: Rng,
                                 _events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime, written out because it ends in `ActorKill` rather
  // than the shared prologue's `ActorDespawn`, and has no scene-1 sweep.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  const w = PropWords(p, TYPE36_WORDS_ZERO);
  for (let i = 0; i < TYPE36_PARTS; i++) {
    const part = Type36GetPart(p, w, i);
    part.timer = (part.timer - 1) | 0;
    Type36SetPart(p, w, i, part);
    if (part.timer > 0) continue;

    const m = PropMatrixPush();
    MatrixTranslate(m, Math.fround(part.x - TYPE36_BASE_X),
                    Math.fround(part.y - TYPE36_BASE_Y), TYPE36_Z);
    const sy = Math.fround(part.height * TYPE36_DRAW_SCALE);
    MatrixScale(m, TYPE36_DRAW_SCALE, sy, TYPE36_DRAW_SCALE);
    // `MaxOfThreeToNoOpStub` (`FUN_00461C20`) with the same three: dead.
    PropDrawSlot(p, m, (G.g_scene_tick_counter >>> 0) % TYPE36_STRIP_FRAMES
                       + TYPE36_STRIP_SLOT);
    // `MatrixStackPop(1)`, and the half of the loop Ghidra did not show.
    if (part.timer > TYPE36_SHOW_END) continue;
    part.timer = rng.int(TYPE36_WAIT_SPREAD);
    part.x = rng.int(TYPE36_RESEED_X_SPREAD);
    part.y = rng.int(TYPE36_RESEED_Y_SPREAD);
    part.height = Type36Height(rng);
    Type36SetPart(p, w, i, part);
  }
}
