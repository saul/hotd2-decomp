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
  /**
   * `StoryModeSwitchUpdate` (`FUN_00474F30`) — class 0x44 selector 17, the
   * branch writer with the widest reach. Its own family and not `Generic`
   * because `PlaceStoryModeSwitch` is a different constructor and the object
   * does **not** run `PropExpireByStepLifetime`.
   */
  StoryModeSwitch = 6,
  /**
   * `ScriptFlagEffectUpdate` (`FUN_00473B90`) — class 0x44 selector 0, and
   * the only object in the game that draws an **animated effect tree** on a
   * script flag. Stage 1's two window halves, and nothing else.
   */
  ScriptFlagEffect = 7,
  /**
   * `RisingDoorUpdate` (`FUN_004753F0`) — class 0x44 selector 11, a door that
   * slides straight up when a script flag is raised. Two spawns in the game:
   * stage 3's roller shutter and stage 5's. See `class44/rising_door.ts`.
   *
   * Its own family and not {@link Generic} for the same reason
   * {@link StoryModeSwitch} is: a different constructor, and no
   * `PropExpireByStepLifetime` — the remove flag is its whole lifetime.
   */
  RisingDoor = 9,
  /**
   * `PropDrawOnlyType53` (`FUN_0046EBD0`) — class 0x41 type 53, two spawns in
   * stage 5.
   *
   * Its own family and not {@link Generic} for the reason
   * {@link StoryModeSwitch} is: it does **not** call
   * `PropExpireByStepLifetime`. It inlines a variant with the scene-1 sweep
   * left out, and a shared arm would run a sweep the routine does not have.
   * Both its spawns are in scene 4, where that sweep could never fire — which
   * is exactly the argument `L27` is about, so it is not made.
   */
  DrawOnlyType53 = 10,
  /**
   * `PropDrawOnlyType54` (`FUN_0046EDC0`) — class 0x41 type 54, one spawn in
   * stage 5 and one in the training scene.
   *
   * No lifetime prologue either, and no lifetime of any kind while its script
   * flag is down: the 300-frame drift is its only exit. See
   * `class41/draw_only.ts`.
   */
  DrawOnlyType54 = 11,
  /**
   * `PropUpdateType43` (`FUN_0046CEA0`) — class 0x41 type 43, seven spawns and
   * all of them in stage 3.
   *
   * The **third** object built from `g_prop_kind_params`, and its own family
   * rather than {@link Kinded} because the routine is not
   * `KindedPropUpdate`: it swaps the crate's model instead of hiding it,
   * releases its item on a second shot instead of at the break, stays in the
   * shot test after it is destroyed, and bobs and tumbles. See
   * `class41/type43.ts`.
   */
  Type43 = 12,
  /**
   * `PropUpdateType13` (`FUN_00467F50`) — class 0x41 type 13, one spawn in
   * stage 2: the part that drops out of the clock tower on script flag 0x6D.
   *
   * Its own family and not {@link Generic} for the reason
   * {@link DrawOnlyType53} is: it inlines its own lifetime, with the
   * step-change count **before** the scene-1 sweep and an `ActorKill` where
   * the prologue has `ActorDespawn`, and it registers no shot sphere. See
   * `class41/type13.ts`.
   */
  Type13 = 13,
  /**
   * `PropUpdateType38` (`FUN_0046BCC0`) — class 0x41 type 38, the nine
   * objects `PlaceTable38Props` builds out of `g_prop_table38`. Stage 1's
   * church. A shot hops it into the air and it lands pivoting on one of its
   * eight hull corners. See `class41/type38.ts`.
   */
  Type38 = 14,
  /**
   * `PropUpdateType39` (`FUN_0046C240`) — class 0x41 type 39, eight stacks of
   * the same model that topple one item at a time when shot. Stage 1's
   * church. See `class41/type39.ts`.
   */
  Type39 = 15,
  /**
   * `PropUpdateType44` (`FUN_0046D850`) — class 0x41 type 44, seven objects:
   * two drawn as effect 0x13, which a shot blows apart, and five that draw
   * `komono_7.bin[0]` whole. Stage 1's church. See `class41/type44.ts`.
   */
  Type44 = 16,
  /**
   * `PropUpdateType40` (`FUN_0046C570`) — class 0x41 type 40, the objects
   * `PlaceFragmentProps` builds, which burst into forty `garasu.bin` pieces.
   * 28 spawns in stages 1, 2 and 4. Its own family and not {@link Generic}
   * because it is not `PlaceGenericProp`'s and its prologue is its own. See
   * `class41/type40.ts`.
   */
  Type40 = 17,
  /**
   * `PropUpdateType48FlickerLight` (`FUN_0046DDE0`) — class 0x41 type 48,
   * built by its own constructor, `PlaceFlickerLightProp48`: a hanging lamp
   * that owns a flickering point light in `g_entity_lights` and bursts into
   * thirty pieces when shot. One spawn, stage 2 block 26 step 1. See
   * `class41/type48.ts`.
   */
  Type48 = 18,
  /**
   * `FallingContainerFragmentUpdate` (`FUN_0046AD20`) — one of the **two**
   * 0x378 pieces `FallingContainerUpdate` throws when its second shot lands.
   * Allocated into the same pool, cleared by `ActorClearGameFields`, and
   * drawn as slot `0xA55`. Not shootable: the routine has no
   * `RegisterForShotTest`. See `class44/container_fragment.ts`.
   */
  ContainerFragment = 19,
  /**
   * `PropDrawOnlyType33` (`FUN_00472950`) — class 0x41 type 33, one spawn in
   * the game: stage 2 block 11's strip of `eff_shop.bin`, played once.
   *
   * Its own family and not {@link Generic} for the reason
   * {@link DrawOnlyType53} is, and one more: its routine has **no**
   * `PropExpireByStepLifetime` and no `RegisterForShotTest` — it is a draw, a
   * step and an `ActorKill`. See `class41/draw_only.ts`.
   */
  DrawOnlyType33 = 20,
  /**
   * `PropUpdateType66` (`FUN_0046FE00`) — the twenty or twenty-nine objects
   * `PlaceTable66Props` builds out of `g_prop_table66_a`/`_b`, three of whose
   * slots swing when shot. Stage 1 blocks 6, 14 and 16; stage 2 blocks 0 and
   * 3. See `class41/type66.ts`.
   */
  Type66 = 21,
  /**
   * `PropDrawOnlyType12` (`FUN_00467E50`) as `PlaceTable50Props` hands it to
   * `ActorAlloc` — directly, since `g_class41_updates[50]` is `NoOpStub`.
   *
   * The routine {@link Generic} runs for type 12, and its own family for the
   * reason `kind` is `+0x290`: for these objects that word is the **table
   * index** the constructor wrote, and the generic arm would read it as the
   * type to dispatch on. See `class41/type50.ts`.
   */
  DrawOnlyType12 = 22,
  /**
   * `RiseToHeightUpdate` (`FUN_004757F0`) — class 0x44 selector 13, an
   * object that rises a unit a frame on a script flag until it stands a
   * whole-number height above where it was placed. Stage 5's, behind block
   * 1's fight, and twelve in stage 6. See `class44/rise_to_height.ts`.
   *
   * Its own family for the reason {@link RisingDoor} is: its own
   * constructor, and no `PropExpireByStepLifetime`.
   */
  RiseToHeight = 23,
  /**
   * `SlideOnFlagUpdate` (`FUN_004755B0`) — class 0x44 selector 12, an object
   * that slides a set distance on a script flag. Stage 6's eight doors, two
   * of them the elevator car's. See `class44/slide_on_flag.ts`.
   */
  SlideOnFlag = 24,
  /**
   * `FlagLiftedPropUpdate` (`FUN_00474EA0`) — class 0x44 selector 9, one slot
   * that rises to y 10 on a script flag. Stage 3's one. See
   * `class44/flag_lifted.ts`.
   */
  FlagLifted = 25,
  /**
   * `PropUpdateType47` (`FUN_0046DD40`) — class 0x41 constructor 47's task:
   * a flat disc drawn faded until a flag or a step index. Stage 2's one. See
   * `class41/type47.ts`.
   */
  Type47 = 26,
  /**
   * `PropDrawOnlySelector14` (`FUN_004758E0`) — class 0x44 selector 14, a
   * model at the spawn's pose at the descriptor's scale, for a lifetime in
   * steps: type 12's routine without its camera cue. See
   * `class44/draw_only.ts`.
   */
  DrawOnlySelector14 = 27,
  /**
   * `PropUpdateType16` (`FUN_00468640`) -- the six objects
   * `PlaceTable16Props` builds in stage 2's warehouse water, which crack,
   * fly and float. See `class41/type16.ts`.
   *
   * These four are numbered 200 past their constructor's type, so that no
   * two branches adding families at once land on one number.
   */
  Type16 = 216,
  /** `PropUpdateType17` (`FUN_00468D10`) -- constructor 17's three pieces. */
  Type17 = 217,
  /** `PropUpdateType29` (`FUN_0046A030`) -- constructor 29's nine models. */
  Type29 = 229,
  /**
   * `PropUpdateType37` (`FUN_0046B5F0`) -- constructor 37's pair, one on the
   * other. See `class41/type37.ts`.
   */
  Type37 = 237,
  /**
   * `HingeUpdate` (`FUN_00473CF0`) — class 0x44 selectors 1, 2 and 4, the
   * doors and shutters the script swings open, and the hinge selector 5's
   * object hands over to. See `class44/hinge.ts`.
   */
  Hinge = 28,
  /**
   * `PropDrawOnlyType31` (`FUN_0046A1C0`) handed to `ActorAlloc` by class
   * 0x44 selector 10's `PropBuildSlotStripLoop` (`FUN_00473370`) rather than
   * by `PlaceGenericProp`. Its own family for the reason {@link
   * DrawOnlyType12} is: the routine runs and the generic arm's lookup does
   * not. See `class44/draw_only.ts`.
   */
  DrawOnlyType31 = 29,
  /**
   * `FlagSlotEffectUpdate` (`FUN_00474120`) — class 0x44 selector 3, an
   * effect tree with every node drawn as one slot. See
   * `class44/slot_effect.ts`.
   */
  FlagSlotEffect = 30,
  /**
   * `EffectHandoffUpdate` (`FUN_00474240`) — class 0x44 selector 5, which
   * plays an effect on flag 0x62 and hands itself to a hinge. See
   * `class44/effect_handoff.ts`.
   */
  EffectHandoff = 31,
  /**
   * `SwingThenBreakUpdate` (`FUN_00474470`) — class 0x44 selector 6. See
   * `class44/swing_then_break.ts`.
   */
  SwingThenBreak = 32,
  /**
   * `ScaledSlotEffectUpdate` (`FUN_00474770`) — class 0x44 selector 7. See
   * `class44/slot_effect.ts`.
   */
  ScaledSlotEffect = 33,
  /**
   * `EffectCollapseUpdate` (`FUN_004748C0`) — class 0x44 selector 8, a
   * 0xD14-byte object whose effect tree falls apart. See
   * `class44/effect_collapse.ts`.
   */
  EffectCollapse = 34,
  /**
   * `ChainSegmentUpdate` (`FUN_00469510`) — one of the twenty 0x200-byte links
   * `PlaceChainSegments` (`FUN_00463160`, constructor 24) builds. Its words
   * are {@link BreakableProp.chain}. See `class41/chain.ts`.
   */
  ChainSegment = 35,
  /**
   * `OriginalItemDropUpdate` (`FUN_00466BE0`) — the Original Mode item
   * `SpawnOriginalItemDrop` (`FUN_00466B40`) releases, which
   * `PropUpdateType7`'s first hit does. See `class41/type07.ts`.
   *
   * These three are numbered 100 past the type whose arm or routine makes
   * them, so that no family numbered for a type can land on one.
   */
  OriginalItemDrop = 107,
  /**
   * `Type8MountedPartUpdate` (`FUN_00467290`) — one of the three 0x1C0
   * objects `PlaceGenericProp` case 8 allocates, drawn on its parent's stored
   * matrix. See `class41/type08.ts`.
   */
  Type8Piece = 108,
  /**
   * `Type16DropStripUpdate` (`FUN_00468CA0`) -- the strip
   * `SpawnType16DropStrip` leaves where a constructor-16 object comes down.
   */
  Type16DropStrip = 116,
  /**
   * `Type67MountedPartUpdate` (`FUN_004702E0`) — one of the three objects
   * `PlaceGenericProp` case 0x43 allocates beside a type-67 prop, drawn the
   * same way. See `class41/type67.ts`.
   */
  Type67Piece = 167,
  /**
   * `PropDrawOnlyType42` (`FUN_0046CE80`) — constructor 42's 0x48-byte task:
   * one model at its own coordinates until the step index is 2. See
   * `class41/type42.ts`. These three are numbered 200 past their constructor,
   * as constructor 16's family is.
   */
  Type42 = 242,
  /**
   * `PropUpdateType55Particles` (`FUN_0046EEB0`) — constructor 55's
   * 0x8500-byte task: eight hundred pieces that wait for a script flag, fall
   * and bounce. See `class41/type55.ts`.
   */
  Type55 = 255,
  /**
   * `PropUpdateType65Particles` (`FUN_0046FCC0`) — constructor 65's
   * 0x8500-byte task: three hundred pieces that fall for 300 frames. See
   * `class41/type65.ts`.
   */
  Type65 = 265,
}

