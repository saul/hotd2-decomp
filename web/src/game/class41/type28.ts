/**
 * Class 0x41 type 28 — something in stage 2 that swings a quarter turn on a
 * script flag and plays the break sound when it gets there.
 *
 * One shipped spawn: stage 2 block 22 step 5 op 4 (evt `0xFE18`) at
 * `(-633.9, -13.7, -1302)`, yaw `0xC000`, with a three-step lifetime. Block
 * 23 step 2 op 5 raises `g_script_flags[0x60]`.
 *
 * What it is, from the assets: it draws nothing but effect 10 on motion
 * `0x1C9` — 41 pieces of `komono_5.bin` — and **never steps the clip**, so
 * what it shows is that motion's frame 0: the pieces assembled. Type 25's arm
 * gives its object the same effect and motion (`0x0046200C`). `[open]`
 * beyond "an object pivoting about a point 6.5 units from it". Which way it
 * swings in the world depends on that frame-0 pose, which is data.
 *
 * ## The whole routine, `0x00469F50`..`0x0046A02D`
 *
 * ```c
 * PropExpireByStepLifetime(obj);                      // ActorDespawn never returns
 * if (g_script_flags[0x60] == 1 && obj->+0x64 == 0) obj->+0x1D8 = 0x10;
 * if (obj->+0x1D8 > 0 && obj->+0x64 < 0x4000) {
 *     obj->+0x1D8 += 0x20;
 *     obj->+0x64 += obj->+0x1D8;
 *     if (obj->+0x64 > 0x4000) {
 *         PlaySoundId(0x1A16A9);                        // Ghidra stops here
 *         obj->+0x64 = 0x4000;                          // 0x00469FB2
 *         PoseHookNone(3, 0x14);                        // a bare RET
 *     }
 * }
 * if ((s16)g_motion_slots[obj->+0x328].state == 2) {
 *     Push; Translate(x, y, z); RotY(obj->+0x1D0); RotX(obj->+0x64);
 *     Translate(0, 0, -6.5); EffectDrawSceneLit(obj + 0x324); Pop;
 * }
 * ```
 *
 * **`PlaySoundId` is marked no-return, so the decompilation ends the last
 * frame of the swing there** and drops the clamp and the whole draw that
 * follows it for that frame (`L35`). The listing carries on: `PUSH 0x14; PUSH 0x3; MOV dword
 * [ESI+0x64],0x4000; CALL 0x00420810` and then the residency test at
 * `0x00469FC1`, which is where every other path lands as well.
 *
 * * `PropExpireByStepLifetime` (`FUN_00466640`)'s result is not tested, and
 *   need not be: its `ActorDespawn` (`FUN_00409CC0`) ends in `ActorKill`
 *   (`FUN_004A7040`) and never returns.
 * * `obj+0x64` is the actor's own X-rotation word, which the prologue does
 *   not write, so it starts at zero; here it is the **swing angle**, and the
 *   flag test is also its latch — once it has moved the flag is not read
 *   again. `obj+0x1D8` is the angular speed.
 * * The swing accelerates by `0x20` a frame from `0x10`, so after `k` frames
 *   the angle is `16k(k + 2)` BAMS: `0x3FF0` after 31, and the 32nd overshoots
 *   to `0x4400`, is clamped to `0x4000` and plays the sound. Thirty-two
 *   frames from the flag to the sound, the flag's own frame counted.
 * * The pose is `T RotY(+0x1D0) RotX(+0x64) T(0, 0, -6.5)`: the descriptor's
 *   yaw only, the swing about X after it, and the model 6.5 units along its
 *   own `-Z` (`PUSH 0xC0D00000`), so its origin is the pivot.
 * * The draw is **lit**, `EffectDrawSceneLit` (`FUN_0040DFA0`), recorded so
 *   (`PropDrawCall.sceneLit`).
 * * Nothing writes `+0x32C`, so the effect is drawn at cursor 0 for ever and
 *   `EffectDrawTree` (`FUN_0040DDC0`)'s wrap leaves it there.
 * * No hit arm, no `RegisterForShotTest` (`FUN_00405160`) and no `AND` on
 *   `obj+0x34`: not shootable.
 *
 * `[port-only]` The residency test on `g_motion_slots` (`0x009A37E0`) is
 * **not modelled**, the answer `ScriptFlagEffectUpdate` (`FUN_00473B90`)
 * gives its own: the bundle bakes the motion, so it is always resident here.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixRotateX, MatrixRotateY, MatrixTranslate } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { SFX_PROP_BREAK } from "./prop";
import {
  PropDrawBegin, PropDrawEffectSceneLit, PropMatrixPush,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";
import { PropWords } from "./words";

/** `PropUpdateType28`'s words beyond the shared fields. */
interface Type28Words {
  /**
   * `obj+0x64` — the actor's X-rotation word, used here as the swing angle in
   * BAMS: 0 at rest, `0x4000` at the end. The draw's `MatrixRotateX`.
   */
  o64: number;
}
const TYPE28_WORDS_ZERO: Type28Words = { o64: 0 };

