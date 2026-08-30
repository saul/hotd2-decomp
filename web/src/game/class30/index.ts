/**
 * `EnemyZombieUpdate` — `FUN_004533F0`. Class 0x30's per-frame dispatch.
 *
 * The engine's own order, which matters: the state runs, *then* the position
 * integrates, then the motion advances. Anything not ported goes through
 * `ActorAbortAttackAndLeave` rather than a fallthrough, so no unmodelled state
 * can sit on a permit.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import type { Vec3 } from "../vec";
import { ZombieStateApproach } from "./approach";
import { ZombieStateAttackRun } from "./attack_run";
import { ZombieStateBackOff } from "./backoff";
import { ZombieStateHoldAtRange } from "./hold";
import { ActorAbortAttackAndLeave } from "./leave";
import { ZombieStateStrike } from "./strike";
import { ZombieState } from "./states";

export function EnemyZombieUpdate(obj: Actor, eye: Vec3, dt: number, rng: Rng,
                                  events?: Events): void {
  switch (obj.state) {
    case ZombieState.Approach:    return ZombieStateApproach(obj, eye);
    case ZombieState.AttackRun:   return ZombieStateAttackRun(obj, eye, dt);
    case ZombieState.HoldAtRange: return ZombieStateHoldAtRange(obj, eye);
    case ZombieState.Strike:      return ZombieStateStrike(obj, eye, rng, events);
    case ZombieState.BackOff:     return ZombieStateBackOff(obj, eye, dt);
    default:                      return ActorAbortAttackAndLeave(obj);
  }
}

/**
 * `EnemyZombieInit` — `FUN_00452DA0`.
 *
 * The start state is the descriptor's own byte +2, not a constant: in stage 2
 * the commonest is 1 (`AttackRun`), then 15 (`WalkDistance`), 27, 18 — and
 * **none** of the 90 class-0x30 spawns starts in `Approach`. The old port
 * started everything there, which is why nothing ever reached the hub.
 */
export function EnemyZombieInit(obj: Actor): void {
  obj.attackPermit = -1;
  obj.rank = 0xff;                    // `obj+0x131D = 0xFF`
  obj.sub = 0;
  obj.backoffFrames = 0;
  obj.cooldown = 0;
  obj.hasStrikeAnchor = false;
  obj.struck = false;
  obj.state = ZombieEntryState(obj.initialState);
}

/**
 * Which state to actually start in.
 *
 * [diverges] Only five of the 54 are ported. Every entrance state that *is*
 * read ends by setting state 1 — `ZombieStateWalkDistance` walks its distance
 * and sets 1, the burst-out entrance plays its clip and sets 1 — so an
 * unported entrance resolves to `AttackRun` rather than being left to abort.
 * Between them states 15 and 27 alone are 37 of stage 2's 90 zombies.
 */
export function ZombieEntryState(initial: number): ZombieState {
  switch (initial) {
    case ZombieState.Approach:
    case ZombieState.AttackRun:
    case ZombieState.HoldAtRange:
      return initial;
    default:
      return ZombieState.AttackRun;
  }
}
