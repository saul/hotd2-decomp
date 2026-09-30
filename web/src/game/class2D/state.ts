/**
 * Class 0x2D's own words, apart from the class module so `actor.ts` can name
 * the tail without importing the class (the arrangement `class14/state.ts`
 * and `class45/state.ts` have, for the reason `registry.ts` records).
 *
 * Every object this class runs is an `ActorAlloc(routine, 0x13F4)` object --
 * the boss (sub-types 0 and 1, from the script), its eight satellites (from
 * `Class2DClassHandler`), the child `Class2DState4` builds, kind 0's wing
 * (an `ActorAllocSub` block kind 0 draws) -- and they share one layout: the
 * same `obj+0x1320..0x13C8` words, read differently by each routine (L3).
 * The port keeps them in one tail, {@link Class2DTail}, with the offsets on
 * the fields and each field's meaning per routine written beside it; which
 * routine an object runs is `obj+0x00`, {@link Class2DTail.routine}.
 *
 * The small tasks the class allocates (the sparks, the trail, the intro
 * flipbook, the death burst) are records in `G.g_class2d_tasks`
 * (`class2D/tasks.ts`).
 */
import type { Mat } from "../matrix";
import { vec3, type Vec3 } from "../vec";

/** `obj+0x00` -- the routine the task walk calls for this object. */
export enum Class2DRoutine {
  /** `Class2DClassHandler` (`FUN_00426A70`) -- `g_class_handlers[0x2D]`. */
  ClassHandler = 0,
  /** `Class2DUpdate` (`0x00426C30`) -- sub-type 1. */
  Update = 1,
  /** `Class2DSubtype0Update` (`0x00428CD0`) -- stage 5 block 0's cameo. */
  Subtype0Update = 2,
  /** `Class2DSatelliteInit` (`0x00429D00`). */
  SatelliteInit = 3,
  /** `Class2DSatelliteUpdate` (`0x00429D30`). */
  SatelliteUpdate = 4,
  /** `Class2DChildKind0Init` (`0x0042C0B0`). */
  ChildKind0Init = 5,
  /** `Class2DChildKind0Update` (`0x0042C1A0`). */
  ChildKind0Update = 6,
  /** `Class2DChildKind1Init` (`0x0042C830`). */
  ChildKind1Init = 7,
  /** `Class2DChildKind1Update` (`0x0042C8D0`). */
  ChildKind1Update = 8,
  /** `Class2DChildKind2Init` (`0x0042CD30`). */
  ChildKind2Init = 9,
  /** `Class2DChildKind2Update` (`0x0042CDD0`). */
  ChildKind2Update = 10,
  /** `Class2DChildKind3Init` (`0x0042D490`). */
  ChildKind3Init = 11,
  /** `Class2DChildKind3Update` (`0x0042D530`). */
  ChildKind3Update = 12,
  /**
   * `[port-only]` -- kind 0's wing, the `ActorAllocSub(0x13F4)` block at the
   * kind's `obj+0x13B0`. It is no task in the engine: nothing calls it, and
   * `Class2DChildKind0Draw` poses and draws it. It is an object here so the
   * renderer can bind a skeleton to it, as class 0x22's sub-actor is.
   */
  Wing = 13,
}

/** `g_class2d_states` (`0x005898A8`), seven entries -- `obj+0x1310`. */
export enum Class2DState {
  /** `Class2DState0` (`0x00426C50`) -- the intro cut on camera path 0xDF. */
  IntroRise = 0,
  /** `Class2DState1` (`0x00426D70`) -- object path 0x185 to frame 1810. */
  IntroPath185 = 1,
  /** `Class2DState2` (`0x00426E60`) -- 300 frames to the fight. */
  Join = 2,
  /** `Class2DState3` (`0x00426FD0`) -- the waypoint round. */
  Round1 = 3,
  /** `Class2DState4` (`0x00427D40`) -- the child round. */
  Round2 = 4,
  /** `Class2DState5` (`0x00428400`) -- the path round. */
  Round3 = 5,
  /** `Class2DState6` (`0x00428AE0`) -- the death. */
  Death = 6,
}

