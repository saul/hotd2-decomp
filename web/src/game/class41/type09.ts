/**
 * Class 0x41 type 9 — stage 1's church window, whole and then shattering.
 *
 * One shipped spawn: stage 1 block 1 step 2 op 15 (evt `0x1944`), placed at
 * the origin with a descriptor lifetime of 1 that the routine never reads.
 * Block 1 step 5 op 35 raises `g_script_flags[0x1F]`.
 *
 * What it is, from the asset slots and nothing else: `0x123B` and `0x123C`
 * are `kyoukai_garasu.bin[0]` and `[1]` — *kyoukai garasu*, church glass —
 * and the two effect trees it draws once the flag is up, 8 and 9, are 168
 * more pieces of the same file. So a pane drawn whole, then a second model
 * with the shards of both trees flying out of it. `[likely]` a window and its
 * frame; nothing in the code names them.
 *
 * ## The whole routine, `0x00472830`..`0x00472946`
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {        // inlined lifetime
 *     if ((s8)++obj->+0x197 > 5) { ActorKill(); return; } // 0x00472856
 *     obj->+0x196 = g_evt_step_index;
 * }
 * if (g_script_flags[0x1F] == 1 && obj->+0x32C < 0x4E) obj->+0x32C++;
 * if (obj->+0x32C == 0) {
 *     Push; Translate(0, 0, -5.0); AssetDrawSlot(0x123B); Pop; return;
 * }
 * if ((s16)g_motion_slots[0x1D0].state == 2       // CMP word [0x009A4664], 2
 *     && (s16)g_motion_slots[0x1D1].state == 2) { // CMP word [0x009A466C], 2
 *     Push; Translate(0, 0, -5.0); AssetDrawSlot(0x123C);
 *     Translate(-0.7741, -0.0591, -171.08);
 *     obj->+0x328 = 0x1D0; obj->+0x324 = 8; EffectDrawUnlit(obj + 0x324);
 *     obj->+0x324 = 9; obj->+0x328 = 0x1D1; EffectDrawUnlit(obj + 0x324);
 *     Pop;
 * }
 * ```
 *
 * `[proved]` from the listing, every instruction of it: the `MatrixStackPop`
 * Ghidra marks no-return is the last call in both draw arms, so the
 * pseudocode happens to be whole here. Things the pseudocode does not say:
 *
 * * **The lifetime is the literal 5**, `CMP AL,0x5; JLE` at `0x00472856`, a
 *   signed byte compare. `obj+0x11C` is never read, so the descriptor's 1 is
 *   decoration and the window lives through five step changes and dies on the
 *   sixth. `ActorKill` (`FUN_004A7040`), not `ActorDespawn`, and **no scene-1
 *   sweep**: this is not `PropExpireByStepLifetime` (`FUN_00466640`).
 * * **The flag test is `== 1`** (`CMP byte [0x009C721F],0x1`), not non-zero.
 * * **Its own position is never read.** Both draws translate from the view by
 *   the literal `(0, 0, -5.0)` — `PUSH 0xC0A00000; PUSH 0; PUSH 0` — so the
 *   pane is modelled in world space, and the one spawn's origin placement is
 *   the only one that could look right in any case.
 * * **The two effect draws share one state block and one matrix.** The
 *   routine rewrites `+0x324`/`+0x328` between them and leaves `9`/`0x1D1` in
 *   them afterwards; the cursor `+0x32C` is shared, and so is the previous
 *   frame `EffectDrawTree` (`FUN_0040DDC0`) writes at `+0x330` — the second
 *   tree sees the first one's write. Both motions are 80 play frames
 *   (`g_motion_play_length[0x1D0]` and `[0x1D1]` at `0x004E0B70`/`0x004E0B72`),
 *   so the tree's wrap at `play_length - 1` is never reached: the cursor runs
 *   1..78 and holds on 78, the last frame of both.
 * * No hit arm, no `RegisterForShotTest` (`FUN_00405160`) and no `AND` on
 *   `obj+0x34`: the window is not shootable, the script breaks it.
 *
 * The residency test on `g_motion_slots` (`0x009A37E0`, `{u32 base; u32
 * state}` per motion, and `0x009A37E4 + 8 * 0x1D0` is `0x009A4664`) is
 * `[port-only]` **not modelled**, the answer `ScriptFlagEffectUpdate`
 * (`FUN_00473B90`) and class 0x41 type 44 give theirs: the bundle bakes the
 * motion, so the port's answer to "is it resident" is always yes. In the
 * engine an arm whose clips were not resident would draw nothing at all —
 * neither `0x123C` nor the shards — for as long as they were not; whether
 * stage 1 ever reaches this arm before its asset job has loaded them is
 * `[open]`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixTranslate } from "../matrix";
import { ActorKillProp } from "./prop";
import {
  PropDrawBegin, PropDrawEffect, PropDrawSlot, PropMatrixPush,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `g_script_flags[0x1F]` (`0x009C721F`) — break it. Stage 1 block 1 step 5. */
