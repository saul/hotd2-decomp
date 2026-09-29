/**
 * Class 0x42's object, apart from the class module so `actor.ts` can name it
 * without importing the class.
 *
 * `PlaceWormBatch` (`FUN_0042F9B0`) is a **placer**: both of its paths end in
 * `ActorKill`, and what it leaves behind is one or more `0x230`-byte objects,
 * allocated with `ActorAlloc` and `ActorClearGameFields` rather than through
 * the spawn opcode. They have no character type and no skeleton -- every draw
 * is an `AssetDrawSlot` out of `buyo.bin` -- so the fields below are the small
 * object's own, and only the ones the three routines touch are here.
 *
 * **The worm**, settled by its kill sound: `0x3619A9` and `0x3719A9` are
 * `STAGE2_SE\WORM_TUBU1_44.wav` and `WORM_TUBU2_44.wav`, and nothing else in
 * the image plays either. The model file is `buyo.bin`, entries 0..53 at asset
 * slots `0x85A`..`0x88F`.
 */

/**
 * `obj+0x130C` on the placer -- the opcode-0x09 descriptor's `+0x25`. It picks
 * which routine the members run and how many there are.
 */
export enum WormSubtype {
  /**
   * Six members, eight with two players: stage 2 block 21 step 4, the worms
   * that ride the cog and drop off it one after another.
   * `g_worm_offsets_6_8` (`0x0055D698`) places them.
   */
  OnCog = 0,
  /**
   * **One** worm, uncounted, that drops from where it was placed and is gone
   * below y 30 -- `WormLoneDropUpdate` (`FUN_00431000`). Placed beside the cog
   * batch, in the same instruction.
   */
  LoneDrop = 1,
  /**
   * Ten members, fifteen with two players: stage 2 block 26 step 2.
   * `g_worm_offsets_10_15` (`0x0055D6C0`) places them.
   */
  Large = 2,
}

/**
 * `obj+0x192` -- the member's state, switched on by `WormUpdate`'s jump table
 * at `0x00430B68`. Seven arms, each ending in a jump to `0x00430022`; none runs
 * on into the next (L53).
 */
export enum WormState {
  /** On the cog -- or, outside block 0x15, where it was placed -- until its delay runs out. */
  Perch = 0,
  /** Falling. */
  Fall = 1,
  /** The landing splat: twenty-five frames of `0x85C + n`. */
  Splat = 2,
  /** Crawling toward the camera along `g_worm_crawl_steps`. */
  Crawl = 3,
  /** Wobbling in place and turning to face the camera; the leaper swells here. */
  Wait = 4,
  /** The leap at the camera. */
  Leap = 5,
  /** Bounced off the player, flying off to despawn. */
  Bounce = 6,
  /**
   * Shot. `WormUpdate` sets it and installs `WormDeathUpdate`
   * (`FUN_00430C80`), so a member only ever runs the member routine in this
   * state on the frame of the kill. `WormLoneDropUpdate` uses the same value
   * for its own split.
   */
  Dead = 7,
}

/**
 * The routine `obj[0]` holds -- which one the task walk calls.
 *
 * `[port-only]` as a field: the engine's object is its routine pointer, and
 * the port has one handler per class id, so the choice has to be data. It is
 * not a divergence in behaviour, only in how the routine is reached: the four
 * values are the four routines, each installed where the engine installs it.
 */
export enum WormRoutine {
  /** `PlaceWormBatch` -- the spawn record's object, before it has run. */
  Placer = 0,
  /** `WormUpdate` (`FUN_0042FCA0`), installed by the placer. */
  Member = 1,
  /** `WormDeathUpdate` (`FUN_00430C80`), installed by `WormUpdate` at `0x0042FEE6`. */
  Death = 2,
  /** `WormLoneDropUpdate` (`FUN_00431000`), installed by the placer for sub-type 1. */
  LoneDrop = 3,
}

/**
 * The bits of `obj+0x34` class 0x42 gives its own meaning to. The shared
 * ones -- 8 hit, 2 and 4 the shooter, `0x10000` off the camera's list -- are
 * `ActorFlag`'s; these two mean something else on a class-0x30 actor (L3).
 */
