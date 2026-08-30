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
import { ActorByAt, G } from "../globals";
import { T } from "../tables";
import type { Vec3 } from "../vec";

/** The actor the camera is locked on, for the UI. Derived, not state. */
export function CameraFocusActor(): number {
  const s0 = ActorByAt(G.g_enemy_slots[0]);
  return s0 && s0.attackPermit >= 0 ? s0.at : -1;
}

/** False when nothing is registered, which is the fallback to the path's target. */
export function SelectCameraLookAtTarget(out: Vec3): boolean {
  const s0 = ActorByAt(G.g_enemy_slots[0]);
  if (!s0) return false;
  const s1 = ActorByAt(G.g_enemy_slots[1]);

  if (s1 && !(s0.attackPermit >= 0 && s1.attackPermit < 0)) {
    out.x = (s0.pos.x + s1.pos.x) * 0.5;
    out.y = (s0.pos.y + s1.pos.y) * 0.5;
    out.z = (s0.pos.z + s1.pos.z) * 0.5;
  } else {
    out.x = s0.pos.x;
    out.y = s0.pos.y;
    out.z = s0.pos.z;
  }
  // Actors are placed at the feet; the game looks at obj+0x100, which the pose
  // puts at the body. `face_offset` is that lift.
  out.y += T.tracking?.face_offset ?? 12;
  return true;
}
