/**
 * Where a zombie actually is — the per-frame placement pass.
 *
 * `EnemyZombieUpdate` runs the state, integrates the velocity, and draws; the
 * draw's `SkeletonApplyRootMotion` calls the hook installed at `obj+0x12F0`
 * (`CALL [model+0x115C]` at `0x00410E93`, after the frame's root motion and
 * before any node). That hook is `ZombiePushOutOfWorldAndActors`
 * (`FUN_00454900`), and it is the answer to "what puts these things on the
 * floor" and "what keeps a crowd apart": **every class-0x30 actor is pushed
 * out of the others and snapped to the collision height every frame**, from a
 * probe six units above its own y.
 *
 * The port had none of it, and it shows exactly where you would expect. An
 * actor's y was whatever its spawn record said, for ever. Stage 2's block 16
 * runs across ground that drops from -25 to -34.5 over a few units, so the
 * zombies there stand at the height the script wrote and the floor leaves
 * without them — buried at one end of the slope and floating at the other.
 */
import {
  ActorFlag, ActorUpdateBoundingSphere, ZombieFlag2, type ZombieActor,
} from "../actor";
import {
  ColiTestSphereAgainstActors, ColiTestSphereAgainstFullSet,
  QueryGroundHeightAt,
} from "../coli";
import { ActorByAt, G } from "../globals";
import { ZOMBIE_SPRINTS, ZombieState } from "./states";

/** `ActorSnapToGroundHeight` probes from this far above the actor's own y. */
const GROUND_PROBE_RISE = 6;
/** ...and lets go rather than snapping past a drop of more than this. */
const GROUND_SNAP_LIMIT = 10;
/** `ZombiePushOutOfWorldAndActors`' shove timer, and the bit it flips. */
const SHOVE_PERIOD = 0x3c;
/**
 * The push applies a tenth of the penetration a frame (`0x004c4cc8`,
 * `cdcccc3d`) -- 1.8x that (`0x0055dd48`, `6666e63f`) while the actor holds
 * either bit of {@link PushBoostBits}.
 */
const PUSH_FRACTION = 0.1;
const PUSH_BOOST = 1.8;
/**
 * `obj+0x34 & 0x18000000`, tested at `00454944` on the actor that did the
 * pushing and at `004549b6` on this one. `[port-only]` as a function, so the
 * mask is built when the routine runs rather than at module load (L56).
 *
 * The two bits are {@link ActorFlag.Committed}, which
 * `ZombieStateStrike` raises at the pick and `ZombieStateBackOff` drops, and
 * {@link ZOMBIE_SPRINTS}, the spawn record's sprint bit that
 * `ZombieStateAttackRun` picks its run row by, and which `ZombieOnShot` and
 * `ZombieRetireThrowConditionIfUnarmed` raise at run time. So a zombie in
 * its strike, and any sprinter -- nearly half the shipped class-0x30 spawns
 * set the bit -- is shoved and shoves 1.8x as hard. The mask is `[proved]`;
 * that the same bit means "sprints" is its other readers' fact, not this
 * routine's.
 *
 * Neither is the airborne bit {@link ActorFlag.Airborne} (`0x20000`), which
 * this routine reads only to skip the ground snap.
 */
