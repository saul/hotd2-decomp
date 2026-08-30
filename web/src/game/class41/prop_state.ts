/**
 * The breakable prop's own object, and the sets class 0x41 enumerates.
 *
 * A prop is **not** an `Actor`. `PlaceBreakableGroup` (`FUN_00462A80`) builds
 * it with `ActorAlloc(BreakablePropUpdate, 0x378)` — a 0x378-byte object with
 * its own layout, where the position lives at `+0x19C` rather than `+0x40` and
 * there is no hit-zone or permit machinery at all. Porting it onto `Actor`
 * would mean inventing an overlap the engine does not have, so it gets its own
 * struct and its own pool, the way `ThrownWeapon` does.
 */

/** `obj+0x192` — where a prop is in its life. */
export enum BreakableState {
  /** Whole or cracked, standing where it was placed. */
  Standing = 0,
  /** Destroyed and falling, or toppling because its supports went. */
  Falling = 1,
  /** Come to rest on a hull corner; `BreakablePropGroundContact` seated it. */
  Settled = 2,
  /**
   * Gone. Set the moment a prop above level 0 shatters, and by the
   * `g_GameMode == 2` sweep; nothing draws or tests it afterwards.
   */
  Removed = 3,
}

/**
 * The item hidden behind an item-set, as `BreakablePropUpdate`
 * (`FUN_00464620`) switches on it once `g_item_set_countdown` reaches zero.
 *
 * The values are the set ids stored in the member record's `+0x04`, and the
 * three arms of the engine's own `switch` are exactly the three releases.
 */
export enum ItemSet {
  /** None: this prop hides nothing. */
  None = 0,
  /** `SpawnExtraLifePickup` (`FUN_00471BD0`) — the extra life. */
  ExtraLife = 1,
  /** `SpawnScorePickup` (`FUN_004723F0`) with the set id as the kind. */
  Score2 = 2,
  /** `SpawnGoldenFrog` (`FUN_004722A0`) — character type 0x1C, `frog_gold`. */
  GoldenFrog = 3,
  Score5 = 5,
  Score6 = 6,
  Score7 = 7,
  Score8 = 8,
}

/** The asset slots `PlaceBreakableGroup` gives a prop. */
export enum BreakableSlot {
  /** The ordinary breakable prop. */
  Default = 0x19e8,
  /** A `g_GameMode == 2` one-shot target: one shot, and a different model. */
  OneShotTarget = 0x1a0f,
  /** `BreakablePropUpdate` swaps to this the moment the prop is destroyed. */
  Broken = 0x19e6,
}

/**
 * One prop. Plain data, so the whole pool goes through `structuredClone` and
 * `JSON.stringify` with the rest of the save state.
 */
