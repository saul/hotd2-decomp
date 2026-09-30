/**
 * Class 0x32's own words, apart from the class module so `actor.ts` can name
 * the tail without importing the class (the arrangement `class14/state.ts`
 * explains).
 *
 * Every object the class makes is a `0x13F4`-byte actor of the engine's pool:
 * the boss itself, which the script spawns, and five kinds of task it
 * allocates with `ActorAlloc` (`FUN_004A6FA0`) and `ActorClearGameFields`
 * (`FUN_004A73D0`). The port keeps the boss and its **projectiles** as
 * `Actor`s of this class -- a projectile registers for the shot test and is
 * shot through `MarkActorShot`, which is the actor pool's -- and the four
 * kinds that only draw as records in `G.g_class32_tasks` (`tasks.ts`), the
 * way class 0x45's tasks are kept.
 *
 * The engine's actor holds **the routine its allocation installed** at
 * `obj+0x00` and the task walk calls it; {@link Class32Routine} is that word,
 * which `Class32Update`'s dispatch in `index.ts` switches on.
 *
 * Fields that the boss and a projectile both use at one offset mean different
 * things in the two (`L3`); each is named for what the object that writes it
 * uses it as, and each carries its offset.
 */
import { vec3, type Vec3 } from "../vec";

/**
 * `g_class32_states` — `0x00596738`, read out of memory (L38): thirteen
 * dwords. [10] and [11] are the same routine; [12] is `FUN_0041EBB0`, the
 * bare `RET` `BuildClassHandlerTable` fills unmapped slots with, and nothing
 * writes state 11 or 12. The members are the table's indices.
 */
export enum Class32State {
  /** `Class32StateWaitCamAndFlags` (`FUN_00480050`). Init leaves the boss here. */
  WaitCamAndFlags = 0,
  /** `Class32StateMoveToFixedPoint` (`FUN_0047D120`). */
  MoveToFixedPoint = 1,
  /** `Class32StateDeathSequence` (`FUN_00480140`). Entered only by `Class32OnShot`. */
  DeathSequence = 2,
  /** `Class32StateDeathRetire` (`FUN_00480290`). */
  DeathRetire = 3,
  /** `Class32StateRaiseFlagAndLeave` (`FUN_00480470`). */
  RaiseFlagAndLeave = 4,
  /** `Class32StateHitReaction` (`FUN_0047CA50`). Entered only by `Class32OnShot`. */
  HitReaction = 5,
  /** `Class32StateHopNearCamera` (`FUN_0047D220`). Attack kind 0. */
  HopNearCamera = 6,
  /** `Class32StateCastProjectiles` (`FUN_0047D410`). */
  CastProjectiles = 7,
  /** `Class32StateCircleCamera` (`FUN_0047D5E0`). Attack kind 1. */
  CircleCamera = 8,
  /** `Class32StateLungeAtCamera` (`FUN_0047D890`). */
  LungeAtCamera = 9,
  /** `Class32StateFinalBarrage` (`FUN_0047DD50`). Attack kind 3. */
  FinalBarrage = 10,
  /** The same routine as {@link FinalBarrage}. Nothing writes 11. */
  FinalBarrage11 = 11,
  /** `FUN_0041EBB0`, a bare `RET`. Nothing writes 12. */
  NoOp12 = 12,
}

/**
 * `g_class32_projectile_states` — `0x00596AB0`, four dwords (L38): the
 * projectile's `obj+0x1310`. `0x00596AC0`, right after, is the banner record.
 */
export enum Class32ProjectileState {
  /** `Class32ProjectileStateGather` (`FUN_0047E440`). */
  Gather = 0,
  /** `Class32ProjectileStateFlyAtCamera` (`FUN_0047E810`). */
  FlyAtCamera = 1,
  /** `Class32ProjectileStateScatter` (`FUN_0047E980`). */
  Scatter = 2,
  /** `Class32ProjectileStateBurst` (`FUN_0047ED10`). */
  Burst = 3,
}

/**
 * `[port-only]` The routine at `obj+0x00` -- which of the class's update
 * routines the task walk calls for this actor. The engine keeps a function
 * pointer there; a snapshot keeps a number.
 */
export enum Class32Routine {
  /** `Class32Update` (`FUN_0047C960`), installed by `Class32Init`. */
  Boss = 0,
  /** `Class32ProjectileDispatchAndDraw` (`FUN_0047EFA0`), by `Class32SpawnProjectile`. */
  Projectile = 1,
}

