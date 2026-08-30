/**
 * `ThrowerStateLeapDown` — `FUN_0044B670`, class 0x31 state 9.
 *
 * What a thrower does when its route ends: it comes down off the roof and
 * lands **in front of you**. `ThrowerStatePathFollow` hands here for every
 * character type but 0x17, having claimed an attack permit on the way.
 *
 * The landing point is not a place in the world — it is a place on the
 * *screen*. `ThrowerPickLandingPoint` takes a pixel offset, divides it by
 * `g_projection_distance_px` and unprojects at a fixed depth, so the actor
 * always arrives the same distance in front of the camera and the same
 * distance below it however the camera happens to be pointing. That is why a
 * zsass drops into shot rather than onto a spot on the map.
 */
import type { Actor } from "../actor";
import { GAME_HZ } from "../class30/states";
import type { GameHost } from "../host";
import { CharacterTypeOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { ActorArcVelocity } from "./leap";
import { ThrowerState } from "./states";

/** `local_10` — the depth the landing point is unprojected at. */
const LANDING_DEPTH = -15.5;
/** `fVar2` — the vertical pixel offset, by character type. */
const LANDING_PX_ZSASS = 390;
const LANDING_PX_OTHER = 320;
/**
 * `g_projection_distance_px` — 0x009A2D70.
 *
 * [likely] Not read out of the binary; derived from `SetupSceneProjection`,
 * which builds the projection from 41.100 degrees vertical over 4:3. For a
 * 480-line frame that is `240 / tan(41.1/2)` = 640.2. Only the ratio
 * `px / this` matters, and it puts the landing point 9.4 units below the eye.
 */
const PROJECTION_DISTANCE_PX = 640.2;

/** `FUN_0044CBA0`. Where to land: a screen offset, unprojected. */
export function ThrowerPickLandingPoint(obj: Actor, host: GameHost,
                                        out: Vec3): void {
  const px = CharacterTypeOf(obj)?.type === 0x16
    ? LANDING_PX_ZSASS : LANDING_PX_OTHER;
  // The sideways offset is +/-160px per player and zero with one attacker,
  // which is the only case this port has.
  host.viewPoint(0, (px * LANDING_DEPTH) / PROJECTION_DISTANCE_PX,
                 LANDING_DEPTH, out);
}

export function ThrowerStateLeapDown(obj: Actor, host: GameHost,
                                     dt: number): void {
  if (obj.sub === 0) {
    const dest = vec3();
    ThrowerPickLandingPoint(obj, host, dest);
    // `ActorArcBeginToWaypoint(obj, dest, <default set>, 1)`: step 1, so the
    // duration is the 2D distance in frames.
    const n = Math.trunc(Math.hypot(dest.x - obj.pos.x, dest.z - obj.pos.z));
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.arcFrames = 0;
    obj.arcTotal = Math.max(1, n);
    obj.leap = { dest: [dest.x, dest.y, dest.z], frames: obj.arcTotal };
    obj.sub = 1;
  }

  if (obj.arcFrames < obj.arcTotal) {
    ActorArcVelocity(obj);
    obj.arcFrames += dt * GAME_HZ;
    obj.pos.x += obj.vel.x * dt * GAME_HZ;
    obj.pos.y += obj.vel.y * dt * GAME_HZ;
    obj.pos.z += obj.vel.z * dt * GAME_HZ;
    return;
  }

  if (obj.leap) {
    obj.pos.x = obj.leap.dest[0];
    obj.pos.y = obj.leap.dest[1];
    obj.pos.z = obj.leap.dest[2];
  }
  obj.vel.x = obj.vel.y = obj.vel.z = 0;
  obj.leap = null;
  // The engine goes to state 10, which is unread; this port's one class-0x31
  // behaviour is to stand and throw, which is what the descent was for.
  obj.state = ThrowerState.StandAndThrow;
  obj.sub = 0;
}
