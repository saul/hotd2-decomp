/**
 * `ActorDespawn` — `FUN_00409CC0`. Take an object out of the pool.
 *
 * The engine unlinks it from the list `g_cur_actor` walks and frees it. Here
 * it is a flag, for the same reason `g_object_list` is a list rather than a
 * linked pool: an index is easier to snapshot than a pointer, and the actor
 * has to stay addressable for the one frame the renderer needs to notice.
 *
 * It lives in its own file because both `director.ts` and `class10/` need it
 * and `director.ts` imports the registry, which imports `class10/` — the cycle
 * that a shared leaf avoids.
 */
import type { Actor } from "./actor";

export function ActorDespawn(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
  obj.action = null;
}
