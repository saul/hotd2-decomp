/**
 * `SelectCameraLookAtTarget` — `FUN_00403050`.
 *
 * ```
 * slot0 attacking, slot1 not  -> look at slot0 alone
 * slot0 and slot1 both        -> look at their midpoint
 * slot0 only                  -> look at slot0
 * nothing registered          -> look where the cam/ path says
 * ```
 */
import type { Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import { T } from "../tables";
import type { Vec3 } from "../vec";

/** The actor the camera is locked on, for the UI. Derived, not state. */
export function CameraFocusActor(): number {
  const s0 = ActorByAt(G.g_enemy_slots[0]);
  return s0 && s0.attackPermit >= 0 ? s0.at : -1;
}

/**
 * The actor's tracked point, or a stand-in.
 *
 * `lookAt` is only filled once the renderer has posed the actor and found the
 * bone; before that, and for anything with no skeleton, the origin lifted by
 * `face_offset` is the best available guess.
 */
function lookAtOf(a: Actor): Vec3 {
  if (a.lookAt.x !== 0 || a.lookAt.y !== 0 || a.lookAt.z !== 0) return a.lookAt;
  return { x: a.pos.x, y: a.pos.y + (T.tracking?.face_offset ?? 12),
           z: a.pos.z };
}

/** False when nothing is registered, which is the fallback to the path's target. */
export function SelectCameraLookAtTarget(out: Vec3): boolean {
  const s0 = ActorByAt(G.g_enemy_slots[0]);
  if (!s0) return false;
  const s1 = ActorByAt(G.g_enemy_slots[1]);

  // `obj+0x100`, which the skeleton walk fills from a bone and the update
  // raises by 4. Never `obj+0x40`: aiming at the origin points the camera at
  // the actor's feet.
  const a0 = lookAtOf(s0);
  if (s1 && !(s0.attackPermit >= 0 && s1.attackPermit < 0)) {
    const a1 = lookAtOf(s1);
    out.x = (a0.x + a1.x) * 0.5;
    out.y = (a0.y + a1.y) * 0.5;
    out.z = (a0.z + a1.z) * 0.5;
  } else {
    out.x = a0.x;
    out.y = a0.y;
    out.z = a0.z;
  }
  return true;
}
