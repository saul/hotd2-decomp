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
import { MotionFade } from "./states";

export function ZombieSetMotionIfIdle(obj: Actor, motion: number | undefined,
                                     rng: Rng, spread: number | "clip",
                                     fade: MotionFade = MotionFade.Normal): void {
  if (motion === undefined) return;
  const m = MotionOf(obj, motion);
  if (!m) return;
  // A one-shot the state machine started -- a strike, a lunge -- owns the
  // actor until it ends, and the reaction runs on its own track.
  if (obj.action) return;
  if (obj.motion === motion) return;
  // Fade out of what is actually on screen. Right after a swing that is the
  // strike clip, which `ActorAdvanceMotion` parked here as the outgoing one --
  // taking `obj.motion` instead would fade out of the walk the swing had
  // covered up, and the bite would still cut.
  if (obj.fadeFrom && obj.fade > 0) {
    obj.fade = fade;
    obj.fadeLen = fade;
  } else {
    ActorStartFade(obj, obj.motion, obj.clock, fade);
  }
  obj.motion = motion;
  const frames = Math.max(1, spread === "clip" ? m.frames : spread);
  obj.clock = rng.int(frames) / Math.max(1, m.fps);
  obj.rootFrame = -1;
}

/**
 * `ActorSetMotion` — `FUN_00411930`. Start a clip at frame zero, no fade.
 *
 * The other half of the pair: `ActorSetMotionBlended` (`FUN_004119A0`) takes a
 * fade length and this one does not, and the annotation on that address says
 * which is used where — this is the one for **the scripted cues that are meant
 * to cut**. It clears the track outright, `track[0]`, `track[2]`, `track[4]`
 * and `track[6]` together with the two fade bytes at `+0x36`/`+0x37`, so there
 * is nothing left of the outgoing clip to blend from.
 */
export function ActorSetMotion(obj: Actor, motion: number): void {
  obj.motion = motion;
  obj.clock = 0;
  obj.fadeFrom = null;
  obj.fade = 0;
  obj.fadeLen = 0;
  obj.rootFrame = -1;
}

/**
 * `ActorSetMotionBlended` — `FUN_004119A0`. Start a clip at a frame, over a
 * cross-fade.
 *
 * The engine's own primitive, and the one the whole captor-script family calls
 * — a script entry is `{motion, frame, loops, mode}`, and its frame is a
 * literal, not a random spread. `ZombieSetMotionIfIdle` above is the *other*
 * caller shape: the one that draws the start frame, because a crowd must not
 * move in lockstep.
 */
export function ActorSetMotionBlended(obj: Actor, motion: number,
                                      frame: number, fade: number): void {
  const m = MotionOf(obj, motion);
  if (!m) return;
  if (obj.motion !== motion) {
    if (obj.fadeFrom && obj.fade > 0) {
      obj.fade = fade;
      obj.fadeLen = fade;
    } else {
      ActorStartFade(obj, obj.motion, obj.clock, fade);
    }
  }
  obj.motion = motion;
  obj.clock = Math.max(0, frame) / Math.max(1, m.fps);
  obj.rootFrame = -1;
}

/**
 * Begin a cross-fade out of whatever is showing.
 *
 * The engine holds two motions on one track and fades between them;
 * `MotionCrossFadeTo` (`FUN_00411B70`) is the same operation for the stumble,
 * which this port already does. This is it for an ordinary motion change.
 */
export function ActorStartFade(obj: Actor, fromMotion: number, fromT: number,
                               frames: number): void {
  if (frames <= 0 || !MotionOf(obj, fromMotion)) {
    obj.fadeFrom = null;
    obj.fade = 0;
    return;
  }
  obj.fadeFrom = { motion: fromMotion, t: fromT };
  obj.fade = frames;
  obj.fadeLen = frames;
}
