/**
 * What a civilian's clip change does besides changing the clip.
 *
 * `CivilianRunScript`'s ops 0x00 and 0x01 write the new clip into
 * `model+0x20`, set the root-motion gate from the block's word, and then call
 * `CivilianApplyMotionPose` (`FUN_0048C310`) with the word the **previous**
 * block ran under and the start cursor. That routine is the whole of how a
 * civilian gets from one clip into the next: it may turn her, move her, rewrite
 * the pose the fade dissolves from, and it is what starts the clip -- with a
 * cross-fade `op 0x03` sets the length of.
 *
 * The port had none of it: the clip was swapped and its cursor zeroed, on a
 * note that the root walk "already carries a civilian where its clips say".
 * Stage 1's bin civilian (`0x3C38`, block 6) is where that stopped being true:
 * she climbs down off the bin on clip 611, whose root ends 15.4 units below
 * where it started, and the next block (`0x160100`) carries
 * {@link CivilianWait.HoldBone1} -- the arm that hands that height to the
 * actor. Without it she walked the rest of the scene at the height of the bin
 * lid.
 */
import type { Actor, FadeRecord } from "../actor";
import { MotionFrameOf, type MotionFrame } from "../actor_pose";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ActorByAt } from "../globals";
import type { GameHost } from "../host";
import {
  FtolS16, MatCopy, MatIdentity, MatrixGetTranslation, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixToEulerZYX, MatrixTransformPoint,
  MatrixTranslate, RADIANS_TO_BAMS, type Mat,
} from "../matrix";
import { CharacterTypeOf, MotionPlayFrame } from "../tables";
import { vec3 } from "../vec";
import { CivilianWait } from "./ops";

/** The skeleton record the heading is read off, beside the root's. */
const HEADING_RECORD = 1;
/**
 * The two records the counter-rotation rewrites: `model+0x10C` and
 * `model+0x58C`, the angle words of records 1 and 9 (`model+0x78 +
 * record*0x90 + 4`) -- `0x0048C712`..`0x0048C7BD`.
 */
const REBASED_RECORDS = [1, 9];
/** Where the drawn bone 1 is read: record 1, `model+0x130`. */
const HELD_BONE = 1;

const _z = vec3(0, 0, 1);
const _v = vec3();
const _p1 = vec3();
const _p2 = vec3();

/**
 * `(0, 0, 1)` through `RotZ RotY RotX(r0) RotZ RotY RotX(r1)`, as a BAMS
 * heading: `FPATAN(x, z) * g_rad_to_bams`, `__ftol`, `MOVSX` --
 * `0x0048C441`..`0x0048C471`. `[port-only]` as a function: the routine
 * writes it out twice.
 */
function RecordHeading(r0: [number, number, number],
                       r1: [number, number, number]): number {
  const m = MatIdentity();
  MatrixRotateZ(m, r0[2]);
  MatrixRotateY(m, r0[1]);
  MatrixRotateX(m, r0[0]);
  MatrixRotateZ(m, r1[2]);
  MatrixRotateY(m, r1[1]);
  MatrixRotateX(m, r1[0]);
  MatrixTransformPoint(m, _z, _v);
  return FtolS16(Math.atan2(_v.x, _v.z) * RADIANS_TO_BAMS);
}

/** `Push; RotZ RotY RotX(r); MatrixToEulerZYX; Pop` on `m`. */
function Rebased(m: Mat, r: [number, number, number]):
    [number, number, number] {
  const t = MatCopy(MatIdentity(), m);
  MatrixRotateZ(t, r[2]);
  MatrixRotateY(t, r[1]);
  MatrixRotateX(t, r[0]);
  const e = MatrixToEulerZYX(t);
  return [e.rx, e.ry, e.rz];
}

