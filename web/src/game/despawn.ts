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
import { g_class_handlers } from "./registry";

export function ActorDespawn(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
  obj.action = null;
}

/**
 * Take an actor out of the world because the **script** stopped placing it.
 *
 * The engine has no such moment: an object leaves through its own state
 * machine and its bookkeeping leaves with it. This port materialises actors
 * from the walker's spawn list, so it also has to unmake them when an entry
 * goes, and unmaking has to be the whole removal rather than a hide. Left as a
 * hide the actor stayed in `g_object_list` for ever — invisible, so
 * `GameUpdate` never ran it again, and still counted, so
 * `wait_scripted_actors` held on a number nothing could bring down with nobody
 * on screen to explain it.
 */
export function ActorRetireFromWorld(obj: Actor): void {
  g_class_handlers[obj.cls]?.retire?.(obj);
  ActorDespawn(obj);
}
