/**
 * The four class-0x41 generic types whose whole routine is a draw, a pose and
 * one rule about when to stop — each transcribed whole, draws included.
 *
 * They are here because {@link GENERIC_DESCRIPTOR_SLOT} could not have them
 * until they were: adding a type to that set makes its model travel in the
 * bundle **and** draw, so a type whose own arm is unported arrives in the
 * level wearing the right geometry and doing the wrong thing. Type 54 is the
 * clearest case — its drift is authored, identical for every spawn, and a
 * naive add would have put a static model where the game has one tumbling
 * away over five seconds.
 *
 * **Every one of them has code past a `MatrixStackPop`**, which this database
 * marks no-return, so Ghidra ends each function body at that `CALL` and the
 * pseudocode stops there (`L35`, `L37`). `disassemble_bytes` over each whole
 * routine is what found type 31's slot-strip wrap and its block-11 pair,
 * type 33's step and its death, and type 53's two camera-facing strips. Read
 * literally, the pseudocode said types 31 and 33 draw one fixed model and
 * type 53 draws nothing but its body.
 *
 * Each routine records its own draws where it makes them
 * (`class41/prop_draw.ts`), so the draw a frame shows is the one the routine
 * made with the state it had *then*: 31 and 33 draw their cursor and step it
 * afterwards, 54 steps and then draws.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { CameraBlockEye } from "../camera/view";
import {
  FtolS16, MatrixRotateY, MatrixScale, MatrixTranslate, RADIANS_TO_BAMS,
} from "../matrix";
import { ActorDespawnProp, ActorKillProp } from "./prop";
import { PropExpireByStepLifetime } from "./lifetime";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `(s16)` — how every one of these loads `obj+0x28C` (`MOVSX`). */
function S16(v: number): number {
  return (v << 16) >> 16;
}

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

/**
 * `g_scene_index` and `g_evt_block_index` at which {@link PropDrawOnlyType31}
 * draws its second strip twice more (`0x0046A280`, `0x0046A28E`).
 */
export const TYPE31_EXTRA_AT: readonly [number, number] = [2, 0xb];
/** `AssetDrawSlot(g_scene_tick_counter % 7 + 0x1797)` — a seven-frame strip. */
export const TYPE31_EXTRA_SLOT = 0x1797;
export const TYPE31_EXTRA_FRAMES = 7;
/** `PUSH 0xC25C8000` — the first extra copy is this far down Y (-55.125). */
const TYPE31_EXTRA_DROP = -55.125;
/** `PUSH 0x8000` to `MatrixRotateY` — the second copy is turned half round. */
const TYPE31_EXTRA_TURN = 0x8000;
/** `PUSH 0xC0400000` — ...and pushed this far along its own Z (-3.0). */
const TYPE31_EXTRA_BACK = -3.0;
/** `MOV EAX,0x3F800000` in the arm — the scale `obj+0x1A8..0x1B0` starts at. */
const TYPE31_SCALE = 1.0;

/** `PropDrawOnlyType54`'s drift runs for this many frames and then kills. */
export const TYPE54_DRIFT_FRAMES = 300;
/**
 * `PlaceGenericProp` case 0x36's five literals — the whole of type 54's drift.
 * Read out of the disassembly rather than the pseudocode, because these are
 * `MOV dword ptr [ESI + disp], imm32` of float bit patterns and the decompiler
 * shows them as integers (`L1`'s neighbour).
 */
export const TYPE54_DRIFT_VX = 5.0;       // 0x40A00000 -> +0x1C0
export const TYPE54_DRIFT_VY = 1.5;       // 0x3FC00000 -> +0x1C4
export const TYPE54_DRIFT_VZ = -4.0;      // 0xC0800000 -> +0x1C8
export const TYPE54_DRIFT_PITCH = 0x300;  //            -> +0x1D8
export const TYPE54_DRIFT_YAW = -0x400;   // 0xFFFFFC00 -> +0x1DC

/**
 * `g_evt_block_index` values in which {@link PropDrawOnlyType53} draws its
 * two camera-facing strips (`CMP AX,4` / `CMP AX,5` at `0x0046EC76`).
 */
