/**
 * `g_class30_states` (0x00592AE8) — the 59 entries class 0x30 dispatches on.
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

import type { Actor } from "../actor";
import { FirstBakedOf, MotionOf } from "../tables";
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
  /**
   * `ZombieStateCorpseSink` (`FUN_00454F20`). The corpse: two seconds sinking
   * into the floor at 0.04 a frame, then the actor leaves the pool. Every
   * character type but 0x12 and 3 ends here.
   */
  CorpseSink = 7,
  /**
   * `ZombieStateCorpseBlink` (`FUN_00454FD0`). The same two seconds, flickering
   * instead of sinking — character types 0x12 and 3.
   */
  CorpseBlink = 8,
  /**
   * `ZombieStateDeathKnockbackArc` (`FUN_004550E0`). The other death: the body
   * is thrown on a ballistic arc built in the camera's own matrix, falls under
   * gravity — with a water case that reads its height from
   * `g_camera_fixed_eye_y` — and bounces before it becomes a corpse.
   * `ZombieOnShot` picks it over {@link Death} for an actor that is being
   * carried, is in state 0x34, or has body condition 5 or 6.
   *
   * See `class30/knockback.ts`.
   */
  DeathKnockbackArc = 9,
  /**
   * `ZombieReleaseAndDespawn` (`FUN_00455490`) — **and it is terminal.**
   *
   * `[proved]` from the table and not from a name: `g_class30_states`
   * (`0x00592AE8`) index 10 is the dword `90 54 45 00`. The entry either side
   * of it agrees with this enum — 11 is `0x00454B90`
   * ({@link ZombieState.FallToGround}) and 12 `0x00456DF0`
   * ({@link ZombieState.DeathFallAndBounce}) — so the indexing is not adrift.
   *
   * This used to cite `ActorAbortAttackAndLeave` (`FUN_0045D9F0`), which is a
   * different address and takes no actor at all: it is three no-argument calls
   * (`0x0045DB70`, `0x0045DA60`, `0x0045DD30(9)`) and assigns no state. The
   * wrong citation is why state 10 had no `case` in the dispatch and every
   * actor that reached it went to {@link ZombieState.WaitTurn} and lived —
   * which is what held stage 5 block 2's room shut even once class 0x33 was
   * writing the bit that sends them here.
   */
  Leave = 10,
  /**
   * `ZombieStateDeathFallAndBounce` (`FUN_00456DF0`). Where {@link Death}
   * sends an actor that still has hold of a weapon — `obj+0x34` bit
   * `0x1000000`, {@link ActorFlag.HoldingWeapon} — whose death clip is 0x3F9.
   * It falls under gravity, bounces once at a quarter of its speed, plays the
   * landing clip 0x3F8 and settles into {@link ZombieEnterCorpseState}.
   */
  DeathFallAndBounce = 0xC,
  /**
   * `ZombieStateFallToGround` (`FUN_00454B90`). Where
   * `ActorSnapToGroundHeight` sends an actor that is more than ten units above
   * the floor and allowed to leave it.
   */
  FallToGround = 11,
  /**
   * `ZombieStateSurfaceOnCameraCue` (`FUN_00456F50`). Comes up out of the
   * water when the camera path reaches a frame — state 27's cousin, gated on
   * the camera rather than on a delay. Sixteen spawns.
   */
  SurfaceOnCameraCue = 13,
  /** `ZombieStateRunInPlaceTimed` (`FUN_00457160`). Two spawns. */
  RunInPlaceTimed = 14,
  /** `ZombieStateWalkDistance` (`FUN_00457220`). */
  WalkDistance = 15,
  /**
   * `ZombieStateHoldClipThenBranch` (`FUN_004574D0`). Plays one clip for a
   * fixed count, then branches to the state the descriptor names. **Thirty-
   * eight spawns — the commonest entrance in the game after the attack run.**
   */
  HoldClipThenBranch = 17,
  /**
   * `ZombieStateWaitCameraFrameThenBranch` (`FUN_004575A0`). Holds a clip
   * until the camera path hits an exact frame. Thirty-seven spawns.
   */
  WaitCameraFrameThenBranch = 18,
  /**
   * `ZombieStateWaitForCameraFrame` (`FUN_00457620`). The same wait with a
   * freeze, a permit claim and the one attack cooldown class 0x30 ever arms.
   */
  WaitForCameraFrame = 19,
  /**
   * `ZombieStateWaitScriptFlagThenBranch` (`FUN_00457780`). State 18 with the
   * camera gate replaced by a script flag.
   */
  WaitScriptFlagThenBranch = 20,
  /** `ZombieStateMotionCue21` (`FUN_004577F0`). */
  MotionCue = 21,
  /** `ZombieStateApproach` (`FUN_004579A0`). */
  Approach = 22,
  /**
   * `ZombieStateScriptedGrabAndDespawn` (`FUN_00457B50`). A one-shot scripted
   * kill that removes the actor afterwards — the only class-0x30 entrance
   * that ends in a despawn rather than in a state. Six spawns.
   */
  ScriptedGrabAndDespawn = 23,
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
   * `ZombieStateRideCarrier` (`FUN_00458960`). A passenger: its position is
   * its own spawn offset plus `g_carrier_object`'s, every frame. Six spawns,
   * and it reads nothing from the tail — the tail belongs to the state it
   * hands over to.
   */
  RideCarrier = 29,
  /**
   * `ZombieStateArcScriptedEntrance` (`FUN_00458A70`). Waits, crouches, then
   * rides a scripted ballistic arc to a world point. Three spawns, all
   * reached from `RideCarrier`.
   */
  ArcScriptedEntrance = 30,
  /**
   * `ZombieStateWaitScriptFlagThenEnter` (`FUN_00458CE0`). Not counted as an
   * enemy at all until its script flag comes up — it increments
   * `g_enemies_present` and `g_enemies_alive` itself. Four spawns.
   */
  WaitScriptFlagThenEnter = 31,
  /**
   * `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`). A stationary attacker
   * on a timer that never approaches and never leaves. Three spawns, and the
   * only class-0x30 state outside the table's contiguous run.
   */
  DelayedStrikeInPlace = 32,

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
  /**
   * `ZombieStateHoldForCameraCue` (`FUN_0045BFD0`). Holds a captor off the
   * player until the camera reaches its cue. See `class30/target.ts`.
   */
  HoldForCameraCue = 42,
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
/**
 * `obj+0x34` bit `0x08000000` — **this spawn sprints.**
 *
 * `ZombieStateAttackRun` (`FUN_004554D0`) indexes its motion row with
 * `2 + ((obj+0x34 >> 0x1B) & 1)`, and states 14 and 15 use the same pair. The
 * bit is never `OR`ed anywhere in the image: it arrives on the actor from the
 * **spawn record's own flags word**, through `ActorInitFlags`
 * (`FUN_00408970`), so it is placement data and not a runtime decision.
 *
 * **192 of the 402 class-0x30 spawns in the shipped stages set it.** This port
 * took the first *baked* motion of the pair instead, which is always `Run`,
 * so every zombie in the game jogged and none of them ever ran — including the
 * 48% the data says should. There is no fallback to lose by reading the bit:
 * the pair is baked for every character type that has a row.
 */
