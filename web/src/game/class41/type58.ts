/**
 * Class 0x41 type 58 — a model that is knocked flying by the first shot:
 * it drifts and tumbles for nine frames and then falls, for good.
 *
 * One shipped spawn: stage 2, evt `0x35A8`, at `(-600.8, 46, -1288.7)` with
 * a five-step lifetime and all three orientation words zero. The model is
 * `0x1D1`, `komono_bar.bin[1]`; what it depicts is `[open]`.
 *
 * The whole routine, `0x0046F580`..`0x0046F747`:
 *
 * ```c
 * PropExpireByStepLifetime(obj);
 * if ((obj->+0x34 & 8) && (s8)obj->+0x192 == 0) {
 *     BreakablePropAwardHit(obj->+0x34, 1);          // pays: award 1
 *     PlaySoundId(0x1516A9);
 *     obj->+0x34 &= ~8;
 *     SpawnPropHitSpark(obj, (obj->+0x34 & 2) ? 0 : 1);
 *     if (g_GameMode == 1) {
 *         saved = obj->+0x1A0;
 *         obj->+0x2A0 = 9;  obj->+0x1A0 = 44.2f;
 *         SpawnStoryModeItem(obj);                    // kind 9, at y 44.2
 *         g_original_item_pickup_blocked = 0;
 *         obj->+0x1A0 = saved;
 *     }
 *     obj->+0x192 = 1;
 * }
 * if ((s8)obj->+0x192 == 1) {
 *     x += 0.5;  z += 0.5;
 *     if (obj->+0x2A0++ > 8) { +0x1C4 -= 0.02722; y += +0x1C4; }
 *     pitch += 0x200;  roll += 0x200;
 * }
 * Push; Translate(x, y, z); RotZ(roll); RotY(yaw); RotX(pitch); AssetDrawSlot(0x1D1); Pop;
 * obj->+0x70.. = view(x, y, z); RegisterForShotTest(obj);
 * ```
 *
 * **`obj+0x2A0` is two things in one frame.** Original Mode writes 9 there
 * because `SpawnStoryModeItem` reads its item kind out of that word; the
 * flight then reads the same word as its frame count, and 9 is already past
 * the `> 8` gate. So in Original Mode the prop starts to fall on the frame it
 * is shot, and in Arcade it drifts nine frames first (counts 0..8) — the same
 * routine, two flights. The compare is on the **pre-increment** count: `CMP
 * EAX,8` at `0x0046F63D` sets the flags, and `LEA`, the FPU and a `MOV` stand
 * between it and the `JLE` without touching them.
 *
 * **Nothing stops the fall** and nothing retires the prop but its lifetime:
 * no floor test, no despawn. And **the routine masks only bit 3, and only on
 * the shot it answers** — there is no `AND` on the player bits anywhere in it
 * — so the hit arm runs once, and the shot sphere stays registered at the
 * prop's origin wherever it has flown to.
 *
 * Read off the disassembly: the pseudocode stops at the `PlaySoundId`.
 * Constants: `FADD [0x004C43AC]` = `0x3F000000` (0.5) on X and Z,
 * `FSUB [0x0055CB10]` = `0x3CDEFC7A` (0.02722) for gravity, and the item
 * height `MOV [ESI+0x1A0], 0x4230CCCD` (44.2).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitSpark } from "../effects/sprite";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../matrix";
import { SpawnStoryModeItem } from "./items";
import { PropExpireByStepLifetime } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `obj+0x192` as the routine at `0x0046F580` tests it. */
export enum Type58Phase {
  /** Where it was placed, waiting for its one shot. */
  Stand = 0,
  /** Knocked away: drifting, tumbling, and after nine frames falling. */
  Fly = 1,
}

/** `0x1D1` — `komono_bar.bin[1]`, the one model the routine draws. */
export const TYPE58_SLOT = 0x1d1;
/** `MOV [ESI+0x124], 0x40400000` at `0x00462899` — the arm's radius, 3.0. */
export const TYPE58_HIT_RADIUS = 3.0;

/** `COMMON\BULLET_WOD1_16.WAV`, on the one shot. */
export const SFX_TYPE58_HIT = 0x1516a9;

