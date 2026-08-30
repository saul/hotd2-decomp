/**
 * Turning.
 *
 * Actors turn their **whole body** toward the camera and nothing aims a bone:
 * the per-frame pose hook has exactly two implementations in the program, a
 * no-op and a collision push-out, and `SkeletonWalkNode` reads every rotation
 * straight from the motion bank.
 */
import type { Actor } from "./actor";
import { VecToAngles, bamsDelta, bamsWrap, type Vec3 } from "./vec";

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
  const step = Math.abs(rate) * dt * 60;
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
