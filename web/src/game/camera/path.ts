/**
 * `CamAdvancePathFrame` — `FUN_004035E0`. The camera block, straight off the
 * rail.
 *
 * The queued `cam_play` action installs this as its per-frame handler and it
 * runs until the frame counter passes the command's end frame. Every frame it
 * runs it writes the camera block's **eye and look-at both**, with no easing
 * of any kind:
 *
 * ```c
 * CamEvalPath7(g_active_cam_path, (float)frame,
 *              &g_camera_block_eye + i, &g_camera_block_target + i, &roll, &_);
 * ```
 *
 * That is what keeps the script's deliberate cuts sharp: a new shot seats the
 * aim on its own target rather than swinging onto it. 148 of the 631
 * consecutive `cam_play` pairs in stages 1-6 turn the view by more than three
 * degrees at the seam and some by 173, so the cuts are the norm, not an edge
 * case — the smoothness the game is known for comes from
 * {@link CameraTrackEnemiesTick} easing *within* a shot, not from blending
 * between them.
 *
 * Once the action retires the block simply stops being written, and the camera
 * hook has it to itself. That is the state stage 2 block 17 step 5 sits in
 * while `wait_enemies_alive` holds.
 *
 * [diverges] `CamEvalPath7` itself is not here. The Hermite curves ship in the
 * camera bundle and are evaluated on the render side (`render/campath.ts`),
 * because that evaluator also has to draw the rails and answer the frame
 * scrubber; `game/` takes the pose it produced. The write into the block —
 * which is the part that matters to the camera's behaviour — is here.
 */
import { G } from "../globals";
import type { Vec3 } from "../vec";

/** Seat the camera block on the path pose for this frame. */
export function CamAdvancePathFrame(eye: Vec3, target: Vec3): void {
  G.g_camera_block_eye.x = eye.x;
  G.g_camera_block_eye.y = eye.y;
  G.g_camera_block_eye.z = eye.z;
  G.g_camera_block_target.x = target.x;
  G.g_camera_block_target.y = target.y;
  G.g_camera_block_target.z = target.z;
}

/**
 * The path's own look-at, for `SelectCameraLookAtTarget` to fall back on.
 *
 * `g_cam_path_target` is 0x009C70D8, the target half of the *second* pose
 * block — the one the deferred-rail hooks (`CameraStepRailTick`,
 * `CameraPlayStashedPath`) evaluate into. See the note on the global for why
 * the port refreshes it every frame and the engine does not.
 */
export function CamSetPathTarget(target: Vec3): void {
  G.g_cam_path_target.x = target.x;
  G.g_cam_path_target.y = target.y;
  G.g_cam_path_target.z = target.z;
}

/**
 * Has the camera path reached a cue frame?
 *
 * The engine writes `g_cam_path_frame` once a frame through `__ftol`, stepping
 * by exactly one, so its own cue tests are plain equality: the counter cannot
 * pass a cue without landing on it, and a script that is waiting is polled on
 * the frame it lands. Neither holds here.
 *
 * The clock is real elapsed time, so a slow frame advances it by two or more
 * and steps straight over an exact cue. And `seek` restores the camera frame
 * from the address without running the game, so a script can begin waiting on
 * a cue the camera is *already past* -- on a path that plays once, forward,
 * and never comes back to it.
 *
 * That second one is not hypothetical: it is stage 1's hostage. Its death
 * script waits on `(39, 60)`, and resuming at `block=1&step=8&op=12&frame=100`
 * put the camera at 100 before the civilian had been killed. The cue could
 * never fire, the script never reached its `LeaveCountNow`, and
 * `wait_scripted_actors 0` waited for ever.
 *
 * So a cue is what it reads as: **reached**. One-shot, and already-passed
 * counts as reached — which is exactly how classes 0x24 and 0x25 ask the same
 * question. In live play the first frame this is true is the frame the engine's
 * equality is true; the two only differ once something starts waiting late,
 * and there the engine would simply never answer. [diverges]
 */
export function CamPathCueReached(path: number, frame: number): boolean {
  return G.g_active_cam_path === path && G.g_cam_path_frame >= frame;
}