export const TYPE53_STRIP_BLOCKS: readonly number[] = [4, 5];
/** `g_scene_tick_counter % 0xF + 0x135F` — `char_adv04.bin[79..93]`. */
export const TYPE53_STRIP_A_SLOT = 0x135f;
export const TYPE53_STRIP_A_FRAMES = 0xf;
/** `0x0055D2B4` (`0x40A00000`) — strip A stands this far above the prop. */
const TYPE53_STRIP_A_RISE = 5.0;
/** `MatrixScale(1.5, 2.0, 1.0)` — `0x3FC00000`, `0x40000000`, `0x3F800000`. */
const TYPE53_STRIP_A_SCALE: readonly [number, number, number] = [1.5, 2.0, 1.0];
/** `(g_scene_tick_counter & 7) + 0xB67` — `char_adv00.bin[1..8]`. */
export const TYPE53_STRIP_B_SLOT = 0xb67;
export const TYPE53_STRIP_B_MASK = 7;
/** `0x004C43A0` (`0x41000000`) — strip B stands this far above the prop. */
const TYPE53_STRIP_B_RISE = 8.0;
/** `PUSH 0x41400000` — ...and this far out along the turned Z (12.0). */
const TYPE53_STRIP_B_OUT = 12.0;
/** `MatrixScale(7.0, 7.0, 7.0)` — `0x40E00000` three times. */
const TYPE53_STRIP_B_SCALE = 7.0;

/**
 * `PropDrawOnlyType31` — `FUN_0046A1C0`.
 *
 * Six shipped spawns, and every one of them an **effect strip**: stage 1's
 * draws `eff_1.bin[8..46]`, stage 3's three `eff_taki.bin[0..9]` and stage
 * 4's two `eff_taki.bin[30..59]`. The whole routine, `0x0046A1C0`..`0x0046A35B`:
 *
 * ```c
 * PropExpireByStepLifetime(obj);                 // result not tested
 * if (g_active_cam_path == 0x84 && g_cam_path_frame == 0x1D6) {
 *     ActorDespawn(obj); return;
 * }
 * MatrixStackPush(0);
 * MatrixTranslate(+0x19C, +0x1A0, +0x1A4);
 * MatrixRotateZ(+0x1D4); MatrixRotateY(+0x1D0); MatrixRotateX(+0x1CC);
 * MatrixScale(+0x1A8, +0x1AC, +0x1B0);
 * MaxOfThreeToNoOpStub(+0x1A8, +0x1AC, +0x1B0);
 * AssetDrawSlot((s16)obj->+0x28C + obj->+0x2A0);                // 0x0046A278
 * if (g_scene_index == 2 && g_evt_block_index == 0xB) {
 *     MatrixTranslate(0, -55.125, 0);  MaxOfThreeToNoOpStub(...);
 *     AssetDrawSlot(g_scene_tick_counter % 7 + 0x1797);
 *     MatrixRotateY(0x8000);  MatrixTranslate(0, 0, -3.0);  MaxOfThreeToNoOpStub(...);
 *     AssetDrawSlot(g_scene_tick_counter % 7 + 0x1797);
 * }
 * MatrixStackPop(1);                             // 0x0046A32F: Ghidra ends here
 * if (++obj->+0x2A0 > obj->+0x2A4) obj->+0x2A0 = 0;              // 0x0046A334
 * ```
 *
 * `[proved]` every line. `PropExpireByStepLifetime` (`FUN_00466640`) is
 * called and its result ignored, but the only way it ends early is
 * `ActorDespawn` (`FUN_00409CC0`), which ends in `ActorKill` (`FUN_004A7040`,
 * at `0x00409CFC`) and so never returns: the test here is that. The despawn
 * ahead of the draw is a camera cue, not a lifetime.
 *
 * The cursor compare is on the **post-increment** value and the reset is in
 * the same frame, so a descriptor roll word of `n` is an `n + 1`-frame loop
 * showing cursors `0 .. n`: stage 3's 9 is ten frames of `eff_taki.bin`.
 * `PlaceGenericProp` case 0x1F gives `obj+0x2A4` the placer's `+0x6C`, so
 * that length is the spawn descriptor's third orientation word — which the
 * prologue also copies to `obj+0x1D4` and the routine also applies as a Z
 * rotation of a fifth of a degree. Both readings are the engine's.
 *
 * The draw is recorded before the step, as the engine makes it, so the port
 * shows `0, 1, … n` from the first frame exactly as the engine does.
 *
 * The scene-2 block-11 pair is a seven-frame strip on the scene clock, the
 * first 55.125 below the prop's own draw and the second turned half round and
 * 3.0 further along, both under the prop's scale. **No shipped spawn reaches
 * it** `[proved]` from the bundle's route table: scene 2 is stage 3, whose
 * three type-31 spawns are placed in block 4, and block 4 routes only to 5
 * or 10, which both go to 6 and then to block 13's end; block 11 is reached
 * only along `0 -> 1 -> 2 -> 11`. It is transcribed anyway, because it is the
 * routine; its slots `0x1797..0x179D` do not travel in the bundle.
 *
 * No `AND` on `obj+0x34` and no `RegisterForShotTest`.
 * `MaxOfThreeToNoOpStub` (`FUN_00461C20`) hands the largest of its three
 * floats to `NoOpStub` (`FUN_0041EBB0`), a bare `RET`, and is not transcribed.
 */
