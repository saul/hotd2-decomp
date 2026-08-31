/**
 * `CameraTrackEnemiesTick` — `FUN_00402890`. The gameplay camera.
 *
 * One of the eight routines the scene state machine installs at
 * `g_camera_update_hook` (0x009C7080), and the one that is live while you are
 * fighting. It runs after the queued `cam_play` action has written the camera
 * block for this frame, and it does exactly three things:
 *
 * 1. `SelectCameraLookAtTarget` picks the point the camera *wants* — an
 *    attacking enemy, the midpoint of two, or the path's own target.
 * 2. `TurnLookAtToward` eases `g_camera_block_target` a fraction of the way
 *    onto it. **Unconditionally.** There is no branch here that assigns the
 *    desired point straight through; the only way the aim moves is by easing.
 * 3. It refreshes `g_camera_turn_rate` for the next frame: the angle-error
 *    curve while an enemy is registered, the flat constant (12) when none is.
 *
 * That is the whole reason the game's camera never cuts on its own. A shot
 * ends, `CamAdvancePathFrame` retires, the block freezes at the rail's last
 * pose, enemies pull the aim off it and — when they die — the fallback pulls
 * it smoothly back. The port had step 2 as an `if (tracking)`, so killing the
 * last enemy teleported the aim back to the rail in one frame.
 *
 * Not ported, deliberately:
 *
 * - The `CameraArmStashedPath` (`FUN_00403DB0`) call the routine opens with,
 *   which re-arms a branch preview's stashed pose.
 * - `FUN_00402EF0`, which eases the block **eye** toward the deferred-rail
 *   pose at 0x009C70C0 at 1/16 a frame. In this port the eye comes straight
 *   off the playing path every frame, exactly as `CamAdvancePathFrame` writes
 *   it; the second pose block that ease reads has no port yet. [open]
 * - `if (g_enemies_alive == 0 && DAT_009C6F2E == 2) rate = 0`, a snap. That
 *   byte is **read in two places and written in none**, so it is zero for the
 *   life of the process and the branch is dead code.
 */
import { G } from "../globals";
import { T } from "../tables";
import { SelectCameraLookAtTarget } from "./select_target";
import { ComputeLookAtAngleError, LookAtCosineSquared, TurnLookAtToward }
  from "./turn";
import { vec3 } from "../vec";

/** `FUN_00403C00`'s numerator. Every call site in the engine passes 1. */
const TURN_NUMERATOR = 1;

const _eased = vec3();

export function CameraTrackEnemiesTick(): void {
  SelectCameraLookAtTarget();

  const eye = G.g_camera_block_eye;
  // The rate is one frame old on purpose: the engine writes it at the end of
  // this routine and reads it here, at the top of the next.
  TurnLookAtToward(eye, G.g_camera_lookat_target, G.g_camera_block_target,
                   _eased, TURN_NUMERATOR, G.g_camera_turn_rate);
  G.g_camera_block_target.x = _eased.x;
  G.g_camera_block_target.y = _eased.y;
  G.g_camera_block_target.z = _eased.z;

  if (!G.g_camera_is_tracking) {
    // `FUN_00401DF0` returns the *square* of the cosine, so 0.99999 is about
    // 0.18 degrees. `EvtOpWaitTargetsClear47` is what reads this.
    if (Math.abs(LookAtCosineSquared(eye, G.g_camera_lookat_target,
                                     G.g_camera_block_target)) > 0.99999) {
      G.g_camera_settled = 1;
    }
    G.g_camera_turn_rate = T.tracking?.rate_untracked ?? 12;
    return;
  }
  ComputeLookAtAngleError();
}