/** `g_class2d_satellite_states` (`0x00589908`), nine entries. */
export enum Class2DSatelliteState {
  /** `Class2DSatelliteWaitForParent` (`0x00429D50`). */
  WaitForParent = 0,
  /** `Class2DSatelliteAppear` (`0x00429DB0`). */
  Appear = 1,
  /** `Class2DSatelliteOrbitAndPick` (`0x00429F70`). */
  OrbitAndPick = 2,
  /** `Class2DSatelliteFlyAtCamera` (`0x0042A100`) -- the boss's attack 1. */
  FlyAtCamera = 3,
  /** `Class2DSatellitePairBeam` (`0x0042A6F0`) -- the boss's attack 2. */
  PairBeam = 4,
  /** `Class2DSatelliteAbsorbAtBone5` (`0x0042B230`) -- the boss's attack 3. */
  AbsorbAtBone5 = 5,
  /** `Class2DSatelliteRideChild` (`0x0042B650`) -- the boss's state 4. */
  RideChild = 6,
  /** `Class2DSatelliteOrbitWithTrail` (`0x0042B9D0`) -- the boss's state 5. */
  OrbitWithTrail = 7,
  /** `Class2DSatelliteDespawn` (`0x0042BB60`). */
  Despawn = 8,
}

/**
 * The boss's `obj+0x136C`: one word every satellite and every child reads
 * (`parent+0x136C`), written by the boss at the moments its clips reach.
 * Named for the moments, because they are the whole of what it means.
 */
export enum Class2DCue {
  /** 0 -- written by the handler; the satellites wait for anything else. */
  None = 0,
  /** 1 -- the round's move is over; satellites go back to orbiting. */
  Resume = 1,
  /** 2 -- the attack's clip reached its cue frame; satellites pick. */
  Attack = 2,
  /** 3 -- the satellites are placed; the attack (or the child) goes. */
  Go = 3,
  /** 4 -- the boss has despawned; satellites despawn. */
  Gone = 4,
}

/** The boss's words -- sub-types 0 and 1. */
export interface Class2DBossWords {
  /** `obj+0x130C` -- `(s8)tail[1]`: 0 the stage-5 cameo, 1 the fight. */
  subtype: number;
  /**
   * `obj+0x1320` -- state 3: the next attack (the sub it glides into);
   * state 4: the child kind; state 6: 1 freezes the counter.
   */
  next: number;
  /** `obj+0x1324` -- the rank, 0..15 (`Class2DAdjustRank`). */
  rank: number;
  /** `obj+0x1328` -- the hits counted in a charge or on a path. */
  hits: number;
  /** `obj+0x132C` -- non-zero holds the frame counter (and the charge). */
  hold: number;
  /** `obj+0x1330` -- the state's frame count. */
  count: number;
  /** `obj+0x1334` -- a divisor or a count: the charge, a glide, a hold. */
  span: number;
  /** `obj+0x1338` -- bone 5's glow cel, 0..0x3B. */
  glow: number;
  /** `obj+0x133C` -- who shot: -1 none, 0, 1, or 2 for both players. */
  shooter: number;
  /** `obj+0x1340` -- f32, the frame on a state-5 path. */
  pathFrame: number;
  /** `obj+0x1344`, `+0x1348`, `+0x134C` -- the light colour, flashed on a hit. */
  colour: [number, number, number];
  /** `obj+0x1350` -- the waypoint (states 3, 4) or path (state 5) index. */
  index: number;
  /** `obj+0x1354` -- the waypoint just left. */
  prevIndex: number;
  /** `obj+0x1358` -- 1 near a path's end: the strike is coming. */
  warn: number;
  /** `obj+0x135C` -- 1 on the frame after a path's strike. */
  struck: number;
  /** `obj+0x1360` -- bone 5's glow: 0 off, 1 growing, 2 shrinking. */
  glowMode: number;
  /** `obj+0x1364` -- 1 once bone 1's core flipbook shows. */
  core: number;
  /** `obj+0x1368` -- the sub's own step. */
  phase: number;
  /** `obj+0x136C` -- {@link Class2DCue}. */
  cue: number;
  /** `obj+0x1370` -- f32, the alpha every model of the boss is drawn at. */
  alpha: number;
  /** `obj+0x1374` -- f32, the weak point's radius: 2.0, then 1.6. */
  weakRadius: number;
  /** `obj+0x13C0..+0x13C8` -- the point the state moves toward. */
  target: Vec3;
  /** `obj+0x1390` -> `tail+0x02` -- the clip the handler starts on. */
  clip: number;
  /** `tail+0x04` -- the frame counter the handler starts from. */
  counterStart: number;
  /** `tail+0x06`, `tail+0x08` -- the cameo's despawning camera path and frame. */
  killPath: number;
  killFrame: number;
  /** `tail+0x0A` -- the fight's hit points. */
  fightHp: number;
  /** `tail+0x0C` -- state 3 ends at or below these hit points. */
  round2Hp: number;
  /** `tail+0x0E` -- state 4 ends at or below these hit points. */
  round3Hp: number;
}

