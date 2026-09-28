/**
 * Class 0x45's skinned models, kept as the engine keeps them.
 *
 * ## Why this class does not use the shared motion clock
 *
 * The port's `ActorAdvanceMotion` steps every visible actor's clip once a
 * frame and derives the cursor from the clock whenever it is asked. That is
 * the engine's behaviour for a class whose update steps `model[0]` on every
 * path. **This class does not**: `Boss3FightHeadUpdate` holds a dead head's
 * clip by not stepping it, the opening head steps only while its civilian is
 * being taken, the body's swim waits on a clip boundary -- and every routine
 * reads the play cursor and the clip-ended byte **as the last draw left
 * them**, after it may already have stepped the counter for the next frame.
 * A cursor derived afresh at the read is one frame out on exactly the tests
 * that fire cues (state 4's idle change, the death sounds at cursor 0x4B and
 * 0x70). So the class owns its clock (`ClassHandler.advancesOwnMotion`), and
 * the model's words live on the actor's tail at their offsets:
 *
 * * `Boss3ModelStep` is the `INC dword ptr [model]` every routine writes.
 * * `Boss3SetMotion` / `Boss3SetMotionBlended` are `ActorSetMotion`
 *   (`FUN_00411930`) and `ActorSetMotionBlended` (`FUN_004119A0`) on those
 *   words, including the pose snapshot a cross-fade dissolves from.
 * * `Boss3DrawModel` is what `DrawSkinnedModelAndShadow` (`FUN_00411090`)
 *   leaves in them: `SkeletonAdvancePlayCursor` (`FUN_004111A0`)'s cursor,
 *   end flag and fade end; every bone's angles as the per-node pose routine at
 *   `FUN_00411700` computes them, half-frame lerp and swing-twist blend
 *   included; `SkeletonApplyRootMotion` (`FUN_00410C50`)'s root; and the
 *   bone matrices, whose hit-sphere centres the class then reads back.
 *
 * `render/characters/boss3.ts` draws from the same words, so what is shot at,
 * tracked and drawn is one pose.
 */
import type { Boss3Actor } from "../actor";
import { MotionFlag } from "../actor";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixToEulerZYX, MatrixTransformPoint,
  MatrixTranslate, type Mat,
} from "../matrix";
import { ApplyRootMotion } from "../root_motion";
import { MatrixInterpolateSwingTwist, type Mat3 } from "../class44/swing_twist";
import { BoneHitCentre, CharacterTypeOf, MotionOf, MotionPlayLength }
  from "../tables";
import type { BakedMotion, CharacterBone } from "../../bundle";
import { BOSS3_MAX_BONES, Boss3PoseHook, type Boss3Tail } from "./state";

/** `model+0x37` bit 0 -- a cross-fade is running. */
export const TRACK_FADING = 0x01;
/** `model+0x37` bit 5 -- the pose is between two frames. */
export const TRACK_HALF_FRAME = 0x20;
/** `[0x004E1FE0]`, 32768.0, and `[0x004E1FDC]`, 65536.0 -- the short way round. */
const HALF_TURN = 32768;
const FULL_TURN = 65536;

/** The angles of one bone on one authored frame, or null past the data. */
function FrameAngles(m: BakedMotion, boneCount: number, f: number,
                     bone: number, out: number[], at: number): boolean {
  const ff = Math.max(0, Math.min(m.frames - 1, f));
  const o = (ff * boneCount + bone) * 3;
  if (o + 2 >= m.rot.length) return false;
  out[at] = m.rot[o];
  out[at + 1] = m.rot[o + 1];
  out[at + 2] = m.rot[o + 2];
  return true;
}

/** The root translation of one authored frame. */
function FrameRoot(m: BakedMotion, f: number,
                   out: { x: number; y: number; z: number }): void {
  const ff = Math.max(0, Math.min(m.frames - 1, f));
  out.x = m.root[ff * 3] ?? 0;
  out.y = m.root[ff * 3 + 1] ?? 0;
  out.z = m.root[ff * 3 + 2] ?? 0;
}

/**
 * `(float)(u16)(b - a)`, taken the short way round and scaled onto `a` --
 * the per-angle lerp `FUN_00411700`'s half-frame arm and `FUN_00412100` both
 * write, `FSUBR [0x004E1FDC]; FCHS` past 32768.0.
 */
function ShortLerp(a: number, b: number, w: number): number {
  let d = (b - a) & 0xffff;
  if (d > HALF_TURN) d = -(FULL_TURN - d);
  return Math.trunc(d * w + a);
}

