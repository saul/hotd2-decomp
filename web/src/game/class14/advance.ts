/**
 * `Class14AdvanceMotionAndPublishPoints` — `FUN_00476AD0`, the routine
 * `Class14Update` runs right after the state: the pose, the clock, the feet,
 * the ground under them, the legs and the two flipbooks on the chest.
 *
 * Ghidra's body stops at `0x00476F6F`; the contact-code switch at `0x00476D21`
 * jumps through `0x00477BC8` and everything to `0x00477BC7` is this routine
 * (L35). Every expression below is read from the instruction stream, the
 * `__ftol` operands included (L1).
 *
 * **Most of this is gameplay, not drawing.** The boss's own `y` follows the
 * pier and the sea floor under whichever foot is planted, the four contact
 * points are what class 0x15's floating props are pushed by, and flipbook B's
 * frame is the damage window `Class14ApplyBoneDamage` reads. The leg IK's
 * angles only feed the draw, but they are the engine's state and are kept
 * here; `render/` composes the legs from them.
 */
import { ActorFlag, type Actor } from "../actor";
import { QueryGroundHeightAt } from "../coli";
import { G } from "../globals";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixInvert, MatrixMultiply,
  MatrixRotateY, MatrixTransformPoint, MatrixTranslate, RADIANS_TO_BAMS,
  FtolS16, type Mat,
} from "../matrix";
import { DrawSkinnedModelAndShadow, SkeletonTrackFlag } from "../skeleton";
import { SpawnClass } from "../spawn_class";
import { vec3, type Vec3 } from "../vec";
import {
  Class14Flag, Class14State, type Boss2Tail, type Class14Flipbook,
} from "./state";
import { Class14AnimSlot, Class14WindowTimingRow } from "./tables";

/** The legs' bones: A is 13 (hip), 14 (knee), 15 (foot); B is 10, 11, 12. */
const LEG_A = [13, 14, 15] as const;
const LEG_B = [10, 11, 12] as const;
/** `0xBFA00000` / `0x3FA00000` — the sole, 1.25 below the ankle. */
const SOLE = 1.25;
/** `0x40200000` and `0xC0A00000` — toe 2.5 forward, heel 5.0 back from it. */
const TOE = 2.5;
const HEEL = -5;
/** `0xC106E979` / `0x4106E979` — the thigh, 8.432. */
const THIGH = Math.fround(8.432);
/** `0xC1183958` / `0x41183958` — the shin, 9.514. */
const SHIN = Math.fround(9.514);
/** `0x42B5084B` and `0x428E327F` — their squares, as the floats pushed. */
const SHIN_SQ = 90.51619720458984;
const THIGH_SQ = 71.09862518310547;
/** `[0x004C43B0]` — every ground probe starts 100 above. */
const GROUND_PROBE = 100;
/** `[0x004C4D10]` / `[0x0055D2C4]` — the y-follow's step, `±0.3f`. */
const Y_FOLLOW_MAX = Math.fround(0.3);
/** `PUSH 0x3F000000` — every leg angle eases half the way a frame. */
const LEG_EASE = 0.5;
/** `[0x0055CCD4]` — flipbook A holds `30.0 / rate` frames at each end. */
const BOOK_A_HOLD = 30;
/** B's hold below which it simply counts down, and the state reset. */
const BOOK_B_COUNTED = 0x78;
const BOOK_B_REHOLD = 10;

/**
 * The strengths each contact code gives the four records, in record order
 * (bone 15 toe, bone 12 toe, bone 15 heel, bone 12 heel): the switch at
 * `0x00476D21` through `0x00477BC8`. `0x42960000` 75, `0x43160000` 150,
 * `0x43960000` 300.
 */
const CONTACT_STRENGTHS: readonly (readonly number[])[] = [
  [75, 75, 75, 75],
  [150, 150, 150, 150],
  [150, 0, 150, 0],
  [0, 150, 0, 150],
  [300, 0, 300, 0],
  [0, 300, 0, 300],
  [0, 0, 0, 0],
];

function Tail(obj: Actor): Boss2Tail | null {
  return obj.cls === SpawnClass.Boss2 ? obj.boss2 : null;
}

