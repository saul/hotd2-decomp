/**
 * Class 0x41 type 20 — a model that turns about Y without stopping, and turns
 * faster for a while each time it is shot.
 *
 * Two shipped spawns, both stage 2 (evt `0x3260` and `0x3288`), at
 * `(-648.5, 67, -1325)` and `(-648.5, 67, -1269)`, each with a four-step
 * lifetime and all three orientation words zero. The model is `0x1E2`,
 * `komono_bar.bin[12]`; what it depicts is `[open]`.
 *
 * The whole routine, `0x00469380`..`0x0046949E`:
 *
 * ```c
 * PropExpireByStepLifetime(obj);
 * if (obj->+0x34 & 8) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     obj->+0x34 &= ~8;
 *     PlaySoundId(0xE16A9);
 *     SpawnPropHitEffectScaled(obj, (obj->+0x34 & 2) ? 0 : 1, 1.0f);
 *     obj->+0x1DC += 0x400;
 * }
 * obj->+0x34 &= ~6;
 * if (obj->+0x1DC > 0x180) obj->+0x1DC -= 0x20;
 * obj->+0x68 += obj->+0x1DC;
 * Push; Translate(x, y, z); RotY(obj->+0x68); AssetDrawSlot(0x1E2); Pop;
 * obj->+0x70.. = view(x, y - 1.0, z); RegisterForShotTest(obj);
 * ```
 *
 * **It turns by `obj+0x68`, not by `obj+0x1D0`** (`MOV ECX,[ESI+0x68]` at
 * `0x0046942F`, the only rotation it applies) `[proved]`. `+0x68` is the
 * actor-rotation word the prologue does not write, so it starts at zero, and
 * the routine never reads `+0x1CC`, `+0x1D0` or `+0x1D4`: **the descriptor's
 * three orientation words are ignored**. Both shipped spawns carry zeros, so
 * that costs nothing today.
 *
 * The rate starts at `0x100` (the arm) and is only pulled down while it is
 * above `0x180`, in steps of `0x20`. A shot adds `0x400`, and `0x500 - 0x180`
 * is exactly 28 steps, so **after the first shot the prop settles at `0x180`
 * and never returns to `0x100`**: a turn every 170.7 frames rather than every
 * 256. The compare is signed (`JLE`).
 *
 * Read off the disassembly: the pseudocode stops at `PlaySoundId`, which is
 * marked no-return in the database, so everything after the sound is missing
 * from it (`L35`). Constants: `PUSH 0x3F800000` (1.0) for the effect,
 * `FSUB double [0x004ECB70]` = `0x3FF0000000000000` (1.0) for the sphere.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `0x1E2` — `komono_bar.bin[12]`, the one model the routine draws. */
export const TYPE20_SLOT = 0x1e2;

/** `MOV [ESI+0x124], 0x40E00000` at `0x00461FE2` — the arm's radius, 7.0. */
export const TYPE20_HIT_RADIUS = 7.0;
/** `MOV [ESI+0x1DC], 0x100` at `0x00461FEC` — the rate it is placed at. */
export const TYPE20_SPIN_START = 0x100;
/** `ADD EAX,0x400` at `0x004693D6` — what one shot adds to the rate. */
export const TYPE20_SPIN_KICK = 0x400;
/** `CMP EAX,0x180; JLE` — the rate is only pulled down above this. */
export const TYPE20_SPIN_REST = 0x180;
/** `ADD EAX,-0x20` — the pull, per frame. */
export const TYPE20_SPIN_DECAY = 0x20;

/** `FSUB double [0x004ECB70]` — the sphere sits 1.0 below the origin. */
export const TYPE20_SHOT_DROP = 1.0;
/** `COMMON\BULLET_MET1_16.WAV`, on every hit. */
export const SFX_TYPE20_HIT = 0xe16a9;
/** `PUSH 0x3F800000` — `SpawnPropHitEffectScaled`'s size. */
const TYPE20_HIT_EFFECT_SCALE = 1.0;

/** `AND EDX,0xFFFFFFF9` at `0x004693EA` — both players' hit bits. */
const HIT_PLAYER_BITS = BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1;

/** The words of the object this routine keeps that no shared field carries. */
type Type20Words = {
  /**
   * `obj+0x68` — the accumulated turn, s32 BAMS: `+= obj+0x1DC` a frame and
   * the draw's only rotation. The middle word of the actor-rotation triple
   * `+0x64/+0x68/+0x6C`; `ActorClearGameFields` zeroes it and
   * `PlaceGenericProp`'s prologue (`0x00461D18`..`0x00461D9E`) writes
   * `+0x1CC/+0x1D0/+0x1D4` from the placer and never this `[proved]`.
   */
  o068: number;
};
const TYPE20_WORDS_ZERO: Type20Words = { o068: 0 };

/**
 * `PlaceGenericProp` case 0x14's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461FE2`
 * of `PlaceGenericProp`'s switch — `obj+0x124 = 7.0` and `obj+0x1DC = 0x100`,
 * and nothing else.
 */
export function PlaceGenericPropType20(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.hitRadius = TYPE20_HIT_RADIUS;
  p.yawSpin = TYPE20_SPIN_START;
}

/**
 * `PropUpdateType20` — `FUN_00469380`. One prop, one 60 Hz frame.
 *
 * `+0x1DC` is {@link BreakableProp.yawSpin}, the rate; the turn it drives is
 * the routine's own word `+0x68`, not {@link BreakableProp.yaw}.
 */
export function PropUpdateType20(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // Not tested in the listing -- but `ActorDespawn` ends in `ActorKill`,
  // which does not return, so a retired prop stops here.
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, TYPE20_WORDS_ZERO);

  if ((p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, false, rng);
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_TYPE20_HIT });
    // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) ? 0 : 1, 1.0f)`
    // (`FUN_004666B0`) at the point `combat/shot.ts` left on the prop.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE20_HIT_EFFECT_SCALE);
    }
    p.yawSpin += TYPE20_SPIN_KICK;
  }
  p.flags &= ~HIT_PLAYER_BITS;
  if (p.yawSpin > TYPE20_SPIN_REST) p.yawSpin -= TYPE20_SPIN_DECAY;
  w.o068 = (w.o068 + p.yawSpin) | 0;

  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, w.o068);
  PropDrawSlot(p, m, TYPE20_SLOT);

  PropRegisterForShotTest(p, p.x, Math.fround(p.y - TYPE20_SHOT_DROP), p.z);
}
