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
import { ApplyRootMotion, rootDelta } from "./root_motion";
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
  const base = MotionOf(obj, obj.motion);
  const wasBase = obj.rootFrame;
  obj.clock += dt;
  // Root motion: the clip's own translation is what walks the actor. Applied
  // only while no one-shot is running, because the one-shot owns the body.
  if (base && !obj.action && !obj.intro) {
    const f = Math.floor(obj.clock * base.fps) % Math.max(1, base.frames);
    const d = rootDelta(base, wasBase, f);
    ApplyRootMotion(obj, d.x, d.z);
    obj.rootFrame = f;
  } else {
    // A one-shot owns the body, and the base clock keeps running underneath
    // it. Forgetting the base frame here is what stops the *next* base delta
    // spanning the whole strike -- which teleported a zombie eleven units into
    // the camera the frame its swing ended.
    obj.rootFrame = -1;
  }

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
    const wasAct = obj.rootActionFrame;
    act.t += dt;
    const am = MotionOf(obj, act.motion);
    if (!am) {
      obj.action = null;
    } else {
      // [diverges] Root motion is applied to a **looping** clip only.
      //
      // The mechanism that moves a clip's root delta onto the actor is still
      // unread, so which clips it applies to is a choice, and this is the one
      // the data supports. `char_adv00`'s attacks name distances of 26.0 and
      // 25.0 against an inner ring of 25 -- so an actor arriving from
      // `ZombieStateHoldAtRange` is *always* already inside the attack's own
      // distance, the lunge never plays, and the strike is performed on the
      // spot. Its clip nevertheless carries -15.55 of translation, and
      // applying that walked the zombie through the camera and out the far
      // side, where the retreat then parked it on the ring behind the player.
      //
      // A looping clip is locomotion and a one-shot is a performance. The
      // lunge loops, so it still closes; the strike does not, so it swings
      // where it stands.
      const f = Math.min(am.frames - 1, Math.floor(act.t * am.fps));
      if (act.loop) {
        const d = rootDelta(am, wasAct, f);
        ApplyRootMotion(obj, d.x, d.z);
      }
      obj.rootActionFrame = f;
      if (act.t * am.fps >= am.frames) {
        if (act.loop) { act.t = 0; obj.rootActionFrame = -1; }
        else obj.action = null;
      }
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
