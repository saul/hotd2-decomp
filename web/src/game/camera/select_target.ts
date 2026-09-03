/**
 * `SelectCameraLookAtTarget` — `FUN_00403050`.
 *
 * ```
 * slot0 attacking, slot1 not  -> look at slot0 alone
 * slot0 and slot1 both        -> look at their midpoint
 * slot0 only                  -> look at slot0
 * nothing registered          -> look where the cam/ path says
 * ```
 *
 * **The last row is a fallback, not an exit.** The routine returns nothing: it
 * always writes `g_camera_lookat_target`, and with no enemy registered it
 * writes the path's own target and clears `g_camera_is_tracking`. Whoever
 * called it — `CameraTrackEnemiesTick` — then eases the camera onto that point
 * exactly as it would ease onto an enemy, and `g_camera_is_tracking` only
 * chooses the rate.
 *
 * The port used to return `false` here and have the caller snap the camera
 * straight to the path's target instead. That is the difference between a
 * camera that swings back onto the rail over about thirty frames when the last
 * enemy dies and one that jumps 16 degrees in a single frame — which is what
 * stage 2 block 17 step 5 did at `wait_enemies_alive 0`, right before the
 * camera moves outside.
 */
import type { Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import type { Vec3 } from "../vec";
import { ACTOR_FACE_OFFSET } from "./constants";

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
  return { x: a.pos.x, y: a.pos.y + ACTOR_FACE_OFFSET, z: a.pos.z };
}

/** Writes `g_camera_lookat_target` and sets `g_camera_is_tracking`. */
export function SelectCameraLookAtTarget(): void {
  const out = G.g_camera_lookat_target;
  const s0 = ActorByAt(G.g_enemy_slots[0]);
  if (!s0) {
    // `DAT_0059c988 = 0` and the three words come straight from the path pose
    // block at 0x009C70D8.
    G.g_camera_is_tracking = 0;
    out.x = G.g_cam_path_target.x;
    out.y = G.g_cam_path_target.y;
    out.z = G.g_cam_path_target.z;
    return;
  }
  G.g_camera_is_tracking = 1;
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
}
