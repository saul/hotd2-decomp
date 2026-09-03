/**
 * Give up an attack and rejoin the queue.
 *
 * [diverges] This is the port's own, not a transcription. `ActorAbortAttackAndLeave`
 * (`FUN_0045D9F0`) was cited here on an assumption and it does not do this —
 * it is three calls that take no actor and assign no state. What this covers
 * is the port's gap: a state index the port has not read, reached because the
 * descriptor named it. The engine has no such case.
 *
 * It routes to `ZombieStateWaitTurn` rather than anywhere terminal, because
 * that state has a way back into the loop, and it releases the permit first:
 * there are only `g_max_attackers` of them and one held by an actor nothing
 * advances blocks every other enemy for good.
 *
 * It used to clear {@link ZombieFlag2.StrikeAnchor} as well. Nothing in the
 * exe clears that bit outside `FUN_0045DA60` and `EnemyZombieInit`'s whole-word
 * assignment, and clearing it here would put the actor back under
 * `ZombieStateHoldAtRange`'s too-close retreat, which is a behaviour the exe
 * only ever gives an actor that has never swung.
 */
import type { Actor } from "../actor";
import { ReleaseAttackSlot } from "../combat/permits";
import { ZombieState } from "./states";

export function ZombieGiveUpAttack(obj: Actor): void {
  obj.action = null;
  ReleaseAttackSlot(obj);
  obj.state = ZombieState.WaitTurn;
  obj.sub = 0;
}
