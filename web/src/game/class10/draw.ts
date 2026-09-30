/**
 * Class 0x10's node draw hook: the head that turns to look, and the mouth.
 *
 * `CivilianInit` (`FUN_0048A3E0`) writes `0x0048D1F0` into `model+0x1158` at
 * `0x0048A60B`, and `SkeletonEmitNode` (`FUN_004114C0`) calls it for every
 * node it draws, after it has stored the node's posed matrix in the record's
 * `+0x28`. Ghidra had no function there, so nothing named it and the port had
 * neither half: a civilian's head faced wherever her clip left it, and her
 * mouth never moved while she spoke.
 *
 * ## Where each half lives
 *
 * The routine decides, and it draws. What it decides is state -- the mode at
 * `sub+0x8C`, its target at `sub+0x90`, the three angles at `sub+0x94..0x9C`,
 * the mouth's cursor, count and table at `sub+0xA0..0xA8` -- and it is here,
 * run from `CivilianUpdate` where the engine's draw runs it. What it draws is
 * `render/characters/civilian_head.ts`: the matrix it rebuilds for bone 2,
 * the slot it adds the mouth's byte to, and the Original Mode scale. The
 * frame's decision crosses as `CivilianState.headTurned`, `.mouthOffset` and
 * `.partScale`, reset before each walk.
 *
 * The pose is the renderer's, so the two bone matrices the head arm reads
 * come across `GameHost`: bone 1's record as drawn, and bone 2's **as posed**
 * -- `bonePoseMatrix`, the matrix `SkeletonEmitNode` stored before calling
 * the hook, which is the one the hook reads and not the one it leaves.
 */