export function PropDrawOnlyType31(p: BreakableProp, _rng: Rng,
                                   _events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  if (G.g_active_cam_path === TYPE31_DESPAWN_CAM_PATH
      && G.g_cam_path_frame === TYPE31_DESPAWN_CAM_FRAME) {
    ActorDespawnProp(p);
    return;
  }
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  MatrixScale(m, p.restX, p.restY, p.restZ);
  PropDrawSlot(p, m, S16(p.slot) + p.storyItem);
  if (G.g_scene_index === TYPE31_EXTRA_AT[0]
      && G.g_evt_block_index === TYPE31_EXTRA_AT[1]) {
    // `XOR EDX,EDX; DIV ECX` — unsigned.
    const extra = G.g_scene_tick_counter % TYPE31_EXTRA_FRAMES
      + TYPE31_EXTRA_SLOT;
    MatrixTranslate(m, 0, TYPE31_EXTRA_DROP, 0);
    PropDrawSlot(p, m, extra);
    MatrixRotateY(m, TYPE31_EXTRA_TURN);
    MatrixTranslate(m, 0, 0, TYPE31_EXTRA_BACK);
    PropDrawSlot(p, m, extra);
  }
  p.storyItem += 1;
  if (p.storyItem > p.removeFlag) p.storyItem = 0;
}

/**
 * The arm of `PlaceGenericProp` (`FUN_00461CF0`) for type 31.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x0046205E`
 * of `PlaceGenericProp`'s switch (entry 15 of `g_place_generic_prop_arms`):
 *
 * ```
 * 0046205E  MOV AX,[EBP+0x1F4]  ; MOV [ESI+0x11C],AX    ; lifetime = desc+0x24
 * 0046206C  MOV CX,[EBP+0x11C]  ; MOV [ESI+0x28C],CX    ; the strip's base
 * 0046207A  MOV EDX,[EBP+0x6C]  ; MOV [ESI+0x2A4],EDX   ; the strip's last cursor
 * 00462083  MOV EAX,0x3F800000  ; -> [ESI+0x1A8], [+0x1AC], [+0x1B0]
 * ```
 */
export function PlaceGenericPropType31(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.lifetime = pl.field_1f4 ?? 0;
  p.slot = pl.slot ?? 0;
  p.removeFlag = pl.roll ?? 0;
  p.restX = TYPE31_SCALE;
  p.restY = TYPE31_SCALE;
  p.restZ = TYPE31_SCALE;
}

