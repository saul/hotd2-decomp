/**
 * The engine's skeletal pose, in `game/`: the model block at `obj+0x194` and
 * the routines that pose it — `SkeletonDrawWalk` (`FUN_004110D0`) and
 * everything under it.
 *
 * ## Why this exists
 *
 * The port poses characters in `render/` (three.js), and a class that reads a
 * bone matrix asks the renderer for one across `GameHost`. That is a frame
 * late at best and nothing at all headless. The stage-2 boss cannot live with
 * either: its weak point is a sphere and a cone on bone 1's matrix, its feet
 * pull its `y` onto the pier, its legs are solved against the ground under
 * them, and its deaths wait for bone 1 and bone 2 to reach the water. All of
 * that is gameplay, and all of it reads the pose **this frame's draw** put
 * in the bone records.
 *
 * So an actor may carry the engine's own model block ({@link SkeletonModel},
 * `Actor.skel`), and for such an actor the port does what the engine does:
 * the class's own update calls {@link DrawSkinnedModelAndShadow} where the
 * exe calls it, that call steps the play cursor, poses the root and every
 * bone, applies the clip's root motion to the actor and stores each bone's
 * matrix in its record — and the class then steps the frame counter itself.
 * `ActorSetMotion` and `ActorSetMotionBlended` (`class30/motion_cue.ts`)
 * write this block for such an actor. The director leaves its clock alone.
 * `render/` draws it from these matrices rather than posing it again.
 *
 * Class 0x14 is the only class that carries one today.
 *
 * ## Space
 *
 * The engine walks the skeleton with the camera's view matrix already on the
 * stack, so the records hold **view-space** matrices; every reader then
 * multiplies by `g_camera_blocks[cam]` (view to world) to get world space.
 * The port starts the walk from the identity instead, so the records hold the
 * world matrices those readers compute. Same numbers, one multiply fewer.
 *
 * Every routine here is `[proved]` from the instruction stream -- the pose
 * routines end their pseudocode early at `MatrixStackPop` (L35) and drop the
 * `__ftol` operands (L1), and both were read from the bytes. Only track 0 is
 * transcribed: track 1, the reaction track, belongs to classes 0x30 and 0x31,
 * which do not carry this block.
 */
import type { BakedMotion } from "../bundle";
import type { Actor } from "./actor";
import { MotionFlag } from "./actor";
import { MatrixInterpolateSwingTwist, type Mat3 } from "./class44/swing_twist";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixToEulerZYX, MatrixTransformPoint,
  MatrixTranslate, type Mat,
} from "./matrix";
import { CharacterTypeOf, MotionOf, MotionPlayLength } from "./tables";
import type { Vec3 } from "./vec";

/**
 * `model+0x37`, track 0's flag byte.
 */
export enum SkeletonTrackFlag {
  /**
   * Bit 0 — **a cross-fade is running.** `ActorSetMotionBlended` raises it;
   * while it is up the cursor does not move and the pose is slot A (the pose
   * last drawn) swung toward slot B (the new clip's start frame).
   * `Class14AdvanceMotionAndPublishPoints` skips its y-follow and leg IK
   * while it is up.
   */
  Fade = 0x01,
  /** Bit 5 — the cursor is odd: the pose is two authored frames at 0.5. */
  Between = 0x20,
}

/** One bone record, `model+0x78 + b*0x90`. */
export interface SkeletonBone {
  /** `+0x04..+0x0C` — the angles the last draw posed, (x, y, z) BAMS. */
  a: number[];
  /** `+0x10..+0x18` — slot A: the pose a fade or an odd cursor starts from. */
  sa: number[];
  /** `+0x1C..+0x24` — slot B: where it is going. */
  sb: number[];
  /**
   * `+0x28` — the node matrix, sixteen floats in `g_MatrixStackTop`'s
   * layout. **World** space here; see the note on space above. Bone 0 is the
   * root and never gets one — the engine never stores it.
   */
  mat: Mat;
}

/**
 * The model block, `obj+0x194` — the fields the pose reads and writes. The
 * character type (`+0x60`), the flag word (`+0x64`) and the scale
 * (`+0x116C`) are `Actor.charType`, `Actor.motionFlags` and `Actor.scale`.
 */
