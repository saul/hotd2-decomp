/**
 * Class 0x31's states.
 *
 * `[open]` — the thrower has its own 30-state machine and it has not been
 * read. Four states are ported, so only their sub-states are named here; the
 * outer state indices go in this enum as they are read.
 */

/**
 * The states class 0x31 dispatches on, from `PTR_FUN_00592960`. Two are ported.
 *
 * The 30-entry table is otherwise `[open]`; stage 2's class-0x31 descriptors
 * start in 18, 19, 20, 23 and 26, so most spawns are still entering a state
 * this port has not read.
 */
export enum ThrowerState {
  /** `ThrowerStateFallAndLand` (`FUN_0044A450`). Gravity, then a bounce. */
  FallAndLand = 2,
  /** The stand-and-throw state a leap or a fall lands into. */
  StandAndThrow = 7,
  /** `ThrowerStateLeapToPoint` (`FUN_0044E4C0`). The scripted drop. */
  LeapToPoint = 20,
  /** `ThrowerStatePathFollow` (`FUN_0044EE00`). A route walked before fighting. */
  PathFollow = 26,
}

/** `ThrowerStateThrow`'s sub-state, at `obj+0x1312`. */
export enum ThrowSub {
  /** Choose a hand and start its clip. */
  Draw = 0,
  /** The clip is running and the weapon has not left the hand. */
  Winding = 1,
  /** The weapon is away; play the clip out, then re-arm. */
  Thrown = 2,
}