/** `g_script_flags[0x60]` (`0x009C7260`) — swing. Stage 2 block 23 step 2. */
export const SCRIPT_FLAG_TYPE28_SWING = 0x60;

/** `MOV dword [ESI+0x1D8],0x10` — the swing's first speed, BAMS a frame. */
export const TYPE28_SWING_START = 0x10;
/** `ADD EAX,0x20` — what the speed gains every frame. */
export const TYPE28_SWING_ACCEL = 0x20;
/** `CMP ECX,0x4000` — a quarter turn, where the swing stops. */
export const TYPE28_SWING_END = 0x4000;
/** `PUSH 0xC0D00000` — the model's offset from the pivot, along Z. */
const TYPE28_PIVOT_Z = -6.5;

/** `PlaySoundId(0x1A16A9)` at the end of the swing — the group props' break. */
export const SFX_TYPE28_END = SFX_PROP_BREAK;

/** The arm's state block: effect 10 on motion `0x1C9`. */
export const TYPE28_EFFECT = 10;
export const TYPE28_MOTION = 0x1c9;

/**
 * `PlaceGenericProp` case 0x1C's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462045`
 * of `PlaceGenericProp`'s switch (entry 14 of `g_place_generic_prop_arms`):
 * `MOV dword [ESI+0x324],0xa; MOV dword [ESI+0x328],0x1c9`, and return.
 */
export function PlaceGenericPropType28(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.effect = TYPE28_EFFECT;
  p.effectVariant = TYPE28_MOTION;
}

/**
 * `PropUpdateType28` — `FUN_00469F50`. One swinging prop, one 60 Hz frame.
 *
 * `+0x1D8` is {@link BreakableProp.spin}, `+0x1D0`
 * {@link BreakableProp.yaw}, `+0x324`..`+0x330` the effect state block, and
 * `+0x64` the word in {@link Type28Words}.
 */
export function PropUpdateType28(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, TYPE28_WORDS_ZERO);
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE28_SWING] ?? 0) === 1 && w.o64 === 0) {
    p.spin = TYPE28_SWING_START;
  }
  if (p.spin > 0 && w.o64 < TYPE28_SWING_END) {
    p.spin += TYPE28_SWING_ACCEL;
    w.o64 += p.spin;
    if (w.o64 > TYPE28_SWING_END) {
      events?.emit("sound.play", { id: SFX_TYPE28_END });
      w.o64 = TYPE28_SWING_END;
      // `PoseHookNone` (`FUN_00420810`), handed (3, 0x14), is a bare `RET`.
    }
  }
  // 0x00469FC1. `g_motion_slots[obj+0x328]` resident: always (file comment).
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, w.o64);
  MatrixTranslate(m, 0, 0, TYPE28_PIVOT_Z);
  PropDrawEffectSceneLit(p, m, rng);                          // 0x0046A01D
}