/**
 * A projectile's kind, `obj+0x1354`, as `Class32SpawnProjectile`
 * (`FUN_0047EE30`) is handed it. Kind 5 is stored as 4 with `obj+0x131B` 0;
 * kind 4 keeps `obj+0x131B` 1. Kind 3 is never spawned: the gather's switch
 * has no arm for it.
 */
export enum Class32ProjectileKind {
  /** Volleys 0 and 2 -- from bone 5, released on clip 0x8C cursor 0x46. */
  LeftHand = 0,
  /** Volleys 1 and 2 -- from bone 8, released on clip 0x8B cursor 0x46. */
  RightHand = 1,
  /** The lunge's -- held at bone 8 and never released; it bursts. */
  Held = 2,
  /** The barrage's -- between the hands, released on clip 0x94 cursor 0xA5. */
  Barrage = 4,
  /** {@link Barrage} thrown wide: `obj+0x131B = 0`, kind 4. */
  BarrageWide = 5,
}

/**
 * The boss's attack kind, `obj+0x131A` (s8). The phase's state writes it on
 * entry and `Class32StateHitReaction` (`FUN_0047CA50`) reads it to send the
 * boss back where it was.
 */
export enum Class32Attack {
  /** `Class32StateHopNearCamera` and its casts. */
  Hop = 0,
  /** `Class32StateCircleCamera` and its lunge. */
  Circle = 1,
  /** `Class32StateFinalBarrage`. */
  Barrage = 3,
  /** `Class32StateDeathRetire`'s `0xFF`. */
  None = -1,
}

/**
 * `obj+0x136C`'s bits as this class uses them (L3) -- the boss's, and the
 * projectile's own copy of the word.
 */
export enum Class32Flag2 {
  /** Boss: the next launched projectile plays `0xD23A9`; `Class32StateCastProjectiles` raises it. */
  LaunchSound = 0x01,
  /** Boss: raised by `Class32OnShot` on the killing hit. Read by nothing in the class. */
  Killed = 0x02,
  /** Boss: a held projectile's trail five times slower. Written by nothing. */
  SlowHeldTrail = 0x04,
  /** Boss: `Class32BodyLoopEffectTick` lives while it is up. */
  BodyLoop = 0x20,
  /** Projectile: it struck and hurt nobody -- its burst is an eighth as long. */
  StruckNobody = 0x40,
}

/**
 * The class-0x32 arm of the `Actor`: the boss's fields and a projectile's,
 * each at its offset.
 */
export interface Boss5Tail {
  /** `[port-only]` `obj+0x00` -- see {@link Class32Routine}. */
  routine: Class32Routine;

  // -- the boss ---------------------------------------------------------------

  /** `obj+0x131A`, s8 -- {@link Class32Attack}. Zero from `ActorClearGameFields`. */
  attack: number;
  /** `obj+0x131B`, u8 -- the state a reaction interrupted, `0xFF` after it. */
  interrupted: number;
  /** `obj+0x131E`, s8 -- the rank, 0..15 by `Class32AdjustRank`, 16 after 18000 frames. */
  rank: number;
  /** `obj+0x1320`/`+0x1324` -- `Class32Init`'s `VecToAngles` toward the eye, `& 0xFFFF`. Read by nothing. */
  initPitch: number;
  initYaw: number;
  /** `obj+0x1328` -- the barrage's launches this round. */
  launches: number;
  /** `obj+0x132C` -- zeroed by `Class32StateMoveToFixedPoint` and never written else; `Class32StateCastProjectiles` tests it for 2. */
  castMode: number;
  /** `obj+0x1330` -- the state's frame count. */
  timer: number;
  /** `obj+0x1334` -- the hit flash, counted down by the bone-2 draw. */
  flash: number;
  /** `obj+0x1338` -- `-1` from `Class32StateCircleCamera` sub 0. Read by nothing in the class. */
  circleWord: number;
  /** `obj+0x133C` -- frames toward the next afterimage. */
  afterimageCount: number;
  /** `obj+0x1350` -- projectiles alive. */
  liveProjectiles: number;
  /** `obj+0x1354` -- the hop point, 0..3. */
  hop: number;
  /** `obj+0x1358` -- `Class32StateCircleCamera`'s direction round the points, +-1. */
  hopStep: number;
  /** `obj+0x135C` -- the circle's hops so far. */
  laps: number;
  /** `obj+0x1360` -- the cast's volley, 0..2, or -1. */
  volley: number;
  /** `obj+0x1364` -- the row of `g_class32_phases` the fight is on. */
  phase: number;
  /** `obj+0x1368` -- hits `Class32OnShot` counts before a kind-1 reaction. */
  hitsToReact: number;
  /** `obj+0x138C` -- frames of the fight, as a float; past 18000.0 the rank goes to 16. */
  clock: number;
  /** `obj+0x13C0`..`+0x13C8` -- the destination the states move toward. */
  dest: Vec3;
  /**
   * `[port-only]` What `Class32DrawBonePart` (`FUN_0047F780`) drew this frame,
   * per bone: the slots `Class32DrawNodeSlot` (`FUN_0047FC50`) handed
   * `AssetDrawSlot`, each with the light colour it was drawn under (null for
   * the one `LightsUseSecondarySet` installed). The renderer reads it; nothing
   * reads it back.
   */
  nodeDraws: Record<string, Class32NodeDraw[]>;
  /**
   * `[port-only]` The light colour the draw last set, which the next
   * `AssetDrawSlot` in the walk is made under -- the engine's
   * `SetRenderLightColour` state, for this draw only. Null while it is the
   * colour `LightsUseSecondarySet` installed.
   */
  drawLight: [number, number, number] | null;
  /**
   * `[port-only]` The light colour the walk's part loop drew the model's
   * part 0 under: `SkeletonDrawWalk` (`FUN_004110D0`) draws the parts after
   * every node, and `DrawCharacterPartSlot` (`FUN_00419B40`) sets no colour
   * for this type, so it is whatever the last node's draw left. The renderer
   * reads it.
   */
  partLight: [number, number, number] | null;
  /**
   * `[port-only]` The light direction the draw was made under -- what
   * `LightsUseSecondarySet` installed at its head (`G.g_render_light_dir`,
   * the world vector the light comes from). No node sets a direction, so it
   * holds for every model the draw makes, and it is block 1's **as it stood
   * then**: the aim `Class32DrawNodeSlot` writes into the blocks reaches this
   * draw on the next frame. The renderer reads it.
   */
  drawDir: [number, number, number];

