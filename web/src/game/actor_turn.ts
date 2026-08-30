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
 * How much of the remaining angle is taken per second.
 *
 * [diverges] The engine turns a fixed number of BAMS per frame from a table
 * that has not been read; this eases instead. It is the wrong curve but the
 * right destination, and the destination is what was getting the facing wrong.
 */
const TURN_RATE = 4;

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
