/**
 * Class 0x45's state -- the stage-3 boss, "the Tower" -- where the engine
 * keeps it.
 *
 * Three places, and each is the engine's:
 *
 * * **The actor's own words.** `obj+0x00` (which routine runs), `obj+0x130C`
 *   (the sub-type), `obj+0x131B` (the index), the `obj+0x1330..+0x1344` block
 *   every sub-type reuses differently, and the skinned model's latches at
 *   `obj+0x194`. These are {@link Boss3Tail}, the class's arm of the `Actor`
 *   union.
 * * **The 0x77C4-byte state block** the heads and the body allocate
 *   (`ActorAllocSub(0x77C4)`, zeroed) and hang off `obj+0x1390`:
 *   {@link Boss3Block}. The civilians have none.
 * * **The class's globals**, `0x007DC6F0..0x007DC80F` and `0x00811200`, which
 *   are `G`'s -- see `game/globals.ts`.
 *
 * Every field carries the offset it lives at, so this can be read next to
 * Ghidra and `docs/re/boss-tower.md`. A block is plain data: `World.save()`
 * puts every actor through `clonePlain`.
 */
import { vec3, type Vec3 } from "../vec";

/**
 * `desc+0x25` -- `obj+0x130C` -- the sub-type, and `Boss3ClassHandler`
 * (`FUN_0041FC00`)'s dispatch through the table at `0x0041FD8C`.
 */
export enum Boss3Subtype {
  /** `Boss3OpeningHeadInit` (`FUN_0041FDB0`) -- the head that takes the first civilian. */
  OpeningHead = 0,
  /** `Boss3OpeningBystanderInit` (`FUN_004200F0`) -- that civilian. */
  OpeningBystander = 1,
  /** `Boss3FightHeadInit` (`FUN_0041FE30`) -- one of the five fighting heads. */
  FightHead = 2,
  /** `Boss3HeldBystanderInit` (`FUN_00420180`) -- a civilian in a head's mouth. */
  HeldBystander = 3,
  /** `NoOpStub` (`FUN_0041EBB0`) -- nothing, and no shipped spawn. */
  Nothing = 4,
  /** `Boss3BodyInit` (`FUN_00420360`) -- the body in the canal. */
  Body = 5,
}

/**
 * `obj+0x00` -- the routine the task walker calls. The engine stores a
 * function pointer and replaces it twice: the class handler installs the
 * sub-type's init, and the init installs its update. The port stores which.
 */
export enum Boss3Routine {
  /** `Boss3ClassHandler` (`FUN_0041FC00`). */
  ClassHandler = 0,
  /** `Boss3OpeningHeadInit` (`FUN_0041FDB0`). */
  OpeningHeadInit,
  /** `Boss3OpeningHeadUpdate` (`FUN_00423050`). */
  OpeningHeadUpdate,
  /** `Boss3OpeningBystanderInit` (`FUN_004200F0`). */
  OpeningBystanderInit,
  /** `Boss3OpeningBystanderUpdate` (`FUN_00420550`). */
  OpeningBystanderUpdate,
  /** `Boss3FightHeadInit` (`FUN_0041FE30`). */
  FightHeadInit,
  /** `Boss3FightHeadUpdate` (`FUN_004209B0`). */
  FightHeadUpdate,
  /** `Boss3HeldBystanderInit` (`FUN_00420180`). */
  HeldBystanderInit,
  /** `Boss3HeldBystanderUpdate` (`FUN_00420820`). */
  HeldBystanderUpdate,
  /** `NoOpStub` (`FUN_0041EBB0`) -- sub-type 4, which returns and stays. */
  NoOpStub,
  /** `Boss3BodyInit` (`FUN_00420360`). */
  BodyInit,
  /** `Boss3BodyUpdate` (`FUN_004231C0`). */
  BodyUpdate,
}

/**
 * `g_boss3_variant` -- which of the three fights this is. `Boss3ClassHandler`
 * picks it from `g_evt_block_index`.
 */
