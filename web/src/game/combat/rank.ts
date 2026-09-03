/**
 * The distance queue.
 *
 * Once a frame every live enemy is sorted by distance to the camera and told
 * its place. `ZombieStateApproach` tests that place against the ring table's
 * allowance, so the queue is a **crowd throttle**: far from the camera a
 * deeper slice of it may come at you, close in only the nearest couple.
 */
import { ActorFlag, type Actor } from "../actor";
import { SpawnClass } from "../spawn_class";
import { G } from "../globals";
import { dist3d, type Vec3 } from "../vec";

/** `obj+0x131E < 3` — only the nearest three may press an attack at all. */
export const QUEUE_CAP = 3;

/**
 * `DAT_005A4D50 < 0xE` — the registration list holds fourteen, and `0xE` is
 * also what pass one writes into `obj+0x131E` before the compaction pass
 * renumbers it. One constant, both jobs, because the engine uses one number.
 *
 * A fifteenth enemy is never ranked. It keeps the pair `ActorSpawn` wrote —
 * `rank = -1`, which reads as "nearest" and passes the ring allowance, and
 * `queueRank = 0xE`, which fails `< QUEUE_CAP`. That asymmetry is the whole
 * crowd throttle: an unranked actor may walk in but may not swing.
 */
export const RANK_SLOTS = 14;

/**
 * `RegisterForDistanceRank` — `FUN_00409010`. Who is in the queue at all.
 *
 * The engine gates on `obj+0x34 & 1` and `!(obj+0x34 & 0x4000000)`; the
 * second bit is `ActorFlag.Dead`, the first is unmodelled, so this stands in
 * with "alive, drawn, and of a class whose update registers" — which is class
 * 0x30 and nothing else so far.
 *
 * The engine also refuses once the list is full, which is why the caller
 * applies `RANK_SLOTS` **before** the sort and not after.
 */
export function RegisterForDistanceRank(obj: Actor): boolean {
  return !obj.dead && obj.visible && obj.cls === SpawnClass.Zombie;
}

/**
 * `SortEnemiesByDistance` — `FUN_00409190`. Ascending, nearest first.
 *
 * The engine radix-sorts on `|actor - eye| * 10` rounded to an int; the scale
 * is the exported `distance_scale`. Sorting on the float is the same order
 * except for ties inside a tenth of a unit, and the tie-break is the list
 * order in both.
 */
export function SortEnemiesByDistance(list: Actor[], eye: Vec3): Actor[] {
  return list.slice().sort((p, q) => dist3d(p.pos, eye) - dist3d(q.pos, eye));
}

/**
 * `RankEnemiesByDistance` — `FUN_004090B0`. Write each actor's place in that
 * queue to `obj+0x131D` and `obj+0x131E`.
 *
 * Three passes, and the engine touches **only what registered** in all three.
 * There is no fourth pass putting anyone back to a default: an actor that
 * drops out of the registration set keeps the last rank it was given, and one
 * that never enters it keeps what `ActorSpawn` wrote. The port used to end
 * with a sweep of `G.g_object_list` writing `rank = -1, queueRank = 0` onto
 * everything unranked, which is invented twice over — it scribbles class-0x30
 * offsets onto every other class, and `queueRank = 0` is the *front* of the
 * queue, so every enemy past the fourteenth passed the `< QUEUE_CAP` cap the
 * pass exists to enforce.
 *
 * One side effect is **not** ported. Pass one also sets `DAT_009C7310` when a
 * registered actor of type `0xB` is inside its own allowance and carries
 * `obj+0x136C & 0x2000000`; the only reader is the recursive bone-hierarchy
 * draw at `0x004114C0`, which uses it to pick which bone of the player model
 * a point is taken from. `[open]` — what that point is has not been read, and
 * the port has no bone hierarchy for the player to hang it on. Nothing in the
 * ported call graph reads the flag, so leaving it out costs nothing; naming it
 * from the one site that reads it would be a guess.
 */
export function RankEnemiesByDistance(eye: Vec3): void {
  // `RegisterForDistanceRank` is called from `EnemyZombieUpdate` and **not**
  // from `EnemyThrowerUpdate`, so a thrower 200 units up a wall takes no place
  // in the queue -- nor does the cat, nor anything else without a handler that
  // registers.
  //
  // The cap is applied here, in object-update order, because that is where the
  // engine applies it: `FUN_00409010` refuses the fifteenth caller and
  // `FUN_00409190` then sorts what got in. Sorting first and taking the
  // nearest fourteen is a different set whenever more than fourteen are alive.
  const registered: Actor[] = [];
  for (const o of G.g_object_list) {
    if (registered.length >= RANK_SLOTS) break;
    if (RegisterForDistanceRank(o)) registered.push(o);
  }
  const sorted = SortEnemiesByDistance(registered, eye);

  // Pass one: the raw distance rank, and everyone marked as outside the
  // compacted queue.
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rank = i;
    sorted[i].queueRank = RANK_SLOTS;
  }
  // Pass two and three: drop the actors that are backing off and number the
  // rest. A zombie queued behind one that has just swung moves up the moment
  // that one turns to retreat, which is what keeps the queue flowing.
  let n = 0;
  for (const o of sorted) {
    if ((o.flags & ActorFlag.BackingOff) !== 0) continue;
    o.queueRank = n++;
  }
}