/**
 * `CivilianApplyMotionPose` — `FUN_0048C310`.
 *
 * `oldWord` is `CivilianRunScript`'s `EBX`, the word loaded before its loop --
 * the one the block now ending ran under. Every other bit is read off
 * `sub+0x00`, the new block's. `start` is the play cursor the clip starts on
 * (op 0x01's third operand, 0 for op 0x00). `motion` is the new clip, which
 * the engine has already written to `model+0x20`: the port's
 * `ActorSetMotionBlended` snapshots the outgoing one from `Actor.motion`, so
 * it travels as an argument until the blend has taken that snapshot.
 *
 * ```
 * f = MotionFrameAddress(type, model+0x20, start / 2)
 * if (sub & 0x18000)   yaw += heading(drawn records 0, 1) - heading(f's 0, 1)
 * if (sub & 0x20000) { pos += bone 1 drawn - bone 1 under f;  model+0x6C = f.root }
 * if (sub & 0x200000)  ActorSetMotionBlended(model, clip, start, 0)
 * else {
 *   if (sub & 0x8000)        records 1, 9 rebased by -turn about record 0
 *   else if (sub & 0x10000)  record 0 = f's record 0
 *   if (oldWord & 0x100000)  model+0x6C = f.root.x;  model+0x74 = f.root.z
 *   ActorSetMotionBlended(model, clip, start, sub+0xE)
 * }
 * ```
 *
 * **The listing stops too early** (L35): the `0x8000` arm's
 * `MatrixStackPop(1)` at `0x0048C767` is where Ghidra ends it and the
 * pseudocode returns, which would skip the blend. The bytes run on --
 * record 9's rewrite, then `JMP 0x0048C7F9` into the `0x100000` test and the
 * blend like every other arm. `[proved]`
 *
 * The drawn records (`model+0x7C`, `+0x10C`, `+0x58C`) are the outgoing clip
 * at the cursor the last draw left, as `Boss4StateTurnClipThenApproach` reads
 * them in the port -- the port draws whole authored frames. Bone 1's drawn
 * **position** is the renderer's, `GameHost.boneWorld`, as
 * `ActorShiftToHoldBone1Position` takes it: with no posed skeleton there is
 * no drawn bone to hold, and the actor stays where it is.
 *
 * What the arms write into the drawn records is what the fade dissolves from,
 * and in the port that is `Actor.fadeFrom`'s `records` and `root`, attached
 * once the blend has made the snapshot. A zero-length blend makes none, and
 * the first frame of the new clip is drawn at full weight: nothing is lost.
 *
 * **The start is a play cursor.** The engine's `ActorSetMotionBlended`
 * writes its third argument straight into `model+0x08` (`param_1[2] =
 * param_3` at `0x004119A0`, and `param_1[6] = param_3 / 2` beside it), and
 * the port's takes it the same way. The old clip-change here doubled op
 * 0x01's operand, and so started 21 of the shipped clips twice as far in as
 * the game does.
 */
export function CivilianApplyMotionPose(obj: Actor, oldWord: number,
                                        start: number, motion: number,
                                        host: GameHost): void {
  const sub = obj.civ;
  if (!sub) return;
  const word = sub.wait;
  // `MotionFrameAddress(type, model+0x20, start / 2)`: `CDQ; SUB EAX, EDX;
  // SAR EAX, 1` at `0x0048C325`, a signed halving toward zero.
  const f = MotionFrameOf(obj, motion, Math.trunc(start / 2));
  const drawn = MotionFrameOf(obj, obj.motion, MotionPlayFrame(obj) >> 1);
  let turn = 0;
  let root0: [number, number, number] | null = null;
  const root: { x?: number; y?: number; z?: number } = {};
  const records: FadeRecord[] = [];

  if ((word & (CivilianWait.TurnKeepBones | CivilianWait.TurnTakeRoot)) !== 0
      && f && drawn) {
    turn = RecordHeading(drawn.rot(0), drawn.rot(HEADING_RECORD))
      - RecordHeading(f.rot(0), f.rot(HEADING_RECORD));
    obj.yaw = (obj.yaw + turn) | 0;              // `ADD dword ptr [EAX+0x28], EBP`
  }

  if ((word & CivilianWait.HoldBone1) !== 0 && f) {
    CivilianHoldBone1(obj, f, host);
    root.x = f.root.x;
    root.y = f.root.y;
    root.z = f.root.z;
  }

  let blend = 0;
  if ((word & CivilianWait.Cut) === 0) {
    if ((word & CivilianWait.TurnKeepBones) !== 0) {
      if (drawn) {
        const r0 = drawn.rot(0);
        const m = MatIdentity();
        MatrixRotateX(m, -r0[0]);
        MatrixRotateY(m, -r0[1]);
        MatrixRotateZ(m, -r0[2]);
        MatrixRotateY(m, -turn);
        MatrixRotateZ(m, r0[2]);
        MatrixRotateY(m, r0[1]);
        MatrixRotateX(m, r0[0]);
        for (const r of REBASED_RECORDS) {
          records.push({ record: r, rot: Rebased(m, drawn.rot(r)) });
        }
      }
    } else if ((word & CivilianWait.TurnTakeRoot) !== 0 && f) {
      root0 = f.rot(0);
    }
    if ((oldWord & CivilianWait.RootMotion) !== 0 && f) {
      root.x = f.root.x;
      root.z = f.root.z;
    }
    blend = sub.motionBlend;
  }
  ActorSetMotionBlended(obj, motion, start, blend);
  // [port-only] The primitive refuses a clip the bundle did not bake, and
  // leaves the outgoing one playing; its fade is not this blend's.
  if (obj.motion !== motion) return;

  const fade = obj.fadeFrom;
  if (!fade) return;
  if (root0) records.push({ record: 0, rot: root0 });
  if (records.length > 0) {
    const kept = (fade.records ?? [])
      .filter((r) => !records.some((n) => n.record === r.record));
    fade.records = [...kept, ...records];
  }
  if (root.x !== undefined || root.y !== undefined || root.z !== undefined) {
    fade.root = { ...fade.root, ...root };
  }
}