/** `MOV dword [ESI+0x2A0], 9` at `0x0046F5EE` — the story item's kind. */
export const TYPE58_STORY_ITEM = 9;
/** `MOV dword [ESI+0x1A0], 0x4230CCCD` — the world height it is made at. */
export const TYPE58_STORY_ITEM_Y = Math.fround(44.2);

/** `FADD [0x004C43AC]` — the drift on X and on Z, per frame. */
const TYPE58_DRIFT = 0.5;
/** `CMP EAX,8; JLE` on the pre-increment count — frames 0..8 do not fall. */
export const TYPE58_DRIFT_FRAMES = 8;
/** `FSUB [0x0055CB10]` — `0x3CDEFC7A`, the fall's gravity. */
const TYPE58_GRAVITY = Math.fround(0.02722);
/** `MOV EAX,0x200` at `0x0046F68D` — the tumble on pitch and on roll. */
const TYPE58_TUMBLE = 0x200;

/**
 * `PlaceGenericProp` case 0x3A's own arm (it shares it with case 0x4B).
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462899`
 * of `PlaceGenericProp`'s switch, one instruction —
 * `MOV dword ptr [ESI+0x124], 0x40400000`, the radius, 3.0. The placement's
 * `field_1f4` (4 on the shipped spawn) is not read.
 */
export function PlaceGenericPropType58(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.hitRadius = TYPE58_HIT_RADIUS;
}

/**
 * `PropUpdateType58` — `FUN_0046F580`. One prop, one 60 Hz frame.
 *
 * `+0x192` is {@link BreakableProp.routinePhase}, `+0x2A0`
 * {@link BreakableProp.storyItem} (the story item's kind, then the flight's
 * frame count), `+0x1C4` {@link BreakableProp.vy}.
 *
 * [diverges] `g_original_item_pickup_blocked = 0` (`0x0046F60B`) is not
 * written: `G` has no such byte, and its one reader, `OriginalItemPropUpdate`'s
 * pickup arm, is not ported either, so nothing in the port could see it.
 */
export function PropUpdateType58(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // Not tested in the listing -- but `ActorDespawn` ends in `ActorKill`,
  // which does not return, so a retired prop stops here.
  if (PropExpireByStepLifetime(p)) return;

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.routinePhase === Type58Phase.Stand) {
    BreakablePropAwardHit(p.flags, true, rng);
    events?.emit("sound.play", { id: SFX_TYPE58_HIT });
    p.flags &= ~BreakableFlag.Hit;
    // `SpawnPropHitSpark(obj, (obj+0x34 & 2) ? 0 : 1)` (`FUN_00465860`) at
    // the point `combat/shot.ts` left on the prop.
    if (p.hitAim) SpawnPropHitSpark(p.hitAim.x, p.hitAim.y, p.z);
    if (G.g_GameMode === GameMode.Original) {
      // `SpawnStoryModeItem` reads its kind from `+0x2A0` and its position
      // from the prop's own, so the routine writes both and puts Y back.
      const y = p.y;
      p.storyItem = TYPE58_STORY_ITEM;
      p.y = TYPE58_STORY_ITEM_Y;
      SpawnStoryModeItem(p, events);
      p.y = y;
    }
    p.routinePhase = Type58Phase.Fly;
  }

  if (p.routinePhase === Type58Phase.Fly) {
    p.x = Math.fround(p.x + TYPE58_DRIFT);
    const n = p.storyItem;
    p.storyItem = n + 1;
    p.z = Math.fround(p.z + TYPE58_DRIFT);
    if (n > TYPE58_DRIFT_FRAMES) {
      // `FLD vy; FSUB g; FST vy; FADD y; FSTP y` -- the sum takes the
      // unrounded speed, the store the rounded one.
      const vy = p.vy - TYPE58_GRAVITY;
      p.vy = Math.fround(vy);
      p.y = Math.fround(vy + p.y);
    }
    p.pitch = (p.pitch + TYPE58_TUMBLE) | 0;
    p.roll = (p.roll + TYPE58_TUMBLE) | 0;
  }

  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, p.pitch);
  PropDrawSlot(p, m, TYPE58_SLOT);

  PropRegisterForShotTest(p, p.x, p.y, p.z);
}
