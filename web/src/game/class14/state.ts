/**
 * Class 0x14's own words, apart from the class module so `actor.ts` can name
 * the tail without importing the class — the arrangement classes 0x20, 0x21,
 * 0x24, 0x25 and 0x52 have, and for the reason `registry.ts` records: a class
 * module that `actor.ts` imports closes an ESM cycle and the table resolves to
 * `undefined`.
 *
 * The engine keeps all of this in **one 0xBC-byte block** that `Class14Init`
 * (`FUN_00475E90`) allocates with `ActorAllocSub` (`FUN_004A74E0`, which
 * zeroes it) and hangs off `obj+0x1310`, with `g_class14_state` (`0x007DCF20`)
 * pointing at it for the rest of the frame. There is only ever one -- the
 * class is a singleton in every shipped script -- but it is a *field of the
 * actor*, so the port keeps it as one too and the whole thing survives
 * `clonePlain`.
 */
import { vec3, type Vec3 } from "../vec";

/**
 * `g_class14_state+0x04` — the index into `g_class14_states` (`0x00596218`),
 * 21 handlers, read from memory (L38) and agreeing entry for entry.
 *
 * The first five are **entrances**, and which one an actor starts in is the
 * descriptor tail's byte `+0x01`. Two pairs share a handler — 0 and 3 run
 * `Class14StateEntranceA`, 1 and 4 run `Class14StateEntranceB` — and the
 * handler tells them apart by reading this back, so the members are named for
 * the index and not for a story about the index.
 */
export enum Class14State {
  /** `Class14StateEntranceA` (`FUN_00478160`). Stage 2 block 35. */
  Entrance0 = 0,
  /** `Class14StateEntranceB` (`FUN_004783B0`). Stage 2 block 37. */
  Entrance1 = 1,
  /** `Class14StateEntranceC` (`FUN_00478640`). Stage 5 block 3. */
  Entrance2 = 2,
  /** `Class14StateEntranceA` again. Stage 2 block 39. */
  Entrance3 = 3,
  /** `Class14StateEntranceB` again. Stage 2 block 41. */
  Entrance4 = 4,
  /** `Class14StateHunt` (`FUN_00478870`) — picks the next move. */
  Hunt = 5,
  /** `Class14StateClose` (`FUN_00478C00`). */
  Close = 6,
  /** `Class14StateRoar` (`FUN_00478E30`). */
  Roar = 7,
  /** `Class14StateStrike` (`FUN_00478EE0`). */
  Strike = 8,
  /** `Class14StateLungeAtCamera` (`FUN_00479030`). */
  LungeAtCamera = 9,
  /** `Class14StateSummonRoundA` (`FUN_00479530`). */
  SummonRoundA = 10,
  /** `Class14StateSummonRoundB` (`FUN_00479BE0`). */
  SummonRoundB = 11,
  /** `Class14StateLeapAttack` (`FUN_0047A2E0`). */
  LeapAttack = 12,
  /** `Class14StateReposition` (`FUN_0047A7C0`). */
  Reposition = 13,
  /** `Class14StateLeapFromSide` (`FUN_0047A990`). */
  LeapFromSide = 14,
  /** `Class14StateScriptedBreak` (`FUN_0047AF60`). */
  ScriptedBreak = 15,
  /** `Class14StateCuedMotion` (`FUN_0047B280`) — the hit reaction. */
  CuedMotion = 16,
  /** `Class14StateKnockedDown` (`FUN_0047B4C0`) — the airborne one. */
  KnockedDown = 17,
  /** `Class14StateDeathA` (`FUN_0047BAD0`). */
  DeathA = 18,
  /** `Class14StateDeathB` (`FUN_0047BFE0`). */
  DeathB = 19,
  /** `Class14StateDeathC` (`FUN_0047C5F0`). */
  DeathC = 20,
}

/**
 * `g_class14_state+0x08` — which round of the fight this is.
 *
 * `Class14AdvancePhase` (`FUN_00477E60`) walks it when the hit points fall
 * past `g_class14_phase_hp_frac[phase]`, and **it is the whole of which
 * `g_script_flags` byte the boss raises.** Three ladders start from the three
 * entrances and none of them meet:
 *
 * ```
 *  0 -> 1 -> 2   entrances 0 and 3   death raises flag 17
 *  3 -> 4 -> 5 -> 6 -> 7             flags 11..16 on the way, 17 at the death
 *  8 -> 9        entrance 2          death raises flag 31
 * ```
 */
