/**
 * The `cam_play` action: the camera block straight off the rail, and the
 * path-frame bookkeeping everything else reads.
 *
 * ```
 * EvtActionCamPlay40 (FUN_00403360)
 *   start == end  -> CamEvalStaticPose     (FUN_004033B0)  a held pose
 *   flags & 2     -> CamStashPathRange     (FUN_00403490)  camera/rail.ts
 *   otherwise     -> CamStartPathPlayback  (FUN_00403510)
 *                      -> installs and calls CamAdvancePathFrame (FUN_004035E0)
 * ```
 *
 * `CamAdvancePathFrame` is the action handler `EvtRunQueuedActions` calls once
 * a frame, **inside `CameraActorTick`** -- so before the scene state's hook,
 * the players and every actor. Every frame it runs it writes the camera
 * block's eye **and** look-at with no easing of any kind, which is what keeps
 * the script's deliberate cuts sharp: 148 of the 631 consecutive `cam_play`
 * pairs in stages 1-6 turn the view by more than three degrees at the seam.
 * The smoothness the game is known for comes from `CameraTrackEnemiesTick`
 * easing *within* a shot.
 *
 * Every word here is the engine's and lives in `G`: the cursor, the end, the
 * published frame and the frames left, the active path, and the handler
 * identity (`G.g_camera_action_driver`). The walker's `CamCommand` is the
 * script's description of the shot for the player's own panels; nothing in
 * the game reads it.
 */
import { G } from "../globals";
import { T } from "../tables";
import { VecToAngles, type Vec3 } from "../vec";
import { EvtActionHandler } from "./driver";

/**
 * The pose blocks `CamBlockSetAnglesFromLookAt` is handed a pointer to.
 * `[port-only]` as an enum: the engine passes the block's address.
 */
export enum CameraPoseBlock {
  /** `g_camera_blocks + 0x80` -- `g_camera_block_eye`, the block drawn. */
  Camera = 0,
  /** `0x009C70C0` -- `g_cam_path_eye`, the deferred pose block. */
  Path = 1,
  /**
   * `0x009A6408` -- `g_camera_block2_eye`, camera block 2, which
   * `EvtRunQueuedActionsSyncViewBlock` passes (`PUSH 0x9a6408` at
   * `0x00402450`).
   */
  Block2 = 2,
}

/**
 * `CamEvalPath7` — `FUN_004041E0`. One frame of a `cp_` path: the eye into
 * `eye`, the look-at into `target`, and the roll, which is returned.
 *
 * Channels 0-5 always; channel 6, the roll, only while `g_cam_roll_enabled`
 * (`DAT_009A21B0`, evt opcode 0x35) is set, and `__ftol`'d -- 0 otherwise.
 * The curve maths is `CamPath.channel` in `camera/curve.ts`; the paths are
 * the stage's, from {@link T.camPaths}. A slot the stage has no path for
 * writes nothing and returns 0 `[port-only]`: the engine's table always has
 * one.
 */
export function CamEvalPath7(slot: number, frame: number,
                             eye: Vec3, target: Vec3): number {
  const p = T.camPaths?.paths.get(slot);
  if (!p) return 0;
  eye.x = p.channel(0, frame);
  eye.y = p.channel(1, frame);
  eye.z = p.channel(2, frame);
  target.x = p.channel(3, frame);
  target.y = p.channel(4, frame);
  target.z = p.channel(5, frame);
  return G.g_cam_roll_enabled !== 0 ? Math.trunc(p.channel(6, frame)) : 0;
}

/** An `s16`, as `VecToAngles` stores its two outputs. */
const s16 = (v: number): number => (Math.trunc(v) << 16) >> 16;

/**
 * `CamBlockSetAnglesFromLookAt` — `FUN_00403AC0`, `(block, target, roll)`.
 *
 * ```c
 * VecToAngles(block.eye - target, &block+0x0C, &block+0x10);   // pitch, yaw
 * block+0x14 = roll;
 * ```
 *
 * The look-at is its **own argument** (`[ESP+0xC]` at `0x00403ACF`), not the
 * block's `+0x18`: every caller in the camera passes the block's own target,
 * but the angle is of whatever it is handed. The vector is **eye minus
 * target**, so the yaw faces back along the view and the pitch is positive
 * looking up; the scene-state hooks turn the yaw half round (`+ 0x8000`) when
 * they copy it into `g_camera_yaw_bams`.
 */
export function CamBlockSetAnglesFromLookAt(block: CameraPoseBlock,
                                            target: Vec3, roll: number): void {
  const cam = block === CameraPoseBlock.Camera;
  const eye = cam ? G.g_camera_block_eye
    : block === CameraPoseBlock.Block2 ? G.g_camera_block2_eye
    : G.g_cam_path_eye;
  const a = VecToAngles(eye.x - target.x, eye.y - target.y, eye.z - target.z);
  if (cam) {
    G.g_camera_block_pitch_bams = s16(a.pitch);
    G.g_camera_block_yaw_bams = s16(a.yaw);
    G.g_camera_block_roll_bams = roll;
  } else if (block === CameraPoseBlock.Block2) {
    G.g_camera_block2_pitch_bams = s16(a.pitch);
    G.g_camera_block2_yaw_bams = s16(a.yaw);
    G.g_camera_block2_roll_bams = roll;
  } else {
    G.g_cam_path_pitch_bams = s16(a.pitch);
    G.g_cam_path_yaw_bams = s16(a.yaw);
    G.g_cam_path_roll_bams = roll;
  }
}

/**
 * `[port-only]` as a function -- the tail every slot-0 action handler ends on
 * when it completes: `g_evt_action_advance = 1; g_queued_events_pending--`.
 * The handler stays in the slot; `EvtRunQueuedActions` replaces it, with the
 * next action or with `NoOpStub`. See `camera/actions.ts`.
 */
