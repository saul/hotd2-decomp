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
}

/**
 * [port-only] `ActorAlloc` zeroes the object, so the engine needs no
 * constructor here — this is the zero it leaves behind, written out.
 */
export function makeRescueTargetTail(): RescueTargetTail {
  return { state: RescueTargetState.RideIn, sub: 0 };
}