/**
 * `PropDrawOnlyType33` — `FUN_00472950`.
 *
 * One shipped spawn in the whole game — stage 2 block 11 step 1 op 20, placed
 * once camera path `cp_st2[2]` passes frame 340 and immediately followed by
 * `se_play` of `STAGE2_SE\BRIDGE_CRASH1_22.wav`: slot `0x174A`,
 * `eff_shop.bin[0]`, with a roll word of `0x3B`. A strip of `eff_shop.bin`
 * (the fire the crash leaves, `[likely]` from what the slots render as and
 * nothing else), and it is **played once and killed**. The whole routine,
 * `0x00472950`..`0x004729D6`:
 *
 * ```
 * 00472951  PUSH 0 ; CALL MatrixStackPush
 * 00472971  CALL MatrixTranslate(+0x19C, +0x1A0, +0x1A4)
 * 0047297D  CALL MatrixRotateZ(+0x1D4)
 * 00472989  CALL MatrixRotateY(+0x1D0)
 * 00472995  CALL MatrixRotateX(+0x1CC)
 * 0047299A  MOVSX EAX,word [ESI+0x28c] ; ADD EAX,[ESI+0x2a0]
 * 004729A8  CALL AssetDrawSlot
 * 004729AF  CALL MatrixStackPop(1)            ; Ghidra's body ends here
 * 004729B4  MOV EDX,[ESI+0x2a0] ; MOV ECX,[ESI+0x2a4]
 * 004729C3  INC EDX ; MOV EAX,EDX ; MOV [ESI+0x2a0],EDX
 * 004729CC  CMP EAX,ECX ; JLE ret
 * 004729D1  JMP ActorKill                      ; 0x004A7040
 * ```
 *
 * `[proved]`. No `PropExpireByStepLifetime` in front of it, no `AND` on
 * `obj+0x34` and no `RegisterForShotTest`: a draw, a step and a kill. So it
 * cannot ride the generic arm, which would put the lifetime prologue (and its
 * scene-1 sweep, and stage 2 is scene 1) in front of it.
 *
 * The compare is on the **post-increment** cursor, so a roll word of `n`
 * draws cursors `0 .. n` — `n + 1` frames, sixty for the shipped `0x3B`,
 * slots `0x174A..0x1785` — and **the call that draws cursor `n` is the one
 * that kills**: the draw is made, then the object is unlinked. `ActorAlloc`
 * (`FUN_004A6FA0`) puts the object after its placer in the task list, and
 * `TaskRunTree` (`FUN_004A71A0`) reaches it on the frame it is made, so the
 * engine draws cursor 0 on that frame.
 */
export function PropDrawOnlyType33(p: BreakableProp): void {
  PropDrawBegin(p);
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, m, S16(p.slot) + p.storyItem);
  p.storyItem += 1;
  if (p.storyItem > p.removeFlag) ActorKillProp(p);
}

/**
 * The arm of `PlaceGenericProp` (`FUN_00461CF0`) for type 33.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004620BE`
 * of `PlaceGenericProp`'s switch (entry 17 of `g_place_generic_prop_arms`):
 *
 * ```
 * 004620BE  MOV AX,[EBP+0x11C]  ; MOV [ESI+0x28C],AX    ; the strip's base
 * 004620CD  MOV ECX,[EBP+0x6C]  ; MOV [ESI+0x2A4],ECX   ; the strip's last cursor
 * ```
 *
 * `obj+0x2A0`, the cursor, is the zero `ActorClearGameFields` left, which
 * the constructor already writes.
 */
export function PlaceGenericPropType33(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.slot = pl.slot ?? 0;
  p.removeFlag = pl.roll ?? 0;
}

