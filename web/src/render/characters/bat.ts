/**
 * Class 0x46, drawn -- the half of the bat's `DrawSkinnedModelAndShadow`
 * (`FUN_00411090`) the character layer does not already do for every
 * character.
 *
 * The body and the wing are ordinary skinned models posed from their clips,
 * but their **object** transform is not the ordinary path's. That path draws
 * yaw alone; `SkeletonApplyRootMotion` (`FUN_00410C50`) draws
 *
 * ```
 * T(obj+0x40)  Rz(obj+0x6C) Ry(obj+0x68) Rx(obj+0x64)  MatrixScale(model+0x116C)
 * ```
 *
 * for `model+0x68` -- `obj+0x1FC` -- of 5, which `PlaceBats` (`FUN_0042D9C0`)
 * writes on every member and `SpawnBatWings` (`FUN_0042E060`) on every wing.
 * Both halves show on a bat:
 *
 * * **The angles.** A shot bat tumbles -- `obj+0x64` climbs by `0x200` a frame
 *   to `0x8000` while `obj+0x68` spins -- and the wing is always pitched
 *   `0xE800`. Yaw alone drew every corpse falling level and every wing flat.
 * * **The scale.** `ActorBuildSkinnedModel` (`FUN_00410440`) sizes character
 *   type `0x1E` at 0.6 and `0x1F` at 0.7 (`ActorModelScale`, which the actor
 *   carries as {@link Actor.scale}), and `BatWingUpdate` seats the wing
 *   through the body's scaled node matrix. That is not the bat's own: the
 *   `MatrixScale(model+0x116C)` above is on every skinned actor's draw, and
 *   the character layer's `placeRoot` applies it to every root it places,
 *   this one included. This file used to apply it here alone, when every
 *   other skinned actor was drawn at 1.0.
 *
 * Everything here **reads** the actor.
 */
import { BAMS_TO_RAD } from "../../core/bams";
import type { Actor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

/**
 * `obj+0x1FC = 5`, the default arm of the jump table at `0x00411038`:
 * `Rz; Ry; Rx` on the engine's stack, which three.js names `"ZYX"` -- the
 * axes in the order their matrices are multiplied.
 */
const BAT_ROTATION_ORDER = "ZYX";

/**
 * Place a bat's root, body or wing: its position and its three angles. False
 * when the instance is not class 0x46. The size is the caller's -- see above.
 */
export function placeBatRoot(inst: Instance): boolean {
  const a: Actor = inst.a;
  if (a.cls !== SpawnClass.Bat) return false;
  inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
  inst.root.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                         a.roll * BAMS_TO_RAD, BAT_ROTATION_ORDER);
  return true;
}
