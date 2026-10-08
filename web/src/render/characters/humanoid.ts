/**
 * Class 0x25, drawn -- the object rotation, in the model's own order.
 *
 * `ScriptedHumanoidDraw` (`FUN_00484FF0`) draws the body through
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`), whose object matrix
 * `SkeletonApplyRootMotion` (`FUN_00410C50`) builds as `T(obj+0x40)` and then
 * the three angles in the order `model+0x68` names. `ActorBuildSkinnedModel`
 * (`FUN_00410440`) seeds that byte with 5, and `ScriptedHumanoidInit`
 * (`FUN_004840D0`) overwrites it straight after the build:
 *
 * ```
 * 004841a9  c6476801   MOV byte ptr [EDI + 0x68], 0x1   ; EDI = obj+0x194
 * ```
 *
 * Arm 1 is `RotX(obj+0x64); RotZ(obj+0x6C); RotY(obj+0x68)`, the same order
 * class 0x31's `EnemyThrowerInit` writes -- see `thrower.ts`. `[proved]`
 *
 * It shows on the actors `HumanoidFrameTail` seats on an object path in mode
 * 1, which takes all three of the path's angles. A path's triple is in
 * `RotZ; RotY; RotX` order, so the class re-reads it into this one before it
 * adds an offset record's yaw (`HumanoidApplyPathOffset`, through
 * `MatrixToEulerBams`): `op_st3` 340's boat riders rock with the hull they sit
 * in, and drawn from the path's raw triple in this order they lay on their
 * sides through it.
 *
 * Everything here **reads** the actor.
 */
import { BAMS_TO_RAD } from "../../core/bams";
import type { Actor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

/**
 * `model+0x68 = 1`: `RotX; RotZ; RotY` on the engine's stack, which three.js
 * names `"XZY"` -- the axes in the order their matrices are multiplied.
 */
const HUMANOID_ROTATION_ORDER = "XZY";

/**
 * Place a class-0x25 root. False when the instance is not class 0x25, or is
 * riding a carrier, so the caller's ordinary arm runs.
 */
export function placeHumanoidRoot(inst: Instance): boolean {
  const a: Actor = inst.a;
  if (a.cls !== SpawnClass.ScriptedHumanoid || a.carrierAt >= 0) return false;
  inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
  inst.root.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                         a.roll * BAMS_TO_RAD, HUMANOID_ROTATION_ORDER);
  return true;
}
