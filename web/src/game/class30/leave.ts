/**
 * Give up an attack and rejoin the queue.
 *
 * [diverges] This is the port's own, not a transcription. The routine at
 * `0x0045D9F0` was cited here on an assumption, under the name
 * `ActorAbortAttackAndLeave`, and it does not do this. It is
 * `ZombieSplitInTwo` (`FUN_0045D9F0`), which cuts the actor in two; an
 * earlier revision of this note said it "assigns no state", having read its
 * three calls and not their bodies, and its second call
 * (`ZombieSplitUpdateSelf`, `FUN_0045DA60`) writes state 0x32. See
 * `class30/split.ts`. What this covers is the port's gap: a zeroed attack
 * entry the bundle has no row for, which `ZombieStateStrike` and
 * `ZombieStateLeapStrike` hand here -- see `ZombiePickAttack`. The engine has
 * no such case: it dereferences the zeroed entry and swings at nothing.
 *
 * **It no longer covers any state index.** State 10 was reaching this
 * through the dispatch's `default` on the strength of the same wrong
 * citation, and `g_class30_states[10]` is `ZombieReleaseAndDespawn`
 * (`FUN_00455490`), which despawns; state 0, the engine's no-op, reached it
 * the same way. The dispatch has an arm for every entry of the table now and
 * no `default` at all; see `class30/index.ts`.
 *
 * It routes to `ZombieStateWaitTurn` rather than anywhere terminal, because
 * that state has a way back into the loop, and it releases the permit first:
 * there are only `g_max_attackers` of them and one held by an actor nothing
 * advances blocks every other enemy for good.
 *
 * It used to clear {@link ZombieFlag2.StrikeAnchor} as well. Nothing in the
 * exe clears that bit outside `ZombieSplitUpdateSelf` and `EnemyZombieInit`'s whole-word
 * assignment, and clearing it here would put the actor back under
 * `ZombieStateHoldAtRange`'s too-close retreat, which is a behaviour the exe
 * only ever gives an actor that has never swung.
 *
 * It leaves `ActorFlag.Committed` up, as `ZombieStateStrike`'s sub 0
 * raised it before the draw that sent the actor here. That matches what a
 * shot would find in the engine, whose actor on a zeroed entry goes on
 * lunging toward a distance of 0.0 in state 3 -- still holding the bit, so
 * still no stumble. The next strike raises it again and its retreat takes it
 * down.
 */
import type { ZombieActor } from "../actor";
import { ReleaseAttackSlot } from "../combat/permits";
import { ZombieState } from "./states";

export function ZombieGiveUpAttack(obj: ZombieActor): void {
  obj.action = null;
  ReleaseAttackSlot(obj);
  obj.state = ZombieState.WaitTurn;
  obj.sub = 0;
}
