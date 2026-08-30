/**
 * `ZombieSetMotionIfIdle` — `FUN_00454770`.
 *
 * Start a motion unless it is already playing. The states call this rather
 * than setting the motion outright so that a stumble in progress is not cut
 * off — the engine also checks `obj+0x136C` bits 0x1000 and 0x2000, which are
 * the reaction latches `ZombieOnShot` sets.
 */
import type { Actor } from "../actor";
import { MotionOf } from "../tables";

export function ZombieSetMotionIfIdle(obj: Actor, motion: number | undefined,
                                     loop = true): void {
  if (motion === undefined || !MotionOf(obj, motion)) return;
  // A one-shot the state machine started -- a strike, a lunge -- owns the
  // actor until it ends, and the reaction runs on its own track.
  if (obj.action) return;
  if (obj.motion === motion) return;
  obj.motion = motion;
  obj.clock = 0;
  obj.rootFrame = -1;
  void loop;
}
