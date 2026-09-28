/**
 * The four camera blocks of `g_camera_blocks` (`0x009A6000`, stride `0x1A4`),
 * by index.
 *
 * Block 0 is the camera: every driver, hook and boss writes it, and it is the
 * port's `g_camera_block_*` fields. Blocks 1..3 are `G.g_camera_blocks_extra`.
 * Only block 2 is ever anything but zero:
 *
 * ```c
 * // EvtRunQueuedActionsSyncViewBlock (FUN_004023D0), g_camera_actor_major_hooks[1]
 * EvtRunQueuedActions();
 * if (g_scene_state_minor_entered == 3) {
 *     if (0x009C6F1C == 0) {
 *         block2.eye..roll    = block0.eye..roll;      // 24 bytes, 0x009A60C0 -> 0x009A6408
 *         block2.target..+0x17 = block0.target..;      // 24 bytes, 0x009A60D8 -> 0x009A6420
 *         CamBlockSetAnglesFromLookAt(&block2.eye, &block2.target, block0.roll);
 *     } else if (0x009C6F1C == 5) {
 *         CamBlockSetAnglesFromLookAt(&block2.eye, &block2.target, block2.roll);
 *     }
 * }
 * ```
 *
 * So block 2 is block 0 as it stood the last time the scene sat in state
 * (1,3) -- between rooms -- and it holds that through the next fight. Its path
 * frame is never written but by the reset, so it is 0. Seven cue tests accept
 * block 2's frame beside block 0's, and the frog's screen wedge is built on
 * block 2's yaw. `[proved]` (every reference to `0x009A6408`, `0x009A6418`,
 * `0x009A6458` and `0x009C6F1C` read.)
 */
import { G } from "../globals";
import { MatrixGetAngles } from "../carrier";
import { MatIdentity, MatrixGetTranslation, MatrixLoadIdentity,
         MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate }
  from "../matrix";
import { VecToAngles, type Vec3 } from "../vec";
import type { CameraBlockRecord } from "./slot_table";

const s16 = (v: number): number => (Math.trunc(v) << 16) >> 16;

/** Blocks 1..3; `null` for block 0, which is the `g_camera_block_*` fields. */
function Extra(index: number): CameraBlockRecord | null {
  if (index < 1 || index > 3) return null;
  return G.g_camera_blocks_extra[index - 1] ?? null;
}

/** `g_camera_blocks[index] + 0x80` -- a block's eye. `[port-only]` accessor. */
export function CameraBlockEyeAt(index: number): Vec3 {
  return Extra(index)?.eye ?? G.g_camera_block_eye;
}

/** `g_camera_blocks[index] + 0x90` -- a block's yaw. `[port-only]` accessor. */
export function CameraBlockYawAt(index: number): number {
  const b = Extra(index);
  return b ? b.yaw : G.g_camera_block_yaw_bams;
}

/**
 * `0x009A6110 + index * 0x1A4` -- a block's `g_cam_path_frame`.
 * `[port-only]` accessor.
 */
export function CameraPathFrameAt(index: number): number {
  const b = Extra(index);
  return b ? b.pathFrame : G.g_cam_path_frame;
}

/**
 * The cue test the scripted entrances and carriers share:
 *
 * ```c
 * if (g_cam_path_frame == cue || g_cam_path_frame_2 == cue)   // 0x009A6110, 0x009A6458
 * ```
 *
 * at `0x00457BE2`/`0x00457BEA` (`ZombieStateScriptedGrabAndDespawn`),
 * `0x004575F1` (`ZombieStateWaitCameraFrameThenBranch`), `0x004576A6`/`AE`
 * (`ZombieStateWaitForCameraFrame`), `0x00458AB9`/`BD`
 * (`ZombieStateArcScriptedEntrance`), `0x0044F070`/`78`
 * (`ThrowerStateGrabPlayer`), `0x004333D7`/`DF` (`ScriptedCarrierUpdate33`)
 * and `0x00433B1A` (class 0x33's selector 5, which has no port). **An equality on a frame that
 * passes once**: an actor that exists while its cue goes by fires, one that
 * misses it waits for the rest of the scene. Block 2's frame is 0, so a cue
 * of 0 fires at once; no shipped spawn names one. `[proved]`
 *
 * `[port-only]` as a function: the engine has the two compares inline.
 */
export function CamCueHit(frame: number): boolean {
  return G.g_cam_path_frame === frame || CameraPathFrameAt(2) === frame;
}

/**
 * `CamBlockSetAnglesFromLookAt` (`FUN_00403AC0`) on one of blocks 1..3: the
 * same routine as `camera/path.ts`'s, on another block's words.
 */
function CamBlockRecordSetAnglesFromLookAt(b: CameraBlockRecord,
                                           roll: number): void {
  const a = VecToAngles(b.eye.x - b.target.x, b.eye.y - b.target.y,
                        b.eye.z - b.target.z);
  b.pitch = s16(a.pitch);
  b.yaw = s16(a.yaw);
  b.roll = roll;
}

/**
 * `[port-only]` as a function -- `EvtRunQueuedActionsSyncViewBlock`
 * (`FUN_004023D0`) after its `CALL EvtRunQueuedActions`; the camera actor
 * makes that call itself. See the head of this file. `[proved]`
 */
export function CameraSyncViewBlock(): void {
  if (G.g_scene_state_minor_entered !== 3) return;
  const b = G.g_camera_blocks_extra[1];
  if (!b) return;
  if (G.g_camera_view_block_mode === 0) {
    const e = G.g_camera_block_eye, t = G.g_camera_block_target;
    b.eye.x = e.x; b.eye.y = e.y; b.eye.z = e.z;
    b.pitch = G.g_camera_block_pitch_bams;
    b.yaw = G.g_camera_block_yaw_bams;
    b.roll = G.g_camera_block_roll_bams;
    b.target.x = t.x; b.target.y = t.y; b.target.z = t.z;
    CamBlockRecordSetAnglesFromLookAt(b, G.g_camera_block_roll_bams);
  } else if (G.g_camera_view_block_mode === 5) {
    CamBlockRecordSetAnglesFromLookAt(b, b.roll);
  }
}

const _m = MatIdentity();

/**
 * `UpdateSceneViewAndLight`'s per-block body (`FUN_00401F40`, the loop from
 * `0x00402049`) on one of blocks 1..3: the view built from the block's eye and
 * angles, and the angles and eye read back out of it -- `MatrixGetAngles`
 * truncates each angle to whole BAMS, so the round trip can move one.
 *
 * `[port-only]` in one respect: the block's two matrices are not kept. Nothing
 * reads them -- the view is drawn from `g_camera_index`'s, and no shipped
 * writer makes that anything but 0.
 */
export function CameraBuildBlockView(b: CameraBlockRecord): void {
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, b.eye.x, b.eye.y, b.eye.z);
  MatrixRotateY(m, b.yaw);
  MatrixRotateX(m, b.pitch);
  MatrixRotateZ(m, b.roll);
  const a = MatrixGetAngles([m[0], m[4], m[8], m[1], m[5], m[9],
                             m[2], m[6], m[10]]);
  b.pitch = a.x;
  b.yaw = a.y;
  b.roll = a.z;
  MatrixGetTranslation(m, b.eye);
}
