/**
 * Class 0x41 type 62 — eight copies of one water effect, turned to face the
 * camera, standing in two rows of four in stage 6 until the script raises
 * `g_script_flags[0]`.
 *
 * One shipped spawn: descriptor `0x2080`, in the spawn list stage 6 block 2
 * step 1 op 12 places, at the origin with a one-step lifetime that the
 * routine never reads. Every copy is drawn at a world literal.
 *
 * What it draws: effect `0x1C` on motion `0x1C6`, whose tree is six nodes
 * drawing `water.bin[0..5]` (slots `0xC8`..`0xCD`) and whose clip is 100
 * frames long. `[open]` what the water is — a spout, a splash, a fall.
 *
 * The whole routine, `0x0046FA10`..`0x0046FB47`. The pseudocode is garbled
 * — Ghidra typed it `__thiscall`, folded the draw out of the loop and ends
 * it at `MatrixStackPop` — so this is the disassembly:
 *
 * ```c
 * if (g_script_flags[0] == 1) { ActorKill(); return; }   // CMP byte [0x009C7200]
 * for (i = 0; i < 8; i++) {                              // EBP
 *     if (i < 4) { z = -9605.0; x = i * 24.0 + 79.0; }   // 0xC6161400 [0x004ECB84] [0x00569024]
 *     else { z = -9568.0; x = (i - 4) * 24.0 + 65.0; }   // 0xC6158000 [0x00569130]
 *     if (++obj->+0x2A0[i] > 100) obj->+0x2A0[i] = 0;    // 0x0046FA82 CMP 0x64
 *     obj->+0x32C = obj->+0x2A0[i];                      // the effect's frame
 *     yaw = (s16)ftol(atan2(x - eye.x, z - eye.z) * 65536/2pi);  // FPATAN, [0x004C4378]
 *     if (g_motion_slots[0x1C6].state == 2) {            // CMP word [0x009A4614], 2
 *         MatrixStackPush(0);
 *         MatrixTranslate(x, 2510.0, z);                 // PUSH 0x451CE000
 *         MatrixRotateY(yaw + 0x8000);
 *         MatrixScale(0.3, 0.3, 0.3);                    // PUSH 0x3E99999A x3
 *         0x0040DF70(obj + 0x324, 0.3);                  // EffectDrawUnlit, scaled
 *         MatrixStackPop(1);
 *     }
 * }
 * ```
 *
 * `eye` is `g_camera_block_eye` — `0x009A60C0`, indexed by
 * `g_camera_index * 0x1A4`, which the port's single camera block collapses.
 * `obj+0x2A0[i]` is the dword at `+0x2A0 + 4i`, eight play cursors, one per
 * copy, all driving the one state block at `obj+0x324`.
 *
 * `0x0040DF70` is `EffectDrawUnlit` (`FUN_0040DD90`) with one more argument:
 * it stores its second argument in the draw's scale global at `0x007C1780`
 * where `EffectDrawUnlit` stores 1.0, and `EffectDrawNode` (`FUN_0040DE50`)
 * hands that global to `NoOpStub` (`FUN_0041EBB0`) and to nothing else
 * (`0x0040DEBD`..`0x0040DEDC`). So the 0.3 there changes nothing; the
 * `MatrixScale` before it is the whole of the shrink. `[proved]`
 *
 * **Only the first cursor is random.** `PlaceGenericProp`'s arm calls
 * `rand()` eight times and stores every one into `+0x2A0` itself — `ESI` is
 * never advanced — so seven draws are thrown away, copy 0 starts somewhere in
 * 0..99 and copies 1..7 start at 0 and play in lockstep. It reads like a slip
 * for `+0x2A0 + 4i`; it is transcribed as it is.
 *
 * The cursor runs 1..100 and wraps to 0, and `EffectDrawTree` (`FUN_0040DDC0`)
 * wraps the frame it is handed at `play_length - 1`, so for this 100-frame
 * clip the cursor's 99 and 100 both draw frame 0. The previous-frame word at
 * `obj+0x330` is shared by all eight, so each copy's is the copy before's.
 *
 * No hit arm, no `AND` on `obj+0x34`, no `RegisterForShotTest`, and no
 * lifetime: `ActorKill` (`FUN_004A7040`) on the script flag is its only exit.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import {
  FtolS16, MatrixRotateY, MatrixScale, MatrixTranslate, RADIANS_TO_BAMS,
} from "../matrix";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawEffect, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";
import { PropWords } from "./words";

/**
 * The words of the object {@link PropUpdateType62} keeps that no shared
 * field carries: copies 3..7's play cursors at `+0x2AC`..`+0x2BC`. Copies
 * 0..2's are `+0x2A0`/`+0x2A4`/`+0x2A8`, {@link BreakableProp.storyItem},
 * {@link BreakableProp.removeFlag} and {@link BreakableProp.cueCursorB}.
 */
