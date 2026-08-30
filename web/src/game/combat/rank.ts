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
 * `DAT_005A4D50 < 0xE` — the registration list holds fourteen. A fifteenth
 * enemy is simply not ranked, and an unranked actor's `-1` passes every test.
 */
export const RANK_SLOTS = 14;

/**
 * `RegisterForDistanceRank` — `FUN_00409010`. Who is in the queue at all.
 *
 * The engine gates on `obj+0x34 & 1` and `!(obj+0x34 & 0x4000000)`; neither
 * bit is modelled, so this stands in with "alive, drawn, and of a class whose
 * update registers" — which is class 0x30 and nothing else so far.
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
 * queue to `obj+0x131D`.
 */
export function RankEnemiesByDistance(eye: Vec3): void {
  // Only what registered. `RegisterForDistanceRank` is called from
  // `EnemyZombieUpdate` and **not** from `EnemyThrowerUpdate`, so a thrower
  // 200 units up a wall takes no place in the queue -- nor does the cat, nor
  // anything else without a handler that registers.
  const live = G.g_object_list.filter(RegisterForDistanceRank);
  const sorted = SortEnemiesByDistance(live, eye).slice(0, RANK_SLOTS);

  // Pass one: the raw distance rank, and everyone marked as outside the
  // compacted queue.
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rank = i;
    sorted[i].queueRank = RANK_SLOTS;
  }
  // Pass two: drop the actors that are backing off and number the rest. A
  // zombie queued behind one that has just swung moves up the moment that one
  // turns to retreat, which is what keeps the queue flowing.
  let n = 0;
  for (const o of sorted) {
    if ((o.flags & ActorFlag.BackingOff) !== 0) continue;
    o.queueRank = n++;
  }

  // Anything the pass did not touch keeps -1, which is what
  // `EnemyZombieInit` writes and what every `(s8)` test reads as "nearest".
  const ranked = new Set(sorted);
  for (const o of G.g_object_list) {
    if (ranked.has(o)) continue;
    o.rank = -1;
    o.queueRank = 0;
  }
}