/**
 * One of the pieces constructors 55 and 65 build into their 0x8500-byte task
 * -- the same layout in both, five parallel arrays in the engine and one
 * record a piece here, so the pool still survives `structuredClone`.
 */
export interface ScatterParticle {
  x: number;              // +0x1C0 + 12i
  y: number;              // +0x1C4 + 12i
  z: number;              // +0x1C8 + 12i
  vx: number;             // +0x2740 + 12i
  vy: number;             // +0x2744 + 12i
  vz: number;             // +0x2748 + 12i
  /** s16 BAMS; the draw is `Rz . Ry . Rx`. */
  rx: number;             // +0x4CC0 + 6i
  ry: number;             // +0x4CC2 + 6i
  rz: number;             // +0x4CC4 + 6i
  /** s16 BAMS added to each angle every frame. */
  wx: number;             // +0x5F80 + 6i
  wy: number;             // +0x5F82 + 6i
  wz: number;             // +0x5F84 + 6i
  /** The draw's `MatrixScale`. */
  s: number;              // +0x7240 + 4i
}

/**
 * One item of a `PropUpdateType39` stack.
 *
 * `obj+0x22C + 12i` holds its position and `obj+0x1FC + 6i` / `+0x1FE + 6i`
 * two s16 rotation offsets — X from the constructor's `rand()`, Y the one the
 * topple turns. The engine's layout is two parallel arrays; one record each
 * here, because the port's pool has to survive `structuredClone`.
 */
