/**
 * Class 0x26's per-actor state, at the offsets the engine keeps it.
 *
 * Only subtype 2 is ported — `Class26Subtype2Update` (`FUN_0048EAD0`), stage
 * 3's boat — and it keeps two words of its own beyond the fields every object
 * has.
 */

/**
 * `obj+0x11C` — the subtype `Class26InstallSubtypeUpdate` (`FUN_0048E290`)
 * switches on. Eight arms; one is read.
 */
export enum Class26Subtype {
  /** `Class26Subtype2Update` (`FUN_0048EAD0`) — the boat the player rides. */
  Boat = 2,
}

export interface VehicleTail {
  /**
   * `obj+0x00` — whether `Class26InstallSubtypeUpdate` has run and put the
   * subtype's routine in its own place. The engine stores the routine's
   * address; a snapshot cannot hold one, so this holds that it happened.
   */
  installed: boolean;
  /**
   * `obj+0x1350` — **face the camera.** While it is 1 the boat's yaw is the
   * camera block's plus `0x8000` instead of the path's. `Class26Subtype2Update`
   * raises and drops it at literal frames of each camera path it names.
   */
  faceCamera: number;
}

/** `[port-only]` — a fresh tail; the engine's is zeroed by the allocator. */
export function makeVehicleTail(): VehicleTail {
  return { installed: false, faceCamera: 0 };
}