export interface BreakableProp {
  /** Unique and stable; `g_breakable_members` holds these, not pointers. */
  id: number;
  /** `obj+0x194` — which breakable group placed it. */
  group: number;          // +0x194
  /** `obj+0x290` — its index within that group, and its `supports` key. */
  member: number;         // +0x290
  /** `obj+0x195` — the item set it belongs to, 0 for none. */
  itemSet: ItemSet;       // +0x195
  /** `obj+0x2A0` — the `g_GameMode == 1` drop, `-1` for none. */
  storyItem: number;      // +0x2A0
  /** `obj+0x196` — the value of `g_evt_block_counter` it last saw. */
  spawnBlock: number;     // +0x196
  /** `obj+0x197` — how many block advances it has counted. */
  blocksElapsed: number;  // +0x197
  /** `obj+0x199` — how many it may count before it despawns. */
  lifetime: number;       // +0x199
  /** `obj+0x11C` — shots left: 2 whole, 1 cracked, 0 destroyed. */
  hp: number;             // +0x11C
  /** `obj+0x192`. */
  state: BreakableState;  // +0x192
  /** `obj+0x28C` — the asset slot the renderer draws. */
  slot: number;           // +0x28C
  /** `obj+0x19C`/`+0x1A0`/`+0x1A4`. Its own position, not `+0x40`. */
  x: number;              // +0x19C
  y: number;              // +0x1A0
  z: number;              // +0x1A4
  /** `obj+0x1C0`/`+0x1C4`/`+0x1C8` — velocity, per 60 Hz frame. */
  vx: number;             // +0x1C0
  vy: number;             // +0x1C4
  vz: number;             // +0x1C8
  /** `obj+0x1CC` — pitch in BAMS; the topple rotates about X. */
  pitch: number;          // +0x1CC
  /** `obj+0x1D0` — yaw in BAMS. */
  yaw: number;            // +0x1D0
  /** `obj+0x1D4` — roll in BAMS, the Z term of the draw's `Ry*Rz*Rx`. */
  roll: number;           // +0x1D4
  /** `obj+0x1D8` — BAMS added to `pitch` each frame while it falls. */
  spin: number;           // +0x1D8
  /** `obj+0x1E4` — the pitch the settle eases toward, +/-0x4000. */
  restPitch: number;      // +0x1E4
  /** `obj+0x1FE` — the bearing the topple is thrown along. */
  topple: number;         // +0x1FE
  /** `obj+0x198` — which hull point it came to rest on. */
  contact: number;        // +0x198
  /** `obj+0x1A8`/`+0x1AC`/`+0x1B0` — the seated origin the settle computes. */
  restX: number;          // +0x1A8
  restY: number;          // +0x1AC
  restZ: number;          // +0x1B0
  /** `obj+0x2C0` — the shake a crack imparts; decays by 0.85 a frame. */
  shake: number;          // +0x2C0
  /** `obj+0x34` — the flag word. */
  flags: number;          // +0x34
  /** `obj+0x324` — the break effect id the puff draws. */
  effect: number;         // +0x324
  /**
   * `obj+0x32C` — frames the puff has run, up to `BREAKABLE_EFFECT_FRAMES`.
   */
  effectFrames: number;   // +0x32C
  /**
   * The object's entry point has been replaced with `BreakableEffectUpdate`.
   *
   * The engine spells this as `*obj = BreakableEffectUpdate` — an object *is*
   * its update function, so a destroyed ground-level prop stops being a prop
   * by having its first word overwritten. A boolean is the same switch with
   * the function pointer kept out of the snapshot, which may hold no
   * functions.
   */
  isEffect: boolean;      // *obj
  /**
   * `obj+0x29C` — set to 500.0 the frame a topple comes to rest. Nothing in
   * the routines read so far reads it back; carried because the engine writes
   * it and a field the port drops is a field the port cannot be checked on.
   */
  settleTimer: number;    // +0x29C
  /**
   * `obj+0x40`/`+0x44`/`+0x48` — the object's world position as the shared
   * actor fields hold it.
   *
   * `ActorAlloc` zeroes the object from `+0x34` up and **nothing in class
   * 0x41 ever writes these**: a prop keeps its position at `+0x19C` instead.
   * The one routine that reads them is the fall's land-on-another-prop test,
   * which therefore compares zero against zero for every pair. Kept so that
   * test can be transcribed as it is written rather than quietly dropped.
   */
  hitPos: { x: number; y: number; z: number };   // +0x40
  /** Dead, and due to leave the pool. Not an exe field; the pool is a list. */
  dead: boolean;
}

/** `obj+0x34` bits `BreakablePropUpdate` tests. */
export enum BreakableFlag {
  /** Bit 0 — live. `PlaceBreakableGroup` sets `0x80000001`. */
  Live = 0x1,
  /** Bit 1 — player 0's shot landed this frame. */
  HitByPlayer0 = 0x2,
  /** Bit 2 — player 1's shot landed this frame. */
  HitByPlayer1 = 0x4,
  /** Bit 3 — a shot landed at all; the whole hit block is gated on it. */
  Hit = 0x8,
  /**
   * Bit 24 — the topple bearing in `+0x1FE` is authored rather than drawn at
   * random. `PlaceBreakableGroup` sets it for the four members whose fall
   * direction the level depends on.
   */
  FixedTopple = 0x1000000,
}

/** The four bits a frame's hit test leaves behind, cleared every update. */
export const HIT_FLAG_MASK = 0xe;

export function makeBreakableProp(id: number, group: number,
                                  member: number): BreakableProp {
  return {
    id, group, member,
    itemSet: ItemSet.None,
    storyItem: -1,
    spawnBlock: 0,
    blocksElapsed: 0,
    lifetime: 0,
    hp: 0,
    state: BreakableState.Standing,
    slot: BreakableSlot.Default,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    pitch: 0, yaw: 0, roll: 0,
    spin: 0,
    restPitch: 0,
    topple: 0,
    contact: 0,
    restX: 0, restY: 0, restZ: 0,
    shake: 0,
    flags: 0,
    effect: 0,
    effectFrames: 0,
    isEffect: false,
    settleTimer: 0,
    hitPos: { x: 0, y: 0, z: 0 },
    dead: false,
  };
}
