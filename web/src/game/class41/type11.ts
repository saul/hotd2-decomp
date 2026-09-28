/**
 * Class 0x41 type 11 — a two-frame model that circles its spawn point until it
 * is shot, and then drops to the floor.
 *
 * One shipped spawn: stage 2's descriptor at evt `0x11F40`, placed by the
 * `spawn_placed` ops of block 23 step 4 (`0xFA38`) and block 26 step 0
 * (`0x11838`), at `(-545.8, 15, -1310.2)` with a one-step lifetime. The ground
 * plane there is -12.69, so a shot one falls 27.7 units.
 *
 * What it is: `[open]`. It draws slot `0x01CF` on even frames of
 * `g_frame_counter` and `0x01D0` on odd ones — a two-frame flip — circling at a
 * radius that breathes between 2.5 and 3.5 and bobbing up to 1.5.
 *
 * `[proved]` from the whole routine, `0x00467C80`..`0x00467E44`, read with
 * `disassemble_bytes`; the pseudocode stops at the `MatrixStackPop`, and the
 * shot registration is past it (`L35`):
 *
 * ```c
 * PropExpireByStepLifetime(obj);                      // result not tested
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000)) {
 *     BreakablePropAwardHit(obj->+0x34, 1);           // 0x00467CA2
 *     obj->+0x34 |= 0x40000000;                       // latched: never pays again
 * }
 * if (!(obj->+0x34 & 0x40000000)) {                   // circling
 *     obj->+0x1D0 += 0x400;  obj->+0x1CC += 0x1000;
 *     obj->+0x1DC += rand() % 0x501 + 0x900;
 *     s = sin(obj->+0x1DC);                           // BAMS, kept on the FPU
 *     obj->+0x2C0 = s * 0.5 + 3.0;  obj->+0x2C4 = s * 1.5;
 * } else {                                            // falling
 *     obj->+0x1C4 -= 0.02722;  obj->+0x1A0 += obj->+0x1C4;
 *     if (obj->+0x1A0 < g_camera_fixed_eye_y) obj->+0x1A0 = g_camera_fixed_eye_y;
 * }
 * Push;
 * Translate(x + sin(+0x1D0) * +0x2C0, y + sin(+0x1CC) * +0x2C4,
 *           z + cos(+0x1D0) * +0x2C0);
 * RotY(-obj->+0x1D0);
 * AssetDrawSlot((g_frame_counter & 1) + 0x1CF);       // 0x00467DE9
 * Pop;
 * obj->+0x70 = view * (x, y, z); RegisterForShotTest(obj);   // 0x00467E38
 * ```
 *
 * The routine **never masks the hit bits**: there is no `AND` on `obj+0x34`
 * anywhere in it. After the first hit the latch makes bit 3 irrelevant, so
 * nothing reads the bits it leaves set. No sound and no hit effect either.
 *
 * The sphere is the **raw origin** while the model circles up to 3.5 units
 * away from it, and once it falls the origin falls with it. `radius 2.0`.
 *
 * Every float constant was read off the instruction stream (`L1`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { G } from "../globals";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/**
 * The words of the 0x378 object `PropUpdateType11` keeps that no shared field
 * carries.
 */
export interface Type11Words {
  /** `obj+0x2C4` — the bob's amplitude, `sin(+0x1DC) * 1.5`. */
  o2C4: number;
}
const TYPE11_WORDS_ZERO: Type11Words = { o2C4: 0 };

