/**
 * The distance queue.
 *
 * Every frame each zombie files its distance from the camera, and the next
 * frame's rank sorts the file and tells each its place. `ZombieStateApproach`
 * tests that place against the ring table's allowance, so the queue is a
 * **crowd throttle**: far from the camera a deeper slice of it may come at
 * you, close in only the nearest couple.
 */
import { ActorFlag, type Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import { CAMERA_TRACK_DISTANCE_SCALE } from "../camera/constants";

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
 * `RegisterForDistanceRank` — `FUN_00409010`. File the actor for the next
 * rank, keyed on its distance from the gameplay eye **across the floor**:
 *
 * ```c
 * if ((obj+0x34 & 1) && !(obj+0x34 & 0x4000000) && g_distance_rank_count < 0xE) {
 *     dx = obj+0x40 - g_camera_eye.x;  dz = obj+0x48 - g_camera_eye.z;
 *     g_distance_rank_list[count] = { ftol(sqrt(dx*dx + dz*dz) * 10.0), obj };
 *     g_distance_rank_count++;
 * }
 * ```
 *
 * `[proved]` (`0x00409010`..`0x00409073`; the scale is
 * `g_camera_track_key_scale`, `0x004C43A4`). Its one caller is
 * `EnemyZombieUpdate` (`0x0045346D`), after the draw and unless `obj+0x136C`
 * carries `0x8000000`, and class 0x18's update runs that routine inside the
 * carrier's matrix -- so a rider files its carrier-relative `obj+0x40`,
 * exactly as the engine's does.
 *
 * `obj+0x34` bit 1 is unmodelled; `visible` stands in for it, as it does
 * wherever the port tests the bit. Bit `0x4000000` is `dead`.
 */
export function RegisterForDistanceRank(obj: Actor): void {
  if (obj.dead || !obj.visible) return;
  if (G.g_distance_rank_list.length >= RANK_SLOTS) return;
  const e = G.g_camera_eye;
  const dx = obj.pos.x - e.x;
  const dz = obj.pos.z - e.z;
  G.g_distance_rank_list.push({
    key: Math.trunc(Math.sqrt(dx * dx + dz * dz) * CAMERA_TRACK_DISTANCE_SCALE),
    at: obj.at,
  });
}

/**
 * `SortEnemiesByDistance` — `FUN_00409190`. An LSD radix sort, two 8-bit
 * passes, over the low sixteen bits of each key: stable and ascending, so two
 * actors on one key keep the order they registered in, and a key at or past
 * 65536 -- 6.5 km -- wraps, exactly as the engine's does. `[proved]`
 */
export function SortEnemiesByDistance(): void {
  const c = G.g_distance_rank_list;
  for (let shift = 0; shift < 16; shift += 8) {
    const buckets: { key: number; at: number }[][] =
      Array.from({ length: 256 }, () => []);
    for (const e of c) buckets[(e.key >>> shift) & 0xff].push(e);
    let i = 0;
    for (const b of buckets) for (const e of b) c[i++] = e;
  }
}

/** Whether a filed actor is still live at the rank: `obj+0x34 & 1`. */
function RankLive(obj: Actor | undefined): obj is Actor {
  return obj !== undefined && !obj.despawned && obj.visible;
}

/**
 * `RankEnemiesByDistance` — `FUN_004090B0`, the scene list's thirteenth task.
 * The actors filed **last** frame, sorted, and each told its place in
 * `obj+0x131D` and `obj+0x131E`; then the list is emptied.
 *
 * ```c
 * SortEnemiesByDistance();
 * for (i = 0; i < count; i++)                       // pass one
 *     if (list[i].obj+0x34 & 1) { obj+0x131D = i; obj+0x131E = 0xE; }
 * for (i = 0; i < count; i++)                       // pass two
 *     if (!(obj+0x34 & 1) || (obj+0x34 & 0x20000000)) list[i].obj = NULL;
 * for (i = 0, n = 0; i < count; i++)                // pass three
 *     if (list[i].obj) list[i].obj+0x131E = n++;
 * count = 0;
 * ```
 *
 * `[proved]`. The engine touches **only what registered**: there is no fourth
 * pass putting anyone back to a default. An actor that drops out keeps the
 * last rank it was given, and one that never enters keeps what its `Init`
 * wrote. The port used to end with a sweep of `G.g_object_list` writing
 * `rank = -1, queueRank = 0` onto everything unranked, which is invented twice
 * over -- it scribbles class-0x30 offsets onto every other class, and
 * `queueRank = 0` is the *front* of the queue, so every enemy past the
 * fourteenth passed the `< QUEUE_CAP` cap the pass exists to enforce.
 *
 * The port also used to rank at the head of the frame over the pool, on the
 * 3-D distance to the eye the renderer drew. The engine's key is the floor
 * distance to the gameplay eye as it stood when the actor filed itself, one
 * frame before.
 *
 * One side effect is **not** ported. Pass one also sets
 * `g_close_ranked_enemy` (`0x009C7310`) when a ranked actor of character
 * type `0xB` is inside its own allowance and carries `obj+0x136C &
 * 0x2000000`; the only reader is the recursive bone-hierarchy draw at
 * `0x004114C0`, which uses it to pick which bone of the player model a point
 * is taken from. `[open]` -- what that point is has not been read, and the
 * port has no bone hierarchy for the player to hang it on.
 */
export function RankEnemiesByDistance(): void {
  SortEnemiesByDistance();
  const list = G.g_distance_rank_list;
  const objs = list.map((e) => ActorByAt(e.at));
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!RankLive(o)) continue;
    o.rank = i;
    o.queueRank = RANK_SLOTS;
  }
  // A zombie queued behind one that has just swung moves up the moment that
  // one turns to retreat, which is what keeps the queue flowing.
  let n = 0;
  for (const o of objs) {
    if (!RankLive(o) || (o.flags & ActorFlag.BackingOff) !== 0) continue;
    o.queueRank = n++;
  }
  G.g_distance_rank_list = [];
}
