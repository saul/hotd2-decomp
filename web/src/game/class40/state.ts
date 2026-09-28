/**
 * Class 0x40's objects, apart from the class module so `actor.ts` can name
 * them without importing the class.
 *
 * `PlaceHorde` (`FUN_0043BD30`) is a **placer**: every path through it ends in
 * `ActorKill`. What it leaves behind is one of two things, chosen by the
 * opcode-0x09 descriptor's `+0x25` (`obj+0x130C`, {@link HordeSelector}):
 *
 * * a **horde** of up to ten `0x13F4`-byte members running `HordeMemberInit`
 *   (`FUN_0043BEF0`) and then `HordeMemberUpdate` (`FUN_0043C440`), each with
 *   a `0x504`-byte side block at `obj+0x1390`; or
 * * one **emerge prop**, a `0x1F8`-byte object running
 *   `HordeEmergePropUpdate` (`FUN_0043DD00`) — the thing the horde pushes out
 *   of the way when it comes up.
 *
 * The engine tells all of these apart by which routine `ActorAlloc` was given;
 * the port has one handler per class id, so the discriminator is a field
 * ({@link HordeKind}). The member's corpse and its death splash are the same
 * arrangement one level down; the prop's hit spark rides the sprite-effect
 * pool.
 *
 * ## The member
 *
 * Character type `0x1D`, `mol.bin`: nine nodes, a chain of six ring segments
 * 1.3 apart down +z with a two-bone jaw (bones 8 and 9) hung off the head.
 * `[likely]` a worm — the model is a limbless segmented body tapering to a
 * spike, with a toothed mouth that `SubModelPoseBoneHalfRate` (`FUN_0040ED30`)
 * opens during the dive; no name table says so, and `mol` is only the file's
 * name. It is drawn by the **sub-model**, a lightweight skeleton that lives in
 * the side block rather than at `obj+0x194` — see `submodel.ts`.
 */
import type { SubModel } from "./submodel";
import { makeSubModel } from "./submodel";

/**
 * `obj+0x130C` — the placer's selector, the opcode-0x09 descriptor's `+0x25`.
 *
 * Seven descriptors, nine spawn instructions: five carry 1 and four carry 2.
 * Nothing ships a 0.
 */
export enum HordeSelector {
  /** One member. No shipped descriptor. */
  Single = 0,
  /** A horde of 4..10 members, by block and by the number of players. */
  Horde = 1,
  /** Not a horde at all: `SpawnHordeEmergeProp` (`FUN_0043DC30`). */
  EmergeProp = 2,
}

/**
 * `[port-only]` — which routine this class-0x40 object runs.
 *
 * The engine's answer is the function pointer at `obj+0x00`, and each value
 * here names the routine that would be there. None of them is a state: the
 * kill writes {@link HordeState.Dead} **and** installs the corpse's routine,
 * and the two are separate words in the engine too.
 */
export enum HordeKind {
  /** `PlaceHorde` (`FUN_0043BD30`) — the descriptor's own object. */
  Placer = 0,
  /**
   * `HordeMemberInit` (`FUN_0043BEF0`). A member's first frame is its Init,
   * exactly as the engine's is: `ActorAlloc` installs the Init as the
   * routine, and the Init installs the update as its last act.
   */
  MemberInit = 1,
  /** `HordeMemberUpdate` (`FUN_0043C440`). */
  Member = 2,
  /** `HordeCorpseSinkUpdate` (`FUN_0043DA20`), installed by the kill. */
  Corpse = 3,
  /** `HordeEmergePropUpdate` (`FUN_0043DD00`). */
  EmergeProp = 4,
  /** `HordeDeathSplashUpdate` (`FUN_0043E540`). */
  Splash = 5,
  /** `HordeDeathRippleFade` (`FUN_0043E650`), which the splash hands to. */
  Ripple = 6,
  /** `HordeDeformedPropAwaitModel` (`FUN_0043EFE0`) -- stage 2's sheet, waiting. */
  SheetAwait = 7,
  /** `HordeDeformedPropUpdate` (`FUN_0043F010`) -- the sheet. */
  Sheet = 8,
}

