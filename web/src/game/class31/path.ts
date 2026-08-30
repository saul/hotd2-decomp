/**
 * `ThrowerStatePathFollow` — `FUN_0044EE00`, class 0x31 state 26.
 *
 * A spawn that walks a route before it fights. The descriptor carries a delay
 * and then a list of waypoints, and the actor arcs to each in turn.
 *
 * Stage 2 block 3's zsass — `3/3/4`, descriptor `0x1EF0` — waits 30 frames and
 * then climbs: to y = 100, then y = 110, then y = 115, and only then starts
 * throwing. The port had no state 26, so it stood at its spawn point and threw
 * from there.
 *
 * Each leg is `ActorArcBeginTo`, whose duration comes out as
 * `n - n % step` for `n = (int)(dist2d * step)` — the **2D** distance, x and z
 * only. So `step` is frames per unit: 1 is a unit a frame. The same number is
 * the arc kind `ActorArcStep` switches on.
 */
import type { Actor } from "../actor";
import { GAME_HZ } from "../class30/states";
import { ActorArcVelocity } from "./leap";
import { ThrowerState } from "./states";

/** Sub-states, which the engine simply increments. */
enum PathSub {
  Begin = 0,
  Delay = 1,
  StartLeg = 2,
  Travelling = 3,
}

export function ThrowerStatePathFollow(obj: Actor, dt: number): void {
  const path = obj.path;
  if (!path || !path.points.length) {
    obj.state = ThrowerState.StandAndThrow;
    obj.sub = 0;
    return;
  }

  if (obj.sub === PathSub.Begin) {
    obj.arcFrames = 0;
    obj.pathLeg = 0;
    obj.pathDelay = path.delay;
    obj.sub = PathSub.Delay;
  }

  if (obj.sub === PathSub.Delay) {
    obj.pathDelay -= dt * GAME_HZ;
    if (obj.pathDelay >= 1) return;
    obj.sub = PathSub.StartLeg;
  }

  if (obj.sub === PathSub.StartLeg) {
    const wp = path.points[obj.pathLeg];
    if (!wp) { endPath(obj); return; }
    // `ActorArcBeginTo`: the duration is the 2D distance scaled by the step,
    // rounded down to a multiple of it.
    const dx = wp.dest[0] - obj.pos.x;
    const dz = wp.dest[2] - obj.pos.z;
    const n = Math.trunc(Math.hypot(dx, dz) * wp.step);
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.arcFrames = 0;
    obj.arcTotal = Math.max(1, n - (n % wp.step));
    obj.leap = { dest: wp.dest, frames: obj.arcTotal };
    obj.sub = PathSub.Travelling;
  }

  // Travelling: the same arc integrator the drop uses.
  const wp = path.points[obj.pathLeg];
  if (!wp) { endPath(obj); return; }
  if (obj.arcFrames < obj.arcTotal) {
    ActorArcVelocity(obj);
    obj.arcFrames += dt * GAME_HZ;
    obj.pos.x += obj.vel.x * dt * GAME_HZ;
    obj.pos.y += obj.vel.y * dt * GAME_HZ;
    obj.pos.z += obj.vel.z * dt * GAME_HZ;
    return;
  }

  // Arrived. Snap to the waypoint and take the next leg.
  obj.pos.x = wp.dest[0];
  obj.pos.y = wp.dest[1];
  obj.pos.z = wp.dest[2];
  obj.vel.x = obj.vel.y = obj.vel.z = 0;
  obj.pathLeg++;
  if (obj.pathLeg >= path.points.length) { endPath(obj); return; }
  obj.sub = PathSub.StartLeg;
}

/**
 * The terminator. Character type 0x17 goes to state 7; everything else claims
 * an attack permit and goes to state 9.
 *
 * [diverges] State 9 is unread, so both land in the port's one class-0x31
 * behaviour — stand and throw — which is what the route was walked to reach.
 */
function endPath(obj: Actor): void {
  obj.leap = null;
  obj.state = ThrowerState.StandAndThrow;
  obj.sub = 0;
}