interface Type62Words {
  o2ac: number;
  o2b0: number;
  o2b4: number;
  o2b8: number;
  o2bc: number;
}
const TYPE62_WORDS_ZERO: Type62Words = {
  o2ac: 0, o2b0: 0, o2b4: 0, o2b8: 0, o2bc: 0,
};
const TYPE62_WORD_KEYS = ["o2ac", "o2b0", "o2b4", "o2b8", "o2bc"] as const;

/** `g_script_flags[0]` (`CMP byte ptr [0x009C7200], 1`) — take them away. */
export const SCRIPT_FLAG_TYPE62_REMOVE = 0;

/** `MOV dword [ESI+0x324], 0x1C` — the effect id. */
export const TYPE62_EFFECT = 0x1c;
/** `MOV dword [ESI+0x328], 0x1C6` — its motion. */
export const TYPE62_MOTION = 0x1c6;

/** `CMP EBP, 8` — how many copies. */
export const TYPE62_COPIES = 8;
/** `CMP EBP, 4` — the first row's length. */
export const TYPE62_ROW = 4;
/** `FMUL [0x004ECB84]` — the spacing along a row. */
export const TYPE62_SPACING = 24.0;
/** `FADD [0x00569024]`, `MOV [ESP+0x18], 0xC6161400` — row 0's start. */
export const TYPE62_ROW0_X = 79.0;
export const TYPE62_ROW0_Z = -9605.0;
/** `FADD [0x00569130]`, `MOV [ESP+0x18], 0xC6158000` — row 1's. */
export const TYPE62_ROW1_X = 65.0;
export const TYPE62_ROW1_Z = -9568.0;
/** `PUSH 0x451CE000` — every copy's height. */
export const TYPE62_Y = 2510.0;
/** `PUSH 0x3E99999A` — the uniform scale. */
export const TYPE62_SCALE = Math.fround(0.3);
/** `ADD EDI, 0x8000` — the model faces away from the bearing to the eye. */
export const TYPE62_FACE_TURN = 0x8000;
/** `CMP EAX, 0x64; JLE` — a cursor past this goes back to 0. */
export const TYPE62_CURSOR_WRAP = 0x64;
/** `rand() % 0x64` — the arm's cursor seed. */
export const TYPE62_CURSOR_SPREAD = 0x64;
/** `MOV EDI, 8` — how many times the arm calls `rand()`. */
export const TYPE62_SEED_DRAWS = 8;

/**
 * Copy `i`'s play cursor, `obj+0x2A0 + 4i`, wherever the port keeps it.
 * `[port-only]` as a function: the engine walks the words with a pointer.
 */
function Type62Cursor(p: BreakableProp, w: Type62Words, i: number): number {
  if (i === 0) return p.storyItem;
  if (i === 1) return p.removeFlag;
  if (i === 2) return p.cueCursorB;
  return w[TYPE62_WORD_KEYS[i - 3]];
}
function Type62SetCursor(p: BreakableProp, w: Type62Words, i: number,
                         v: number): void {
  if (i === 0) p.storyItem = v;
  else if (i === 1) p.removeFlag = v;
  else if (i === 2) p.cueCursorB = v;
  else w[TYPE62_WORD_KEYS[i - 3]] = v;
}