export const ZOMBIE_SPRINTS = 0x08000000;

export enum MotionRow {
  /** `ZombieStateApproach`: `row[(obj+0x136C >> 0x15) & 1]`, and the idle
   *  `ZombieStateHoldAtRange` plays as `row[0]`. In place — measured. */
  Walk = 0,
  WalkAlt = 1,
  /**
   * `ZombieStateAttackRun`: `row[2 + ((obj+0x34 >> 0x1B) & 1)]`.
   *
   * **A pair, and the spawn record picks which.** `Run` is a jog and `RunAlt`
   * is the sprint — measured on the shipped banks, 0.30 units an authored
   * frame against 1.29 for `char_adv02`, 0.32 against 1.00 for `char_adv01`.
   * See {@link ZombieRunMotion}.
   */
  Run = 2,
  RunAlt = 3,
  /** `ZombieStateBackOff`: `row[4]`, the byte offset 0x10 in the row. */
  BackAway = 4,
}

/**
 * `row[2 + ((obj+0x34 >> 0x1B) & 1)]` — which of the run pair this actor takes.
 *
 * `[port-only]` — one expression out of `ZombieStateAttackRun`
 * (`FUN_004554D0`), named because three states index the pair the same way and
 * two of them were getting it wrong in the same place.
 *
 * Falls back to the walk only when the row has no run at all, which is a
 * property of the bundle rather than of the engine: a skeleton with no run
 * clip baked would otherwise be handed `undefined` and stand still.
 */
export function ZombieRunMotion(obj: Actor, row: number[]): number | undefined {
  const want = MotionRow.Run + ((obj.flags >>> 27) & 1);
  const m = row[want];
  if (m !== undefined && MotionOf(obj, m)) return m;
  return FirstBakedOf(obj, row, MotionRow.Run, MotionRow.RunAlt,
                      MotionRow.Walk, MotionRow.WalkAlt);
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
