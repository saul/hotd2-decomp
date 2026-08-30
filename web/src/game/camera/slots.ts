/**
 * `g_enemy_slots` — who the camera is allowed to look at.
 *
 * `RegisterForCameraTracking` skips any actor with flag `0x10000`, which
 * `ZombieStateApproach` **sets while walking and clears the moment the actor
 * wins a permit** — so the camera only ever considers enemies that have
 * committed. Candidates are keyed on `|actor - eye| * 10` and radix-sorted
 * ascending, so nearest first; permit holders take slots 0 and 1 and everyone
 * else 2 upward.
 */
import { FLAG_NO_CAMERA_TRACK, type Actor } from "../actor";
import { G } from "../globals";
import { T } from "../tables";
import { dist3d, type Vec3 } from "../vec";

/** `ResetCameraEnemySlots` — `FUN_00408D90`. */
export function ResetCameraEnemySlots(): void {
  G.g_enemy_slots = [];
  G.g_camera_is_tracking = 0;
}

/** `RegisterForCameraTracking` — `FUN_00408EC0`. */
export function RegisterForCameraTracking(obj: Actor): boolean {
  if (obj.dead || !obj.visible) return false;
  return (obj.flags & FLAG_NO_CAMERA_TRACK) === 0;
}

/** `UpdateCameraEnemySlots` — `FUN_00408DD0`. Fill `g_enemy_slots` for the frame. */
export function UpdateCameraEnemySlots(eye: Vec3): void {
  const scale = T.tracking?.distance_scale ?? 10;
  const cand = G.g_object_list
    .filter(RegisterForCameraTracking)
    .sort((p, q) => Math.round(dist3d(p.pos, eye) * scale)
                  - Math.round(dist3d(q.pos, eye) * scale))
    .slice(0, T.tracking?.max_candidates ?? 14);

  // Slots 0 and 1 are reserved for permit holders; the rest fill from 2.
  const attackers: number[] = [];
  const rest: number[] = [];
  for (const c of cand) {
    if (c.attackPermit >= 0 && attackers.length < (T.tracking?.attack_slots ?? 2)) {
      attackers.push(c.at);
    } else {
      rest.push(c.at);
    }
  }
  G.g_enemy_slots = [...attackers, ...rest];
  G.g_camera_is_tracking = G.g_enemy_slots.length ? 1 : 0;
}
