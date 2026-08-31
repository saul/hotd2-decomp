/**
 * Class 0x31's states — the 35-entry table `g_class31_states` (0x00592960).
 *
 * Every entry is named here, whether or not it is ported, because the pick
 * tables name state ids directly and a bare number in a `switch` is how the
 * cat ended up running the zombie's machine. States 12 and 13 share state 9's
 * handler, and 14, 15 and 16 share one handler that branches on its own id.
 */

/** `g_class31_states` — 0x00592960. */
export enum ThrowerState {
  /** The engine's shared no-op, `0x0041EBB0`. */
  Idle = 0,
  /** `ThrowerStateHitReaction` (`FUN_0044A360`). The stumble. */
  HitReaction = 1,
  /** `ThrowerStateFallAndLand` (`FUN_0044A450`). Gravity, then a bounce. */
  FallAndLand = 2,
  /** `FUN_0044A930`. The death clip. */
  Death = 3,
  /** `FUN_0044A9D0`. The corpse sinking, then despawn. */
  Corpse = 4,
  /** `FUN_0044AB70`. The corpse, blinking out. */
  CorpseBlink = 5,
  /** `FUN_0044AD60`. Release everything and despawn. */
  Leave = 6,
  /**
   * `ThrowerStateStandAndDecide` (`FUN_0044B180`). The hub: stand, face the
   * camera, and ask `ThrowerPickNextState` what to do.
   */
  StandAndDecide = 7,
  /** `ThrowerStateWaitForPermit` (`FUN_0044B3E0`). Idle until a permit frees. */
  WaitForPermit = 8,
  /**
   * `ThrowerStateLeapDown` (`FUN_0044B670`). **The pounce**: arc onto the
   * camera with the attack's own clip, and connect on its hit frame.
   */
  Pounce = 9,
  /** `ThrowerStateLeapAside` (`FUN_0044B880`). The leap back out of your face. */
  LeapAside = 10,
  /** `ThrowerStateFallToSurface` (`FUN_0044BC70`). Fall until the ground catches. */
  FallToSurface = 11,
  /** Same handler as {@link Pounce}; the band-1 pick names this one. */
  PounceNear = 12,
  /** Same handler as {@link Pounce}; the band-2 pick names this one. */
  PounceFar = 13,
  /** `ThrowerStateLeapToSurface` (`FUN_0044C170`). Onto the far wall. */
  LeapToWallB = 14,
  /** ...the near wall. */
  LeapToWallA = 15,
  /** ...the ceiling. */
  LeapToCeiling = 16,
  /** `ThrowerStateGetUp` (`FUN_0044C2E0`). Motion 0x127, then decide again. */
  GetUp = 17,
  /** `ThrowerStateWalkDistance` (`FUN_0044E2A0`). Walk the descriptor's distance. */
  WalkDistance = 18,
  /** `ThrowerStateEntranceClip` (`FUN_0044E410`). Play the descriptor's clip. */
  EntranceClip = 19,
  /** `ThrowerStateLeapToPoint` (`FUN_0044E4C0`). The scripted drop. */
  LeapToPoint = 20,
  /** `ThrowerStateRideObjectPath` (`FUN_0044E5D0`). Object path 0x14F. */
  RideObjectPath = 21,
  /** `ThrowerStateLeapStrike` (`FUN_0044E6B0`). A pounce off the descriptor. */
  LeapStrike = 22,
  /**
   * `ThrowerStateDelayedPounce` (`FUN_0044E830`). A clip, then a leap at the
   * camera's own eye height. Stage 2 block 21 spawns two `zstin` this way.
   */
  DelayedPounce = 23,
  /** `ThrowerStateCloseAndStrike` (`FUN_0044EA50`). Close, then swing. */
  CloseAndStrike = 24,
  /** `ThrowerStateWithdraw` (`FUN_0044EC80`). Back off, then stand. */
  Withdraw = 25,
  /** `ThrowerStatePathFollow` (`FUN_0044EE00`). A route walked before fighting. */
  PathFollow = 26,
  /** `ThrowerStateGrabPlayer` (`FUN_0044EF90`). A camera-relative grab. */
  GrabPlayer = 27,
  /** `ThrowerStateWaitForCue` (`FUN_0044F510`). Wait, then jump to tail +3. */
  WaitForCue = 28,
  /** `ThrowerStateRearm` (`FUN_0044F7A0`). One hand gets its weapon back. */
  Rearm = 29,
  /** `ThrowerStateRestoreBothHands` (`FUN_0044F900`). Both do. */
  RestoreBothHands = 30,
  /** `ThrowerStateThrow` (`FUN_0044FAF0`). */
  Throw = 31,
  /** `ThrowerStateStrikeOnTheSpot` (`FUN_00450B20`). */
  StrikeOnTheSpot = 32,
  /** `ThrowerStateKnockedTumbling` (`FUN_00450E40`). */
  KnockedTumbling = 33,
  /**
   * `ThrowerStateBlinkInThreeHops` (`FUN_00451480`). Three blinking hops in
   * from 90 units out, not the retreat an earlier reading called it.
   */
  BlinkIn = 34,
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

/** `g_class31_motion_sets`' six entries. */
export enum ThrowerMotion {
  /** The stand `ThrowerStateWaitForPermit` picks between at random. */
  Idle = 0,
  IdleAlt = 1,
  /** The walk states 7 and 18 play, picked by `obj+0x34` bit 27. */
  Walk = 2,
  WalkAlt = 3,
  /** The clip `ThrowerStateLeapAside` and `ThrowerStateWithdraw` land into. */
  Land = 4,
  /** The airborne clip `ThrowerStateFallAndLand` plays. `[open]` otherwise. */
  Airborne = 5,
}

/**
 * `ThrowerPickNextState`'s distance bands, measured on the ground plane to the
 * camera. Band 0 exists in the table and is unreachable: the router starts at
 * 2 and only ever lowers it to 1.
 */
export enum ThrowerBand {
  /** `40 < d <= 50` — the band whose picks are the wall and ceiling leaps. */
  Near = 1,
  /** Everything else outside the close threshold. */
  Far = 2,
}

/** Inside this the router goes straight to `WaitForPermit`. `[proved]` 30.0. */
export const CLOSE_RANGE = 30;
/** `ThrowerPickNextState`'s band-1 window. */
export const BAND_NEAR_MIN = 40;
export const BAND_NEAR_MAX = 50;

/** `ThrowerStateStandAndDecide` turns this fast and calls it aimed this close. */
export const STAND_TURN_RATE = 0x200;

/** `ThrowerStateLeapAside` and `ThrowerStateWithdraw`'s two exits. */
export const LEAP_ASIDE_FRAMES = 0x5a;
export const LEAP_ASIDE_CLEAR = 50;

/**
 * `ActorArcBeginToAtSpeed` — 30 world units per `minFrames`, so 2.0 units a
 * frame in the ordinary case and 3.0 in the fast one.
 */
export const ARC_SPEED_UNITS = 30;
export const ARC_MIN_FRAMES = 15;
export const ARC_MIN_FRAMES_FAST = 10;

/** `ThrowerFindWallBeside` traces this far to each side. */
export const WALL_PROBE_REACH = 60;
/** ...at the ground height plus this, and lands this far short of the wall. */
export const WALL_PROBE_RISE = 9;
export const WALL_PROBE_SPREAD = 20;
export const WALL_STANDOFF = 4.5;
/** `ThrowerFindCeilingAbove` traces this far up. */
export const CEILING_PROBE_REACH = 1000;
/** ...and both refuse unless the actor is facing the camera this closely. */
export const WALL_FACING_TOLERANCE = 0x2000;

/** `ThrowerStateLeapAside`'s landing point, relative to the camera. */
export const ASIDE_SIDEWAYS = 5;
export const ASIDE_AHEAD = 50;
