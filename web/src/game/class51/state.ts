/**
 * Class 0x51's sub-block, apart from the class module so `actor.ts` can name
 * it without importing the class — the arrangement classes 0x20, 0x21, 0x24,
 * 0x25 and 0x52 have, and for the reason `registry.ts` records.
 *
 * `FishInit` (`FUN_00438540`) allocates it with `ActorAllocSub(0x84)` and
 * hangs it at `obj+0x1310`. `ActorAllocSub` (`FUN_004A74E0`) zeroes what it
 * returns, so every field below starts at zero and the Init fills the ones it
 * uses — unlike `ActorAlloc`, which zeroes only the first 0xD dwords.
 */

/** `sub+0x62` — which arm of the routine the fish is in. */
export enum FishState {
  /**
   * `FishStateRise` (`FUN_00438F90`). It closes on the camera under water and
   * fades in, for `sub+0x7C` frames.
   */
  Rise = 0,
  /**
   * `FishStateBob` (`FUN_00439020`). It rides the surface on a sine, counting
   * eighty-frame cycles until it has done `sub+0x78` of them and may lunge.
   */
  Bob = 1,
  /**
   * `FishStateLunge` (`FUN_00439190`). The leap at the camera, on a sine arc
   * over `sub+0x7E` frames, with the bite test in `FishLungeTestBite`
   * (`FUN_004397C0`) beside it.
   */
  Lunge = 2,
  /**
   * `FishStateFallBack` (`FUN_00439370`). The lunge is over: it gives back the
   * attack slot at frame 0x20, falls 0.4 a frame until 0x40, and despawns.
   */
  FallBack = 3,
  /**
   * `FishStateFlung` (`FUN_00439450`). Shot **above** the water: it tumbles up
   * and out under gravity until it lands.
   */
  Flung = 4,
  /**
   * `FishStateSink` (`FUN_00439700`). Dead on the surface — it drifts, sinks
   * 0.005 a frame and goes at 300 frames.
   */
  Sink = 5,
}

/**
 * `[port-only]` — `sub+0x62` never takes this value.
 *
 * `FishBeginSwimAway` (`FUN_00439BF0`) leaves the state where it was and
 * writes `*obj = FishSwimAwayUpdate` instead, which is a thing a
 * {@link ClassHandler} with one `update` cannot do. This flag stands in for
 * that write and nothing else: it is the only field in the block the engine
 * has no room for.
 */

/** `sub+0x6A` — the three bits the class keeps there. */
export enum FishFlag {
  /**
   * Bit 0. **It is under the water.** `FishStateRise` and `FishStateBob` set
   * and clear it by comparing `obj+0x44` with `g_water_level` every frame, and
   * `FishCheckShot` reads it to choose between the two deaths.
   */
  Submerged = 0x1,
  /**
   * Bit 1. **It landed on solid ground.** Only `FishStateFlung` sets it, and
   * only for sub-type 1, which is the one that tests the world for a floor.
   */
  OnGround = 0x2,
  /**
   * Bit 2. **Draw it solid, and cast a surface shadow.** `FishInit` sets it
   * when the descriptor's `tail+0x0C` is zero. It picks `AssetDrawSlot` over
   * `AssetDrawSlotWithAlpha`, and it is what puts the flattened silhouette on
   * the water while the fish is below it.
   */
  Surfaced = 0x4,
}

