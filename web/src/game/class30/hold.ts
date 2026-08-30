/**
 * `ZombieStateHoldAtRange` — `FUN_00455720`. **The hub of the attack loop.**
 *
 * An earlier revision of this port did not have this state at all — it went
 * approach, then straight to a "strike" it had numbered 2, which is this
 * state's index. The result was zombies that walked up and stood there. Three
 * things live here and nowhere else:
 *
 * * **the spacing.** Inside `inner - 1` the actor is too close and is sent to
 *   `ZombieStateBackOff`. That is the only thing keeping a crowd off the
 *   camera, and it runs every frame, not just after a swing.
 * * **the decision to swing.** The permit is claimed *here*, gated on the
 *   distance queue and the cooldown — and **not** on the descriptor's
 *   `attack_state`. That byte is only read by `ZombieStateApproach`. Gating
 *   this on it, as the old port did, is why the 32 stage-2 zombies whose
 *   descriptor says `attack_state = -1` or `0` never attacked: in the game
 *   they attack perfectly well.
 * * **the cooldown.** `obj+0x133C` is forced to zero unless `obj+0x1368` bit 0
 *   is set, so an ordinary zombie has no wait between swings beyond the
 *   retreat itself.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { TurnActorTowardCameraEye } from "../actor_turn";
import { TryClaimAttackSlot } from "../combat/permits";
import { CharacterTypeOf, FirstBakedOf, MotionRowOf } from "../tables";
import type { GameHost } from "../host";
import { dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius, TestApproachRing } from "./ring";
import { MotionFade, MotionRow, QUEUE_CAP, ZombieState } from "./states";

/** `FUN_00409E80`'s turn rate here is a literal 0x40 BAMS. */
const HOLD_TURN_RATE = 0x40;

export function ZombieStateHoldAtRange(obj: Actor, eye: Vec3, rng: Rng,
                                       host: GameHost): void {
  // Called for its side effect: it refreshes `obj+0x1358`, the queue depth
  // this actor is allowed to sit at.
  TestApproachRing(obj, eye);

  const charType = CharacterTypeOf(obj)?.type ?? -1;
  const tooClose = charType !== 0
    && dist2d(obj.pos, eye) < ApproachInnerRadius(obj) - 1.0;
  if (tooClose) {
    obj.state = ZombieState.BackOff;
    obj.sub = 0;
    return;
  }

  // No cooldown for an ordinary zombie: the bit that would run one down is
  // never set on the ported path.
  obj.cooldown = 0;

  if (obj.rank < obj.allowance && obj.queueRank < QUEUE_CAP && obj.cooldown < 1
      && TryClaimAttackSlot(obj, host)) {
    // Body condition 4 goes to state 0x34 instead; that state is unread, and
    // no stage-2 spawn carries condition 4 into this state.
    obj.state = ZombieState.Strike;
    obj.sub = 0;
    return;
  }

  // Waiting its turn: the idle from the motion row, and a slow turn to keep
  // facing you.
  ZombieSetMotionIfIdle(obj,
    FirstBakedOf(obj, MotionRowOf(obj), MotionRow.Walk, MotionRow.WalkAlt),
    rng, 5, MotionFade.Normal);
  TurnActorTowardCameraEye(obj, eye, HOLD_TURN_RATE);
}