export interface StackItem {
  x: number;              // +0x22C + 12i
  y: number;              // +0x230 + 12i
  z: number;              // +0x234 + 12i
  /** s16 added to `obj+0x1CC` in the draw's `MatrixRotateX`. */
  rx: number;             // +0x1FC + 6i
  /** s16 added to `obj+0x1D0` in the draw's `MatrixRotateY`. */
  ry: number;             // +0x1FE + 6i
}

/** One posed node of an effect tree, as `EffectPoseNode` leaves it. */
export interface PosedNode {
  slot: number;
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
}

/**
 * One `AssetDrawSlot` a transcribed routine made this frame, and the matrix
 * it made it under. See {@link BreakableProp.draws}.
 */
export interface PropDrawCall {
  /** The slot handed to `AssetDrawSlot` (`FUN_00418560`), sign-extended. */
  slot: number;
  /**
   * `g_MatrixStackTop` at the call, in `game/matrix.ts`'s layout, built from
   * the identity rather than from the view the engine's stack starts on — so
   * this is the model's **world** matrix, which is the view-space one with
   * the camera taken back off.
   */
  m: number[];
  /**
   * The `SetDrawLayerNibble` (`0x004A79F0`) layer the call was made in, when
   * the routine set one other than the world's own 8. `RenderEnqueueCommand`
   * ORs it into the translucent pass's sort key and the flush sorts it
   * **first**, so a higher layer blends over everything in a lower one
   * whatever its depth. Absent means 8.
   */
  layer?: number;
  /**
   * The alpha of an `AssetDrawSlotWithAlpha` (`FUN_004185A0`) call — the
   * forced-blend draw, at any value, 1 included — or absent for a plain
   * `AssetDrawSlot`. `render/draw_order.ts`'s `setAssetDrawAlpha` is what
   * the renderer hands it to.
   */
  alpha?: number;
}

