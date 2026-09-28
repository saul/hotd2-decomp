/**
 * Class 0x13 — **a script-driven prop**, and stage 3's arriving boat.
 *
 * The class is one asset slot drawn under a matrix, with a behaviour chosen
 * out of a ten-entry table. 23 spawn instructions across stages 2, 3 and 4
 * reach 15 descriptors: five of them (eight instructions, all stage 2's) take
 * behaviour 0, `NoOpStub`, and are static scenery, and the other ten (fifteen
 * instructions) take behaviour 8, which is an installer rather than a
 * behaviour. This said "the other eighteen", counting descriptors on one side
 * and instructions on the other. `trnevtbl.bin` holds a sixteenth descriptor,
 * on behaviour 9 (`0x00445050`, unread).
 *
 * ```
 * ScriptedPropInit13 (FUN_0043FE10)
 *   sub = ActorAllocSub(0x1C) at obj+0x1310, filled from the descriptor tail
 *   sub->behaviour = g_prop_behaviours[tail+0x10]
 *   sub->behaviour(obj)                      <- called once, here
 *
 * g_prop_behaviours[8] = CarrierPropSelectRoutine (FUN_00440190)
 *   g_civilian_carrier = obj
 *   sub->behaviour = one of seven, by the first dword of the operand block
 * ```
 *
 * Because the Init calls the behaviour immediately, entry 8 runs exactly once
 * and swaps itself out. The port models the installed routine as a value in
 * the tail rather than a function pointer, for the same reason
 * `g_camera_action_driver` does: a snapshot cannot hold a pointer.
 *
 * **Stage 3's boat is selector 1**, `CarrierPropRoutine1`, and it is the one
 * object a class-0x18 zombie and a class-0x10 civilian ride. It rides object
 * paths 350 and 351, both of which the bundle already carries, and forks on
 * `g_civilians_alive` at path frame 0x500: with a civilian alive it pulls up
 * and moors, with none it runs past.
 *
 * ## What is here and what is not
 *
 * The **draw** is not: `ScriptedPropUpdate13` composes
 * `Translate; RotX; RotZ; RotY; Scale` and calls `AssetDrawSlot`, which is
 * `render/slotmodels.ts`'s job, and the port's slot renderer already does that
 * for four other classes. What is here is the state, the motion and the
 * despawn.
 *
 * The **effects** are ported with it: the wake `CarrierDrawGroundWake`
 * (`FUN_00440770`) lays on the ground under the boat from `ride+0x04`, the
 * bow strip `SpawnPropStripEffect` (`FUN_0043FCA0`, kind 3) spawned at path
 * frame 0x550 with `PlaySoundId(0x000B16A9)`, and states 5 and 6's strip.
 * The state and the cursors are here; the draws are `render/slotmodels.ts`',
 * reading the `*Drawn` fields this file sets on the frames the engine draws.
 * They used to be a `[diverges]` for want of their slots in the bundle.
 *
 * `FUN_004459C0`, the on-screen test state 6 uses to decide when to despawn,
 * reads view-space `obj+0x70`/`+0x78` against the shot radius. The port has
 * those through `GameHost.viewSpaceOf`, and where it cannot answer the boat
 * holds state 6 rather than vanishing. [diverges]
 */