/**
 * `PropDrawOnlyType53` — `FUN_0046EBD0`.
 *
 * Two spawns, both stage 5 and both placed twice over — by block 2 step 2
 * op 14 and again by block 4 step 0 op 25 — drawing `char_adv04.bin[0]` at
 * the spawn's own pose, with a six-step lifetime. The whole routine,
 * `0x0046EBD0`..`0x0046EDB9`:
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {           // inline lifetime
 *     if (obj->+0x11C < (s16)(s8)++obj->+0x197) { ActorKill(); return; }
 *     obj->+0x196 = g_evt_step_index;
 * }
 * Push(0); Translate(+0x19C, +0x1A0, +0x1A4);
 * RotateZ(+0x1D4); RotateY(+0x1D0); RotateX(+0x1CC);
 * AssetDrawSlot((s16)obj->+0x28C); Pop(1);                   // Ghidra ends here
 * if (g_evt_block_index == 4 || g_evt_block_index == 5) {    // 0x0046EC6D
 *     eye = g_camera_blocks[g_camera_index].eye;             // 0x009A60C0 + i*0x1A4
 *     yaw = (s16)__ftol(atan2(eye.x - x, eye.z - z) * 65536/2pi);
 *     Push(0); Translate(x, y + 5.0, z); RotateY(yaw);
 *              Scale(1.5, 2.0, 1.0); NoOpStub(2.0);
 *              AssetDrawSlot(g_scene_tick_counter % 15 + 0x135F); Pop(1);
 *     Push(0); Translate(x, y + 8.0, z); RotateY(yaw); Translate(0, 0, 12.0);
 *              Scale(7.0, 7.0, 7.0); NoOpStub(7.0);
 *              AssetDrawSlot((g_scene_tick_counter & 7) + 0xB67); Pop(1);
 * }
 * ```
 *
 * `[proved]` every line; the strip block is `0x0046EC6D`..`0x0046EDB7`. The
 * yaw is `FLD eye.x; FSUB x; FLD eye.z; FSUB z; FPATAN` — `atan2` of the
 * first over the second — times the double at `0x004C4378` (65536/2pi),
 * through `__ftol` (`0x004ACF50`) and `MOVSX` to sixteen bits. So both
 * strips turn their +Z toward the camera's eye about Y alone: upright cards
 * that face the camera.
 *
 * The head is an **inline variant of `PropExpireByStepLifetime`**
 * (`FUN_00466640`) with the scene-1 sweep left out and `ActorKill`
 * (`FUN_004A7040`) where the shared prologue ends in `ActorDespawn`
 * (`FUN_00409CC0`). Neither of its spawns is in scene 1, so the sweep could
 * not fire for them — which is the reason to write the routine out rather
 * than reuse the prologue, not a reason to reuse it (`L27`).
 *
 * The eye is the block `g_camera_index` names (`0x0046EC9F`, `0x0046ECAB`):
 * block 2's under scene state (1, 3), whose installer writes the index,
 * block 0's otherwise -- `CameraBlockEye`. The camera's tasks run before
 * every actor and pool in the frame (`game/director.ts`), so this is the eye
 * of the frame being drawn. Block 4 is where the second placement is made, so the strips are live
 * in the shipped game; their slots are `0x135F..0x136D` and `0xB67..0xB6E`.
 */
export function PropDrawOnlyType53(p: BreakableProp): void {
  PropDrawBegin(p);
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  const body = PropMatrixPush();
  PropMatrixTRzRyRx(body, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, body, p.slot);
  if (!TYPE53_STRIP_BLOCKS.includes(G.g_evt_block_index)) return;

  const eye = CameraBlockEye(G.g_camera_index);
  const yaw = FtolS16(Math.atan2(eye.x - p.x, eye.z - p.z) * RADIANS_TO_BAMS);
  const tick = G.g_scene_tick_counter;

  const a = PropMatrixPush();
  // `FLD [+0x1A0]; FADD [0x0055D2B4]; FSTP [ESP]` — a float argument.
  MatrixTranslate(a, p.x, Math.fround(p.y + TYPE53_STRIP_A_RISE), p.z);
  MatrixRotateY(a, yaw);
  MatrixScale(a, ...TYPE53_STRIP_A_SCALE);
  PropDrawSlot(p, a, tick % TYPE53_STRIP_A_FRAMES + TYPE53_STRIP_A_SLOT);

  const b = PropMatrixPush();
  MatrixTranslate(b, p.x, Math.fround(p.y + TYPE53_STRIP_B_RISE), p.z);
  MatrixRotateY(b, yaw);
  MatrixTranslate(b, 0, 0, TYPE53_STRIP_B_OUT);
  MatrixScale(b, TYPE53_STRIP_B_SCALE, TYPE53_STRIP_B_SCALE,
              TYPE53_STRIP_B_SCALE);
  PropDrawSlot(p, b, (tick & TYPE53_STRIP_B_MASK) + TYPE53_STRIP_B_SLOT);
}

/**
 * The arm of `PlaceGenericProp` (`FUN_00461CF0`) for type 53.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x0046241C`
 * of `PlaceGenericProp`'s switch (entry 24 of `g_place_generic_prop_arms`),
 * and all of it is
 *
 * ```
 * 0046241C  MOV CX,[EBP+0x1F4] ; MOV [ESI+0x11C],CX     ; lifetime = desc+0x24
 * ```
 *
 * so the slot stays the prologue's `placer+0x11C`.
 */
export function PlaceGenericPropType53(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.lifetime = pl.field_1f4 ?? 0;
}

