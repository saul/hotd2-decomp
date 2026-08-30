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
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { TurnActorTowardCamera } from "../actor_turn";
import { FirstBakedOf, MotionRowOf } from "../tables";
import type { Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { TestApproachRing } from "./ring";
import { MotionFade, MotionRow, ZombieState } from "./states";

export function ZombieStateAttackRun(obj: Actor, eye: Vec3, dt: number,
                                    rng: Rng): void {
  const row = MotionRowOf(obj);
  // `row[2 + ((obj+0x34 >> 0x1B) & 1)]`, taking whichever variant this bundle
  // actually carries -- and falling back to the walk for a skeleton that has
  // no run clip of its own, which is `znchain` and the two `znebi`.
  ZombieSetMotionIfIdle(obj, FirstBakedOf(obj, row, MotionRow.Run,
                                          MotionRow.RunAlt, MotionRow.Walk,
                                          MotionRow.WalkAlt), rng, "clip",
                             MotionFade.Normal);

  if (TestApproachRing(obj, eye) === 1) {
    obj.state = ZombieState.HoldAtRange;
    obj.sub = 0;
    return;
  }

  TurnActorTowardCamera(obj, eye, dt);

  // "I have fallen out of the slice of the queue that may come at you."
  // `ZombieStateWaitTurn` marks time on the spot and sends the actor back here
  // when the queue moves on. Routing this anywhere without a way back is what
  // left every zombie standing in `HoldAtRange` for ever.
  if (obj.allowance <= obj.rank) {
    obj.state = ZombieState.WaitTurn;
    obj.sub = 0;
  }
}
