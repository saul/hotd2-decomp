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

/**
 * Which update function the object is running.
 *
 * All three container families are 0x378 objects in the same pool; what makes
 * them different is the routine `ActorAlloc` was given, and the engine swaps
 * that routine at run time — a destroyed ground-level group prop has its first
 * word overwritten with `BreakableEffectUpdate`. So this field *is* the entry
 * point, and switching on it is what the engine does by calling through it.
 */
export enum PropFamily {
  /** `BreakablePropUpdate` — class 0x41 type 0, from the group table. */
  Group = 0,
  /** `KindedPropUpdate` — class 0x41 type 4. 70 spawns, the most-placed. */
  Kinded = 1,
  /** `FallingContainerUpdate` — class 0x44 selector 16. */
  Falling = 2,
  /** `BreakableEffectUpdate` — the puff a destroyed group prop becomes. */
  Effect = 3,
  /**
   * Built by `PlaceGenericProp` and **drawn only** — one of the update
   * routines this port has read for what it draws but not for what it does.
   * See `class41/generic.ts`.
   */
  Generic = 4,
  /** `LiftUpdate` (`FUN_0046A360`) — class 0x41 type 32, the lift. */
  Lift = 5,
}

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
  /**
   * A set with **no arm in the switch**: its countdown runs down and nothing
   * comes out. `KindedPropUpdate` also refuses to despawn a prop carrying it,
   * so the six stage-2 props in this set stay on screen after they break.
   * Whether that is deliberate or a data slip is `[open]`.
   */
  NoRelease = 4,
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
  /**
   * The script address of the spawn that placed it, or 0 for a group member.
   * Only the one-prop-per-spawn families have one, and it is what stops the
   * bridge placing the same prop twice.
   */
  at: number;
  /** `obj+0x194` — which breakable group placed it. */
  group: number;          // +0x194
  /** `obj+0x290` — its index within that group, and its `supports` key. */
  member: number;         // +0x290
  /** `obj+0x195` — the item set it belongs to, 0 for none. */
  itemSet: ItemSet;       // +0x195
  /**
   * `obj+0x2A0` — the `g_GameMode == 1` drop, `-1` for none.
   *
   * A third meaning for one offset, and not the last: `LiftUpdate` uses
   * this word as the **frame counter** that releases the lift's overhead
   * panel, and
   * several other generic routines use it as a state timer. Check the family
   * before reading it, exactly as for `kind`/`member` at `+0x290`.
   */
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
  /**
   * `obj+0x1E0` — BAMS added to `roll` each frame. Only the falling container
   * tumbles on two axes; the group props keep `roll` at zero.
   */
  rollSpin: number;       // +0x1E0
  /** `obj+0x1E4` — the pitch the settle eases toward, +/-0x4000. */
  restPitch: number;      // +0x1E4
  /**
   * `obj+0x1E8` — a second hinge angle, in BAMS.
   *
   * Only the routines that draw more than one moving part have one:
   * `LiftUpdate` swings its far pair of leaves on this while the near
   * pair swings on `yaw` (`+0x1D0`), and `FUN_00468F00` and `FUN_0046B320`
   * use it as the phase of a `sin` sweep.
   */
  hingeB: number;         // +0x1E8
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
  /** Which update function this object runs. See {@link PropFamily}. */
  family: PropFamily;     // *obj
  /**
   * `obj+0x290` — the object kind, for the two families that have one. It
   * indexes `g_prop_kind_params` and picks the asset slot.
   *
   * Note this is the **same field** the group props use for the member index:
   * `PlaceBreakableGroup` writes the member there and `PlaceKindedProp` writes
   * the kind. Check the family before reading it.
   */
  kind: number;           // +0x290
  /**
   * `obj+0x2E0` — `FallingContainerUpdate`'s own floor, set to `y - 7.35` at
   * placement. It settles against this rather than against
   * `g_camera_fixed_eye_y`, which is why a container hung above the ground
   * comes to rest in the air.
   */
  floorY: number;         // +0x2E0
  /** `obj+0x328` — the effect variant from `g_prop_kind_params`. */
  effectVariant: number;  // +0x328
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
    id, at: 0, group, member,
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
    rollSpin: 0,
    restPitch: 0,
    hingeB: 0,
    topple: 0,
    contact: 0,
    restX: 0, restY: 0, restZ: 0,
    shake: 0,
    flags: 0,
    effect: 0,
    effectFrames: 0,
    family: PropFamily.Group,
    kind: 0,
    floorY: 0,
    effectVariant: 0,
    settleTimer: 0,
    hitPos: { x: 0, y: 0, z: 0 },
    dead: false,
  };
}
