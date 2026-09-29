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
import { ActorFlag, type Actor, type OverlayTrack } from "./actor";
import { ActorStartFade } from "./class30/motion_cue";
import { MotionFade } from "./class30/states";
import { authoredFrameHeld, ticksOfAuthoredFrame }
  from "../core/play_cursor";
import { ApplyRootMotion, rootDelta } from "./root_motion";
import { MotionAuthoredFrame, MotionOf, MotionPlayFrame, MotionPlayLength,
         SecondsToTicks } from "./tables";

/** One actor's clocks, `dt` seconds of game time. */
export function ActorAdvanceMotion(obj: Actor, dt: number): void {
  // The sample: `SkeletonAdvancePlayCursor` (`FUN_004111A0`) recomputes
  // `model+0x08` from the counter on every draw, frozen or not -- the freeze
  // gates the counter, not the draw -- so a store to the cursor alone lives
  // until here and no further. See `Actor.cursorStore`.
  obj.cursorStore = null;
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
    //
    // **The engine has no death track, and so no `return` here.** A death clip
    // is the ordinary motion, `SkeletonApplyRootMotion` (`FUN_00410C50`) runs
    // from the draw whichever clip it is, and `model+0x64` bit 1 is still set
    // on every class that reaches this branch -- so the engine steps the object
    // by the clip's frame-to-frame delta and poses `(0, root.y, 0)`. This
    // returns instead: nothing moves the actor, and
    // `render/characters/pose.ts` overrides the gate at its one death call
    // site to pose the whole root, because otherwise a falling body's travel
    // would come from nowhere at all.
    //
    // The two land in the same place wherever the clip's frame-0 horizontal
    // root is zero -- the pose offset is `root[f]` where the accumulated
    // deltas would be `root[f] - root[0]`, both inside the actor's own
    // rotation -- and that is 992 of the game's 1058 motion blocks, measured
    // by `web/tools/checks/root_pose.ts`. Which is why it is invisible, not why it
    // is right. Being faithful means running root motion through a death here,
    // for the classes with no death machine, and that is a change of its own.
    // [diverges]
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
  //
  // **A cross-fade holds both ends still**, and this is `SkeletonAdvancePlayCursor`
  // (`FUN_004111A0`) and `SkeletonPoseRootFrame` (`FUN_00410920`) read
  // together. `ActorSetMotionBlended` (`FUN_004119A0`) does not start the new
  // clip running: it snapshots the pose **last drawn** into slot A
  // (`MotionLoadPoseSlot` mode 0xC, `+0x6C` into `+0x44` and each bone's
  // `+0x7C` into `+0x88`), loads the new clip's **start frame** into slot B
  // (mode 2), and raises `track+0x37` bit 0. While that bit is up the sampler
  // does not recompute the cursor from the frame counter at all -- the cursor
  // stays on the start frame -- and the drawn pose is A lerped to B by
  // `(counter - track+0x28) / track+0x30`. On the frame that ratio would pass
  // one the counter is rewritten to `start + 1`, the bit drops, and the clip
  // plays on from there.
  //
  // So the outgoing clip is a **still** -- it does not keep running underneath,
  // and this used to say it did. It mattered wherever the outgoing clip was a
  // one-shot on its last frame: its clock ran on past the end, the poser's
  // `% frames` wrapped it to frame 0, and the blend dissolved **from the clip's
  // first pose**. `ZombieStateEmerge` hands over on the last frame of an emerge
  // clip whose first pose is crouched under the surface, so every zombie that
  // came out of the water sank back into it for the length of the fade and
  // stood up again (stage 2, block 16).
  //
  // And the incoming clip does not advance during the fade either, so a state
  // that waits on its cursor waits the fade out first -- as it does in the
  // engine.
  const ticks = SecondsToTicks(dt);
  let fading = false;
  // How far the clip being faded **into** moves this frame: every tick with no
  // fade up, none while one holds it, and what is left over on the frame the
  // fade ends.
  let run = ticks;
  if (obj.fadeFrom) {
    obj.fade -= ticks;
    if (obj.fade < 0) {
      // `*model = model[2] + 1`: the fade is over and the clip starts moving,
      // from the frame after the one it was held on.
      run = -obj.fade;
      obj.fadeFrom = null;
      obj.fade = 0;
    } else {
      run = 0;
      fading = true;
    }
  }
  obj.playTicks += run;
  // Root motion: the clip's own translation is what walks the actor. Applied
  // only while no one-shot is running, because the one-shot owns the body.
  if (base && !obj.action) {
    const f = MotionAuthoredFrame(obj, base);
    // `SkeletonApplyRootMotion` (`FUN_00410C50`) resets its baseline to the
    // current root whenever `track+0x37` has bit 0 up and bit 5 down
    // (`00410cf8`..`00410d29`), which is every frame of a fade: nothing moves
    // the actor until the clip is playing again, and the first step is from
    // the held start frame to the one after it.
    const d = fading ? { x: 0, y: 0, z: 0 } : rootDelta(base, wasBase, f);
    ApplyRootMotion(obj, d.x, d.z, d.y);
    obj.rootFrame = f;
  } else {
    // A one-shot owns the body, and the base clock keeps running underneath
    // it. Forgetting the base frame here is what stops the *next* base delta
    // spanning the whole strike -- which teleported a zombie eleven units into
    // the camera the frame its swing ended.
    obj.rootFrame = -1;
  }

  // A one-shot at full weight -- a swing, an arc stage, an entrance. It ends
  // itself, and the state machine reads the null as "the swing is over".
  const act = obj.action;
  if (act) {
    const wasAct = obj.rootActionFrame;
    // A one-shot set through `ActorSetOneShotBlended` is the clip the fade is
    // into, so the fade holds **it** on its start frame -- the arc's stages,
    // whose thresholds are compared against exactly that cursor. See
    // `ActorClip.held`.
    act.ticks += act.held ? run : ticks;
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
      ApplyRootMotion(obj, d.x, d.z, d.y);
      obj.rootActionFrame = f;
      if (act.ticks >= ticksOfAuthoredFrame(am.frames, am.fps)) {
        // A one-shot ending is a transition like any other: the next state
        // will set its own clip, and it must fade out of the swing rather
        // than out of whatever the base motion happened to be.
        ActorStartFade(obj, act.motion, act.ticks, MotionFade.Normal);
        obj.action = null;
      }
    }
  }

  // Track 1, the stumble, on its own clock -- the base track above keeps
  // running under it, which is what its hand-back waits for.
  SkeletonAdvanceOverlayCursor(obj, ticks);
}