export interface SkeletonModel {
  /** `+0x00` — the frame counter. The owning class steps it. */
  counter: number;
  /** `+0x08` — the play cursor, `counter % (play_length + 1)`. */
  cursor: number;
  /** `+0x10` — the authored frame the last root-motion step was taken at. */
  prevFrame: number;
  /** `+0x18` — the authored frame, `cursor / 2`. */
  frame: number;
  /** `+0x20` — the motion. */
  motion: number;
  /** `+0x28` — the counter a fade (or an odd cursor's blend) is measured from. */
  weightOrigin: number;
  /** `+0x30` — its divisor: `fade + 1`, or 2 for an odd cursor. s8. */
  weightDiv: number;
  /** `+0x37` — {@link SkeletonTrackFlag}. */
  flags: number;
  /** `+0x44..+0x4C` — slot A's root translation. */
  rootA: number[];
  /** `+0x50..+0x58` — slot B's. */
  rootB: number[];
  /** `+0x6C..+0x74` — the root translation the last draw posed. */
  rootCur: number[];
  /**
   * `+0x68` — the order the actor's own rotation is applied in. Built as 5
   * (Z, Y, X); class 0x14 and the zombies write 1 (X, Z, Y).
   */
  order: number;
  /** `+0x1160..+0x1168` — the root-motion baseline. */
  baseline: number[];
  /** The bone records, indexed by bone. */
  bones: SkeletonBone[];
  /**
   * `[port-only]` — the matrix left on the stack after the root pose, the
   * frame bone 0 hangs every child from. The engine keeps it only on the
   * stack; the renderer needs it for bone 0's own part.
   */
  rootMat: Mat;
}

/** `[port-only]` A fresh block with `bones` records, as `ActorBuildSkinnedModel` zeroes it. */
export function MakeSkeletonModel(bones: number, order: number): SkeletonModel {
  return {
    counter: 0, cursor: 0, prevFrame: 0, frame: 0, motion: 0,
    weightOrigin: 0, weightDiv: 0, flags: 0,
    rootA: [0, 0, 0], rootB: [0, 0, 0], rootCur: [0, 0, 0],
    order, baseline: [0, 0, 0],
    bones: Array.from({ length: bones }, () => ({
      a: [0, 0, 0], sa: [0, 0, 0], sb: [0, 0, 0], mat: MatIdentity(),
    })),
    rootMat: MatIdentity(),
  };
}

/** The skeleton tree of the actor's type, from the bundle's bone table. */
interface SkeletonTree {
  boneCount: number;
  /** Bone -> its node offset, `node+4..+0xC`. */
  offset: number[][];
  /** Bone -> its children, in table order. Index 0 is the root's. */
  children: number[][];
}

const trees = new Map<string, SkeletonTree>();

/**
 * `[port-only]` The tree `g_character_skeletons[type]` describes, rebuilt
 * from the bundle's bone table: each row's `parent` is an index into the same
 * table, and `null` means the root (bone 0, which has no row).
 */
function TreeOf(obj: Actor): SkeletonTree | null {
  const type = CharacterTypeOf(obj);
  if (!type) return null;
  const key = `${type.type}`;
  const hit = trees.get(key);
  if (hit && hit.boneCount === type.bone_count) return hit;
  const n = type.bone_count;
  const offset = Array.from({ length: n }, () => [0, 0, 0]);
  const children: number[][] = Array.from({ length: n }, () => []);
  for (const b of type.bones) {
    if (b.bone < 0 || b.bone >= n) continue;
    offset[b.bone] = [b.offset[0], b.offset[1], b.offset[2]];
    const parent = b.parent === null ? 0 : (type.bones[b.parent]?.bone ?? 0);
    children[parent].push(b.bone);
  }
  const tree = { boneCount: n, offset, children };
  trees.set(key, tree);
  return tree;
}

/** A frame's root translation: `frame+0..+8`. */
function FrameRoot(m: BakedMotion, f: number): number[] {
  const i = Math.max(0, Math.min(m.frames - 1, f)) * 3;
  return [m.root[i] ?? 0, m.root[i + 1] ?? 0, m.root[i + 2] ?? 0];
}