/** A satellite's words. */
export interface Class2DSatelliteWords {
  /** `obj+0x131B` -- which of the eight, 0..7. */
  index: number;
  /** `obj+0x1330` -- the state's frame count. */
  count: number;
  /** `obj+0x1334` -- a flight's frames. */
  flight: number;
  /** `obj+0x1338` -- the launch gap. */
  gap: number;
  /** `obj+0x133C` -- the pair routine's draw: 0 the satellite, 1 none, 2 the pair. */
  drawMode: number;
  /** `obj+0x1340` -- f32, the drawn scale, 0 -> 1. */
  scale: number;
  /** `obj+0x1350` -- the orbit's step count. */
  orbit: number;
  /** `obj+0x1368` -- 1 tells the trail to go. */
  trailOff: number;
  /** `obj+0x13C0..+0x13C8` -- a target: an orbit point, or a view-space aim. */
  target: Vec3;
  /**
   * `obj+0x70..+0x78` -- the camera-space point `Class2DSatelliteRegisterShot`
   * and `Class2DSatelliteAppear` write, which the launches aim along and the
   * flares are drawn at. The port files the shot at {@link Actor.shotCentre}
   * in the world, so the view point the class reads has a word of its own.
   */
  view: Vec3;
}

/** A child's words -- kinds 0..3, and kind 0's wing. */
export interface Class2DChildWords {
  /** Which kind, 0..3 (the init the table at `0x004283E4` picked). */
  kind: number;
  /** `obj+0x1320` -- 1 steps the frame counter. */
  animate: number;
  /** `obj+0x1324` -- 1 draws the model and its parts (0 draws the billboard). */
  shown: number;
  /** `obj+0x1330` -- a count, or kind 0's path frame. */
  count: number;
  /** `obj+0x1334` -- a count, or an approach divisor. */
  span: number;
  /** `obj+0x1350` -- kind 0's path, `rand() % 2`. */
  path: number;
  /** `obj+0x13B0` -- kind 0's wing, by address; -1 none. */
  wingAt: number;
  /** `obj+0x13C0..+0x13C8` -- the point it moves toward. */
  target: Vec3;
  /**
   * `obj+0x10C..+0x114` -- kind 2's bone 24 in the camera's space, written
   * beside `obj+0x100` every frame. `[open]` no reader in the class.
   */
  lookAtView: Vec3;
}

/**
 * The class's tail. One role block is set, by the routine the object was
 * allocated with; the others stay null.
 */
