/**
 * Where a zombie actually is — the per-frame placement pass.
 *
 * `EnemyZombieUpdate` runs the state, integrates the velocity, and then calls
 * a hook installed at `obj+0x12F0`. That hook is
 * `ZombiePushOutOfWorldAndActors` (`FUN_00454900`), and it is the answer to
 * "what puts these things on the floor": **every class-0x30 actor is snapped
 * to the collision height every frame**, from a probe six units above its own
 * y.
 *
 * The port had none of it, and it shows exactly where you would expect. An
 * actor's y was whatever its spawn record said, for ever. Stage 2's block 16
 * runs across ground that drops from -25 to -34.5 over a few units, so the
 * zombies there stand at the height the script wrote and the floor leaves
 * without them — buried at one end of the slope and floating at the other.
 */
import { ActorFlag, ZombieFlag2, type Actor } from "../actor";
import { ColiTestSphereAgainstFullSet, QueryGroundHeightAt } from "../coli";
import { G } from "../globals";
import { ZombieState } from "./states";

/** `ActorSnapToGroundHeight` probes from this far above the actor's own y. */
const GROUND_PROBE_RISE = 6;
/** ...and lets go rather than snapping past a drop of more than this. */
const GROUND_SNAP_LIMIT = 10;
/** `ZombiePushOutOfWorldAndActors`' shove timer, and the bit it flips. */
const SHOVE_PERIOD = 0x3c;
/** `ActorUpdateBoundingSphere`'s two lifts. */
const SPHERE_RISE = 1;
const SPHERE_RISE_LOW = 0.5;

/**
 * `ActorUpdateBoundingSphere` — `FUN_00454AC0`.
 *
 * `obj+0x12C/0x130/0x134` is the sphere everything else tests: the actor's own
 * x and z, with y lifted by its radius `obj+0x128` and then by one unit — or a
 * half when `obj+0x136C` bit `0x2000000` is set.
 */
export function ActorUpdateBoundingSphere(obj: Actor): void {
  obj.camPoint.x = obj.pos.x;
  obj.camPoint.z = obj.pos.z;
  obj.camPoint.y = obj.pos.y + obj.radius
    + ((obj.flags2 & ZombieFlag2.LowSphere) ? SPHERE_RISE_LOW : SPHERE_RISE);
}

/**
 * `ActorSnapToGroundHeight` — `FUN_00454B10`.
 *
 * Snap to the collision floor — unless the actor is allowed to fall
 * (`obj+0x136C` bit `0x4000000`) **and** is more than ten units above it, in
 * which case it goes to `ZombieStateFallToGround` instead. Note the two other
 * arms: an actor *below* the floor is always brought up, and one within ten
 * units is always stuck to it, which is what lets a zombie walk a slope
 * without ever leaving the ground.
 */
export function ActorSnapToGroundHeight(obj: Actor): void {
  const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + GROUND_PROBE_RISE,
                                     obj.pos.z);
  if (!(obj.flags2 & ZombieFlag2.MayFall)
      || obj.pos.y <= ground
      || Math.abs(obj.pos.y - ground) <= GROUND_SNAP_LIMIT) {
    obj.pos.y = ground;
    return;
  }
  if (obj.state !== ZombieState.FallToGround) {
    obj.state = ZombieState.FallToGround;
    obj.sub = 0;
  }
}

/**
 * `ZombiePushOutOfWorldAndActors` — `FUN_00454900`. The hook at `obj+0x12F0`.
 *
 * [open] The **actor-versus-actor** half is not ported.
 * `ColiTestSphereAgainstActors` pushes an actor out of another by a tenth of
 * the penetration each frame — 1.8x while `obj+0x34` carries either airborne
 * bit — and `game/coli.ts` has no entry point for it. It is what stops a crowd
 * occupying one point, and it is the next thing worth reading here.
 */
export function ZombiePushOutOfWorldAndActors(obj: Actor, frames: number): void {
  obj.flags2 &= ~ZombieFlag2.Shoved;
  ActorUpdateBoundingSphere(obj);

  if (obj.flags2 & ZombieFlag2.CollideWorld) {
    if (ColiTestSphereAgainstFullSet(obj.camPoint.x, obj.camPoint.y,
                                     obj.camPoint.z, obj.radius)) {
      const d = G.g_coli_hit_depth;
      obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
      obj.pos.y += (G.g_coli_hit_normal[1] ?? 0) * d;
      obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
      obj.flags2 |= ZombieFlag2.Shoved;
      ActorUpdateBoundingSphere(obj);
    }
  }

  // `obj+0x34` bit 0x20000 is airborne: a leaping actor is not on the floor
  // and must not be pulled down onto it mid-arc.
  if (!(obj.flags & ActorFlag.Airborne)) ActorSnapToGroundHeight(obj);
  ActorUpdateBoundingSphere(obj);

  obj.shoveTimer -= frames;
  if (obj.shoveTimer < 0 && (obj.flags2 & ZombieFlag2.Shoved)) {
    obj.shoveTimer = SHOVE_PERIOD;
    // Which way `ZombieStateBackOff` turns, flipped so a wedged actor does not
    // keep retreating into the same corner.
    obj.flags2 ^= ZombieFlag2.BackOffTurnFlip;
  }
}
