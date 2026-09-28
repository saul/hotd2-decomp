/**
 * Class 0x41 type 49 — an object on a twelve-sided rim that rocks when shot.
 *
 * One shipped spawn: stage 2 block 8 step 1 (the `spawn_placed` at evt
 * `0x398C`, descriptor at `0x43B4`), at `(-585.7, 33.3, -1225)` with a
 * one-step lifetime. The ground plane the script last set before it is 33.17
 * (evt `0x3890`), so it is placed 0.13 above the floor.
 *
 * What it is: `[open]`. The routine knows it only as slot `0x01D2`, a
 * thirteen-point hull that is a **twelve-sided ring of radius 3.22 in the XZ
 * plane** (the thirteenth point repeats the first), and a flat shadow. A shot
 * kicks its pitch and roll into a damped spring and spins it about Y; each
 * frame it re-seats itself on whichever rim vertex has dipped furthest below
 * the floor, so it wobbles round its rim and settles flat.
 *
 * `[proved]` from the whole routine, `0x0046E6E0`..`0x0046EB1B`, read with
 * `disassemble_bytes` — the pseudocode stops at the `PlaySoundId` in the hit
 * arm and again at the first `MatrixStackPop`, so the hit effect, the spins,
 * the re-seat, both draws and the shot registration are all past where it
 * ends (`L35`, `L37`):
 *
 * ```c
 * best = 10000.0;                                        // [ESP+0x10] = 0x461C4000
 * PropExpireByStepLifetime(obj);                         // result not tested (it cannot return from a despawn)
 * if (obj->+0x34 & 8) {
 *     BreakablePropAwardHit(obj->+0x34, 0);              // 0x0046E709
 *     PlaySoundId(0x1516A9);                             // COMMON\BULLET_WOD1_16.WAV
 *     SpawnPropHitEffectScaled(obj, obj->+0x34 & 2 ? 0 : 1, 1.0);   // 0x0046E72E
 *     obj->+0x1D8 = (1 - rand() % 2 * 2) * (rand() % 0x101 + 0x100);
 *     obj->+0x1E0 = (1 - rand() % 2 * 2) * (rand() % 0x101 + 0x100);
 *     obj->+0x1DC = rand() % 0x201 - 0x300;
 *     obj->+0x34 &= ~8;                                  // 0x0046E7B8 AND AL,0xF7
 * }
 * obj->+0x34 &= ~6;                                      // 0x0046E7E4
 * obj->+0x1D8 -= (obj->+0x1CC + obj->+0x1D8) / 32;       // SAR 5, rounded to zero
 * obj->+0x1DC  = ftol(obj->+0x1DC * 0.95f);
 * obj->+0x1D0 += obj->+0x1DC;
 * obj->+0x1E0 -= (obj->+0x1D4 + obj->+0x1E0) / 32;
 * obj->+0x1CC  = ftol((obj->+0x1CC + obj->+0x1D8) * 0.99f);
 * obj->+0x1D4  = ftol((obj->+0x1D4 + obj->+0x1E0) * 0.99f);
 * Push; Identity; RotY(+0x1D0); RotZ(+0x1D4); RotX(+0x1CC);
 * for (i = 0; i < 13; i++) {                              // 0x0046E8AF..0x0046E971
 *     v = M * (hull[i].x * 0.001, 0, hull[i].z * 0.001);
 *     if (v.y + obj->+0x1A0 < g_camera_fixed_eye_y - 0.1
 *         && i != (s8)obj->+0x198 && v.y < best) {
 *         best = v.y;
 *         obj->+0x1A8 = v.x + obj->+0x19C; obj->+0x198 = i;
 *         obj->+0x1AC = g_camera_fixed_eye_y; obj->+0x1B0 = v.z + obj->+0x1A4;
 *     }
 * }
 * Pop;
 * Push; Identity; Translate(+0x1A8, +0x1AC, +0x1B0); RotY; RotZ; RotX;
 * Translate(hull[c].x * -0.001, 0, hull[c].z * -0.001);  // c = obj->+0x198
 * MatrixStore(local); MatrixGetTranslation(&obj->+0x19C); Pop;
 * Push; MatrixMultiply(local); AssetDrawSlot(0x1D2); Pop;          // 0x0046EA5C
 * Push; Translate(x, g_camera_fixed_eye_y + 0.1, z); Scale(10, 1, 10);
 * NoOpStub(10.0); AssetDrawSlot(0x10D0); Pop;                      // 0x0046EAB8
 * obj->+0x70 = view * (x, y + 1.0, z); RegisterForShotTest(obj);   // 0x0046EB0D
 * ```
 *
 * So the position is **rewritten every frame** from the rest point and the
 * contact vertex: it is the pivot `T(rest) . R . T(-hull[c])`, which puts the
 * contact vertex exactly on the rest point whatever the tilt. Nothing in the
 * routine pulls it down: a prop whose rim never dips below the floor keeps its
 * placed height, and the first dip is what seats it on `g_camera_fixed_eye_y`.
 *
 * The spring does not quite come to rest level. Every step truncates, so once
 * the lead `angle + spin` is under 32 the spin stops changing, and
 * `ftol((angle + spin) * 0.99)` can hand back the same angle — roll -30 with
 * spin -1 is such a fixed point. It stands still a sixth of a degree off.
 *
 * The shot point is `(x, y + 1.0, z)` of the position **as re-seated this
 * frame** — which is why `PROP_SHOT_DERIVED` listed it: the point moves, and
 * now the port moves it too.
 *
 * Every float constant was read off the instruction stream (`L1`) and is
 * quoted beside its name.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import {
  MatrixGetTranslation, MatrixLoadIdentity, MatrixMultiply, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTransformPoint,
  MatrixTranslate,
} from "../matrix";
import { vec3 } from "../vec";
import { PropExpireByStepLifetime } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/**
 * The hull at `0x00594A68`: thirteen `{s16 x; s16 z}` pairs, scaled by 0.001
 * where they are read (`FMUL float [0x0055D2B0]`). The loop bound is the
 * literal `CMP EDI, 0x594A9E`, so the count is read, not found (`L6`). The
 * thirteenth pair repeats the first, so a prop resting on vertex 0 can re-seat
 * onto vertex 12, which is the same point.
 */
