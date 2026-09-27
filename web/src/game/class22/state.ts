/**
 * Class 0x22's words — JUDGMENT's flier, and its sub-actor.
 *
 * `Class22Init` (`FUN_0049B0D0`) allocates nothing for its state: every field
 * below is a word of the 0x13F4-byte object itself, past the head the other
 * classes share, so this is a view onto the struct's tail and not a block the
 * engine hangs off a pointer (the class-0x14 arrangement, not class 0x10's).
 * Offsets are the engine's. `docs/re/boss-judgment.md` §2 is the reading.
 *
 * `obj+0x1310` and `obj+0x1312` — the state and the sub — are the head's
 * `state` and `sub`, which have the same offsets on every class. The state is
 * **relative**: see {@link Class22State}.
 *
 * ## The sub-actor rides the same arm
 *
 * `Class22Init` also builds a second skinned actor with `ActorAllocSub(0x13F4)`
 * and keeps it at `obj+0x13B0`: character type 0x46, clip 0x10, no update of
 * its own. `Class22DrawAndPoseSubActor` (`FUN_0049D770`) seats it on the
 * flier's node 1, picks its clip and steps its counter. The port needs it in
 * the pool to draw it, so it is an actor of this class with
 * {@link JudgmentTail.isSubActor} set, and its update does nothing -- as the
 * engine's has no update at all.
 */
import type { ActorRef } from "../actor";
import { vec3, type Vec3 } from "../vec";

/** `obj+0x130C`, from `tail+0x01` — which update `Class22Init` installs. */
export enum Class22Variant {
  /** Stage 1 block 0: `Class22RunFromCutsceneEntrance` (`FUN_0049B260`). */
  Cameo = 0,
  /** Stage 1 blocks 14/16: `Class22RunFromRideIn` (`FUN_0049B620`). */
  Stage1 = 1,
  /** Stage 5 block 1: `Class22RunFromDescent` (`FUN_0049CDF0`). */
  Stage5 = 2,
  /** `advevtbl.bin` block 0: `Class22PoseUntilCameraCue` (`FUN_0049B5B0`). */
  Attract = 3,
}

/**
 * `g_class22_states` — `0x00598000`, ten entries, **indexed from a different
 * base per variant**: `CALL [ECX*4 + 0x598000]` in
 * `Class22RunFromCutsceneEntrance`, `+ 0x598008` in `Class22RunFromRideIn` and
 * `+ 0x598018` in `Class22RunFromDescent`. So `obj+0x1310` is relative, and
 * `Class22FightPhase1` tests `== 2` and `Class22Phase2TakeShots` writes 3 for
 * both fighting variants. These are the absolute entries; `CLASS22_STATE_BASE`
 * maps a variant's relative index onto them. Entries 7..9 repeat 3..5.
 */
export enum Class22State {
  /** `[0]` `Class22CutsceneHoldUntilChapterCard` (`FUN_0049B280`). */
  CutsceneHold = 0,
  /** `[1]` `Class22CutsceneRideAndLeave` (`FUN_0049B3F0`). */
  RideAndLeave = 1,
  /** `[2]` `Class22RideInAndJoinFight` (`FUN_0049B640`). */
  RideIn = 2,
  /** `[3]`, `[7]` `Class22FightPhase1` (`FUN_0049B850`). */
  Phase1 = 3,
  /** `[4]`, `[8]` `Class22FightPhase2` (`FUN_0049C190`). */
  Phase2 = 4,
  /** `[5]`, `[9]` `Class22Death` (`FUN_0049C910`). */
  Death = 5,
  /** `[6]` `Class22DescendAndJoinFight` (`FUN_0049CE10`). */
  Descend = 6,
}

/** Each variant's table base, in entries: `0x598000`, `0x598008`, `0x598018`. */
export const CLASS22_STATE_BASE: Readonly<Record<number, number>> = {
  [Class22Variant.Cameo]: 0,
  [Class22Variant.Stage1]: 2,
  [Class22Variant.Stage5]: 6,
};

/** The ten entries of `g_class22_states`, read from memory at `0x00598000`. */
export const CLASS22_STATE_TABLE: readonly Class22State[] = [
  Class22State.CutsceneHold, Class22State.RideAndLeave, Class22State.RideIn,
  Class22State.Phase1, Class22State.Phase2, Class22State.Death,
  Class22State.Descend, Class22State.Phase1, Class22State.Phase2,
  Class22State.Death,
];

/** The relative indices both fighting variants share. */
export enum Class22Relative {
  Entrance = 0,
  Phase1 = 1,
  Phase2 = 2,
  Death = 3,
}

/** `obj+0x34` bits this class reads and writes, by what they do here. */
export enum Class22Flag {
  /** `0x100` — raised with every flinch; phase 2 does not register while up. */
  Flinched = 0x100,
  /** `0x10000000` — on the companion: it is mid-strike. */
  Striking = 0x10000000,
  /** `0x40000000` — reacting to a hit; shots are refused while up. */
  Reacting = 0x40000000,
}