/** `(int)__ftol(x)` — truncation toward zero, the whole dword kept. */
function Ftol(x: number): number {
  return Math.trunc(x) | 0;
}

/**
 * `Class14IkJointAngle` — `FUN_00477BF0`, the law of cosines as a BAMS angle:
 * the angle opposite the side whose square is `a0`, between sides `a3` and
 * `a4` whose squares are `a1` and `a2`.
 *
 * ```
 * c = (a1 + a2 - a0) / (2 * a3 * a4)      ; FST float into a1's slot
 * if (c >= 1.0f) return 0                 ; the unrounded value
 * if (cf <= -1.0f) return 0x8000
 * if (cf == 0.0f) return 0x4000
 * t = ftol(atan(sqrt(1 - cf*cf) / cf) * K)
 * return cf < 0 ? (s16)t + 0x8000 : (s16)t
 * ```
 *
 * `ftol` truncates toward zero, so the obtuse arm is `0x8000 + trunc((acos c
 * - pi) * K)`, which is not `trunc(acos(c) * K)`. The `c < 0` test reads the
 * status word after an `FMUL` that follows the `FCOMP 0.0` -- Intel leaves C0
 * undefined after `FMUL`, so reading it as "c < 0" is `[likely]`, the only
 * reading under which the obtuse arm is ever reached.
 */
export function Class14IkJointAngle(a0: number, a1: number, a2: number,
                                    a3: number, a4: number): number {
  const c = (a1 + a2 - a0) / (2 * a3 * a4);
  const cf = Math.fround(c);
  if (c >= 1) return 0;
  if (cf <= -1 || Number.isNaN(cf)) return 0x8000;
  if (cf === 0) return 0x4000;
  const t = Ftol(Math.atan2(Math.sqrt(1 - cf * cf) / cf, 1) * RADIANS_TO_BAMS);
  const s = (t << 16) >> 16;
  return cf < 0 ? s + 0x8000 : s;
}

/**
 * `Class14EaseAngleToward` — `FUN_00477C90`. Move a BAMS angle `rate` of the
 * short way toward `target`:
 *
 * ```
 * diff = ((u16)target - (u16)*f) & 0xFFFF;  if (diff > 0x8000) diff -= 0x10000
 * *f += ftol((float)diff * rate)            ; a 32-bit add, never wrapped
 * ```
 */
export function Class14EaseAngleToward(legs: number[], i: number,
                                       target: number, rate: number): void {
  let diff = ((target & 0xffff) - (legs[i] & 0xffff)) & 0xffff;
  if (diff > 0x8000) diff -= 0x10000;
  legs[i] = (legs[i] + Ftol(diff * rate)) | 0;
}

/** A point in a bone's own frame, through a copy of its matrix. */
function BonePoint(W: ArrayLike<number>, x: number, y: number, z: number,
                   out: Vec3): Mat {
  const m = MatCopy(MatIdentity(), W);
  MatrixTranslate(m, x, y, z);
  MatrixGetTranslation(m, out);
  return m;
}

/**
 * The knee's rest angle, `0x00476E55..0x00476F6B`: bone 14's (or 11's) `+y`
 * seen from the knee, `(0, 1, 0)` through `V14 * inverse(T(0, -8.432, 0) *
 * V13)`, as `(s16)ftol(atan2(out.z, out.y) * K)`. The camera cancels, so the
 * world matrices give the view ones' answer.
 */
function KneeRestAngle(Whip: ArrayLike<number>, Wknee: ArrayLike<number>):
    number {
  const m = MatCopy(MatIdentity(), Whip);
  MatrixTranslate(m, 0, -THIGH, 0);
  MatrixInvert(m);
  MatrixMultiply(m, Wknee);
  const out = vec3();
  MatrixTransformPoint(m, { x: 0, y: 1, z: 0 }, out);
  return FtolS16(Math.atan2(out.z, out.y) * RADIANS_TO_BAMS);
}