/**
 * `obj+0x1310` — the member's state, a `short` `HordeMemberUpdate` switches on
 * through the jump table at `0x0043D4B8` (six entries; 6 is written but never
 * dispatched, because the kill installs `HordeCorpseSinkUpdate` in the same
 * breath).
 */
export enum HordeState {
  /** Wait out `obj+0x1334` — `idx * 20` frames — out of the shot test. */
  Hold = 0,
  /** Walk the six segments of `g_horde_formation` into the room. */
  Enter = 1,
  /** Turn toward the eye at `side+0x44` BAMS a frame, circling 0.1 a frame. */
  WindUp = 2,
  /** Leap at the camera, and bite. */
  Dive = 3,
  /** Fall back from the bite to the ground. */
  PullOut = 4,
  /** Wander the formation's grid, and wait for the dive turn. */
  Wander = 5,
  /** Shot. `HordeCorpseSinkUpdate` (`FUN_0043DA20`) runs from here. */
  Dead = 6,
}

/**
 * `side+0x68` — the formation, and with it the spline, the wander grid and
 * the spline rate. `HordeMemberInit` picks it from the block the horde is
 * placed in, so it is a fact about the level rather than the descriptor.
 */
export enum HordeFormation {
  /** Stage 1 block 3. */
  Stage1Block3 = 0,
  /** Stage 1 block 8. Second skin row. */
  Stage1Block8 = 1,
  /**
   * Stage 2 block 0x19. Second skin row, scale 0.55, and its own rules
   * everywhere: members 3+ drop from `y = 41.4`, it counts nobody in until
   * `g_script_flags[94]` rises, and member 0 lays the deformed prop.
   */
  Stage2Block25 = 2,
  /** Stage 2 block 0x0E. */
  Stage2Block14 = 3,
  /** Stage 2 block 0x12. */
  Stage2Block18 = 4,
}

/**
 * The class's own bits of `obj+0x34`, where they differ from what class 0x30
 * means by the same bit (`L3`).
 */
export enum HordeFlag {
  /**
   * `0x8000` — `RegisterForShotTest` (`FUN_00405160`) skips the object. Set
   * through the whole of {@link HordeState.Hold} and cleared on the way out.
   */
  OutOfShotTest = 0x8000,
  /** `0x10000` — `RegisterForCameraTracking` skips it (a corpse, mostly). */
  NoCameraTrack = 0x10000,
  /**
   * `0x1000000` — raised around the **second** `SubModelDraw` in stage 1
   * block 3, the reflection, and lowered after it.
   */
  Reflected = 0x1000000,
  /**
   * `0x8000000` — the member has been down once. Formation 2's members 3+
   * carry it from birth; everyone else takes it on the first bite. It is what
   * lets a formation-2 member draw once it is back on the ground.
   */
  Landed = 0x8000000,
  /**
   * `0x10000000` — the dive. Raised entering {@link HordeState.Dive} and
   * lowered when the pull-out lands. `SubModelPoseBoneHalfRate` reads it for
   * type `0x1D` and opens the jaw.
   */
  Diving = 0x10000000,
}

/**
 * The emerge prop's five states, `obj+0x1DC`, switched on in
 * `HordeEmergePropUpdate` (`FUN_0043DD00`) through the table at `0x0043E340`.
 */
export enum EmergePropState {
  /** Flat, waiting for `g_horde_emerged`. */
  Wait = 0,
  /** Pushed up: pitching to vertical and sliding. */
  Lift = 1,
  /** Shot: falling and tumbling. */
  Fall = 2,
  /** Down on one corner, rocking flat. */
  Settle = 3,
  /** At rest, and shootable. */
  Rest = 4,
}

/**
 * One class-0x40 object. Every kind's fields in one flat record, because the
 * engine's are one flat allocation: `ActorClearGameFields` and `ActorAllocSub`
 * zero them all, and each routine reads the words it owns.
 */
export interface HordeTail {
  /** `[port-only]` — see {@link HordeKind}. */
  kind: HordeKind;

