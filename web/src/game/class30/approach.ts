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
import { ActorFlag, type ZombieActor } from "../actor";
import { TryClaimAttackSlot } from "../combat/permits";
import { MotionRowOf } from "../tables";
import type { GameHost } from "../host";
import type { Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { TestApproachRing } from "./ring";
import { MotionFade, QUEUE_CAP, ZombieWaitMotion } from "./states";

export function ZombieStateApproach(obj: ZombieActor, eye: Vec3, rng: Rng,
                                    host: GameHost): void {
  if (obj.sub === 0) {
    // The same band test `TestApproachRing` does, inlined here in the exe.
    TestApproachRing(obj, eye);
    obj.flags |= ActorFlag.NoCameraTrack;
    obj.sub = 1;
    return;
  }

  // `row[(obj+0x136C >> 0x15) & 1]` -- the two walk variants. Bit 0x200000 is
  // set by `ZombieStateAttackRun` from `g_wait_turn_variant` when an actor
  // drops out of the queue; an actor that starts here has not been through
  // there, so this is `row[0]` unless something else raised the bit.
  ZombieSetMotionIfIdle(obj, ZombieWaitMotion(obj, MotionRowOf(obj)),
                        rng, "clip", MotionFade.Quick);

  if (obj.rank < obj.allowance && obj.queueRank < QUEUE_CAP
      && TryClaimAttackSlot(obj, rng, host)) {
    // `obj+0x34 &= 0xfffeffff` at `0x00457A4E` -- this state's own clear, the
    // claim writes no `obj+0x34`. The rank tests stay out here too (`L11`).
    obj.flags &= ~ActorFlag.NoCameraTrack;
    obj.state = obj.attackState;
    obj.sub = 0;
  }
}