/** A frame's bone angles: `frame+0xC + 6b`, three s16. */
function FrameAngles(m: BakedMotion, bones: number, f: number,
                     b: number): number[] {
  const i = (Math.max(0, Math.min(m.frames - 1, f)) * bones + b) * 3;
  return [m.rot[i] ?? 0, m.rot[i + 1] ?? 0, m.rot[i + 2] ?? 0];
}

/**
 * The shared angle blend the pose routines inline at four sites
 * (`SkeletonPoseRootFrame` `0x00410A8F`, `FUN_00411700` `0x0041179C`,
 * `FUN_00411F80` and `FUN_00412100`):
 *
 * ```
 * d = (u16)((u16)B - (u16)A)          ; low words
 * x = d > 32768 ? -(65536 - d) : d    ; FCOM [0x004E1FE0]
 * x = f32(x * w); x = f32(x + A)      ; FIADD the full int32 A
 * return ftol(x)                      ; int32, no 16-bit wrap
 * ```
 *
 * `[port-only]` as a function.
 */
function LerpAngle(A: number, B: number, w: number): number {
  const d = ((B & 0xffff) - (A & 0xffff)) & 0xffff;
  let x = d;
  if (x > 32768) x = -(65536 - x);
  x = Math.fround(x * w);
  x = Math.fround(x + A);
  return Math.trunc(x) | 0;
}

/** The root translation blend: `f32(f32(f32(B - A) * w) + A)`. */
function LerpRoot(A: number[], B: number[], w: number): number[] {
  return [0, 1, 2].map((c) => Math.fround(
    Math.fround(Math.fround(B[c] - A[c]) * w) + A[c]));
}

/** `MatrixLoadIdentity; RotZ(a2); RotY(a1); RotX(a0)` as a 3x3. */
function RotationZYX(a: number[]): Mat3 {
  const m = MatIdentity();
  MatrixRotateZ(m, a[2]);
  MatrixRotateY(m, a[1]);
  MatrixRotateX(m, a[0]);
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
}

/**
 * Slot A swung toward slot B by `w` —
 * `MatrixInterpolateSwingTwist(Am, Bm, w); MatrixToEulerZYX(&a0, &a1, &a2)`.
 */
function SwingTwistAngles(A: number[], B: number[], w: number): number[] {
  const r = MatrixInterpolateSwingTwist(RotationZYX(A), RotationZYX(B), w);
  const m4 = [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0,
              r[6], r[7], r[8], 0, 0, 0, 0, 1];
  const e = MatrixToEulerZYX(m4);
  return [e.rx, e.ry, e.rz];
}

/**
 * `MotionLoadPoseSlot` — `FUN_00411C20`, for track 0 with no subtree bone:
 * mode 0 writes the current pose, 1 slot A, 2 slot B, and 0xC copies the
 * current pose into slot A (the fade's snapshot). Every bone is walked,
 * `MotionWriteBoneAngles` (`FUN_00411D70`) through `SkeletonWalkBoneAngles`
 * (`FUN_00411EC0`) and bone 0 after them.
 */
export function MotionLoadPoseSlot(obj: Actor, skel: SkeletonModel,
                                   mode: number, motion: number,
                                   frame: number): void {
  if (mode === 0xc) {
    skel.rootA = [...skel.rootCur];
    for (const b of skel.bones) b.sa = [...b.a];
    return;
  }
  const m = MotionOf(obj, motion);
  const tree = TreeOf(obj);
  if (!m || !tree) return;
  const root = FrameRoot(m, frame);
  if (mode === 0) skel.rootCur = root;
  else if (mode === 1) skel.rootA = root;
  else if (mode === 2) skel.rootB = root;
  for (let b = 0; b < skel.bones.length; b++) {
    const ang = FrameAngles(m, tree.boneCount, frame, b);
    if (mode === 0) skel.bones[b].a = ang;
    else if (mode === 1) skel.bones[b].sa = ang;
    else if (mode === 2) skel.bones[b].sb = ang;
  }
}

/**
 * `MotionStartBetweenFrames` — `FUN_00411F20`. A blended start on an odd
 * cursor: slot A and B load frames `f` and `f+1`, then `FUN_00411F80` moves
 * slot B's root and bone 0 to the midpoint and `FUN_004120C0` does the same
 * for the root's direct children (and no deeper). The matrix work both do is
 * pushed and popped, so only the slot writes survive.
 */
