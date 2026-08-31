/**
 * The prologue twenty-five of class 0x41's update routines open with.
 *
 * It is the reason a prop the script placed three blocks ago is not still
 * standing there, and it is where `obj+0x11C` gets its real meaning.
 */
import { G } from "../globals";
import { ActorDespawnProp } from "./prop";
import type { BreakableProp } from "./prop_state";

/**
 * `g_script_flags[0x77]` — the scene-1 sweep. `PropExpireByBlockLifetime`
 * checks it before anything else, so on stage 2 raising this flag clears
 * every prop that runs the prologue in one frame.
 */
export const SCRIPT_FLAG_CLEAR_PROPS = 0x77;

/**
 * `PropExpireByBlockLifetime` — `FUN_00466640`.
 *
 * ```c
 * if (g_scene_index == 1 && g_script_flags[0x77] != 0) { ActorDespawn(obj); return; }
 * if (g_evt_block_counter != obj->+0x196) {
 *     if (obj->+0x11C < ++obj->+0x197) { ActorDespawn(obj); return; }
 *     obj->+0x196 = g_evt_block_counter;
 * }
 * ```
 *
 * `obj+0x11C` is a **lifetime in event blocks**, and that is what settles a
 * question the port had half-answered: `PlaceGenericProp` copies the spawn
 * descriptor's `+0x11C` into `obj+0x11C` *and* into `obj+0x28C`, the asset
 * slot, so one number in the script is read as two different things —
 * whichever of the two this type's routine happens to look at.
 *
 * The 46 of stage 2's 67 generic props that carry 0–5 are carrying a lifetime;
 * the 21 that carry 0x1D8 and up are carrying a slot. See
 * `GENERIC_DRAW_SLOT` in `generic.ts` for which types read which.
 *
 * [diverges] The engine counts in a `char`, so `obj+0x197` wraps at 128 and
 * the comparison is signed 16-bit. A prop carrying a real asset slot as its
 * lifetime — 5949, say — therefore *does* eventually expire in the engine,
 * after the counter has wrapped 47 times. No shipped stage has that many
 * block changes, so the wrap is unreachable and this counts in a `number`.
 */
export function PropExpireByBlockLifetime(p: BreakableProp): boolean {
  if (G.g_scene_index === 1
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return true;
  }
  if (G.g_evt_block_counter !== p.spawnBlock) {
    p.blocksElapsed += 1;
    if (p.lifetime < p.blocksElapsed) {
      ActorDespawnProp(p);
      return true;
    }
    p.spawnBlock = G.g_evt_block_counter;
  }
  return false;
}
