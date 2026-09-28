/**
 * Class 0x41 type 60 — a small model that the first shot pops up and away,
 * tumbling, to fall for good.
 *
 * Five shipped spawns, all stage 2 (evt `0x34B8`, `0x34E0`, `0x3508`,
 * `0x3530`, `0x3558`), at heights 41.51 and 41.93 with X from -642.1 to
 * -650.1 and Z from -1232.7 to -1320.7, four-step lifetimes, and yaws of
 * `0x1000`, `0x8000`, `0xF000`, 0 and `0xA000`. The model is `0x1D8`, `komono_bar.bin[8]`, drawn at
 * `Scale(0.25, 0.5, 0.25)`; what it depicts is `[open]`.
 *
 * The whole routine, `0x0046F840`..`0x0046FA02`:
 *
 * ```c
 * PropExpireByStepLifetime(obj);
 * switch ((s8)obj->+0x192) {
 * case 0:
 *     if (obj->+0x34 & 8) {
 *         PlaySoundId(0x1116A9);
 *         SpawnPropHitEffectScaled(obj, (obj->+0x34 & 2) ? 0 : 1, 1.0f);
 *         r = rand() % 11;
 *         vy = 0.3f;  vz = 0.5f;  obj->+0x192 = 1;
 *         vx = r * 0.1f - 0.5f;                      // -0.5 .. 0.5
 *     }
 *     break;
 * case 1:
 *     vy -= 0.02722;  pitch += 0x400;  roll += 0x400;
 *     x += vx;  y += vy;  z += vz;
 *     break;
 * }
 * Push; Translate(x, y, z); RotZ(roll); RotY(yaw); RotX(pitch);
 * Scale(0.25, 0.5, 0.25); AssetDrawSlot(0x1D8); Pop;
 * obj->+0x70.. = view(x, y, z); RegisterForShotTest(obj);
 * ```
 *
 * **No `BreakablePropAwardHit` at all** — the shot scores nothing and is not
 * counted as a hit — and **no `AND` on `obj+0x34` anywhere**: the hit bits
 * are never cleared, and it is the phase that stops the arm running twice.
 * The Z speed is a literal +0.5 in world Z whatever the prop's yaw, and
 * nothing stops the fall or retires the prop but its lifetime. The sphere
 * stays registered at the prop's own origin as it flies.
 *
 * The phase switch is taken once at the top, so the shot's frame only sets
 * the speeds; the first step of the flight is the next frame (`JMP` to the
 * draw at `0x0046F8C9` / the case-0 arm falls to `0x0046F93F`).
 *
 * Read off the disassembly: the pseudocode stops at the `PlaySoundId` and at
 * the `MatrixStackPop`. Constants: `MOV [ESI+0x1C4], 0x3E99999A` (0.3),
 * `MOV [ESI+0x1C8], 0x3F000000` (0.5), `FMUL [0x0055D230]` = `0x3DCCCCCD`
 * (0.1), `FSUB [0x004C43AC]` = `0x3F000000` (0.5), `FSUB [0x0055CB10]` =
 * `0x3CDEFC7A` (0.02722), and the scale's three `PUSH`es `0x3E800000`,
 * `0x3F000000`, `0x3E800000` — pushed Z first, so the call is
 * `MatrixScale(0.25, 0.5, 0.25)`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `obj+0x192` as the routine at `0x0046F840` switches on it. */
export enum Type60Phase {
  /** Where it was placed, waiting for its one shot. */
  Stand = 0,
  /** Popped: flying on its three speeds and falling. */
  Fly = 1,
}

/** `0x1D8` — `komono_bar.bin[8]`, the one model the routine draws. */
export const TYPE60_SLOT = 0x1d8;
/** `MOV [ESI+0x124], 0x40000000` at `0x004624C4` — the arm's radius, 2.0. */
export const TYPE60_HIT_RADIUS = 2.0;

/** `COMMON\BULLET_MET3_22.WAV`, on the one shot. */
export const SFX_TYPE60_HIT = 0x1116a9;
/** `PUSH 0x3F800000` — `SpawnPropHitEffectScaled`'s size. */
const TYPE60_HIT_EFFECT_SCALE = 1.0;