function MotionStartBetweenFrames(obj: Actor, skel: SkeletonModel,
                                  motion: number, f: number): void {
  MotionLoadPoseSlot(obj, skel, 1, motion, f);
  MotionLoadPoseSlot(obj, skel, 2, motion, f + 1);
  skel.rootB = LerpRoot(skel.rootA, skel.rootB, 0.5);
  const b0 = skel.bones[0];
  if (b0) b0.sb = [0, 1, 2].map((i) => LerpAngle(b0.sa[i], b0.sb[i], 0.5));
  const tree = TreeOf(obj);
  for (const c of tree?.children[0] ?? []) {
    const b = skel.bones[c];
    if (b) b.sb = [0, 1, 2].map((i) => LerpAngle(b.sa[i], b.sb[i], 0.5));
  }
}

/**
 * `MotionStartOnTrack` — `FUN_004119F0`, track 0, no subtree bone. What a
 * blended start loads, by the parity of the start cursor.
 */
export function MotionStartOnTrack(obj: Actor, skel: SkeletonModel,
                                   motion: number): void {
  const c = skel.cursor;
  const par = c % 2;
  const L = MotionPlayLength(obj, skel.motion);
  if (par === 1 && c === L) {
    skel.frame += 1;
    MotionLoadPoseSlot(obj, skel, 0xc, 0, 0);
    MotionLoadPoseSlot(obj, skel, 2, motion, skel.frame);
  } else if (par === 0) {
    MotionLoadPoseSlot(obj, skel, 0xc, 0, 0);
    MotionLoadPoseSlot(obj, skel, 2, motion, skel.frame);
  } else {
    MotionStartBetweenFrames(obj, skel, motion, skel.frame);
    MotionLoadPoseSlot(obj, skel, 0xc, 0, 0);
  }
}

/**
 * `[port-only]` — `ActorSetMotion`'s (`FUN_00411930`) body for an actor that
 * carries the model block. `class30/motion_cue.ts` owns the function and
 * calls this for such an actor.
 *
 * ```
 * M[0x20]=motion; M[0]=0; M[0x10]=0; M[0x18]=0; M[0x08]=0; M[0x37]=0; M[0x36]=0
 * SkeletonAssignSubtreeTrack(0, 0)                 ; every bone on track 0
 * if (M[0x64] & 2) M[0x1160..] = frame 0's root    ; the root-motion baseline
 * ```
 */
export function SkeletonModelSetMotion(obj: Actor, skel: SkeletonModel,
                                       motion: number): void {
  skel.motion = motion;
  skel.counter = 0;
  skel.prevFrame = 0;
  skel.frame = 0;
  skel.cursor = 0;
  skel.flags = 0;
  if (obj.motionFlags & MotionFlag.RootMotion) {
    const m = MotionOf(obj, motion);
    if (m) skel.baseline = FrameRoot(m, 0);
  }
  obj.motion = motion;
  obj.playTicks = 0;
}

/**
 * `[port-only]` — `ActorSetMotionBlended`'s (`FUN_004119A0`) body for an
 * actor that carries the model block. `start` is **the engine's own
 * argument, a play cursor** (60 Hz), not the authored frame the function's
 * other callers pass: it lands in `M[0x08]` as it is and in `M[0x18]` halved.
 *
 * ```
 * M[0x08]=start; M[0x18]=start/2; M[0x28]=M[0]-1; M[0x20]=motion
 * M[0x30]=fade+1; M[0x37]=(M[0x37] & ~0x20) | 1
 * MotionStartOnTrack(M, 0, motion, 0)
 * ```
 *
 * The counter is **not** reset: the fade is measured as `M[0] - M[0x28]`.
 */
export function SkeletonModelSetMotionBlended(obj: Actor, skel: SkeletonModel,
                                              motion: number, start: number,
                                              fade: number): void {
  skel.cursor = start;
  skel.frame = Math.trunc(start / 2);
  skel.weightOrigin = skel.counter - 1;
  skel.motion = motion;
  // `MOV byte ptr [M+0x30], AL` with `AL = fade + 1`, read back as s8.
  skel.weightDiv = (((fade + 1) & 0xff) << 24) >> 24;
  skel.flags = (skel.flags & ~SkeletonTrackFlag.Between)
    | SkeletonTrackFlag.Fade;
  MotionStartOnTrack(obj, skel, motion);
  obj.motion = motion;
}