/**
 * `[port-only]` -- what `MotionLoadPoseSlot` (`FUN_00411C20`) mode 0xC
 * snapshots into a fade's slot A: the pose last drawn on the bones the track
 * is taking over. The engine copies each bone record's `+0x7C` angles; the
 * port names the clip and cursor they were drawn from, as
 * {@link Actor.fadeFrom} does for the base track, and the poser re-samples
 * it. The overlay's own clip while one runs, else the one-shot the port keeps
 * on its own channel, else the base clip.
 */
function OverlaySnapshot(obj: Actor): { motion: number; ticks: number } {
  const t = obj.react;
  if (t) return { motion: t.motion, ticks: t.ticks };
  if (obj.action) return { motion: obj.action.motion, ticks: obj.action.ticks };
  return { motion: obj.motion, ticks: obj.playTicks };
}

/**
 * `MotionCrossFadeTo` — `FUN_00411B70`. Start `motion` on track 1, over the
 * subtree of `bone`.
 *
 * ```
 * track+0x0C = start; track+0x1C = start / 2; track+0x2C = counter1 - 1
 * track+0x31 = fade_in + 1; track+0x33 = fade_out + 1; track+0x24 = motion
 * track+0x38 = (track+0x38 & 0xC7) | 1
 * MotionStartOnTrack(model, bone, motion, 1)    ; the subtree, and slot A
 * ```
 *
 * **The last argument is the fade out, not the fade in.** Both callers pass
 * `(obj+0x194, 1, clip, 0, 1, n)`: the clip is in after two frames, plays to
 * its end, and `SkeletonAdvanceOverlayCursor` then spends `n + 2` frames
 * fading back through {@link MotionFadeOverlayToBase}. The port had `n` as a
 * fade in and nothing on the way out.
 */