/** `rand() % 0xB` — eleven X speeds. */
const TYPE60_SPREAD = 0xb;
/** `FMUL [0x0055D230]` — `0x3DCCCCCD`, the step between them. */
const TYPE60_SPREAD_STEP = Math.fround(0.1);
/** `FSUB [0x004C43AC]` — centres them on zero. */
const TYPE60_SPREAD_BIAS = 0.5;
/** `MOV [ESI+0x1C4], 0x3E99999A` — the pop's upward speed. */
export const TYPE60_POP_VY = Math.fround(0.3);
/** `MOV [ESI+0x1C8], 0x3F000000` — its Z speed, in world Z. */
export const TYPE60_POP_VZ = 0.5;
/** `FSUB [0x0055CB10]` — `0x3CDEFC7A`, the fall's gravity. */
const TYPE60_GRAVITY = Math.fround(0.02722);
/** `MOV EAX,0x400` at `0x0046F87E` — the tumble on pitch and on roll. */
const TYPE60_TUMBLE = 0x400;
/** `MatrixScale(0.25, 0.5, 0.25)` — the model is drawn a quarter wide. */
export const TYPE60_SCALE_XZ = 0.25;
export const TYPE60_SCALE_Y = 0.5;

/**
 * `PlaceGenericProp` case 0x3C's own arm (it shares it with case 0xB).
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004624C4`
 * of `PlaceGenericProp`'s switch, one instruction —
 * `MOV dword ptr [ESI+0x124], 0x40000000`, the radius, 2.0.
 */
export function PlaceGenericPropType60(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.hitRadius = TYPE60_HIT_RADIUS;
}

/**
 * `PropUpdateType60` — `FUN_0046F840`. One prop, one 60 Hz frame.
 *
 * `+0x192` is {@link BreakableProp.routinePhase}, `+0x1C0`/`+0x1C4`/`+0x1C8`
 * {@link BreakableProp.vx}/{@link BreakableProp.vy}/{@link BreakableProp.vz}.
 */
export function PropUpdateType60(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // Not tested in the listing -- but `ActorDespawn` ends in `ActorKill`,
  // which does not return, so a retired prop stops here.
  if (PropExpireByStepLifetime(p)) return;

  switch (p.routinePhase as Type60Phase) {
    case Type60Phase.Stand:
      if ((p.flags & BreakableFlag.Hit) !== 0) {
        events?.emit("sound.play", { id: SFX_TYPE60_HIT });
        // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) ? 0 : 1, 1.0f)`
        // (`FUN_004666B0`) at the point `combat/shot.ts` left on the prop.
        if (p.hitAim) {
          SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                                   TYPE60_HIT_EFFECT_SCALE);
        }
        const r = rng.int(TYPE60_SPREAD);
        p.vy = TYPE60_POP_VY;
        p.vz = TYPE60_POP_VZ;
        p.routinePhase = Type60Phase.Fly;
        p.vx = Math.fround(r * TYPE60_SPREAD_STEP - TYPE60_SPREAD_BIAS);
      }
      break;
    case Type60Phase.Fly: {
      // `FLD vy; FSUB g; FST vy` leaves the unrounded speed on the stack for
      // the `FADD y` three instructions later.
      const vy = p.vy - TYPE60_GRAVITY;
      p.pitch = (p.pitch + TYPE60_TUMBLE) | 0;
      p.roll = (p.roll + TYPE60_TUMBLE) | 0;
      p.vy = Math.fround(vy);
      p.x = Math.fround(p.vx + p.x);
      p.y = Math.fround(vy + p.y);
      p.z = Math.fround(p.vz + p.z);
      break;
    }
  }

  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, p.pitch);
  MatrixScale(m, TYPE60_SCALE_XZ, TYPE60_SCALE_Y, TYPE60_SCALE_XZ);
  // `NoOpStub(1.0f)` (`FUN_0041EBB0`) between the scale and the draw: empty.
  PropDrawSlot(p, m, TYPE60_SLOT);

  PropRegisterForShotTest(p, p.x, p.y, p.z);
}