/**
 * `SkeletonAdvancePlayCursor` — `FUN_004111A0`. The cursor from the counter,
 * and which frames the pose is built from.
 */
function SkeletonAdvancePlayCursor(obj: Actor, skel: SkeletonModel): void {
  if (skel.flags & SkeletonTrackFlag.Fade) {
    const d = skel.counter - skel.weightOrigin;
    const lim = skel.weightDiv + 1;
    if (d > lim || d < 0) {
      skel.flags &= ~SkeletonTrackFlag.Fade;
    } else if (d === lim) {
      // The fade is over: the clip plays on from the frame after its start.
      skel.counter = skel.cursor + 1;
      skel.flags &= ~SkeletonTrackFlag.Fade;
    }
  }
  if (skel.flags & SkeletonTrackFlag.Fade) return;
  const L = MotionPlayLength(obj, skel.motion);
  const c = L >= 0 ? skel.counter % (L + 1) : skel.counter;
  skel.cursor = c;
  const f = Math.trunc(c / 2);
  skel.frame = f;
  if (c % 2 === 1 && c !== L) {
    let fA = f;
    let fB = f + 1;
    if (fA < 0) fA = Math.trunc(L / 2);
    if (fB > Math.trunc(L / 2)) fB = 0;
    MotionLoadPoseSlot(obj, skel, 1, skel.motion, fA);
    MotionLoadPoseSlot(obj, skel, 2, skel.motion, fB);
    skel.flags |= SkeletonTrackFlag.Between;
    skel.weightOrigin = skel.counter - 1;
    skel.weightDiv = 2;
    return;
  }
  if (c % 2 === 1) skel.frame = f + 1;
  skel.flags &= ~SkeletonTrackFlag.Between;
  MotionLoadPoseSlot(obj, skel, 0, skel.motion, skel.frame);
}

/**
 * `SkeletonResolveTrackFrames` — `FUN_00410BD0`, track 0: the blend weight,
 * `g_motion_fade_weight[0]` (`0x007C1C24`), when a fade or an odd cursor is
 * up. Returned rather than kept in a global -- nothing reads it outside the
 * one draw that computes it.
 */
function SkeletonResolveTrackFrames(skel: SkeletonModel): number {
  if (!(skel.flags & (SkeletonTrackFlag.Fade | SkeletonTrackFlag.Between))) {
    return 0;
  }
  return Math.fround((skel.counter - skel.weightOrigin) / skel.weightDiv);
}

/**
 * `SkeletonApplyRootMotion` — `FUN_00410C50`. The clip's root step moves the
 * actor (`model+0x64` bit 2), and the actor's own transform goes on the
 * stack.
 */