  // -- the member: its obj+0x13xx words ---------------------------------
  /** `obj+0x1310`. */
  state: HordeState;
  /** `obj+0x131B`, s8 — the member index, and its `g_horde_members` slot. */
  idx: number;
  /** `obj+0x130C` — the placer's selector, copied down. */
  selector: HordeSelector;
  /**
   * `obj+0x1330` — frames in the current state. The **placer** writes the
   * member count here; `HordeMemberInit` copies it to `side+0x6C` and zeroes
   * it, and every state that counts starts from 0.
   */
  counter: number;
  /** `obj+0x1334` — the hold, `idx * 20` frames. */
  hold: number;
  /** `obj+0x1338` — 0 in everything shipped; would fade the bone draws. */
  fadeBones: number;
  /** `obj+0x1344` — the dive's parameter, and the jaw's. */
  diveT: number;
  /** `obj+0x1348` — its rate, 0.027 decaying 0.0005 a frame. */
  diveRate: number;
  /** `obj+0x134C` — the sub-model's scale: 0.75, or 0.55 in formation 2. */
  scale: number;
  /** `obj+0x1350` — the `g_submodel_bone_slots` row: which skin. */
  skinRow: number;
  /** `obj+0x1354` — wander frames since the last neighbour was avoided. */
  avoidClock: number;
  /** `obj+0x135C` — set by the kill; flattens the corpse. */
  flatten: number;
  /** `obj+0x1360` — a neighbour has already steered this one aside. */
  avoided: number;

  // -- the member: its side block at obj+0x1390 -------------------------
  /** `side+0x00..0x08` — where it was at the end of the last frame. */
  prevX: number; prevY: number; prevZ: number;
  /** `side+0x0C/+0x10` — the placer's x and z: every table is relative. */
  baseX: number; baseZ: number;
  /** `side+0x14` — `(idx + 1) * 0.3`. Nothing this class runs reads it. */
  spacing: number;
  /** `side+0x18..0x20` — where the dive started. */
  diveFromX: number; diveFromY: number; diveFromZ: number;
  /** `side+0x24` — the pull-out's pitch rate, BAMS, times 1.01 a frame. */
  pullPitchRate: number;
  /** `side+0x2C/+0x2D`, s8 — the wander grid cell. */
  cellX: number; cellZ: number;
  /** `side+0x30/+0x34` — the point it wanders toward. */
  wanderX: number; wanderZ: number;
  /** `side+0x38/+0x3C` — the dive's offset from the eye. Always 0. */
  aimX: number; aimZ: number;
  /** `side+0x40` — the heading the last update computed, BAMS. */
  heading: number;
  /** `side+0x44` — the wind-up's turn, `+-0x222` BAMS a frame. */
  windRate: number;
  /** `side+0x48` — wind-up frames so far (a float, `+= 1.0`). */
  windCount: number;
  /** `side+0x4C` — how many it needs: the angle to the eye over `0x222`. */
  windLimit: number;
  /**
   * `side+0x50` — the wander speed, 1.0 or **2.0**. 2.0 is written by the
   * pull-out and doubles as a flag: while it holds, a neighbour only steers.
   */
  speed: number;
  /** `side+0x58` — which of the six spline segments. */
  segment: number;
  /** `side+0x5C` — that segment's parameter. */
  segT: number;
  /** `side+0x60` — its rate per frame. */
  segRate: number;
  /** `side+0x68` — see {@link HordeFormation}. */
  formation: HordeFormation;
  /** `side+0x6C` — how many the placer made; the dive turn wraps on it. */
  count: number;
  /** `side+0x70` — the sub-model. */
  sub: SubModel;

