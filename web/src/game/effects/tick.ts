/**
 * `[port-only]` — one call for the effect pools.
 *
 * The engine has no such function: every one of these objects is a task with
 * its own per-frame routine, and the task list steps them. The port has a
 * fixed pool and a snapshot, so the pools are arrays in `G` and something has
 * to walk them; this is that something, and it holds no behaviour of its own.
 */
import { BloodSpraysTick, PointBloodSpraysTick } from "./blood";
import { PlayerShotEffectsTick } from "./shot_effects";
import { PropStripEffectsTick } from "./prop_strip";
import { SpriteEffectsTick } from "./sprite";
import { WaterRingsTick } from "./water_ring";

/** `[port-only]` — see the file comment. */
export function ShotEffectsTick(): void {
  PlayerShotEffectsTick();
  SpriteEffectsTick();
  BloodSpraysTick();
  PointBloodSpraysTick();
  // Not a shot effect -- the carrier's bow strip -- but the same kind of
  // pool, walked at the same point in the frame.
  PropStripEffectsTick();
  // ...and the water rings, which draw before they step as the sprites do.
  // The ground rings step before they draw, and so run after the actor walk
  // instead -- see `director.ts`.
  WaterRingsTick();
}