/**
 * `[port-only]` The draws of a prop that died on the frame it made them. See
 * `g_prop_final_draws` in `game/globals.ts`.
 */
export interface PropFinalDraw {
  /** The prop's id, which the renderer keys its nodes on. */
  id: number;
  draws: PropDrawCall[];
}

/**
 * One of `PropUpdateType40`'s forty burst pieces, `garasu.bin` slot
 * `0xCA5 + i`.
 */
export interface BurstPiece {
  x: number;              // +0x238 + 12i
  y: number;              // +0x23C + 12i
  z: number;              // +0x240 + 12i
  vx: number;             // +0x5A4 + 12i
  vy: number;             // +0x5A8 + 12i
  vz: number;             // +0x5AC + 12i
  /** s16 BAMS; the draw is `Rz.Ry.Rx`. */
  rx: number;             // +0x910 + 6i
  ry: number;             // +0x912 + 6i
  rz: number;             // +0x914 + 6i
  /** s16 BAMS added to each angle every frame. */
  sx: number;             // +0xAC6 + 6i
  sy: number;             // +0xAC8 + 6i
  sz: number;             // +0xACA + 6i
  /**
   * `obj+0xC7C + 2i` -- the model piece *i* draws. Only
   * `EffectCollapseUpdate` (`FUN_004748C0`, `class44/effect_collapse.ts`)
   * keeps one, the slot its tree walk last drew for bone *i*; type 40's
   * pieces draw `0xCA5 + i` and carry none.
   */
  slot?: number;          // +0xC7C + 2i
}

/** One of `PropUpdateType48FlickerLight`'s thirty debris pieces. */
export interface FlickerDebris {
  x: number; y: number; z: number;       // +0x238 + i*0xC
  /** BAMS, s16: `+0x910`, `+0x912`, `+0x914` + i*6. */
  rx: number; ry: number; rz: number;
  vx: number; vy: number; vz: number;    // +0x5A4 + i*0xC
  /** BAMS per frame: `+0xAC6`, `+0xAC8`, `+0xACA` + i*6. */
  wx: number; wy: number; wz: number;
}

/** `PropUpdateType48FlickerLight`'s words beyond the common prop fields. */
export interface FlickerLightState {
  /** `obj+0x1C4` — its entry in `g_entity_lights`, from `EntityLightAcquireSlot`. */
  lightSlot: number;
  /** `obj+0x1AC` — the flicker phase, `+= 0x800` a frame. */
  phase: number;
  /** `obj+0x1C0` — frames since it broke. */
  brokenFrames: number;
  debris: FlickerDebris[];
}

/**
 * `obj+0x192` as `PropUpdateType75` (`FUN_004710C0`) reads it.
 *
 * A **third** reading of the same word {@link BreakableProp.state} holds as a
 * {@link BreakableState} and {@link BreakableProp.branchLatched} holds as a
 * one-way latch, and a separate enum rather than a fourth meaning bolted onto
 * `BreakableState` — whose `1` is *falling* where this one's is *riding* —
 * because a shared name that means two things is exactly the trap `L3` is
 * about. {@link BreakableProp.cuePhase} carries it.
 */