import type { Actor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { CarrierPropRoutine0 } from "./routine0";
import { CarrierPropRoutine2 } from "./routine2";
import { QueryGroundHeightAt } from "../coli";
import { CarrierTransformPoint } from "../carrier";
import {
  PropStripKind, SpawnPropStripEffect,
} from "../effects/prop_strip";
import { vec3, VecToAngles } from "../vec";
import {
  CARRIER1_STRIP_FIRST, CARRIER1_STRIP_LAST, CARRIER_GROUND_WAKE_DRAW,
  CARRIER_WAKE_FIRST,
  CARRIER_WAKE_LAST, CarrierState, type ScriptedPropTail,
} from "./state";

/** `ActorAllocSub(0x18)`'s `ride+0x04`, and the range it wraps in. */
const WAKE_CEL_FIRST = CARRIER_WAKE_FIRST;
const WAKE_CEL_LAST = CARRIER_WAKE_LAST;
/** `ride+0x14`, the strip states 5 and 6 draw. */
const STRIP_CEL_FIRST = CARRIER1_STRIP_FIRST;
const STRIP_CEL_LAST = CARRIER1_STRIP_LAST;
/** `CarrierDrawGroundWake`'s probe starts this far above the carrier. */
const WAKE_PROBE_RISE = 100.0;
/** `PlaySoundId(0x000B16A9)` with the bow strip at path frame 0x550. */
export const SFX_CARRIER_BOW = 0xb16a9;
/** `obj+0x124 = 40.0` — the shot sphere state 0 seats. */
const CARRIER_HIT_RADIUS = 40.0;
/** The two `op_` object paths `CarrierPropRoutine1` rides. */
export const CARRIER_PATH_MOOR = 0x15e;
export const CARRIER_PATH_RUN = 0x15f;
/** `[0x005772B4]` — the last frame of path 351, and state 4's own end. */
export const CARRIER_PATH_END = 1390;
/** The path frames the routine acts on. */
const FRAME_FORK = 0x500;
const FRAME_MOOR_FADE = 0x501;
const FRAME_MOORED = 0x528;
const FRAME_BOW_EFFECT = 0x550;
const FRAME_BOW_FLAG = 0x55a;
/** `ride+0x10` — what the wake scale gains a frame once a fade starts. */
const WAKE_FADE_RATE = -0.015;
/** Selector 1 — the stage-3 boat, and the routine this file ports. */
export const CARRIER_ROUTINE_PORTED = 1;

// -- `CarrierPropRoutine6`'s own numbers --------------------------------------
//
// The same eight states through a jump table of the same shape (`0x0044172C`:
// `0x004413E7`, `0x00441427`, `0x004414C2`, `0x00441459`, `0x004414F0`,
// `0x004415FC` twice, `0x00441718`), on two other object paths and at other
// frames. Read instruction by instruction, not copied from routine 1: the
// run-past arm is arranged differently (below).

/** `PUSH 0x160` / `PUSH 0x161` — `op_` paths 352 (pull up) and 353 (run). */
export const CARRIER6_PATH_MOOR = 0x160;
export const CARRIER6_PATH_RUN = 0x161;
/** `[0x005772BC]` — `g_cam_path_length[0x161]`, read from the image: 0x6AE. */
export const CARRIER6_PATH_END = 0x6ae;
/** `CMP EAX, 0x635` at `0x0044143A` — the fork on `g_civilians_alive`. */
const CARRIER6_FRAME_FORK = 0x635;
/** `SUB EAX, 0x672` at `0x004414D5` — the pull-up starts the wake's fade. */
const CARRIER6_FRAME_MOOR_FADE = 0x672;
/** `SUB EAX, 0x3C` at `0x004414DC` — 0x6AE, moored. */
const CARRIER6_FRAME_MOORED = 0x6ae;
/** `CMP EAX, 0x668` at `0x00441526` — running past, the wake starts to fade. */
const CARRIER6_FRAME_FADE = 0x668;
/** `CMP EAX, 0x6A4` at `0x00441539` — the bow splash and its sound. */
const CARRIER6_FRAME_BOW_EFFECT = 0x6a4;
/** `obj+0x34` bit the run-past arm raises at path frame `0x55A`. */
const CARRIER_BOW_BIT = 0x400000;

/**
 * `g_prop_behaviours` — `0x005926A8`, ten entries indexed by the descriptor's
 * `tail+0x10`.
 *
 * Entry 0 is `NoOpStub` and is what a static prop takes; entry 8 is
 * {@link CarrierPropSelectRoutine}. Entries 1, 3, 4 and 5 are the carried
 * props' — class 0x30 state 37's barrels, which reach the table through the
 * state-37 script rather than through a class-0x13 descriptor; 1 and 4 are
 * ported in `game/carried_prop.ts`, and so is 2, the stage-4 boss's. The
 * rest — `0x0043FFC0`, `0x004400D0` and `0x00445050` — are not read.
 * `[open]`
 */
export enum PropBehaviour {
  /** `NoOpStub` (`0x0041EBB0`) — a static prop, drawn and nothing else. */
  None = 0,
  /** `CarriedPropHeldUpdate` (`FUN_00442820`) — `game/carried_prop.ts`. */
  CarriedPropHeld = 1,
  /**
   * `CarriedPropHeldInBone8Update` (`FUN_00443200`) — `game/carried_prop.ts`.
   * The stage-4 boss's props; `Boss4SpawnHeldProp` is its only allocator.
   */
  CarriedPropHeldInBone8 = 2,
  /** `CarriedPropThrowAtTarget` (`FUN_004432D0`) — not ported. */
  CarriedPropThrowAtTarget = 3,
  /** `CarriedPropThrowAtCamera` (`FUN_00443B90`) — `game/carried_prop.ts`. */
  CarriedPropThrowAtCamera = 4,
  /** `CarriedPropRollAtCamera` (`FUN_00443DC0`) — not ported. */
  CarriedPropRollAtCamera = 5,
  /** `CarrierPropSelectRoutine` (`FUN_00440190`). */
  SelectCarrierRoutine = 8,
}

/** The tail, when this actor has one. */
function Tail(obj: Actor): ScriptedPropTail | null {
  return obj.cls === SpawnClass.ScriptedProp
    ? (obj as { prop13: ScriptedPropTail }).prop13 : null;
}

/**
 * `ScriptedPropInit13` — `FUN_0043FE10`.
 *
 * Fills the 0x1C-byte block from the descriptor tail and then **calls the
 * behaviour once**, which is how entry 8 gets to install a routine before the
 * first update runs.
 *
 * It stores nothing at `obj+0x64`/`+0x68`/`+0x6C` (`0x0043FE23`..
 * `0x0043FE7E`), so the three angles `SpawnFromDescriptorSmall`
 * (`FUN_00408BC0`) copied off the record are what the first draw uses -- and,
 * behind `NoOpStub`, the only ones a static prop ever has. Stage 2's five
 * static props all carry a pitch; see `PlacementOrientation`.
 */
export function ScriptedPropInit13(obj: Actor): void {
  const sub = Tail(obj);
  const p = obj.class13;
  if (!sub || !p) return;
  sub.slot = p.slot;
  sub.camPath = p.cam_path;
  sub.camFrame = p.cam_frame;
  sub.scale = p.scale;
  // `sub+0x18 = 1.0f` in the Init; no ported behaviour writes it.
  sub.alpha = 1;
  sub.behaviour = p.behaviour;
  sub.selector = p.selector;
  sub.state = CarrierState.Begin;
  // `obj+0x3C = -1`.
  obj.motion = -1;
  if (sub.behaviour === PropBehaviour.SelectCarrierRoutine) {
    CarrierPropSelectRoutine(obj, sub);
  }
}

/**
 * `CarrierPropSelectRoutine` — `FUN_00440190`. `g_prop_behaviours[8]`.
 *
 * Sets `g_civilian_carrier` and then overwrites `sub+0x00` with one of seven
 * routines chosen through the jump table at `0x004401E4` — see
 * {@link g_carrier_prop_routines}. Selectors 0, 1 and 6 are ported (stage
 * 2's block-16 boat and stage 3's two), and 2 and 9 (`FUN_004408A0`,
 * `class13/routine2.ts`, the stage-4 boss's transport); the other three
 * routines — `0x00440AD0` (3), `0x00440C20` (4 and 7) and `0x00441000` (5
 * and 8), all stage 4's — are unread. `[open]`
 *
 * The carrier global is written **whatever the selector**, because the engine
 * writes it before it dispatches, and a rider placed after an unported carrier
 * should still find its carrier rather than the previous one.
 */
export function CarrierPropSelectRoutine(obj: Actor,
                                         sub: ScriptedPropTail): void {
  G.g_civilian_carrier = obj.at;
  void sub;
}

/**
 * `PropSeatOnObjectPath` — `FUN_00440130`.
 *
 * `CamEvalObjectPath6(slot, (float)frame)` into the object's position and all
 * three rotations. The host answers with the bundle's own `op_` curve; a host
 * with no camera paths leaves the prop where it was, which is what a missing
 * path should look like.
 */
export function PropSeatOnObjectPath(obj: Actor, slot: number, frame: number,
                                     f: ClassFrame): void {
  const p = f.host.objectPath?.(slot, frame);
  if (!p) return;
  obj.pos.x = p.x;
  obj.pos.y = p.y;
  obj.pos.z = p.z;
  if (p.pitch !== undefined) obj.pitch = p.pitch;
  if (p.yaw !== undefined) obj.yaw = p.yaw;
  if (p.roll !== undefined) obj.roll = p.roll;
}

/**
 * The tail every state falls into — `0x00440469`, which is also state 3's
 * whole body.
 *
 * The wake's scale decays once a fade has been started and the wake switches
 * off when it reaches zero. While it is on, `CarrierDrawGroundWake`
 * (`FUN_00440770`) draws `ride+0x04` and `ride+0x04 + 0x16` flat on the
 * ground under the boat, and the cel steps. The draw is
 * `render/slotmodels.ts`'; the two numbers it needs from the world are
 * computed here — see {@link CarrierDrawGroundWakeInputs}.
 */
function CarrierPropStepWake(obj: Actor, sub: ScriptedPropTail): void {
  sub.wakeDrawn = 0;
  if (sub.wakeFade !== 0) {
    sub.wakeScale += sub.wakeFade;
    if (sub.wakeScale <= 0) sub.wakeOn = 0;
  }
  if (sub.wakeOn === 0) return;
  CarrierDrawGroundWakeInputs(obj, sub);
  sub.wakeDrawn = sub.wakeCel;
  sub.wakeCel += 1;
  if (sub.wakeCel > WAKE_CEL_LAST) sub.wakeCel = WAKE_CEL_FIRST;
}

/**
 * The half of `CarrierDrawGroundWake` (`FUN_00440770`) that is not a draw.
 *
 * ```c
 * Push; LoadIdentity; RotX(+0x64); RotZ(+0x6C); RotY(+0x68);
 * MatrixTransformPoint((0, 0, 1)) -> d;  VecToAngles(d) -> (pitch, yaw);
 * SetTop(camera); Translate(x, QueryGroundHeightAt(x, y + 100, z), z);
 * RotY(yaw); Translate(0, 0, 27.0); Scale(1, scale, scale);
 * AssetDrawSlot(cel); AssetDrawSlot(cel + 0x16); Pop;
 * ```
 *
 * The heading comes from the full three-axis pose, so a boat pitching in the
 * water still lays its wake level and along its keel. `[port-only]` as a
 * function: the engine computes both inside the draw.
 */
function CarrierDrawGroundWakeInputs(obj: Actor, sub: ScriptedPropTail): void {
  // The rotation alone: `MatrixLoadIdentity` before the three turns.
  const origin = { pos: vec3(0, 0, 0), pitch: obj.pitch, yaw: obj.yaw,
                   roll: obj.roll } as Actor;
  const d = vec3();
  CarrierTransformPoint(origin, 0, 0, 1, d);
  sub.wakeYaw = VecToAngles(d.x, d.y, d.z).yaw;
  sub.wakeGroundY = QueryGroundHeightAt(obj.pos.x,
                                        obj.pos.y + WAKE_PROBE_RISE,
                                        obj.pos.z);
}

/**
 * State 1's body, shared with state 0 because the engine falls through.
 *
 * The `pathFrame` step is **`0x00440467`**, which is `INC dword ptr [ESI]`
 * sitting immediately above the shared tail — every arm of states 0, 1, 2 and
 * 4 jumps to it, and states 3, 5 and 6 jump past it to `0x00440469`. So a
 * moored boat and a boat drawing its wake both hold their last path frame,
 * and only the three riding states advance.
 *
 * The fork is `(g_civilians_alive != 0) ? 2 : 4`, the `NEG`/`SBB` pair at
 * `0x00440458`, and it is the whole of the class's dependence on the scene.
 */
function CarrierPropRunIn(obj: Actor, sub: ScriptedPropTail,
                          f: ClassFrame): void {
  PropSeatOnObjectPath(obj, CARRIER_PATH_RUN, sub.pathFrame, f);
  if (sub.pathFrame === FRAME_FORK) {
    sub.state = G.g_civilians_alive !== 0
      ? CarrierState.PullUp : CarrierState.RunPast;
  }
}

/**
 * `CarrierPropRoutine1` — `FUN_004403D0`. The boat stage 3 arrives on.
 *
 * Eight states through the jump table at `0x0044074C`. The fork at path frame
 * `0x500` is the whole of the class's dependence on the rest of the scene:
 * `(g_civilians_alive != 0) ? 2 : 4`, computed with the `NEG`/`SBB` pair at
 * `0x00440458`, so a boat whose passenger is already gone does not stop.
 */
export function CarrierPropRoutine1(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;

  sub.stripDrawn = 0;
  switch (sub.state) {
    case CarrierState.Begin:
      // `ActorAllocSub(0x18)`, and the fields it seeds.
      sub.riding = true;
      sub.wakeCel = WAKE_CEL_FIRST;
      sub.wakeOn = 1;
      sub.wakeScale = 1;
      sub.wakeFade = 0;
      sub.pathFrame = G.g_cam_path_frame;
      obj.hitRadius = CARRIER_HIT_RADIUS;
      sub.state = CarrierState.RunIn;
      // ...and falls straight into it, as the engine does: `0x004403F7` runs
      // on into `0x00440437` with no jump between them.
      CarrierPropRunIn(obj, sub, f);
      sub.pathFrame += 1;
      break;
    case CarrierState.RunIn:
      CarrierPropRunIn(obj, sub, f);
      sub.pathFrame += 1;
      break;
    case CarrierState.PullUp:
      PropSeatOnObjectPath(obj, CARRIER_PATH_MOOR, sub.pathFrame, f);
      if (sub.pathFrame === FRAME_MOOR_FADE) sub.wakeFade = WAKE_FADE_RATE;
      else if (sub.pathFrame === FRAME_MOORED) sub.state = CarrierState.Moored;
      sub.pathFrame += 1;
      break;

    case CarrierState.Moored:
      // `0x00440469` is state 3's table entry and the shared tail both: the
      // boat holds the pose the last seat gave it and only the wake runs.
      break;

    case CarrierState.RunPast:
      PropSeatOnObjectPath(obj, CARRIER_PATH_RUN, sub.pathFrame, f);
      if (sub.pathFrame >= CARRIER_PATH_END) {
        sub.stripCel = STRIP_CEL_FIRST;
        sub.state = CarrierState.Wake;
      } else if (sub.pathFrame === FRAME_BOW_EFFECT) {
        sub.wakeFade = WAKE_FADE_RATE;
        // `0x00440546`..`0x004405F8`: the bow is the carrier's own
        // `Translate(0, 0, -5)` read back with `MatrixGetTranslation`, the
        // strip faces the camera block's yaw (`0x009A60D0`, read at
        // `0x004405DC`) with no pitch or roll, and the sound follows the
        // spawn.
        const bow = vec3();
        CarrierTransformPoint(obj, 0, 0, CARRIER_GROUND_WAKE_DRAW[1].bowZ, bow);
        SpawnPropStripEffect({ pos: bow, pitch: 0,
                               yaw: G.g_camera_block_yaw_bams, roll: 0 },
                             PropStripKind.CarrierBow, 1.0, f.events);
        f.events?.emit("sound.play", { id: SFX_CARRIER_BOW });
      } else if (sub.pathFrame === FRAME_BOW_FLAG) {
        obj.flags |= CARRIER_BOW_BIT;
      }
      sub.pathFrame += 1;
      break;

    case CarrierState.Wake:
    case CarrierState.WakeSpent: {
      // The strip the two states draw is `render/`'s; the cursor is state.
      sub.stripDrawn = sub.stripCel;
      sub.stripCel += 1;
      if (sub.stripCel > STRIP_CEL_LAST) sub.stripCel = STRIP_CEL_FIRST;
      if (sub.state === CarrierState.Wake
          && G.g_cam_path_frame >= CARRIER_PATH_END) {
        sub.state = CarrierState.WakeSpent;
      }
      // `if (FUN_004459C0(obj) == 0) { obj+0x34 |= 0x4000000; state = 7; }`
      // is the engine's exit from here, and it is a **screen** test: the
      // routine projects the shot radius at `obj+0x124` through
      // `g_projection_distance_px / obj+0x78` and compares it against the
      // viewport. That is a rendering question the port has no answer to on a
      // headless frame, and answering it wrongly despawns the boat while it is
      // still on screen. It is left unported, which costs nothing: the
      // descriptor's own cue removes the object anyway — stage 3's boat on
      // camera path 130 frame 170, well after the path it rides has run out.
      // [diverges]
      break;
    }

    case CarrierState.Gone:
      ActorDespawn(obj);
      return;
  }
  CarrierPropStepWake(obj, sub);
}

/**
 * `CarrierPropRoutine6` — `FUN_004413C0`. Stage 3 block 7's boat.
 *
 * `CarrierPropSelectRoutine`'s selector 6, and one shipped spawn: evt 29240,
 * placed with its civilian (29072) — whose captor (29136, class 0x18) rides
 * it too — at block 7 step 10. The same machine as
 * {@link CarrierPropRoutine1} on `op_` paths 352/353, forking at `0x635`, with
 * the same shared `INC` above the same tail (`0x00441457`, jumped to by every
 * arm of states 0, 1, 2 and 4 and past by 3, 5 and 6). What differs is the
 * run-past arm:
 *
 * ```
 * seat(0x161, n);
 * if (n >= g_cam_path_length[0x161]) { strip = 0x1AAB; state = 5;
 *                                     obj+0x34 |= 0x400000; }
 * else if (n == 0x668) wakeFade = -0.015;
 * else if (n == 0x6A4) { splash 8 units along the bow; PlaySoundId(0xB16A9); }
 * n++;
 * ```
 *
 * Routine 1 fades and splashes on one frame (`0x550`) and raises `0x400000`
 * ten frames later on its own; this one fades first, splashes later, and
 * raises the bit with the state change. The draws differ only in their
 * literals, which `CARRIER_GROUND_WAKE_DRAW` carries: the wake sits 32.5
 * along the heading (`PUSH 0x42020000` at `0x00441493` is
 * `CarrierDrawGroundWake`'s distance argument, not a scale) against routine
 * 1's 27.0, the state-5/6 strip at -2.0 and the bow strip at +8.0.
 */
export function CarrierPropRoutine6(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const runIn = (): void => {
    PropSeatOnObjectPath(obj, CARRIER6_PATH_RUN, sub.pathFrame, f);
    if (sub.pathFrame === CARRIER6_FRAME_FORK) {
      sub.state = G.g_civilians_alive !== 0
        ? CarrierState.PullUp : CarrierState.RunPast;
    }
  };

  sub.stripDrawn = 0;
  switch (sub.state) {
    case CarrierState.Begin:
      // `0x004413E7`: the same ride block routine 1 allocates, seeded the same
      // way, then straight on into state 1's body at `0x00441427`.
      sub.riding = true;
      sub.wakeCel = WAKE_CEL_FIRST;
      sub.wakeOn = 1;
      sub.wakeScale = 1;
      sub.wakeFade = 0;
      sub.pathFrame = G.g_cam_path_frame;
      obj.hitRadius = CARRIER_HIT_RADIUS;
      sub.state = CarrierState.RunIn;
      runIn();
      sub.pathFrame += 1;
      break;
    case CarrierState.RunIn:
      runIn();
      sub.pathFrame += 1;
      break;
    case CarrierState.PullUp:
      PropSeatOnObjectPath(obj, CARRIER6_PATH_MOOR, sub.pathFrame, f);
      if (sub.pathFrame === CARRIER6_FRAME_MOOR_FADE) {
        sub.wakeFade = WAKE_FADE_RATE;
      } else if (sub.pathFrame === CARRIER6_FRAME_MOORED) {
        sub.state = CarrierState.Moored;
      }
      sub.pathFrame += 1;
      break;
    case CarrierState.Moored:
      break;
    case CarrierState.RunPast:
      PropSeatOnObjectPath(obj, CARRIER6_PATH_RUN, sub.pathFrame, f);
      if (sub.pathFrame >= CARRIER6_PATH_END) {
        sub.stripCel = STRIP_CEL_FIRST;
        sub.state = CarrierState.Wake;
        obj.flags |= CARRIER_BOW_BIT;
      } else if (sub.pathFrame === CARRIER6_FRAME_FADE) {
        sub.wakeFade = WAKE_FADE_RATE;
      } else if (sub.pathFrame === CARRIER6_FRAME_BOW_EFFECT) {
        // `0x00441544`..`0x004415EF`: the carrier's `Translate(0, 0, 8.0)`
        // read back, facing the camera block's yaw (read at `0x004415D3`),
        // kind 3, then the sound.
        const bow = vec3();
        CarrierTransformPoint(obj, 0, 0, CARRIER_GROUND_WAKE_DRAW[6].bowZ, bow);
        SpawnPropStripEffect({ pos: bow, pitch: 0,
                               yaw: G.g_camera_block_yaw_bams, roll: 0 },
                             PropStripKind.CarrierBow, 1.0, f.events);
        f.events?.emit("sound.play", { id: SFX_CARRIER_BOW });
      }
      sub.pathFrame += 1;
      break;
    case CarrierState.Wake:
    case CarrierState.WakeSpent:
      // `0x004415FC`: the strip drawn at the carrier's `Translate(0, 0, -2)`
      // and stepped, then `state == 5 && g_cam_path_frame >=
      // g_cam_path_length[0x161]` moves it to 6, and 6's screen test is the
      // same unported exit as routine 1's. [diverges]
      sub.stripDrawn = sub.stripCel;
      sub.stripCel += 1;
      if (sub.stripCel > STRIP_CEL_LAST) sub.stripCel = STRIP_CEL_FIRST;
      if (sub.state === CarrierState.Wake
          && G.g_cam_path_frame >= CARRIER6_PATH_END) {
        sub.state = CarrierState.WakeSpent;
      }
      break;
    case CarrierState.Gone:
      ActorDespawn(obj);
      return;
  }
  CarrierPropStepWake(obj, sub);
}

/**
 * `ScriptedPropUpdate13` — `FUN_0043FE90`.
 *
 * The despawn cue first — `g_active_cam_path` and `g_cam_path_frame` both
 * equal to the pair the descriptor named — then the behaviour. The draw that
 * follows it in the engine is `render/slotmodels.ts`'s.
 *
 * The behaviour runs **before** the draw (`CALL [EDI]` at `0x0043FEC9`, the
 * matrix from `0x0043FEDE`), so the record's angles are drawn only where the
 * behaviour writes none: behaviour 0, and carrier selector 3 (`0x00440AD0`,
 * which never stores to the object), both for life. Every other carrier
 * routine falls from state 0 into {@link PropSeatOnObjectPath} on its first
 * call, and its first draw is already on the path. `[proved]`
 */
export function ScriptedPropUpdate13(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (G.g_active_cam_path === sub.camPath
      && G.g_cam_path_frame === sub.camFrame) {
    ActorDespawn(obj);
    return;
  }
  if (sub.behaviour !== PropBehaviour.SelectCarrierRoutine) return;
  g_carrier_prop_routines[sub.selector]?.(obj, f);
}

/**
 * The routines `CarrierPropSelectRoutine` (`FUN_00440190`) installs, by the
 * first dword of the operand block. Sparse: a selector with no entry installs
 * a routine this port has not read, and runs nothing.
 */
export const g_carrier_prop_routines: Partial<Record<number,
  (obj: Actor, f: ClassFrame) => void>> = {
  0: CarrierPropRoutine0,
  [CARRIER_ROUTINE_PORTED]: CarrierPropRoutine1,
  // `FUN_004408A0` is installed for both: 9 is 2 arriving parked.
  2: CarrierPropRoutine2,
  6: CarrierPropRoutine6,
  9: CarrierPropRoutine2,
};

function ScriptedPropDebug(obj: Actor): ActorDebug {
  const sub = Tail(obj);
  if (!sub) return { summary: "no class 0x13 tail", hot: true };
  return {
    summary: `behaviour ${sub.behaviour}/${sub.selector} · `
      + `${CarrierState[sub.state] ?? sub.state}`,
    detail: [
      `slot 0x${sub.slot.toString(16)} · path frame ${sub.pathFrame}`,
      `despawn on cam ${sub.camPath} frame ${sub.camFrame}`,
      `carrier ${G.g_civilian_carrier.toString(16)}`,
    ],
    hot: sub.behaviour === PropBehaviour.SelectCarrierRoutine
      && g_carrier_prop_routines[sub.selector] === undefined,
  };
}

export const ScriptedPropHandler: ClassHandler = {
  init: ScriptedPropInit13,
  update: ScriptedPropUpdate13,
  // `ScriptedPropInit13` writes no `obj+0x11C` and the update reads no hit
  // bit; `RegisterForShotTest` puts it in the list and nothing takes damage.
  ownsShotResult: true,
  debug: ScriptedPropDebug,
};

registerClass(SpawnClass.ScriptedProp, ScriptedPropHandler);
