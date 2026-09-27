/**
 * The stashed rail: the camera hooks scene states (2,6) and (2,7) install,
 * and the words they step.
 *
 * A `cam_play` whose flags have bit 2 does not play. `CamStashPathRange`
 * stashes its range into `g_stashed_path_frame` / `g_stashed_path_end_frame`
 * and its path into `g_active_cam_path`, and a later `finish_sequence 6` or
 * `7` enters a scene state whose camera hook steps that range one frame at a
 * time:
 *
 * ```
 *   (2,6)  CameraStepDeferredRailWithFrameExport, then CameraStepRailTick
 *   (2,7)  CameraPlayStashedPath
 * ```
 *
 * Every frame they step, both evaluate the path into the **deferred pose
 * block** -- `g_cam_path_eye` / `g_cam_path_target` and the angle words -- and
 * put the **gameplay eye** (`g_camera_eye`, the yaw) there, fifteen units
 * below the pose. **They never write the camera block.** The block reaches the
 * rail only through the queued action's driver, which runs earlier in the
 * frame (`CameraActorTick` before `CameraUpdateTick`) and so reads the pose
 * the rail left the frame before:
 *
 * * minor 6's `CameraDriverSelectMode` -- `CameraTrackEnemiesTick` snaps or
 *   eases the block eye onto the pose (`CameraEaseBlockEyeToPathPose`) and
 *   eases the aim onto whatever `SelectCameraLookAtTarget` wants, the pose's
 *   target when nobody is registered; the hand-back re-evaluates the path at
 *   `g_cam_path_frame`;
 * * minor 7's `CameraDriverFromDeferredPose` -- copies the pose block into the
 *   camera block whole.
 *
 * Both drivers end `g_cam_path_frame = __ftol(g_rail_frame)`, and that is the
 * frame every camera cue in the game reads: the one the rail drew on the
 * *previous* frame.
 *
 * The range lives in `G` because the stage-4 boss writes it too:
 * `Boss4PlayCameraCue` (`0x00493090`) overwrites both stash words with its own
 * cue's range and publishes its own float frame while it flies the camera.
 */
import { G } from "../globals";
import { IsDemoRun } from "../player_shell";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock,
         EvtActionRetire } from "./path";
import { CameraUpdateHook } from "./driver";

/**
 * `[0x004C4398]`, read as `00007041`: `15.0`. The path hooks put the gameplay
 * eye this far below the pose's eye.
 */
export const CAMERA_EYE_DROP = 15.0;

/**
 * `[port-only]` as a function -- the gate both hooks put on the increment,
 * which each has inline, byte for byte (`0x0040C7A6`, `0x0040C8C6`):
 *
 * ```c
 * if (g_force_rail_advance == 1
 *     || IsDemoRun()
 *     || (g_screen_shake_frames == 0 && g_players_in_play != 0))
 *     g_stashed_path_frame += 1;
 * ```
 *
 * So a hit -- `g_screen_shake_frames` is 0x30 after one -- holds the rail
 * where it is for the length of the shake, and so does the continue screen;
 * the frame is still published and the pose still evaluated. The shake is
 * the value `UpdateScreenShake` left on the *previous* frame: its task runs
 * after this one.
 */
export function RailMayAdvance(): boolean {
  return G.g_force_rail_advance === 1
      || IsDemoRun()
      || (G.g_screen_shake_frames === 0 && G.g_players_in_play !== 0);
}

/**
 * `[port-only]` as a function -- the tail both hooks share after the
 * increment, `0x0040C7D1`..`0x0040C883` and `0x0040C8F1`..`0x0040C9A3`:
 *
 * ```c
 * g_rail_frame = (float)g_stashed_path_frame;
 * CamEvalPath7(g_active_cam_path, g_rail_frame, &g_cam_path_eye, &g_cam_path_target, &roll);
 * CamBlockSetAnglesFromLookAt(&g_cam_path_eye, &g_cam_path_target, roll);
 * g_camera_eye_x = g_cam_path_eye.x;
 * g_camera_eye_y = g_camera_use_fixed_y == 1 ? g_camera_fixed_eye_y
 *                                            : g_cam_path_eye.y - 15.0;
 * g_camera_eye_z = g_cam_path_eye.z;
 * g_camera_roll_bams = 0;  g_camera_pitch_bams = 0;
 * g_camera_yaw_bams = (g_cam_path_yaw_bams + 0x8000) & 0xFFFF;
 * ```
 */