/** `obj+0x34` bit 30 — shot once; the circling stops and the fall begins. */
export const TYPE11_SHOT_LATCH = 0x40000000;
/** `ADD EAX, 0x400` on `+0x1D0` — the circle, BAMS a frame. */
export const TYPE11_ORBIT_STEP = 0x400;
/** `ADD EDX, 0x1000` on `+0x1CC` — the bob's phase, BAMS a frame. */
export const TYPE11_BOB_STEP = 0x1000;
/** `rand() % 0x501 + 0x900` — the breathing's phase step, BAMS a frame. */
export const TYPE11_BREATH_SPREAD = 0x501;
export const TYPE11_BREATH_BASE = 0x900;
/** `FMUL float [0x004C43AC]` (`0x3F000000`) and `FADD float [0x004C49C0]` (`0x40400000`). */
export const TYPE11_RADIUS_SWING = 0.5;
export const TYPE11_RADIUS_MID = 3.0;
/** `FMUL float [0x004C4CB8]` — `0x3FC00000`, the bob's peak. */
export const TYPE11_BOB_SWING = 1.5;
/** `FSUB float [0x0055CB10]` — `0x3CDEFC7A`, the fall's gravity. */
export const TYPE11_GRAVITY = Math.fround(0.02722);
/** `0x1CF + (g_frame_counter & 1)`. */
export const TYPE11_SLOT = 0x01cf;
/** `obj+0x124 = 0x40000000`, the arm cases 0x0B and 0x3C share. */
export const TYPE11_RADIUS = 2.0;

/**
 * `PropUpdateType11` — `FUN_00467C80`. `g_class41_updates[11]`. One prop, one
 * 60 Hz frame.
 *
 * For this routine `obj+0x1D0` ({@link BreakableProp.yaw}) is the angle round
 * the circle, `obj+0x1CC` ({@link BreakableProp.pitch}) the bob's phase,
 * `obj+0x1DC` ({@link BreakableProp.yawSpin}) the breathing's phase and
 * `obj+0x2C0` ({@link BreakableProp.shake}) the circle's radius — each the
 * offset that field documents, none the meaning (`L3`). `obj+0x1C4` is
 * {@link BreakableProp.vy}.
 */
export function PropUpdateType11(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void events;
  PropDrawBegin(p);
  // `ActorDespawn` never returns, so the untested call still ends the routine.
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, TYPE11_WORDS_ZERO);

  if ((p.flags & BreakableFlag.Hit) !== 0
      && (p.flags & TYPE11_SHOT_LATCH) === 0) {
    BreakablePropAwardHit(p.flags, true, rng);
    p.flags |= TYPE11_SHOT_LATCH;
  }

  if ((p.flags & TYPE11_SHOT_LATCH) === 0) {
    p.yaw += TYPE11_ORBIT_STEP;
    p.pitch += TYPE11_BOB_STEP;
    p.yawSpin += rng.int(TYPE11_BREATH_SPREAD) + TYPE11_BREATH_BASE;
    // `FILD; FMUL double [0x004C4370]; FSIN` and both products from the one
    // value on the FPU, so the double constant and no float store between.
    const s = Math.sin(p.yawSpin * BAMS_TO_RAD_F64);
    p.shake = Math.fround(s * TYPE11_RADIUS_SWING + TYPE11_RADIUS_MID);
    w.o2C4 = Math.fround(s * TYPE11_BOB_SWING);
  } else {
    // `FLD vy; FSUB; FST vy; FADD y; FST y; FCOMP ground`: the sum and the
    // compare use the unrounded velocity, and the compare the unrounded sum.
    const vy = p.vy - TYPE11_GRAVITY;
    p.vy = Math.fround(vy);
    const y = vy + p.y;
    p.y = Math.fround(y);
    if (y < G.g_camera_fixed_eye_y) p.y = G.g_camera_fixed_eye_y;
  }

  const a = p.yaw * BAMS_TO_RAD_F64;
  const m = PropMatrixPush();
  MatrixTranslate(m,
                  Math.fround(Math.sin(a) * p.shake + p.x),
                  Math.fround(Math.sin(p.pitch * BAMS_TO_RAD_F64) * w.o2C4
                              + p.y),
                  Math.fround(Math.cos(a) * p.shake + p.z));
  MatrixRotateY(m, -p.yaw);
  PropDrawSlot(p, m, (G.g_frame_counter & 1) + TYPE11_SLOT);

  PropRegisterForShotTest(p, p.x, p.y, p.z);
}

/**
 * `PlaceGenericProp` case 0x0B's arm, `0x004624C4`..`0x004624D2`, which type
 * 60 (case 0x3C) shares: `obj+0x124 = 0x40000000` and nothing else.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004624C4`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType11(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.hitRadius = TYPE11_RADIUS;
}
