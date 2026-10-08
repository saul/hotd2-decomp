/**
 * The words class 0x27 keeps on its object, apart from the class module so
 * `actor.ts` can name them without importing the class -- the arrangement
 * class 0x28's `state.ts` has, and for its reason.
 *
 * `obj+0x1312` is the handler's own cursor and is the head's `Actor.sub`;
 * `obj+0x11C` is the route index and is the head's `Actor.hp` -- `L3`: on
 * this class it is never hit points.
 */

/**
 * Which routine `obj+0x00` holds. `[port-only]` as an enum: the engine stores
 * a code address, and a snapshot cannot hold one.
 */
export enum PathRidingVehicleRoutine {
  /** `PathRidingVehicleUpdate` (`FUN_004329D0`), what the spawn stores. */
  Ride = 0,
  /**
   * `PathRidingVehicleHeldUpdate` (`FUN_00432AF0`), stored by the ride once
   * `g_cam_path_frame` reaches `0xBE` or a skip runs.
   */
  Held = 1,
}

export interface PathRidingVehicleTail {
  /** `obj+0x00` -- see {@link PathRidingVehicleRoutine}. */
  routine: PathRidingVehicleRoutine;
  /**
   * `obj+0x13F0` -- the body's slot. `0x2B` on the first frame, `0x33` from
   * the frame the routine is swapped; nothing else writes it.
   */
  drawSlot: number;          // +0x13F0
  /**
   * `obj+0x1320` -- the cel counter `PathRidingVehicleDraw` (`FUN_00432B10`)
   * steps, **in the draw**, before it names the two cels: `++n` and then
   * slot `n < 0x28 ? 0x1433 + n % 0x28 : 0x1AAB + n % 0x28` and `0xB67 +
   * n % 8`. Zero from `ActorClearGameFields`, so the first cel drawn is
   * `0x1434`.
   */
  cel: number;               // +0x1320
  /**
   * `obj+0x1324` -- raised with the swap; while it is up, and `obj+0x11C` is
   * below 2, the draw adds the two cels.
   */
  burning: number;           // +0x1324
}

/** `[port-only]` -- a fresh tail; `ActorClearGameFields` zeroes the engine's. */
export function makePathRidingVehicleTail(): PathRidingVehicleTail {
  return { routine: PathRidingVehicleRoutine.Ride, drawSlot: 0, cel: 0,
           burning: 0 };
}
