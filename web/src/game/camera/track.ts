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
    G.g_camera_turn_rate = T.tracking?.rate_untracked ?? 12;
    return;
  }
  ComputeLookAtAngleError();
}

/**
 * `g_camera_free` — `CameraDriverFromDeferredPose` (`FUN_00402E00`).
 *
 *     g_camera_free = 1;
 *     for (p = &g_enemy_slots; p < 0x009A5EE0; p += 8)
 *         if (*p != 0) { g_camera_free = 0; break; }
 *
 * Four slots, stride 8, and the flag is the *occupied* byte of each — nothing
 * else. `g_enemy_slots` here holds only the claimed slots, so the walk is a
 * length test.
 *
 * The room-clear waits `0x43`, `0x44` and `0x46` all require this on top of
 * their counter, so a room does not hand over while an enemy still holds the
 * camera.
 *
 * **Two things this deliberately does not do**, both of which an earlier cut
 * of this function got wrong and which parked the script:
 *
 * - It does not require `g_enemies_alive == 0`, and it does not require the
 *   aim to have converged. Those belong to `FUN_00402650`, the *other*
 *   per-frame camera driver — the two are alternatives selected by the
 *   `finish_sequence` minor (`DAT_00576B20[minor]`: 4 and 6 install
 *   `FUN_00402650`, 7 installs this one), not a pair that both run. ANDing all
 *   three terms is stronger than either driver and holds a room-clear gate for
 *   ever whenever anything is still alive. This port models the driver it can
 *   represent. [diverges]
 * - It does not wait out the swing back onto the rail. The engine explicitly
 *   refuses to: every enemy death site frees the actor's slot and then forces
 *   this flag straight to 1 (`0x00480416` then `0x0048042C`; `0x00428B44`
 *   right after `g_enemies_present--`), so the gate opens on the death frame.
 *   Here the slot list is rebuilt from the live actors every frame, so a dead
 *   enemy leaves it on its own and the flag rises the same way — one frame
 *   later than the engine's explicit store. [diverges]
 */
export function UpdateCameraFreeFlag(): void {
  G.g_camera_free = G.g_enemy_slots.length === 0 ? 1 : 0;
}