export enum Boss3Variant {
  /** Stage 3 block 11, or its Boss-Mode replay 15. */
  Stage3A = 0,
  /** Stage 3 block 13, or its Boss-Mode replay 17. */
  Stage3B = 1,
  /** Stage 6 block 2 -- the heads alone, all five killable. */
  Stage6 = 2,
}

/**
 * `g_boss3_phase` -- the head fight, dispatched by `Boss3FightHeadUpdate`
 * (`FUN_004209B0`) through the table at `0x004218EC`.
 */
export enum Boss3Phase {
  /** `0x00420EA2` -- the intro: grabs, the card, waiting on the flags. */
  Intro = 0,
  /** `0x00421033` -- the fight. */
  Fight = 1,
  /** `0x004215D6` -- every head is down; idx 2 counts 180 to the gate. */
  AllDown = 2,
  /** `0x00421704` -- despawning. */
  Despawn = 3,
}

/**
 * A fighting head's `obj+0x1310`. States 4..7 are the fight's, dispatched
 * through `0x004218FC`; 0, 2 and 3 are `Boss3FightHeadIntroGrab`'s (heads 0
 * and 4 outside Boss Mode), and every other head sits in 0 until the fight.
 */
export enum Boss3HeadState {
  /** Waiting: the intro, before the fight starts. */
  Waiting = 0,
  /** `Boss3FightHeadIntroGrab` -- the civilian has been let go. */
  Released = 2,
  /** `Boss3FightHeadIntroGrab` -- idling until `g_script_flags[2]`. */
  Settled = 3,
  /** `0x0042104C` -- idle, and the attack is chosen here. */
  Idle = 4,
  /** `0x004211B6` -- the bite. */
  Attack = 5,
  /** `0x00421334` -- the flinch. */
  Flinch = 6,
  /** `0x004213C4` -- dead. */
  Dead = 7,
}

/**
 * A civilian's `obj+0x1310`. The opening civilian runs all four in its own
 * update (`Boss3OpeningBystanderUpdate`, table `0x004207B8`); a held one is
 * moved between them by the head holding it (`Boss3FightHeadIntroGrab`).
 */
export enum Boss3BystanderState {
  /** Standing; the opening one waits on `g_script_flags[3]`. */
  Standing = 0,
  /** Walking (opening), or taken by the head's grab clip (held). */
  Moving = 1,
  /** Stopped (opening), or let go and falling (held). */
  Released = 2,
  /** Carried off by the opening head. */
  Carried = 3,
}

/**
 * The body's `obj+0x1310`, dispatched by `Boss3BodyUpdate` (`FUN_004231C0`)
 * through `0x00424170` as `state - 8`.
 */
export enum Boss3BodyState {
  /** `0x0042349E` -- one path segment a frame into the block. */
  BuildPath = 8,
  /** `0x0042351E` -- raise `g_camera_driver_held`. */
  TakeCamera = 9,
  /** `0x00423536` -- swim the canal along the path. */
  Swim = 10,
  /** `0x0042385E` -- surfaced, and shootable. */
  Surfaced = 11,
  /** `0x00423A97` -- the lunge. */
  Lunge = 12,
  /** `0x00423C9A` -- a recovery no instruction ever enters. */
  Recover = 13,
  /** `0x00423D09` -- dead. */
  Dead = 14,
}

/** Which idle table `+0x7634` points at. */
export enum Boss3IdleTable {
  /** `g_boss3_idle_motions_a`. */
  A = 0,
  /** `g_boss3_idle_motions_b`. */
  B = 1,
  /** `g_boss3l_idle_motions`. */
  Large = 2,
}

/** Which attack table `+0x7628` points at. */
export enum Boss3AttackTable {
  /** `g_boss3_attacks_a`. */
  A = 0,
  /** `g_boss3_attacks_b`. */
  B = 1,
  /** `g_boss3l_attacks`. */
  Large = 2,
}