function SkeletonApplyRootMotion(obj: Actor, skel: SkeletonModel, T: number[],
                                 top: Mat): void {
  const L = MotionPlayLength(obj, skel.motion);
  // The damper: a jump of more than a quarter clip (a loop wrap) steps the
  // baseline toward T by a clip's worth instead of taking the whole jump.
  if (Math.abs(skel.prevFrame - skel.frame) > Math.trunc(L / 4)) {
    skel.baseline = [0, 1, 2].map((c) => Math.fround(
      Math.fround(Math.fround(T[c] - skel.baseline[c]) / L) + T[c]));
  }
  if ((skel.flags & SkeletonTrackFlag.Fade)
      && !(skel.flags & SkeletonTrackFlag.Between)) {
    skel.baseline = [...T];
  }
  if (obj.motionFlags & MotionFlag.RootMotion) {
    const m = MatIdentity();
    MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
    MatrixRotateZ(m, obj.roll);
    MatrixRotateY(m, obj.yaw);
    MatrixRotateX(m, obj.pitch);
    MatrixScale(m, obj.scale, obj.scale, obj.scale);
    const d = { x: Math.fround(T[0] - skel.baseline[0]),
                y: Math.fround(T[1] - skel.baseline[1]),
                z: Math.fround(T[2] - skel.baseline[2]) };
    const out = { x: 0, y: 0, z: 0 };
    MatrixTransformPoint(m, d, out);
    obj.pos.x = Math.fround(out.x);
    obj.pos.z = Math.fround(out.z);
    if (obj.motionFlags & MotionFlag.RootMotionY) {
      obj.pos.y = Math.fround(out.y);
    }
    skel.baseline = [...T];
  }
  // `M[0x115C]()`, the pose hook: `PoseHookNone` for every class that
  // carries this block.
  skel.prevFrame = skel.frame;
  MatrixTranslate(top, obj.pos.x, obj.pos.y, obj.pos.z);
  switch (skel.order) {
    case 0:
      MatrixRotateX(top, obj.pitch); MatrixRotateY(top, obj.yaw);
      MatrixRotateZ(top, obj.roll); break;
    case 1:
      MatrixRotateX(top, obj.pitch); MatrixRotateZ(top, obj.roll);
      MatrixRotateY(top, obj.yaw); break;
    case 2:
      MatrixRotateY(top, obj.yaw); MatrixRotateX(top, obj.pitch);
      MatrixRotateZ(top, obj.roll); break;
    case 3:
      MatrixRotateY(top, obj.yaw); MatrixRotateZ(top, obj.roll);
      MatrixRotateX(top, obj.pitch); break;
    case 4:
      MatrixRotateZ(top, obj.roll); MatrixRotateX(top, obj.pitch);
      MatrixRotateY(top, obj.yaw); break;
    default:
      MatrixRotateZ(top, obj.roll); MatrixRotateY(top, obj.yaw);
      MatrixRotateX(top, obj.pitch); break;
  }
  MatrixScale(top, obj.scale, obj.scale, obj.scale);
  if (obj.motionFlags & MotionFlag.RootMotion) {
    MatrixTranslate(top, 0, T[1], 0);
  } else {
    MatrixTranslate(top, T[0], T[1], T[2]);
  }
}

/**
 * `SkeletonPoseRootFrame` — `FUN_00410920`. The root: its translation (the
 * frame's, the odd cursor's midpoint or the fade's lerp), the root motion,
 * the actor's transform and bone 0's rotation.
 *
 * The cross-fade arm's pseudocode ends on `MatrixStackPop; return` and it
 * does not: `JMP 0x00410B52` into the common tail (L35), which is why a fade
 * still stores `+0x6C` and still runs the root motion.
 */
function SkeletonPoseRootFrame(obj: Actor, skel: SkeletonModel, top: Mat,
                               w: number): void {
  const b0 = skel.bones[0];
  let T: number[];
  let a: number[];
  if (!(skel.flags & (SkeletonTrackFlag.Fade | SkeletonTrackFlag.Between))) {
    const m = MotionOf(obj, skel.motion);
    const tree = TreeOf(obj);
    T = m ? FrameRoot(m, skel.frame) : [...skel.rootCur];
    a = m && tree ? FrameAngles(m, tree.boneCount, skel.frame, 0)
      : [...(b0?.a ?? [0, 0, 0])];
  } else {
    T = LerpRoot(skel.rootA, skel.rootB, w);
    if (skel.flags & SkeletonTrackFlag.Fade) {
      a = b0 ? SwingTwistAngles(b0.sa, b0.sb, w) : [0, 0, 0];
    } else {
      // An odd cursor alone: linear, whatever `model+0x64` bit 8 says.
      a = b0 ? [0, 1, 2].map((i) => LerpAngle(b0.sa[i], b0.sb[i], w))
        : [0, 0, 0];
    }
  }
  skel.rootCur = [...T];
  SkeletonApplyRootMotion(obj, skel, T, top);
  if (b0) b0.a = [...a];
  MatrixRotateZ(top, a[2]);
  MatrixRotateY(top, a[1]);
  MatrixRotateX(top, a[0]);
}

/**
 * `SkeletonEmitNode` — `FUN_004114C0`, with its per-node transform
 * `FUN_00411700` inlined: `MatrixTranslate(node offset)`, the node's angles
 * (the frame's, or slot A to B by swing-twist during a fade -- and for an odd
 * cursor too when `model+0x64` bit 8 is set -- or by the linear blend), then
 * `RotZ RotY RotX`, and the result stored in the record.
 *
 * The draw hook, the hit-centre (`+0x68`) and the tracked bone's view-space
 * copy are the draw's; the one of them gameplay reads is the camera point,
 * `obj+0x100`, which the tracked bone writes -- bone 1 for every character
 * type from 0x15 up -- and only while the node is drawn.
 */
