/**
 * Class 0x41 type 64 — a part of stage 2's sluice-gate scenery that rocks
 * back and forth on a fixed rhythm.
 *
 * One shipped spawn: stage 2 block 17 step 1 op 31 (descriptor `0xBE88`),
 * placed at `(-671, 38.5, -1498)` with a four-step lifetime and all three
 * orientation words zero.
 *
 * What it is, from the asset slots and nothing else: both models are
 * `komono_suimonie.bin` — `0x1A39` is entry 8 and `0x0C27` entry 0.
 * *Suimon* is a sluice gate, which names the file and not necessarily the
 * object. `[open]` beyond "a body and a part 18 units up it that rolls".
 *
 * The whole routine, `0x0046FBE0`..`0x0046FCBC` — Ghidra's body ends at the
 * `MatrixStackPop` and the pseudocode is complete, because nothing follows
 * the pop but the epilogue:
 *
 * ```c
 * PropExpireByStepLifetime(obj);                 // 0x0046FBE6, not tested
 * v = obj->+0x2A0;
 * if (abs(v) > 60) obj->+0x2A4 = -obj->+0x2A4;   // 0x0046FBFC CMP ECX,0x3C
 * obj->+0x1D4 += v;                              // the roll takes the OLD v
 * obj->+0x2A0 = obj->+0x2A4 + v;
 * MatrixStackPush(0);
 * MatrixTranslate(obj->+0x19C, obj->+0x1A0, obj->+0x1A4);
 * MatrixRotateY(obj->+0x1D0);
 * MatrixScale(0.7, 0.7, 0.7); NoOpStub(0.7);     // PUSH 0x3F333333 x3, x1
 * AssetDrawSlot(0x1A39);
 * MatrixTranslate(0, 18.0, 0);                   // PUSH 0x41900000
 * MatrixRotateZ(obj->+0x1D4); NoOpStub(0.7);
 * AssetDrawSlot(0x0C27);
 * MatrixStackPop(1);
 * ```
 *
 * `PropExpireByStepLifetime`'s result is not tested, and does not need to
 * be: `ActorDespawn` (`FUN_00409CC0`) ends in `ActorKill` (`FUN_004A7040`),
 * which longjmps out of the task walk, so a prop that expires runs nothing
 * after it. `if (...) return` is that longjmp.
 *
 * So the rocker is a **bang-bang oscillator**: the rate `+0x2A0` starts at
 * -32 and steps by the acceleration `+0x2A4` (-2) each frame, and the frame
 * the rate it *started* the frame with is past ±60 the acceleration flips.
 * The rate therefore runs -32, -34 … -62, -60 … +62, +60 …, one full swing
 * every 124 frames, and the roll it drives starts at the arm's `0x400`.
 *
 * The second part is drawn **inside the first part's scale**, so its 18.0 is
 * 12.6 world units up the body's own Y, and it rolls about Z by `+0x1D4`
 * after its yaw. No hit arm, no `AND` on `obj+0x34` and no
 * `RegisterForShotTest`: it cannot be shot.
 *
 * `[proved]` every line above, from `disassemble_bytes` over the whole routine
 * and the arm at `0x00462507`; every float is a `PUSH imm32` quoted in hex.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import {
  MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `0x1A39` — `komono_suimonie.bin[8]`, the body. */
export const TYPE64_BODY_SLOT = 0x1a39;
/** `0x0C27` — `komono_suimonie.bin[0]`, the part that rolls. */
export const TYPE64_ROCKER_SLOT = 0x0c27;

/** `PUSH 0x3F333333` — the uniform scale both parts are drawn at. */
export const TYPE64_SCALE = Math.fround(0.7);
/** `PUSH 0x41900000` — the rocker's height above the body, pre-scale. */
export const TYPE64_ROCKER_RISE = 18.0;
/** `CMP ECX,0x3C` — past this magnitude of rate the acceleration flips. */
export const TYPE64_RATE_LIMIT = 0x3c;

/** `MOV dword [ESI+0x1D4], 0x400` — the arm's starting roll. */
export const TYPE64_START_ROLL = 0x400;
/** `MOV dword [ESI+0x2A0], 0xFFFFFFE0` — the starting rate, BAMS a frame. */
export const TYPE64_START_RATE = -32;
/** `MOV dword [ESI+0x2A4], 0xFFFFFFFE` — the rate's step, BAMS a frame². */
export const TYPE64_START_ACCEL = -2;

/**
 * `PlaceGenericProp` case 0x40's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462507`
 * of `PlaceGenericProp`'s switch (entry 31 of `g_place_generic_prop_arms`,
 * which `g_place_generic_prop_arm_index` holds for `64 - 6`), reached by the
 * switch and not called:
 *
 * ```
 * 00462507  MOV dword ptr [ESI+0x1d4], 0x400
 * 00462511  MOV dword ptr [ESI+0x2a0], 0xffffffe0
 * 0046251b  MOV dword ptr [ESI+0x2a4], 0xfffffffe
 * 00462525  POP EDI ; POP ESI ; POP EBP ; POP EBX ; RET
 * ```
 *
 * The roll it writes replaces the one the prologue copied off the
 * descriptor's third orientation word, so that word means nothing to this
 * type. `+0x2A0` is {@link BreakableProp.storyItem} and `+0x2A4`
 * {@link BreakableProp.removeFlag}, the fields that own those offsets; to
 * this routine they are the rocker's rate and its acceleration.
 */
export function PlaceGenericPropType64(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.roll = TYPE64_START_ROLL;
  p.storyItem = TYPE64_START_RATE;
  p.removeFlag = TYPE64_START_ACCEL;
}

/**
 * `PropUpdateType64` — `FUN_0046FBE0`. One prop, one 60 Hz frame.
 *
 * `+0x2A0` is {@link BreakableProp.storyItem} (the rocker's rate), `+0x2A4`
 * {@link BreakableProp.removeFlag} (its acceleration), `+0x1D4`
 * {@link BreakableProp.roll} (the rocker's angle) and `+0x1D0`
 * {@link BreakableProp.yaw} (the whole prop's heading, the descriptor's).
 */
export function PropUpdateType64(p: BreakableProp, _rng: Rng,
                                 _events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;

  const rate = p.storyItem;
  if (Math.abs(rate) > TYPE64_RATE_LIMIT) p.removeFlag = -p.removeFlag;
  p.roll = (p.roll + rate) | 0;
  p.storyItem = (p.removeFlag + rate) | 0;

  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixScale(m, TYPE64_SCALE, TYPE64_SCALE, TYPE64_SCALE);
  // `NoOpStub(0.7)` (`FUN_0041EBB0`) -- a bare `RET`.
  PropDrawSlot(p, m, TYPE64_BODY_SLOT);
  MatrixTranslate(m, 0, TYPE64_ROCKER_RISE, 0);
  MatrixRotateZ(m, p.roll);
  // `NoOpStub(0.7)` again.
  PropDrawSlot(p, m, TYPE64_ROCKER_SLOT);
  // `MatrixStackPop(1)`, and the routine returns.
}