/** Which set of body path, camera and event tables `+0x77B8..+0x77C0` hold. */
export enum Boss3BodyTables {
  /** `_a`: variant 0, last segment 7. */
  A = 0,
  /** `_b`: variants 1 and 2, last segment 8. */
  B = 1,
}

/** The skinned model's per-node draw hook, `model+0x1158` (`obj+0x12EC`). */
export enum Boss3PoseHook {
  /** `PoseHookNone` (`FUN_00420810`) -- a bare `RET`. */
  None = 0,
  /** `Boss3BystanderPoseHook` (`FUN_004208F0`) -- the civilians'. */
  Bystander = 1,
  /**
   * `SkeletonDrawNodeSlot` (`FUN_00411050`), which `ActorBuildSkinnedModel`
   * (`FUN_00410440`) installs at `0x00410522`: `NoOpStub(model+0x116C);
   * AssetDrawSlot(node's slot)`. The opening head keeps it.
   */
  Default = 2,
}

/** Bones in the larger skeleton, and so in every per-bone array here. */
export const BOSS3_MAX_BONES = 27;
/**
 * Path points the block has room for -- `(0x7628 - 0x5A8) / 0xC`. The
 * shipped tables use 2313 and 2349.
 */
export const BOSS3_MAX_PATH_POINTS = (0x7628 - 0x5a8) / 0xc;

/**
 * The 0x77C4-byte block at `obj+0x1390`, as `Boss3FightHeadInit` and
 * `Boss3BodyInit` allocate it: `ActorAllocSub(0x77C4)` and `REP STOSD` of
 * `0x1DF1` dwords, so every field starts at zero.
 *
 * `+0x144..+0x2F3` and `+0x7728` (27 dwords `Boss3BodyInit` zeroes) are read
 * by no instruction of the class and are not carried.
 */
export interface Boss3Block {
  /** `+0x000`, `+0x06C`, `+0x0D8` -- the extra rotation per bone, BAMS s32. */
  extraX: number[];
  extraY: number[];
  extraZ: number[];
  /**
   * `+0x2F4`, `+0x3CC` -- the chain's yaw anchors per bone, x and z. The y
   * between them at `+0x360` is written from a frame slot nothing
   * initialises before bone 1 reads it, and read by no instruction; it is not
   * carried.
   */
  anchorX: number[];
  anchorZ: number[];
  /** `+0x438`, `+0x4A4`, `+0x510` -- the chain's pitch anchors per bone. */
  anchor2X: number[];
  anchor2Y: number[];
  anchor2Z: number[];
  /** `+0x597` -- bones posed (20 or 27). */
  boneCount: number;
  /** `+0x598` -- the weak bone. */
  weakBone: number;
  /** `+0x599`, `+0x59A` -- the two jaw bones. */
  jawA: number;
  jawB: number;
  /** `+0x59B` -- idles in the idle table. */
  idleCount: number;
  /** `+0x59C` -- attacks in the attack table. */
  attackCount: number;
  /** `+0x59D` -- which idle set, 0 (A) or 1 (B). */
  idleSet: number;
  /** `+0x59E` -- the body's surfacing, 0..6. */
  eventIndex: number;
  /** `+0x59F` -- the body's hits this surfacing. */
  hits: number;
  /** `+0x5A0` -- the dive splash's latch. */
  splashLatch: number;
  /** `+0x5A1` -- the body's last path segment, 7 or 8. */
  lastSegment: number;
  /** `+0x5A4` -- the neck's summed Z rotation at the weak bone, s32. */
  neckSum: number;
  /** `+0x5A8` -- the body's path points, `x, y, z` per point. */
  points: number[];
  /** `+0x7628` -- the attack table. */
  attackTable: Boss3AttackTable;
  /** `+0x762C` -- the path cursor, s16. */
  pathCursor: number;
  /** `+0x762E` -- the path cursor at the weak bone (written, not read). */
  pathCursorWeak: number;
  /** `+0x7630` -- the path point count. */
  pathCount: number;
  /** `+0x7634` -- the idle table. */
  idleTable: Boss3IdleTable;
  /** `+0x7638` -- the hurt clip. */
  hurtClip: number;
  /** `+0x763A` -- the death clip. */
  deathClip: number;
  /** `+0x763C` -- the current attack's hit frame. */
  hitFrame: number;
  /** `+0x763E` -- frames before the path cursor may move (always 0). */
  cursorHold: number;
  /** `+0x7640` -- the bite flash's clock, stepped by the draw. */
  flashClock: number;
  /** `+0x7642` -- the camera's freeze countdown. */
  camFreeze: number;
  /** `+0x7644`, `+0x7646` -- the frozen camera segment and frame. */
  frozenSegment: number;
  frozenFrame: number;
  /** `+0x7648` -- head idx 2's intro clock. */
  introClock: number;
  /** `+0x764A` -- attack armed: -1 no, 0 yes. */
  armed: number;
  /** `+0x764C` -- laps of the path. */
  laps: number;
  /** `+0x7650` -- the chain's pitch per bone. */
  pitch: number[];
  /** `+0x76BC` -- the chain's yaw per bone; entry 1 the camera-facing yaw. */
  yaw: number[];
  /** `+0x7794`, `+0x779C` -- where the lunge started. */
  lungeX: number;
  lungeZ: number;
  /** `+0x77AC`, `+0x77B0` -- the death bob's phase and rate. */
  bobPhase: number;
  bobRate: number;
  /** `+0x77B4` -- the variant-2 big head's jaw sway. */
  jawSway: number;
  /** `+0x77B8`, `+0x77BC`, `+0x77C0` -- the body's three tables. */
  bodyTables: Boss3BodyTables;
}

