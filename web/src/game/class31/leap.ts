/**
 * `ThrowerStateLeapToPoint` — `FUN_0044E4C0`, class 0x31 state 20.
 *
 * How a spawn placed in the air reaches the ground. The descriptor names a
 * destination and a duration, and the actor rides a **ballistic arc** to it:
 * flat velocity on x and z, and a y velocity that falls under gravity and
 * still arrives exactly on time.
 *
 * Stage 2 block 5 step 6 spawns two zsass at y = 87 whose descriptors name the
 * street at y = 37 — 50 units down, over 30 and 35 frames. They were standing
 * in mid-air because the port started every class-0x31 actor in its throw
 * state and never read the descriptor's own.
 *
 * When the arc ends the actor drops into state 7, which stands and throws.
 */
import type { Actor } from "../actor";
import { ThrowerState } from "./states";

/**
 * `ActorArcVelocity` (`FUN_0044DE80`) carries this as a literal. It is half of
 * `ThrowerStateFallAndLand`'s -0.05444444, which is exactly what a discrete
 * `pos += vel; vel -= g` integrator needs for the arc to land on time.
 */
export const ARC_GRAVITY_HALF = 0.027222222;

/** `ActorArcBegin` — `FUN_0044DC10`. Record the arc; the step rebuilds it. */
export function ActorArcBegin(obj: Actor): void {
  const leap = obj.leap;
  if (!leap) return;
  obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.arcFrames = 0;
  obj.arcTotal = Math.max(1, leap.frames);
}

/**
 * `ActorArcVelocity` — `FUN_0044DE80`, case 4: the whole arc, exactly.
 *
 * ```
 * vel.x = (dst.x - src.x) / T
 * vel.z = (dst.z - src.z) / T
 * vel.y = -g2*n + (T*T*g2 + 2*dy) / (2*T)
 * ```
 */
export function ActorArcVelocity(obj: Actor): void {
  const leap = obj.leap;
  if (!leap) return;
  const T = obj.arcTotal;
  const n = obj.arcFrames;
  const dy = leap.dest[1] - obj.arcFrom.y;
  obj.vel.x = (leap.dest[0] - obj.arcFrom.x) / T;
  obj.vel.z = (leap.dest[2] - obj.arcFrom.z) / T;
  obj.vel.y = -ARC_GRAVITY_HALF * n
            + (T * T * ARC_GRAVITY_HALF + dy + dy) / (T * 2);
}

/**
 * `ActorArcStep` — `FUN_0044D860`. False once the arc is over, which is how
 * the leap states know they have landed.
 */
export function ActorArcStep(obj: Actor): boolean {
  if (obj.arcFrames >= obj.arcTotal) return false;
  ActorArcVelocity(obj);
  obj.arcFrames++;
  return true;
}

export function ThrowerStateLeapToPoint(obj: Actor): void {
  if (obj.sub === 0) {
    ActorArcBegin(obj);
    obj.sub = 1;
  }
  if (!ActorArcStep(obj)) {
    // Landed. Snap to the named point rather than to wherever rounding left
    // it, and stand up.
    if (obj.leap) {
      obj.pos.x = obj.leap.dest[0];
      obj.pos.y = obj.leap.dest[1];
      obj.pos.z = obj.leap.dest[2];
    }
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.state = ThrowerState.StandAndThrow;
    obj.sub = 0;
  }
}
