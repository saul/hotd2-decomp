/**
 * The shapes of `g_enemy_slots` and `g_camera_candidates`, on their own so
 * that `game/globals.ts` can build them without importing the routines that
 * use them -- `camera/slots.ts` imports `G`, and a value import back into it
 * would make the data segment's initialiser depend on module order.
 */
import { CAMERA_SLOTS } from "./constants";

/**
 * One entry of `g_enemy_slots` (`0x009A5EC0`): `{u8 occupied; void *actor}`,
 * stride 8. `at` stands in for the pointer. **The pointer survives a clear**:
 * the death paths zero the occupied byte alone, and the fill writes both.
 */
export interface CameraSlot {
  occupied: number;
  at: number;
  /**
   * `[port-only]` -- set instead of {@link at} when the slot was dealt to a
   * carried prop, which is no actor in the port. See `camera/slots.ts`.
   */
  prop: number | null;
}

/**
 * One entry of `g_camera_candidates` (`0x005A4DC8`): `{u32 key; void *obj}`.
 *
 * `prop` is set instead of a meaningful `at` when the object is a carried
 * prop, which registers through the same routine but is no actor.
 */
export interface CameraCandidate {
  key: number;
  at: number;
  prop: number | null;
}

/** Sixteen empty slots, the shape `ResetCameraEnemySlots` leaves. `[port-only]`. */
export function makeCameraSlots(): CameraSlot[] {
  return Array.from({ length: CAMERA_SLOTS }, () => ({ occupied: 0, at: 0, prop: null }));
}

/**
 * Camera blocks 1, 2 and 3 of `g_camera_blocks` (`0x009A6000`, stride
 * `0x1A4`): the words of each that anything in the image reads. Block 0 is
 * the port's `g_camera_block_*` fields, which every camera routine writes;
 * these three are written only by `CameraBlocksReset` (`FUN_004021D0`, all
 * zero), by `EvtRunQueuedActionsSyncViewBlock` (`FUN_004023D0`, block 2 from
 * block 0) and by `UpdateSceneViewAndLight`'s read-back of each block's angles
 * and eye. Their action handlers (`0x009A610C + b * 0x1A4`) are `NoOpStub`
 * from `CameraActorInit` on, and nothing installs another, so their path
 * frames stay at the reset's zero. `[proved]` for block 2's words (every
 * reference to `0x009A6408`, `0x009A6418` and `0x009A6458` read);
 * `[likely]` for blocks 1 and 3, which nothing reads unless `g_camera_index`
 * names them, and no shipped script does.
 *
 * `[port-only]` as a record: the engine's is a stretch of `0x1A4` bytes.
 */
export interface CameraBlockRecord {
  /** `+0x80` -- the eye. */
  eye: { x: number; y: number; z: number };
  /** `+0x8C`, `+0x90`, `+0x94` -- pitch, yaw and roll, in BAMS. */
  pitch: number;
  yaw: number;
  roll: number;
  /** `+0x98` -- the look-at. */
  target: { x: number; y: number; z: number };
  /** `+0xD0` of the block's `+0x40` half: the block's `g_cam_path_frame`. */
  pathFrame: number;
}

/** Blocks 1..3 as the reset leaves them. `[port-only]` as a constructor. */
export function makeCameraBlockRecords(): CameraBlockRecord[] {
  return [1, 2, 3].map(() => ({
    eye: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, roll: 0,
    target: { x: 0, y: 0, z: 0 }, pathFrame: 0,
  }));
}