/** Every bone's three angles from a frame, into a slot. */
function LoadSlotFromFrame(m: BakedMotion, boneCount: number,
                           f: number, slot: number[]): void {
  for (let b = 0; b < boneCount && b < BOSS3_MAX_BONES; b++) {
    FrameAngles(m, boneCount, f, b, slot, b * 3);
  }
}

/**
 * `ActorSetMotion` — as `FUN_00411930` writes the model: the clip, and the
 * counter, cursor and both frame words back to zero with the fade bytes
 * cleared, so nothing of the outgoing clip is left to blend from. When
 * `model+0x64` bit 1 is up it also seeds `SkeletonApplyRootMotion`'s
 * baseline from the new clip's frame 0 (`0x00411966`).
 *
 * `[port-only]` as a name: the port's own `ActorSetMotion` in
 * `class30/motion_cue.ts` writes the port's shared clock, which this class
 * does not run.
 */
export function Boss3SetMotion(obj: Boss3Actor, clip: number): void {
  const t = obj.boss3;
  obj.motion = clip;
  t.modelFrame = 0;
  t.cursor = 0;
  t.prevAuthored = 0;
  t.authored = 0;
  t.trackBits = 0;
  t.fadeLen = 0;
  obj.playTicks = 0;
  obj.fadeFrom = null;
  obj.fade = 0;
  obj.fadeLen = 0;
  if (obj.motionFlags & MotionFlag.RootMotion) {
    const m = MotionOf(obj, clip);
    if (m) FrameRoot(m, 0, t.rootBase);
  }
}

/**
 * `ActorSetMotionBlended` — as `FUN_004119A0` writes the model: the cursor
 * to `frame` and the authored frame to its half, the blend measured from one
 * before the current counter, the length `fade + 1`, bit 0 up and bit 5 down;
 * then `MotionStartOnTrack` (`FUN_004119F0`) loads the two slots. Slot A is
 * the pose **last drawn** (`MotionLoadPoseSlot` mode 0xC), slot B the new
 * clip's start: its frame, or one on when the cursor is odd and at the play
 * length, or -- `MotionStartBetweenFrames` (`FUN_00411F20`) -- the midpoint
 * of that frame and the next, each angle the short way round.
 *
 * The counter itself is **not** touched: the blend runs on it, and
 * `Boss3DrawModel` rewrites it to `cursor + 1` on the frame the blend ends.
 * `[port-only]` as a name: `ActorSetMotionBlended`'s writes, on the fields
 * this class keeps.
 */
export function Boss3SetMotionBlended(obj: Boss3Actor, clip: number,
                                      frame: number, fade: number): void {
  const t = obj.boss3;
  t.cursor = frame;
  t.authored = Math.trunc(frame / 2);
  t.fadeBase = t.modelFrame - 1;
  obj.motion = clip;
  t.fadeLen = fade + 1;
  t.trackBits = (t.trackBits & ~TRACK_HALF_FRAME) | TRACK_FADING;
  const m = MotionOf(obj, clip);
  const type = CharacterTypeOf(obj);
  const n = type?.bone_count ?? 0;
  const snapshot = (): void => {
    for (let i = 0; i < t.boneRot.length; i++) t.slotA[i] = t.boneRot[i];
    t.rootA.x = t.rootNow.x; t.rootA.y = t.rootNow.y; t.rootA.z = t.rootNow.z;
  };
  if (!m) { snapshot(); return; }
  const len = MotionPlayLength(obj, clip);
  const odd = (frame & 1) !== 0;
  if (odd && frame === len) {
    t.authored += 1;
    snapshot();
    LoadSlotFromFrame(m, n, t.authored, t.slotB);
    FrameRoot(m, t.authored, t.rootB);
    return;
  }
  if (!odd) {
    snapshot();
    LoadSlotFromFrame(m, n, t.authored, t.slotB);
    FrameRoot(m, t.authored, t.rootB);
    return;
  }
  // `MotionStartBetweenFrames`: slot A from `f`, slot B from `f + 1`, then
  // `FUN_00411F80` / `FUN_004120C0` put the midpoint into slot B (the root
  // by `(B - A) * 0.5 + A`, each angle by `FUN_00412100`'s short lerp) --
  // and only then is the drawn pose snapshotted into slot A.
  LoadSlotFromFrame(m, n, t.authored, t.slotA);
  LoadSlotFromFrame(m, n, t.authored + 1, t.slotB);
  FrameRoot(m, t.authored, t.rootA);
  FrameRoot(m, t.authored + 1, t.rootB);
  t.rootB.x = (t.rootB.x - t.rootA.x) * 0.5 + t.rootA.x;
  t.rootB.y = (t.rootB.y - t.rootA.y) * 0.5 + t.rootA.y;
  t.rootB.z = (t.rootB.z - t.rootA.z) * 0.5 + t.rootA.z;
  for (let i = 0; i < n * 3 && i < t.slotB.length; i++) {
    t.slotB[i] = ShortLerp(t.slotA[i], t.slotB[i], 0.5);
  }
  snapshot();
}