/** `obj+0x1310` — the 0x84 bytes `ActorAllocSub` hands `FishInit`. */
export interface FishTail {
  /** `sub+0x00`, `+0x04`, `+0x08` — where the descriptor put it. */
  homeX: number;            // +0x00
  homeY: number;            // +0x04
  homeZ: number;            // +0x08
  /**
   * `sub+0x0C` — the centre the dead fish bobs about, and it is the only field
   * that moves on its own: `FishStateSink` takes 0.005 off it every frame.
   */
  sinkY: number;            // +0x0C
  /** `sub+0x10`, `+0x14`, `+0x18` — where the lunge started. */
  fromX: number;            // +0x10
  fromY: number;            // +0x14
  fromZ: number;            // +0x18
  /** `sub+0x1C`, `+0x20`, `+0x24` — units a frame. */
  vx: number;               // +0x1C
  vy: number;               // +0x20
  vz: number;               // +0x24
  /**
   * `sub+0x28`, `+0x2C`, `+0x30` — the whole displacement of the lunge, from
   * where the fish was to the attack slot it claimed.
   *
   * `dy` is **polymorphic**: the two death states reuse it as the amplitude of
   * the sine they bob on, 5.0 for the flung one and 0.2 for the sinking one.
   * `dz` is written by `FishClaimSlotAndLunge` and read by nothing — `[open]`.
   */
  dx: number;               // +0x28
  dy: number;               // +0x2C
  dz: number;               // +0x30
  /** `sub+0x3C`, `+0x40` — BAMS a frame and BAMS, as floats. */
  bobRate: number;          // +0x3C
  bobPhaseF: number;        // +0x40
  /** `sub+0x44` — how far the surface bob swings, from `tail+0x08`. */
  bobAmplitude: number;     // +0x44
  /** `sub+0x48` — 0 to 1, the alpha `AssetDrawSlotWithAlpha` is given. */
  alpha: number;            // +0x48
  /** `sub+0x4C` — `tail+0x0C`, and see {@link FishFlag.Surfaced}. */
  entryMode: number;        // +0x4C
  /** `sub+0x50`, `+0x54` — the drawn yaw and the rate it spins at. */
  yaw: number;              // +0x50
  yawRate: number;          // +0x54
  /** `sub+0x58`, `+0x5C` — the drawn pitch and its rate. */
  pitch: number;            // +0x58
  pitchRate: number;        // +0x5C
  /** `sub+0x60` — the yaw step the sinking fish turns by, 0x40 a frame. */
  yawStep: number;          // +0x60
  /** `sub+0x62`. */
  state: FishState;         // +0x62
  /** `sub+0x64` — frames in this state. */
  timer: number;            // +0x64
  /** `sub+0x68` — the surface bob's phase, stepped 0x333 a frame. */
  bobPhase: number;         // +0x68
  /** `sub+0x6A` — {@link FishFlag}. */
  flags: number;            // +0x6A
  /** `sub+0x6C` — `tail+0x0E`, or `SpawnWaterEnemyAt`'s argument. */
  subtype: number;          // +0x6C
  /** `sub+0x6E`, `+0x70`, `+0x72` — the strip frame, its last and its first. */
  frame: number;            // +0x6E
  lastFrame: number;        // +0x70
  firstFrame: number;       // +0x72
  /** `sub+0x74` — frames into the lunge, clamped at `lungeFrames - 1`. */
  lungeStep: number;        // +0x74
  /** `sub+0x76` — which of the four attack slots it holds, -1 for none. */
  slot: number;             // +0x76
  /** `sub+0x78` — `tail+0x12`: bob cycles to sit through before lunging. */
  bobCycles: number;        // +0x78
  /** `sub+0x7A` — how many it has done. */
  bobCycle: number;         // +0x7A
  /** `sub+0x7C` — `tail+0x10`: how long {@link FishState.Rise} lasts. */
  riseFrames: number;       // +0x7C
  /** `sub+0x7E` — `tail+0x14`: how long the lunge lasts. */
  lungeFrames: number;      // +0x7E
  /** `sub+0x80` — sub-type 2's sideways swing, ±2, drawn once per lunge. */
  swing: number;            // +0x80
  /**
   * `[port-only]` — `FishBeginSwimAway` has installed `FishSwimAwayUpdate`.
   * See the note above {@link FishTail}.
   */
  swimAway: boolean;
}

/**
 * [port-only] The zero `ActorAllocSub` hands the Init, written out.
 *
 * `slot` is the one field the engine does **not** leave at zero: `FishInit`
 * writes `sub+0x76 = 0xFFFF` before anything else can claim a slot, and a fish
 * that started life holding slot 0 would release a slot it never took.
 */
export function makeFishTail(): FishTail {
  return {
    homeX: 0, homeY: 0, homeZ: 0, sinkY: 0,
    fromX: 0, fromY: 0, fromZ: 0,
    vx: 0, vy: 0, vz: 0, dx: 0, dy: 0, dz: 0,
    bobRate: 0, bobPhaseF: 0, bobAmplitude: 0, alpha: 0, entryMode: 0,
    yaw: 0, yawRate: 0, pitch: 0, pitchRate: 0, yawStep: 0,
    state: FishState.Rise, timer: 0, bobPhase: 0, flags: 0, subtype: 0,
    frame: 0, lastFrame: 0, firstFrame: 0, lungeStep: 0, slot: -1,
    bobCycles: 0, bobCycle: 0, riseFrames: 0, lungeFrames: 0, swing: 0,
    swimAway: false,
  };
}