export enum PropCuePhase {
  /** Never shot. The step-tick arm can still raise the flag. */
  Untouched = 0,
  /** Shot: `obj+0x2C0` is running up object path 0x178. */
  Riding = 1,
  /** The ride reached 290 and the flag is up. Nothing reads it again. */
  Done = 2,
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
   * panel,
   * `ScriptFlagEffectUpdate` as the capture bone, `RisingDoorUpdate` and
   * `RiseToHeightUpdate` as the script flag that starts the rise, and
   * several other generic routines use it as a state timer. Check the family
   * before reading it, exactly as for `kind`/`member` at `+0x290`.
   *
   * And for generic types **31** and **33** it is the cursor into a **slot
   * strip**: their routines draw `obj+0x28C + obj+0x2A0` and step it one
   * frame at a time, 31 wrapping at {@link BreakableProp.removeFlag} and 33
   * dying there. `PropDrawOnlyType54` uses the same word as the frame count
   * of its drift.
   */
  storyItem: number;      // +0x2A0
  /** `obj+0x196` — the value of `g_evt_step_index` it last saw. */
  lastStepIndex: number;  // +0x196
  /** `obj+0x197` — how many *changes* to it this prop has counted. A block
   *  advance is one; so is every step advance inside a block. */
  stepsElapsed: number;   // +0x197
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
   * `obj+0x1DC` — BAMS added to `yaw` each frame.
   *
   * Only {@link PropFamily.DrawOnlyType54} has one, and `PlaceGenericProp`
   * case 0x36 seeds it `-0x400` against {@link BreakableProp.spin}'s `0x300`,
   * so the drift tumbles on two axes at once. Zero for every other family.
   */
  yawSpin: number;        // +0x1DC
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
  /**
   * `obj+0x2C0` — the shake a crack imparts; decays by 0.85 a frame.
   *
   * **Class 0x41 type 75 reads it as a cursor**, not a displacement:
   * `PropUpdateType75` (`FUN_004710C0`) adds 1.0 to it every frame after the
   * prop is shot and hands it to `CamEvalObjectPath6` as the frame of object
   * path 0x178, and at 290.0 it raises `g_script_flags[20]`. Another of the
   * offsets `L3` is about — check the family.
   *
   * **And {@link PropFamily.RiseToHeight} reads it as its ceiling**: the `y`
   * `RiseToHeightUpdate` (`FUN_004757F0`) climbs to, written once by its
   * constructor and never changed. `render/breakables.ts` never sees it as a
   * rattle there, because that family records its own draws.
   */
  shake: number;          // +0x2C0
  /**
   * [port-only] The rattle `BreakablePropUpdate` (`FUN_00464620`) adds to x
   * and z at draw time: `(rand() % 0x97 - 75) * shake * 0.01`, two draws, x
   * first, taken while `shake > 0.01` and zero otherwise. Stack locals in the
   * engine (`[ESP+0x14]`, `[ESP+0x10]` at `0x004649A7`/`0x004649D2`); here
   * because the draw is in `render/` and the two `rand()` calls are the
   * game's, so they must be drawn from the game's generator. Only the group
   * family writes them.
   */
  shakeX: number;
  shakeZ: number;
  /**
   * `obj+0x2E4` — what `MatrixStore` saves at the end of every one of
   * `BreakablePropUpdate`'s three draw blocks: the model matrix of the prop as
   * it was last drawn, rattle included, in `g_MatrixStackTop`'s layout.
   * `BreakablePropSpawnShatter` (`FUN_00465170`) places its fifteen pieces
   * off it. Empty until the first draw, and only the group family writes it
   * -- and {@link PropFamily.Type37}, whose pivot stores the matrix it turns
   * about a hull corner here and draws through it.
   *
   * **World space here; the engine's has the camera's world-to-view on it**,
   * because the draw composes onto the live stack. That half is
   * {@link BreakableProp.drawView}, kept apart so the renderer can read this
   * one as it is.
   */
  drawMatrix: number[];   // +0x2E4
  /**
   * [port-only] The world-to-view matrix that was on the stack under
   * {@link BreakableProp.drawMatrix} when it was stored — `GameHost`'s
   * `cameraMatrices`, or empty with no camera. The spawn undoes the *current*
   * view with `MatrixInvert(0)`, so a camera that moved between the prop's
   * last draw and the break carries the pieces with it by that one frame; this
   * is what lets the port do the same.
   */
  drawView: number[];
  /** `obj+0x34` — the flag word. */
  flags: number;          // +0x34
  /** `obj+0x324` — the break effect id the puff draws. */
  effect: number;         // +0x324
  /**
   * `obj+0x32C` — frames the puff has run, up to `BREAKABLE_EFFECT_FRAMES`.
   *
   * The **play cursor** of the four-word `EffectDrawTree` state block for
   * every family that draws an effect, which is this one, `Kinded` and
   * `ScriptFlagEffect`. `ScriptFlagEffectUpdate` (`FUN_00473B90`) steps it
   * only while its script flag is up and stops two short of
   * `g_motion_play_length[effectVariant]`.
   */
  effectFrames: number;   // +0x32C
  /**
   * `obj+0x330` — the previous frame, the fourth word of that state block.
   *
   * `EffectDrawTree` (`FUN_0040DDC0`) writes it after every draw and
   * `EffectPoseNode` reads it to spot a cursor that has just wrapped. Carried
   * because the engine writes it; for `ScriptFlagEffect` neither wrap branch
   * is reachable, since the cursor stops before the end rather than looping.
   */
  effectPrevFrame: number;   // +0x330
  /**
   * `obj+0x2A8` — `ScriptFlagEffectUpdate`'s cursor into the *second* sound
   * cue list, the one it uses for every effect id but 2.
   *
   * The first list's cursor is `obj+0x2A4`, which this struct already carries
   * as {@link BreakableProp.removeFlag}: check the family before reading
   * either. Zero for every other family, which never touch this word.
   */
  cueCursorB: number;     // +0x2A8
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
   * `ActorAlloc` zeroes the object from `+0x34` up and most of class 0x41
   * never writes these: a prop keeps its position at `+0x19C` instead. For
   * those the fall's land-on-another-prop test compares zero against zero for
   * every pair, and the field is kept so that test can be transcribed as it
   * is written. **Some generic arms do write them** — types 19 and 56 copy the
   * placer's position here and draw from it, and the mounted parts of types 8
   * and 67 keep their world point here — so check the type.
   */
  hitPos: { x: number; y: number; z: number };   // +0x40
  /**
   * `obj+0x124` — the radius `ShotTestSphere` (`FUN_00404630`) measures the
   * shot against, and the **whole** hit test for a prop: a prop has no
   * skeleton, so it is always that routine's else-arm.
   *
   * `PlaceBreakableGroup` writes 5.0, `PlaceFallingContainer` 8.0, the kinded
   * props take `g_prop_kind_params[kind].radius`, and `PlaceGenericProp`'s
   * switch sets one per type. **Zero means the class never set one**, which is
   * the engine's "not shootable" and the port's too.
   */
  hitRadius: number;      // +0x124
  /**
   * `obj+0x70` / `+0x74` / `+0x78` — the point `RegisterForShotTest`
   * (`FUN_00405160`) publishes, and the centre of that sphere.
   *
   * Each routine builds it from its own position and its own offset, at its
   * tail, and they all differ — see `class41/shot_test.ts`. **World space
   * here, view space in the engine**, which is the one declared difference.
   */
  shotX: number;          // +0x70
  shotY: number;          // +0x74
  shotZ: number;          // +0x78
  /**
   * Whether this prop is in `g_shot_test_list` (0x0059D8E8) this frame.
   *
   * [port-only] The engine has a list and a count; the port has a flag on the
   * object, because its shot test walks the pool rather than a published
   * array. Cleared for every prop at the top of the pool's frame and set again
   * by whichever routine reaches its own `RegisterForShotTest`, which is what
   * makes a prop that returned early — despawned, retired, mid-break —
   * unshootable for exactly as long as the engine makes it.
   */
  shotRegistered: boolean;
  /**
   * `obj+0x1BA` — `PropUpdateType40`'s sub-kind, from the placer.
   *
   * Sub-kind **9** is the pair whose two breakages
   * `g_branch_prop_shot_count` counts; 1 is the one gated on the chain
   * table; 0, 0x0D and 0x0E pick their own scale and colour. Zero for every
   * other family.
   */
  subKind: number;        // +0x1BA
  /**
   * `obj+0x2A4` — the `g_script_flags` index that removes a story-mode
   * switch, or -1 for none. `StoryModeSwitchUpdate` tests it before anything
   * else, and it is that object's lifetime, since `+0x11C` is a literal 1.
   *
   * **`ScriptFlagEffect` reads the same word as a cue cursor** — its index
   * into `g_script_flag_effect_cues_a` — so this is another of the offsets
   * L3 is about. Check the family.
   *
   * And a third reading: for class 0x41 type 75 it is a count of how
   * many times `g_evt_step_index` has *changed* since the prop was placed,
   * which `PropUpdateType75` tests for equality with 2. That is a different
   * count from {@link BreakableProp.stepsElapsed} (`+0x197`) even though both
   * are incremented on the same frames: the engine keeps two, one a `char`
   * charged against the lifetime and one an `int` that is not.
   *
   * And a fourth: for generic types **31** and **33** it is the **length of
   * the slot strip** their routine plays, which `PlaceGenericProp` copies
   * from the placer's `+0x6C` — the spawn descriptor's third orientation
   * word. So that word is a count and a Z rotation at the same time, and both
   * readings are real. See `GENERIC_SLOT_STRIP` in `class41/generic.ts`.
   */
  removeFlag: number;     // +0x2A4
  /**
   * `obj+0x1FC`, `+0x202`, `+0x208`, `+0x20E` — the four Original Mode item
   * ids that throw a story-mode switch. `-1` in the first means it has no key
   * and any shot throws it.
   *
   * Four fields and not an array, because in the engine they are four: the
   * offsets go up in **sixes**, so each is an s16 inside a larger record and
   * the four are not adjacent. An array here would invent a stride.
   */
  key0: number;           // +0x1FC
  key1: number;           // +0x202
  key2: number;           // +0x208
  key3: number;           // +0x20E
  /**
   * The **branch latch** — the field that stops a trigger opening its route
   * twice.
   *
   * One port field for the engine offsets of the routines ported only as far
   * as their branch arm — `obj+0x34` bit `0x40000000` for type 76,
   * `obj+0x192` for the story switch — and `obj+0x1B9` for type 40. The
   * chain's `obj+0x1B0` was here too and is its own word now
   * ({@link ChainSegmentState.latch}). Types 14, 19, 25, 56, 69
   * and 73 used to be here too; they are transcribed whole now and keep
   * their latch in the word their routine does. Where the rest are ported,
   * this splits the same way.
   */
  branchLatched: boolean;
  /**
   * `obj+0x192` for class 0x41 type 75. See {@link PropCuePhase}.
   *
   * The fourth port field standing for that one engine word, and the second
   * that is not {@link BreakableProp.state}. It is separate rather than shared
   * because this family is transcribed whole — all three of its values are
   * live, where `branchLatched` only ever had to answer "again or not".
   * **Check the family before reading either.**
   */
  cuePhase: PropCuePhase;   // +0x192
  /**
   * `obj+0x1B8` — the height `PropUpdateType38` comes back to rest at, and
   * the floor its hull corners are tested against. `PlaceTable38Props` and
   * `PlaceTable39Stacks` both write the row's `y` here. Zero for every other
   * family.
   */
  restHeight: number;     // +0x1B8
  /** `PropUpdateType39`'s stack. Empty for every other family. */
  stack: StackItem[];     // +0x1FC / +0x22C
  /**
   * `obj+0x118` — a uniform draw scale, `MatrixScale(s, s, s)`.
   * `PlaceFragmentProps` writes 1.0 and then a per-sub-kind value; nothing
   * else in class 0x41 reads it. 1 for every other family.
   */
  scale: number;          // +0x118
  /** `PropUpdateType40`'s forty pieces, from the frame it is shot. */
  burst: BurstPiece[];    // +0x238 ..
  /** `obj+0x1C0` — frames the burst has run; it draws while this is < 100. */
  burstFrames: number;    // +0x1C0
  /**
   * [port-only] The answers the draw halves of types 39, 40 and 44 compute
   * on their way to `AssetDrawSlot`, left on the object so `render/` reads
   * them rather than making the decision itself: how many stack items this
   * frame's draw includes, the per-axis `MatrixScale`, and the posed nodes of
   * an effect tree. The engine keeps none of these; it draws in the routine.
   */
  stackDrawn: number;
  drawScale: [number, number, number];
  effectPoses: PosedNode[];
  /**
   * [port-only] The routine returned before its `AssetDrawSlot` this frame.
   * Only {@link PropFamily.ContainerFragment} ever sets it: a settled piece
   * past count 0x96 draws on even counts only.
   */
  drawSkipped: boolean;
  /**
   * [port-only] Every `AssetDrawSlot` the object's routine made on its last
   * frame, in the order it made them, each with the matrix it was made under
   * — or `null` for a routine that does not record its draws, which
   * `render/breakables.ts` then poses from the fields as it always has.
   *
   * The engine draws **inside** the routine, interleaved with the state it
   * steps, so what a frame shows is the state at the moment of each call and
   * not the state the routine leaves behind: `FUN_004668A0` draws its slot
   * and then increments it, a sweep draws before it swings. A renderer that
   * posed from the fields afterwards showed every such routine one step
   * along. Recording the call where the routine makes it is what lets the
   * draw be transcribed with the routine instead of rebuilt beside it. The
   * routine clears the list at its head (`PropDrawBegin`, `class41/
   * prop_draw.ts`), so a frame it returns early from draws nothing — which
   * is also what the engine does.
   */
  draws: PropDrawCall[] | null;
  /**
   * The words of the 0x378-byte object that a transcribed generic routine
   * keeps and no field above carries, **keyed by their offset** — `"o200"` is
   * `obj+0x200`.
   *
   * Keyed by offset and not by meaning because in this family the offset is
   * all the words share: `PlaceGenericProp` builds one object for fifty
   * routines, and `obj+0x200` is one routine's hinge angle and another's
   * nothing at all (`L3`). Each routine's file declares the words it keeps as
   * an interface of its own, named for what *that* routine uses them for,
   * and reads them through it. `ActorClearGameFields` (`FUN_004A73D0`) has
   * zeroed every one of them, so an absent key reads as 0.
   *
   * A word that a field above already carries — `+0x2A0`, `+0x1E8`, `+0x192`
   * and the rest, each documented with its offset — is read through that
   * field, and never through this. Plain numbers only, so the pool still
   * survives `clonePlain`.
   */
  words: Record<string, number>;
  /**
   * [port-only] Where the last shot on this prop was aimed, at the prop's own
   * camera depth — `g_crosshair_x/y` unprojected by `obj+0x78`, which is what
   * `SpawnPropHitEffectScaled` (`FUN_004666B0`) computes when a routine calls
   * it. The port resolves the ray at shot time (`combat/shot.ts`), so the
   * point is left here for the routine. `null` when nothing could project it.
   */
  hitAim: { x: number; y: number } | null;
  /**
   * `obj+0x192` for the two generic routines that keep a small state machine
   * there: {@link PropFamily.Type13}'s drop (`Type13Phase`) and type 35's
   * door rattle (`Type35Phase`) -- and {@link PropFamily.Type37}'s fall,
   * pivot and break (`Type37Phase`), which is its own constructor's.
   *
   * The fifth port field for that one engine word, and separate for the same
   * reason {@link BreakableProp.cuePhase} is (`L3`): each routine's `1` means
   * something different. **Check the family, and for `Generic` the type.**
   */
  routinePhase: number;     // +0x192
  /** Dead, and due to leave the pool. Not an exe field; the pool is a list. */
  dead: boolean;
  /** {@link PropFamily.Type48}'s own words, and null for every other family. */
  flicker: FlickerLightState | null;
  /**
   * {@link PropFamily.ChainSegment}'s own words, and null for every other
   * family: the link is a 0x200-byte object with a layout of its own, and the
   * offsets the fields above name are other words of it (`L3`).
   */
  chain: ChainSegmentState | null;
  /**
   * {@link PropFamily.Type55}'s eight hundred pieces and
   * {@link PropFamily.Type65}'s three hundred; empty for every other family.
   * The task's frame count, `obj+0x1A0`, is a word of the routine's own
   * ({@link BreakableProp.words}) -- see each routine's file.
   */
  particles: ScatterParticle[];
}

