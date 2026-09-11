/**
 * Posing a character from its motion clips, and blending between two.
 *
 * All of it is arithmetic over `BakedMotion` arrays and bone quaternions —
 * no scene, no camera, no actor pool — which is why it comes out of the layer
 * whole. What it needs from the game is on the `Actor` the `Instance` carries,
 * and it only reads.
 *
 * The three clips that can be running at once are, in the order they take
 * precedence: the **death** clip, which overrides everything and holds its
 * last frame; the **entrance**, held then played once; and the looping motion,
 * possibly cross-fading out of the clip before it or blending with a hit
 * reaction.
 */
import { Quaternion, Vector3 } from "three";
import type { BakedMotion } from "../../bundle";
import { BAMS_TO_RAD } from "../../core/bams";
import { authoredFrameHeld, authoredFrameOfTicks }
  from "../../core/play_cursor";
import { MotionFlag } from "../../game/actor";
import type { Instance } from "./instance";

/** The port's clock. `mot/` authors at 30; the engine's frames are 60 Hz. */
const GAME_HZ = 60;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

export class Poser {
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();

pose(inst: Instance): void {
  // Dying takes over everything: the clip plays once and holds its last
  // frame, because what happens after it is `FUN_00456740`, unread.
  if (inst.a.death) {
    const dm = inst.type.motions[String(inst.a.death.motion)];
    if (dm) {
      const f = authoredFrameHeld(inst.a.death.ticks, dm.fps, dm.frames);
      // The death clip is not consumed by `ActorAdvanceMotion` -- a falling
      // body's travel is the clip's, and nothing else moves it -- so this one
      // call site overrides the gate and takes the whole root.
      //
      // It is **not** a second reading of the engine, which has no death
      // track at all: the clip is the ordinary motion and the gate decides as
      // usual. The two come out in the same place while the clip's frame-0
      // horizontal root is zero, which is 992 of 1058 blocks: the pose offset
      // is `root[f]` where the accumulated deltas would be `root[f] - root[0]`,
      // both inside the actor's own rotation. Making this obey the gate means
      // making `ActorAdvanceMotion` run root motion through a death as well,
      // and that is a change to `game/` for the classes with no death machine.
      // Left alone here on purpose; see `docs/BUGS.md`.
      this.apply(inst, dm, f, true);
      return;
    }
  }
  // **The entrance is not a second channel.** The van jump-out is real and it
  // is `zom.bin` 923, but the engine plays it by putting it in the ordinary
  // motion: `ZombieStateMotionCue21` (`FUN_004577F0`) sub 0 calls
  // `ActorSetMotion` (`FUN_00411930`), which writes the clip to `obj+0x1B4`
  // and zeroes the play cursor at `obj+0x19C`, and the state hands over when
  // `g_motion_play_length[motion] - 1 <= obj+0x19C`. There is no third track:
  // the engine's motion block holds the loop and the reaction, and that is
  // all.
  //
  // This used to pose `obj.intro` instead, which is the **descriptor's**
  // `+0x04`/`+0x08` — permanent spawn data describing which clip the entrance
  // *will* play. Nothing clears it because nothing can, so the renderer drew
  // the jump for the actor's whole life while the game walked it on another
  // clip, and past the clip's 41 frames it indexed off the end of `root` and
  // posed `undefined`. That is a NaN bone, so a NaN `obj+0x100`, so a NaN
  // `g_camera_lookat_target`: the aim the fight is supposed to follow, and
  // three of stage 2's rooms could not be cleared because of it.
  const m = inst.type.motions[String(inst.a.motion)];
  if (!m || m.frames <= 0) return;
  const f = authoredFrameOfTicks(inst.a.playTicks, m.fps, m.frames);

  // A strike or lunge the director started: it owns the body, and it reports
  // its own play position back so the hit can land on its frame.
  const act = inst.a.action;
  if (act) {
    const am = inst.type.motions[String(act.motion)];
    if (am) {
      const af = authoredFrameHeld(act.ticks, am.fps, am.frames);
      // Fading *into* the swing: the lunge is set with a fade of 10 and the
      // strike with 5, so the arm comes up rather than appearing raised.
      if (!this.blendFromFade(inst, am, af)) this.apply(inst, am, af);
      return;
    }
  }

  // The stumble, cross-faded over the loop. `ActorPlayHitReaction` starts it
  // on track 1 with a fade length of 10 frames, or 20 when the hit severed
  // something; a hit at bone 9 or above skips the fade entirely. Fading back
  // out over the same length at the end is `[likely]` — the fade *in* is
  // what `FUN_00411B70` states.
  if (inst.a.react) {
    const rm = inst.type.motions[String(inst.a.react.motion)];
    const rf = rm ? authoredFrameOfTicks(inst.a.react.ticks, rm.fps,
                                         rm.frames) : 0;
    if (rm && rf < rm.frames) {
      // `blend` is in **60 Hz game frames**; `rf` counts the clip's own
      // frames, which mot/ authors at 30. Comparing them directly stretched
      // the fade over twice the clip and the weight never reached 1.
      const b = inst.a.react.hard ? 0 : inst.a.react.blend * rm.fps / GAME_HZ;
      const w = b <= 0 ? 1
        : Math.min(1, Math.min(rf, rm.frames - rf) / b);
      this.applyBlend(inst, m, f, rm, Math.floor(rf), w);
      return;
    }
  }
  if (!this.blendFromFade(inst, m, f)) this.apply(inst, m, f);
}

/**
 * Cross-fade out of the previous clip, if one is running.
 *
 * `ActorSetMotionBlended` takes a fade length as its fourth argument and
 * every state passes one — 5 for the approach walk and the strike, 10 for
 * the run, the idle, the retreat, the lunge and the wait. The port ignored
 * it, so every transition was a cut and the bite jumped straight into the
 * walk-back.
 *
 * Returns false when there is nothing to fade from, so the caller poses
 * normally.
 */
private blendFromFade(inst: Instance, m: BakedMotion, f: number): boolean {
  const fade = inst.a.fadeFrom;
  if (!fade || inst.a.fade <= 0 || inst.a.fadeLen <= 0) return false;
  const pm = inst.type.motions[String(fade.motion)];
  if (!pm || pm.frames <= 0) return false;
  // The outgoing clip keeps playing underneath; `ActorAdvanceMotion` runs
  // its clock. Weight goes 0 -> 1 onto the incoming one.
  const pf = authoredFrameOfTicks(fade.ticks, pm.fps, pm.frames);
  const w = 1 - inst.a.fade / inst.a.fadeLen;
  this.applyBlend(inst, pm, pf, m, f, Math.min(1, Math.max(0, w)));
  return true;
}

/**
 * Pose from two motions at once: *w* is how much of *mB* to take.
 *
 * The engine blends by holding two motion tracks in one block and fading
 * between them (`FUN_004119F0`'s track argument is 1 for the reaction, 0 for
 * the loop). Slerping the bone quaternions is the same operation stated in
 * the units this client already works in.
 */
private applyBlend(inst: Instance, mA: BakedMotion, fA: number,
                   mB: BakedMotion, fB: number, w: number): void {
  const ra = fA * 3;
  const rb = fB * 3;
  // The same two arms as `apply`, and the engine reaches them through the same
  // `if`: `SkeletonPoseRootFrame` (`FUN_00410920`) lerps the two tracks' root
  // translations into one triple at `model+0x6C..0x74` *before*
  // `SkeletonApplyRootMotion` sees it, so a blend is one root, not two.
  const full = (inst.a.motionFlags & MotionFlag.RootMotion) === 0;
  const lerp = (a: number, b: number): number => a + (b - a) * w;
  inst.pivot.position.set(
    full ? lerp(mA.root[ra], mB.root[rb]) : 0,
    lerp(mA.root[ra + 1], mB.root[rb + 1]),
    full ? lerp(mA.root[ra + 2], mB.root[rb + 2]) : 0);

  const n = inst.type.bone_count;
  const ba = fA * n * 3;
  const bb = fB * n * 3;
  inst.pivot.quaternion
    .copy(this.bams(mA.rot[ba], mA.rot[ba + 1], mA.rot[ba + 2]))
    .slerp(this.bams(mB.rot[bb], mB.rot[bb + 1], mB.rot[bb + 2]), w);

  for (const [bone, node] of inst.bones) {
    const oa = ba + bone * 3;
    const ob = bb + bone * 3;
    if (oa + 2 >= mA.rot.length || ob + 2 >= mB.rot.length) continue;
    node.quaternion
      .copy(this.bams(mA.rot[oa], mA.rot[oa + 1], mA.rot[oa + 2]))
      .slerp(this.bams(mB.rot[ob], mB.rot[ob + 1], mB.rot[ob + 2]), w);
  }
}

/**
 * Pose from one motion.
 *
 * `full` says the pivot takes the clip root's **horizontal** part as well as
 * its y. That is not a choice this file makes: it is
 * `SkeletonApplyRootMotion`'s (`FUN_00410C50`) second arm, and the gate is
 * `model+0x64` bit 1, {@link MotionFlag.RootMotion}. With root motion
 * **on** the delta has already walked the actor, so the pose takes only the
 * height; with it **off** nothing has moved the actor and the pose takes the
 * whole translation, in the actor's own rotated frame.
 *
 * The root track is the root *bone's* position within the model — its y sits
 * around 11, standing height — and its x/z carry the character's travel:
 * `char_adv00`'s run runs to -30 over a cycle and its bite to -18 and back.
 * Applying that to the pivot as well as to the actor slid the model backwards
 * out of its own footprint and snapped it on the loop, which is why the y-only
 * arm was written first — and then written for everything, which is the bug
 * this replaces. 992 of the game's 1058 motion blocks have an **exactly zero**
 * horizontal root on frame 0, so the missing arm was invisible for all but 64
 * of them; `zom.bin` 998, the rescue target's clip, is `(0, 15.692, 11.943)`
 * on every one of its sixteen frames, and 11.943 is where it sat off its seat.
 *
 * The vertical stays either way: that is the walk's bob, and nothing else
 * provides it.
 *
 * [open] The engine's translate sits **inside** `MatrixScale(model+0x116C)`,
 * so a character drawn at 0.9 offsets by 0.9 of what its clip authored. This
 * port draws every character at 1.0 — the exporter bakes no scale into the
 * instance root and `render/characters.ts` sets none — so the offset is
 * unscaled here, consistently with the model it offsets. Scaling one without
 * the other would be worse than either.
 */
private apply(inst: Instance, m: BakedMotion, f: number,
              full = (inst.a.motionFlags & MotionFlag.RootMotion) === 0):
    void {

  // Root translation: three floats per frame.
  const r = f * 3;
  inst.pivot.position.set(full ? m.root[r] : 0, m.root[r + 1],
                          full ? m.root[r + 2] : 0);

  // Per-bone BAMS triples: bone_count * 3 shorts per frame, bone 0 first.
  const base = f * inst.type.bone_count * 3;
  inst.pivot.quaternion.copy(
    this.bams(m.rot[base], m.rot[base + 1], m.rot[base + 2]));

  for (const [bone, node] of inst.bones) {
    const o = base + bone * 3;
    if (o + 2 >= m.rot.length) continue;
    node.quaternion.copy(this.bams(m.rot[o], m.rot[o + 1], m.rot[o + 2]));
  }
}

/** `qZ * qY * qX`, matching the engine's `RotZ; RotY; RotX` stack order. */
private bams(rx: number, ry: number, rz: number): Quaternion {
  this.q.setFromAxisAngle(AXIS_Z, rz * BAMS_TO_RAD);
  this.qa.setFromAxisAngle(AXIS_Y, ry * BAMS_TO_RAD);
  this.q.multiply(this.qa);
  this.qa.setFromAxisAngle(AXIS_X, rx * BAMS_TO_RAD);
  return this.q.multiply(this.qa);
}
}
