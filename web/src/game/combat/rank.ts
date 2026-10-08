/**
 * The distance queue.
 *
 * Every class-0x30 actor files itself once a frame, from its own update, with
 * its ground distance to the gameplay eye; the next frame's rank task sorts
 * what was filed and tells each its place. `ZombieStateApproach` tests that
 * place against the ring table's allowance, so the queue is a **crowd
 * throttle**: far from the camera a deeper slice of it may come at you, close
 * in only the nearest couple.
 */
import { ActorFlag, type Actor } from "../actor";
import { CAMERA_TRACK_DISTANCE_SCALE } from "../camera/constants";
import { ActorByAt, G } from "../globals";

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
 * One `{key, obj}` pair of `g_distance_rank_list` (`0x005A4D58`, stride 8).
 * `at` stands in for the pointer, as `CameraCandidate`'s does.
 */
export interface DistanceRankEntry {
  key: number;
  at: number;
}

/**
 * `[port-only]` -- `obj+0x34 & 1`, the bit both rank routines test first.
 * The port keeps it as `ActorFlag.Live` at every spawn and despawn and at a
 * class-0x30 corpse, but not yet at every clear the other classes make, so
 * "in the pool and drawn" is still its stand-in here, as it was when the
 * registration test lived here.
 */
function RankLive(obj: Actor | undefined): obj is Actor {
  return obj !== undefined && !obj.despawned && obj.visible;
}

/**
 * `RegisterForDistanceRank` — `FUN_00409010`. File the actor with its key, if
 * the list has room:
 *
 * ```
 * if (!(obj+0x34 & 1) || (obj+0x34 & 0x4000000)) return;
 * if (g_distance_rank_count >= 0xE) return;           ; 0x0040902A
 * dz = obj+0x48 - g_camera_eye_z;                      ; 0x0040902F
 * dx = obj+0x40 - g_camera_eye_x;                      ; 0x00409038
 * key = ftol(sqrt(dx*dx + dz*dz) * [0x004C43A4]);      ; 10.0
 * g_distance_rank_list[count] = { key, obj }; count++;
 * ```
 *
 * **The gameplay eye, on the ground.** `g_camera_eye` (`0x009C71E0`), which
 * the scene state's hook writes fifteen under the rail, and only its `x` and
 * `z`: no height enters the key. The port sorted on the 3D distance to the
 * drawn camera, which ranked a crowd by how far each was from a point fifteen
 * units above the one the engine measures to. `[proved]`
 *
 * Its one caller is `EnemyZombieUpdate` (`0x0045346D`), after the draw, so a
 * class-0x18 rider files too, by its carrier-relative `obj+0x40`, exactly as
 * the engine's does.
 */
export function RegisterForDistanceRank(obj: Actor): void {
  // `obj.dead` is the port's `obj+0x34 & 0x4000000`, as it was here before.
  if (!RankLive(obj) || obj.dead) return;
  if (G.g_distance_rank_list.length >= RANK_SLOTS) return;
  const dz = obj.pos.z - G.g_camera_eye.z;
  const dx = obj.pos.x - G.g_camera_eye.x;
  G.g_distance_rank_list.push({
    key: Math.trunc(Math.sqrt(dx * dx + dz * dz) * CAMERA_TRACK_DISTANCE_SCALE),
    at: obj.at,
  });
}

/**
 * `SortEnemiesByDistance` — `FUN_00409190`. Ascending, nearest first: two
 * 8-bit radix passes over the key's low sixteen bits, which is a stable sort
 * on `key & 0xFFFF` -- ties keep the order they were filed in.
 */
export function SortEnemiesByDistance(list: DistanceRankEntry[]): void {
  const sorted = list.map((e, i) => ({ e, i }))
    .sort((p, q) => ((p.e.key & 0xffff) - (q.e.key & 0xffff)) || (p.i - q.i));
  for (let i = 0; i < list.length; i++) list[i] = sorted[i].e;
}

/**
 * `RankEnemiesByDistance` — `FUN_004090B0`, the thirteenth task of the scene
 * list. Sort what the actors filed **last frame**, write each its place in
 * that queue to `obj+0x131D` and `obj+0x131E`, and empty the list:
 *
 * ```
 * SortEnemiesByDistance();
 * for (i = 0; i < count; i++)                    ; pass one
 *   if (e[i].obj+0x34 & 1) { obj+0x131D = i; obj+0x131E = 0xE; }
 * for (i = 0; i < count; i++)                    ; pass two
 *   if (!(obj+0x34 & 1) || (obj+0x34 & 0x20000000)) e[i].obj = 0;
 * for (i = 0, n = 0; i < count; i++)             ; pass three
 *   if (e[i].obj) e[i].obj+0x131E = n++;
 * g_distance_rank_count = 0;
 * ```
 *
 * Only what registered is touched: an actor that drops out of the list keeps
 * the last rank it was given, and one that never enters it keeps what
 * `ActorSpawn` wrote.
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
export function RankEnemiesByDistance(): void {
  const list = G.g_distance_rank_list;
  SortEnemiesByDistance(list);
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
