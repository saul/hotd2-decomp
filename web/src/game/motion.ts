/**
 * The actor's motion clocks.
 *
 * These belong to the port, not to the renderer, and it took a headless test
 * to make that obvious: the strike's hit lands on a frame of its clip, so if
 * the only thing advancing that clip is the thing drawing it, the game cannot
 * be run without a screen — and a save state restored into a paused player
 * would sit on a half-played swing for ever.
 *
 * `ActorSetMotion` and the motion job own these in the engine, and the frame
 * counter is a field of the object, at `obj+0x19C`.
 */
import type { Actor } from "./actor";
import { MotionOf } from "./tables";

/** One actor's clocks, `dt` seconds of game time. */
export function ActorAdvanceMotion(obj: Actor, dt: number): void {
  if (obj.death) {
    // The death clip plays once and **holds its last frame**: `ZombieStateDeath6`
    // waits for it to finish and hands the body to a routine that is not read,
    // so the corpse stays put rather than doing something invented.
    obj.death.t += dt;
    return;
  }
  obj.clock += dt;

  // The entrance: hold its first frame for the delay, play it once, then hand
  // over to the looping motion. `ZombieStateMotionCue21` waits for `obj+0x19C`
  // to reach the clip's length before changing state, so the hand-over is at
  // the end of the clip and not on a timer.
  if (obj.intro) {
    const im = MotionOf(obj, obj.intro.motion);
    if (!im) {
      obj.intro = null;
    } else if (obj.clock * im.fps - obj.intro.delay >= im.frames) {
      // Restart the loop's clock from the moment the entrance ended, so the
      // walk does not begin part-way through.
      obj.clock -= (obj.intro.delay + im.frames) / im.fps;
      obj.intro = null;
    }
  }

  // A strike or lunge at full weight. The lunge loops; the strike ends itself,
  // and the state machine reads the null as "the swing is over".
  const act = obj.action;
  if (act) {
    act.t += dt;
    const am = MotionOf(obj, act.motion);
    if (!am) obj.action = null;
    else if (act.t * am.fps >= am.frames) {
      if (act.loop) act.t = 0;
      else obj.action = null;
    }
  }

  // The stumble runs on its own track; the loop underneath keeps going, which
  // is what makes the cross-fade back land in the right place.
  if (obj.react) {
    obj.react.t += dt;
    const rm = MotionOf(obj, obj.react.motion);
    if (!rm || obj.react.t * rm.fps >= rm.frames) obj.react = null;
  }
}
