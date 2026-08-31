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
 *   byte *is* written -- once, to **0**, at `0x0040322D` in `FUN_004031E0` --
 *   so it is zero for the life of the process and the branch is dead code all
 *   the same. (This note used to say "written in none", which was wrong: the
 *   store is there, it just never stores anything but zero. Same conclusion,
 *   sounder reason.)
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
  // `FUN_004022B0` clears `g_camera_settled` at the top of the camera actor
  // every frame and the convergence test below raises it again — it is a
  // *this frame* answer, not a latch. The port only ever raised it, so once
  // the aim had converged one time it stayed converged for the rest of the
  // stage and everything gated on it was permanently open. The engine's clear
  // lives one function earlier than this; the order within the frame is the
  // same. [diverges]
  G.g_camera_settled = 0;

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
    // `FUN_00401DF0` returns the *square* of the cosine and this is the
    // engine's own 0.99999. But it divides by both lengths, and returns 0
    // rather than NaN when either is degenerate -- which is a look-at sitting
    // exactly on the eye, before any path has seated the block. Zero fails the
    // test, so on that frame nothing would ever settle. Since room-clear gates
    // now hang off this, an unposed camera would park the script for good.
    //
    // So the degenerate case is answered directly instead: convergence is the
    // eased look-at having reached the desired one, and two coincident points
    // are converged whatever the eye is doing. A numerical guard on the port's
    // side, not a change to the rule. [diverges]
    const want = G.g_camera_lookat_target, have = G.g_camera_block_target;
    const gap = Math.abs(want.x - have.x) + Math.abs(want.y - have.y)
              + Math.abs(want.z - have.z);
    if (gap < 1e-4
        || Math.abs(LookAtCosineSquared(eye, want, have)) > 0.99999) {
      G.g_camera_settled = 1;
    }
    // `CameraTurnOntoPathTarget` raises `g_camera_free` on the same test, in
    // the same breath as `g_camera_settled` — that is the moment the swing
    // back onto the rail is over and a room-clear wait may pass.
    UpdateCameraFreeFlag();
    G.g_camera_turn_rate = T.tracking?.rate_untracked ?? 12;
    return;
  }
  ComputeLookAtAngleError();
  // Still tracking an enemy: the camera is claimed, so the flag is down.
  UpdateCameraFreeFlag();
}

/**
 * `g_camera_free`, as the engine's two camera drivers compute it between them.
 *
 * `FUN_00402E00` walks the four `g_enemy_slots` entries and raises the flag
 * only when none is claimed; `FUN_00402650` clears it on every frame the
 * camera is not in its return-to-path mode, which it enters only when
 * `g_enemies_alive` is zero and no slot is claimed. `CameraTurnOntoPathTarget`
 * then latches it when the eased look-at catches the path target.
 *
 * One routine here rather than that pair, so the three terms are written out:
 * nobody in the slots, nothing alive, and the aim converged. [diverges]
 */
export function UpdateCameraFreeFlag(): void {
  G.g_camera_free =
    G.g_enemy_slots.length === 0 && G.g_enemies_alive === 0
      && G.g_camera_settled !== 0 ? 1 : 0;
}
