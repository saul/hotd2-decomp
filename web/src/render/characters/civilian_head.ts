/**
 * A civilian's head look, drawn.
 *
 * The port decides it -- `game/class10/head.ts` has the reading -- and this is
 * the rebuild at the end of `CivilianDrawBonePart`'s (`FUN_0048D1F0`) bone-2
 * arm, which replaces the head's record with the turn:
 *
 * ```
 * 0048d6f3  MatrixGetTranslation(&t)               ; the head, as posed
 * 0048d785  MatrixSetTop3x4(record1 3x3 | t)       ; bone 1's rotation
 * 0048d79d  MatrixRotateY(sub+0x98 + pose.y)
 * 0048d7b5  MatrixRotateX(sub+0x94 + pose.x)
 * 0048d7cc  MatrixRotateZ(sub+0x9C + pose.z)
 * 0048d7d2  MatrixStore(record2 + 0x28)
 * ```
 *
 * with `pose = MatrixGetAngles(record1^-1 * record2)`, the head's own angles
 * in bone 1's frame.
 *
 * ## The record turns, so the node turns
 *
 * Unlike class 0x30's head aim (`head_aim.ts`), which turns only the push its
 * hook draws inside, this one is **stored**: the hit centre `SkeletonEmitNode`
 * takes after the hook, `CivilianDrawHeldItems`' and the attachments' parent
 * and the head's own draw all read the turned record. So the turn goes on the
 * bone's node, whose children are exactly those -- and the pose it replaces
 * is kept, because the hook reads the pose to turn it: `headPose`, which is
 * what `GameHost.bonePoseMatrix` answers with.
 *
 * Only the rotation is written. The rebuild keeps the head's translation, so
 * the node's position is already right; with bone 1 as bone 2's parent in
 * every skeleton, the local rotation that gives `B1 * R` is `R` itself, and
 * the general form below is what it reduces to.
 *
 * The angles are the actor's (`CivilianState.headLookPitch`/`Yaw`/`Roll`)
 * and so is whether to turn at all (`headLookTurned`); the pose is this
 * frame's, which is the one the engine turns. Render bookkeeping only.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  CIVILIAN_HEAD_BONE, CIVILIAN_HEAD_LOOK_FRAME_BONE,
} from "../../game/class10/head";
import {
  MatCopy, MatIdentity, MatrixGetAngles, MatrixInvert, MatrixMultiply,
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, type Mat, type Rot3,
} from "../../game/matrix";
import type { Instance } from "./instance";

/** The 3x3 of an engine-layout matrix as `Rot3`, which keeps it transposed. */
function RotationOf(m: ArrayLike<number>): Rot3 {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}

const _r: Mat = MatIdentity();
const _m: Mat = MatIdentity();
const _turn = new Matrix4();
const _inv = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

/**
 * Keep this frame's posed head, and turn it when the hook did.
 *
 * Runs after the pose and before anything is hung on the bone, every frame
 * a civilian is posed.
 */
export function applyCivilianHeadLook(inst: Instance): void {
  const sub = inst.a.civ;
  const head = inst.bones.get(CIVILIAN_HEAD_BONE);
  const frame = inst.bones.get(CIVILIAN_HEAD_LOOK_FRAME_BONE);
  if (!sub || !head || !frame) return;
  head.updateWorldMatrix(true, false);
  (inst.headPose ??= new Matrix4()).copy(head.matrixWorld);
  if (!sub.headLookTurned) return;

  const b1 = frame.matrixWorld.elements;
  const h = head.matrixWorld.elements;
  MatCopy(_r, b1);
  MatrixInvert(_r);
  MatrixMultiply(_r, h);
  const pose = MatrixGetAngles(RotationOf(_r));

  MatCopy(_m, b1);
  _m[12] = h[12]; _m[13] = h[13]; _m[14] = h[14];
  MatrixRotateY(_m, sub.headLookYaw + pose.y);
  MatrixRotateX(_m, sub.headLookPitch + pose.x);
  MatrixRotateZ(_m, sub.headLookRoll + pose.z);

  _turn.fromArray(_m);
  if (head.parent) _turn.premultiply(_inv.copy(head.parent.matrixWorld).invert());
  _turn.decompose(_p, _q, _s);
  head.quaternion.copy(_q);
  head.updateMatrixWorld(true);
}