  // -- a projectile -----------------------------------------------------------

  /** `obj+0x1390` on a projectile -- the boss that made it, by `at` (L3: a parent, not a tail). */
  parent: number;
  /** `obj+0x1354` on a projectile -- {@link Class32ProjectileKind}, 5 stored as 4. */
  kind: number;
  /** `obj+0x131B` on a projectile -- 1 for an aimed barrage projectile, 0 for a wide one. */
  aimed: number;
  /** `obj+0x1360` on a projectile -- the boss's volley when it was made. */
  castVolley: number;
  /** `obj+0x1364` on a projectile -- frames before its growth starts. */
  growDelay: number;
  /** `obj+0x1368` on a projectile -- the boss's live count after it, its place in the volley. */
  place: number;
  /** `obj+0x1370`/`+0x1374` -- the size it grows to and its step a frame. */
  growCap: number;
  growStep: number;
  /** `obj+0x118` -- its size. */
  size: number;
  /** `obj+0x1320` -- its brightness, 0xFF down to the burst's end. */
  bright: number;
  /** `obj+0x1330` -- frames toward the next trail. */
  trailCount: number;
  /** `obj+0x1334` -- its trail interval; in the burst, the burst's frames. */
  trailEvery: number;
  /** `obj+0x1338` -- the flight's frames left. */
  flight: number;
  /** `obj+0x133C` -- a barrage flight's frames before its trail starts. */
  trailDelay: number;
  /** `obj+0x1340` -- the burst's brightness step, a float of an integer quotient. */
  fadeStep: number;
  /** `obj+0x1350` -- the brightness the burst ends at. */
  fadeEnd: number;
  /** `obj+0x13C0`..`+0x13C8` -- where it flies to. */
  target: Vec3;
  /** `obj+0x13F0` -- the slot it draws, `eff_boss5.bin` 0xB02..0xB33. */
  slot: number;
  /**
   * `obj+0x70`..`+0x78` -- its own position in view space, as its draw last
   * stored it (`MatrixTransformPoint` through `g_camera_world_to_view`).
   * `Class32ProjectileIsOnScreen` and `Class32ProjectileStrikePlayer` read it.
   */
  view: Vec3;
  /**
   * `[port-only]` What its draw handed `MatrixScale` and `SetRenderLightColour`
   * this frame -- the world matrix and the light -- or null for a frame it drew
   * nothing. The renderer reads it.
   */
  draw: { m: number[]; light: [number, number, number] } | null;
}

/** `[port-only]` One `AssetDrawSlot` a node draw made, and its light. */
export interface Class32NodeDraw {
  slot: number;
  light: [number, number, number] | null;
}

