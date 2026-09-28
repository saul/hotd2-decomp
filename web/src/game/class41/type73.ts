/**
 * Class 0x41 type 73 — stage 4's block-7 branch prop: shot with the right key
 * in Original Mode, it opens the route and rides object path 0x179.
 *
 * One shipped descriptor: stage 4 block 7 step 2 (evt `0x4954`), placed at
 * `(-326.7, 32.8, -803)` with a three-step lifetime. Block 7's route record is
 * `{8, -1, 22}`. **The placement is not where it is drawn**: from its first
 * frame the routine poses the object from object path `0x179` (377,
 * `op_st4` 6) at the cursor `obj+0x2C0`, which is 0 until the key opens it —
 * and that path's frame 0 happens to be the placement.
 *
 * The routine, `0x00470B70`..`0x00470E15` `[proved]`, read from the
 * disassembly because `PlaySoundId` and `MatrixStackPop` end Ghidra's
 * pseudocode twice before the key test, the `PoseHookNone` call and the whole
 * shot-test tail:
 *
 * ```c
 * if (g_app_state == 5) { ActorDespawn(obj); return; }  // the attract demo
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {        // inline lifetime,
 *     if (obj->+0x11C < (s8)++obj->+0x197) { ActorKill(); return; }   // KILL
 *     obj->+0x196 = g_evt_step_index;                     // and no sweep
 * }
 * if (g_GameMode == 1 && g_evt_block_index == 7 && g_script_flags[0x12]
 *     && (obj->+0x34 & 8)) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     obj->+0x34 &= ~8;
 *     PlaySoundId(0xE16A9);
 *     SpawnPropHitEffectScaled(obj, !(obj->+0x34 & 2), 1.5f);          // 0x00470C39
 *     if (obj->+0x192 == 0 && (PlayerHoldsOriginalItem(5)
 *         || PlayerHoldsOriginalItem(6) || PlayerHoldsOriginalItem(0xC))) {
 *         obj->+0x192 = 1; obj->+0x2C0 = 0.0f;
 *         g_script_branch_var = 2; PlaySoundId(0x381BA9);
 *     }
 * }
 * obj->+0x34 &= ~6;                                        // 0x00470CA9
 * CamEvalObjectPath6(0x179, obj->+0x2C0, &pose);
 * obj->+0x19C/1A0/1A4 = pose.x/y/z; obj->+0x1CC/1D0/1D4 = pose.rx/ry/rz;
 * if (obj->+0x192 == 1) {
 *     obj->+0x2C0 += 1.0f;
 *     if (ftol(obj->+0x2C0) == 0x46) { PlaySoundId(0x371BA9); PoseHookNone(5, 0x14); }
 *     if (ftol(obj->+0x2C0) == 0x69) obj->+0x192 = 2;
 * }
 * Push; T(+0x19C, +0x1A0, +0x1C8 + +0x1A4); RotZ(+0x1D4); RotY(+0x1D0); RotX(+0x1CC);
 * g_scene_lighting ? SubmitSlotWithSceneLightArray(0x1871) : AssetDrawSlot(0x1871); Pop;
 * MatrixTransformPoint((+0x19C, +0x1A0 + 8.0, +0x1A4), &obj->+0x70); RegisterForShotTest(obj);
 * ```
 *
 * **The key is checked after the hit is paid.** Without it the shot still
 * counts, still sounds and still sparks; the road just stays shut. And the
 * hit arm is the only thing that clears bit 3 — outside Original Mode, block
 * 7 or flag `0x12` a shot's bit 3 stays up, and the arm takes it the first
 * frame all three hold. The player bits are cleared every frame.
 *
 * `obj+0x2C0` is a float cursor: the path plays frames 0 to 104, `0x371BA9`
 * sounds on the frame the cursor reaches 70, and at 105 the latch goes to 2
 * and the cursor stops — the path's own last key is at 105. `obj+0x1C8` is
 * never written, so the draw's `+0x1C8` is zero.
 *
 * `PoseHookNone` (`FUN_00420810`) is a bare `RET` and is not called. Floats
 * (`L1`): the scale `1.5f` is `PUSH 0x3FC00000`, the step `1.0f` is
 * `0x004C4380`, the shot rise `8.0f` is `0x004C43A0`, the arm's radius `12.0`
 * is `0x41400000`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { AppState, G } from "../globals";
import { GameMode } from "../game_mode";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../matrix";
import { PlayerHoldsOriginalItem } from "../original_mode";
import { ActorDespawnProp, ActorKillProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropEvalObjectPath6 } from "./object_path";

/** `(s8)obj+0x192` as `PropUpdateType73` reads it. */
export enum Type73Phase {
  /** Shut: the key has not been shown. */
  Shut = 0,
  /** Opened: the cursor runs up the path. */
  Riding = 1,
  /** The cursor reached {@link TYPE73_PATH_END} and stopped. */
  Done = 2,
}

/** `g_script_flags[0x12]` (`0x009C7212`) — the hit arm's flag. */
export const SCRIPT_FLAG_TYPE73_LIVE = 0x12;
/** `CMP word [g_evt_block_index], 7` at `0x00470BE2`. */
export const TYPE73_BLOCK = 7;
/** `MOV word [g_script_branch_var], 2` at `0x00470C8B`. */
export const TYPE73_ROUTE = 2;
/**
 * The Original Mode items that open it, in the order the routine asks
 * `PlayerHoldsOriginalItem` (`FUN_00461C70`): `PUSH 5`, `PUSH 6`, `PUSH 0xC`.
 */