export enum Class14Phase {
  /** Entrances 0 and 3 leave this, at `0x00478190`. */
  ShortOpen = 0,
  /** `Class14AdvancePhase` at 0.5333 of full health; the round is state 10. */
  ShortMid = 1,
  /** `Class14StateSummonRoundA`'s exit. Death: flag 17. */
  ShortFinal = 2,
  /** Entrances 1 and 4 leave this, at `0x004783E3`. */
  LongOpen = 3,
  /** 0.5333. `Class14StateScriptedBreak` sends this one to state 11. */
  LongSecond = 4,
  /** `Class14StateSummonRoundB`'s exit. */
  LongThird = 5,
  /** 0.2222. `Class14StateScriptedBreak` raises flags 13 and 14. */
  LongFourth = 6,
  /** 0.1111. Flags 15 and 16, then the death raises 17. */
  LongFinal = 7,
  /** Entrance 2 leaves this. Stage 5's only spawn. */
  Stage5Open = 8,
  /** 0.5 of full health. The death raises **flag 31**. */
  Stage5Final = 9,
}

/**
 * `g_class14_state+0x00`, the block's own flag word. `Class14Init` writes 1;
 * every other writer ORs or ANDs a bit.
 */
export enum Class14Flag {
  /**
   * Bit 0 — **hold the route steering off.** `Class14Update` runs its three
   * `Class14FollowSegment` calls only while this is clear. Init raises it,
   * the entrances' hand-over, `Reposition` and `LeapFromSide` clear it,
   * `Class14AdvancePhase` and the deaths raise it.
   */
  OffRoute = 1,
  /**
   * Bit 1 — **the feet are no longer read.**
   * `Class14AdvanceMotionAndPublishPoints` skips the two foot points and the
   * four contact strengths while it is up (`TEST byte ptr [EAX], 0x2` at
   * `0x00476B10`). Only the deaths raise it, the frame the body reaches the
   * water, after zeroing the four strengths themselves.
   */
  FeetOff = 2,
  /**
   * Bit 2 — **hold the leap integration off.** The three leap states end on
   * `if ((state->flags & 4) == 0) { pos += vel; vel.y += gravity; }`. Nothing
   * in the class raises it -- no `OR` of 4 into the word in
   * `0x00475E90..0x0047C960`, and Init's `MOV [state], 1` is the only
   * whole-word store -- so the leaps always integrate.
   */
  NoIntegrate = 4,
}

/**
 * `obj+0x34` bits this class reads or writes that `ActorFlag` does not name.
 *
 * `0x80000` is raised and cleared all over the class and **nothing in
 * `0x00475E90..0x0047C960` reads it** `[open]`; it is carried so a reader
 * elsewhere, when one is found, sees the exe's value.
 */
export const OBJ_BIT_80000 = 0x80000;

/**
 * One of the two flipbooks `Class14AdvanceMotionAndPublishPoints` steps and
 * draws on bone 1: `+0x7C..+0x84` (A) and `+0x88..+0x90` (B).
 */
export interface Class14Flipbook {
  /** `+0x00` s16 — the asset slot drawn. */
  frame: number;
  /** `+0x02` / `+0x04` s16 — the strip's first and last slot. */
  low: number;
  high: number;
  /** `+0x06` s16 — frames still to hold; B's `-1` is "held until told". */
  hold: number;
  /** `+0x08` f32 — slots a frame, signed. */
  rate: number;
}

/**
 * The 0xBC-byte block, with the offsets it has in the engine.
 *
 * Four dwords are **polymorphic across the states** — L3, and the exe reuses
 * one dword for a round counter, a frame countdown and a camera path slot
 * depending on which state is running. They are named `counter0`..`counter3`
 * rather than for one of those readings, and each state's use is on the
 * state.
 */