/**
 * The `0x20000` arm, `0x0048C495`..`0x0048C668`: move the actor so that bone 1
 * of the new clip's start frame lands where the last draw put it.
 *
 * ```
 * P1 = translation(g_camera_blocks[g_camera_index] * model+0x130)   ; drawn
 * P2 = translation([carrier: T(c.pos) RotX RotZ RotY(c)]
 *                  T(pos) RotX(pitch) RotZ(roll) RotY(yaw)
 *                  T(s * f.root) RotZ RotY RotX(f's record 0)
 *                  T(s * node.offset))                               ; new
 * pos += P1 - P2
 * ```
 *
 * `ActorShiftToHoldBone1Position` (`FUN_0045CE70`) is class 0x30's copy of
 * the same thing, and differs in two places: this one scales both
 * translations by `model+0x116C`, and it puts a carrier's matrix under the
 * actor when her update is `CivilianUpdateOnCarrier` (`CMP dword ptr [EDX],
 * 0x48B140` at `0x0048C4F4`) -- `sub+0x68`'s position and `+0x64`/`+0x6C`/
 * `+0x68` angles. `node` is `g_character_skeletons[type]+0x18`'s first root
 * node (`MOV EBX, dword ptr [EAX + 0x18]` at `0x0048C4AC`), whose offset sits
 * at `+0x04..+0x0C`. `[proved]`
 *
 * `[port-only]` as a function: the engine writes the arm inline.
 */
function CivilianHoldBone1(obj: Actor, f: MotionFrame, host: GameHost): void {
  const t = CharacterTypeOf(obj);
  if (!t || !host.boneWorld(obj.at, HELD_BONE, _p1)) return;
  const node = t.bones[0]?.offset ?? [0, 0, 0];
  const s = obj.scale;
  const m = MatIdentity();
  if (obj.carrierAt >= 0) {
    const c = ActorByAt(obj.carrierAt);
    if (c) {
      MatrixTranslate(m, c.pos.x, c.pos.y, c.pos.z);
      MatrixRotateX(m, c.pitch);
      MatrixRotateZ(m, c.roll);
      MatrixRotateY(m, c.yaw);
    }
  }
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateX(m, obj.pitch);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixTranslate(m, Math.fround(s * f.root.x), Math.fround(f.root.y * s),
                  Math.fround(f.root.z * s));
  const r = f.rot(0);
  MatrixRotateZ(m, r[2]);
  MatrixRotateY(m, r[1]);
  MatrixRotateX(m, r[0]);
  MatrixTranslate(m, Math.fround(node[0] * s), Math.fround(node[1] * s),
                  Math.fround(node[2] * s));
  MatrixGetTranslation(m, _p2);
  obj.pos.x = Math.fround((_p1.x - _p2.x) + obj.pos.x);
  obj.pos.y = Math.fround((_p1.y - _p2.y) + obj.pos.y);
  obj.pos.z = Math.fround((_p1.z - _p2.z) + obj.pos.z);
}
