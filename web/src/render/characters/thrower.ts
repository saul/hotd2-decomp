/**
 * Class 0x31, drawn -- the one half of its `DrawSkinnedModelAndShadow`
 * (`FUN_00411090`) the character layer does not already do for every
 * character: **the object rotation, in the model's own order.**
 *
 * The ordinary path draws yaw alone. `SkeletonApplyRootMotion`
 * (`FUN_00410C50`) builds the draw's object matrix as `T(obj+0x40)` and then
 * the three angles in the order `model+0x68` -- `obj+0x1FC` -- names, through
 * the jump table at `0x00411038`, and `EnemyThrowerInit` writes 1 there:
 *
 * ```
 * 004496a2  c686fc01000001   MOV byte ptr [ESI + 0x1fc], 0x1
 * ```
 *
 * Arm 1 is `RotX(obj+0x64); RotZ(obj+0x6C); RotY(obj+0x68)`. Nothing else
 * writes that byte on a class-0x31 actor: its only other writers are the
 * owl's states, `EnemyZombieInit` (also 1), `ZombieSplitCopyToHalf`,
 * `PlaceStoryModeSwitch`, `Class32Init` and `FUN_0042FCA0`. `[proved]`
 *
 * It shows on stage 2 block 21's two `zstin`, which are spawned on their
 * sides against a wall -- `(0, 0xC000, 0xC000)` -- and walk down it on motion
 * 310 before `ThrowerStateDelayedPounce` (`FUN_0044E830`) rolls them level
 * for the leap. Yaw alone drew them standing upright in mid-air beside the
 * wall they were climbing.
 *
 * Everything here **reads** the actor.
 */
import { BAMS_TO_RAD } from "../../core/bams";
import type { Actor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

/**
 * `obj+0x1FC = 1`: `RotX; RotZ; RotY` on the engine's stack, which three.js
 * names `"XZY"` -- the axes in the order their matrices are multiplied.
 */
const THROWER_ROTATION_ORDER = "XZY";

/**
 * Place a class-0x31 root. False when the instance is not class 0x31, or is
 * riding a carrier, so the caller's ordinary arm runs.
 */
export function placeThrowerRoot(inst: Instance): boolean {
  const a: Actor = inst.a;
  if (a.cls !== SpawnClass.Thrower || a.carrierAt >= 0) return false;
  inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
  inst.root.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                         a.roll * BAMS_TO_RAD, THROWER_ROTATION_ORDER);
  return true;
}
