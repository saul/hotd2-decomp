/**
 * The stashed rail: the camera hook scene states (2,6) and (2,7) install, and
 * the three globals it steps.
 *
 * A `cam_play` whose flags have bit 2 does not play. `FUN_00403490` stashes
 * its range into `g_stashed_path_frame` / `g_stashed_path_end_frame` (and the
 * path into `g_active_cam_path`), and a later `finish_sequence 6` or `7` hands
 * the camera to a hook that steps that range one frame at a time:
 *
 * ```
 *   (2,6)  CameraStepDeferredRailWithFrameExport, then CameraStepRailTick
 *   (2,7)  CameraPlayStashedPath
 * ```
 *
 * Both publish the frame they drew as a **float** at `0x009C70BC`
 * (`g_rail_frame`), and it is that float -- not the walker's shot -- which
 * `CameraDriverSelectMode` and `CameraDriverFromDeferredPose` truncate into
 * `g_cam_path_frame` for every camera cue in the game to read.
 *
 * ## Why the range lives here, in `G`
 *
 * Because the stage-4 boss writes it. Its camera-cue routine at `0x00493090`
 * overwrites both stash words with its own cue's range and publishes its own
 * float frame while it flies the camera, and the arena thresholds it waits on
 * read the `g_cam_path_frame` that produces. With the range held by the script
 * walker, as it was, no game routine could reach it and the fight could never
 * leave its first phase. `G` is the one owner now; the walker's shot for a
 * deferred play mirrors it for the UI and the camera seat.
 *
 * ## What is not here
 *
 * The pose. Both hooks also `CamEvalPath7` the frame into the deferred pose
 * block at `0x009C70C0` / `g_cam_path_target` and derive the gameplay eye from
 * it; the port seats the camera block from the playing path in `app/`, which
 * is the same arrangement `CameraDriverFromDeferredPose` records. This file is
 * the frame arithmetic, which is what anything else reads.
 */
import { G } from "../globals";

/**
 * `[port-only]` as a function -- the gate both hooks put on the increment,
 * which each has inline, byte for byte:
 *
 * ```c
 * if (g_force_rail_advance == 1
 *     || IsDemoRun()
 *     || (g_screen_shake_frames == 0 && g_players_in_play != 0))
 *     g_stashed_path_frame += 1;
 * ```
 *
 * so a hit -- `g_screen_shake_frames` is 0x30 after one -- holds the rail
 * where it is, and so does the continue screen; the frame is still published.
 *
 * [diverges] **Not applied: the rail always advances.** Honouring it is
 * correct and exposes a second, older divergence it depends on. Under scene
 * state (2,6) the engine never writes the camera block from the rail -- the
 * rail draws into the deferred pose block and `CameraDriverSelectMode` eases
 * the aim -- but the port's seat (`seatCamera` in `app/systems.ts`, through
 * `CamSeatPathFrame`) snaps the block's eye **and aim** onto a stashed play
 * for as long as it is live. With the gate on, a hit mid-rail keeps the play
 * live past where the room clears, the seat snaps the aim back onto the rail,
 * and the room hands back in two frames instead of easing: `tools/handback.mjs`
 * measured stage 1's 1/4 go from 55 frames to 2 and stage 3's 1/2 from 43 to
 * 2. Switching this on needs the seat to leave a (2,6) play's aim to the
 * driver first, which changes how the camera aims in every stage, and is put
 * to the user rather than done here. `g_force_rail_advance` is written by the
 * script regardless, so the state is ready for it.
 */
function RailMayAdvance(): boolean {
  return true;
}

/**
 * `CameraStepRailTick` — `FUN_0040C790`. Scene state (2,6)'s steady body.
 * Returns whether it published a frame this call.
 *
 * ```
 * 0040c79e  CMP ECX, EAX; JGE 0040c889     ; cur >= end: only the tail
 *           if (gate) INC [0x9c70ac]        ; cur += 1 -- BEFORE it publishes
 * 0040c7d1  FILD [0x9c70ac]; FSTP [0x9c70bc]
 * 0040c889  g_cam_path_frames_left = end - cur
 * ```
 *
 * So a stashed `351..384` publishes `352..384`.
 */
export function CameraStepRailTick(): boolean {
  if (G.g_stashed_path_end_frame <= G.g_stashed_path_frame) return false;
  // `RailMayAdvance`'s three tests, inline in the routine at `0x0040C7A6`.
  if (RailMayAdvance()) G.g_stashed_path_frame += 1;
  G.g_rail_frame = G.g_stashed_path_frame;
  return true;
}

/**
 * `CameraPlayStashedPath` — `FUN_0040C8A0`. Scene state (2,7)'s hook: the same
 * routine with its guard one byte different -- `JG` at `0x0040C8C0` where the
 * rail has `JGE` -- so it stops only once `cur > end` and a stashed
 * `351..384` publishes `352..385`, one frame past its end. Stage 2's block 9
 * times a civilian's cue to that frame.
 */
export function CameraPlayStashedPath(): boolean {
  if (G.g_stashed_path_end_frame < G.g_stashed_path_frame) return false;
  // The same three tests, at `0x0040C8C6`.
  if (RailMayAdvance()) G.g_stashed_path_frame += 1;
  G.g_rail_frame = G.g_stashed_path_frame;
  return true;
}

/**
 * `CamStashPathRange` — `FUN_00403490`, the stash half of
 * `EvtActionCamPlay40`: the range into the two stash words. `start == -1`
 * means "from the frame the camera is on, plus one", which the caller has
 * already resolved into `start`. The routine's other writes -- the path into
 * `g_active_cam_path` and retiring the action -- are the walker's, in
 * `script/state/camera_action.ts`, which owns the shot and the ring.
 */
export function CamStashPathRange(start: number, end: number): void {
  G.g_stashed_path_frame = start;
  G.g_stashed_path_end_frame = end;
}
