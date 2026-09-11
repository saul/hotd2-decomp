/**
 * Class 0x11's sub-block, apart from the class module so `actor.ts` can name
 * it without importing the class — the arrangement classes 0x20, 0x21, 0x24,
 * 0x25, 0x51 and 0x52 have.
 *
 * `FrogInit` (`FUN_0043A080`) allocates it with `ActorAllocSub(0x38)` and
 * hangs it at `obj+0x1310`. Eight of those fifty-six bytes — `sub+0x24` and
 * `sub+0x34` — are never written or read by any routine in the class.
 */

/** `sub+0x04` — the index into `g_class11_states` (`0x00592660`). */
export enum FrogState {
  /**
   * `FrogStateWaitForCamPathFrame` (`FUN_0043A9A0`). Holds until the camera
   * reaches a named path and frame.
   */
  WaitForCamera = 0,
  /**
   * `FrogStateHopWithinScreenWedge` (`FUN_0043AA10`), first of three. Hops on
   * a heading drawn at random from the part of the screen it may cross.
   */
  HopAcross = 1,
  /** The same routine, aimed at the player and stopping 26 units short. */
  HopToward = 2,
  /** The same routine again, on the absolute heading command 3 supplied. */
  HopToHeading = 3,
  /**
   * `FrogStateHopInPlace` (`FUN_0043B0E0`). Hops without translating, keeping
   * whatever heading it had.
   */
  HopInPlace = 4,
  /** The same routine, turning to face the camera as it hops. */
  HopInPlaceFacing = 5,
  /**
   * `FrogStateLeapAtPlayer` (`FUN_0043B270`). The attack, and the only state
   * that takes a permit. **No shipped command list names it** — it is reached
   * only from `FrogReadNextScriptCommand`'s autonomous half.
   */
  LeapAtPlayer = 6,
  /** `FrogStateIdleAndCroak` (`FUN_0043B880`). Sits for 64 to 89 frames. */
  IdleAndCroak = 7,
  /**
   * `FrogStateDieTumbleAndSink` (`FUN_0043B990`). The corpse: thrown away from
   * the camera, bounced, then sunk for 180 frames.
   */
  Die = 8,
  /**
   * `g_class11_states[9]` is `NoOpStub` (`FUN_0041EBB0`), the engine's empty
   * function. **Nothing ever writes 9** — the three writers of `sub+0x04` can
   * produce 0 to 8 and no more — so the tenth cell is a live entry that cannot
   * be reached.
   */
  Stub = 9,
}

/** `sub+0x00` — the four bits the class keeps there. */
export enum FrogFlag {
  /**
   * Bit 0. **Ask for the next command.** Every state raises it when it is
   * finished; `FrogReadNextScriptCommand` clears it and acts.
   */
  WantCommand = 0x1,
  /**
   * Bit 1. **The bone-2 model cycle is running** — thirty models over
   * fifty-nine ticks. Raised by the croak and by the leap's launch.
   */
  CycleRunning = 0x2,
  /** Bit 2. The cycle wrapped on this frame. */
  CycleWrapped = 0x4,
  /**
   * Bit 3. **Gravity off.** Raised on the frame the leap connects and cleared
   * when its recovery ends, which is what holds the frog on the player's face.
   */
  NoGravity = 0x8,
}

/** `obj+0x1310` — the 0x38 bytes `ActorAllocSub` hands `FrogInit`. */
export interface FrogTail {
  /** `sub+0x00` — {@link FrogFlag}. */
  flags: number;            // +0x00
  /** `sub+0x04` and `sub+0x05`. */
  state: FrogState;         // +0x04
  sub: number;              // +0x05
  /** `sub+0x08` — 0..29, the offset into bone 2's thirty-model run. */
  boneSlot: number;         // +0x08
  /** `sub+0x0A` — a free-running s16 the triangle wave is taken from. */
  boneCycle: number;        // +0x0A
  /**
   * `sub+0x0C` — the command cursor.
   *
   * `[port-only]` as an **index** into the decoded command list rather than a
   * pointer into the descriptor tail. The engine walks `tail+0x0A` two bytes
   * at a time and stops for good on the `0xFFFF`; the bundle decodes the same
   * bytes into a list, so the cursor counts commands. Past the end is the
   * `0xFFFF`, and there is no way back — nothing rewinds it.
   */
  cursor: number;           // +0x0C
  /**
   * `sub+0x10` — the half-width of the wedge in front of the camera the frog
   * may hop into, in BAMS. From `tail+0x08`, or the horizontal half-FOV less
   * `0x200` when that is zero.
   */
  wedge: number;            // +0x10
  /** `sub+0x14` — the **2-D** distance from the camera eye, y ignored. */
  camDist: number;          // +0x14
  /**
   * `sub+0x18` and `sub+0x1C` — **multi-use, and the state says which**.
   *
   * | state | `+0x18` | `+0x1C` |
   * |---|---|---|
   * | 0 | camera path to wait for | camera frame to wait for |
   * | 1..6 | the turn still owed, signed BAMS | — |
   * | 7 | idle frames left | the frame to croak on |
   * | 8 | frames left to sink | — |
   */
  a: number;                // +0x18
  b: number;                // +0x1C
  /** `sub+0x20` — the motion state 0 plays. `0x141`, or command 0's operand. */
  motion: number;           // +0x20
  /** `sub+0x28`, `+0x2C`, `+0x30` — where the leap is aimed, in world space. */
  targetX: number;          // +0x28
  targetY: number;          // +0x2C
  targetZ: number;          // +0x30
}

/** [port-only] The zero `ActorAllocSub` hands the Init, written out. */
export function makeFrogTail(): FrogTail {
  return {
    flags: 0, state: FrogState.WaitForCamera, sub: 0,
    boneSlot: 0, boneCycle: 0, cursor: 0, wedge: 0, camDist: 0,
    a: 0, b: 0, motion: 0, targetX: 0, targetY: 0, targetZ: 0,
  };
}