/** `[port-only]` The arm as `ActorClearGameFields` leaves it: every word zero. */
export function makeBoss5Tail(): Boss5Tail {
  return {
    routine: Class32Routine.Boss,
    attack: 0, interrupted: 0, rank: 0, initPitch: 0, initYaw: 0,
    launches: 0, castMode: 0, timer: 0, flash: 0, circleWord: 0,
    afterimageCount: 0, liveProjectiles: 0, hop: 0, hopStep: 0, laps: 0,
    volley: 0, phase: 0, hitsToReact: 0, clock: 0, dest: vec3(),
    nodeDraws: {}, drawLight: null, partLight: null, drawDir: [0, 0, 1],
    parent: -1, kind: 0, aimed: 0, castVolley: 0, growDelay: 0, place: 0,
    growCap: 0, growStep: 0, size: 0, bright: 0, trailCount: 0,
    trailEvery: 0, flight: 0, trailDelay: 0, fadeStep: 0, fadeEnd: 0,
    target: vec3(), slot: 0, view: vec3(), draw: null,
  };
}

/**
 * `[port-only]` The routine a task in `G.g_class32_tasks` runs -- the word
 * its `ActorAlloc` installed at `obj+0x00`.
 */
export enum Class32TaskRoutine {
  /** `Class32AfterimageTick` (`FUN_0047DC30`), by `Class32SpawnAfterimage`. */
  Afterimage = 0,
  /** `Class32BodyLoopEffectTick` (`FUN_0047E130`), by `Class32SpawnBodyLoopEffect`. */
  BodyLoop = 1,
  /** `Class32HandsEffectTick` (`FUN_0047E2B0`), by `Class32SpawnHandsEffect`. */
  Hands = 2,
  /** `Class32ProjectileTrailTick` (`FUN_0047F4A0`), by `Class32EmitProjectileTrail`. */
  ProjectileTrail = 3,
  /** `Class32DeathBurstTick` (`FUN_00480700`), by `Class32SpawnDeathBurst`. */
  DeathBurst = 4,
  /** `Class32ExitEffectTick` (`FUN_00480810`), by `Class32SpawnExitEffect`. */
  ExitEffect = 5,
}

/**
 * One draw-only task the class allocates: a `0x13F4`-byte actor in the
 * engine, cleared by `ActorClearGameFields`, of which each routine reads a
 * handful of words. Plain data, so a snapshot carries it.
 */
export interface Class32Task {
  /** `[port-only]` The pool's identity for it; the engine's is its address. */
  id: number;
  /** `[port-only]` `obj+0x00`. */
  routine: Class32TaskRoutine;
  /** `obj+0x1390` -- the actor that made it, by `at` (L3). */
  parent: number;
  /** `obj+0x40`..`+0x48`. */
  pos: Vec3;
  /** `obj+0x4C`..`+0x54` -- the trail's copy of its projectile's; only `y` moves. */
  vel: Vec3;
  /** `obj+0x5C` -- the trail's rise, a frame. */
  accY: number;
  /** `obj+0x64`, `+0x68`, `+0x6C` -- BAMS. */
  pitch: number;
  yaw: number;
  roll: number;
  /** `obj+0x118` -- the size `MatrixScale` is handed. */
  size: number;
  /** `obj+0x1312` -- the sub-state. */
  sub: number;
  /** `obj+0x131A` -- the trail's copy of its projectile's attack kind. */
  attack: number;
  /** `obj+0x1320` -- brightness, 0xFF down. */
  bright: number;
  /** `obj+0x1330` -- a count. */
  timer: number;
  /** `obj+0x1350`, `+0x1354`, `+0x1358` -- a loop's cursor, first and last slot. */
  cel: number;
  celFirst: number;
  celLast: number;
  /** `obj+0x138C` -- the light (or the fade) its draw computed. */
  light: number;
  /** `obj+0x13F0` -- the slot it draws. */
  slot: number;
  /**
   * `[port-only]` This frame's `AssetDrawSlot`: the slot, its world matrix,
   * the light colour and the alpha (`AssetDrawSlotWithAlpha`), and the draw
   * layer (`SetDrawLayerNibble`) -- or null for a frame that drew nothing.
   */
  draw: Class32TaskDraw | null;
  /** `[port-only]` `ActorKill`/`ActorDespawn` ran: the pool drops it after this frame. */
  killed: boolean;
}

/**
 * `[port-only]` One task's draw, for the renderer: `light` is the colour the
 * light register held at the `AssetDrawSlot` -- the task's own, or for the
 * two that set none (the death burst, the exit effect) whatever the draw
 * before them left.
 */
export interface Class32TaskDraw {
  slot: number;
  m: number[];
  light: [number, number, number];
  alpha: number | null;
  layer: number | null;
}