export const SCRIPT_FLAG_TYPE9_BREAK = 0x1f;

/** `CMP AL,0x5` at `0x00472856` — step changes it lives through. */
export const TYPE9_LIFETIME_STEPS = 5;
/** `CMP EAX,0x4E` — where the shatter cursor holds: `play_length - 2`. */
export const TYPE9_LAST_FRAME = 0x4e;

/** `0x123B` — `kyoukai_garasu.bin[0]`, drawn while the cursor is 0. */
export const TYPE9_WHOLE_SLOT = 0x123b;
/** `0x123C` — `kyoukai_garasu.bin[1]`, drawn under the shatter. */
export const TYPE9_BROKEN_SLOT = 0x123c;

/** `PUSH 0xC0A00000` — both draws' Z, from the view: world space. */
const TYPE9_Z = -5.0;
/**
 * The shatter's offset from that point, `PUSH 0xC32B147B; PUSH 0xBD7212D7;
 * PUSH 0xBF462B6B` at `0x004728F4` — float32 bit patterns, read off the
 * instruction stream (`L1`).
 */
const TYPE9_SHATTER_X = Math.fround(-0.7741);
const TYPE9_SHATTER_Y = Math.fround(-0.0591);
const TYPE9_SHATTER_Z = Math.fround(-171.08);

/** The two effect trees and their clips, as the routine writes them. */
export const TYPE9_EFFECT_A = 8;
export const TYPE9_MOTION_A = 0x1d0;
export const TYPE9_EFFECT_B = 9;
export const TYPE9_MOTION_B = 0x1d1;

/**
 * `PlaceGenericProp` case 9's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461ED3`
 * of `PlaceGenericProp`'s switch (entry 3 of `g_place_generic_prop_arms`):
 *
 * ```
 * 00461ED3  MOV dword ptr [ESI+0x324], 0x8
 * 00461EDD  MOV dword ptr [ESI+0x328], 0x1d0
 * 00461EE7  JMP 0x00462083
 * 00462083  MOV EAX,0x3f800000              ; 1.0f
 * 00462089  MOV [ESI+0x1a8],EAX ; MOV [ESI+0x1ac],EAX ; MOV [ESI+0x1b0],EAX
 * ```
 *
 * The three 1.0s are the tail this arm shares with others; the routine never
 * reads `+0x1A8..+0x1B0`, and they are set because the arm sets them.
 */
export function PlaceGenericPropType9(p: BreakableProp,
                                      pl: BreakablePlacement,
                                      rng: Rng): void {
  void pl; void rng;
  p.effect = TYPE9_EFFECT_A;
  p.effectVariant = TYPE9_MOTION_A;
  p.restX = 1.0;
  p.restY = 1.0;
  p.restZ = 1.0;
}

/**
 * `PropUpdateType9` — `FUN_00472830`. One window, one 60 Hz frame.
 *
 * `+0x196` is {@link BreakableProp.lastStepIndex}, `+0x197`
 * {@link BreakableProp.stepsElapsed}, and `+0x324`..`+0x330` the effect state
 * block ({@link BreakableProp.effect}, `effectVariant`, `effectFrames`,
 * `effectPrevFrame`).
 */
export function PropUpdateType9(p: BreakableProp, rng: Rng,
                                events?: Events): void {
  void events;
  PropDrawBegin(p);
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > TYPE9_LIFETIME_STEPS) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE9_BREAK] ?? 0) === 1
      && p.effectFrames < TYPE9_LAST_FRAME) {
    p.effectFrames += 1;
  }
  if (p.effectFrames === 0) {
    const m = PropMatrixPush();
    MatrixTranslate(m, 0, 0, TYPE9_Z);
    PropDrawSlot(p, m, TYPE9_WHOLE_SLOT);
    return;
  }
  // `g_motion_slots[0x1D0]` and `[0x1D1]` resident: always, in the port (see
  // the file comment).
  const m = PropMatrixPush();
  MatrixTranslate(m, 0, 0, TYPE9_Z);
  PropDrawSlot(p, m, TYPE9_BROKEN_SLOT);
  MatrixTranslate(m, TYPE9_SHATTER_X, TYPE9_SHATTER_Y, TYPE9_SHATTER_Z);
  p.effectVariant = TYPE9_MOTION_A;
  p.effect = TYPE9_EFFECT_A;
  PropDrawEffect(p, m, rng);
  p.effect = TYPE9_EFFECT_B;
  p.effectVariant = TYPE9_MOTION_B;
  PropDrawEffect(p, m, rng);
}
