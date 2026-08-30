/**
 * `ZombieSetMotionIfIdle` — `FUN_00454770`.
 *
 * Start a motion unless it is already playing. The states call this rather
 * than setting the motion outright so that a stumble in progress is not cut
 * off — the engine also checks `obj+0x136C` bits 0x1000 and 0x2000, which are
 * the reaction latches `ZombieOnShot` sets.
 *
 * **The start frame is random**, and that is not a detail. Every caller passes
 * one: `ZombieStateApproach` and `ZombieStateAttackRun` pass
 * `rand() % clip_length`, and `ZombieStateHoldAtRange`, `ZombieStateBackOff`
 * and `ZombieStateWaitTurn` pass `rand() % 5`. Starting every actor at frame
 * zero, as this did, makes a crowd move in lockstep — two zombies given the
 * same order at the same moment take exactly the same steps at exactly the
 * same time, which is the one thing a crowd of shambling corpses never does.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { MotionOf } from "../tables";

export function ZombieSetMotionIfIdle(obj: Actor, motion: number | undefined,
                                     rng: Rng, spread: number | "clip"): void {
  if (motion === undefined) return;
  const m = MotionOf(obj, motion);
  if (!m) return;
  // A one-shot the state machine started -- a strike, a lunge -- owns the
  // actor until it ends, and the reaction runs on its own track.
  if (obj.action) return;
  if (obj.motion === motion) return;
  obj.motion = motion;
  const frames = Math.max(1, spread === "clip" ? m.frames : spread);
  obj.clock = rng.int(frames) / Math.max(1, m.fps);
  obj.rootFrame = -1;
}