  // -- the emerge prop: its 0x1F8-byte object ---------------------------
  /** `+0x194..0x19C` — its position. `obj+0x40` is not used. */
  propX: number; propY: number; propZ: number;
  /** `+0x1A0..0x1A8` — the ground point it pivots on in `Settle`. */
  pivotX: number; pivotY: number; pivotZ: number;
  /** `+0x1AC`, `+0x1B0`, `+0x1B4` — pitch, yaw and roll, BAMS. */
  propPitch: number; propYaw: number; propRoll: number;
  /** `+0x1B8`, `+0x1C0` — pitch and roll rates. */
  pitchRate: number; rollRate: number;
  /** `+0x1C4`, `+0x1CC` — what is added to those every frame. */
  pitchAccel: number; rollAccel: number;
  /** `+0x1D4` — the fall's vertical speed. */
  fallVy: number;
  /** `+0x1D8` — the lift's speed along z. */
  liftVz: number;
  /** `+0x1DC` — see {@link EmergePropState}. */
  propState: EmergePropState;
  /** `+0x1E0` — the `g_evt_step_index` it last saw. */
  seenStep: number;
  /** `+0x1E4` — how many times that has changed. */
  stepChanges: number;
  /** `+0x1E8` — which rim point it is resting on, -1 for none. */
  rimPoint: number;
  /** `+0x1F0` — settles and bounces counted toward coming to rest. */
  settles: number;
  /** `+0x1F4` — 0 in block 3, 1 elsewhere: its lifetime in step pairs. */
  lifetime: number;

  // -- the splash ---------------------------------------------------------
  /** `obj+0x1330` of the splash: 120 down to 0, then 0 up again. */
  frame: number;
  /** `obj+0x1320` of the fading ripple. */
  fade: number;
  /** `obj+0x1340` of the splash: 1.0, or 0.75 up high in formation 2. */
  size: number;

  // -- [port-only] what this frame's update decided to draw ---------------
  //
  // The engine draws from inside the update; the port's drawing is
  // `render/`'s, so each routine leaves the decisions it made -- whether it
  // drew, and where the second and third draws went -- here for that layer
  // to read. Nothing in `game/` reads them back.
  /**
   * The member's `SubModelDraw` ran this frame -- or, for the sheet, its
   * vertices were reshaped this frame.
   */
  drawn: boolean;
  /** ...and ran a second time, reflected (stage 1 block 3). */
  mirrored: boolean;
  /** The reflection's y and pitch. */
  mirrorY: number;
  mirrorPitch: number;
  /** The ground shadow was drawn, at this y. */
  shadow: boolean;
  shadowY: number;
}

/** [port-only] `ActorClearGameFields` zeroes the object; this is that zero. */
export function makeHordeTail(): HordeTail {
  return {
    kind: HordeKind.Placer,
    state: HordeState.Hold, idx: 0, selector: HordeSelector.Single,
    counter: 0, hold: 0, fadeBones: 0, diveT: 0, diveRate: 0, scale: 0,
    skinRow: 0, avoidClock: 0, flatten: 0, avoided: 0,
    prevX: 0, prevY: 0, prevZ: 0, baseX: 0, baseZ: 0, spacing: 0,
    diveFromX: 0, diveFromY: 0, diveFromZ: 0, pullPitchRate: 0,
    cellX: 0, cellZ: 0, wanderX: 0, wanderZ: 0, aimX: 0, aimZ: 0,
    heading: 0, windRate: 0, windCount: 0, windLimit: 0, speed: 0,
    segment: 0, segT: 0, segRate: 0,
    formation: HordeFormation.Stage1Block3, count: 0,
    sub: makeSubModel(),
    propX: 0, propY: 0, propZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0,
    propPitch: 0, propYaw: 0, propRoll: 0, pitchRate: 0, rollRate: 0,
    pitchAccel: 0, rollAccel: 0, fallVy: 0, liftVz: 0,
    propState: EmergePropState.Wait, seenStep: 0, stepChanges: 0,
    rimPoint: -1, settles: 0, lifetime: 0,
    frame: 0, fade: 0, size: 0,
    drawn: false, mirrored: false, mirrorY: 0, mirrorPitch: 0,
    shadow: false, shadowY: 0,
  };
}

/**
 * Class 0x40's descriptor: the selector, and nothing else is read. The
 * opcode-0x09 allocator copies `desc+0x25` to `obj+0x130C`; `desc+0x24` goes
 * to `obj+0x1F4` (0x1D on four of the five horde descriptors) and `PlaceHorde`
 * never reads it — the member's type is `HordeMemberInit`'s literal.
 */
export interface HordeDescriptor {
  selector: number;
}