export enum WormFlag {
  /**
   * `0x1000000`: shot before it landed (state 0 or 1), so it **splits** --
   * `WormDeathUpdate` draws two halves along motions `0xBF` and `0xC0` rather
   * than the death strip.
   */
  Split = 0x1000000,
  /**
   * `0x10000000`: shot in the middle of its leap (`0x0042FDB5`). No routine
   * of the class reads it back, and what else might is `[open]`.
   */
  ShotMidLeap = 0x10000000,
}

/**
 * The class-0x42 fields of the actor, by their offsets on the `0x230`-byte
 * object. `ActorClearGameFields` zeroes everything from `+0x34` on, so every
 * field starts at 0 and the placer writes the rest.
 */
export interface WormTail {
  /** `obj[0]` -- see {@link WormRoutine}. */
  routine: WormRoutine;
  /** `obj+0x192` -- see {@link WormState}. */
  state: WormState;
  /** `obj+0x193` -- the member index, `0`..`14`: its row of every per-member table. */
  idx: number;
  /** `obj+0x194` -- how many members the batch made. */
  count: number;
  /**
   * `obj+0x19C` -- the vertical speed while falling (state 1 and the lone
   * drop). Other classes keep the play cursor here; this object has no motion.
   */
  vy: number;
  /** `obj+0x198` and `obj+0x1A0` -- the bounce's x and z speed (state 6; `+0x19C` is its y). */
  vx: number;
  vz: number;
  /** `obj+0x1A4..0x1AC` -- where the leap started. */
  leapFrom: { x: number; y: number; z: number };
  /** `obj+0x1B0..0x1B8` -- last frame's position, for the bounce off the player. */
  last: { x: number; y: number; z: number };
  /** `obj+0x1BC..0x1C4` -- the draw scale per axis, 1 at rest. */
  scale: { x: number; y: number; z: number };
  /** `obj+0x1C8..0x1D0` -- the scale when the crawl ended: what the wobble eases from. */
  base: { x: number; y: number; z: number };
  /**
   * `obj+0x121` -- the player the leap is at. On a combat actor this byte is
   * the attack permit; here `WormPickLeapTarget` (`FUN_0042FC00`) writes a
   * player index into it and `WormUpdate` hands it to `PlayerTakeDamage`.
   * `ActorClearGameFields` leaves it 0, and a one-player game with
   * `g_active_player` neither 0 nor 1 leaves it there.
   */
  target: number;
  /** `obj+0x1D8` -- the leap's yaw bias, `-0x400` or `+0x400` with two players, else 0. */
  yawBias: number;
  /**
   * `obj+0x1E0` -- the pull-back the splat is drawn under, `T(0, 0, -this)`
   * both sides of the turn. **Nothing writes it**: no instruction of the
   * class's three routines stores to `+0x1E0`, and `ActorClearGameFields`
   * left it 0. Kept because the draw reads it.
   */
  splatPull: number;
  /** `obj+0x1E4` -- the orbit angle, BAMS: `g_worm_orbit_phase[idx] + 0x7800`, less `0x80` a frame. */
  orbit: number;
  /**
   * `obj+0x1E8` -- a 16-bit frame index with three uses: the crawl row
   * (state 3), the leap row (state 5), the death strip's frame. The placer
   * seeds it `rand() % 60`, which nothing reads before state 2 overwrites it.
   */
  frame: number;
  /** `obj+0x1EC` -- a counter every state resets and steps its own way. */
  timer: number;
  /** `obj+0x1F0` -- the crawl's second-pass latch, then the wobble's phase. */
  phase: number;
  /** `obj+0x214`/`+0x218` -- a landed half's height. */
  halfY: [number, number];
  /** `obj+0x21C` -- half 0's pull on the object once its track has run out. */
  sink: number;
  /** `obj+0x220` -- the leap's range: the flat distance to the camera block when it started. */
  range: number;
  /** `obj+0x224` -- the ground: `g_camera_fixed_eye_y`, copied at the placement and the kill. */
  ground: number;
  /** `obj+0x228`/`+0x22A` -- each half's frame of motion `0xBF`/`0xC0`, to `0x3B`. */
  halfFrame: [number, number];
  /** `obj+0x22C`/`+0x22D` -- whether each half has landed. */
  halfLanded: [number, number];
  /**
   * `obj+0x50` -- the corpse's vertical speed in `WormDeathUpdate`'s whole
   * arm. The kill writes 0 here and `-0.15` into `+0x54`, which that routine
   * never reads.
   */
  deathVy: number;
  /**
   * `[port-only]` -- which body draw ran this frame. The engine draws and
   * forgets; the renderer may not call into the port, so what each routine
   * drew is written down, the way class 0x40's tail carries its shadow.
   */
  drawnBody: WormBodyDraw;
  /**
   * `[port-only]` -- the death strip's frame `WormDeathUpdate` drew this
   * frame, `0x87A + this`, or -1. It draws `obj+0x1E8` and **then** steps it,
   * so the field after the update is one ahead of the picture.
   */
  drawnStrip: number;
  /**
   * `[port-only]` -- the halves drawn this frame, in the order drawn. Each
   * carries what its draw read, because the routines step the frame after the
   * draw and half 0's pull moves the object before half 1 is drawn.
   */
  drawnHalves: WormHalfDraw[];
}

