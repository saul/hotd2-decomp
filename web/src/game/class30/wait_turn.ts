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
 * than closing. That is the shape of a crowd in this game. `[proved]`, the
 * whole routine:
 *
 * ```
 * 00455699  motion = row[(obj+0x136C >> 0x15) & 1]
 * 004556b1  sub 0 -> 1, falling through; any other sub but 1 returns
 * 004556b9  if (obj+0x1B4 != motion) ActorSetMotionBlended(motion, rand() % 5, 10)
 * 004556e4  TurnActorTowardCameraEye(obj, 0x40)
 * 004556f9  if ((s8)obj+0x131D < obj+0x1358) state 1, sub 0
 * ```
 *
 * Which of the pair is `ZombieStateAttackRun`'s doing: it ORs a draw from
 * `g_wait_turn_variant` into bit 21 on the frame it sends the actor here. The
 * port took the first baked of the two instead, which is always `row[0]`, and
 * so never played the clip seven of the table's ten entries ask for.
 */
import type { Rng } from "../../core/rng";
import type { ZombieActor } from "../actor";
import { TurnActorTowardCameraEye } from "../actor_turn";
import { MotionRowOf } from "../tables";
import { ActorSetMotionBlended } from "./motion_cue";
import { MotionFade, ZombieState, ZombieWaitMotion } from "./states";

/** `PUSH 0x40` at `0x004556E1`: `TurnActorTowardCameraEye`'s rate here. */
const WAIT_TURN_RATE = 0x40;
/** `rand() % 5` at `0x004556C9`: the spread of the wait clip's first frame. */
const WAIT_START_SPREAD = 5;

export function ZombieStateWaitTurn(obj: ZombieActor, rng: Rng): void {
  const motion = ZombieWaitMotion(obj, MotionRowOf(obj));
  if (obj.sub === 0) obj.sub = 1;
  else if (obj.sub !== 1) return;

  // The engine's own setter, behind its own test: `ActorSetMotionBlended`
  // (`FUN_004119A0`) at `004556d9`, not `ZombieSetMotionIfIdle`.
  if (motion !== undefined && obj.motion !== motion) {
    ActorSetMotionBlended(obj, motion, rng.int(WAIT_START_SPREAD),
                          MotionFade.Normal);
  }
  TurnActorTowardCameraEye(obj, WAIT_TURN_RATE);

  // `(s8)obj+0x131D < obj+0x1358` -- back in the allowed slice, so go again.
  if (obj.rank < obj.allowance) {
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
  }
}