export interface Class2DTail {
  /** `obj+0x00`. */
  routine: Class2DRoutine;
  boss: Class2DBossWords | null;
  sat: Class2DSatelliteWords | null;
  child: Class2DChildWords | null;
}

/** `[port-only]` A fresh tail, on the handler. */
export function makeClass2DTail(): Class2DTail {
  return { routine: Class2DRoutine.ClassHandler, boss: null, sat: null,
           child: null };
}

/** `[port-only]` A boss block as `ActorAlloc` leaves it -- zeroed. */
export function makeClass2DBossWords(): Class2DBossWords {
  return {
    subtype: 0, next: 0, rank: 0, hits: 0, hold: 0, count: 0, span: 0,
    glow: 0, shooter: 0, pathFrame: 0, colour: [0, 0, 0], index: 0,
    prevIndex: 0, warn: 0, struck: 0, glowMode: 0, core: 0, phase: 0, cue: 0,
    alpha: 0, weakRadius: 0, target: vec3(), clip: 0, counterStart: 0,
    killPath: 0, killFrame: 0, fightHp: 0, round2Hp: 0, round3Hp: 0,
  };
}

/** `[port-only]` A satellite block, zeroed. */
export function makeClass2DSatelliteWords(index: number): Class2DSatelliteWords {
  return { index, count: 0, flight: 0, gap: 0, drawMode: 0, scale: 0,
           orbit: 0, trailOff: 0, target: vec3(), view: vec3() };
}

/** `[port-only]` A child block, zeroed. */
export function makeClass2DChildWords(kind: number): Class2DChildWords {
  return { kind, animate: 0, shown: 0, count: 0, span: 0, path: 0,
           wingAt: -1, target: vec3(), lookAtView: vec3() };
}

/**
 * One `g_class2d_satellite_records` entry (`0x009A5F40`, stride 0x14).
 */
export interface Class2DSatelliteRecord {
  /** `+0x00` s8 -- the satellite's index. */
  index: number;
  /** `+0x01` u8 -- 1 while the satellite is out on its move. */
  active: number;
  /** `+0x02` u8 -- its place in the order, or a pair's handshake. */
  order: number;
  /** `+0x04..+0x0C` -- a point: a child bone's, a pair partner's. */
  point: Vec3;
  /** `+0x10` f32 -- its view-space z when the attack was picked. */
  viewZ: number;
}

/** `[port-only]` The eight records as the image holds them -- zeroed. */
export function makeClass2DSatelliteRecords(): Class2DSatelliteRecord[] {
  return Array.from({ length: 8 }, () => ({
    index: 0, active: 0, order: 0, point: vec3(), viewZ: 0,
  }));
}

/**
 * `LightsUseCustomSet` (`FUN_0041DC10`)'s six arguments -- the light a draw
 * is made under, recorded with it. `null` on a draw is the scene's own.
 *
 * `pitch` and `yaw` are BAMS, or `null` for `g_scene_light_pitch_bams` and
 * `g_scene_light_yaw_bams` (`0x009A3558`, `0x009A355C`) -- light block 0's
 * direction, which the port keeps in the walker's light blocks rather than in
 * `G`, and which `render/lighting.ts` already holds; `Class2DDraw` hands the
 * routine those two words and `render/` reads the same two.
 */
export interface Class2DLight {
  ambient: number;
  pitch: number | null;
  yaw: number | null;
  rgb: [number, number, number];
}

/**
 * `[port-only]` One `AssetDrawSlot` / `AssetDrawSlotWithAlpha` the class
 * made this frame, under the matrix the routine built, for `render/` to draw.
 *
 * `view` says the matrix was built on `MatrixLoadIdentity` -- the camera's
 * own space -- rather than in the world. `alpha` is `AssetDrawSlotWithAlpha`'s
 * argument, `null` for the plain draw. `envUv` is an
 * `AssetSlotUVsFromViewNormals` (`FUN_00418660`) call on the same slot just
 * before. The list is rebuilt every frame: it is what the frame drew, not
 * state the next frame reads.
 */