/**
 * `INC dword ptr [model]` -- the one step the class's routines write.
 * `[port-only]` as a function: each routine makes it inline.
 */
export function Boss3ModelStep(obj: Boss3Actor): void {
  obj.boss3.modelFrame += 1;
  obj.playTicks = obj.boss3.modelFrame;
}

/**
 * `SkeletonAdvancePlayCursor` — `FUN_004111A0`, on this class's words. The
 * end flag clears; a running cross-fade either holds the cursor, or -- on the
 * frame its span is spent -- rewrites the counter to `cursor + 1` and drops;
 * otherwise the cursor is `counter % (play_length + 1)`, and an odd cursor
 * short of the length loads frames `f` and `f + 1` (or 0) into the slots for
 * a half-frame blend.
 */
function Boss3AdvancePlayCursor(obj: Boss3Actor, m: BakedMotion,
                                boneCount: number): void {
  const t = obj.boss3;
  t.clipEnded = 0;
  const len = MotionPlayLength(obj, obj.motion);
  if (t.trackBits & TRACK_FADING) {
    const d = t.modelFrame - t.fadeBase;
    // `(char)model+0x30 + 1`: the blend's length plus two.
    const span = ((t.fadeLen << 24) >> 24) + 1;
    let hold = false;
    if (d <= span && d >= 0) {
      if (d !== span) hold = true;
      else t.modelFrame = t.cursor + 1;
    }
    if (!hold) t.trackBits &= ~TRACK_FADING;
  }
  if (!(t.trackBits & TRACK_FADING)) {
    t.cursor = len >= 0 ? t.modelFrame % (len + 1) : t.modelFrame;
    let f = Math.trunc(t.cursor / 2);
    t.authored = f;
    if ((t.cursor & 1) === 1) {
      if (t.cursor !== len) {
        let g = f + 1;
        if (Math.trunc(len / 2) < g) g = 0;
        LoadSlotFromFrame(m, boneCount, f, t.slotA);
        LoadSlotFromFrame(m, boneCount, g, t.slotB);
        FrameRoot(m, f, t.rootA);
        FrameRoot(m, g, t.rootB);
        t.trackBits |= TRACK_HALF_FRAME;
        t.fadeBase = t.modelFrame - 1;
        t.fadeLen = 2;
        if (len <= t.cursor) t.clipEnded = 1;
        return;
      }
      f += 1;
      t.authored = f;
    }
    t.trackBits &= ~TRACK_HALF_FRAME;
  }
  if (len <= t.cursor) t.clipEnded = 1;
}

/**
 * The pose `SkeletonPoseRootFrame` (`FUN_00410920`) and the per-node routine
 * at `FUN_00411700` leave: the root, and every bone's three angles into
 * `obj+0x20C + bone*0x90 + 4..0xC`. A frame's own angles; the short-way lerp
 * between two frames for a half frame; and for a cross-fade the two slots'
 * rotations turned `w` of the way by `MatrixInterpolateSwingTwist`
 * (`FUN_00412750`) and read back with `MatrixToEulerZYX` (`FUN_004019E0`).
 * The weight is `SkeletonResolveTrackFrames` (`FUN_00410BD0`)'s,
 * `(counter - fadeBase) / fadeLen`.
 */
