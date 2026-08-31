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
 * Has the camera path just reached a cue frame?
 *
 * The engine writes `g_cam_path_frame` once a frame through `__ftol`, stepping
 * by exactly one, so its own cue tests are plain equality: the counter cannot
 * pass a cue without landing on it. Here the clock is real elapsed time and a
 * slow frame advances it by two or more, which steps straight over an exact
 * cue and strands whatever was waiting on it. So the equality becomes a
 * crossing -- identical whenever the engine's assumption holds, and correct
 * when it does not.
 *
 * Only for the one-shot cues. Class 0x24 and 0x25 already ask `>=`, which is
 * what their code does. [diverges]
 */
export function CamPathCueReached(path: number, frame: number): boolean {
  if (G.g_active_cam_path !== path) return false;
  return G.g_cam_path_frame_prev < frame && frame <= G.g_cam_path_frame;
}