export function EvtActionRetire(): void {
  G.g_evt_action_advance = 1;
  G.g_queued_events_pending -= 1;
}

/**
 * `CamAdvancePathFrame` — `FUN_004035E0`. One frame of a playing `cam_play`.
 *
 * Read off the instruction stream at `0x00403605`..`0x0040368D`:
 *
 * ```
 * cur = g_cam_path_cursor
 * g_cam_path_frame = cur                                  ; publish -- BEFORE the end test
 * CamEvalPath7(g_active_cam_path, cur, &block.eye, &block.target, &roll)
 * CamBlockSetAnglesFromLookAt(&block, &block.target, roll)
 * g_cam_path_frames_left = end - cur
 * cursor = cur + 1
 * if (cur >= end) retire                                   ; CMP ECX,EAX / JL
 * ```
 *
 * So the block holds the pose of every frame from `start` to `end`
 * **inclusive**, and the frame after the end is the first no handler writes.
 */
export function CamAdvancePathFrame(): void {
  const cur = G.g_cam_path_cursor;
  G.g_cam_path_frame = cur;
  const roll = CamEvalPath7(G.g_active_cam_path, cur,
                            G.g_camera_block_eye, G.g_camera_block_target);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target,
                              roll);
  G.g_cam_path_frames_left = G.g_cam_path_end_frame - G.g_cam_path_cursor;
  G.g_cam_path_cursor = cur + 1;
  if (G.g_cam_path_end_frame <= cur) EvtActionRetire();
}

/**
 * `CamStartPathPlayback` — `FUN_00403510`. The playing half of
 * `EvtActionCamPlay40`.
 *
 * ```c
 * if (!(flags & 4)) {
 *     g_active_cam_path = operand[2];
 *     if (operand[0] == -1) { cursor = g_cam_path_frame;              end = operand[1]; }
 *     else                  { g_cam_path_frame = cursor = operand[0]; end = operand[1]; }
 * } else {
 *     g_cam_path_frame = operand[0];  cursor = g_stashed_path_frame;  end = g_stashed_path_end_frame;
 * }
 * block+0x114 = flags;
 * g_evt_action_handler = CamAdvancePathFrame;  CamAdvancePathFrame(slot);
 * ```
 *
 * `start == -1` resumes from the frame the camera is on, with no `+ 1`: the
 * handler publishes before it increments. No shipped play sets `flags & 4`,
 * and none passes -1 here. Its training-mode arm, which swaps the path for
 * the lesson's own, belongs to a mode the port does not play.
 */
export function CamStartPathPlayback(slot: number, start: number,
                                     end: number, flags = 0): void {
  if ((flags & 4) === 0) {
    G.g_active_cam_path = slot;
    if (start === -1) {
      G.g_cam_path_cursor = G.g_cam_path_frame;
    } else {
      G.g_cam_path_frame = start;
      G.g_cam_path_cursor = start;
    }
    G.g_cam_path_end_frame = end;
  } else {
    G.g_cam_path_frame = start;
    G.g_cam_path_cursor = G.g_stashed_path_frame;
    G.g_cam_path_end_frame = G.g_stashed_path_end_frame;
  }
  G.g_evt_action_handler = EvtActionHandler.PathPlay;
  CamAdvancePathFrame();
}

/**
 * `CamEvalStaticPose` — `FUN_004033B0`. `start == end`: one frame, written
 * into the block, and the action retires on the spot.
 *
 * ```c
 * g_cam_path_frame = operand[0];
 * CamEvalPath7(g_active_cam_path = operand[2], operand[0], &block.eye, &block.target, &roll);
 * CamBlockSetAnglesFromLookAt(&block, &block.target, roll);
 * retire;
 * ```
 *
 * (Its Original Mode arm swaps path `0x1A2` for a character's own; no bundle
 * the port reads names it.)
 */
export function CamEvalStaticPose(slot: number, frame: number): void {
  G.g_cam_path_frame = frame;
  G.g_active_cam_path = slot;
  const roll = CamEvalPath7(slot, frame, G.g_camera_block_eye,
                            G.g_camera_block_target);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target,
                              roll);
  EvtActionRetire();
}

/**
 * Has the camera path reached a cue frame?
 *
 * The engine writes `g_cam_path_frame` once a frame through `__ftol`, stepping
 * by exactly one, so its own cue tests are plain equality: the counter cannot
 * pass a cue without landing on it, and a script that is waiting is polled on
 * the frame it lands. That holds here too -- the port's clock is the engine's
 * fixed tick -- except across a **seek**, which restores the camera frame from
 * the address without running the game, so a script can begin waiting on a
 * cue the camera is *already past*, on a path that plays once, forward, and
 * never comes back to it.
 *
 * That is not hypothetical: it is stage 1's hostage. Its death script waits
 * on `(39, 60)`, and resuming at `block=1&step=8&op=12&frame=100` put the
 * camera at 100 before the civilian had been killed. The cue could never
 * fire, the script never reached its `LeaveCountNow`, and
 * `wait_scripted_actors 0` waited for ever.
 *
 * So a cue is what it reads as: **reached**. One-shot, and already-passed
 * counts as reached -- which is exactly how classes 0x24 and 0x25 ask the same
 * question. In live play the first frame this is true is the frame the
 * engine's equality is true; the two only differ once something starts
 * waiting late, and there the engine would simply never answer. [diverges]
 */
export function CamPathCueReached(path: number, frame: number): boolean {
  return G.g_active_cam_path === path && G.g_cam_path_frame >= frame;
}
