/**
 * Class 0x41 type 41 — stage 1's two-panel hinge: one shot and both panels
 * swing open about Z, the second chasing the first.
 *
 * One shipped descriptor: stage 1 block 0 step 2 (evt `0x0904`), placed at
 * `(84, 1.8, 112)` with yaw `0x9000` (202.5°) and a two-step lifetime.
 *
 * The routine, `0x0046CC50`..`0x0046CE7C` `[proved]`, read from the
 * disassembly: `PlaySoundId` ends Ghidra's pseudocode at the hit arm's sound
 * (the `obj+0x2A0 = 0x200` after it is invisible there), at each panel's stop
 * sound (the clamps after them) and `MatrixStackPop` at the first draw — so
 * the draw is really a **two-pass loop** and the shot-test tail follows it:
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {        // inline lifetime,
 *     if (obj->+0x11C < (s8)++obj->+0x197) { ActorDespawn(obj); return; }
 *     obj->+0x196 = g_evt_step_index;                     // no scene-1 sweep
 * }
 * if ((obj->+0x34 & 8) && obj->+0x192 == 0) {
 *     SpawnPropHitEffectScaled(obj, !(obj->+0x34 & 2), 1.2f);
 *     BreakablePropAwardHit(obj->+0x34, 1);               // ten points
 *     obj->+0x192 = 1; PlaySoundId(0xE16A9);
 *     obj->+0x2A0 = 0x200;                                // 0x0046CCE6
 * }
 * if (obj->+0x192 == 1) {
 *     if ((s16)obj->+0x200 < 0x3800) {
 *         obj->+0x2A0 += 0x30; (s16)obj->+0x200 += (s16)obj->+0x2A0;
 *         if ((s16)obj->+0x200 >= 0x3800) { PlaySoundId(0x1416A9); obj->+0x200 = 0x3800; }
 *     }
 *     if ((s16)obj->+0x206 < 0x3F00) {
 *         if ((s16)obj->+0x200 > 0x800) {
 *             if (obj->+0x2AC == 0) { obj->+0x2AC = 1; obj->+0x2A0 -= 0x200; }
 *             obj->+0x2A4 += 0x20; (s16)obj->+0x206 += (s16)obj->+0x2A4;
 *         }
 *         if ((s16)obj->+0x206 >= 0x3F00) { PlaySoundId(0x1416A9); obj->+0x206 = 0x3F00; }
 *     }
 * }
 * for (i = 0; i < 2; i++) {                               // 0x0046CDC9 .. 0x0046CE22
 *     Push; T(obj->+0x22C + 12i, +0x230 + 12i, +0x234 + 12i);
 *     RotY(obj->+0x1D0); RotZ((s16)obj->+0x200 + 6i); RotX(obj->+0x1CC);
 *     AssetDrawSlot(0x930); Pop;
 * }
 * MatrixTransformPoint((+0x19C, +0x1A0 + 5.0, +0x1A4), &obj->+0x70); RegisterForShotTest(obj);
 * ```
 *
 * So both panels are model `0x930`, the first at the placement and the second
 * 8 along X and 1 back in Z (world axes: the offsets are the arm's, added
 * before any rotation), each on the descriptor's yaw and pitch with its own
 * hinge angle about Z in between. The descriptor's roll is not applied. The
 * shot throws the first open at `0x200` BAMS a frame, accelerating by `0x30`;
 * once it is past `0x800` the second starts from rest at `0x20` a frame and
 * the first is checked by `0x200` once. Each stops dead at its limit —
 * `0x3800` (78.75°) and `0x3F00` (88.6°) — with the same sound.
 *
 * The arm's third point, `obj+0x244..0x24C` (`x + 18, y, z`), is written and
 * **never read** by this routine: the loop count is the literal 2 in `EBX`.
 *
 * **It never masks `obj+0x34`** — no `AND` on it anywhere — so the hit bit
 * stays up; `obj+0x192` is what stops the arm paying twice. The sphere is the
 * placement plus 5.0 up, and does not move.
 *
 * Floats (`L1`): `1.2f` is `PUSH 0x3F99999A`; the shot rise `5.0` is the
 * double at `0x00565E10`; the arm's `8.0f` (`0x004C43A0`), `1.0f`
 * (`0x004C4380`), `18.0f` (`0x0055D178`) and radius `7.0` (`0x40E00000`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../matrix";
import { PropStepLifetimeInline } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/**
 * The words of the object `PropUpdateType41` keeps that no shared field
 * carries. The two hinge rates, `obj+0x2A0` and `obj+0x2A4`, are
 * {@link BreakableProp.storyItem} and {@link BreakableProp.removeFlag}.
 */