export const TYPE73_KEYS: readonly number[] = [5, 6, 0x0c];

/** `PUSH 0x179` — the object path the prop rides. */
export const TYPE73_PATH = 0x179;
/** `FADD [0x004C4380]` — the cursor's step, a frame. */
export const TYPE73_PATH_STEP = 1.0;
/** `CMP EAX, 0x46` — the cursor that sounds {@link SFX_TYPE73_RIDE}. */
export const TYPE73_PATH_CUE = 0x46;
/** `CMP EAX, 0x69` — the cursor that ends the ride. */
export const TYPE73_PATH_END = 0x69;

/** `AssetDrawSlot(0x1871)` / its lit twin. */
export const TYPE73_SLOT = 0x1871;
/** `PUSH 0x3FC00000` — `SpawnPropHitEffectScaled`'s scale. */
export const TYPE73_HIT_EFFECT_SCALE = 1.5;
/** `FADD [0x004C43A0]` — the shot point's rise. */
export const TYPE73_SHOT_RISE = 8.0;
/** `obj+0x124 = 0x41400000` — the arm type 73 shares with type 7. */
export const TYPE73_RADIUS = 12.0;

/** `PlaySoundId(0xE16A9)` — any shot the arm takes. */
export const SFX_TYPE73_STRUCK = 0xe16a9;
/** `PlaySoundId(0x381BA9)` — the key opens it. */
export const SFX_TYPE73_OPEN = 0x381ba9;
/** `PlaySoundId(0x371BA9)` — at path frame 70. */
export const SFX_TYPE73_RIDE = 0x371ba9;

/**
 * `PropUpdateType73` — `FUN_00470B70`. `g_class41_updates[73]`. One prop,
 * one 60 Hz frame.
 *
 * `obj+0x192` is {@link BreakableProp.routinePhase}, `obj+0x2C0`
 * {@link BreakableProp.shake} (the path cursor, as it is for
 * `PropUpdateType75`'s object path), `obj+0x1C8` {@link BreakableProp.vz}.
 */
export function PropUpdateType73(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  if (G.g_app_state === AppState.Attract) {
    ActorDespawnProp(p);
    return;
  }
  // The inline lifetime, with `ActorKill` (`FUN_004A7040`) where the shared
  // prologue has `ActorDespawn`, and no scene-1 sweep.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }

  if (G.g_GameMode === GameMode.Original
      && G.g_evt_block_index === TYPE73_BLOCK
      && (G.g_script_flags[SCRIPT_FLAG_TYPE73_LIVE] ?? 0) !== 0
      && (p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, false, rng);
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_TYPE73_STRUCK });
    // `SpawnPropHitEffectScaled(obj, player, 1.5f)` (`FUN_004666B0`) at the
    // aim `combat/shot.ts` left on the prop, `z` from `obj+0x1A4`.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE73_HIT_EFFECT_SCALE);
    }
    if (p.routinePhase === Type73Phase.Shut
        && TYPE73_KEYS.some(PlayerHoldsOriginalItem)) {
      p.routinePhase = Type73Phase.Riding;
      p.shake = 0;
      G.g_script_branch_var = TYPE73_ROUTE;
      events?.emit("sound.play", { id: SFX_TYPE73_OPEN });
    }
  }
  // `AND AL, 0xF9` — the two player bits, every frame. Bit 3 only in the arm.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  // The pose, every frame and whatever the latch says: an unopened prop sits
  // at the path's frame 0.
  const pose = PropEvalObjectPath6(TYPE73_PATH, p.shake);
  if (pose) {
    p.x = pose.x;
    p.y = pose.y;
    p.pitch = pose.rx;
    p.z = pose.z;
    p.yaw = pose.ry;
    p.roll = pose.rz;
  }

  if (p.routinePhase === Type73Phase.Riding) {
    p.shake = Math.fround(p.shake + TYPE73_PATH_STEP);
    if (Math.trunc(p.shake) === TYPE73_PATH_CUE) {
      events?.emit("sound.play", { id: SFX_TYPE73_RIDE });
      // `PoseHookNone(5, 0x14)` (`FUN_00420810`) -- a bare `RET`.
    }
    if (Math.trunc(p.shake) === TYPE73_PATH_END) {
      p.routinePhase = Type73Phase.Done;
    }
  }

  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, Math.fround(p.vz + p.z));
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, p.pitch);
  // `g_scene_lighting` picks `SubmitSlotWithSceneLightArray`
  // (`FUN_004185E0`) over `AssetDrawSlot` (`FUN_00418560`); the two draw the
  // same slot under the same matrix, and the record does not tell them apart.
  PropDrawSlot(p, m, TYPE73_SLOT);

  PropRegisterForShotTest(p, p.x, Math.fround(p.y + TYPE73_SHOT_RISE), p.z);
}

/**
 * `PlaceGenericProp` case 0x49's arm, which is **case 7's**: both types reach
 * `0x00462874` through `g_place_generic_prop_arm_index`, and it writes
 * `obj+0x124 = 0x41400000` and nothing else.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462874`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType73(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.hitRadius = TYPE73_RADIUS;
}
