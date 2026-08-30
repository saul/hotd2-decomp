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
  /** `ZombieStateWalkDistance` (`FUN_00457220`). */
  WalkDistance = 15,
  /** `ZombieStateMotionCue21` (`FUN_004577F0`). */
  MotionCue = 21,
  /** `ZombieStateApproach` (`FUN_004579A0`). */
  Approach = 22,
  /** `ZombieStateLeapToPoint` (`FUN_00457CE0`). */
  LeapToPoint = 24,
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

/** The engine's frame clock; attack hit frames are counted in it. */
export const GAME_HZ = 60;

/** `obj+0x1334 > 0xF0` — `ZombieStateBackOff` gives up after 240 frames. */
export const BACKOFF_MAX_FRAMES = 240;

/** `obj+0x131E < 3` — only the nearest three may press an attack at all. */
export const QUEUE_CAP = 3;
