/**
 * `ZombieStateApproach` — `FUN_004579A0`.
 *
 * The *second* way into the attack loop, and the rarer one: it claims a permit
 * up front and routes to the descriptor's own attack state. No spawn in stage
 * 2 starts here — the ordinary path is an entrance state into `AttackRun` and
 * then `HoldAtRange`, which claims for itself.
 *
 * It plays the in-place walk and **does not move**: the clip it selects,
 * `row[0]` or `row[1]`, carries no root translation. See `game/root_motion.ts`.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { TryClaimAttackSlot } from "../combat/permits";
import { FirstBakedOf, MotionRowOf } from "../tables";
import type { Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { TestApproachRing } from "./ring";
import { MotionRow, QUEUE_CAP } from "./states";

export function ZombieStateApproach(obj: Actor, eye: Vec3, rng: Rng): void {
  if (obj.sub === 0) {
    // The same band test `TestApproachRing` does, inlined here in the exe.
    TestApproachRing(obj, eye);
    obj.flags |= ActorFlag.NoCameraTrack;
    obj.sub = 1;
    return;
  }

  // `row[(obj+0x136C >> 0x15) & 1]` -- the two walk variants. Bit 0x200000 is
  // set by `ZombieStateAttackRun` from a random table when an actor drops out
  // of the queue, and it is not otherwise read here, so the port takes row 0.
  ZombieSetMotionIfIdle(obj,
    FirstBakedOf(obj, MotionRowOf(obj), MotionRow.Walk, MotionRow.WalkAlt),
    rng, "clip");

  if (obj.rank < obj.allowance && obj.queueRank < QUEUE_CAP
      && TryClaimAttackSlot(obj)) {
    obj.flags &= ~ActorFlag.NoCameraTrack;
    obj.state = obj.attackState;
    obj.sub = 0;
  }
}
