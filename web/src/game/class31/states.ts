/**
 * Class 0x31's states.
 *
 * `[open]` — the thrower has its own 30-state machine and it has not been
 * read. Four states are ported, so only their sub-states are named here; the
 * outer state indices go in this enum as they are read.
 */

/** `ThrowerStateThrow`'s sub-state, at `obj+0x1312`. */
export enum ThrowSub {
  /** Choose a hand and start its clip. */
  Draw = 0,
  /** The clip is running and the weapon has not left the hand. */
  Winding = 1,
  /** The weapon is away; play the clip out, then re-arm. */
  Thrown = 2,
}
