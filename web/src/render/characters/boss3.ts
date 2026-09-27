/**
 * Class 0x45's skeletons, drawn from the matrices the port composed.
 *
 * The class poses itself (`game/class45/model.ts`, `pose.ts`): the angles,
 * the root and -- for the heads and the body -- `Boss3ComposeBonePose`'s own
 * walk, whose extra rotations and whose chain order for the body's spine are
 * not anything a clip holds. So this reads the tail and places the nodes as
 * the walk that posed them did, and plays no clip of its own:
 *
 * * **plain** (`SkeletonApplyRootMotion`, `FUN_00410C50`, draw byte 5):
 *   the object `T(pos) Rz(roll) Ry(yaw) Rx(pitch) S(scale) T(pivot)`, and
 *   every node `T(offset) Rz Ry Rx` of its angles;
 * * **composed** (`Boss3ComposeBonePose`, `FUN_00421F20`): `T(pos) Rz Ry Rx`
 *   with no scale, `T(pivot)` for the root, and every node `T(offset)` then
 *   either `Rx Ry Rz` (the body's spine, below the weak bone) or the extra
 *   `Rz Ry Rx` and then the angles `Rz Ry Rx`.
 *
 * The call order is the product order, so `RotZ; RotY; RotX` is `qZ*qY*qX`,
 * as `Poser.bams` has it. `game/class45/model.ts`'s `Boss3PoseMatrices` makes
 * the same product in world space for the class's own readers; the two are
 * held together by `test/render.test.ts`.
 *
 * Whether the actor is drawn at all is the update's answer
 * (`Boss3Tail.drawn`): the heads' and the body's skeleton walk draws nothing
 * (`PoseHookNone`), `Boss3DrawBoneParts` draws them, and the body skips it
 * while it builds its path and takes the camera.
 */
import { Quaternion, Vector3 } from "three";
import { BAMS_TO_RAD } from "../../core/bams";
import type { Boss3Actor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const _q = new Quaternion();

/** `RotZ(z); RotY(y); RotX(x)` into `out`. */
function zyx(out: Quaternion, x: number, y: number, z: number): Quaternion {
  out.setFromAxisAngle(AXIS_Z, z * BAMS_TO_RAD);
  out.multiply(_q.setFromAxisAngle(AXIS_Y, y * BAMS_TO_RAD));
  return out.multiply(_q.setFromAxisAngle(AXIS_X, x * BAMS_TO_RAD));
}

const _e = new Quaternion();

/** One node's rotation, in the order the walk that posed it uses. */
function boneRotation(out: Quaternion, a: Boss3Actor, bone: number): void {
  const t = a.boss3;
  const o = bone * 3;
  const rx = t.boneRot[o] ?? 0;
  const ry = t.boneRot[o + 1] ?? 0;
  const rz = t.boneRot[o + 2] ?? 0;
  const blk = t.block;
  if (t.composed && blk) {
    if (t.index === 8 && bone < blk.weakBone) {
      // `RotX; RotY; RotZ` -- the body's spine.
      out.setFromAxisAngle(AXIS_X, rx * BAMS_TO_RAD);
      out.multiply(_q.setFromAxisAngle(AXIS_Y, ry * BAMS_TO_RAD));
      out.multiply(_q.setFromAxisAngle(AXIS_Z, rz * BAMS_TO_RAD));
      return;
    }
    zyx(out, blk.extraX[bone] ?? 0, blk.extraY[bone] ?? 0,
        blk.extraZ[bone] ?? 0);
    out.multiply(zyx(_e, rx, ry, rz));
    return;
  }
  zyx(out, rx, ry, rz);
}

/**
 * Place and pose one class-0x45 instance. False for any other class, which
 * the caller then places the ordinary way.
 */
export function poseBoss3(inst: Instance): boolean {
  if (inst.a.cls !== SpawnClass.Boss3) return false;
  const a = inst.a as Boss3Actor;
  const t = a.boss3;
  inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
  zyx(inst.root.quaternion, a.pitch, a.yaw, a.roll);
  inst.root.scale.setScalar(t.composed ? 1 : a.scale);
  inst.pivot.position.set(t.pivot.x, t.pivot.y, t.pivot.z);
  boneRotation(inst.pivot.quaternion, a, 0);
  for (const [bone, node] of inst.bones) boneRotation(node.quaternion, a, bone);
  return true;
}

/** Whether this frame's update drew the skeleton. */
export function boss3Drawn(inst: Instance): boolean {
  return inst.a.cls !== SpawnClass.Boss3 || inst.a.boss3.drawn;
}
