/**
 * Class 0x21's own words, apart from the class module so `actor.ts` can name
 * the tail without importing the class — the same arrangement classes 0x20,
 * 0x24 and 0x25 have, and for the same reason: `registry.ts`'s file comment
 * records three separate hours lost to an ESM cycle resolving a table to
 * `undefined`.
 */

/**
 * `*obj` — which of the class's four routines the object is running.
 *
 * The numbers are the port's; the engine has function pointers here, and
 * `obj+0x1312` is the *sub*-state inside {@link RescueTargetState.RideIn}.
 */
export enum RescueTargetState {
  /** `RescueTargetRideInState` (`0x00451860`). */
  RideIn = 0,
  /** `RescueTargetHeldState` (`0x00451980`). */
  Held = 1,
  /** `RescueTargetFreedState` (`0x00451D80`). */
  Freed = 2,
  /** `RescueTargetAbandonedState` (`0x00451D20`). */
  Abandoned = 3,
}

/** `obj+0x1312` and the entry point, as one block. */
export interface RescueTargetTail {
  state: RescueTargetState;
  /** `obj+0x1312` — 0 while it rides in, 1 while it waits for the hand-over. */
  sub: number;
  /**
   * `obj+0x1350` — the row of `g_st2car_path_table` this actor takes its pose
   * from, and **the whole of how it comes to be on the car**.
   *
   * `RescueTargetInit` (`FUN_00451720`) leaves it at the zero `ActorAlloc`
   * wrote, which is `op_st2` path `0x148`; every way out of
   * `RescueTargetRideInState` (`FUN_00451860`) writes 1, which is `0x14E`.
   * Those are the same two routes `FUN_004521B0` gives the stage-2 car on
   * camera paths `0x38` and `0x39`.
   *
   * The word is class 0x25's `turnTarget` and class 0x33's path slot — L3,
   * three readings of one offset — so it lives on this arm.
   */
  route: number;
  /**
   * `obj+0x13CC`/`+0x13D0`/`+0x13D4` — the pose's change since last frame,
   * written by `RescueTargetPoseFromRouteWithVelocity` (`FUN_00451EB0`) and by
   * nothing else in this class.
   *
   * **Nothing in the engine reads it back** within the four class-0x21
   * routines, and nothing in the port does either; it is here because the
   * routine writes it and because the same three words are the head's `arcTo`
   * for classes 0x30 and 0x31 (L3 again), so it may not be written there.
   */
  delta: { x: number; y: number; z: number };
}

/**
 * [port-only] `ActorAlloc` zeroes the object, so the engine needs no
 * constructor here — this is the zero it leaves behind, written out.
 */
export function makeRescueTargetTail(): RescueTargetTail {
  return { state: RescueTargetState.RideIn, sub: 0, route: 0,
           delta: { x: 0, y: 0, z: 0 } };
}
