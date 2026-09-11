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
import { ActorReleaseHitSlot } from "./hit_slots";
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
  // Three lines of the engine's own `ActorDespawn`, at `0x00409CEA`: the
  // `g_hit_slots` entry goes back before `ActorKill`. See `game/hit_slots.ts`.
  ActorReleaseHitSlot(obj);
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
  // before the hook existed.
  //
  // **It gets no untrack and no guard, and that is a decision, not an
  // oversight.** D1 moved the `NoCameraTrack` raise out of `ReleaseAttackSlot`
  // and into the callers, where the engine has it — and every one of those
  // callers is a *named exe routine belonging to a class*, which is exactly
  // what this fallback does not have. `ZombieReleasePermitAndUntrack`
  // (`FUN_004565A0`) reads `g_enemies_alive` and `ThrowerReleaseSlotOnDeath`
  // (`FUN_0044D050`) reads `g_enemies_present`; there is no third answer to
  // copy for a class nobody has read, and picking one of the two would be the
  // outside guess this fallback exists to avoid. Nothing is lost by it:
  // `RegisterForCameraTracking` (`FUN_00408EC0`) already refuses a `dead` or
  // invisible actor, which is every actor that reaches this line.
  //
  // The call itself is kept rather than deleted. For a class with no module it
  // is a provable no-op today — nothing but a class handler ever claims a
  // permit, so `attackPermit` is -1 and the off-screen bit is clear — but it
  // is also the one piece of teardown that would matter the moment such a
  // class gained a claim, and `g_attack_committed` left up stalls every enemy
  // in the scene rather than just this one.
  if (why !== DeadSweep.Despawned) ReleaseAttackSlot(obj);
  if (why === DeadSweep.Unloaded || !ActorIsEnemy(obj.cls)) return;
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
}