function SkeletonEmitNode(obj: Actor, skel: SkeletonModel, tree: SkeletonTree,
                          bone: number, parent: Mat, w: number): void {
  const R = skel.bones[bone];
  if (!R) return;
  const top = MatCopy(MatIdentity(), parent);
  const off = tree.offset[bone];
  MatrixTranslate(top, off[0], off[1], off[2]);
  let a: number[];
  const fl = skel.flags;
  if (!(fl & (SkeletonTrackFlag.Fade | SkeletonTrackFlag.Between))) {
    const m = MotionOf(obj, skel.motion);
    a = m ? FrameAngles(m, tree.boneCount, skel.frame, bone) : [...R.a];
  } else if ((fl & SkeletonTrackFlag.Fade) || (obj.motionFlags & 8)) {
    a = SwingTwistAngles(R.sa, R.sb, w);
  } else {
    a = [0, 1, 2].map((i) => LerpAngle(R.sa[i], R.sb[i], w));
  }
  MatrixRotateZ(top, a[2]);
  MatrixRotateY(top, a[1]);
  MatrixRotateX(top, a[0]);
  R.a = a;
  MatCopy(R.mat, top);
  // `CMP [R], 0` (the record has a slot) `&& model+0x64 & 1` (drawn): the
  // tracked bone's world translation into `obj+0x100`. Bone 1 for a type
  // outside 0..0x14; the humanoid rules for 2 and 9 do not apply.
  if (bone === SKELETON_TRACKED_BONE && (obj.motionFlags & 1)
      && obj.charType >= 0x15) {
    MatrixGetTranslation(top, obj.lookAt);
  }
  for (const c of tree.children[bone]) {
    SkeletonEmitNode(obj, skel, tree, c, top, w);
  }
}

/** `sVar3 = 1` in `SkeletonEmitNode` for a type outside 0..0x14. */
const SKELETON_TRACKED_BONE = 1;

/**
 * `SkeletonDrawWalk` — `FUN_004110D0`, its pose half: the cursor, the root,
 * every node the root's children reach. The root node's own offset is never
 * applied and bone 0 gets no matrix -- the walk starts at its children.
 *
 * The part loop (`BuildCharacterPart`/`DrawCharacterPart`) and the
 * attachment hook are the renderer's.
 */
function SkeletonDrawWalk(obj: Actor, skel: SkeletonModel): void {
  const tree = TreeOf(obj);
  if (!tree) return;
  SkeletonAdvancePlayCursor(obj, skel);
  const w = SkeletonResolveTrackFrames(skel);
  const top = MatIdentity();
  SkeletonPoseRootFrame(obj, skel, top, w);
  MatCopy(skel.rootMat, top);
  for (const c of tree.children[0]) SkeletonEmitNode(obj, skel, tree, c, top, w);
}

/**
 * `DrawSkinnedModelAndShadow` — `FUN_00411090`. `MatrixStackPush;
 * SkeletonDrawWalk; MatrixStackPop; ActorDrawShadow` -- the pose, and a
 * shadow the renderer draws. Does nothing for an actor without the block.
 */
export function DrawSkinnedModelAndShadow(obj: Actor): void {
  if (!obj.skel) return;
  SkeletonDrawWalk(obj, obj.skel);
  obj.motion = obj.skel.motion;
}

/**
 * `[port-only]` A bone's world matrix as the last draw left it, or null for
 * bone 0 and for an actor that does not carry the block.
 */
export function SkeletonBoneMatrix(obj: Actor, bone: number): Mat | null {
  if (!obj.skel || bone <= 0) return null;
  return obj.skel.bones[bone]?.mat ?? null;
}

/** `[port-only]` A point in a bone's own frame, in world space. */
export function SkeletonBonePoint(obj: Actor, bone: number, local: Vec3,
                                  out: Vec3): boolean {
  const m = SkeletonBoneMatrix(obj, bone);
  if (!m) return false;
  MatrixTransformPoint(m, local, out);
  return true;
}