export function MotionCrossFadeTo(obj: Actor, bone: number, motion: number,
                                  start: number, fadeIn: number,
                                  fadeOut: number): void {
  obj.react = {
    motion, ticks: start, bone,
    fadeFrom: OverlaySnapshot(obj), fade: fadeIn, fadeLen: fadeIn + 1,
    fadeOut: fadeOut + 1, back: false, hold: false,
  };
}

/**
 * `MotionCrossFadeAlt` — `FUN_00411B20`. {@link MotionCrossFadeTo} without the
 * fade out, and with `track+0x38 = (& 0xDF) | 9`: bit 3 up, so the clip never
 * ends on its own, and bit 0x10 left as it was. `track+0x33` is not written.
 *
 * Its two callers, `ActorPlayHitReaction`'s `obj+0x136C` bit-0x100 arm and
 * `ZombieTickAltHitReaction`, sit behind a bit nothing in the shipped game
 * raises -- see `ZombieFlag2.HitReactionAlt`.
 */
export function MotionCrossFadeAlt(obj: Actor, bone: number, motion: number,
                                   start: number, fadeIn: number): void {
  const was = obj.react;
  obj.react = {
    motion, ticks: start, bone,
    fadeFrom: OverlaySnapshot(obj), fade: fadeIn, fadeLen: fadeIn + 1,
    fadeOut: was?.fadeOut ?? 0, back: was?.back ?? false, hold: true,
  };
}

/**
 * `MotionFadeOverlayToBase` — `FUN_00411BD0`. Track 1's way home: it takes the
 * **base** track's clip at cursor 0 and fades onto it from the pose it last
 * drew.
 *
 * ```
 * track+0x0C = 0; track+0x1C = 0; track+0x33 = 0
 * track+0x24 = track+0x20                       ; the base clip's id
 * track+0x2C = counter1 - 1; track+0x31 = len + 1
 * track+0x38 = (track+0x38 & 0xD7) | 0x11       ; fading, and handing back
 * MotionStartOnTrack(model, bone, track+0x20, 1)
 * ```
 *
 * `SkeletonAdvanceOverlayCursor` calls it with `track+0x33`, which is
 * `MotionCrossFadeTo`'s fade out + 1.
 */
export function MotionFadeOverlayToBase(obj: Actor, bone: number,
                                        len: number): void {
  obj.react = {
    motion: obj.motion, ticks: 0, bone,
    fadeFrom: OverlaySnapshot(obj), fade: len, fadeLen: len + 1,
    fadeOut: 0, back: true, hold: false,
  };
}

/**
 * `SkeletonAdvanceOverlayCursor` — `FUN_004112E0`. Track 1's clock, and what
 * ends it: `SkeletonDrawWalk` runs it on every draw beside the base track's
 * `SkeletonAdvancePlayCursor` (`FUN_004111A0`).
 *
 * ```
 * if (model+0x36 != 1) return
 * if (!(flags & 0x10)) {                         ; not handing back
 *   if (flags & 1) {                             ; fading in
 *     k = counter1 - track+0x2C
 *     if (k == track+0x31 + 1) { counter1 = cursor1 + 1; flags &= ~1 }
 *     else if (k > track+0x31 + 1 || k < 0) { flags &= ~1; hand back }
 *   }
 * } else {
 *   if (counter1 - track+0x2C >= track+0x31 + 1) flags &= ~1
 *   if (!(flags & 1) && cursor0 == cursor1) { flags &= ~0x10; hand back }
 * }
 * if (model+0x36 != 1) return
 * if (!(flags & 1)) {
 *   if (!(flags & 0x10)) cursor1 = counter1 % (play_length + 1)
 *   ...load the pose at cursor1...
 * }
 * if (cursor1 >= play_length && !(flags & 8)) {
 *   if (track+0x33 > 0) MotionFadeOverlayToBase(model, 1, track+0x33)
 *   else if (!(flags & 0x10)) hand back
 * }
 * hand back:  model+0x36 = 0; SkeletonAssignSubtreeTrack(0, 0)
 * ```
 *
 * The port steps the counter here, where the engine's `ZombieAdvanceMotion`
 * steps both tracks' counters after the draw, so it is the base track's
 * {@link ActorAdvanceMotion} pattern: the counter is held while a fade holds
 * the cursor, and moves on by what is left of the frame once the fade is
 * spent. The fade-in's out-of-range arm needs the counter to jump, which a
 * counter stepped a frame at a time does not do, in the engine or here.
 *
 * Handing back while fading home waits for the base cursor to come round to
 * 0, the frame this track holds -- so the upper body stands on the base
 * clip's first frame until the loop underneath reaches it.
 */