export interface Class2DSlotDraw {
  slot: number;
  m: Mat;
  view: boolean;
  alpha: number | null;
  envUv: boolean;
  light: Class2DLight | null;
}

/** What each of the class's small tasks is -- the routine it was allocated with. */
export enum Class2DTaskKind {
  /** `Class2DHitSparkUpdate` (`0x00429760`), `ActorAlloc(.., 0x40)`. */
  HitSpark = 0,
  /** `Class2DIntroFlipbookUpdate` (`0x00429830`), `ActorAlloc(.., 0x13F4)`. */
  IntroFlipbook = 1,
  /** `Class2DDeathBurstUpdate` (`0x004298C0`), `ActorAlloc(.., 0x13F4)`. */
  DeathBurst = 2,
  /** `Class2DSatelliteHitSparkUpdate` (`0x0042BE90`), `ActorAlloc(.., 0x58)`. */
  SatelliteHitSpark = 3,
  /** `Class2DSatelliteTrailUpdate` (`0x0042BF30`), `ActorAlloc(.., 0x130)`. */
  SatelliteTrail = 4,
}

/**
 * `[port-only]` as a record: one of the tasks above, with the words its
 * routine reads. The engine's tasks are linked into the ring after whatever
 * allocated them; the port steps them after the actor walk, in allocation
 * order (`Class2DTasksTick`).
 */
export interface Class2DTask {
  /** `[port-only]` -- the pool's identity, for the renderer. */
  id: number;
  kind: Class2DTaskKind;
  /** The spark's `+0x34` (the boss) or the trail's `+0x12C` (the satellite), by address. */
  owner: number;
  /** The spark's `+0x3C` -- the bone. */
  bone: number;
  /**
   * The frame: the spark's `+0x38`, the satellite spark's `+0x50`, the intro
   * flipbook's `+0x1320`, the burst's `+0x1320`.
   */
  frame: number;
  /** The burst's `obj+0x40..0x48`; the satellite spark's view-space `+0x38..0x40`. */
  pos: Vec3;
  /** The burst's `+0x1340`, f32 -- its two curves' frame. */
  curveFrame: number;
  /** The burst's `+0x1324` and `+0x1328` -- its two sounds, played once. */
  sound1: number;
  sound2: number;
  /** The trail's twenty points, `+0x34`..`+0x124`. */
  points: Vec3[];
  /** The trail's `+0x128` -- the owner's scale when it was made. */
  scale: number;
  /** `[port-only]` -- set on the frame the routine calls `ActorKill`. */
  killed: boolean;
}

/** `[port-only]` A task as `ActorAlloc` leaves it -- zeroed. */
export function makeClass2DTask(id: number, kind: Class2DTaskKind): Class2DTask {
  return { id, kind, owner: -1, bone: 0, frame: 0, pos: vec3(), curveFrame: 0,
           sound1: 0, sound2: 0, points: [], scale: 0, killed: false };
}

/** `MOV word ptr [EDI + 0x60], 0x4C` at `0x00426AB3` -- `boss6.bin`. */
export const CLASS2D_CHAR_TYPE = 0x4c;
/** The four kinds' character types, and kind 0's wing. */
export const CLASS2D_CHILD_CHAR_TYPES: readonly number[] = [0x4d, 0x4f, 0x50, 0x51];
export const CLASS2D_WING_CHAR_TYPE = 0x4e;
/** The kinds' first clips: `0x40C`, `0x33`, `0x3B`, `0x79`; the wing's `0xF`. */
export const CLASS2D_CHILD_CLIPS: readonly number[] = [0x40c, 0x33, 0x3b, 0x79];
export const CLASS2D_WING_CLIP = 0xf;

