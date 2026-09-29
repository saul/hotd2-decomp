/**
 * `ZombieStateAttackRun` — `FUN_004554D0`.
 *
 * Play the run clip and close on the camera until `TestApproachRing` returns
 * band 1, then hand to `ZombieStateHoldAtRange` — **not** to the strike. The
 * closing is the clip's own root motion: `row[2]`/`row[3]` carry 1.289 units
 * per frame where the walk carries nothing.
 *
 * This is where every entrance state ends up. `ZombieStateWalkDistance` (15)
 * walks a set distance and sets state 1; the burst-out entrance (27) plays its
 * clip and sets state 1. Between them that is 37 of stage 2's 90 zombies.
 *
 * The whole routine, `[proved]` from the listing:
 *
 * ```
 * 004554f8  motion = row[2 + ((obj+0x34 >> 0x1B) & 1)]
 * 00455515  ZombieSetMotionIfIdle(motion, rand() % play_length, 10)
 * 0045551d  if ((rand() & 0xFF) < 4 && obj+0x136C & 0x2000000
 *                                  && obj+0x136C & 0x1000000)
 *             obj+0x136C &= ~0x1000000; ZombieSplitInTwo()
 * 00455551  band = TestApproachRing(obj)
 *           band 1:            state 2, sub 0                     -- and out
 *           band < 2 or > 4:   TurnActorTowardCamera(obj, rate)   -- and out
 *           otherwise:         TurnActorTowardCamera(obj, rate)
 *   004555b2                   if ((s8)obj+0x131D >= obj+0x1358)
 *                                state 5, sub 0,
 *                                obj+0x136C |= g_wait_turn_variant[(rand() >> 4) % 10] << 21
 *   004555f0                   if (band != 2 && ZombieShouldStandAndThrow(obj))
 *                                state 0x21, sub 0
 * ```
 *
 * Three things the port had differently, and each is a visible behaviour:
 *
 * * **The turn.** `rate = ftol((bit27 * 1.5 + 1.0) * 416.0)` — `0x1A0` for a
 *   jog and `0x410` for a sprint, BAMS a frame, through
 *   `TurnActorTowardCamera`'s rate limit. The port eased a fifteenth of the
 *   remaining angle a frame instead, so a zombie a half-turn off was nine
 *   tenths of the way round in about half a second, where the engine's takes
 *   79 frames at a jog and 32 at a sprint and does not slow down on the way.
 * * **Band 2 never throws.** The stand-and-throw ask — which takes a permit as
 *   a side effect — is only made from bands 3 and 4.
 * * **Dropping to `WaitTurn` does not end the frame**, and it picks the wait
 *   clip: the variant bit goes into `obj+0x136C` bit 21, which
 *   `ZombieStateWaitTurn` reads straight back. A band-3 or band-4 actor that
 *   drops out of the queue can still be sent to state 0x21 by the throw ask
 *   underneath.
 */
import type { Rng } from "../../core/rng";
import { ZombieFlag2, type ZombieActor } from "../actor";
import { TurnActorTowardCamera } from "../actor_turn";
import { MotionRowOf } from "../tables";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { TestApproachRing } from "./ring";
import { MotionFade, ZOMBIE_SPRINTS, ZombieRunMotion, ZombieState }
  from "./states";
import { ZombieShouldStandAndThrow } from "./stand_throw";

/**
 * `g_wait_turn_variant` — `0x00566124`. `s32[10]`, seven 1s then three 0s;
 * which of the two wait clips `ZombieStateWaitTurn` will play, drawn with
 * `(rand() >> 4) % 10` as an actor drops out of the queue and OR-ed into
 * `obj+0x136C` bit 21. An OR, so a 0 leaves the bit as it was and a 1 is
 * sticky for the rest of the life.
 */