export const TYPE49_HULL: ReadonlyArray<readonly [number, number]> = [
  [3228, 0], [2796, -1610], [1614, -2789], [0, -3221], [-1614, -2789],
  [-2796, -1610], [-3228, 0], [-2796, 1610], [-1614, 2789], [0, 3221],
  [1614, 2789], [2796, 1610], [3228, 0],
];

/** `0x0055D2B0` — `0x3A83126F`, the hull's s16 scale. */
export const TYPE49_HULL_SCALE = Math.fround(0.001);
/** `0x0056903C` — `0xBA83126F`, the scale the draw's pivot translate uses. */
export const TYPE49_PIVOT_SCALE = Math.fround(-0.001);
/** `MOV [ESP+0x10], 0x461C4000` — the lowest-vertex search's starting best. */
export const TYPE49_BEST_START = 10000.0;
/** `0x004C4CC8` — `0x3DCCCCCD`: the dip below the floor that re-seats it, and the shadow's lift. */
export const TYPE49_FLOOR_EPS = Math.fround(0.1);
/** `0x0055CB40` — `0x3F733333`, the yaw spin's decay a frame. */
export const TYPE49_YAW_DECAY = Math.fround(0.95);
/** `0x005643E0` — `0x3F7D70A4`, the tilt's decay a frame. */
export const TYPE49_TILT_DECAY = Math.fround(0.99);
/** `SAR EAX, 5` — the spring pulls the spin back by a thirty-second of the lead. */
export const TYPE49_SPRING_SHIFT = 5;
/** `rand() % 0x101 + 0x100` — a kick's magnitude on each tilt axis. */
export const TYPE49_KICK_SPREAD = 0x101;
export const TYPE49_KICK_BASE = 0x100;
/** `rand() % 0x201 - 0x300` — the kick's yaw spin, always negative. */
export const TYPE49_YAW_KICK_SPREAD = 0x201;
export const TYPE49_YAW_KICK_BASE = -0x300;
/** `AssetDrawSlot(0x1D2)` at `0x0046EA5C` — the object. */
export const TYPE49_SLOT = 0x01d2;
/** `AssetDrawSlot(0x10D0)` at `0x0046EAB8` — the shadow. */
export const TYPE49_SHADOW_SLOT = 0x10d0;
/** `PUSH 0x41200000 / 0x3F800000 / 0x41200000` — the shadow's `Scale(10, 1, 10)`. */
export const TYPE49_SHADOW_SCALE: readonly [number, number, number] = [10, 1, 10];
/** `FADD float [0x004C4380]` — `0x3F800000`, the shot point's rise. */
export const TYPE49_SHOT_RISE = 1.0;
/** `SpawnPropHitEffectScaled(obj, player, 1.0)` — `PUSH 0x3F800000` at `0x0046E720`. */
export const TYPE49_HIT_EFFECT_SCALE = 1.0;
/** `obj+0x124 = 0x40A00000` in the arm case 0x31 falls into. */
export const TYPE49_RADIUS = 5.0;