function PushBoostBits(): number {
  return ActorFlag.Committed | ZOMBIE_SPRINTS;
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
export function ActorSnapToGroundHeight(obj: ZombieActor): void {
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
 * Both halves are here: the actor-versus-actor push, which is what stops a
 * crowd occupying one point, and the world push, which is what stops an actor
 * walking through a wall. `[proved]`, whole, from the listing
 * (`0x00454900`..`0x00454ABC`):
 *
 * * the shove bit `obj+0x136C & 0x800000` is cleared, and the sphere rebuilt;
 * * **only with {@link ZombieFlag2.CollideActors}**: first the push another
 *   actor recorded on this one since its last update (`obj+0x138..0x148`),
 *   a tenth of its depth along its normal **on all three axes**, 1.8x when
 *   the *pusher's* flags carry {@link PushBoostBits}; then this actor's own
 *   test, `ColiTestSphereAgainstActors` at `obj+0x12C` with radius
 *   `obj+0x128`, a tenth of `g_coli_hit_depth` 1.8x when *its own* flags
 *   carry them, in **x and z only** and along the normal as the test left it
 *   -- not renormalised, so a neighbour above or below pushes less;
 * * **only with {@link ZombieFlag2.CollideWorld}**: the whole depth out of
 *   the full collision set on all three axes;
 * * the ground snap, unless {@link ActorFlag.Airborne};
 * * and the shove timer: one decrement per call, and when it goes negative
 *   on a frame either push raised the bit, sixty frames more and
 *   {@link ZombieFlag2.BackOffTurnFlip} toggled.
 *
 * Every state runs it -- there is no state test anywhere in the routine, and
 * the draw that calls it runs on every path through `EnemyZombieUpdate` --
 * so the states that stop a zombie being pushed do it by dropping the two
 * bits (`death.ts`, `emerge.ts`, `entrance.ts`, a fade), not by a gate here.
 */
export function ZombiePushOutOfWorldAndActors(obj: ZombieActor): void {
  const boost = PushBoostBits();
  obj.flags2 &= ~ZombieFlag2.Shoved;
  ActorUpdateBoundingSphere(obj);

  // The actor-versus-actor half. It is **mutual and deferred**: an actor
  // pushes itself out by a tenth of the penetration and *records* the opposite
  // push on whoever it found, who applies it on its own next update. So the
  // separation costs one test per actor, not one per pair.
  if (obj.flags2 & ZombieFlag2.CollideActors) {
    if (obj.pushedBy >= 0) {
      // `MOV ECX, [EAX + 0x34]` at `00454935`: the pusher's flags as they are
      // now, read through the pointer the push was recorded with.
      const by = ActorByAt(obj.pushedBy);
      let f = obj.pushDepth * PUSH_FRACTION;
      if (by && (by.flags & boost)) f *= PUSH_BOOST;
      obj.pos.x += obj.pushNormal.x * f;
      obj.pos.y += obj.pushNormal.y * f;
      obj.pos.z += obj.pushNormal.z * f;
      ActorUpdateBoundingSphere(obj);
      obj.pushedBy = -1;
    }
    if (ColiTestSphereAgainstActors(obj, obj.sphereCentre.x, obj.sphereCentre.y,
                                    obj.sphereCentre.z, obj.bodyRadius)) {
      let f = G.g_coli_hit_depth * PUSH_FRACTION;
      if (obj.flags & boost) f *= PUSH_BOOST;
      // x and z only: `0x009CAC64` and `0x009CAC6C` are loaded and
      // `0x009CAC68` is not. An actor is never pushed up out of another.
      obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * f;
      obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * f;
      obj.flags2 |= ZombieFlag2.Shoved;
      ActorUpdateBoundingSphere(obj);
    }
  }

  // `worldPushDepth` is the port's own, a port-only field whose divergence is
  // declared on `Actor.worldPushDepth`; this and class 0x31's
  // `ThrowerPushOutOfWorld` are its only writers. It must be cleared whether
  // or not the actor takes part in the world push, or an actor that stops
  // colliding stays flagged as wedged for ever.
  obj.worldPushDepth = 0;
  if (obj.flags2 & ZombieFlag2.CollideWorld) {
    if (ColiTestSphereAgainstFullSet(obj.sphereCentre.x, obj.sphereCentre.y,
                                     obj.sphereCentre.z, obj.bodyRadius)) {
      const d = G.g_coli_hit_depth;
      obj.worldPushDepth = d;
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

  // `DEC EAX` / `JNS` at `00454A90`: one tick of the timer per call. It used
  // to take the frame count the director was stepped by, which is one on
  // every frame the port runs and is not a thing this routine reads.
  obj.zom.shoveTimer -= 1;
  if (obj.zom.shoveTimer < 0 && (obj.flags2 & ZombieFlag2.Shoved)) {
    obj.zom.shoveTimer = SHOVE_PERIOD;
    // Which way `ZombieStateBackOff` turns, flipped so a wedged actor does not
    // keep retreating into the same corner.
    obj.flags2 ^= ZombieFlag2.BackOffTurnFlip;
  }
}