interface Type41Words {
  /** `obj+0x200` — the first panel's hinge angle, s16 BAMS about Z. */
  o200: number;
  /** `obj+0x206` — the second panel's, likewise. */
  o206: number;
  /** `obj+0x2AC` — set once the second panel has started, so the first is checked once. */
  o2AC: number;
  /** `obj+0x22C/230/234` — the first panel's point: the placement. */
  o22C: number; o230: number; o234: number;
  /** `obj+0x238/23C/240` — the second panel's: `(x + 8, y, z - 1)`. */
  o238: number; o23C: number; o240: number;
  /** `obj+0x244/248/24C` — `(x + 18, y, z)`, which this routine never reads. */
  o244: number; o248: number; o24C: number;
}
const TYPE41_WORDS_ZERO: Type41Words = {
  o200: 0, o206: 0, o2AC: 0,
  o22C: 0, o230: 0, o234: 0,
  o238: 0, o23C: 0, o240: 0,
  o244: 0, o248: 0, o24C: 0,
};

/** `(s8)obj+0x192` as `PropUpdateType41` reads it. */
export enum Type41Phase {
  /** Shut. The next shot opens it. */
  Shut = 0,
  /** Shot: the panels swing until each reaches its limit, and stay. */
  Open = 1,
}

/** Both panels: `AssetDrawSlot(0x930)` inside the two-pass loop. */
export const TYPE41_SLOT = 0x930;
/** `MOV EBX, 2` at `0x0046CDC9` — the draw loop's count. */
export const TYPE41_PANELS = 2;

/** `MOV [ESI+0x2A0], 0x200` — the first panel's rate on the shot. */
export const TYPE41_FIRST_RATE = 0x200;
/** `ADD EBX, 0x30` — its acceleration, BAMS a frame a frame. */
export const TYPE41_FIRST_ACCEL = 0x30;
/** `MOV EDI, 0x3800` — its limit. */
export const TYPE41_FIRST_OPEN = 0x3800;
/** `CMP word [ESI+0x200], 0x800` — the angle past which the second starts. */
export const TYPE41_SECOND_START = 0x800;
/** `ADD ECX, 0xFFFFFE00` — what the first loses, once, when it does. */
export const TYPE41_FIRST_CHECK = 0x200;
/** `ADD EDX, 0x20` — the second panel's acceleration. */
export const TYPE41_SECOND_ACCEL = 0x20;
/** `MOV EDI, 0x3F00` — its limit. */
export const TYPE41_SECOND_OPEN = 0x3f00;

/** `PUSH 0x3F99999A` — `SpawnPropHitEffectScaled`'s scale. */
export const TYPE41_HIT_EFFECT_SCALE = Math.fround(1.2);
/** `FADD double [0x00565E10]` — the shot point's rise. */
export const TYPE41_SHOT_RISE = 5.0;

/** The arm's panel offsets: `0x004C43A0` (8.0), `0x004C4380` (1.0), `0x0055D178` (18.0). */
export const TYPE41_SECOND_DX = 8.0;
export const TYPE41_SECOND_DZ = -1.0;
export const TYPE41_THIRD_DX = 18.0;
/** `obj+0x124 = 0x40E00000` in the arm. */
export const TYPE41_RADIUS = 7.0;

/** `PlaySoundId(0xE16A9)` — the shot. */
export const SFX_TYPE41_STRUCK = 0xe16a9;
/** `PlaySoundId(0x1416A9)` — either panel reaching its limit. */
export const SFX_TYPE41_STOP = 0x1416a9;

