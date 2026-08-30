/**
 * `ZombieStateAttackRun` — `FUN_004554D0`.
 *
 * Play the run clip and close on the camera until `TestApproachRing` returns
 * band 1, then hand to `ZombieStateHoldAtRange` — **not** to the strike. The
 * closing is the clip's own root motion: `row[2]`/`row[3]` carry 1.289 units
 * per frame where the walk carries nothing.
 *
 * This is where every entrance state ends up. `ZombieStateWalkDistance` (15)
 * walks a set distance and sets state 1; the burst-out entrance (27) plays its
 * clip and sets state 1. Between them that is 37 of stage 2's 90 zombies.
 */
import type { Actor } from "../actor";
import { TurnActorTowardCamera } from "../actor_turn";
import { MotionRowOf } from "../tables";
import type { Vec3 } from "../vec";
import { ActorAbortAttackAndLeave } from "./leave";
import { ActorSetMotionIfIdle } from "./motion_cue";
import { TestApproachRing } from "./ring";
import { MotionRow, ZombieState } from "./states";

export function ZombieStateAttackRun(obj: Actor, eye: Vec3, dt: number): void {
  const row = MotionRowOf(obj);
  // `row[2 + ((obj+0x34 >> 0x1B) & 1)]`. Bit 0x8000000 is the variant select
  // and nothing in the ported path sets it, so this takes the first.
  ActorSetMotionIfIdle(obj, row[MotionRow.Run] ?? row[MotionRow.RunAlt]);

  if (TestApproachRing(obj, eye) === 1) {
    obj.state = ZombieState.HoldAtRange;
    obj.sub = 0;
    return;
  }

  TurnActorTowardCamera(obj, eye, dt);

  // "I have fallen out of the slice of the queue that may come at you." The
  // engine goes to state 5 with a random flag from `DAT_00566124`; that state
  // is unread, and holding a permit in it would block everyone, so the port
  // takes the release that state 5 would eventually reach.
  if (obj.allowance <= obj.rank) ActorAbortAttackAndLeave(obj);
}
