/**
 * Class 0x14's own words, apart from the class module so `actor.ts` can name
 * the tail without importing the class — the arrangement classes 0x20, 0x21,
 * 0x24, 0x25 and 0x52 have, and for the reason `registry.ts` records: a class
 * module that `actor.ts` imports closes an ESM cycle and the table resolves to
 * `undefined`.
 *
 * The engine keeps all of this in **one 0xBC-byte block** that `Class14Init`
 * (`FUN_00475E90`) allocates with `ActorAllocSub` (`FUN_004A74E0`) and hangs
 * off `obj+0x1310`, with `g_class14_state` (`0x007DCF20`) pointing at it for
 * the rest of the frame. There is only ever one — the class is a singleton in
 * every shipped script — but it is a *field of the actor*, so the port keeps
 * it as one too and the whole thing survives `clonePlain`.
 */
import { vec3, type Vec3 } from "../vec";

/**
 * `g_class14_state+0x04` — the index into `g_class14_states` (`0x00596218`),
 * 21 handlers.
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
  /** `Class14StateSummonRoundA`'s exit, at `0x00479BAE`. Death: flag 17. */
  ShortFinal = 2,
  /** Entrances 1 and 4 leave this, at `0x004783E3`. */
  LongOpen = 3,
  /** 0.5333. `Class14StateScriptedBreak` sends this one to state 11. */
  LongSecond = 4,
  /** `Class14StateSummonRoundB`'s exit, at `0x0047A29D`. */
  LongThird = 5,
  /** 0.2222. `Class14StateScriptedBreak` raises flags 13 and 14. */
  LongFourth = 6,
  /** 0.1111. Flags 15 and 16, then the death raises 17. */
  LongFinal = 7,
  /** Entrance 2 leaves this, at `0x004786A1`. Stage 5's only spawn. */
  Stage5Open = 8,
  /** 0.5 of full health. The death raises **flag 31**. */
  Stage5Final = 9,
}

/**
 * `g_class14_state+0x00`, the block's own flag word. Two bits are read.
 */
export enum Class14Flag {
  /**
   * Bit 0 — **hold the route steering off.** `Class14Update` runs its three
   * `Class14FollowSegment` calls only while this is clear; `Class14AdvancePhase`
   * raises it on three of its five arms and the entrances clear it.
   */
  OffRoute = 1,
  /** Bit 1 — `Class14AdvanceMotionAndPublishPoints` takes its second arm. */
  ArmPoints = 2,
  /**
   * Bit 2 — **hold the integration off.** The three leap states end on
   * `if ((state->flags & 4) == 0) { pos += vel; vel.y += gravity; }`.
   */
  NoIntegrate = 4,
}

/**
 * The 0xBC-byte block, with the offsets it has in the engine.
 *
 * Five of these fields are **polymorphic across the states** — L3, and the exe
 * reuses one dword for a round counter, a frame countdown and a camera path
 * slot depending on which state is running. They are named `counter0`..
 * `counter3` rather than for one of those readings, and each state's use is on
 * the state.
 */
export interface Boss2Tail {
  /** `+0x00` — {@link Class14Flag}. */
  flags: number;
  /** `+0x04`. */
  state: Class14State;
  /** `+0x05` — the sub-state inside it. */
  sub: number;
  /** `+0x06` / `+0x07` — where `Class14StateCuedMotion` goes back to. */
  nextState: number;
  nextSub: number;
  /** `+0x08` — {@link Class14Phase}. */
  phase: Class14Phase;
  /** `+0x0C` — the rise `ActorRegisterCameraPoint` is given. */
  cameraRise: number;
  /** `+0x10`..`+0x18` — the point the entrance latched, and `Close` swims to. */
  target: Vec3;
  /** `+0x1C`..`+0x24` — the route's forward direction, descriptor `+0x04`. */
  dir: Vec3;
  /** `+0x28`, `+0x34`, `+0x40`, `+0x4C` — the four route corners. */
  route: Vec3[];
  /** `+0x60` — how many more times `Class14StateRoar` plays its clip. */
  roars: number;
  /** `+0x62` — the index into `g_class14_anim_slots` (`0x00596408`). */
  animSlot: number;
  /** `+0x94` — the parts count `Class14ApplyBoneDamage` raises by 2, capped 7. */
  parts: number;
  /** `+0x96` — the adaptive rank, 0..15; `+0x97` the pending bump. */
  rank: number;
  rankBump: number;
  /** `+0x98`, `+0x99` — the two players' life counts as last seen. */
  lives: number[];
  /**
   * `+0x9C` — the rounds left to summon; **also** the frame countdowns in
   * `Class14StateKnockedDown`, the leaps and `Class14StateEntranceB`, and the
   * `cp_` slot `Class14StateScriptedBreak` drives the camera along.
   */
  counter0: number;
  /** `+0xA0` — enemies still to place this round; the path frame in state 15. */
  counter1: number;
  /** `+0xA4` — frames until the next one; the hold in state 15's sub 1. */
  counter2: number;
  /** `+0xA8` — the side coin, and state 11's sub-4 delay. */
  counter3: number;
  /** `+0xAC` — "the boss has been hurt since this round began". */
  hurtThisRound: number;
}

/**
 * [port-only] `ActorAllocSub` (`FUN_004A74E0`) hands back memory the engine
 * then writes field by field; `Class14Init` sets every field this port reads,
 * so this is only what a `Boss2` actor looks like before its `Init` runs.
 */
export function makeBoss2Tail(): Boss2Tail {
  return {
    flags: 0,
    state: Class14State.Entrance0,
    sub: 0,
    nextState: 0,
    nextSub: 0,
    phase: Class14Phase.ShortOpen,
    cameraRise: 0,
    target: vec3(),
    dir: vec3(),
    route: [vec3(), vec3(), vec3(), vec3()],
    roars: 0,
    animSlot: 0,
    parts: 0,
    rank: 0,
    rankBump: 0,
    lives: [0, 0],
    counter0: 0,
    counter1: 0,
    counter2: 0,
    counter3: 0,
    hurtThisRound: 0,
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