export const g_wait_turn_variant: readonly number[] =
  [1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
/** Where `g_wait_turn_variant`'s value lands in `obj+0x136C`: `SHL EDX, 0x15`. */
const WAIT_TURN_VARIANT_SHIFT = 0x15;

/**
 * The run's turn rate, `ftol((bit27 * 1.5 + 1.0) * 416.0)`:
 *
 * ```
 * 00455580  FILD  [bit27]
 * 00455584  FMUL  float ptr [0x004c4cb8]      ; 0000c03f  1.5
 * 0045558a  FADD  float ptr [0x004c4380]      ; 0000803f  1.0
 * 00455590  FMUL  float ptr [0x00567890]      ; 0000d043  416.0
 * 00455596  CALL  __ftol
 * ```
 *
 * The same expression at `0x00455625`, on the other arm. The sprinter turns
 * two and a half times as fast as the jogger, which is what keeps its faster
 * run on a line at the camera.
 */
const RUN_TURN_RATE = 416.0;
const RUN_TURN_SPRINT_SCALE = 1.5;
const RUN_TURN_BASE_SCALE = 1.0;

/** `rand() & 0xFF < 4` — the split roll, one frame in 64. */
const SPLIT_ROLL_RANGE = 0x100;
const SPLIT_ROLL_BELOW = 4;

/** `ZombieStateAttackRun`'s turn rate for this actor. `[port-only]` as a name. */
export function ZombieRunTurnRate(obj: ZombieActor): number {
  const sprint = (obj.flags & ZOMBIE_SPRINTS) ? 1 : 0;
  return Math.trunc((sprint * RUN_TURN_SPRINT_SCALE + RUN_TURN_BASE_SCALE)
                    * RUN_TURN_RATE);
}

export function ZombieStateAttackRun(obj: ZombieActor, dt: number,
                                    rng: Rng): void {
  const row = MotionRowOf(obj);
  // `row[2 + ((obj+0x34 >> 0x1B) & 1)]` — the spawn record says which of the
  // pair this one takes, and `ZombieRunMotion` is that index.
  ZombieSetMotionIfIdle(obj, ZombieRunMotion(obj, row), rng, "clip",
                        MotionFade.Normal);

  // The roll is made every frame, armed or not, so it is drawn every frame.
  const armed = ZombieFlag2.LowSphere | ZombieFlag2.SplitArmed;
  if (rng.int(SPLIT_ROLL_RANGE) < SPLIT_ROLL_BELOW
      && (obj.flags2 & armed) === armed) {
    obj.flags2 &= ~ZombieFlag2.SplitArmed;
    // [diverges] `ZombieSplitInTwo` (`FUN_0045D9F0`) is not ported. It cuts
    // this actor in two along its skeleton's two roots, allocating a second
    // `EnemyZombieUpdate` object for one of them -- read in full now, and
    // named with its callees in `class30/split.ts`. Nothing the shipped game
    // runs can reach this arm: `SplitArmed`'s one class-0x30 writer is
    // `ZombieStateCollapseToCondition4` (`FUN_0045E660`), and no instruction
    // or data enters that state. `web/tools/checks/split_unreachable.ts` holds it.
  }

  const band = TestApproachRing(obj);
  if (band === 1) {
    obj.state = ZombieState.HoldAtRange;
    obj.sub = 0;
    return;
  }

  TurnActorTowardCamera(obj, ZombieRunTurnRate(obj), dt);
  // `TestApproachRing` only answers 1 to 4, so the engine's own
  // `band < 2 || band > 4` arm -- turn and return -- is unreachable, and is
  // written out anyway because the routine has it.
  if (band < 2 || band > 4) return;

  // "I have fallen out of the slice of the queue that may come at you."
  // `ZombieStateWaitTurn` marks time on the spot and sends the actor back here
  // when the queue moves on. `(s8)obj+0x131D >= obj+0x1358`, at `004555b2`.
  if (obj.rank >= obj.allowance) {
    const v = g_wait_turn_variant[rng.int(g_wait_turn_variant.length)] ?? 0;
    obj.state = ZombieState.WaitTurn;
    obj.sub = 0;
    obj.flags2 |= v << WAIT_TURN_VARIANT_SHIFT;
  }

  // **The other way into state 33**, and only from bands 3 and 4. A
  // body-condition-8 walker that is already facing the camera stops where it
  // is and throws, rather than closing first. `ZombieShouldStandAndThrow`
  // takes the permit as part of asking — which is why the band-2 exclusion
  // matters: the port asked from band 2 as well, where the engine leaves the
  // permit for `ZombieStateHoldAtRange` to claim.
  if (band !== 2 && ZombieShouldStandAndThrow(obj, rng)) {
    obj.state = ZombieState.StandAndThrow;
    obj.sub = 0;
  }
}