import { ActorFlag, type Actor } from "../actor";
import { CameraBlockWorldToView, RotationOf } from "../camera/view";
import { CarrierMatrixCompose, MatrixGetAngles } from "../carrier";
import { ActorLiveBit } from "../combat/rank";
import { GameMode } from "../game_mode";
import { ActorByAt, G } from "../globals";
import {
  FtolS16, MatIdentity, MatrixInvert, MatrixMultiply, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixTransformPoint, MatrixTranslate,
  type Mat,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { T } from "../tables";
import { VecToAngles, vec3 } from "../vec";
import { CIVILIAN_MOUTH_NONE, CivilianHeadMode } from "./ops";

/** `CMP word ptr [EAX + 0x14], ...`, the switch's bone 2: the head. */
export const CIVILIAN_HEAD_BONE = 2;
/** `g_skeleton_node_out + 0xB8` = bone 1's record `+0x28`: the head's parent. */
export const CIVILIAN_HEAD_PARENT_BONE = 1;
/**
 * The byte map at `0x0048D984`: `bone - 2` of 3, 6, 10 and 13 send bones 5,
 * 8, 12 and 15 to `0x0048D902`, the Original Mode `MatrixScale(2, 2, 2)`.
 */
export const CIVILIAN_SCALED_BONES: readonly number[] = [5, 8, 12, 15];
/** `FADD float ptr [0x004C4398]` -- mode 1's lift above the gameplay eye. */
const HEAD_EYE_RISE = 15.0;
/** `FSUB float ptr [0x004C4CB8]` -- 1.5 off the aim vector's y. */
const HEAD_AIM_DROP = 1.5;
/** `CMP AX, 0x1800` / `CMP AX, 0xE000` -- the pitch's reach, down and up. */
const HEAD_PITCH_MAX = 0x1800;
const HEAD_PITCH_MIN = -0x2000;
/** `CMP CX, 0x3800` / `CMP CX, 0xC800` -- the yaw's reach either way. */
const HEAD_YAW_REACH = 0x3800;
/** `PUSH 0x100` before each `AngleApproachInPlace`: a draw's step. */
const HEAD_TURN_RATE = 0x100;
/** `CMP dword ptr [EAX + 0xa8], 2` -- the mouth table that hands over... */
const MOUTH_TABLE_HANDS_OVER = 2;
/** ...`MOV dword ptr [EAX + 0xa8], 0x3` -- ...to this one. */
const MOUTH_TABLE_HANDED_TO = 3;

/**
 * `AngleApproachInPlace` — `FUN_0048D9B0`. Step `*angle` toward `target` by
 * at most `max`, the short way round -- and return it, where the engine
 * stores it through the pointer:
 *
 * ```
 * 0048d9b4  MOV AX, word ptr [ESP + 0x8]; SUB AX, word ptr [ECX]
 * 0048d9bc  AND EAX, 0xffff; JZ ret           ; there already
 * 0048d9c3  CMP EAX, 0x8000; JLE; SUB EAX, 0x10000
 * 0048d9d3  CMP EAX, EDX; JLE; ADD [ECX], EDX ; up by max
 * 0048d9df  CMP EAX, -EDX; JGE; SUB [ECX], EDX; ret
 * 0048d9e7  ADD [ECX], EAX                    ; the rest
 * ```
 *
 * `[proved]`. A 16-bit difference, a 32-bit store: the angle is never
 * wrapped.
 */
export function AngleApproachInPlace(angle: number, target: number,
                                     max: number): number {
  let d = (target - angle) & 0xffff;
  if (d === 0) return angle;
  if (d > 0x8000) d -= 0x10000;
  if (d > max) return (angle + max) | 0;
  if (d < -max) return (angle - max) | 0;
  return (angle + d) | 0;
}

/**
 * The head's own angles off the pose: `MatrixStackSetTopFromArray(bone 1's
 * record); MatrixInvert(0); MatrixMultiply(bone 2's record);
 * MatrixGetAngles` -- bone 2 relative to bone 1, pitch `x`, yaw `y`, roll `z`,
 * as `s16`s. Both records are in the view; the product is not, so the world
 * matrices give the same numbers.
 *
 * `[port-only]` as a function: four stack calls in the hook, which the
 * renderer makes too, on the pose it draws.
 */
export function CivilianHeadPoseAngles(bone1: ArrayLike<number>,
                                       bone2: ArrayLike<number>):
    { x: number; y: number; z: number } {
  const m = Array.from(bone1) as Mat;
  MatrixInvert(m);
  MatrixMultiply(m, bone2);
  return MatrixGetAngles(RotationOf(m));
}

/**
 * The twelve elements `MatrixSetTop3x4` (`FUN_004A9ED0`) writes; the rotation
 * rows are its first nine, the translation (`12..14`) its last three.
 */
const ROTATION_ELEMENTS: readonly number[] = [0, 1, 2, 4, 5, 6, 8, 9, 10];

/**
 * The turned head: bone 1's record rotation at bone 2's own translation, then
 * `MatrixRotateY(yaw + sub+0x98); MatrixRotateX(pitch + sub+0x94);
 * MatrixRotateZ(roll + sub+0x9C)` -- the `MatrixSetTop3x4` at `0x0048D785`
 * and the three calls after it. Built here on the two world matrices, which
 * is the view-space product with the view taken back off.
 *
 * `[port-only]` as a function, for the renderer, which draws it.
 */
export function CivilianHeadTurnedMatrix(bone1: ArrayLike<number>,
                                         bone2: ArrayLike<number>,
                                         turn: { pitch: number; yaw: number;
                                                 roll: number },
                                         out: Mat): Mat {
  for (let i = 0; i < 16; i++) out[i] = bone2[i];
  for (const i of ROTATION_ELEMENTS) out[i] = bone1[i];
  const a = CivilianHeadPoseAngles(bone1, bone2);
  MatrixRotateY(out, (turn.yaw + a.y) | 0);
  MatrixRotateX(out, (turn.pitch + a.x) | 0);
  MatrixRotateZ(out, (turn.roll + a.z) | 0);
  return out;
}

const _w1: Mat = MatIdentity();
const _w2: Mat = MatIdentity();
const _m: Mat = MatIdentity();
const _p = vec3();
const _t = vec3();
const _d = vec3();

/**
 * `CivilianDrawBonePart` — `FUN_0048D1F0`. What one node of a civilian draws.
 *
 * ```
 * switch (bone - 2) via 0x0048D984 / 0x0048D978:
 * bone 2:            the head arm, the mouth arm, then the draw below
 * bones 5 8 12 15:   if (g_GameMode == 1 && g_original_item_part_scale)
 *                        MatrixScale(2, 2, 2)                  ; then:
 * default:           AssetDrawSlot(record slot)    ; the lit one under lights
 *
 * head:  if (sub+0x8C) {
 *   P = camera block * the node's translation              ; her head, in the world
 *   T = by mode (see CivilianHeadMode)
 *   cur = MatrixGetAngles(rec2 * inv(rec1))                ; the head's own angles
 *   want = mode 6 ? cur : VecToAngles(inv(R1) * (T - P) - (0, 1.5, 0))
 *   clamp want.pitch to -0x2000..0x1800, want.yaw to -0x3800..0x3800
 *   sub+0x94/98/9C = AngleApproachInPlace(.., want - cur, 0x100)   ; roll's want is 0
 *   if all three are 0: sub+0x8C = 0
 *   else: the node = R1 at P . RotY RotX RotZ(cur + sub+0x9x), stored in rec2+0x28
 * }
 * mouth: if (sub+0xA8 != 6) {
 *   off = (s8) table[sub+0xA8][sub+0xA0 % count]
 *   if (sub+0xA4 && --sub+0xA4) ++sub+0xA0
 *   else if (sub+0xA4 was 1) table 2 hands over to 3, others park on their last
 * }
 * if (g_GameMode == 1 && g_original_item_part_scale) MatrixScale(1.5, 1, 1.5)
 * AssetDrawSlot(record slot + off)
 * ```
 *
 * `[proved]`, every line, from `0x0048D1F0..0x0048D974` and the two jump
 * tables; the whole reading is on the function's row in `functions.tsv`.
 *
 * **What the port reads in place of the records**, and where it cannot: the
 * two bone matrices come from the renderer's pose (`GameHost.boneMatrix` for
 * bone 1, `bonePoseMatrix` for bone 2), and a child's head from
 * `boneWorld`. A host that cannot answer -- a headless run, or the tick
 * before the renderer adopts her -- cannot place the head, and the head arm
 * holds, as `ActorAimHeadAtCamera` does in `class30/head_aim.ts`; the mouth
 * reads none of it and always runs. The draw itself is the renderer's.
 */
export function CivilianDrawBonePart(obj: Actor, bone: number, _slot: number,
                                     f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  const originalScale = G.g_GameMode === GameMode.Original
    && G.g_original_item_part_scale !== 0;
  if (bone !== CIVILIAN_HEAD_BONE) {
    // `0x0048D902`, and then the plain draw every other bone makes.
    if (CIVILIAN_SCALED_BONES.includes(bone) && originalScale) {
      sub.partScale = true;
    }
    return;
  }

  // -- the head: `0x0048D244`..`0x0048D7DA` --------------------------------
  if (sub.headMode !== CivilianHeadMode.None
      && f.host.boneMatrix?.(obj.at, CIVILIAN_HEAD_PARENT_BONE, _w1)
      && f.host.bonePoseMatrix?.(obj.at, CIVILIAN_HEAD_BONE, _w2)) {
    // `MatrixStackPush(0); MatrixGetTranslation` -- the node's own point --
    // then through the camera block: her head in the world.
    _p.x = _w2[12]; _p.y = _w2[13]; _p.z = _w2[14];
    let placed = true;
    switch (sub.headMode as CivilianHeadMode) {
      case CivilianHeadMode.Eye:
        _t.x = G.g_camera_eye.x;
        _t.y = Math.fround(G.g_camera_eye.y + HEAD_EYE_RISE);
        _t.z = G.g_camera_eye.z;
        break;
      case CivilianHeadMode.Child: {
        // `CMP word ptr [EAX+0x1e], 0; JZ; TEST [ECX+0x34], 0x4000000; JZ`:
        // a child that has died hands the watch to the first survivor.
        let kid = ActorByAt(sub.headTargetAt);
        if (sub.childCount !== 0 && kid
            && (kid.flags & ActorFlag.Dead) !== 0) {
          sub.headTargetAt = sub.children[0] ?? -1;
          sub.headTargetPoint = null;
          kid = ActorByAt(sub.headTargetAt);
        }
        // `TEST byte ptr [ECX+0x34], 0x1; JZ` -> `sub+0x8C = 6`.
        if (!ActorLiveBit(kid)) {
          sub.headMode = CivilianHeadMode.Rest;
          break;
        }
        // Bone 2's record (`+0x354`) through the camera block.
        if (!f.host.boneWorld(kid.at, CIVILIAN_HEAD_BONE, _t)) placed = false;
        break;
      }
      case CivilianHeadMode.LookAt:
        _t.x = G.g_camera_lookat_target.x;
        _t.y = G.g_camera_lookat_target.y;
        _t.z = G.g_camera_lookat_target.z;
        break;
      case CivilianHeadMode.Point:
      case CivilianHeadMode.LocalPoint: {
        const q = sub.headTargetPoint;
        if (!q) {
          // A null pointer, which the engine would read through; no shipped
          // stream names one. The port leaves the target where the default
          // arm does.
          CivilianNodeViewPoint(_p, _t);
          break;
        }
        if (sub.headMode === CivilianHeadMode.Point) {
          _t.x = q.x; _t.y = q.y; _t.z = q.z;
          break;
        }
        // `MatrixLoadIdentity`, the carrier's four calls when she rides one
        // (`CMP [g_cur_actor], CivilianUpdateOnCarrier` at `0x0048D41A`),
        // then her own `T Rx Rz Ry`, and the point through it.
        const m = _m;
        for (let i = 0; i < 16; i++) m[i] = i % 5 === 0 ? 1 : 0;
        const carrier = obj.carrierAt >= 0 ? ActorByAt(obj.carrierAt) : null;
        if (carrier) CarrierMatrixCompose(m, carrier);
        MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
        MatrixRotateX(m, obj.pitch);
        MatrixRotateZ(m, obj.roll);
        MatrixRotateY(m, obj.yaw);
        MatrixTransformPoint(m, q, _t);
        break;
      }
      default:
        // Mode 6, or any the table has no cell for: the target stays what
        // the first `MatrixGetTranslation` left in it, the node's point in
        // the view. Mode 6 never reads it.
        CivilianNodeViewPoint(_p, _t);
        break;
    }

    if (placed) {
      const cur = CivilianHeadPoseAngles(_w1, _w2);
      let pitch: number;
      let yaw: number;
      if (sub.headMode === CivilianHeadMode.Rest) {
        pitch = cur.x;
        yaw = cur.y;
      } else {
        // Bone 1's rotation alone, inverted: the aim in the head's parent's
        // own axes, dropped 1.5 before the angles are taken.
        for (let i = 0; i < 16; i++) _m[i] = _w1[i];
        _m[12] = 0; _m[13] = 0; _m[14] = 0;
        MatrixInvert(_m);
        _d.x = Math.fround(_t.x - _p.x);
        _d.y = Math.fround(_t.y - _p.y);
        _d.z = Math.fround(_t.z - _p.z);
        MatrixTransformPoint(_m, _d, _d);
        const a = VecToAngles(_d.x, Math.fround(_d.y - HEAD_AIM_DROP), _d.z);
        pitch = FtolS16(a.pitch);
        yaw = FtolS16(a.yaw);
      }
      if (pitch > HEAD_PITCH_MAX) pitch = HEAD_PITCH_MAX;
      else if (pitch < HEAD_PITCH_MIN) pitch = HEAD_PITCH_MIN;
      if (yaw > HEAD_YAW_REACH) yaw = HEAD_YAW_REACH;
      else if (yaw < -HEAD_YAW_REACH) yaw = -HEAD_YAW_REACH;
      sub.headPitch = AngleApproachInPlace(sub.headPitch, pitch - cur.x,
                                           HEAD_TURN_RATE);
      sub.headYaw = AngleApproachInPlace(sub.headYaw, yaw - cur.y,
                                         HEAD_TURN_RATE);
      sub.headRoll = AngleApproachInPlace(sub.headRoll, cur.z - cur.z,
                                          HEAD_TURN_RATE);
      if (sub.headPitch === 0 && sub.headYaw === 0 && sub.headRoll === 0) {
        sub.headMode = CivilianHeadMode.None;
      } else {
        sub.headTurned = true;
      }
    }
  }

  // -- the mouth: `0x0048D7E0`..`0x0048D873` -------------------------------
  if (sub.mouthTable !== CIVILIAN_MOUTH_NONE) {
    const table = T.civilians?.mouthTables?.[sub.mouthTable];
    if (table && table.length > 0) {
      sub.mouthOffset = table[sub.mouthCursor % table.length];
      if (sub.mouthFrames !== 0) {
        sub.mouthFrames -= 1;
        if (sub.mouthFrames !== 0) {
          sub.mouthCursor += 1;
        } else if (sub.mouthTable === MOUTH_TABLE_HANDS_OVER) {
          sub.mouthTable = MOUTH_TABLE_HANDED_TO;
          sub.mouthFrames = T.civilians?.mouthTables?.[MOUTH_TABLE_HANDED_TO]
            ?.length ?? 0;
          sub.mouthCursor = 0;
        } else {
          sub.mouthCursor = table.length - 1;
        }
      }
    }
  }
  if (originalScale) sub.partScale = true;
}

/**
 * The node's own point in the view: the head's world point through
 * `g_camera_world_to_view`. `[port-only]`: the engine has it on the stack.
 */
function CivilianNodeViewPoint(world: { x: number; y: number; z: number },
                               out: { x: number; y: number; z: number }):
    void {
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), world, out);
}
