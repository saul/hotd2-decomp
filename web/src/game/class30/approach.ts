/**
 * `ZombieStateApproach` — `FUN_004579A0`.
 *
 * Walk in, band by band, then ask permission to attack. The test is
 *
 * ```c
 * if ((s8)obj[0x131D] < obj[0x1358] && obj[0x131E] < 3) TryClaimAttackSlot();
 * ```
 *
 * — "if I am among the nearest N, and among the nearest 3 overall, I may press
 * an attack". `obj+0x131D` is written once a frame by `RankEnemiesByDistance`
 * and `obj+0x1358` comes from `TestApproachRing`.
 *
 * This state also **sets `flags & 0x10000` while walking and clears it the
 * moment the actor wins a permit**, which is how the camera comes to consider
 * only enemies that have committed.
 */
import { FLAG_NO_CAMERA_TRACK, type Actor } from "../actor";
import { TryClaimAttackSlot } from "../combat/permits";
import { QUEUE_CAP } from "../combat/rank";
import { AttackListOf } from "../tables";
import type { Vec3 } from "../vec";
import { ActorAdvanceTowardCamera } from "./move";
import { TestApproachRing } from "./ring";
import { STATE_ATTACK_RUN, STATE_STRIKE } from "./states";

/**
 * Whether taking a permit could lead anywhere.
 *
 * `attack_state` 0 is `g_class30_states[0]`, the engine's no-op — 123 of stage
 * 2's class-0x30 spawns carry it, and -1 another 38. Those actors are scenery
 * that happens to walk. They must not compete for a permit: there are only
 * `g_max_attackers` of them, and one held by an actor that cannot attack
 * blocks every other enemy for good.
 */
export function ActorCanAttack(obj: Actor): boolean {
  return obj.attackState > 0 && Object.keys(AttackListOf(obj)).length > 0;
}

/**
 * Which state a permit-holder enters. Only 1 and 2 are ported; the descriptor
 * also names 10, 15, 26, 30 and 38, which are approach variants, so they are
 * mapped onto the attack run rather than left to hang.
 */
export function ZombieAttackStateFor(obj: Actor): number {
  return obj.attackState === STATE_STRIKE ? STATE_STRIKE : STATE_ATTACK_RUN;
}

export function ZombieStateApproach(obj: Actor, eye: Vec3, dt: number): void {
  if (obj.sub === 0) {
    const r = TestApproachRing(obj, eye);
    obj.allowance = r.allowance;
    obj.flags |= FLAG_NO_CAMERA_TRACK;
    obj.sub = 1;
    return;
  }

  // The band is recomputed every frame, because the actor is walking and the
  // states that follow this one call `TestApproachRing` every frame too.
  ActorAdvanceTowardCamera(obj, eye, dt);
  obj.allowance = TestApproachRing(obj, eye).allowance;

  if (!ActorCanAttack(obj)) return;
  if (obj.rank < obj.allowance && obj.rank < QUEUE_CAP
      && TryClaimAttackSlot(obj)) {
    obj.state = ZombieAttackStateFor(obj);
    obj.sub = 0;
  }
}