function Boss3PoseAngles(obj: Boss3Actor, m: BakedMotion,
                         boneCount: number): void {
  const t = obj.boss3;
  const blending = (t.trackBits & (TRACK_FADING | TRACK_HALF_FRAME)) !== 0;
  if (!blending) {
    LoadSlotFromFrame(m, boneCount, t.authored, t.boneRot);
    FrameRoot(m, t.authored, t.rootNow);
    return;
  }
  const w = Math.fround((t.modelFrame - t.fadeBase) / (t.fadeLen || 1));
  t.rootNow.x = (t.rootB.x - t.rootA.x) * w + t.rootA.x;
  t.rootNow.y = (t.rootB.y - t.rootA.y) * w + t.rootA.y;
  t.rootNow.z = (t.rootB.z - t.rootA.z) * w + t.rootA.z;
  const swing = (t.trackBits & TRACK_FADING) !== 0
    || ((obj.motionFlags & 8) !== 0 && (t.trackBits & TRACK_HALF_FRAME) !== 0);
  const a = MatIdentity();
  const b = MatIdentity();
  const r = MatIdentity();
  for (let bone = 0; bone < boneCount && bone < BOSS3_MAX_BONES; bone++) {
    const o = bone * 3;
    if (!swing) {
      t.boneRot[o] = ShortLerp(t.slotA[o], t.slotB[o], w);
      t.boneRot[o + 1] = ShortLerp(t.slotA[o + 1], t.slotB[o + 1], w);
      t.boneRot[o + 2] = ShortLerp(t.slotA[o + 2], t.slotB[o + 2], w);
      continue;
    }
    RotZYX(a, t.slotA[o], t.slotA[o + 1], t.slotA[o + 2]);
    RotZYX(b, t.slotB[o], t.slotB[o + 1], t.slotB[o + 2]);
    const q = MatrixInterpolateSwingTwist(Mat3Of(a), Mat3Of(b), w);
    r[0] = q[0]; r[1] = q[1]; r[2] = q[2];
    r[4] = q[3]; r[5] = q[4]; r[6] = q[5];
    r[8] = q[6]; r[9] = q[7]; r[10] = q[8];
    const e = MatrixToEulerZYX(r);
    t.boneRot[o] = e.rx;
    t.boneRot[o + 1] = e.ry;
    t.boneRot[o + 2] = e.rz;
  }
}

/** A 4x4's rotation rows, as the 3x3 `class44/swing_twist.ts` works in. */
function Mat3Of(m: Mat): Mat3 {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
}

/** `LoadIdentity; RotateZ; RotateY; RotateX` -- a slot's rotation. */
function RotZYX(m: Mat, rx: number, ry: number, rz: number): void {
  for (let i = 0; i < 16; i++) m[i] = i % 5 === 0 ? 1 : 0;
  MatrixRotateZ(m, rz);
  MatrixRotateY(m, ry);
  MatrixRotateX(m, rx);
}

/**
 * `SkeletonApplyRootMotion` — `FUN_00410C50`: the damper on a jump of more
 * than a quarter of the play length, the baseline reset while a cross-fade
 * holds, and with `model+0x64` bit 1 the step of the actor by the root's
 * travel -- rotated and scaled as the actor is, through the port's
 * `ApplyRootMotion` -- after which the pose takes the root's height alone.
 * The translation the pose puts at bone 0 goes to `pivot`.
 */
function Boss3ApplyRootMotion(obj: Boss3Actor): void {
  const t = obj.boss3;
  const root = t.rootNow;
  const len = MotionPlayLength(obj, obj.motion);
  const jump = Math.abs(t.prevAuthored - t.authored);
  if (Math.trunc(len / 4) < jump && len > 0) {
    t.rootBase.x = (root.x - t.rootBase.x) / len + root.x;
    t.rootBase.y = (root.y - t.rootBase.y) / len + root.y;
    t.rootBase.z = (root.z - t.rootBase.z) / len + root.z;
  }
  if ((t.trackBits & TRACK_FADING) && !(t.trackBits & TRACK_HALF_FRAME)) {
    t.rootBase.x = root.x; t.rootBase.y = root.y; t.rootBase.z = root.z;
  }
  if (obj.motionFlags & MotionFlag.RootMotion) {
    ApplyRootMotion(obj, root.x - t.rootBase.x, root.z - t.rootBase.z);
    t.rootBase.x = root.x; t.rootBase.y = root.y; t.rootBase.z = root.z;
    t.pivot.x = 0; t.pivot.y = root.y; t.pivot.z = 0;
  } else {
    t.pivot.x = root.x; t.pivot.y = root.y; t.pivot.z = root.z;
  }
  t.prevAuthored = t.authored;
}

/**
 * `[port-only]` -- the state `DrawSkinnedModelAndShadow` (`FUN_00411090`)
 * leaves on the model, which is everything this class reads back from its
 * draw: the cursor and end flag, the angles, the root motion and the bone
 * matrices of the plain skeleton walk. The drawing itself is `render/`'s.
 */
export function Boss3DrawModel(obj: Boss3Actor): void {
  const m = MotionOf(obj, obj.motion);
  const type = CharacterTypeOf(obj);
  if (!m || !type) return;
  Boss3AdvancePlayCursor(obj, m, type.bone_count);
  Boss3PoseAngles(obj, m, type.bone_count);
  Boss3ApplyRootMotion(obj);
  obj.boss3.composed = false;
  Boss3PoseMatrices(obj, false);
  // The skeleton walk draws a node only through the pose hook, and the
  // heads' and the body's is `PoseHookNone`: they are drawn by
  // `Boss3DrawBoneParts` instead.
  if (obj.boss3.poseHook !== Boss3PoseHook.None) obj.boss3.drawn = true;
}

