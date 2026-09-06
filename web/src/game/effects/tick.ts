/**
 * `[port-only]` — one call for the four effect pools.
 *
 * The engine has no such function: every one of these objects is a task with
 * its own per-frame routine, and the task list steps them. The port has a
 * fixed pool and a snapshot, so the pools are arrays in `G` and something has
 * to walk them; this is that something, and it holds no behaviour of its own.
 */
import { BloodSpraysTick } from "./blood";
import { PlayerShotEffectsTick } from "./shot_effects";
import { SpriteEffectsTick } from "./sprite";

/** `[port-only]` — see the file comment. */
export function ShotEffectsTick(): void {
  PlayerShotEffectsTick();
  SpriteEffectsTick();
  BloodSpraysTick();
}
