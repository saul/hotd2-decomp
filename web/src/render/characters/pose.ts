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
import type { BakedMotion, CharacterType } from "../../bundle";
import { BAMS_TO_RAD } from "../../core/bams";
import { authoredFrameHeld, authoredFrameOfTicks }
  from "../../core/play_cursor";
import { MotionFlag, type FadeRecord, type FadeRoot } from "../../game/actor";
import { MatrixToEulerZYX } from "../../game/matrix";
import type { Instance } from "./instance";

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/**
 * A clip's authored frame at a play cursor that wraps at the play length + 1,
 * as `SkeletonAdvancePlayCursor` (`FUN_004111A0`) and track 1's clock take it.
 */
function cursorFrame(m: BakedMotion, ticks: number): number {
  const play = m.play ?? Math.max(1, m.frames * 2 - 2);
  return authoredFrameHeld(ticks % (play + 1), m.fps, m.frames);
}

const SUBTREES = new WeakMap<CharacterType, Map<number, readonly number[]>>();

/**
 * `bone` and every bone below it -- the records
 * `SkeletonAssignSubtreeTrack` (`FUN_00412200`) hands a track. `parent` in
 * the bundle is an index into the type's bone list.
 */
function subtreeOf(type: CharacterType, bone: number): readonly number[] {
  let byBone = SUBTREES.get(type);
  if (!byBone) SUBTREES.set(type, byBone = new Map());
  let out = byBone.get(bone);
  if (out) return out;
  const list: number[] = [];
  const walk = (b: number): void => {
    list.push(b);
    const i = type.bones.findIndex((x) => x.bone === b);
    for (const c of type.bones) if (i >= 0 && c.parent === i) walk(c.bone);
  };
  walk(bone);
  byBone.set(bone, out = list);
  return out;
}