/**
 * One leg's IK, `0x00477101..0x004775BF`, for a planted foot: hip yaw, hip
 * pitch and knee toward the ankle point above the sole.
 *
 * ```
 * q = translation of T(0, 1.25, 0) * (V15 * cam with its row 3 = p15)
 * H = V13 * cam * T(0, dy, 0)                       ; the hip, after the y-follow
 * r = q * inverse(H)
 * yaw = (|r.x| < 1 || |r.z| < 1) ? 0 : (s16)ftol(atan2(-r.x, -r.z) * K)
 * s = q * inverse(RotY(yaw) * H)
 * d2 = s.y^2 + s.z^2                                ; x is not used
 * a = IkJointAngle(9.514^2, d2, 8.432^2, sqrt(d2), 8.432)
 * pitch = (s16)ftol(atan2(-s.z, -s.y) * K) - a      ; 32-bit
 * k = IkJointAngle(d2, 9.514^2, 8.432^2, 9.514, 8.432)
 * knee = 0x8000 - kneeRest - k                      ; 32-bit
 * ```
 *
 * Leg A takes the square root of the unrounded `d2` and leg B of the float
 * it stored (`FST` against `FSTP; FLD`); both pass the float to the joint
 * routine. `dy` is added in world space here and in view space by the draw.
 */
function Class14LegIk(Wfoot: ArrayLike<number>, Whip: ArrayLike<number>,
                      foot: Vec3, dy: number, kneeRest: number,
                      rootOfFloat: boolean): [number, number, number] {
  const qm = MatCopy(MatIdentity(), Wfoot);
  qm[12] = foot.x; qm[13] = foot.y; qm[14] = foot.z;
  MatrixTranslate(qm, 0, SOLE, 0);
  const q = vec3();
  MatrixGetTranslation(qm, q);
  const H = MatCopy(MatIdentity(), Whip);
  H[13] = Math.fround(H[13] + dy);
  const Hi = MatCopy(MatIdentity(), H);
  MatrixInvert(Hi);
  const r = vec3();
  MatrixTransformPoint(Hi, q, r);
  const yaw = (Math.abs(r.x) < 1 || Math.abs(r.z) < 1) ? 0
    : FtolS16(Math.atan2(-r.x, -r.z) * RADIANS_TO_BAMS);
  MatrixRotateY(H, yaw);
  MatrixInvert(H);
  const s = vec3();
  MatrixTransformPoint(H, q, s);
  const d2 = s.y * s.y + s.z * s.z;
  const d2f = Math.fround(d2);
  const d = Math.fround(Math.sqrt(rootOfFloat ? d2f : d2));
  const a = Class14IkJointAngle(SHIN_SQ, d2f, THIGH_SQ, d, THIGH);
  const pitch = (FtolS16(Math.atan2(-s.z, -s.y) * RADIANS_TO_BAMS) - a) | 0;
  const k = Class14IkJointAngle(d2f, SHIN_SQ, THIGH_SQ, SHIN, THIGH);
  const knee = (0x8000 - kneeRest - k) | 0;
  return [yaw, pitch, knee];
}

/**
 * Flipbook A, `0x0047765F..0x00477743`: ping-pong between its ends at
 * `rate` slots a frame, holding `30.0 / rate` frames at each.
 */
function Class14StepBookA(A: Class14Flipbook): void {
  if (A.hold !== 0) {
    A.hold = ((A.hold - 1) << 16) >> 16;
    return;
  }
  A.frame = FtolS16(A.frame + A.rate);
  if (A.rate > 0) {
    if (A.frame >= A.high) {
      A.frame = A.high;
      A.hold = FtolS16(BOOK_A_HOLD / A.rate);
      A.rate = Math.fround(A.rate * -1);
      return;
    }
  }
  if (A.rate < 0 && A.frame <= A.low) {
    A.frame = A.low;
    A.rate = Math.fround(A.rate * -1);
    A.hold = FtolS16(BOOK_A_HOLD / A.rate);
  }
}

/**
 * Flipbook B, the weak point, `0x00477749..0x00477919`. It opens at the
 * window row's open rate, holds open, closes, holds shut; the phase immunity
 * (`obj+0x34 & 0x100`) keeps it shut, and a hold past 0x78 -- the `-1` the
 * states write, "held until told" -- is released to a ten-frame hold only in
 * the states that attack (5 and 8..12).
 *
 * The rate clamp at the end is the exe's own and **not symmetric**:
 * `0 <= rate < 1` becomes 1.0, and `rate < -1` becomes **-1.0**. So every
 * close runs at -1.0 whatever `g_class14_window_timing`'s close rate says --
 * the row's value lasts only until the same frame's clamp. `[proved]`
 * (`FCOMP [-1.0]; TEST AH, 1; JZ` then `FCOMP [0.0]; TEST AH, 0x41; JZ`).
 */
