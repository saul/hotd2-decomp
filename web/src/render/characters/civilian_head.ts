/**
 * `CivilianDrawBonePart`'s head, drawn: the turn and the mouth.
 *
 * The port decides both -- `game/class10/draw.ts` has the reading -- and
 * leaves what it decided on the civilian: `civ.headTurned` with the three
 * angles, and `civ.mouthOffset`. This file draws them on bone 2, and records
 * the pose the turn is measured from.
 *
 * ## The turn goes on the node
 *
 * Class 0x30's hook turns its head inside a push and a pop, so only the head's
 * own draw turns (`head_aim.ts`). Class 0x10's does not push: it rebuilds the
 * stack top and **stores it over the node's record** (`MatrixStore` at
 * `0x0048D7D2`), and `SkeletonEmitNode` then takes the hit sphere from that
 * top, while `ActorDrawAttachedParts` hangs the hair from that record. So the
 * face, its hair and her hat, and where a shot finds the head, all turn
 * together -- which is exactly what writing bone 2's node does here. The
 * matrix is the hook's own, built by `CivilianHeadTurnedMatrix` from this
 * frame's pose with the engine's matrix routines, and only its rotation is
 * taken onto the node: the pose writes each bone's quaternion every frame and
 * leaves its bind position, and the rebuilt matrix keeps bone 2 where it was.
 *
 * ## The mouth is a different model
 *
 * `AssetDrawSlot(record slot + offset)`: the table's byte picks another model
 * of the face's file -- the exporter carries them, `civilianMouthOffsets` in
 * `hod2lib/actorscript.ts` -- and the record itself is not written, so this
 * swaps what the node shows without touching `a.boneSlot`.
 *
 * ## Not drawn: the Original Mode scale
 *
 * `civ.partScale` -- the hook's `MatrixScale(1.5, 1, 1.5)` on bone 2 and
 * `(2, 2, 2)` on bones 5, 8, 12 and 15 while `g_original_item_part_scale` is
 * up -- is decided and not drawn here. That flag's one writer
 * (`FUN_00416240`) is unported, so no frame of the port raises it; and the
 * scale is on the stack top after the record is stored, so drawing it means
 * scaling the node's own model and its hit sphere but not the hair and items
 * hung from the record, which is its own piece of work when the flag has a
 * writer.
 *
 * Render bookkeeping only: the pose recorded for `GameHost.bonePoseMatrix`,
 * and which slot the node shows. Everything the draw depends on is the
 * actor's, so a snapshot fully determines it.
 */
import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import {
  CIVILIAN_HEAD_BONE, CIVILIAN_HEAD_PARENT_BONE, CivilianHeadTurnedMatrix,
} from "../../game/class10/draw";
import { DrawRecordSlot } from "../../game/model_draw";
import { MatIdentity } from "../../game/matrix";
import { swapGore } from "./gore";
import type { Instance } from "./instance";

const _m = MatIdentity();
const _world = new Matrix4();
const _local = new Matrix4();
const _pos = new Vector3();
const _scale = new Vector3();
const _q = new Quaternion();

/**
 * Record the head's pose, then lay on this frame's turn and mouth. After the
 * pose and the slot swaps, before the draw gates -- a mouth model swapped in
 * this frame has to arrive under the gate.
 */
export function applyCivilianHead(inst: Instance,
                                  parts: ReadonlyMap<number, Object3D>): void {
  const sub = inst.a.civ;
  const head = inst.bones.get(CIVILIAN_HEAD_BONE);
  if (!sub || !head) return;
  head.updateWorldMatrix(true, false);
  const pose = inst.civHeadPose ?? (inst.civHeadPose = new Array(16));
  for (let i = 0; i < 16; i++) pose[i] = head.matrixWorld.elements[i];

  const bone1 = inst.bones.get(CIVILIAN_HEAD_PARENT_BONE);
  if (sub.headTurned && bone1 && head.parent) {
    bone1.updateWorldMatrix(true, false);
    CivilianHeadTurnedMatrix(bone1.matrixWorld.elements, pose,
                             { pitch: sub.headPitch, yaw: sub.headYaw,
                               roll: sub.headRoll }, _m);
    _world.fromArray(_m);
    _local.copy(head.parent.matrixWorld).invert().multiply(_world);
    _local.decompose(_pos, _q, _scale);
    head.quaternion.copy(_q);
    head.updateMatrixWorld(true);
  }

  // The mouth. `DrawRecordSlot` is the record's slot, which the offset is
  // added to and which nothing here writes.
  const base = DrawRecordSlot(inst.a, CIVILIAN_HEAD_BONE);
  if (!base) return;
  const want = base + sub.mouthOffset;
  const shown = inst.mouthShown ?? base;
  if (want !== shown && swapGore(parts, inst, CIVILIAN_HEAD_BONE, want)) {
    inst.mouthShown = want;
  }
}
