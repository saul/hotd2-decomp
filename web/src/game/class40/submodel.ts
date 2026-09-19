/**
 * The **sub-model** — a lightweight skeleton that lives in a side block.
 *
 * Every other skinned actor in the game carries its model at `obj+0x194`,
 * built by `ActorBuildSkinnedModel` and drawn by `SkeletonDrawWalk`. The horde
 * member does not. `HordeMemberInit` (`FUN_0043BEF0`) allocates a `0x504`-byte
 * side block and hands `side+0x70` to `SubModelInit` (`FUN_0040EAE0`), and
 * from then on the member is drawn by `SubModelDraw` (`FUN_0040F4F0`) — a
 * second, smaller copy of the skeleton code with its own clock, its own
 * blend, and per-bone records at `side+0xA4`. Only two routines in the image
 * ever call `SubModelInit`: this class's member Init and class 0x47's
 * `LoneHordeMemberInit47` (`FUN_0043D6E0`).
 *
 * ## What is here, and what is in `render/`
 *
 * The **clock** is here, because it is game state (`L7`): `SubModelAdvanceClock`
 * (`FUN_0040F610`) decides what frame is posed and when a blend is over, and
 * the frame counter it reads is stepped by the *caller* after each draw —
 * `HordeMemberUpdate` only steps it on the frames it draws, so a member in
 * `Hold` keeps the random phase `HordeMemberInit` gave it until it comes up.
 *
 * The **pose** is `render/`'s: `SubModelPoseRoot` (`FUN_0040EFB0`),
 * `SubModelWalkBonesHalfRate` (`FUN_0040F7B0`) and `SubModelPoseBoneHalfRate`
 * (`FUN_0040ED30`) read the clip at `play / 2` and turn it into matrices. The
 * port's character layer already poses a clip from a play cursor in the same
 * units, so {@link SubModelPublish} hands the clock over in the fields that
 * layer reads rather than building a second poser.
 *
 * ## The model record, `side+0x70`
 *
 * ```
 * +0x00  s32  frame -- stepped by the caller once per draw
 * +0x04  s32  play frame -- frame % g_motion_play_length[clip], or during a
 *                           blend the frame the new clip starts from
 * +0x08  s32  clip
 * +0x0C  s8   blend length, in frames
 * +0x0D  u8   flags: 1 blending, 2 wrapped, 4 blend just ended
 * +0x10..0x18 the root the blend starts from
 * +0x1E  s16  character type (side+0x8E)
 * +0x20  s32  bone walk mode -- SubModelInit writes 3 and nothing changes it
 * ```
 */
import type { Actor } from "../actor";
import { MotionPlayLength } from "../tables";

/** `model+0x0D`. */
export enum SubModelFlag {
  /** Blending from the snapshot toward the new clip. */
  Blending = 0x1,
  /** Never set by anything the horde runs: the modulo keeps it in range. */
  Wrapped = 0x2,
  /** The blend ended on this draw. */
  BlendEnded = 0x4,
}

/** `model+0x20 = 3` — `SubModelWalkBonesHalfRate`, the only mode ever set. */
export const SUBMODEL_MODE_HALF_RATE = 3;

/** One sub-model's clock. */
export interface SubModel {
  /** `+0x00`. */
  frame: number;
  /** `+0x04`. */
  play: number;
  /** `+0x08`. */
  clip: number;
  /** `+0x0C`, s8. */
  blendLen: number;
  /** `+0x0D`. */
  flags: number;
  /** `+0x20`. */
  mode: number;
  /**
   * `[port-only]` — the clip and play frame the snapshot was taken at.
   *
   * `SubModelSnapshotBone` (`FUN_0040F900`) copies every bone's *current
   * rotation* into the record, and `SubModelBlendToMotion` the root. The port
   * has no bone records in `game/`, so it keeps what those rotations were a
   * pose *of* — which is the same pose, and is what the character layer's
   * cross-fade reads.
   */
  fromClip: number;
  fromPlay: number;
}

/** [port-only] The zeroed side block. */
export function makeSubModel(): SubModel {
  return { frame: 0, play: 0, clip: 0, blendLen: 0, flags: 0, mode: 0,
           fromClip: 0, fromPlay: 0 };
}

/**
 * `SubModelInit` — `FUN_0040EAE0`. The clock half.
 *
 * `model+0x04 = model+0x00 = 0`, the blend length and flags to 0, the mode to
 * 3. The rest of the routine — `SubModelPoseRestFrame` (`FUN_0040EB40`)
 * posing frame 0 into the bone records, and `SubModelDrawBoneHook`
 * (`FUN_0040F490`) going into `obj+0x12EC` — is drawing, and the character
 * layer does both when it adopts the member. The clip at `+0x08` is the
 * caller's, written before the call.
 */
