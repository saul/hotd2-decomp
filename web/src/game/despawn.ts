/**
 * Taking an actor out of the pool, and what it gives back on the way.
 *
 * `ActorDespawn` lives in its own file because both `director.ts` and
 * `class10/` need it and `director.ts` reaches every class module through
 * `game/classes.ts` — the cycle that a shared leaf avoids. The sweep is here
 * with it because it is the same subject seen from the other end: the despawn
 * is what the actor does, the sweep is the port's backstop for the actors that
 * arrive at one by a route the engine does not have.
 */
import type { Actor } from "./actor";
import { ReleaseAttackSlot } from "./combat/permits";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount,
} from "./combat/counts";
import { ActorIsEnemy, DeadSweep, g_class_handlers } from "./registry";

/**
 * `ActorDespawn` — `FUN_00409CC0`. Take an object out of the pool.
 *
 * The engine unlinks it from the list `g_cur_actor` walks and frees it. Here
 * it is a flag, for the same reason `g_object_list` is a list rather than a
 * linked pool: an index is easier to snapshot than a pointer, and the actor
 * has to stay addressable for the one frame the renderer needs to notice.
 */
export function ActorDespawn(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
  obj.action = null;
}

/**
 * The sweep: this actor is dead, undrawn or gone, so give back what it holds.
 *
 * [port-only] There is no such routine in the exe, and there cannot be — see
 * {@link DeadSweep}. What it stands in for is the teardown each class runs
 * from its own death states, which is why it **asks the class** rather than
 * switching on the class id. Two facts the two ported enemy classes disagree
 * about were spelled out here as `obj.cls === SpawnClass.Thrower` tests: which
 * pair of retire routines takes the actor out of the counts, and which bit of
 * which flags word latches an off-screen permit. Both are the class's, and
 * both now live with it.
 *
 * The fallback is for a class with **no module**, and it is the only thing
 * that can honestly be said about one: the generic enemy count releases, which
 * the engine's own despawn paths all run, and no permit release, because a
 * class with no update has never claimed one. Its shape is deliberately not
 * class 0x30's — a default tuned to the one class that also has a hook is the
 * outside guess this exists to stop.
 */
export function ActorDeadSweep(obj: Actor, why: DeadSweep): void {
  const own = g_class_handlers[obj.cls]?.onDeadSweep;
  if (own) {
    own(obj, why);
    return;
  }
  // `ReleaseAttackSlot` is still run on the two reasons the old sweep ran it
  // on, and with its default bit, because that is what it did for every class
  // before the hook existed. For an unported class it can only ever be the
  // `flags |= NoCameraTrack` — there is no permit to give back — and taking
  // that write away was not this item's decision to make.
  if (why !== DeadSweep.Despawned) ReleaseAttackSlot(obj);
  if (why === DeadSweep.Unloaded || !ActorIsEnemy(obj.cls)) return;
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
}
