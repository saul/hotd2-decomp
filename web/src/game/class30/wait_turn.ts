/**
 * `ZombieStateWaitTurn` — `FUN_00455670`, class 0x30 state 5.
 *
 * The way back into the attack loop, and leaving it out is what left zombies
 * standing still: `ZombieStateAttackRun` sends an actor here the moment it
 * falls out of the slice of the distance queue that is allowed to come at you,
 * and this is what sends it back when the queue moves on. Without it the
 * throttle is a one-way exit.
 *
 * It plays the **in-place** walk — `row[0]`/`row[1]`, the clips that carry no
 * root motion — so an actor waiting its turn marks time on the spot rather
 * than closing. That is the shape of a crowd in this game.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { TurnActorTowardCameraEye } from "../actor_turn";
import { FirstBakedOf, MotionRowOf } from "../tables";
import type { Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { MotionFade, MotionRow, ZombieState } from "./states";

/** `FUN_00409E80`'s rate here is the same literal 0x40 the hold uses. */
const WAIT_TURN_RATE = 0x40;

export function ZombieStateWaitTurn(obj: Actor, eye: Vec3, rng: Rng): void {
  if (obj.sub === 0) obj.sub = 1;

  ZombieSetMotionIfIdle(obj,
    FirstBakedOf(obj, MotionRowOf(obj), MotionRow.Walk, MotionRow.WalkAlt),
    rng, 5, MotionFade.Normal);
  TurnActorTowardCameraEye(obj, eye, WAIT_TURN_RATE);

  // `(s8)obj+0x131D < obj+0x1358` -- back in the allowed slice, so go again.
  if (obj.rank < obj.allowance) {
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
  }
}
