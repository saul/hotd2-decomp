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
 * `g_script_flags[0x77]` — the scene-1 sweep. `PropExpireByStepLifetime`
 * checks it before anything else, so on stage 2 raising this flag clears
 * every prop that runs the prologue in one frame.
 */
export const SCRIPT_FLAG_CLEAR_PROPS = 0x77;

/**
 * `PropExpireByStepLifetime` — `FUN_00466640`.
 *
 * ```c
 * if (g_scene_index == 1 && g_script_flags[0x77] != 0) { ActorDespawn(obj); return; }
 * if (g_evt_step_index != obj->+0x196) {
 *     if (obj->+0x11C < ++obj->+0x197) { ActorDespawn(obj); return; }
 *     obj->+0x196 = g_evt_step_index;
 * }
 * ```
 *
 * `obj+0x11C` is a **lifetime in event steps** — the prop ages one tick every
 * time `g_evt_step_index` *changes*, and that index counts 1..k inside a block
 * before dropping back to 1 on a block change. It is not a block count: the
 * port read it as one, and with blocks averaging 3.99 steps every prop lived
 * about four times too long.
 *
 * That also settles a question the port had half-answered: `PlaceGenericProp`
 * copies the spawn
 * descriptor's `+0x11C` into `obj+0x11C` *and* into `obj+0x28C`, the asset
 * slot, so one number in the script is read as two different things —
 * whichever of the two this type's routine happens to look at.
 *
 * The 46 of stage 2's 67 generic props that carry 0–5 are carrying a lifetime;
 * the 21 that carry 0x1D8 and up are carrying a slot. See
 * `GENERIC_DRAW_SLOT` in `generic.ts` for which types read which.
 *
 * **And for four types they are not the same word at all.** Types 12, 31, 51
 * and 53 have a switch arm that writes the placer's `+0x1F4` — the s8 at
 * `desc+0x24` — over `obj+0x11C`, so those 55 spawns carry a real slot *and* a
 * real lifetime in two separate fields. See `GENERIC_LIFETIME_FROM_1F4`. The
 * paragraph above is right about the other forty types and was wrong about
 * these: the port gave all 55 of them their own asset slot as a lifetime, and
 * an unretirable prop is invisible for exactly as long as the prop is.
 *
 * [diverges] The engine counts in a `char`, so `obj+0x197` wraps at 128 and
 * the comparison is signed 16-bit. A prop carrying a real asset slot as its
 * lifetime — 5949, say — therefore *does* eventually expire in the engine,
 * after the counter has wrapped 47 times. No shipped stage has that many step
 * changes (479 steps over all six), so the wrap is unreachable and this counts
 * in a `number`.
 */
export function PropExpireByStepLifetime(p: BreakableProp): boolean {
  if (G.g_scene_index === 1
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return true;
  }
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorDespawnProp(p);
      return true;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  return false;
}
