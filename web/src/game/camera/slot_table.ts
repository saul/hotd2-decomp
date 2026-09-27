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