function CameraRailPublishPose(): void {
  G.g_rail_frame = G.g_stashed_path_frame;
  const roll = CamEvalPath7(G.g_active_cam_path, G.g_rail_frame,
                            G.g_cam_path_eye, G.g_cam_path_target);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Path, G.g_cam_path_target, roll);
  G.g_camera_eye.x = G.g_cam_path_eye.x;
  G.g_camera_eye.y = G.g_camera_use_fixed_y === 1
    ? G.g_camera_fixed_eye_y : G.g_cam_path_eye.y - CAMERA_EYE_DROP;
  G.g_camera_eye.z = G.g_cam_path_eye.z;
  G.g_camera_roll_bams = 0;
  G.g_camera_pitch_bams = 0;
  G.g_camera_yaw_bams = (G.g_cam_path_yaw_bams + 0x8000) & 0xffff;
}

/**
 * `CameraStepDeferredRailWithFrameExport` — `FUN_0040C770`. Scene state
 * (2,6)'s hook on its first call: it copies `g_stashed_path_frame` into
 * `0x009C709C` -- a word nothing in the image reads (no other reference, and
 * no byte pattern naming it), so the port keeps no field for it -- re-points
 * the hook at {@link CameraStepRailTick} and falls into it.
 */
export function CameraStepDeferredRailWithFrameExport(): void {
  G.g_camera_update_hook = CameraUpdateHook.StepRail;
  CameraStepRailTick();
}

/**
 * `CameraStepRailTick` — `FUN_0040C790`. Scene state (2,6)'s steady body.
 *
 * ```
 * 0040c79e  CMP ECX,EAX; JGE 0040c889     ; cur >= end: only the tail
 *           if (gate) INC [0x9c70ac]      ; cur += 1 -- BEFORE it publishes
 *           ...publish and evaluate...
 * 0040c889  g_cam_path_frames_left = end - cur
 * ```
 *
 * So a stashed `351..384` publishes `352..384`.
 */
export function CameraStepRailTick(): void {
  if (G.g_stashed_path_frame < G.g_stashed_path_end_frame) {
    if (RailMayAdvance()) G.g_stashed_path_frame += 1;
    CameraRailPublishPose();
  }
  G.g_cam_path_frames_left = G.g_stashed_path_end_frame
                           - G.g_stashed_path_frame;
}

/**
 * `CameraPlayStashedPath` — `FUN_0040C8A0`. Scene state (2,7)'s hook: it
 * re-points `g_camera_update_hook` at its own body (`0x0040C8B0`) and is
 * otherwise {@link CameraStepRailTick} with its guard one byte different --
 * `JG` at `0x0040C8C0` where the rail has `JGE` -- so it stops only once
 * `cur > end` and a stashed `351..384` publishes `352..385`, one frame past
 * its end. Stage 2's block 9 times a civilian's cue to that frame.
 */
export function CameraPlayStashedPath(): void {
  G.g_camera_update_hook = CameraUpdateHook.PlayStashedPath;
  if (G.g_stashed_path_frame <= G.g_stashed_path_end_frame) {
    if (RailMayAdvance()) G.g_stashed_path_frame += 1;
    CameraRailPublishPose();
  }
  G.g_cam_path_frames_left = G.g_stashed_path_end_frame
                           - G.g_stashed_path_frame;
}

/**
 * `CamStashPathRange` — `FUN_00403490`, the `flags & 2` arm of
 * `EvtActionCamPlay40`:
 *
 * ```c
 * g_active_cam_path        = operand[2];
 * g_stashed_path_frame     = operand[0] != -1 ? operand[0] : g_cam_path_frame + 1;
 * g_stashed_path_end_frame = operand[1];
 * [0x009C70B8]             = operand[3];      // the flags; nothing reads it
 * retire;
 * ```
 *
 * `start == -1` means "from the frame the camera is on, plus one". Four plays
 * in the game say -1 and all four are deferred: stage 1 blocks 3 and 8, in
 * both the Arcade and Original bundles.
 */
export function CamStashPathRange(slot: number, start: number,
                                  end: number): void {
  G.g_active_cam_path = slot;
  G.g_stashed_path_frame = start !== -1 ? start : G.g_cam_path_frame + 1;
  G.g_stashed_path_end_frame = end;
  EvtActionRetire();
}
