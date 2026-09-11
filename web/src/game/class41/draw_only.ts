/**
 * The three class-0x41 generic types whose whole routine is a draw, a pose and
 * one rule about when to stop.
 *
 * They are here because {@link GENERIC_DESCRIPTOR_SLOT} could not have them
 * until they were: adding a type to that set makes its model travel in the
 * bundle **and** draw, so a type whose own arm is unported arrives in the
 * level wearing the right geometry and doing the wrong thing. Type 54 is the
 * clearest case — its drift is authored, identical for every spawn, and a
 * naive add would have put a static model where the game has one tumbling
 * away over five seconds.
 *
 * **All three tails were hidden from the decompiler**, and two of them matter.
 * `MatrixStackPop` is marked no-return, so Ghidra ends the function body at
 * the `CALL` and the pseudocode stops there (`L37`, and `L35` one level
 * further out). `disassemble_bytes` from the address the body claims to end at
 * is what found: type 31's slot-strip wrap, and type 53's two camera-facing
 * billboards. Read literally, the pseudocode said type 31 draws one fixed
 * model and type 53 draws nothing but its body.
 */
import { G } from "../globals";
import { ActorDespawnProp, ActorKillProp } from "./prop";
import type { BreakableProp } from "./prop_state";

/**
 * `g_script_flags[12]` — what `PropDrawOnlyType54` drifts on.
 *
 * **Not a global of its own.** Ghidra carries the address as `DAT_009C720C`,
 * which hides that `0x009C7200` is `g_script_flags` and this is element 12.
 * A flag number means whatever the scene using it means by it, and this one
 * has three unrelated jobs: `Class14StateSummonRoundB` raises it as the
 * stage-2 boss's summon gate, stage 5's script raises it in block 5 step 2 to
 * start this drift, and stage 6's raises it in seven separate blocks.
 */
export const SCRIPT_FLAG_TYPE54_DRIFT = 12;

/**
 * `g_active_cam_path` and `g_cam_path_frame` at which
 * {@link PropDrawOnlyType31} removes itself.
 *
 * A cue and not a lifetime: it is an exact-frame equality on the camera's own
 * clock, so it fires on the one frame the path is at 0x1D6 and never if the
 * stage takes a route that does not play path 0x84.
 */
export const TYPE31_DESPAWN_CAM_PATH = 0x84;
export const TYPE31_DESPAWN_CAM_FRAME = 0x1d6;

/** `PropDrawOnlyType54`'s drift runs for this many frames and then kills. */
export const TYPE54_DRIFT_FRAMES = 300;

/**
 * `PropDrawOnlyType31` — `FUN_0046A1C0`.
 *
 * Six shipped spawns, and every one of them an **effect strip**: stage 1's
 * draws `eff_1.bin[8..46]`, stage 3's three `eff_taki.bin[0..9]` and stage
 * 4's two `eff_taki.bin[30..59]`. The routine draws
 * `(s16)obj+0x28C + (s32)obj+0x2A0` and then, past the `MatrixStackPop`
 * Ghidra stops at, steps the cursor and wraps it:
 *
 * ```
 * 0046a334  MOV EDX,[ESI+0x2a0] ; MOV ECX,[ESI+0x2a4]
 * 0046a343  INC EDX ; MOV EAX,EDX ; MOV [ESI+0x2a0],EDX
 * 0046a34c  CMP EAX,ECX ; JLE +a ; MOV dword [ESI+0x2a0],0
 * ```
 *
 * The compare is on the **post-increment** value and the reset is in the same
 * frame, so a descriptor roll word of `n` is an `n + 1`-frame loop showing
 * cursors `0 .. n` and never `n + 1`: stage 3's 9 is ten frames of
 * `eff_taki.bin`. `PlaceGenericProp` case 0x1F gives `obj+0x2A4` the placer's
 * `+0x6C`, so that length is the spawn descriptor's third orientation word —
 * which the prologue also copies to `obj+0x1D4` and the routine also applies
 * as a Z rotation of a fifth of a degree. Both readings are the engine's.
 *
 * The despawn ahead of the draw is a camera cue, not a lifetime;
 * `PropExpireByStepLifetime` runs before it, in `GenericPropUpdate`.
 *
 * **One frame of phase**, and it is the port's shape rather than a reading:
 * the engine draws with `obj+0x2A0` and steps it *after* the draw, where the
 * port's pool update runs before the renderer reads the field. So the engine
 * shows `0, 1, … n` from its first frame and the port shows `1, … n, 0` — the
 * same loop, one frame along. Compensating for it in `render/breakables.ts`
 * would put arithmetic in the draw that the engine's draw does not have, and
 * the one-frame lead is the same approximation every routine in this family
 * that mutates after drawing already gets. `PropDrawOnlyType54`, which
 * mutates *before* it draws, has no lead at all.
 *
 * `[open]` In **scene 2 block 11 only** the routine draws two more copies of
 * `AssetDrawSlot(g_scene_tick_counter % 7 + 0x1797)`, one 55.0 lower and one
 * half a turn round and 3.0 further out. That arm is **unreachable in the
 * shipped data** and so is not ported: scene 2 is stage 3, whose only type-31
 * spawns are placed in block 4, and stage 3's route table reaches block 11
 * only along `0 -> 1 -> 2 -> 11`, which never visits block 4 — block 4
 * branches to 5 or 10, both of which go to 6 and then to block 13's end.
 * A port that seeks straight to block 11 places no type-31 prop there either.
 */