/**
 * Every clip the boss's routines name -- all of `boss6.bin`'s bank, 0x95 to
 * 0xB0 -- for the exporter to bake. The states measure their exits on these
 * clips' play clocks, so a clip the bundle lacks is a state that never ends.
 */
export const CLASS2D_CLIPS: readonly number[] =
  Array.from({ length: 0xb0 - 0x95 + 1 }, (_, i) => 0x95 + i);

/** `[port-only]` -- `n` slots from `a`. */
const run = (a: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => a + i);

/**
 * Every slot an `AssetDrawSlot` of the class can name, for the exporter's
 * `slots_effect` rig -- the class draws each one itself, under its own matrix
 * (`class2D/draw.ts`), so each has to be a template `render/` can clone:
 *
 * * `boss6.bin`: the trail `0x72B`, the satellite `0x72C`, the pair beam's
 *   `0x72D + n` (n to 0x28), the pair `0x754`, the glow `0x755 + n` (n to
 *   0x3B), the core `0x791` and its thirty cels, and every node, part and
 *   shell `0x7B2..0x7E6` (`Class2DNodeDrawHook`, `DrawCharacterPartSlot`'s
 *   pair table at `0x004EDA50`);
 * * the children's nodes, `b6boss1z` .. `b6boss4` `0xCE..0x114`
 *   (`Class2DChildNodeDrawHook`, `Class2DChildKind2NodeDrawHook`);
 * * `eff_boss3.bin` `0x199C..0x19BC`: the flares, the warning, the hidden
 *   child and the satellites' appearance;
 * * `eff_2.bin`: the beam `0x1633 + n % 24`, the intro flipbook `0x161B + n /
 *   2` (n to 0x20), the satellites' sparks `0x17B0..0x17B4`, kind 2's flash
 *   `0x97A + n % 39`;
 * * `eff_boss6.bin`: the hit spark `0x276 + n` (n to 0x18) and the death
 *   burst's `0x16B6`, `0xB00`, `0x18C4`, `0x18C5`; `st6_01.bin`'s strip
 *   `0x190D + n` for the burst's n `0x1A..0x60`.
 */
export const CLASS2D_EFFECT_SLOTS: readonly number[] = [...new Set([
  ...run(0x72b, 0x755 - 0x72b + 1), ...run(0x755, 0x3c), 0x791,
  ...run(0x792, 0x1e), ...run(0x7b2, 0x7e6 - 0x7b2 + 1),
  ...run(0xce, 0x114 - 0xce + 1), ...run(0x199c, 0x19bc - 0x199c + 1),
  ...run(0x1633, 0x18), ...run(0x161b, 0x11), ...run(0x17b0, 5),
  ...run(0x97a, 0x27), ...run(0x276, 0x19), 0x16b6, 0xb00, 0x18c4, 0x18c5,
  ...run(0x190d + 0x1a, 0x60 - 0x1a + 1),
])];

/**
 * `[port-only]` -- the spawn address of an object the class allocates: bit
 * 24, which no evt offset and no other synthetic address sets, the object in
 * bits 20..23 (satellites 0..7, kinds 8..11, the wing 12) and the boss's own
 * address in the low twenty. The exporter writes the kinds' and the wing's
 * rows at these addresses (`hod2lib/characters.ts`), so each names the other.
 */
export const CLASS2D_CHILD_AT_BIT = 0x01000000;
/** `[port-only]` -- see {@link CLASS2D_CHILD_AT_BIT}. */
export function Class2DChildAt(bossAt: number, code: number): number {
  return (CLASS2D_CHILD_AT_BIT | ((code & 0xf) << 20) | (bossAt & 0xfffff))
    >>> 0;
}
/** The codes {@link Class2DChildAt} takes. */
export const CLASS2D_AT_SATELLITE0 = 0;
export const CLASS2D_AT_KIND0 = 8;
export const CLASS2D_AT_WING = 12;