/** `PlaySoundId(0x1516A9)` — `COMMON\BULLET_WOD1_16.WAV`, on every hit. */
export const SFX_TYPE49_HIT = 0x1516a9;

/**
 * `PropUpdateType49` — `FUN_0046E6E0`. `g_class41_updates[49]`. One prop,
 * one 60 Hz frame.
 *
 * `obj+0x1CC`/`+0x1D0`/`+0x1D4` are {@link BreakableProp.pitch}/`yaw`/`roll`;
 * `obj+0x1D8`, `+0x1DC` and `+0x1E0` are the pitch spin, the yaw spin and the
 * roll spin, {@link BreakableProp.spin}, {@link BreakableProp.yawSpin} and
 * {@link BreakableProp.rollSpin}; `obj+0x198` is the contact vertex,
 * {@link BreakableProp.contact}; `obj+0x1A8..0x1B0` the rest point,
 * {@link BreakableProp.restX}.. — every one the offset those fields document.
 */
export function PropUpdateType49(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // `ActorDespawn` never returns -- it ends in `ActorKill`'s longjmp -- so an
  // untested call is still the end of the routine when it despawns.
  if (PropExpireByStepLifetime(p)) return;

  if ((p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, false, rng);
    events?.emit("sound.play", { id: SFX_TYPE49_HIT });
    // `SpawnPropHitEffectScaled` (`FUN_004666B0`): the crosshair at the prop's
    // own depth, `z` from `obj+0x1A4` -- the position before this frame's
    // re-seat. `combat/shot.ts` left the aim on the prop.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE49_HIT_EFFECT_SCALE);
    }
    // Five draws, in the exe's order: sign then size for X, the same for Z,
    // then the yaw spin. `rand() & 0x80000001` with the sign fix-up is
    // `rand() % 2`. The kicks replace the spins; they do not add.
    const sx = 1 - rng.int(2) * 2;
    p.spin = sx * (rng.int(TYPE49_KICK_SPREAD) + TYPE49_KICK_BASE);
    const sz = 1 - rng.int(2) * 2;
    p.rollSpin = sz * (rng.int(TYPE49_KICK_SPREAD) + TYPE49_KICK_BASE);
    p.yawSpin = rng.int(TYPE49_YAW_KICK_SPREAD) + TYPE49_YAW_KICK_BASE;
    p.flags &= ~BreakableFlag.Hit;
  }

  // The spring, in the order the instructions store it. `(a + (a >> 31 &
  // 31)) >> 5` is the compiler's signed divide by 32, rounding to zero.
  const leadX = p.pitch + p.spin;
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);
  p.spin -= (leadX + ((leadX >> 31) & 31)) >> TYPE49_SPRING_SHIFT;
  const yawSpin = Math.trunc(p.yawSpin * TYPE49_YAW_DECAY);
  const leadZ = p.rollSpin + p.roll;
  p.yawSpin = yawSpin;
  p.yaw += yawSpin;
  p.rollSpin -= (leadZ + ((leadZ >> 31) & 31)) >> TYPE49_SPRING_SHIFT;
  p.pitch = Math.trunc((p.pitch + p.spin) * TYPE49_TILT_DECAY);
  p.roll = Math.trunc((p.roll + p.rollSpin) * TYPE49_TILT_DECAY);

  // The re-seat: the lowest rim vertex below the floor, other than the one it
  // already rests on, becomes the pivot, lifted onto the floor.
  const ground = G.g_camera_fixed_eye_y;
  const r = PropMatrixPush();
  MatrixLoadIdentity(r);
  MatrixRotateY(r, p.yaw);
  MatrixRotateZ(r, p.roll);
  MatrixRotateX(r, p.pitch);
  let best = TYPE49_BEST_START;
  const v = vec3();
  for (let i = 0; i < TYPE49_HULL.length; i++) {
    const h = TYPE49_HULL[i];
    MatrixTransformPoint(r, vec3(Math.fround(h[0] * TYPE49_HULL_SCALE), 0,
                                 Math.fround(h[1] * TYPE49_HULL_SCALE)), v);
    const vx = Math.fround(v.x);
    const vy = Math.fround(v.y);
    const vz = Math.fround(v.z);
    if (vy + p.y < ground - TYPE49_FLOOR_EPS && i !== p.contact
        && vy < best) {
      best = vy;
      p.restX = Math.fround(vx + p.x);
      p.contact = i;
      p.restY = ground;
      p.restZ = Math.fround(vz + p.z);
    }
  }

  // The pivot, from the identity: its translation is the new position.
  const local = PropMatrixPush();
  MatrixLoadIdentity(local);
  MatrixTranslate(local, p.restX, p.restY, p.restZ);
  MatrixRotateY(local, p.yaw);
  MatrixRotateZ(local, p.roll);
  MatrixRotateX(local, p.pitch);
  const c = TYPE49_HULL[p.contact];
  MatrixTranslate(local, Math.fround(c[0] * TYPE49_PIVOT_SCALE), 0,
                  Math.fround(c[1] * TYPE49_PIVOT_SCALE));
  const at = vec3();
  MatrixGetTranslation(local, at);
  p.x = Math.fround(at.x);
  p.y = Math.fround(at.y);
  p.z = Math.fround(at.z);

  const body = PropMatrixPush();
  MatrixMultiply(body, local);
  PropDrawSlot(p, body, TYPE49_SLOT);

  const shadow = PropMatrixPush();
  MatrixTranslate(shadow, p.x, Math.fround(ground + TYPE49_FLOOR_EPS), p.z);
  MatrixScale(shadow, TYPE49_SHADOW_SCALE[0], TYPE49_SHADOW_SCALE[1],
              TYPE49_SHADOW_SCALE[2]);
  // `NoOpStub(10.0)` (`FUN_0041EBB0`) at `0x0046EAAE`: a bare `RET`.
  PropDrawSlot(p, shadow, TYPE49_SHADOW_SLOT);

  PropRegisterForShotTest(p, p.x, Math.fround(p.y + TYPE49_SHOT_RISE), p.z);
}