/**
 * The words of one chain link (`ChainSegmentUpdate`, `FUN_00469510`), by the
 * offsets `PlaceChainSegments` and the routine write.
 */
export interface ChainSegmentState {
  /** `+0x11C` (s16) — how many step boundaries the link outlives. */
  lifetime: number;       // +0x11C
  /**
   * `+0x194..+0x19C` — the link's **foot** in the world: the translation of
   * its stored matrix, which is 1.5 below where its model is drawn. The shot
   * sphere's centre and the item drop's `x`/`z`.
   */
  wx: number;             // +0x194
  wy: number;             // +0x198
  wz: number;             // +0x19C
  /** `+0x1A0..+0x1A8` — the placer's position, the top of the chain. */
  ax: number;             // +0x1A0
  ay: number;             // +0x1A4
  az: number;             // +0x1A8
  /** `+0x1AC` (s8) — the chain group, `g_chain_segments`' row. */
  group: number;          // +0x1AC
  /** `+0x1AD` (s8) — 0..19, the link's place from the top. */
  index: number;          // +0x1AD
  /** `+0x1AE` (s8) — the step index as a byte, read back sign-extended. */
  lastStep: number;       // +0x1AE
  /** `+0x1AF` (s8) — step boundaries seen. */
  steps: number;          // +0x1AF
  /** `+0x1B0` — segment 0's route latch (`ChainLatch`); unused on the rest. */
  latch: number;          // +0x1B0
  /** `+0x1B2` (s16 BAMS) — the swing about X. */
  pitch: number;          // +0x1B2
  /** `+0x1B4` (s16 BAMS) — the link's own turn, `index << 14`. */
  yaw: number;            // +0x1B4
  /** `+0x1B6` (s16 BAMS) — the swing about Z. */
  roll: number;           // +0x1B6
  /** `+0x1B8` (s16) — {@link pitch}'s rate. */
  pitchRate: number;      // +0x1B8
  /** `+0x1BC` (s16) — {@link roll}'s rate. */
  rollRate: number;       // +0x1BC
  /**
   * `+0x1C0` — `MatrixStore` of the link's matrix after its 1.5 drop: what the
   * link below hangs from. The world matrix in the port, where the engine's
   * is built on the view (`class41/prop_draw.ts`).
   */
  m: number[];            // +0x1C0
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
    lastStepIndex: 0,
    stepsElapsed: 0,
    lifetime: 0,
    hp: 0,
    state: BreakableState.Standing,
    slot: BreakableSlot.Default,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    pitch: 0, yaw: 0, roll: 0,
    spin: 0,
    yawSpin: 0,
    rollSpin: 0,
    restPitch: 0,
    hingeB: 0,
    topple: 0,
    contact: 0,
    restX: 0, restY: 0, restZ: 0,
    shake: 0,
    shakeX: 0,
    shakeZ: 0,
    drawMatrix: [],
    drawView: [],
    flags: 0,
    effect: 0,
    effectFrames: 0,
    effectPrevFrame: 0,
    cueCursorB: 0,
    family: PropFamily.Group,
    kind: 0,
    floorY: 0,
    effectVariant: 0,
    settleTimer: 0,
    hitPos: { x: 0, y: 0, z: 0 },
    hitRadius: 0,
    shotX: 0, shotY: 0, shotZ: 0,
    shotRegistered: false,
    subKind: 0,
    removeFlag: -1,
    cuePhase: PropCuePhase.Untouched,
    routinePhase: 0,
    key0: -1, key1: -1, key2: -1, key3: -1,
    branchLatched: false,
    restHeight: 0,
    stack: [],
    scale: 1,
    burst: [],
    burstFrames: 0,
    stackDrawn: 0,
    drawScale: [1, 1, 1],
    effectPoses: [],
    drawSkipped: false,
    draws: null,
    words: {},
    hitAim: null,
    dead: false,
    flicker: null,
    chain: null,
    particles: [],
  };
}