/** `[port-only]` -- which of the two body draws a routine made this frame. */
export enum WormBodyDraw {
  None = 0,
  /**
   * `WormUpdate`'s pair: the body -- `0x85A`, or `0x85C + obj+0x1EC` in the
   * splat -- at `T(x, y + 1, z) M`, and the shadow `0x85B` at
   * `T(x, obj+0x224 + 2, z) S(1, 0.1, 1) M` at alpha 0.5, where `M` is
   * `Ry(yaw) Rx(pitch) S(0.6 * scale)`, bracketed by `T(0, 0, -obj+0x1E0)`
   * in the splat. It runs on the kill frame too, as the routine's last draw.
   */
  Member = 1,
  /** `WormLoneDropUpdate`'s whole worm: `0x85C` at `T(pos) Ry(yaw)`. */
  Lone = 2,
}

/**
 * `[port-only]` -- one half, as `WormDeathUpdate` or `WormLoneDropUpdate` drew
 * it: `T(x, y, z) Ry(yaw)`, then the track's translation -- or, landed,
 * `T(0, -y, 0) T(t.x, halfY, t.z)` -- then `Rz Ry Rx` by the track's angles
 * and `S(0.6)`, slots `0x875 + half` and `0x877` under the one matrix.
 */
export interface WormHalfDraw {
  /** Which half: 0 draws motion `0xBF` and slot `0x875`, 1 motion `0xC0` and `0x876`. */
  half: number;
  /** `obj+0x22C + half` as the draw read it: a landed half draws at {@link halfY}. */
  landed: number;
  /** `obj+0x214 + half*4`, read only by a landed half. */
  halfY: number;
  /** `obj+0x40..0x48` and `obj+0x68` as the draw read them. */
  x: number; y: number; z: number; yaw: number;
  /** The motion frame's translation and `(rx, ry, rz)`, as `MotionFrameRecord` hands them over. */
  t: [number, number, number];
  r: [number, number, number];
}

/** `[port-only]` `ActorClearGameFields` zeroes the object; this is that zero. */
export function makeWormTail(): WormTail {
  return {
    routine: WormRoutine.Placer, state: WormState.Perch, idx: 0, count: 0,
    vy: 0, vx: 0, vz: 0,
    leapFrom: { x: 0, y: 0, z: 0 },
    last: { x: 0, y: 0, z: 0 },
    scale: { x: 0, y: 0, z: 0 },
    base: { x: 0, y: 0, z: 0 },
    yawBias: 0, splatPull: 0, orbit: 0, frame: 0, timer: 0, phase: 0,
    halfY: [0, 0], sink: 0, range: 0, ground: 0,
    halfFrame: [0, 0], halfLanded: [0, 0], deathVy: 0, target: 0,
    drawnBody: WormBodyDraw.None, drawnStrip: -1, drawnHalves: [],
  };
}

/** The descriptor byte the bundle carries for a class-0x42 spawn: `desc+0x25`. */
export interface WormDescriptor {
  subtype: number;
}
