/**
 * The distance queue.
 *
 * Once a frame every live enemy is sorted by distance to the camera and told
 * its place. `ZombieStateApproach` tests that place against the ring table's
 * allowance, so the queue is a **crowd throttle**: far from the camera a
 * deeper slice of it may come at you, close in only the nearest couple.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { dist3d, type Vec3 } from "../vec";

/** `obj+0x131E < 3` — only the nearest three may press an attack at all. */
export const QUEUE_CAP = 3;

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
  const live = G.g_object_list.filter((o) => !o.dead && o.visible);
  const sorted = SortEnemiesByDistance(live, eye);
  for (let i = 0; i < sorted.length; i++) sorted[i].rank = i;
  // An actor the ranking pass did not see keeps -1, which is what
  // `EnemyZombieInit` writes and what every `(s8)` test reads as "nearest".
  for (const o of G.g_object_list) {
    if (o.dead || !o.visible) o.rank = -1;
  }
}