/** `(s16)` — the two hinge angles are words. `[port-only]`. */
function S16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `PropUpdateType41` — `FUN_0046CC50`. `g_class41_updates[41]`. One prop,
 * one 60 Hz frame.
 *
 * `obj+0x192` is {@link BreakableProp.routinePhase}, `obj+0x2A0`
 * {@link BreakableProp.storyItem} (the first panel's rate) and `obj+0x2A4`
 * {@link BreakableProp.removeFlag} (the second's).
 */
export function PropUpdateType41(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime, with `ActorDespawn` and no scene-1 sweep. Stage 1 is
  // scene 0, where that sweep could not fire -- `L27`'s argument, so the
  // difference is kept.
  if (PropStepLifetimeInline(p)) return;
  const w = PropWords(p, TYPE41_WORDS_ZERO);

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.routinePhase === Type41Phase.Shut) {
    // `SpawnPropHitEffectScaled(obj, player, 1.2f)` (`FUN_004666B0`) at the
    // aim `combat/shot.ts` left on the prop, `z` from `obj+0x1A4`.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE41_HIT_EFFECT_SCALE);
    }
    // `PUSH 1` — this one pays the ten points.
    BreakablePropAwardHit(p.flags, true, rng);
    p.routinePhase = Type41Phase.Open;
    events?.emit("sound.play", { id: SFX_TYPE41_STRUCK });
    p.storyItem = TYPE41_FIRST_RATE;
  }

  if (p.routinePhase === Type41Phase.Open) {
    if (w.o200 < TYPE41_FIRST_OPEN) {
      p.storyItem = (p.storyItem + TYPE41_FIRST_ACCEL) | 0;
      w.o200 = S16(w.o200 + p.storyItem);
      if (w.o200 >= TYPE41_FIRST_OPEN) {
        events?.emit("sound.play", { id: SFX_TYPE41_STOP });
        w.o200 = TYPE41_FIRST_OPEN;
      }
    }
    // `MOV AX, [ESI+0x206]` once, before the `+0x200` test, and the sum is
    // made on it.
    const second = w.o206;
    if (second < TYPE41_SECOND_OPEN) {
      if (w.o200 > TYPE41_SECOND_START) {
        if (w.o2AC === 0) {
          w.o2AC = 1;
          p.storyItem = (p.storyItem - TYPE41_FIRST_CHECK) | 0;
        }
        p.removeFlag = (p.removeFlag + TYPE41_SECOND_ACCEL) | 0;
        w.o206 = S16(second + p.removeFlag);
      }
      if (w.o206 >= TYPE41_SECOND_OPEN) {
        events?.emit("sound.play", { id: SFX_TYPE41_STOP });
        w.o206 = TYPE41_SECOND_OPEN;
      }
    }
  }

  // `EDI` walks `obj+0x230` by 12 and `EBP` walks `obj+0x200` by 6.
  const points: ReadonlyArray<readonly [number, number, number]> = [
    [w.o22C, w.o230, w.o234],
    [w.o238, w.o23C, w.o240],
  ];
  const angles = [w.o200, w.o206];
  for (let i = 0; i < TYPE41_PANELS; i++) {
    const m = PropMatrixPush();
    MatrixTranslate(m, points[i][0], points[i][1], points[i][2]);
    MatrixRotateY(m, p.yaw);
    MatrixRotateZ(m, angles[i]);
    MatrixRotateX(m, p.pitch);
    PropDrawSlot(p, m, TYPE41_SLOT);
  }

  PropRegisterForShotTest(p, p.x, Math.fround(p.y + TYPE41_SHOT_RISE), p.z);
}

/**
 * `PlaceGenericProp` case 0x29's arm, `0x004621DE`..`0x0046224F`:
 *
 * ```
 * obj->+0x22C/230/234 = placer->+0x40/44/48
 * obj->+0x238 = placer->+0x40 + 8.0; obj->+0x23C = placer->+0x44;
 * obj->+0x240 = placer->+0x48 - 1.0
 * obj->+0x244 = placer->+0x40 + 18.0; obj->+0x248 = placer->+0x44;
 * obj->+0x24C = placer->+0x48
 * obj->+0x124 = 7.0
 * ```
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004621DE`
 * of `PlaceGenericProp`'s switch. The placer's `+0x40..0x48` are the words
 * the prologue copies to `obj+0x19C..0x1A4`, so the placement's `pos`
 * carries them.
 */
export function PlaceGenericPropType41(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void rng;
  const x = pl.pos?.[0] ?? 0, y = pl.pos?.[1] ?? 0, z = pl.pos?.[2] ?? 0;
  const w = PropWords(p, TYPE41_WORDS_ZERO);
  w.o22C = x; w.o230 = y; w.o234 = z;
  w.o238 = Math.fround(x + TYPE41_SECOND_DX);
  w.o23C = y;
  w.o240 = Math.fround(z + TYPE41_SECOND_DZ);
  w.o244 = Math.fround(x + TYPE41_THIRD_DX);
  w.o248 = y;
  w.o24C = z;
  p.hitRadius = TYPE41_RADIUS;
  // `[port-only]` -- not the arm's write but `ActorClearGameFields`'
  // (`FUN_004A73D0`) zero, which the struct's default of -1 for this word
  // does not give. The routine adds to it.
  p.removeFlag = 0;
}
