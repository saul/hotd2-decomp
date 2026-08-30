/**
 * The attack permit — `g_attack_permits`, one per player.
 *
 * Winning one is what lets an actor attack *and* what puts it on camera: the
 * permit index lives in `obj+0x121`, and `RegisterForCameraTracking` keys off
 * the same commitment. One byte doing two jobs is the whole trick.
 */
import { FLAG_NO_CAMERA_TRACK, type Actor } from "../actor";
import { G } from "../globals";

/**
 * `TryClaimAttackSlot` — `FUN_00455DE0`. Take a free permit, or fail.
 *
 * Note what it does **not** do: there is no queue-rank test here. That lives
 * in `ZombieStateApproach`, before the call.
 */
export function TryClaimAttackSlot(obj: Actor): boolean {
  for (let i = 0; i < G.g_max_attackers; i++) {
    if (G.g_attack_permits[i] === -1) {
      G.g_attack_permits[i] = obj.at;
      obj.attackPermit = i;                    // +0x121
      obj.flags &= ~FLAG_NO_CAMERA_TRACK;      // the camera may now see it
      return true;
    }
  }
  return false;
}

/**
 * `ThrowerTryClaimAttackSlot` — `FUN_0044CA40`.
 *
 * Byte-for-byte `TryClaimAttackSlot`, and it exists as its own function
 * because class 0x31 reaches it from its own state machine. Kept separate for
 * the same reason: gating the thrower on the zombie's rank test is why the
 * elevated ones never threw — they are far away by design, so their distance
 * rank is always high.
 */
export function ThrowerTryClaimAttackSlot(obj: Actor): boolean {
  return TryClaimAttackSlot(obj);
}

/** `ReleaseAttackSlot` — `FUN_00456520`. */
export function ReleaseAttackSlot(obj: Actor): void {
  if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
  obj.attackPermit = -1;
  obj.flags |= FLAG_NO_CAMERA_TRACK;
}