/**
 * `PropDrawOnlyType54` — `FUN_0046EDC0`.
 *
 * One spawn in the twelve bundles, stage 5 block 4 step 1 op 23, drawing
 * `st5_02b.bin[6]`, and the only thing it does is **drift while
 * `g_script_flags[12]` is raised**. The whole routine,
 * `0x0046EDC0`..`0x0046EEA6`:
 *
 * ```
 * 0046EDC0  MOV AL,[0x009C720C] ; CMP AL,1 ; JNZ draw
 * 0046EDCE  FLD [+0x1C0] ; FADD [+0x19C]     ... FSTP [+0x19C]
 *           +0x1CC += +0x1D8
 * 0046EE00  FLD [+0x1C4] ; FADD [+0x1A0]     ... FSTP [+0x1A0]
 *           +0x1D0 += +0x1DC
 * 0046EE14  CMP EAX,0x12C                    ; EAX is +0x2A0 BEFORE the increment
 * 0046EE28  FLD [+0x1C8] ; FADD [+0x1A4]     ... FSTP [+0x1A4]
 * 0046EE34  MOV [+0x2A0],EAX+1
 * 0046EE40  JLE draw ; CALL ActorKill ; RET
 * draw:     Push(0); Translate(+0x19C, +0x1A0, +0x1A4);
 *           RotateZ(+0x1D4); RotateY(+0x1D0); RotateX(+0x1CC);
 *           AssetDrawSlot((s16)+0x28C); Pop(1); RET      ; 0x0046EEA6
 * ```
 *
 * `[proved]`. The comparison is on the **pre-increment** count, so the frames
 * that read 0..300 drift and draw — 301 of them — and the frame that reads
 * 301 kills, before its draw. `PlaceGenericProp` case 0x36 seeds the five
 * rates, so every spawn drifts identically: 5.0 in X, 1.5 up and -4.0 in Z a
 * frame, pitching `0x300` and yawing `-0x400`.
 *
 * There is no lifetime prologue and no other exit, no `AND` on `obj+0x34`
 * and no `RegisterForShotTest`. Stage 5's script raises flag 12 in block 5
 * step 2 and **every** branch out of block 4 reaches block 5 — block 4
 * branches to 5 or 6, and block 6 gotos 5 — so the shipped spawn always
 * drifts.
 */
export function PropDrawOnlyType54(p: BreakableProp): void {
  PropDrawBegin(p);
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] ?? 0) === 1) {
    p.x = Math.fround(p.vx + p.x);
    p.pitch = (p.pitch + p.spin) | 0;
    p.y = Math.fround(p.vy + p.y);
    p.yaw = (p.yaw + p.yawSpin) | 0;
    const frames = p.storyItem;
    p.z = Math.fround(p.vz + p.z);
    p.storyItem = frames + 1;
    if (frames > TYPE54_DRIFT_FRAMES) {
      ActorKillProp(p);
      return;
    }
  }
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, m, p.slot);
}

/**
 * The arm of `PlaceGenericProp` (`FUN_00461CF0`) for type 54.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x0046242F`
 * of `PlaceGenericProp`'s switch (entry 25 of `g_place_generic_prop_arms`):
 *
 * ```
 * 0046242F  MOV DX,[EBP+0x11C]
 * 00462436  MOV dword ptr [ESI+0x1C0], 0x40A00000   ;  5.0
 * 00462440  MOV [ESI+0x28C],DX                      ;  the slot, again
 * 00462447  MOV dword ptr [ESI+0x1C4], 0x3FC00000   ;  1.5
 * 00462451  MOV dword ptr [ESI+0x1C8], 0xC0800000   ; -4.0
 * 0046245B  MOV dword ptr [ESI+0x1D8], 0x300
 * 00462465  MOV dword ptr [ESI+0x1DC], 0xFFFFFC00   ; -0x400
 * ```
 *
 * Identical for every spawn, which is what makes the drift *authored*.
 */
export function PlaceGenericPropType54(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.vx = TYPE54_DRIFT_VX;
  p.slot = pl.slot ?? 0;
  p.vy = TYPE54_DRIFT_VY;
  p.vz = TYPE54_DRIFT_VZ;
  p.spin = TYPE54_DRIFT_PITCH;
  p.yawSpin = TYPE54_DRIFT_YAW;
}