const zeros = (): number[] => new Array<number>(BOSS3_MAX_BONES).fill(0);

/** `ActorAllocSub(0x77C4)` and the zeroing after it. `[port-only]` as a function. */
export function Boss3BlockNew(): Boss3Block {
  return {
    extraX: zeros(), extraY: zeros(), extraZ: zeros(),
    anchorX: zeros(), anchorZ: zeros(),
    anchor2X: zeros(), anchor2Y: zeros(), anchor2Z: zeros(),
    boneCount: 0, weakBone: 0, jawA: 0, jawB: 0, idleCount: 0,
    attackCount: 0, idleSet: 0, eventIndex: 0, hits: 0, splashLatch: 0,
    lastSegment: 0, neckSum: 0, points: [],
    attackTable: Boss3AttackTable.A, pathCursor: 0, pathCursorWeak: 0,
    pathCount: 0, idleTable: Boss3IdleTable.A, hurtClip: 0, deathClip: 0,
    hitFrame: 0, cursorHold: 0, flashClock: 0, camFreeze: 0,
    frozenSegment: 0, frozenFrame: 0, introClock: 0, armed: 0, laps: 0,
    pitch: zeros(), yaw: zeros(), lungeX: 0, lungeZ: 0, bobPhase: 0,
    bobRate: 0, jawSway: 0, bodyTables: Boss3BodyTables.A,
  };
}

/**
 * Class 0x45's arm of the `Actor` union: the words every sub-type shares, at
 * their offsets, and the skinned model's latches.
 */