/** The class's words. A plain object, so it survives `clonePlain`. */
export interface JudgmentTail {
  /** `[port-only]` — this is the sub-actor at the flier's `+0x13B0`. */
  isSubActor: boolean;
  /** `+0x130C` — {@link Class22Variant}. */
  variant: number;
  /** `+0x1320` — the hit-point stage: 1 once hit points <= `tail+0x0C`. */
  hpStage: number;
  /**
   * `+0x1324` — variant 0: the sub-actor's counter runs; variant 1: the hint
   * pause is on. Not the head's `frozen`, which is class 0x24's reading of
   * the same address; this class's `+0x1324` never stops its own counter.
   */
  hint: number;
  /** `+0x1328` — the hint pause's countdown, seated at 0x78. */
  hintFrames: number;
  /** `+0x132C` — damage class 0x23 handed over this frame (read as s16). */
  transfer: number;
  /** `+0x1330` — the frame counter of the ride-in, descent, phase 2 and death orbit. */
  counter: number;
  /** `+0x1334` — frames of `Class22EaseToNearestPathKey`'s glide left. */
  easeLeft: number;
  /** `+0x1338` — node 2's cycle: 0 its own slot, 1 cycle A, 2 cycle B. */
  node2Mode: number;
  /** `+0x133C` — the cycle's counter, stepped by the draw. */
  node2Count: number;
  /** `+0x1340` — the phase-1 path frame, a float. */
  pathFrame: number;
  /** `+0x1344` — the glide's step per frame, a float. */
  easeStep: number;
  /** `+0x1348` — `Class22FightPhase1` sub 7's cue count, a float. */
  cueCount: number;
  /**
   * `+0x1350` — the path index: 0..59 in phase 1 (op path `0x104 + P`), 0..3
   * in phase 2 (`0x140 + P`); the descent's sub 3 reuses it as a lerp count.
   */
  path: number;
  /** `+0x1354` — aggression, 0..15, seeded 8. */
  aggression: number;
  /** `+0x1358` — a hit was charged this frame. */
  charged: number;
  /** `+0x135C` — hits the companion has taken, counted down by 8. */
  companionHits: number;
  /** `+0x1360` — the companion landed a strike. */
  companionStruck: number;
  /** `+0x1364` — hits charged on the flier, ever. */
  hitsTaken: number;
  /** `+0x1368` — strikes the companion has landed. */
  strikesLanded: number;
  /** `+0x136C` — the taunt latch. */
  taunt: number;
  /** `+0x1370` — the companion's x/z distance to the camera eye, a float. */
  companionDist: number;
  /** `+0x1394` — the companion, by spawn address; `-1` until the entrance makes it. */
  companionAt: ActorRef;
  /** `+0x13B0` — the sub-actor, by spawn address. */
  subActorAt: ActorRef;
  /**
   * `+0x13C0`..`+0x13C8` — the path point the evaluators write and the
   * fights move toward; **the same three words** hold the camera block eye
   * `Class22Death` saves in sub 2.
   */
  point: Vec3;
  /** `+0x13CC`..`+0x13D4` — the camera block target the death saves. */
  savedTarget: Vec3;
  /**
   * The sub-actor's own `+0x1350` — the clip index its flier wants, into
   * `g_class22_subactor_motions`. Seated 1 by `Class22Init`.
   */
  subClipWanted: number;
  /** The sub-actor's `+0x1354` — the clip index it is playing. Seated 1. */
  subClipShown: number;
  /**
   * `obj+0x19C` — the play cursor **as the last draw left it**, and
   * `char+0x5D` (`obj+0x1F1`), the byte `SkeletonAdvancePlayCursor`
   * (`FUN_004111A0`) raises when that cursor has reached the play length.
   *
   * `[port-only]` as fields. The engine's sampler computes both inside the
   * draw, from the counter as it stands **before** the state's `INC`; the
   * states then test them on the next frame. The port's draw is the
   * renderer's, so the class records the sampler's two answers at the point
   * its own draw call stands -- see `Class22SampleCursor`. Testing the live
   * counter instead would fire every cursor cue a frame early.
   */
  cursor: number;
  done: number;
  /**
   * `[port-only]` — did this frame's update call `ActorRegisterCameraPoint`
   * (`FUN_00409B70`)? The call is the camera candidacy, and the port's is a
   * predicate over the pool read after the update; `tracksCamera` reads this.
   */
  cameraListed: boolean;
  /**
   * `[port-only]` — `RegisterEnemySlot` (`FUN_00408E80`) ran since the last
   * update: the actor holds one of `g_enemy_slots`' general slots directly,
   * until `UpdateCameraEnemySlots` (`FUN_00408DD0`) empties the table at the
   * top of its next run. The port's slot table is rebuilt from the
   * candidates once a frame, so the direct write is a candidacy for the
   * frame it happens in; `tracksCamera` reads this beside `cameraListed`.
   */
  enemySlot: boolean;
}

/** A fresh tail, as the engine's zeroed allocation leaves it before `Init`. `[port-only]` as a function. */
export function makeJudgmentTail(): JudgmentTail {
  return {
    isSubActor: false, variant: 0, hpStage: 0, hint: 0, hintFrames: 0,
    transfer: 0, counter: 0, easeLeft: 0, node2Mode: 0, node2Count: 0,
    pathFrame: 0, easeStep: 0, cueCount: 0, path: 0, aggression: 0,
    charged: 0, companionHits: 0, companionStruck: 0, hitsTaken: 0,
    strikesLanded: 0, taunt: 0, companionDist: 0, companionAt: -1,
    subActorAt: -1, point: vec3(), savedTarget: vec3(),
    subClipWanted: 0, subClipShown: 0, cursor: 0, done: 0,
    cameraListed: false, enemySlot: false,
  };
}

/**
 * The descriptor tail as the exporter carries it — see
 * `CharacterPlacement.class22`. Duplicated as a type here so the class does
 * not import the bundle's.
 */
export interface Class22Descriptor {
  variant: number;
  clip: number;
  frame: number;
  despawn_path: number;
  despawn_frame: number;
  hp: number;
  hp_stage: number;
  phase1_floor: number;
  companion_at: number | null;
  sub_actor_at: number;
}
