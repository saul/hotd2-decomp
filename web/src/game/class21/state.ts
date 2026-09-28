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
  /**
   * `RescueTargetSinkAndDespawnState` (`0x00451DF0`) -- the routine
   * `RescueTargetFreedState` installs once its clip has played out.
   */
  Sinking = 4,
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
   * `RescueTargetInit` (`FUN_00451720`) writes it 0 itself in its
   * non-Training arm -- `MOV dword ptr [ESI + 0x1350], 0x0` at `0x004517D7`
   * -- which is `op_st2` path `0x148`; every way out of
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
   * written by `RescueTargetPoseFromRouteWithVelocity` (`FUN_00451EB0`).
   *
   * **It is the car's velocity, and the freed actor keeps it.**
   * `RescueTargetFreedDrift` (`FUN_00451F40`) adds x and z to the position
   * every frame after the rescue and bleeds both away over frames 11..20, so
   * the body leaves the car at the car's own speed. This said nothing read
   * it back, from a reading of the four state routines that took the drift
   * for part of the draw. The same three words are the head's `arcTo` for
   * classes 0x30 and 0x31 (L3), so they live on this arm.
   */
  delta: { x: number; y: number; z: number };
  /**
   * `obj+0x1334` -- frames since the rescue. `RescueTargetHeldState`
   * (`FUN_00451980`) zeroes it as it frees the actor (`MOV [ESI+0x1334], EBX`
   * at `0x00451BBA`) and `RescueTargetFreedDrift` (`FUN_00451F40`) is its only
   * reader and its only other writer, one `+1` a call; frames 11..20 are the
   * ones that bleed {@link delta} away.
   */
  freedFrames: number;
  /**
   * `model+0x5D` (`obj+0x1F1`) -- the byte `SkeletonAdvancePlayCursor`
   * (`FUN_004111A0`) clears and then raises when the play cursor has reached
   * the play length, inside `RescueTargetDraw` (`FUN_00451FF0`)'s draw and
   * only when that draw is made. `RescueTargetFreedState` (`FUN_00451D80`)
   * reads it straight after the draw. `[port-only]` as a field of the tail:
   * the engine's lives in the model block, which the port does not carry for
   * this class -- the same arrangement class 0x22's `done` has.
   */
  clipEnded: number;
  /**
   * `obj+0x1338` -- the sink's countdown, 0x78 from the frame the freed clip
   * ends (`MOV dword ptr [ESI+0x1338], 0x78` at `0x00451DB9`).
   */
  sinkFrames: number;
}

/**
 * [port-only] `ActorAlloc` zeroes the object, so the engine needs no
 * constructor here — this is the zero it leaves behind, written out.
 */
export function makeRescueTargetTail(): RescueTargetTail {
  return { state: RescueTargetState.RideIn, sub: 0, route: 0,
           delta: { x: 0, y: 0, z: 0 }, freedFrames: 0, clipEnded: 0,
           sinkFrames: 0 };
}
