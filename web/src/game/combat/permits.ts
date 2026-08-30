/**
 * The attack permit — `g_attack_permits`, one per player.
 *
 * Winning one is what lets an actor attack *and* what puts it on camera: the
 * permit index lives in `obj+0x121`, and `RegisterForCameraTracking` keys off
 * the same commitment. One byte doing two jobs is the whole trick.
 */
import { ActorFlag, type Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { vec3 } from "../vec";

/**
 * `g_projection_distance_px` — 0x009A2D70, and a 640x480 frame.
 *
 * `ActorIsOnScreen` tests against `+/-g_projection_distance_px * 0.5`
 * horizontally and `+/-240` vertically, which is how the half-height is known
 * to be 240; the same constant appears in the frustum test at `FUN_0045CA60`
 * with a literal 320 for the half-width.
 */
const SCREEN_HALF_H = 240;
const PROJECTION_DISTANCE_PX = 640.2;

const _view = vec3();

/**
 * `ActorIsOnScreen` — `FUN_00409C10`.
 *
 * Projects the actor's tracked point and asks whether it lands inside the
 * frame. `TryClaimAttackSlot` calls it before handing out a permit, so **an
 * enemy off the side of the screen cannot start an attack** — which is what
 * stops something you cannot see swinging at you, and stops it holding the one
 * permit while it is out of shot.
 */
export function ActorIsOnScreen(obj: Actor, host: GameHost): boolean {
  if (!host.viewSpaceOf(obj.at, _view)) return true;   // not posed: no opinion
  if (_view.z === 0) return false;
  const x = (PROJECTION_DISTANCE_PX * _view.x) / _view.z;
  const y = (PROJECTION_DISTANCE_PX * _view.y) / _view.z;
  const halfW = PROJECTION_DISTANCE_PX * 0.5;
  return x >= -halfW && x <= halfW && y >= -SCREEN_HALF_H && y <= SCREEN_HALF_H;
}

/**
 * `TryClaimAttackSlot` — `FUN_00455DE0`. Take a free permit, or fail.
 *
 * Note what it does **not** do: there is no queue-rank test here. That lives
 * in `ZombieStateApproach`, before the call.
 */
export function TryClaimAttackSlot(obj: Actor, host?: GameHost): boolean {
  // `FUN_00409DC0` and `ActorIsOnScreen` both gate the claim; this is the one
  // that matters for what the player sees.
  if (host && !ActorIsOnScreen(obj, host)) return false;
  for (let i = 0; i < G.g_max_attackers; i++) {
    if (G.g_attack_permits[i] === -1) {
      G.g_attack_permits[i] = obj.at;
      obj.attackPermit = i;                    // +0x121
      obj.flags &= ~ActorFlag.NoCameraTrack;      // the camera may now see it
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
export function ThrowerTryClaimAttackSlot(obj: Actor, host?: GameHost): boolean {
  return TryClaimAttackSlot(obj, host);
}

/** `ReleaseAttackSlot` — `FUN_00456520`. */
export function ReleaseAttackSlot(obj: Actor): void {
  if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
  obj.attackPermit = -1;
  obj.flags |= ActorFlag.NoCameraTrack;
}
