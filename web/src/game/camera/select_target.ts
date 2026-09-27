/**
 * `SelectCameraLookAtTarget` — `FUN_00403050`.
 *
 * It reads the **first four slots by index** -- slots 0 and 1 are the permit
 * holders the last fill dealt, 2 and 3 the two nearest candidates that held
 * none -- and never looks further:
 *
 * ```
 * 0 and 1 occupied   one holds a permit and the other not -> that one;
 *                    otherwise                           -> their midpoint
 * 0 alone            -> slot 0            1 alone        -> slot 1
 * neither            2 and 3 -> midpoint, 2 alone -> 2, 3 alone -> 3
 * nothing            g_camera_is_tracking = 0; the path pose's own target
 * ```
 *
 * The permit test is the live `obj+0x121`, not the one the fill saw a frame
 * earlier, and slots 2 and 3 are taken as a pair whatever their permits say
 * now. `[proved]` from `0x00403050`..`0x004031D8`.
 *
 * **The last row is a fallback, not an exit.** The routine always writes
 * `g_camera_lookat_target`, and `CameraTrackEnemiesTick` then eases onto it
 * exactly as it would onto an enemy; `g_camera_is_tracking` only chooses the
 * rate.
 *
 * `obj+0x100` is read as it stands. The port used to substitute the actor's
 * origin lifted by 1.5 while the renderer had not yet posed it; the engine
 * reads whatever the last draw left, zero included.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { Vec3 } from "../vec";
import { CameraSlotActor } from "./slots";

/** The actor the camera is locked on, for the UI. Derived, not state. */
export function CameraFocusActor(): number {
  for (let i = 0; i < 2; i++) {
    const a = CameraSlotActor(i);
    if (a && a.attackPermit !== -1) return a.at;
  }
  return -1;
}

function LookAtOne(out: Vec3, a: Actor): void {
  out.x = a.lookAt.x;
  out.y = a.lookAt.y;
  out.z = a.lookAt.z;
}

/** `(a + b) * 0.5` per axis -- `FMUL [0x004C43AC]`, which is 0.5. */
function LookAtMid(out: Vec3, a: Actor, b: Actor): void {
  out.x = (b.lookAt.x + a.lookAt.x) * 0.5;
  out.y = (b.lookAt.y + a.lookAt.y) * 0.5;
  out.z = (b.lookAt.z + a.lookAt.z) * 0.5;
}

/** Writes `g_camera_lookat_target`; clears `g_camera_is_tracking` when idle. */
export function SelectCameraLookAtTarget(): void {
  const out = G.g_camera_lookat_target;
  const s0 = CameraSlotActor(0), s1 = CameraSlotActor(1);
  if (s0 && s1) {
    const p0 = s0.attackPermit !== -1, p1 = s1.attackPermit !== -1;
    if (p0 && !p1) LookAtOne(out, s0);
    else if (!p0 && p1) LookAtOne(out, s1);
    else LookAtMid(out, s0, s1);
    return;
  }
  if (s0) { LookAtOne(out, s0); return; }
  if (s1) { LookAtOne(out, s1); return; }
  const s2 = CameraSlotActor(2), s3 = CameraSlotActor(3);
  if (s2 && s3) { LookAtMid(out, s3, s2); return; }
  if (s2) { LookAtOne(out, s2); return; }
  if (s3) { LookAtOne(out, s3); return; }
  // `DAT_0059c988 = 0` and the three words from the deferred pose block's
  // target, 0x009C70D8.
  G.g_camera_is_tracking = 0;
  out.x = G.g_cam_path_target.x;
  out.y = G.g_cam_path_target.y;
  out.z = G.g_cam_path_target.z;
}
