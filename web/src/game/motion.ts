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
import { ActorFlag, type Actor } from "./actor";
import { ActorStartFade } from "./class30/motion_cue";
import { MotionFade } from "./class30/states";
import { authoredFrameHeld, ticksOfAuthoredFrame }
  from "../core/play_cursor";
import { ApplyRootMotion, rootDelta } from "./root_motion";
import { MotionAuthoredFrame, MotionOf, SecondsToTicks } from "./tables";

/** One actor's clocks, `dt` seconds of game time. */
export function ActorAdvanceMotion(obj: Actor, dt: number): void {
  // A frozen set-piece holds its pose exactly. In the engine the clock lives
  // *inside* the class's own draw routine — `SetPiecePropDrawAndTick` writes
  // `if (obj+0x1324 == 0) obj+0x194++` — so a frozen object simply never
  // advances, and the freeze is not a thing that has to be undone afterwards.
  if (obj.frozen !== 0) return;
  // Both classes gate their own advance on `obj+0x34` bit 0x4000, so this is
  // shared rather than moved: `ZombieAdvanceMotion` (`FUN_00454860`) draws the
  // model and only then steps `obj+0x194`/`obj+0x198` `if ((obj+0x34 & 0x4000)
  // == 0)`, and `ThrowerAdvanceMotion` (`FUN_00449EF0`) is class 0x31's copy
  // of it. It is how class 0x31 holds a pose in mid-air, how a corpse stays on
  // the frame it was pinned to, and how a spawn record parks a class-0x30
  // actor inside a vehicle until `ZombieStateMotionCue21` lets it out.
  //
  // The draw still runs in the engine — the gate is on the counters, not on
  // the model — but root motion is a difference between two frames, so frozen
  // counters mean no movement either way. **Whoever sets this bit owns
  // clearing it**: an actor left with it on is a statue.
  if (obj.flags & ActorFlag.PoseFrozen) return;
  if (obj.death) {
    // The death clip plays once and **holds its last frame**, which is what
    // `ZombieStateDeath6` (`FUN_00454D20`) waits for: it leaves at
    // `g_motion_play_length - 1` and hands the body to `ZombieEnterCorpseState`
    // (`FUN_00456740`).
    //
    // **Classes 0x30, 0x31 and 0x10 no longer arrive here.** All three are
    // `updatesWhenDead` and run their own death states over the base track, so
    // this is the shared clip for the classes that have no such machine.
    obj.death.ticks += SecondsToTicks(dt);
    return;
  }
  const base = MotionOf(obj, obj.motion);
  const wasBase = obj.rootFrame;
  // **The play cursor counts frames, not seconds.** `obj+0x19C` is an integer
  // the engine increments once per frame; accumulating `dt` and flooring it
  // back out lost whole cursor values to float drift, and every `===` cue on
  // one of them silently never fired. `dt` is always a whole number of ticks
  // here -- `Tick.dt` is `frames * TICK` -- so this is a conversion, not a
  // rounding-off of something finer.
  obj.playTicks += SecondsToTicks(dt);
  // The outgoing clip keeps running underneath, which is what makes the blend
  // land in the right place rather than freezing a pose and dissolving it.
  if (obj.fadeFrom) {
    obj.fadeFrom.ticks += SecondsToTicks(dt);
    obj.fade -= SecondsToTicks(dt);
    if (obj.fade <= 0) obj.fadeFrom = null;
  }
  // Root motion: the clip's own translation is what walks the actor. Applied
  // only while no one-shot is running, because the one-shot owns the body.
  if (base && !obj.action) {
    const f = MotionAuthoredFrame(obj, base);
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

  // A strike or lunge at full weight. The lunge loops; the strike ends itself,
  // and the state machine reads the null as "the swing is over".
  const act = obj.action;
  if (act) {
    const wasAct = obj.rootActionFrame;
    act.ticks += SecondsToTicks(dt);
    const am = MotionOf(obj, act.motion);
    if (!am) {
      obj.action = null;
    } else {
      // The strike travels, and it has to: `char_adv00`'s bite runs
      // 0 -> -18.1 -> -15.55, a lunge and a recover. The 15.5 units it ends up
      // forward are exactly the distance `ZombieStateBackOff` then has to walk
      // back before it may attack again -- which *is* the pause between bites.
      // Suppressing it left the actor already at the ring when the swing
      // ended, so the retreat finished on its first frame and it bit again
      // immediately.
      const f = authoredFrameHeld(act.ticks, am.fps, am.frames);
      const d = rootDelta(am, wasAct, f);
      ApplyRootMotion(obj, d.x, d.z);
      obj.rootActionFrame = f;
      if (act.ticks >= ticksOfAuthoredFrame(am.frames, am.fps)) {
        if (act.loop) {
          act.ticks = 0;
          obj.rootActionFrame = -1;
        } else {
          // A one-shot ending is a transition like any other: the next state
          // will set its own clip, and it must fade out of the swing rather
          // than out of whatever the base motion happened to be.
          ActorStartFade(obj, act.motion, act.ticks, MotionFade.Normal);
          obj.action = null;
        }
      }
    }
  }

  // The stumble runs on its own track; the loop underneath keeps going, which
  // is what makes the cross-fade back land in the right place.
  if (obj.react) {
    obj.react.ticks += SecondsToTicks(dt);
    const rm = MotionOf(obj, obj.react.motion);
    if (!rm || obj.react.ticks >= ticksOfAuthoredFrame(rm.frames, rm.fps)) {
      obj.react = null;
    }
  }
}