export function SubModelInit(m: SubModel): void {
  m.play = 0;
  m.frame = 0;
  m.blendLen = 0;
  m.flags = 0;
  m.mode = SUBMODEL_MODE_HALF_RATE;
}

/**
 * `SubModelSetMotion` — `FUN_0040F840`. A cut: clip, frame and play frame 0,
 * and `+0x1D` cleared. Any blend in flight is left flagged, exactly as the
 * routine leaves it.
 */
export function SubModelSetMotion(m: SubModel, clip: number): void {
  m.clip = clip;
  m.play = 0;
  m.frame = 0;
}

/**
 * `SubModelBlendToMotion` — `FUN_0040F860`. `(model, clip, start, blend)`.
 *
 * Snapshots the pose, then `frame = 1`, `play = start`, the clip, a blend
 * length of `blend + 1` and the blending bit. The horde always passes
 * `start 0, blend 4`: five draws from the frozen pose to the new clip's first
 * frame, and then the clip runs from 0.
 */
export function SubModelBlendToMotion(m: SubModel, clip: number,
                                      start: number, blend: number): void {
  m.fromClip = m.clip;
  m.fromPlay = m.play;
  m.frame = 1;
  m.play = start;
  m.clip = clip;
  m.blendLen = blend + 1;
  m.flags |= SubModelFlag.Blending;
}

/**
 * `SubModelAdvanceClock` — `FUN_0040F610`. Run once at the top of every draw.
 *
 * ```c
 * m+0x1D = 0;  m+0x0D &= 0xF9;
 * if (!(m+0x0D & 1)) {
 *     m+0x04 = m+0x00 % g_motion_play_length[m+0x08];
 *     if (g_motion_play_length[m+0x08] <= m+0x04) { m+0x1D = 1; m+0x0D |= 2; }
 * } else if ((s8)m+0x0C <= m+0x00) {
 *     m+0x00 = m+0x04;  m+0x0D = m+0x0D & 0xF8 | 4;
 * }
 * ```
 *
 * The frame is **not** stepped here; the caller does that after the draw.
 * `playLength` is `g_motion_play_length[clip]`, passed in because the table
 * lives with the actor's character type.
 */
export function SubModelAdvanceClock(m: SubModel, playLength: number): void {
  m.flags &= 0xf9;
  if ((m.flags & SubModelFlag.Blending) === 0) {
    // A clip the bundle cannot measure has a length of 0; the engine's
    // division would fault on it, so the port holds frame 0 instead.
    m.play = playLength > 0 ? m.frame % playLength : 0;
    if (playLength > 0 && playLength <= m.play) {
      m.flags |= SubModelFlag.Wrapped;
    }
  } else if (m.blendLen <= m.frame) {
    m.frame = m.play;
    m.flags = (m.flags & 0xf8) | SubModelFlag.BlendEnded;
  }
}

/**
 * `SubModelDraw` — `FUN_0040F4F0`, the game half.
 *
 * The routine is `MatrixStackPush; SubModelPoseAndEmitBones; MatrixStackPop`,
 * and the first thing `SubModelPoseAndEmitBones` (`FUN_0040F520`) does is
 * advance the clock. Everything after that is the pose, which the character
 * layer draws from what {@link SubModelPublish} leaves on the actor.
 */
export function SubModelDraw(obj: Actor, m: SubModel): void {
  SubModelAdvanceClock(m, MotionPlayLength(obj, m.clip));
  SubModelPublish(obj, m);
}

/**
 * `[port-only]` — the clock, in the fields the character layer poses from.
 *
 * `obj.motion`/`obj.playTicks` are the ordinary model's clip and cursor, in
 * the same half-frame units the sub-model counts in (`play / 2` is the posed
 * frame in both). A blend is the layer's cross-fade: from the snapshot's clip
 * and play frame, frozen, toward the new clip at `play`, weighted
 * `frame / blendLen` — which is `1 - fade / fadeLen` with
 * `fade = blendLen - frame`.
 *
 * Written after `ActorAdvanceMotion` has run for the frame, so what that
 * routine does to these fields is overwritten; it is kept from moving the
 * actor by `MotionFlag.RootMotion` being clear, which is also what makes the
 * layer apply the clip root as a pose offset — `SubModelApplyObjectTransform`
 * (`FUN_0040F220`)'s own arm when `model+0x20` bit `0x10` is clear.
 */
export function SubModelPublish(obj: Actor, m: SubModel): void {
  obj.motion = m.clip;
  obj.playTicks = m.play;
  if (m.flags & SubModelFlag.Blending) {
    obj.fadeFrom = { motion: m.fromClip, ticks: m.fromPlay };
    obj.fadeLen = m.blendLen;
    obj.fade = m.blendLen - m.frame;
  } else {
    obj.fadeFrom = null;
    obj.fade = 0;
  }
}
