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
 * only. `step` is the arc's parameter-advance rate, not its kind; the kind is
 * `obj+0x1354`, which `SelectActorGravityAxis` writes from the surface the
 * actor is attached to.
 */
import type { ThrowerActor } from "../actor";
import { GAME_HZ } from "../class30/states";
import { ActorArcVelocity } from "./arc";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import { CharacterTypeOf } from "../tables";
import { ThrowerState } from "./states";

/** Sub-states, which the engine simply increments. */
enum PathSub {
  Begin = 0,
  Delay = 1,
  StartLeg = 2,
  Travelling = 3,
}

export function ThrowerStatePathFollow(obj: ThrowerActor, dt: number): void {
  const path = obj.path;
  if (!path || !path.points.length) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
    return;
  }

  if (obj.sub === PathSub.Begin) {
    obj.arcFrames = 0;
    obj.thr.pathLeg = 0;
    obj.thr.pathDelay = path.delay;
    obj.sub = PathSub.Delay;
  }

  if (obj.sub === PathSub.Delay) {
    obj.thr.pathDelay -= dt * GAME_HZ;
    if (obj.thr.pathDelay >= 1) return;
    obj.sub = PathSub.StartLeg;
  }

  if (obj.sub === PathSub.StartLeg) {
    const wp = path.points[obj.thr.pathLeg];
    if (!wp) { endPath(obj); return; }
    // `ActorArcBeginTo`: the duration is the 2D distance scaled by the step,
    // rounded down to a multiple of it.
    const dx = wp.dest[0] - obj.pos.x;
    const dz = wp.dest[2] - obj.pos.z;
    const n = Math.trunc(Math.hypot(dx, dz) * wp.step);
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.arcTo = { x: wp.dest[0], y: wp.dest[1], z: wp.dest[2] };
    obj.arcFrames = 0;
    obj.arcTotal = Math.max(1, n - (n % wp.step));
    obj.leap = { dest: wp.dest, frames: obj.arcTotal };
    obj.sub = PathSub.Travelling;
  }

  // Travelling: the same arc integrator the drop uses.
  const wp = path.points[obj.thr.pathLeg];
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
  obj.thr.pathLeg++;
  if (obj.thr.pathLeg >= path.points.length) { endPath(obj); return; }
  obj.sub = PathSub.StartLeg;
}

/**
 * The terminator. Character type 0x17 goes straight to state 7; everything
 * else claims an attack permit and goes to state 9 —
 * `ThrowerStateLeapDown`, which brings it off the roof and into shot.
 */
function endPath(obj: ThrowerActor): void {
  obj.leap = null;
  obj.sub = 0;
  if (CharacterTypeOf(obj)?.type === 0x17) {
    obj.state = ThrowerState.StandAndDecide;
    return;
  }
  ThrowerTryClaimAttackSlot(obj);
  obj.state = ThrowerState.Pounce;
}
