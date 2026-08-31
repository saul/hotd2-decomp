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
 * When the arc ends the actor drops into state 7, which stands and decides.
 */
import type { Actor } from "../actor";
import { vec3 } from "../vec";
import { ActorArcBegin, ActorArcVelocity } from "./arc";
import { ThrowerState } from "./states";

const _dest = vec3();

/**
 * `ActorArcStep` as this state uses it.
 *
 * [diverges] The engine installs a three-stage arc motion script here as well
 * — `0x00564918` or its byte-identical twin `0x00564948` at random, and
 * `0x00565E28` for character type 0x17 — and steps the full phase machine.
 * This integrates the velocity instead and plays no clip, which is what the
 * port has always done for the drop; the landing point is identical either
 * way, because it is data.
 */
function stepArc(obj: Actor): boolean {
  if (obj.arcFrames >= obj.arcTotal) return false;
  ActorArcVelocity(obj);
  obj.arcFrames++;
  return true;
}

export function ThrowerStateLeapToPoint(obj: Actor): void {
  const leap = obj.leap;
  if (!leap) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
    return;
  }
  if (obj.sub === 0) {
    _dest.x = leap.dest[0];
    _dest.y = leap.dest[1];
    _dest.z = leap.dest[2];
    ActorArcBegin(obj, _dest, leap.frames);
    obj.sub = 1;
  }
  if (!stepArc(obj)) {
    // Landed. Snap to the named point rather than to wherever rounding left
    // it, and stand up.
    obj.pos.x = leap.dest[0];
    obj.pos.y = leap.dest[1];
    obj.pos.z = leap.dest[2];
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
  }
}