/**
 * `PlaceGenericProp` case 0x3E's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004624D3`
 * of `PlaceGenericProp`'s switch (entry 30 of `g_place_generic_prop_arms`),
 * reached by the switch and not called:
 *
 * ```
 * 004624d3  MOV dword ptr [ESI+0x324], 0x1c
 * 004624dd  MOV dword ptr [ESI+0x328], 0x1c6
 * 004624e7  MOV EDI, 8
 * 004624ec  CALL _rand ; CDQ ; MOV ECX,0x64 ; IDIV ECX ; DEC EDI
 * 004624fa  MOV dword ptr [ESI+0x2a0], EDX      ; ESI never moves
 * 00462500  JNZ 0x004624ec ; POP EDI ; POP ESI ; POP EBP ; POP EBX ; RET
 * ```
 *
 * Eight draws of the generator, and only the last survives.
 */
export function PlaceGenericPropType62(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       rng: Rng): void {
  // `[port-only]` `ActorClearGameFields` (`FUN_004A73D0`) zeroed copies 1..7's
  // cursors; the port's struct starts `+0x2A4` at the story switch's -1, so it
  // is put back to the engine's zero here.
  p.removeFlag = 0;
  PropWords(p, TYPE62_WORDS_ZERO);
  p.effect = TYPE62_EFFECT;
  p.effectVariant = TYPE62_MOTION;
  for (let k = 0; k < TYPE62_SEED_DRAWS; k++) {
    p.storyItem = rng.int(TYPE62_CURSOR_SPREAD);
  }
}

/**
 * `PropUpdateType62` — `FUN_0046FA10`. One prop, one 60 Hz frame.
 *
 * `+0x324`/`+0x328`/`+0x32C`/`+0x330` are {@link BreakableProp.effect},
 * {@link BreakableProp.effectVariant}, {@link BreakableProp.effectFrames} and
 * {@link BreakableProp.effectPrevFrame}: the one state block all eight
 * copies draw through.
 *
 * `[port-only]` **The residency test is not modelled.**
 * `g_motion_slots[0x1C6].state == 2` gates each copy's draw; the bundle
 * bakes the motion with the effect's tree or carries neither, and
 * {@link PropDrawEffect} draws nothing and writes nothing when the record
 * is absent — which is what the engine does when the motion is not
 * resident. The same answer `ScriptFlagEffectUpdate` and
 * `PropUpdateType44` give their own residency tests.
 */
export function PropUpdateType62(p: BreakableProp, rng: Rng,
                                 _events?: Events): void {
  PropDrawBegin(p);
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE62_REMOVE] ?? 0) === 1) {
    ActorKillProp(p);
    return;
  }
  const w = PropWords(p, TYPE62_WORDS_ZERO);
  const eye = G.g_camera_block_eye;
  for (let i = 0; i < TYPE62_COPIES; i++) {
    let x: number, z: number;
    if (i < TYPE62_ROW) {
      z = TYPE62_ROW0_Z;
      x = Math.fround(i * TYPE62_SPACING + TYPE62_ROW0_X);
    } else {
      z = TYPE62_ROW1_Z;
      x = Math.fround((i - TYPE62_ROW) * TYPE62_SPACING + TYPE62_ROW1_X);
    }
    const c = (Type62Cursor(p, w, i) + 1) | 0;
    Type62SetCursor(p, w, i, c > TYPE62_CURSOR_WRAP ? 0 : c);
    p.effectFrames = Type62Cursor(p, w, i);
    // `FPATAN` on the FPU stack, `FMUL double [0x004C4378]`, `__ftol`
    // (`0x004ACF50`) and `MOVSX EDI, AX`.
    const yaw = FtolS16(Math.atan2(x - eye.x, z - eye.z) * RADIANS_TO_BAMS);

    const m = PropMatrixPush();
    MatrixTranslate(m, x, TYPE62_Y, z);
    MatrixRotateY(m, yaw + TYPE62_FACE_TURN);
    MatrixScale(m, TYPE62_SCALE, TYPE62_SCALE, TYPE62_SCALE);
    PropDrawEffect(p, m, rng);
    // `MatrixStackPop(1)`.
  }
}
