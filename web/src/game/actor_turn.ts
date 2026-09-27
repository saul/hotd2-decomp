/**
 * Turning.
 *
 * Actors turn their **whole body** toward the camera and nothing aims a bone:
 * the per-frame pose hook has exactly two implementations in the program, a
 * no-op and a collision push-out, and `SkeletonWalkNode` reads every rotation
 * straight from the motion bank.
 */
import { SecondsToTicks } from "./tables";
import type { Actor } from "./actor";
import { VecToAngles, bamsDelta, bamsWrap, type Vec3 } from "./vec";
import {
  FtolS16, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint, RADIANS_TO_BAMS,
} from "./matrix";

/**
 * How much of the remaining angle is taken per second when no rate is given.
 *
 * [diverges] `TurnAngleToward` (`FUN_00409E00`) takes a BAMS-per-frame rate —
 * `ZombieStateHoldAtRange` passes 0x40, `ZombieStateBackOff` passes -0x40 —
 * and its exact clamp has not been read. This eases toward the target instead
 * and treats the rate as a multiplier. The destination is right, which is what
 * was getting the facing wrong before.
 */
const TURN_RATE = 4;

/**
 * `TurnAngleToward` — `FUN_00409E00`. Step an angle toward another by at most
 * *rate* BAMS per 60 Hz frame.
 *
 * A **rate limit, not an ease**. Treating 0x40 as a fraction of the remaining
 * angle made the turn snap round in a few frames, and that is what let a
 * retreating zombie whip about the moment it passed its own anchor and walk
 * back into the camera. At 0x40 a frame it creeps — a third of a degree — and
 * cannot reverse in one step.
 */
export function TurnAngleToward(cur: number, want: number, rate: number,
                                dt: number): number {
  const step = Math.abs(rate) * SecondsToTicks(dt);
  const d = bamsDelta(want, cur);
  if (Math.abs(d) <= step) return bamsWrap(want);
  return bamsWrap(cur + Math.sign(d) * step);
}

/**
 * `TurnActorTowardCamera` — `FUN_00409ED0`.
 *
 * The angle is `VecToAngles(obj.x - p.x, 0, obj.z - p.z)` — **actor minus
 * camera**, not camera minus actor. Writing it the other way round is a clean
 * 180 degrees, and since the turn is eased it reads as the zombie slowly
 * rotating away from you.
 */
export function TurnActorTowardCamera(obj: Actor, eye: Vec3, dt: number): void {
  const want = VecToAngles(obj.pos.x - eye.x, 0, obj.pos.z - eye.z).yaw;
  const d = bamsDelta(want, obj.yaw);
  obj.yaw = bamsWrap(obj.yaw + d * Math.min(1, dt * TURN_RATE));
}

/**
 * `TurnActorTowardCameraEye` — `FUN_00409E80`. The same turn with an explicit
 * BAMS-per-frame rate, measured straight to the camera eye rather than to the
 * offset point `TurnActorTowardCamera` builds.
 */
export function TurnActorTowardCameraEye(obj: Actor, eye: Vec3,
                                         rate: number, dt = 1 / 60): void {
  const want = VecToAngles(obj.pos.x - eye.x, 0, obj.pos.z - eye.z).yaw;
  obj.yaw = TurnAngleToward(obj.yaw, want, rate, dt);
}

/**
 * `TurnActorAwayFromPoint` — `FUN_00409F90`. Turn relative to an arbitrary
 * point; a negative rate is what `ZombieStateBackOff` passes to face away.
 */
export function TurnActorAwayFromPoint(obj: Actor, p: Vec3, rate: number,
                                     dt: number): void {
  // A **negative rate turns to the opposite** of `VecToAngles(obj - p)`, and
  // this is settled by watching the retreat: `p` is where the strike began,
  // which is further from the camera than the actor now is, so `obj - p`
  // points *inward*. The back-away clip's root is +Z, away from the facing, so
  // an unflipped angle walks the zombie into the camera instead of out of it.
  const dx = obj.pos.x - p.x;
  const dz = obj.pos.z - p.z;
  // Standing on the point gives no direction at all. `VecToAngles(0,0,0)`
  // returns zero, which would snap the actor to face north; holding the
  // current facing is the honest reading of "there is nothing to turn to".
  if (dx * dx + dz * dz < 1e-4) return;
  const want = VecToAngles(dx, 0, dz).yaw + (rate < 0 ? 0x8000 : 0);
  obj.yaw = TurnAngleToward(obj.yaw, want, rate, dt);
}

/**
 * `ActorFacePlayerTarget` — `FUN_00455F40`. Snap the yaw straight at the
 * player — no easing — and remember where that player was.
 *
 * With one attacker the target is the camera eye. With two it is a shoulder
 * offset from it, per permit index, which is why the point is stored on the
 * actor rather than recomputed: the strike's lunge and the retreat both
 * measure against the same remembered spot.
 */