export function SkeletonAdvanceOverlayCursor(obj: Actor, ticks: number): void {
  const t = obj.react;
  if (!t) return;
  let run = ticks;
  if (t.fadeFrom) {
    t.fade -= ticks;
    if (t.fade < 0) {
      run = -t.fade;
      t.fadeFrom = null;
      t.fade = 0;
    } else {
      run = 0;
    }
  }
  if (t.back) {
    // Bit 0x10: the cursor is not recomputed -- it stays on 0 -- and the
    // track hands back on the draw the base cursor equals it.
    if (!t.fadeFrom && MotionPlayFrame(obj) === t.ticks) obj.react = null;
    return;
  }
  t.ticks += run;
  if (t.hold || OverlayCursor(obj, t) < MotionPlayLength(obj, t.motion)) return;
  if (t.fadeOut > 0) {
    MotionFadeOverlayToBase(obj, t.bone, t.fadeOut);
    return;
  }
  obj.react = null;
}

/**
 * `[port-only]` -- `track+0x0C`, track 1's cursor, which the engine stores
 * (`counter1 % (play_length + 1)`, held at 0 while the track fades home) and
 * the port derives from {@link OverlayTrack.ticks}, as
 * `MotionPlayFrame` does for the base track. `ZombieClearHitReactionWhenDone`
 * reads it as `obj+0x1A0`.
 */
export function OverlayCursor(obj: Actor, t: OverlayTrack): number {
  if (t.back) return t.ticks;
  const len = MotionPlayLength(obj, t.motion);
  return len > 0 ? t.ticks % (len + 1) : t.ticks;
}

/**
 * A store to the play cursor alone: `model+0x08 = cursor`, with the counter
 * at `model+0x00` left as it is.
 *
 * `[port-only]` as a function -- the engine's stores are single `MOV`s, and
 * `CivilianReapplyWaitCommand`'s two (`FUN_0048B760`: `MOV dword ptr
 * [ECX + 0x8], 0x0` at `0x0048B794` for op 0x00, `MOV dword ptr [ECX + 0x8],
 * EDX` at `0x0048B7BA` for op 0x01) are its callers. It exists because the
 * port keeps one clock where the engine keeps those two words, and what the
 * store reaches depends on `SkeletonAdvancePlayCursor` (`FUN_004111A0`):
 *
 *  * **the fade bit up** (`track+0x37 & 1`, which the port holds as
 *    `Actor.fadeFrom`): the sampler leaves the cursor alone, and the fade's
 *    end resumes the counter from it (`*model = model[2] + 1`). The port's
 *    held {@link Actor.playTicks} *is* that cursor, so the store goes there.
 *  * **the bit down**: the next draw recomputes the cursor from the counter
 *    and the store is gone. Until then its only reader is
 *    `CivilianStepScript`'s own `0x200` test (`CMP [model+0x8], sub+0x16`),
 *    so it waits in {@link Actor.cursorStore}; the clip plays on where it was.
 *
 * The port wrote {@link Actor.playTicks} in both cases, which restarted every
 * civilian's clip on the frame a block resumed -- one frame early, before
 * `CivilianRunScript` changed it -- so `CivilianApplyMotionPose`
 * (`FUN_0048C310`) turned her by the heading of the outgoing clip's first
 * frame rather than the one she was drawn in, and the fade dissolved from that
 * first frame too. Stage 1's fountain man (`0x1828`, stream 0) turned 145
 * degrees at once and swung back through the fade.
 */
export function ActorStorePlayCursor(obj: Actor, cursor: number): void {
  if (obj.fadeFrom) {
    obj.playTicks = cursor;
    obj.cursorStore = null;
  } else {
    obj.cursorStore = cursor;
  }
}