export class Poser {
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();

pose(inst: Instance): void {
  inst.drawnFrom = null;
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
      // **That is a declared divergence, and it is declared in `game/`**, on
      // the `obj.death` branch of `ActorAdvanceMotion` in `game/motion.ts`
      // that causes it: the engine has no death track, so the gate decides a
      // death clip like any other and the port's early return is what makes
      // this override necessary. The reason lives there rather than here so
      // that `web/tools/repo/port.ts` counts it.
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

  // A one-shot a state started -- a swing, an arc stage, an entrance: it owns
  // the body, and it reports its own play position back so the hit can land
  // on its frame.
  const act = inst.a.action;
  if (act) {
    const am = inst.type.motions[String(act.motion)];
    if (am) {
      const af = authoredFrameHeld(act.ticks, am.fps, am.frames);
      // Fading *into* the one-shot. `ZombieStateStrike` sets its swing with a
      // fade of 5 and the game holds `act.ticks` on the start frame for it,
      // so the arm comes up out of the lunge rather than appearing raised.
      // The lunge itself is not here: it plays on the ordinary track, and
      // its fade of 10 is the base clip's, below.
      if (!this.blendFromFade(inst, am, af)) this.apply(inst, am, af);
      this.poseOverlay(inst);
      return;
    }
  }
  if (!this.blendFromFade(inst, m, f)) this.apply(inst, m, f);
  this.poseOverlay(inst);
}

/**
 * Track 1 -- the stumble -- over the pose the base track has just drawn, on
 * **its subtree only**.
 *
 * `MotionWriteBoneAngles` (`FUN_00411D70`) writes a bone's angles only from
 * the track its record names, and `ActorPlayHitReaction` hands track 1 bone
 * 1's subtree -- torso, head, arms. The root translation and bone 0's
 * rotation come from track 0 whatever happens (`SkeletonPoseRootFrame`,
 * `FUN_00410920`), and so do the pelvis and the legs. So a zombie shot in the
 * chest flinches while it walks, and a crawler flinches on the floor; this
 * blended the whole skeleton, root included, and stood the crawler up.
 *
 * The clip's frame is its cursor's, which wraps at the play length + 1 as the
 * base track's does, and a fade on the track -- in, or back to the base clip
 * -- dissolves from the snapshot `game/` recorded by
 * `1 - fade / fadeLen`, the base track's weight.
 */
private poseOverlay(inst: Instance): void {
  const t = inst.a.react;
  if (!t) return;
  const m = inst.type.motions[String(t.motion)];
  if (!m || m.frames <= 0) return;
  const from = t.fadeFrom
    ? inst.type.motions[String(t.fadeFrom.motion)] : undefined;
  const w = from && from.frames > 0 && t.fadeLen > 0
    ? Math.min(1, Math.max(0, 1 - t.fade / t.fadeLen)) : 1;
  const n = inst.type.bone_count;
  const bb = cursorFrame(m, t.ticks) * n * 3;
  const ba = from && w < 1 ? cursorFrame(from, t.fadeFrom!.ticks) * n * 3 : 0;
  for (const bone of subtreeOf(inst.type, t.bone)) {
    const node = inst.bones.get(bone);
    if (!node) continue;
    const ob = bb + bone * 3;
    if (ob + 2 >= m.rot.length) continue;
    const oa = ba + bone * 3;
    if (from && w < 1 && oa + 2 < from.rot.length) {
      node.quaternion
        .copy(this.bams(from.rot[oa], from.rot[oa + 1], from.rot[oa + 2]))
        .slerp(this.bams(m.rot[ob], m.rot[ob + 1], m.rot[ob + 2]), w);
    } else {
      node.quaternion.copy(this.bams(m.rot[ob], m.rot[ob + 1], m.rot[ob + 2]));
    }
  }
  // The drawn pose is a mix of two tracks now, not one clip's frame.
  inst.drawnFrom = null;
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
  // The outgoing clip is a still -- the pose the engine snapshotted when the
  // fade began -- and the incoming one is held on its start frame; the port
  // advances neither clock until the fade is over (see `ActorAdvanceMotion`).
  // Weight goes 1/(fade+1) -> 1 onto the incoming one.
  //
  // This read the outgoing clock while the port still ran it, and the
  // `% frames` below wrapped a one-shot that had ended into its own first
  // pose: an emerging zombie dissolved from its emerge clip's first --
  // submerged -- frame and sank back into the water. The wrap is still right
  // for a looping clip's snapshot, whose cursor is not bounded; what fixed it
  // was stopping the clock.
  const pf = authoredFrameOfTicks(fade.ticks, pm.fps, pm.frames);
  const w = 1 - inst.a.fade / inst.a.fadeLen;
  this.applyBlend(inst, pm, pf, m, f, Math.min(1, Math.max(0, w)),
                  undefined, fade.records, fade.root);
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
                   mB: BakedMotion, fB: number, w: number,
                   full = (inst.a.motionFlags & MotionFlag.RootMotion) === 0,
                   overA?: readonly FadeRecord[], rootA?: FadeRoot):
    void {
  inst.drawnFrom = null;
  const ra = fA * 3;
  const rb = fB * 3;
  // The same two arms as `apply`, and the engine reaches them through the same
  // `if`: `SkeletonPoseRootFrame` (`FUN_00410920`) lerps the two tracks' root
  // translations into one triple at `model+0x6C..0x74` *before*
  // `SkeletonApplyRootMotion` sees it, so a blend is one root, not two.
  const lerp = (a: number, b: number): number => a + (b - a) * w;
  // A snapshot root the state wrote before it blended -- `model+0x6C..0x74`,
  // axis by axis -- is where the fade dissolves from. See `Actor.fadeFrom`.
  inst.pivot.position.set(
    full ? lerp(rootA?.x ?? mA.root[ra], mB.root[rb]) : 0,
    lerp(rootA?.y ?? mA.root[ra + 1], mB.root[rb + 1]),
    full ? lerp(rootA?.z ?? mA.root[ra + 2], mB.root[rb + 2]) : 0);

  const n = inst.type.bone_count;
  const ba = fA * n * 3;
  const bb = fB * n * 3;
  // Record 0 is the pivot's, and a state may have rewritten it too.
  const o0 = overA?.find((r) => r.record === 0);
  inst.pivot.quaternion
    .copy(o0 ? this.bams(o0.rot[0], o0.rot[1], o0.rot[2])
             : this.bams(mA.rot[ba], mA.rot[ba + 1], mA.rot[ba + 2]))
    .slerp(this.bams(mB.rot[bb], mB.rot[bb + 1], mB.rot[bb + 2]), w);

  for (const [bone, node] of inst.bones) {
    const oa = ba + bone * 3;
    const ob = bb + bone * 3;
    if (oa + 2 >= mA.rot.length || ob + 2 >= mB.rot.length) continue;
    // A record the state rewrote before it blended dissolves from what it
    // wrote -- see `Actor.fadeFrom`'s `records`.
    const o = overA?.find((r) => r.record === bone);
    node.quaternion
      .copy(o ? this.bams(o.rot[0], o.rot[1], o.rot[2])
              : this.bams(mA.rot[oa], mA.rot[oa + 1], mA.rot[oa + 2]))
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
 * The engine's translate sits **inside** `MatrixScale(model+0x116C)`, so a
 * character drawn at 0.9 offsets by 0.9 of what its clip authored. The offset
 * is written here as the clip authored it, and the scale reaches it the way
 * it reaches it on the engine's stack: the pose group is a child of the root,
 * and the character layer's `placeRoot` puts `Actor.scale` on the root. See
 * `game/root_motion.ts`.
 */
private apply(inst: Instance, m: BakedMotion, f: number,
              full = (inst.a.motionFlags & MotionFlag.RootMotion) === 0):
    void {

  inst.drawnFrom = { motion: m, frame: f };
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

/**
 * Pose a hierarchy with no `Actor` behind it: one clip, held on its last
 * frame, at a cursor in 60 Hz ticks. The player's body on the game-over
 * fly-over is the one caller -- `game/player_body.ts` holds its state, and it
 * is not an actor in the port's pool.
 *
 * `rootMotion` is `model+0x64` bit 1: with it up the pose keeps only the
 * clip root's height, because the horizontal part has already moved the body.
 */
poseHeld(target: Pick<Instance, "type" | "pivot" | "bones">, motion: number,
         ticks: number, rootMotion: boolean): boolean {
  const m = target.type.motions[String(motion)];
  if (!m || m.frames <= 0) return false;
  this.apply(target as Instance, m, authoredFrameHeld(ticks, m.fps, m.frames),
             !rootMotion);
  return true;
}

/**
 * {@link poseHeld}'s looping, cross-fading twin, for the route map's figures:
 * the clip at a cursor that wraps at its play length plus one
 * (`SkeletonAdvancePlayCursor`, `FUN_004111A0`), and while a fade is running
 * the snapshot it came from, weighted by `w` onto this one.
 */
poseLooped(target: Pick<Instance, "type" | "pivot" | "bones">,
           motion: number, ticks: number, rootMotion: boolean,
           from: { motion: number; ticks: number } | null = null,
           w = 1): boolean {
  const m = target.type.motions[String(motion)];
  if (!m || m.frames <= 0) return false;
  const frameOf = (mm: BakedMotion, t: number): number => {
    const play = mm.play ?? Math.max(1, mm.frames * 2 - 2);
    return authoredFrameHeld(t % (play + 1), mm.fps, mm.frames);
  };
  const f = frameOf(m, ticks);
  const pm = from ? target.type.motions[String(from.motion)] : undefined;
  if (pm && pm.frames > 0 && w < 1) {
    this.applyBlend(target as Instance, pm, frameOf(pm, from!.ticks), m, f,
                    Math.max(0, w), !rootMotion);
  } else {
    this.apply(target as Instance, m, f, !rootMotion);
  }
  return true;
}

/**
 * One bone posed as the clip has it this frame, but with its X rotation
 * replaced -- `SubModelPoseBoneHalfRate` (`FUN_0040ED30`) does exactly that
 * to character type 0x1D's jaw (bones 8 and 9) while the member dives. It
 * keeps the clip's Y and Z and writes its own X.
 */
overrideBoneX(inst: Instance, bone: number, rx: number): void {
  const m = inst.type.motions[String(inst.a.motion)];
  const node = inst.bones.get(bone);
  if (!m || m.frames <= 0 || !node) return;
  const f = authoredFrameOfTicks(inst.a.playTicks, m.fps, m.frames);
  const o = f * inst.type.bone_count * 3 + bone * 3;
  if (o + 2 >= m.rot.length) return;
  node.quaternion.copy(this.bams(rx, m.rot[o + 1], m.rot[o + 2]));
}

/**
 * The integer triple one bone was drawn with on the last pose -- the draw
 * record's `+0x04`/`+0x08`/`+0x0C`, which `FUN_00411700` writes as it rotates
 * the node and which a class's per-bone hook may read back.
 * `Class22DrawBonePart` (`FUN_0049D980`) is the reader: it turns two extra
 * models by node 3's and node 6's.
 *
 * From one clip it is that frame's three shorts, exactly, as the engine's
 * unblended arm has them. From a mix it is `MatrixToEulerZYX` (`FUN_004019E0`)
 * of the rotation this layer drew, which is what the engine's
 * interpolated arm also ends in; the mix itself is the poser's slerp. False
 * when the bone is not posed.
 */
drawnAngles(inst: Instance, bone: number,
            out: { rx: number; ry: number; rz: number }): boolean {
  const node = inst.bones.get(bone);
  if (!node) return false;
  const src = inst.drawnFrom;
  if (src) {
    const o = src.frame * inst.type.bone_count * 3 + bone * 3;
    if (o + 2 < src.motion.rot.length) {
      // `MOVSX` -- the frame's shorts, sign-extended.
      out.rx = (src.motion.rot[o] << 16) >> 16;
      out.ry = (src.motion.rot[o + 1] << 16) >> 16;
      out.rz = (src.motion.rot[o + 2] << 16) >> 16;
      return true;
    }
  }
  node.updateMatrix();
  const e = MatrixToEulerZYX(node.matrix.elements);
  out.rx = e.rx; out.ry = e.ry; out.rz = e.rz;
  return true;
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
