/**
 * `EnemyZombieUpdate` — `FUN_004533F0`. Class 0x30's per-frame dispatch.
 *
 * The actor turns toward the camera every frame regardless of state, then the
 * state runs. Anything not ported goes through `ActorAbortAttackAndLeave`
 * rather than a fallthrough, so no unmodelled state can sit on a permit.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { TurnActorTowardCamera } from "../actor_turn";
import type { Vec3 } from "../vec";
import { ZombieStateApproach } from "./approach";
import { ZombieStateAttackRun } from "./attack_run";
import { ZombieStateBackOff } from "./backoff";
import { ActorAbortAttackAndLeave } from "./leave";
import { ZombieStateStrike } from "./strike";
import { ZombieState } from "./states";

export function EnemyZombieUpdate(obj: Actor, eye: Vec3, dt: number, rng: Rng,
                                  events?: Events): void {
  TurnActorTowardCamera(obj, eye, dt);

  switch (obj.state) {
    case ZombieState.Approach:   return ZombieStateApproach(obj, eye, dt);
    case ZombieState.AttackRun: return ZombieStateAttackRun(obj, eye, dt);
    case ZombieState.Strike:     return ZombieStateStrike(obj, eye, dt, rng, events);
    case ZombieState.BackOff:    return ZombieStateBackOff(obj, eye, dt);
    default:               return ActorAbortAttackAndLeave(obj);
  }
}

/** `EnemyZombieInit` — `FUN_00452DA0`. Where a fresh class-0x30 actor starts. */
export function EnemyZombieInit(obj: Actor): void {
  obj.state = ZombieState.Approach;
  obj.sub = 0;
  obj.attackPermit = -1;
  obj.rank = 99;
  obj.backoffFrames = 0;
}
