/**
 * Class 0x43's object, apart from the class module so `actor.ts` can name it
 * without importing the class.
 *
 * **This is not a sub-block.** `PlaceOwlFlockMember` (`FUN_00445DB0`) is a
 * *placer*: it allocates a second, 0x2A0-byte object and kills itself, and
 * everything below lives in that object's own body rather than in an
 * `ActorAllocSub` block. The offsets are the owl object's, and it is not a
 * combat actor — 0x2A0 bytes, no skeleton, no motion block, no `obj+0x1390`.
 */

/** `obj+0x220` — the index into `g_class43_states` (`0x00592944`). */
export enum OwlState {
  /**
   * `OwlStateWaitLaunchDelay` (`FUN_004464C0`). Perched, for
   * `g_class43_launch_delay[member] * 20` frames.
   */
  WaitLaunch = 0,
  /**
   * `OwlStateCircleHoldingPoint` (`FUN_004466C0`). Circles a hard-coded world
   * point until its dwell is up **and** the group's one attack token is free.
   */
  Circle = 1,
  /** `OwlStateFlyToHoldingPoint` (`FUN_00446D20`). A lerp out to that circle. */
  FlyToCircle = 2,
  /**
   * `OwlStateRideApproachSpline` (`FUN_00446860`). The run-in, along a
   * quadratic B-spline the descriptor's subtype and member index select.
   */
  Approach = 3,
  /**
   * `OwlStateDiveAtCamera` (`FUN_00446F30`). The strike, and the only state
   * that damages the player.
   */
  Dive = 4,
  /**
   * `OwlStateOrbitAwayAfterStrike` (`FUN_00447690`). Half an orbit out, then
   * back into {@link OwlState.Dive} — **the loop never ends**, and an owl only
   * leaves the level by being shot.
   */
  OrbitAway = 5,
  /**
   * Dead. `g_class43_states[6]` is a bare `RET`; the update has already been
   * swapped for `OwlCorpseFallAndSettle`.
   */
  Dead = 6,
}

/** `obj+0x244` — which of the two dive trajectories is running. */
export enum OwlDiveKind {
  /** Idle, between the pull-out and the next launch. */
  None = 0,
  /**
   * **Home on the camera eye.** A plain accelerating lerp. Reached exactly
   * once per owl: from the Init for sub-type 0, and off the spline for
   * sub-types 1 and 3. Sub-type 2 never reaches it at all.
   */
  Home = 1,
  /**
   * **Leave.** The lerp plus a lateral sway about the launch heading, and the
   * only arm any relaunch uses.
   */
  Sway = 2,
}

/** `obj+0x2A0` — the whole of a class-0x43 owl beyond the common actor head. */
export interface OwlTail {
  /** `obj+0x1A0/1A4/1A8` — velocity, and the only thing that moves it. */
  vx: number; vy: number; vz: number;
  /** `obj+0x1AC/1B0/1B4` — the point every state steers toward. */
  tx: number; ty: number; tz: number;
  /** `obj+0x1B8/1BC/1C0` — the holding point {@link OwlState.FlyToCircle} lerps to. */
  holdX: number; holdY: number; holdZ: number;
  /** `obj+0x1C4/1C8/1CC` — where the current lerp started. */
  fromX: number; fromY: number; fromZ: number;
  /** `obj+0x1D0/1D4/1D8` — last frame's position, for the heading. */
  prevX: number; prevY: number; prevZ: number;
  /** `obj+0x1DC/1E0/1E4` — the circle or orbit centre. */
  centreX: number; centreY: number; centreZ: number;
  /** `obj+0x1E8/1EC` — the two-player aim offset, so two owls come in apart. */
  aimX: number; aimZ: number;
  /** `obj+0x1F0` — the heading from the spawn point to the camera, at spawn. */
  launchYaw: number;
  /** `obj+0x1F4` — the circling or orbiting phase, BAMS. */
  orbitPhase: number;
  /** `obj+0x1F8` — the corpse's pitch spin. */
  spin: number;
  /** `obj+0x1FC` and `obj+0x204` — the dive's lateral sway, and its rate. */
  swayPhase: number;
  swayRate: number;
  /**
   * `obj+0x208`, `+0x20C`, `+0x210`, `+0x214`, `+0x218` — five angles that
   * exist only for `OwlDrawBodyChain` (`FUN_00447C20`) to pose limbs with.
   * Carried because the states write them and a snapshot has to restore them.
   */
  limbA: number; limbB: number; limbC: number; limbD: number; limbE: number;
  /** `obj+0x21C` — the dive's own counter, driving a 15-frame limb strip. */
  diveFrame: number;
  /** `obj+0x220`. */
  state: OwlState;
  /** `obj+0x224` and `obj+0x228` — from the descriptor's `+0x25` and `+0x22`. */
  subtype: number;
  member: number;
  /** `obj+0x230` — arriving at the holding point circles rather than dives. */
  circleOnArrival: number;
  /** `obj+0x234` — which way it peels off, +1 or -1. */
  escapeDir: number;
  /**
   * `obj+0x238` — toggled on every strike and **read by nothing**, inside the
   * class or out. Carried because the engine writes it. `[open]`.
   */
  strikeToggle: number;
  /** `obj+0x240` — the wing beat, 0..29. */
  beat: number;
  /** `obj+0x244`. */
  dive: OwlDiveKind;
  /** `obj+0x248` — how long {@link OwlState.Circle} holds: 55 or 88 frames. */
  dwell: number;
  /** `obj+0x24C` — the per-state frame counter. */
  timer: number;
  /** `obj+0x250` and `obj+0x26C` — the corpse's bounce latch and settle flag. */
  bounced: number;
  settled: number;
  /** `obj+0x270` and `obj+0x274` — the lerp's parameter and its rate. */
  t: number;
  rate: number;
  /** `obj+0x290` — the holding circle's radius, always 6.28. */
  radius: number;
  /** `obj+0x294` — the sway amplitude, from the distance at launch. */
  sway: number;
  /** `obj+0x298` and `obj+0x29C` — the spline's segment and its parameter. */
  segment: number;
  segT: number;
}

/** [port-only] `ActorClearGameFields` zeroes the object; this is that zero. */
export function makeOwlTail(): OwlTail {
  return {
    vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0,
    holdX: 0, holdY: 0, holdZ: 0, fromX: 0, fromY: 0, fromZ: 0,
    prevX: 0, prevY: 0, prevZ: 0, centreX: 0, centreY: 0, centreZ: 0,
    aimX: 0, aimZ: 0, launchYaw: 0, orbitPhase: 0, spin: 0,
    swayPhase: 0, swayRate: 0,
    limbA: 0, limbB: 0, limbC: 0, limbD: 0, limbE: 0, diveFrame: 0,
    state: OwlState.WaitLaunch, subtype: 0, member: 0,
    circleOnArrival: 0, escapeDir: 0, strikeToggle: 0, beat: 0,
    dive: OwlDiveKind.None, dwell: 0, timer: 0, bounced: 0, settled: 0,
    t: 0, rate: 0, radius: 0, sway: 0, segment: 0, segT: 0,
  };
}