export interface Boss2Tail {
  /** `+0x00` — {@link Class14Flag}. */
  flags: number;
  /** `+0x04`. */
  state: Class14State;
  /** `+0x05` — the sub-state inside it. */
  sub: number;
  /**
   * `+0x06` / `+0x07` — the state and sub `Class14ApplyBoneDamage` saves when
   * it starts a reaction, and the reaction goes back to.
   */
  savedState: number;
  savedSub: number;
  /** `+0x08` — {@link Class14Phase}. */
  phase: Class14Phase;
  /** `+0x0C` f32 — the rise `ActorRegisterCameraPoint` is given. */
  cameraRise: number;
  /** `+0x10`..`+0x18` — where the boss stood at the hand-over. */
  target: Vec3;
  /** `+0x1C`..`+0x24` — the route's forward direction, descriptor `+0x04`. */
  dir: Vec3;
  /**
   * `+0x28`, `+0x34`, `+0x40`, `+0x4C` — the four route corners, x and z
   * from the descriptor; the y words stay 0.
   */
  route: Vec3[];
  /** `+0x58` s32 — the deaths' bob phase, BAMS. */
  bobPhase: number;
  /** `+0x5C` s32 — its rate. */
  bobRate: number;
  /** `+0x60` s16 — how many more times `Class14StateRoar` roars. */
  roars: number;
  /**
   * `+0x62` s16 — the index into `g_class14_anim_slots` (`0x00596408`): the
   * motion a state plays **and** the cue record the foot contacts read.
   */
  animSlot: number;
  /**
   * `+0x64`..`+0x78` s32 — the six eased leg angles: leg A's and leg B's hip
   * pitch, then their hip yaws, then their knees.
   */
  legs: number[];
  /** `+0x7C` — flipbook A. */
  bookA: Class14Flipbook;
  /** `+0x88` — flipbook B, whose frame **is the damage window**. */
  bookB: Class14Flipbook;
  /** `+0x94` s16 — the row of `g_class14_window_timing` B runs on, 0..7. */
  window: number;
  /** `+0x96` s8 — the adaptive rank, 0..15; `+0x97` the pending bump. */
  rank: number;
  rankBump: number;
  /** `+0x98`, `+0x99` — the two players' life counts as last seen. */
  lives: number[];
  /**
   * `+0x9C` — the rounds left to summon; **also** the frame countdowns of the
   * leaps, `KnockedDown` and the entrances, `Close`'s mode, the side coin of
   * `Reposition`/`LeapFromSide`, and the `cp_` slot `ScriptedBreak` flies.
   */
  counter0: number;
  /** `+0xA0` — fish left this round; the path frame in state 15. */
  counter1: number;
  /** `+0xA4` — frames until the next fish; the holds in state 15. */
  counter2: number;
  /** `+0xA8` — the placement side coin, and state 11's sub-4 delay. */
  counter3: number;
  /** `+0xAC` — "no life was lost this round": the round's rank-up. */
  noLifeLost: number;
  /**
   * `[port-only]` — the two knee rest angles and the height step
   * `Class14AdvanceMotionAndPublishPoints` computes into locals and uses in
   * its own draw. The engine draws inside the routine; the port draws in
   * `render/`, which reads them here.
   */
  kneeRest: number[];
  drawDy: number;
}

function makeFlipbook(): Class14Flipbook {
  return { frame: 0, low: 0, high: 0, hold: 0, rate: 0 };
}

/**
 * `ActorAllocSub(0xBC)` — zeroed, which is why the phase at `+0x08` starts at
 * 0 without Init writing it.
 */
export function makeBoss2Tail(): Boss2Tail {
  return {
    flags: 0,
    state: Class14State.Entrance0,
    sub: 0,
    savedState: 0,
    savedSub: 0,
    phase: Class14Phase.ShortOpen,
    cameraRise: 0,
    target: vec3(),
    dir: vec3(),
    route: [vec3(), vec3(), vec3(), vec3()],
    bobPhase: 0,
    bobRate: 0,
    roars: 0,
    animSlot: 0,
    legs: [0, 0, 0, 0, 0, 0],
    bookA: makeFlipbook(),
    bookB: makeFlipbook(),
    window: 0,
    rank: 0,
    rankBump: 0,
    lives: [0, 0],
    counter0: 0,
    counter1: 0,
    counter2: 0,
    counter3: 0,
    noLifeLost: 0,
    kneeRest: [0, 0],
    drawDy: 0,
  };
}

/**
 * The descriptor tail, as `Class14Init` reads it. The exporter carries it
 * under its own key for the reason class 0x20's is carried under its own:
 * `tail+0x00` is class 0x30's body condition and `tail+0x01` its initial
 * state, and this class reads the same two bytes as a character type and a
 * `Class14State`.
 */
export interface Class14Descriptor {
  /** `tail+0x00` — the character type, `0x47` for every shipped spawn. */
  char_type: number;
  /** `tail+0x01` — the {@link Class14State} the boss starts in. */
  state: number;
  /** `tail+0x04`..`+0x0C` — the route's forward direction. */
  dir: [number, number, number];
  /**
   * `tail+0x10`..`+0x2C` — the four route corners as **eight floats**, an x
   * and a z each, carried here as vec3s with a zero y because that is what
   * the engine leaves in `state+0x2C`, `+0x38`, `+0x44` and `+0x50`.
   */
  route: [number, number, number][];
  /** `tail+0x30` / `tail+0x32` — the camera path and frame that despawn it. */
  despawn_path: number;
  despawn_frame: number;
}