export interface Boss3Tail {
  /** `obj+0x00` -- the routine the walker calls. */
  routine: Boss3Routine;
  /** `obj+0x130C` -- `desc+0x25`, the sub-type. */
  subtype: number;
  /** `obj+0x131B` -- the head (0..4), civilian (0..1) or body (8) index. */
  index: number;
  /** `obj+0x1330` -- s32: a timer, the card latch, the body's camera segment. */
  counter: number;
  /** `obj+0x1334` -- s32: the body's path-point count, then its camera frame. */
  camFrame: number;
  /** `obj+0x1338` -- s32: the body's camera frame count (written, not read). */
  camFrames: number;
  /** `obj+0x133C` -- s32, zeroed at the body's death, not read. */
  unread133C: number;
  /** `obj+0x1340` -- f32: 15.0 offset, flinch counter, lunge fraction. */
  blend: number;
  /** `obj+0x1344` -- f32: the dead body's bob amplitude. */
  bob: number;
  /** `obj+0x121` -- s8: the player a head's bite is aimed at. */
  bitePlayer: number;
  /** `obj+0x12F4..+0x12FC` -- the root translation at the last even cursor. */
  prevRoot: Vec3;
  /** `model+0x1158` (`obj+0x12EC`) -- the per-node draw hook. */
  poseHook: Boss3PoseHook;
  // -- the skinned model's words, `obj+0x194` onward. The class reads the
  //    play cursor and the clip-ended byte as the last draw left them and
  //    steps the frame counter itself, so the port keeps these as the engine
  //    does rather than deriving them afresh -- see `class45/model.ts`.
  /** `model[0]` (`obj+0x194`) -- the frame counter the class steps. */
  modelFrame: number;
  /** `model[2]` (`obj+0x19C`) -- the play cursor, as the sampler left it. */
  cursor: number;
  /** `model[4]` (`obj+0x1A4`) -- the authored frame the last root delta was at. */
  prevAuthored: number;
  /** `model[6]` (`obj+0x1AC`) -- the authored frame, `cursor / 2`. */
  authored: number;
  /** `model[10]` (`obj+0x1BC`) -- the counter a blend is measured from, less one. */
  fadeBase: number;
  /** `model+0x30` (`obj+0x1C4`), a char -- the blend's length plus one. */
  fadeLen: number;
  /** `model+0x37` (`obj+0x1CB`) -- bit 0 a cross-fade, bit 5 a half frame. */
  trackBits: number;
  /** `model+0x5D` (`obj+0x1F1`) -- the cursor had reached the play length. */
  clipEnded: number;
  /** `model+0x44`, `+0x50` -- pose slots A and B's root translations. */
  rootA: Vec3;
  rootB: Vec3;
  /** `model+0x6C` -- the root translation the last draw posed. */
  rootNow: Vec3;
  /** `model+0x1160` -- `SkeletonApplyRootMotion`'s baseline. */
  rootBase: Vec3;
  /**
   * Bone records `+0x10..+0x18` and `+0x1C..+0x24`, three BAMS per bone:
   * pose slots A (the outgoing pose, or a frame) and B (the incoming).
   */
  slotA: number[];
  slotB: number[];
  /**
   * The bone records' rotations, `obj+0x20C + bone*0x90 + 0x04/0x08/0x0C`,
   * three BAMS per bone: what the sampler posed, and for the body's chain
   * what `Boss3ComposeBonePose` wrote over it.
   */
  boneRot: number[];
  /**
   * `[port-only]` -- the translation the last pose put at bone 0 (the root's
   * height for the plain draw, the whole root for a composed head, none for
   * the body), and whether that pose was `Boss3ComposeBonePose`'s. What
   * `render/` needs to draw the matrices the engine stored.
   */
  pivot: Vec3;
  composed: boolean;
  /**
   * The bone records' matrices' origins (`+0x28`, translation) and hit-sphere
   * centres (`+0x68`), three floats per bone. The engine keeps both in view
   * space and every reader takes them back to world through
   * `g_camera_blocks`; the port composes them in world space and saves the
   * round trip, which is the same point.
   */
  boneOrigin: number[];
  bonePoint: number[];
  /**
   * `[port-only]` -- what this frame's update drew, for `render/`: the
   * skeleton at all (`drawn`); the bite flash, as the clock value its cels
   * were chosen by (`flash`, -1 for none); the wake, as a mask of the bones
   * that drew it and the `g_frame_counter` its cel was chosen by; and the
   * opening civilian's shadow disc. The engine draws these inside the update
   * and keeps nothing; the port's renderer runs after it and needs to be told.
   */
  drawn: boolean;
  flash: number;
  wakeBones: number;
  wakeCel: number;
  shadow: boolean;
  /** `obj+0x1390` -- the state block, heads and body only. */
  block: Boss3Block | null;
}

