/**
 * Class 0x23's words — JUDGMENT's walker.
 *
 * Like class 0x22's, a view onto the object's own tail: `Class23Init`
 * (`FUN_0048FD90`) allocates nothing. `obj+0x1310`/`+0x1312` are the head's
 * `state`/`sub`, and here the state is **absolute** — see
 * {@link Class23State}.
 */
import type { ActorRef } from "../actor";
import { vec3, type Vec3 } from "../vec";

/** `obj+0x130C`, from `tail+0x01`. */
export enum Class23Subtype {
  /** Stage 1, beside the flier's ride-in. */
  Stage1 = 0,
  /** Stage 5, beside the flier's descent. */
  Stage5 = 1,
  /** `trnevtbl.bin` block 9 — alone, and the only one that loses hit points. */
  Training = 2,
}

/**
 * The state index, into `g_class23_states_subtype0` (`0x00597268`),
 * `_subtype1` (`0x00597278`) or `_training` (`0x00597288`). The three tables
 * differ only in entry 0 (and the training table in entry 1).
 */
export enum Class23State {
  /** `Class23Subtype0Entrance` / `Class23Subtype1Entrance` / `Class23TrainingEntrance`. */
  Entrance = 0,
  /** `Class23FightBesideCompanion` (`FUN_00490150`), or `Class23TrainingFightAlone`. */
  Fight = 1,
  /** `Class23Collapse` (`FUN_00490B00`). */
  Collapse = 2,
  /** `Class23LieUntilCameraCue` (`FUN_00490C50`). */
  Lie = 3,
}

/**
 * The landing ring's object: `obj+0x40` (where the walker stood when it
 * landed), `+0x68` (turned 8 a frame), `+0x1320` (the frame, 1 to `0x50`),
 * and what the update's draw was given this frame -- `CamEvalPath7(0x147,
 * frame)`'s first triple as the scale and its fourth channel as the fade,
 * drawn at `1.0 - fade`.
 */
export interface JudgmentLandingRing {
  x: number; y: number; z: number;
  yaw: number;
  frame: number;
  /** `MatrixScale(e.x, e.y, e.z)` -- the curve's first triple. */
  scale: { x: number; y: number; z: number };
  /** The curve's fourth channel; the draw's alpha is `1.0 - fade`. */
  fade: number;
  /** The update drew it this frame: false only with no curve to read. */
  drawn: boolean;
  /**
   * `ActorKill` ran after this frame's draw (`+0x1320 > 0x50`). The ring is
   * still drawn this frame and gone on the next update.
   */
  killed: boolean;
}

export interface JudgmentCompanionTail {
  /** `+0x130C` — {@link Class23Subtype}. */
  subtype: number;
  /** `+0x131A` — the strike variant, `rand() & 1`, an s8. */
  strike: number;
  /** `+0x1320` — the hit-point stage copied from the flier. */
  hpStage: number;
  /** `+0x1330` — the stage-5 entrance's frame counter. */
  counter: number;
  /** `+0x1350` — the sub a flier's flinch interrupted, restored after the react. */
  savedSub: number;
  /** `+0x1394` — the flier, by spawn address. */
  companionAt: ActorRef;
  /**
   * `+0x13C0`..`+0x13C8` — the entrance's `x - 50.0` point. `[open]` No
   * reader in this class; kept because the entrance writes it.
   */
  point: Vec3;
  /** `obj+0x19C` and `char+0x5D` as the last draw left them. See `JudgmentTail.cursor`. */
  cursor: number;
  done: number;
  /** `[port-only]` — see `JudgmentTail.shotListed`. */
  shotListed: boolean;
  /** `[port-only]` — see `JudgmentTail.cameraListed`. */
  cameraListed: boolean;
  /** `[port-only]` — see `JudgmentTail.enemySlot`. */
  enemySlot: boolean;
  /**
   * The ring `Class23Subtype0Entrance` leaves at its landing — the object
   * `Class23LandingRingUpdate` (`FUN_00491700`) runs. Null when there is
   * none. `[port-only]` as a field of the walker: the ring is a task of its
   * own that nothing reads, and this is where the renderer finds it.
   */
  ring: JudgmentLandingRing | null;
}

/** `[port-only]` as a function. */
export function makeJudgmentCompanionTail(): JudgmentCompanionTail {
  return {
    subtype: 0, strike: 0, hpStage: 0, counter: 0, savedSub: 0,
    companionAt: -1, point: vec3(), cursor: 0, done: 0,
    shotListed: false, cameraListed: false, enemySlot: false, ring: null,
  };
}