function Class14StepBookB(obj: Actor, t: Boss2Tail): void {
  const B = t.bookB;
  const immune = (obj.flags & ActorFlag.ShotImmune) !== 0;
  if (B.hold !== 0) {
    if (immune) {
      if (B.frame !== B.low) B.hold = 0;
    } else if (B.hold >= 0 && B.hold <= BOOK_B_COUNTED) {
      B.hold -= 1;
    } else if (t.state === Class14State.Hunt
               || (t.state >= Class14State.Strike
                   && t.state <= Class14State.LeapAttack)) {
      B.hold = BOOK_B_REHOLD;
    }
  } else if (immune && B.frame === B.low) {
    B.hold = -1;
  } else {
    B.frame = FtolS16(B.frame + B.rate);
    const row = Class14WindowTimingRow(t.timing);
    if (B.frame >= B.high) {
      B.frame = B.high;
      B.hold = row.open_hold;
      B.rate = Math.fround(row.close_rate);
    } else if (B.frame <= B.low) {
      B.frame = B.low;
      B.hold = row.shut_hold;
      B.rate = Math.fround(row.open_rate);
    }
  }
  if (B.rate < 1 && !(B.rate < 0)) B.rate = 1;
  else if (B.rate < -1) B.rate = -1;
}

/** The contact code the anim slot's cue record gives this play cursor. */
function Class14ContactCode(slot: number, cursor: number): number {
  const rec = Class14AnimSlot(slot);
  if (!rec) return -1;
  // `while (*p != -1 && *p < cursor) p += 2` -- the first cue frame at or
  // past the cursor, else the record's end code.
  for (const [frame, code] of rec.cues) {
    if (frame >= cursor) return code;
  }
  return rec.end_code;
}

const _p15 = vec3();
const _p12 = vec3();

/**
 * `Class14AdvanceMotionAndPublishPoints` — `FUN_00476AD0`.
 *
 * ```
 * LightsUseSecondarySet()
 * DrawSkinnedModelAndShadow(char, xform, recs)       ; the pose, this frame
 * if (!(obj+0x34 & 0x4000)) char+0x00++              ; the clock
 * if (!(state->flags & 2)) {                         ; the feet
 *     p15 = sole of bone 15; contacts[0] = its toe; contacts[2] = its heel
 *     p12 = sole of bone 12; contacts[1] = its toe; contacts[3] = its heel
 *     contacts[*].strength = by the anim slot's cue code at the cursor
 * }
 * kneeA, kneeB = the knee rest angles
 * if (!(obj+0x34 & 0x20000) && !(char+0x37 & 1)) {   ; no hold, no cross-fade
 *     h15, h12 = ground under p15, p12
 *     dy = clamp(planted foot's h - its y, or the actor's own, +-0.3)
 *     obj.y += dy;  snap a planted or sunk foot to its ground
 *     if (a foot is on its ground) the leg IK, per planted leg
 * }
 * ease the six leg angles half way to their targets (0 for a leg not solved)
 * step flipbook A; step flipbook B
 * if (char+0x64 & 1) draw bones 1..9 with dy, the flipbooks on bone 1, the legs
 * ```
 *
 * The draw is `render/`'s: it reads the eased angles, the knee rest angles
 * and `dy` from the block, which is why the last two are published there.
 */