/** A fresh arm, as the allocation leaves it. `[port-only]`. */
export function makeBoss3Tail(): Boss3Tail {
  return {
    routine: Boss3Routine.ClassHandler, subtype: 0, index: 0, counter: 0,
    camFrame: 0, camFrames: 0, unread133C: 0, blend: 0, bob: 0,
    bitePlayer: -1, prevRoot: vec3(), poseHook: Boss3PoseHook.None,
    modelFrame: 0, cursor: 0, prevAuthored: 0, authored: 0, fadeBase: 0,
    fadeLen: 0, trackBits: 0, clipEnded: 0,
    rootA: vec3(), rootB: vec3(), rootNow: vec3(), rootBase: vec3(),
    slotA: new Array<number>(BOSS3_MAX_BONES * 3).fill(0),
    slotB: new Array<number>(BOSS3_MAX_BONES * 3).fill(0),
    boneRot: new Array<number>(BOSS3_MAX_BONES * 3).fill(0),
    pivot: vec3(), composed: false,
    boneOrigin: new Array<number>(BOSS3_MAX_BONES * 3).fill(0),
    bonePoint: new Array<number>(BOSS3_MAX_BONES * 3).fill(0),
    drawn: false, flash: -1, wakeBones: 0,
    wakeCel: 0, shadow: false, block: null,
  };
}

/** One of `g_boss3_card_pieces`' eight `{x, y, z, s32 yaw, scale}` records. */
export interface Boss3CardPiece {
  x: number; y: number; z: number; yaw: number; scale: number;
}

/**
 * `Boss3IntroCardUpdate`'s task: step at `+0x1310`, frame at `+0x1320`.
 * `drawn` is `[port-only]`: whether this frame's step drew the pieces, which
 * the engine does inside the step.
 */
export interface Boss3IntroCard { step: number; frame: number; drawn: boolean }

/**
 * `Boss3SparkUpdate`'s task: the actor `+0x34`, bone `+0x46`, cel `+0x44`.
 * `shown` is the cel this frame drew and `done` the kill it then made --
 * `[port-only]`, because the engine draws and steps in one call and the
 * port's draw comes after the step.
 */
export interface Boss3Spark {
  at: number; bone: number; cel: number; shown: number; done: boolean;
}

/** `Boss3SplashUpdate`'s task: world point `+0x38`, kind `+0x44`, slot `+0x4C`. */
export interface Boss3Splash {
  x: number; y: number; z: number; kind: number; slot: number;
  shown: number; done: boolean;
}

/**
 * `Boss3MeshBulgeUpdate`'s task: `+0x34` the step, `+0x38` the latch. The
 * ten piece positions at `+0x54` are constants (`BOSS3_BULGE_PIECE_XZ`).
 * `deformed` and `at*` are `[port-only]`: whether this frame's update walked
 * the water patch's vertices, and the body's `obj+0x100` it measured from --
 * the engine edits the model in place, and the port's model is `render/`'s.
 */
export interface Boss3MeshBulge {
  step: number; stopped: number;
  deformed: boolean; atX: number; atY: number; atZ: number;
}

/**
 * `Boss3PathEffectUpdate`'s task: `+0x1330` the step, `+0x1334` the row of
 * `g_boss3_path_effects`, `+0x1338` the cel. `shown`, `shownRow`,
 * `shownAlpha` and `shownYaw` (the camera block's yaw it was turned by) are
 * what this frame drew (`shown` -1 for nothing).
 */
export interface Boss3PathEffect {
  step: number; row: number; cel: number;
  shown: number; shownRow: number; shownAlpha: number; shownYaw: number;
}
