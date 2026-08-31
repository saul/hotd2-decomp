/**
 * `g_class30_states` (0x00592AE8) — the 54 states class 0x30 dispatches on.
 *
 * Read out of the table itself, which matters: an earlier revision of this
 * file guessed the indices and put the strike at 2. Two is
 * `ZombieStateHoldAtRange`, the strike is 3, and getting that wrong meant the
 * hub of the whole attack loop was never entered.
 *
 * The life of an ordinary zombie is
 *
 * ```
 * <entrance> -> AttackRun -> HoldAtRange -> Strike -> BackOff -> HoldAtRange
 *                  ^                 |
 *                  +--- WaitTurn <---+   when the queue rank drops out
 * ```
 *
 * with the permit claimed in `HoldAtRange` and released in `ZombieStateBackOff`.
 * `Approach` is a *second* entry path — it claims the permit early and routes
 * to the descriptor's own attack state — and no spawn in stage 2 starts there.
 */
export enum ZombieState {
  /** `g_class30_states[0]` is the engine's no-op. */
  NoOp = 0,
  /** `ZombieStateAttackRun` (`FUN_004554D0`). */
  AttackRun = 1,
  /** `ZombieStateHoldAtRange` (`FUN_00455720`). The hub. */
  HoldAtRange = 2,
  /** `ZombieStateStrike` (`FUN_00455A40`). */
  Strike = 3,
  /** `ZombieStateBackOff` (`FUN_00455C30`). */
  BackOff = 4,
  /** `ZombieStateWaitTurn` (`FUN_00455670`). The way back into the loop. */
  WaitTurn = 5,
  /** `ZombieStateDeath6` (`FUN_00454D20`). */
  Death = 6,
  /** `ActorAbortAttackAndLeave` (`FUN_0045D9F0`). */
  Leave = 10,
  /**
   * `ZombieStateFallToGround` (`FUN_00454B90`). Where
   * `ActorSnapToGroundHeight` sends an actor that is more than ten units above
   * the floor and allowed to leave it.
   */
  FallToGround = 11,
  /** `ZombieStateWalkDistance` (`FUN_00457220`). */
  WalkDistance = 15,
  /** `ZombieStateMotionCue21` (`FUN_004577F0`). */
  MotionCue = 21,
  /** `ZombieStateApproach` (`FUN_004579A0`). */
  Approach = 22,
  /** `ZombieStateLeapToPoint` (`FUN_00457CE0`). */
  LeapToPoint = 24,
  /**
   * `ZombieStateDelayedLeap` (`FUN_004581A0`). Wait, then ride a ballistic arc
   * to a point the descriptor names — the burst-out entrances. Eleven spawns.
   */
  DelayedLeap = 26,
  /**
   * `ZombieStateEmerge` (`FUN_004584E0`). Hold a pose, wait, then play the
   * clip the descriptor names — coming up out of the water or the ground.
   * Eighteen spawns.
   */
  Emerge = 27,

  /**
   * `ZombieStateStandAndThrow` (`FUN_00459080`). The stationary thrower: it
   * never moves, and the axe man of stage 1's tutorial is one. Seven spawns.
   */
  StandAndThrow = 33,

  // -- the captor family: states that work on `obj+0x1394` ----------------
  //
  // Every one of these walks at, mauls or waits on the object the actor was
  // *built for* rather than at the camera. 59 spawns across the game use one,
  // and 47 of those are the class-0x10 civilians' own captors.
  /** `ZombieStateWalkToTarget` (`FUN_0045A890`). Walk at the target, then grab. */
  WalkToTarget = 34,
  /** `ZombieStateTargetMotionScript` (`FUN_0045AAA0`). The maul. */
  TargetMotionScript = 35,
  /** `ZombieStateTargetScriptWithFlag` (`FUN_0045B190`). ...raising a script flag. */
  TargetScriptWithFlag = 36,
  /** `ZombieStateCarryProp` (`FUN_0045B380`). Carries a companion object. */
  CarryProp = 37,
  /** `ZombieStateRetireOffScreen` (`FUN_0045B7B0`). The commonest attack state. */
  RetireOffScreen = 38,
  /** `ZombieStateAwaitCivilianOrder` (`FUN_0045BAD0`). Waits on the civilian. */
  AwaitCivilianOrder = 39,
  /** `ZombieStateWalkPastPoint` (`FUN_0045BCB0`). */
  WalkPastPoint = 40,
  /** `ZombieStateWalkToPoint` (`FUN_0045BE30`). */
  WalkToPoint = 41,
  /** `ZombieStateDragTarget` (`FUN_0045C080`). Glued to the civilian. */
  DragTarget = 43,
  /** `ZombieStatePounceOnTarget` (`FUN_0045C2E0`). */
  PounceOnTarget = 44,
  /** `ZombieStateTargetLostPause` (`FUN_0045C7D0`). The target died under it. */
  TargetLostPause = 45,
  /**
   * The order `ZombieStateAwaitCivilianOrder` reads as "die" rather than as a
   * state to enter — class 0x10's op 0x1A writes it to `sub+0x2C`.
   */
  OrderDie = 0x31,
}

/**
 * `ZombieStateStrike`'s sub-state at `obj+0x1312`, which the engine simply
 * increments: 0 draws the attack, 1 lunges and starts the clip, 2 plays it out.
 */
export enum StrikeSub {
  Pick = 0,
  Lunge = 1,
  Swinging = 2,
}

/**
 * Which entry of the character's general motion row a state plays.
 *
 * `PTR_PTR_00592CBC[charType][condition]` is the row; each state indexes it
 * with a fixed offset, and those offsets are what these are.
 */
export enum MotionRow {
  /** `ZombieStateApproach`: `row[(obj+0x136C >> 0x15) & 1]`, and the idle
   *  `ZombieStateHoldAtRange` plays as `row[0]`. In place — measured. */
  Walk = 0,
  WalkAlt = 1,
  /** `ZombieStateAttackRun`: `row[2 + ((obj+0x34 >> 0x1B) & 1)]`. */
  Run = 2,
  RunAlt = 3,
  /** `ZombieStateBackOff`: `row[4]`, the byte offset 0x10 in the row. */
  BackAway = 4,
}

/**
 * `ActorSetMotionBlended`'s fourth argument: the cross-fade length in frames.
 *
 * Which value a state passes is not decoration — the quick one is for clips
 * that are already in the right pose (the approach walk, the strike out of the
 * lunge) and the long one for a real change of intent.
 */
export enum MotionFade {
  /** `ZombieStateApproach`'s walk, and `ZombieStateStrike`'s swing. */
  Quick = 5,
  /** The attack run, the hold's idle, the retreat, the lunge, the wait. */
  Normal = 10,
}

/** The engine's frame clock; attack hit frames are counted in it. */
export const GAME_HZ = 60;

/** `obj+0x1334 > 0xF0` — `ZombieStateBackOff` gives up after 240 frames. */
export const BACKOFF_MAX_FRAMES = 240;

/** `obj+0x131E < 3` — only the nearest three may press an attack at all. */
export const QUEUE_CAP = 3;
