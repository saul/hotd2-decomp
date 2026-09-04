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
import { FrameToTicks, MotionOf } from "../tables";
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
    ActorStartFade(obj, obj.motion, obj.playTicks, fade);
  }
  obj.motion = motion;
  const frames = Math.max(1, spread === "clip" ? m.frames : spread);
  obj.playTicks = FrameToTicks(rng.int(frames), m);
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
  // The cut takes the swing with it — see {@link ActorEndOneShot}. This one
  // leaves nothing to blend from, so the swing is dropped rather than faded.
  obj.action = null;
  obj.rootActionFrame = -1;
  obj.motion = motion;
  obj.playTicks = 0;
  obj.fadeFrom = null;
  obj.fade = 0;
  obj.fadeLen = 0;
  obj.rootFrame = -1;
}

/**
 * **There is only one track**, and this is what that costs the port.
 *
 * `ZombieStateStrike` (`FUN_00455A40`) plays its lunge and its swing on the
 * actor's *ordinary* motion:
 *
 * ```
 * 00455b54  6a00 6a00 ff77 04 57   SetCurrentActorMotionBlended(obj+0x194,
 * 00455b5b  e8..                     entry->lunge, 0, 10)
 * 00455b8a  6a05 6a00 ff37 57      FUN_004119A0(obj+0x194, entry->strike, 0, 5)
 * 00455bd6  0fbf0c4dd0074e00       MOVSX ECX, [g_motion_play_length + 0x1B4*2]
 * ```
 *
 * — `obj+0x1B4` and the play cursor at `obj+0x19C`, the same pair every other
 * state reads. The port gives the swing a channel of its own (`obj.action`,
 * `[port-only]`) because the poser needs it at full weight while the walk
 * keeps its clock; the engine needs no such thing, because writing the motion
 * **is** ending the swing.
 *
 * So both primitives that write that track end the one-shot, which is the
 * whole of **B5**: `ZombieOnShot` (`FUN_00453EB0`) sets state 6 on the frame
 * the actor dies, `ZombieStateDeath6` calls `ChooseDeathMotion`, and in the
 * engine the death clip lands on top of the swing. Without this the port left
 * `obj.action` running, `render/characters/pose.ts` kept posing the strike
 * over the death state, and the actor finished its swing and only then fell —
 * which is exactly what was reported.
 *
 * The fade is out of **what is on screen**, which while a one-shot runs is the
 * one-shot and not `obj.motion`: that is `ZombieStateStrike`'s own `endStrike`
 * reasoning, and it is here so that every caller gets it.
 */
function ActorEndOneShot(obj: Actor, fade: number): void {
  const act = obj.action;
  if (!act) return;
  obj.action = null;
  obj.rootActionFrame = -1;
  ActorStartFade(obj, act.motion, act.ticks, fade);
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
  // One track: writing it ends whatever one-shot was on it. See
  // {@link ActorEndOneShot} — this is the edge B5 was missing.
  ActorEndOneShot(obj, fade);
  if (obj.motion !== motion) {
    if (obj.fadeFrom && obj.fade > 0) {
      obj.fade = fade;
      obj.fadeLen = fade;
    } else {
      ActorStartFade(obj, obj.motion, obj.playTicks, fade);
    }
  }
  obj.motion = motion;
  obj.playTicks = FrameToTicks(Math.max(0, frame), m);
  obj.rootFrame = -1;
}

/**
 * Begin a cross-fade out of whatever is showing.
 *
 * The engine holds two motions on one track and fades between them;
 * `MotionCrossFadeTo` (`FUN_00411B70`) is the same operation for the stumble,
 * which this port already does. This is it for an ordinary motion change.
 */
export function ActorStartFade(obj: Actor, fromMotion: number,
                               fromTicks: number, frames: number): void {
  if (frames <= 0 || !MotionOf(obj, fromMotion)) {
    obj.fadeFrom = null;
    obj.fade = 0;
    return;
  }
  obj.fadeFrom = { motion: fromMotion, ticks: fromTicks };
  obj.fade = frames;
  obj.fadeLen = frames;
}