export function ActorFacePlayerTarget(obj: Actor, eye: Vec3): void {
  obj.target.x = eye.x;
  obj.target.y = eye.y;
  obj.target.z = eye.z;
  obj.yaw = bamsWrap(
    VecToAngles(obj.pos.x - eye.x, 0, obj.pos.z - eye.z).yaw);
}

const _heading: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `ActorHeadingErrorTo` — `FUN_00426090`. The signed BAMS heading of an x/z
 * offset **in the actor's own frame**: `(dx, 0, dz)` through the inverse of
 * the actor's rotation, then `atan2(x, z)`.
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity()
 * MatrixRotateY(-obj+0x68); MatrixRotateZ(-obj+0x6C); MatrixRotateX(-obj+0x64)
 * MatrixTransformPoint({dx, 0, dz}, &out); MatrixStackPop(1)
 * 004260f3  FLD [out.x]; FLD [out.z]; FPATAN        ; atan2(x', z')
 * 00426100  FMUL double ptr [0x004c4378]            ; * 65536/2pi
 * 00426106  CALL __ftol; MOVSX EAX, AX
 * ```
 *
 * The tail after `MatrixStackPop` is where the answer is computed, and
 * Ghidra's listing stops at the pop (L35). The pitch and roll are part of the
 * transform: a class whose actor is tilted gets the heading in its tilted
 * frame, which a plain `atan2` of the offset against the yaw does not give.
 */
export function ActorHeadingErrorTo(obj: Actor, dx: number, dz: number): number {
  const m = MatIdentity();
  MatrixRotateY(m, -obj.yaw);
  MatrixRotateZ(m, -obj.roll);
  MatrixRotateX(m, -obj.pitch);
  MatrixTransformPoint(m, { x: dx, y: 0, z: dz }, _heading);
  return FtolS16(Math.atan2(_heading.x, _heading.z) * RADIANS_TO_BAMS);
}

/**
 * `ActorTurnTowardXZ` — `FUN_00426120`. Turn the yaw toward an x/z offset by
 * at most `step` BAMS:
 *
 * ```
 * e = ActorHeadingErrorTo(obj, dx, dz)
 * 0042613c  CMP EAX, ECX; JLE      ; e >  step: yaw += step
 * 0042614e  CMP EAX, EDX; JGE      ; e < -step: yaw -= step
 *           otherwise               ;            yaw += e
 * ```
 *
 * The yaw is an `int` and is not wrapped -- `ADD`/`SUB` on the dword -- so
 * neither is it here.
 */
export function ActorTurnTowardXZ(obj: Actor, dx: number, dz: number,
                                  step: number): void {
  const e = ActorHeadingErrorTo(obj, dx, dz);
  if (e > step) { obj.yaw = (obj.yaw + step) | 0; return; }
  if (e < -step) { obj.yaw = (obj.yaw - step) | 0; return; }
  obj.yaw = (obj.yaw + e) | 0;
}

const _ahead: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `ActorPointIsAhead` — `FUN_0045BC10`. Is the point in front of the actor?
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity()
 * MatrixRotateY(-angles[1]); MatrixRotateZ(-angles[2]); MatrixRotateX(-angles[0])
 * MatrixTransformPoint(p - pos, &out); MatrixStackPop(1)
 * 0045bc7e  FLD [out.z]; FCOMP 0.0; TEST AH, 0x41; JNZ -> 0     ; z > 0
 * ```
 *
 * The inverse of **all three** angles, as {@link ActorHeadingErrorTo} takes
 * them -- the arguments are pointers to `obj+0x64` and `obj+0x40`. It lived in
 * `class30/target.ts` as the yaw alone, which is the same number for an
 * upright actor and every zombie is one; the stage-4 boss is a second caller,
 * so there is one copy of it here now. `z` alone for the yaw-only case is
 * `dx·sin(yaw) + dz·cos(yaw)`, the inverse rotation -- the sign that stage 1's
 * block-1 captor found.
 */
export function ActorPointIsAhead(obj: Pick<Actor, "pos" | "yaw" | "pitch"
                                           | "roll">, p: Vec3): boolean {
  const m = MatIdentity();
  MatrixRotateY(m, -obj.yaw);
  // `|| 0`: a caller holding an upright actor may hand over one with no
  // pitch or roll fields at all, and those are zero.
  MatrixRotateZ(m, -(obj.roll || 0));
  MatrixRotateX(m, -(obj.pitch || 0));
  MatrixTransformPoint(m, { x: p.x - obj.pos.x, y: p.y - obj.pos.y,
                            z: p.z - obj.pos.z }, _ahead);
  return _ahead.z > 0;
}
