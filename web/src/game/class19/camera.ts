/**
 * The stage-4 boss's camera: the boss flies the camera itself between
 * phases, along its own arena's `cp_` path, and the frame it flies to is what
 * the arena's thresholds read.
 *
 * ## How the frame gets to `g_cam_path_frame`
 *
 * The script's own camera for the fight is `cam_play 185 0..0` (static: a
 * stash of path 185, or 193, with a zero-length range) and `finish_sequence
 * 6` -- scene state (2,6). That installs the stashed rail
 * (`CameraStepRailTick`, `game/camera/rail.ts`), which steps
 * `g_stashed_path_frame` towards `g_stashed_path_end_frame` and publishes it
 * as `g_rail_frame`, and `CameraDriverSelectMode`, which turns `g_rail_frame`
 * into `g_cam_path_frame`. `Boss4PlayCameraCue` writes the **same three
 * words**: it sets the stashed range to the cue's own `[start, end]`, then
 * every frame re-seats `g_stashed_path_frame` at its own fractional frame and
 * publishes that frame as `g_rail_frame`. So the rail plays the cue, at the
 * cue's pace, and every exact-equality cue in the fight (the chainsaw, the
 * charge, the despawn) is reached because no step exceeds 1.0.
 *
 * While a cue runs `g_camera_driver_held` is 1: `CameraDriverSelectMode`
 * parks in mode 6 and the boss owns the camera block -- `CamEvalPath7` puts
 * the eye on the path, and the aim turns a seventeenth of the way to
 * whatever `SelectCameraLookAtTarget` picked.
 */
import { G } from "../globals";
import type { GameHost } from "../host";
import type { CamPose } from "../camera/curve";
import { SelectCameraLookAtTarget } from "../camera/select_target";
import { TurnLookAtToward } from "../camera/turn";
import { vec3 } from "../vec";
import { Boss4Flag, Boss4Tables } from "./state";
import type { Boss4Block as Blk } from "./state";

/**
 * The cues that **keep** `state+0x00` bit `0x80` up after they start --
 * bytes `0x0049328C[cue - 5]` = `00 01 00 01 01 01 00 01 01 01 01 00`
 * through the two-entry table `0x00493284`: cues 5, 7, 11 and 16. Those end
 * in a charge, and holding the bit keeps `Boss4AdvancePhaseAtFloor` blocked
 * through the next cue as well.
 */
const CUES_KEEPING_QUEUED: ReadonlySet<number> = new Set([5, 7, 11, 16]);

/** `TurnLookAtToward(..., 1, 0x10)` -- a seventeenth of the way a frame. */
const AIM_NUM = 1;
const AIM_RATE = 0x10;

/**
 * `Boss4QueueCameraCue` — `FUN_004932A0`. `state+0x22 = (s16)cue;
 * state+0x00 |= 0x80`. The cue starts on the next `Boss4PlayCameraCue` that
 * finds none running.
 */
export function Boss4QueueCameraCue(b: Blk, cue: number): void {
  b.cueQueued = (cue << 16) >> 16;
  b.flags |= Boss4Flag.CueQueued;
}

const _pose: CamPose = { eye: vec3(), target: vec3(), roll: 0 };
const _eye = vec3();
const _desired = vec3();
const _current = vec3();
const _aim = vec3();

/**
 * `Boss4PlayCameraCue` — `FUN_00493090`. No arguments; the block is the one
 * `Boss4Update` published.
 *
 * ```
 * if (state+0x1C == 0.0 && (s16)state+0x22 >= 0) {          -- start
 *     rec = &g_boss4_camera_cues[state+0x22]
 *     unless the cue is 5, 7, 11 or 16: flags &= ~0x80
 *     state+0x22 = -1
 *     state+0x14 = (float)rec.start; +0x18 = (float)rec.end
 *     state+0x1C = rec.step; state+0x20 = rec.path
 *     g_stashed_path_frame = rec.start                       00493138
 *     g_stashed_path_end_frame = rec.end                     00493148
 *     g_camera_driver_held = 1                               0049314e
 * }
 * if (state+0x1C != 0.0) {                                  -- run, same call
 *     g_rail_frame = state+0x14                              00493173
 *     CamEvalPath7(path, state+0x14, &g_camera_block_eye, &local, ...)
 *     g_stashed_path_frame = __ftol(state+0x14)              004931a7
 *     if (!(state+0x14 < state+0x18)) { state+0x1C = 0.0; g_camera_driver_held = 0 }
 *     else state+0x14 += state+0x1C
 *     SelectCameraLookAtTarget()
 *     g_camera_block_target = TurnLookAtToward(eye, g_camera_lookat_target,
 *                                              g_camera_block_target, 1, 0x10)
 *     CamBlockSetAnglesFromLookAt(&g_camera_block_eye, &g_camera_block_target, 0)
 * }
 * ```
 *
 * `CamEvalPath7`'s own target is evaluated into a local and never read: the
 * aim comes from the turn. `CamBlockSetAnglesFromLookAt` (`FUN_00403AC0`)
 * has no line here because the port's camera block is its eye and target and
 * the draw derives the angles from them every frame (see `camera/shake.ts`).
 * A host with no paths leaves the eye where it is, as `BannerFlyCamera`
 * does; the frame words are written either way.
 */
export function Boss4PlayCameraCue(b: Blk, host: GameHost): void {
  if (b.cueStep === 0 && b.cueQueued >= 0) {
    const cue = b.cueQueued;
    const rec = Boss4Tables().camera_cues[cue]
      ?? { start: 0, end: 0, step: 0, path: 0 };
    if (!CUES_KEEPING_QUEUED.has(cue)) b.flags &= ~Boss4Flag.CueQueued;
    b.cueQueued = -1;
    b.cueFrame = rec.start;
    b.cueEnd = rec.end;
    b.cueStep = Math.fround(rec.step);
    b.cuePath = rec.path;
    G.g_stashed_path_frame = rec.start;
    G.g_stashed_path_end_frame = rec.end;
    G.g_camera_driver_held = 1;
  }
  if (b.cueStep === 0) return;

  G.g_rail_frame = b.cueFrame;
  // `CamEvalPath7` (`FUN_004041E0`) into the camera block's eye.
  const path = host.camPath?.(b.cuePath) ?? null;
  if (path) {
    path.pose(b.cueFrame, false, _pose);
    G.g_camera_block_eye.x = _pose.eye.x;
    G.g_camera_block_eye.y = _pose.eye.y;
    G.g_camera_block_eye.z = _pose.eye.z;
  }
  G.g_stashed_path_frame = Math.trunc(b.cueFrame);
  if (!(b.cueFrame < b.cueEnd)) {
    b.cueStep = 0;
    G.g_camera_driver_held = 0;
  } else {
    b.cueFrame = Math.fround(b.cueFrame + b.cueStep);
  }
  SelectCameraLookAtTarget();
  Object.assign(_eye, G.g_camera_block_eye);
  Object.assign(_desired, G.g_camera_lookat_target);
  Object.assign(_current, G.g_camera_block_target);
  TurnLookAtToward(_eye, _desired, _current, _aim, AIM_NUM, AIM_RATE);
  G.g_camera_block_target.x = _aim.x;
  G.g_camera_block_target.y = _aim.y;
  G.g_camera_block_target.z = _aim.z;
}