/** Bone `b`'s record in the bundle's list, and its parent's bone number. */
function BoneParent(bones: CharacterBone[], b: CharacterBone): number {
  return b.parent === null ? 0 : bones[b.parent]?.bone ?? 0;
}

const _mats: Mat[] = Array.from({ length: BOSS3_MAX_BONES }, () => MatIdentity());
const _p = { x: 0, y: 0, z: 0 };

/**
 * The bone matrices, in world space, and their origins and hit-sphere
 * centres into the tail. `composed` picks `Boss3ComposeBonePose`'s walk
 * (`0x004229CA`..`0x00422C10`) over the plain one:
 *
 * * **plain** -- `SkeletonApplyRootMotion`'s object matrix `T(pos) Rz Ry Rx
 *   S(scale) T(pivot)`, bone 0 `Rz Ry Rx` of its angles, and every node
 *   `T(offset) Rz Ry Rx` of its own;
 * * **composed** -- the composer's `T(pos) Rz Ry Rx`, then for bone 0 the
 *   root translation (heads only), and every node `T(offset)` and either the
 *   body's chain order `Rx Ry Rz` (bones below the weak one) or the extra
 *   rotation `Rz Ry Rx` and then the angles `Rz Ry Rx`.
 *
 * `MatrixStore(bone+0x28)` and `bone+0x68 = MatrixTransformPoint(bone+0x7C)`
 * are the origin and the point. The jaws hang off the weak bone in both
 * walks, which is the bundle's own parenting.
 * `[port-only]` as a function: the two walks' matrix products, shared.
 */
export function Boss3PoseMatrices(obj: Boss3Actor, composed: boolean): void {
  const t = obj.boss3;
  const type = CharacterTypeOf(obj);
  if (!type) return;
  const blk = t.block;
  const body = t.index === 8;
  const weak = blk?.weakBone ?? 0;
  const root = _mats[0];
  for (let i = 0; i < 16; i++) root[i] = i % 5 === 0 ? 1 : 0;
  MatrixTranslate(root, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateZ(root, obj.roll);
  MatrixRotateY(root, obj.yaw);
  MatrixRotateX(root, obj.pitch);
  if (!composed) {
    MatrixScale(root, obj.scale, obj.scale, obj.scale);
  }
  MatrixTranslate(root, t.pivot.x, t.pivot.y, t.pivot.z);
  BoneRotate(root, t, 0, composed, body, weak);
  WriteBone(t, 0, root, null);
  for (const b of type.bones) {
    if (b.bone >= BOSS3_MAX_BONES) continue;
    const m = _mats[b.bone];
    const parent = _mats[BoneParent(type.bones, b)];
    for (let i = 0; i < 16; i++) m[i] = parent[i];
    MatrixTranslate(m, b.offset[0], b.offset[1], b.offset[2]);
    BoneRotate(m, t, b.bone, composed, body, weak);
    WriteBone(t, b.bone, m, BoneHitCentre(obj, b));
  }
}

/** One node's rotation, in the order the walk that posed it uses. */
function BoneRotate(m: Mat, t: Boss3Tail, bone: number, composed: boolean,
                    body: boolean, weak: number): void {
  const o = bone * 3;
  const rx = t.boneRot[o], ry = t.boneRot[o + 1], rz = t.boneRot[o + 2];
  if (composed && body && bone < weak) {
    MatrixRotateX(m, rx);
    MatrixRotateY(m, ry);
    MatrixRotateZ(m, rz);
    return;
  }
  if (composed && t.block) {
    MatrixRotateZ(m, t.block.extraZ[bone]);
    MatrixRotateY(m, t.block.extraY[bone]);
    MatrixRotateX(m, t.block.extraX[bone]);
  }
  MatrixRotateZ(m, rz);
  MatrixRotateY(m, ry);
  MatrixRotateX(m, rx);
}

function WriteBone(t: Boss3Tail, bone: number, m: Mat,
                   centre: readonly number[] | null): void {
  const o = bone * 3;
  t.boneOrigin[o] = m[12];
  t.boneOrigin[o + 1] = m[13];
  t.boneOrigin[o + 2] = m[14];
  MatrixTransformPoint(m, { x: centre?.[0] ?? 0, y: centre?.[1] ?? 0,
                            z: centre?.[2] ?? 0 }, _p);
  t.bonePoint[o] = _p.x;
  t.bonePoint[o + 1] = _p.y;
  t.bonePoint[o + 2] = _p.z;
}