export function Class14AdvanceMotionAndPublishPoints(obj: Actor): void {
  const t = Tail(obj);
  const skel = obj.skel;
  if (!t || !skel) return;
  // `LightsUseSecondarySet` (`FUN_0041DC70`) -- the draw's lights.
  DrawSkinnedModelAndShadow(obj);
  if (!(obj.flags & ActorFlag.PoseFrozen)) skel.counter += 1;
  const W = (b: number): Mat => skel.bones[b].mat;
  const contacts = G.g_class14_foot_contacts;
  if (!(t.flags & Class14Flag.FeetOff)) {
    const legs: [number, Vec3, number, number][] = [
      [LEG_A[2], _p15, 0, 2], [LEG_B[2], _p12, 1, 3],
    ];
    for (const [bone, sole, toeRec, heelRec] of legs) {
      const m = BonePoint(W(bone), 0, -SOLE, 0, sole);
      const toe = vec3();
      MatrixTranslate(m, 0, 0, TOE);
      MatrixGetTranslation(m, toe);
      contacts[toeRec].x = toe.x; contacts[toeRec].y = toe.y;
      contacts[toeRec].z = toe.z;
      MatrixTranslate(m, 0, 0, HEEL);
      MatrixGetTranslation(m, toe);
      contacts[heelRec].x = toe.x; contacts[heelRec].y = toe.y;
      contacts[heelRec].z = toe.z;
    }
    const code = Class14ContactCode(t.animSlot, skel.cursor);
    const k = CONTACT_STRENGTHS[code];
    if (k) for (let i = 0; i < 4; i++) contacts[i].strength = k[i];
  }
  const kneeA = KneeRestAngle(W(LEG_A[0]), W(LEG_A[1]));
  const kneeB = KneeRestAngle(W(LEG_B[0]), W(LEG_B[1]));
  t.kneeRest[0] = kneeA;
  t.kneeRest[1] = kneeB;
  // The six targets: leg A's and leg B's hip pitch, hip yaw, knee.
  let aPitch = 0, bPitch = 0, aYaw = 0, bYaw = 0, aKnee = 0, bKnee = 0;
  let dyDraw = 0;
  if (!(obj.flags & ActorFlag.Airborne)
      && !(skel.flags & SkeletonTrackFlag.Fade)) {
    const x = obj.pos.x, z = obj.pos.z;
    const h15 = Math.fround(QueryGroundHeightAt(
      _p15.x, Math.fround(_p15.y + GROUND_PROBE), _p15.z));
    const h12 = Math.fround(QueryGroundHeightAt(
      _p12.x, Math.fround(_p12.y + GROUND_PROBE), _p12.z));
    let d: number;
    if (contacts[0].strength !== 0) d = h15 - _p15.y;
    else if (contacts[1].strength !== 0) d = h12 - _p12.y;
    else {
      d = Math.fround(QueryGroundHeightAt(
        x, Math.fround(obj.pos.y + GROUND_PROBE), z)) - obj.pos.y;
    }
    d = Math.fround(d);
    if (!(d < Y_FOLLOW_MAX)) d = Y_FOLLOW_MAX;
    else if (d <= -Y_FOLLOW_MAX) d = -Y_FOLLOW_MAX;
    obj.pos.y = Math.fround(d + obj.pos.y);
    if (contacts[0].strength !== 0 || d + _p15.y < h15) _p15.y = h15;
    if (contacts[1].strength !== 0 || d + _p12.y < h12) _p12.y = h12;
    if (_p15.y === h15 || _p12.y === h12) {
      dyDraw = d;
      if (_p15.y === h15) {
        [aYaw, aPitch, aKnee] = Class14LegIk(W(LEG_A[2]), W(LEG_A[0]), _p15,
                                             d, kneeA, false);
      }
      if (_p12.y === h12) {
        [bYaw, bPitch, bKnee] = Class14LegIk(W(LEG_B[2]), W(LEG_B[0]), _p12,
                                             d, kneeB, true);
      }
    }
  }
  t.drawDy = dyDraw;
  Class14EaseAngleToward(t.legs, 0, aPitch, LEG_EASE);
  Class14EaseAngleToward(t.legs, 1, bPitch, LEG_EASE);
  Class14EaseAngleToward(t.legs, 2, aYaw, LEG_EASE);
  Class14EaseAngleToward(t.legs, 3, bYaw, LEG_EASE);
  Class14EaseAngleToward(t.legs, 4, aKnee, LEG_EASE);
  Class14EaseAngleToward(t.legs, 5, bKnee, LEG_EASE);
  Class14StepBookA(t.bookA);
  Class14StepBookB(obj, t);
  // `if (char+0x64 & 1)` the draw, and `FUN_0041DCC0` (the lights back):
  // `render/characters.ts`, from the block.
}