/**
 * `PlaceGenericProp` case 0x31's arm, `0x00462397`..`0x004623EB`, which falls
 * into case 0x39's at `0x004623EC` for the radius:
 *
 * ```
 * 00462397  MOVSX EDX, word ptr [0x00594A68]   ; hull[0].x
 * 004623ac  MOV [ESI+0x1AC], EAX               ; rest y = y
 * 004623be  FSTP [ESI+0x1A8]                   ; rest x = hull[0].x * 0.001 + x
 * 004623cf  MOV byte ptr [ESI+0x198], 0        ; contact vertex 0
 * 004623e6  FSTP [ESI+0x1B0]                   ; rest z = hull[0].z * 0.001 + z
 * 004623ec  MOV [ESI+0x124], 0x40A00000        ; radius 5.0
 * ```
 *
 * So it starts resting on vertex 0, whose rest point puts the origin exactly
 * where the script placed it. No `rand()`.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462397`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType49(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.restY = p.y;
  p.restX = Math.fround(TYPE49_HULL[0][0] * TYPE49_HULL_SCALE + p.x);
  p.contact = 0;
  p.restZ = Math.fround(TYPE49_HULL[0][1] * TYPE49_HULL_SCALE + p.z);
  p.hitRadius = TYPE49_RADIUS;
}