export function PropDrawOnlyType31(p: BreakableProp): void {
  if (G.g_active_cam_path === TYPE31_DESPAWN_CAM_PATH
      && G.g_cam_path_frame === TYPE31_DESPAWN_CAM_FRAME) {
    ActorDespawnProp(p);
    return;
  }
  // The draw is the renderer's; the cursor it reads is this.
  p.storyItem += 1;
  if (p.storyItem > p.removeFlag) p.storyItem = 0;
}

/**
 * `PropDrawOnlyType53` — `FUN_0046EBD0`.
 *
 * Two spawns, both stage 5, both drawing `char_adv04.bin[0]` at the spawn's
 * own pose. Its head is an **inline variant of
 * `PropExpireByStepLifetime`** with the scene-1 sweep left out:
 *
 * ```c
 * if ((short)g_evt_step_index != obj->+0x196) {
 *     if (obj->+0x11C < (short)++obj->+0x197) { ActorKill(obj); return; }
 *     obj->+0x196 = g_evt_step_index;
 * }
 * ```
 *
 * Two differences from the shared prologue and both are transcribed: no
 * sweep, and `ActorKill` (`0x004A7040`) where the prologue calls
 * `ActorDespawn` (`0x00409CC0`). Neither of its spawns is in scene 1, so the
 * sweep could not fire for them — which is the reason to write the routine
 * out rather than reuse the prologue, not a reason to reuse it (`L27`).
 *
 * `[open]` Past the `MatrixStackPop`, at `0x0046EC6D`–`0x0046EDB9`, the
 * routine draws **two more parts whenever `g_evt_block_index` is 4 or 5** —
 * and block 4 is where one of the two spawns is placed, so this is live in the
 * shipped game. Both face the camera on a yaw computed from
 * `g_camera_pose[0]`, and both are animated strips driven by
 * `g_scene_tick_counter`: `% 15 + 0x135F` (`char_adv04.bin[79..93]`) scaled
 * 1.5/2.0/1.0, and `& 7 + 0xB67` (`char_adv00.bin[1..8]`) scaled 7.0 and
 * pushed 10.0 out. Unported: a camera-facing billboard is a render primitive
 * the port has nowhere to put yet, and its slots are deliberately kept out of
 * the bundle rather than travelling unused.
 */
export function PropDrawOnlyType53(p: BreakableProp): void {
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
}

/**
 * `PropDrawOnlyType54` — `FUN_0046EDC0`.
 *
 * One spawn in stage 5 at `st5_02b.bin[6]` and one in the training scene, and
 * the only thing it does is **drift while `g_script_flags[12]` is raised**:
 *
 * ```
 * 0046edce  FLD [ESI+0x1c0] ; FADD [ESI+0x19c] ; FSTP [ESI+0x19c]
 *           obj+0x1CC += obj+0x1D8 ; obj+0x1D0 += obj+0x1DC
 *           obj+0x1A0 += obj+0x1C4 ; obj+0x1A4 += obj+0x1C8
 * 0046ee14  CMP EAX,0x12C          ; EAX is obj+0x2A0 BEFORE the increment
 * 0046ee34  MOV [ESI+0x2a0],EAX+1
 * 0046ee40  JLE draw ; CALL ActorKill
 * ```
 *
 * The comparison is on the **pre-increment** count, so the frames that read
 * 0..300 drift and draw — 301 of them — and the frame that reads 301 kills.
 * `PlaceGenericProp` case 0x36 seeds the five rates, so every spawn drifts
 * identically: 5.0 in X, 1.5 up and -4.0 in Z a frame, pitching `0x300` and
 * yawing `-0x400`.
 *
 * There is no lifetime prologue and no other exit. Stage 5's script raises
 * flag 12 in block 5 step 2 and **every** branch out of block 4 reaches block
 * 5 — block 4 branches to 5 or 6, and block 6 gotos 5 — so the shipped spawn
 * always drifts. The training scene raises flags 4, 5, 6, 7, 224, 242 and 243
 * and never 12, so its copy stands where it was placed for the whole scene;
 * that is the engine's behaviour and not a gap.
 */
export function PropDrawOnlyType54(p: BreakableProp): void {
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] ?? 0) !== 1) return;
  const frames = p.storyItem;
  p.pitch += p.spin;
  p.x += p.vx;
  p.yaw += p.yawSpin;
  p.y += p.vy;
  p.storyItem = frames + 1;
  p.z += p.vz;
  if (frames > TYPE54_DRIFT_FRAMES) ActorKillProp(p);
}
