/**
 * Class 0x33 — generic scripted scenery, and the one sub-handler that is
 * `g_carrier_object`.
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) is eleven objects behind one
 * class id: it switches `obj+0x11C` — the raw `s16` at `desc+0x22`, **not**
 * hit points, which is `L3` and has already caught someone on this class —
 * into eleven sub-handlers plus a twelfth at 99, installs one as the object's
 * update and never runs again. See {@link ScriptedScenerySelector} for the
 * jump table.
 *
 * **All twelve are ported.** Selector 2 is a model drawn until a flag or a
 * camera frame, in `class33/draw_until_flag.ts`. Selector 3 throws one
 * sprite on its first frame, in `class33/effect_first_frame.ts`. Selectors
 * 6, 7, 10 and 11 are in `class33/cues.ts` and 8, 9 and 99 in
 * `class33/strips.ts`, carried by the bundle's `class33_sub`. Selector 4 is
 * the pushable scenery in `class33/pushable.ts` — stage 1's two chairs.
 * Selector 5 is the sprite effect stage 2 throws at a camera frame, in
 * `class33/effect_cue.ts`. Selector 1 is here: the object stage 5 block 2's
 * room is held by, and stage
 * 2's two riders leave on:
 *
 * ```
 * ScriptedSceneryDispatch33   FUN_00432FF0   the switch, g_carrier_object, the
 *                                            hit slot every arm claims
 * ScriptedCarrierUpdate33     FUN_004331D0   the two bits, the effect, the exit
 * ScriptedCarrierStepPath33   FUN_00433860   the ride along the op_ path
 * ```
 *
 * ## What it is
 *
 * `[proved]` A **vehicle that drives in on a path, stops, and burns.** Not
 * from what it looks like: from the four sounds it plays, resolved through
 * `g_se_name_list`.
 *
 * ```
 * 0x423A9  STAGE5_SE\DRIVE_DEAD2_22.wav      seated, slot 0x1B0E only
 * 0x523A9  STAGE5_SE\DRIVE_DEAD2_22_OFF.wav  the frame the effect fires
 * 0x723A9  STAGE5_SE\CAR_FIRE_22.wav         0x14 frames after that
 * 0x823A9  STAGE5_SE\CAR_FIRE_22_OFF.wav     as it leaves the field
 * ```
 *
 * Two looped sounds, each with its `_OFF` half, and the second starts where
 * the first stops. That also settles `rigs_data.ts`'s `[likely] fire or smoke` on
 * the 0x1AAB..0x1AD2 loop the object swaps to: it is fire.
 *
 * ## The two bits, and why this class had to exist for the port to finish
 *
 * The update raises two bits on **its own** `obj+0x34`, and each is the way
 * out of a different class-0x30 state:
 *
 * * `0x10000000` ({@link ActorFlag.Committed}) at `0x00433203`, on the
 *   descriptor's `commit_flag` or `commit_frame` — what
 *   `ZombieStateRideCarrier` (class 0x30 state 29) leaves on.
 * * `0x40000000` ({@link ActorFlag.Reacting}) at `0x00433280`, on
 *   `effect_frame` — what `ZombieStateDelayedStrikeInPlace`
 *   (`FUN_0045E830`) reads at `0x0045EAFE` to give up to state 10 after
 *   `0x14` frames.
 *
 * With no class 0x33 the second bit had no writer, and stage 5 block 2's four
 * `znnick` sat in state 32 for ever at the distance the script put them —
 * `wait_enemies_alive <= 0` at step 2 op 50, a room a player could not clear
 * by shooting. That is what this module is for.
 *
 * ## How it is shot `[proved]`
 *
 * The draw's model ends `MatrixStore(obj+0x150)` (`0x00433457`), then
 * `obj+0x70..0x78` is `obj+0x40` through the camera block's matrix
 * (`0x00433463`..`0x004334C7`) and `RegisterForShotTest` (`0x004334D0`) files
 * the object -- before the car's parts, and on every frame the ride runs.
 * The seat (`0x00433886`..`0x004338B7`) raises `0x80000001` and then either
 * the mesh arm -- `tail+0x04 != -1`: `obj+0x34 |= 0x50` and the pointer on
 * `obj+0x14C` -- or the sphere, `tail+0x08` on `obj+0x124` and `obj+0x128`.
 * Stage 2's two boats (`0x4FD0`, `0x12590`) take the mesh arm, so a shot
 * stops where it crosses the boat's blob, through the 2.5-scaled matrix
 * (`ShotTestMesh`, `combat/shot_test.ts`); stage 5's car the sphere, 0.1
 * units round the car's origin.
 *
 * **Bit 31 keeps it out of every other list.** Nothing in the class clears
 * the `0x80000000` the seat raises, and `0x80008000` is what both
 * moving-object collision passes (`coli.ts`) and the crowd push
 * (`ColiTestSphereAgainstActors`) refuse, so a boat is never a floor or a
 * wall and pushes nobody: it is in the shot test and nowhere else. And no
 * routine of the class reads the hit bits `MarkActorShot` (`FUN_00404DB0`)
 * raises -- every `[reg + 0x34]` operand in `0x00432FF0`..`0x00434400` is a
 * store or a test of `0x10000000`, `0x40000000`, `0x200000`, `0x8000`, or
 * the pusher's `0x18000000` -- so a hit marks it and that is all (the
 * handler's `ownsShotResult`).
 *
 * ## The draw
 *
 * `[proved]` from the listing, `0x004332DA`..`0x0043382F`: the fire, the
 * model, and either stage 5's car parts or the two sprite loops. The
 * pseudocode once ended at `0x0043345E` with a `return` the code does not
 * have (`L37`), and this module was written from it: it said the draw was
 * the rig writer's and that the fire returned early. Both were wrong; the
 * database decompiles the whole routine now, and the listing agrees with it
 * line for line. Each `AssetDrawSlot` is recorded on
 * `obj.scenery.draws` with the world matrix the stack held, and
 * `render/slotmodels.ts` places them; nothing else draws this object. Before
 * this was ported nothing drew it at all: stage 2 block 9's boat, slot
 * `0x1A36` at scale 2.5, was missing from the river.
 */
import type { Rng } from "../../core/rng";
import { type Actor, ActorFlag, type ScriptedSceneryActor } from "../actor";
import { ActorDespawn } from "../despawn";
import { SpawnSpriteEffect } from "../effects/sprite";
import { G } from "../globals";
import { ActorClaimHitSlot } from "../hit_slots";
import { ColiStoreObjectMatrix } from "../coli";
import { RegisterForShotTest } from "../combat/shot_test";
import type { GameHost } from "../host";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
  type ReplayCamera, type ReplaySpawnRecord,
} from "../registry";
import { T } from "../tables";
import { SpawnClass } from "../spawn_class";
import { CameraBlockEye } from "../camera/view";
import {
  FtolS16, MatIdentity, type Mat, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { vec3, VecToAngles } from "../vec";
import { ScriptedEffectAtCameraCue33 } from "./effect_cue";
import {
  ScriptedEndingTrackSelect33, ScriptedSoundAndFlagAtCue33,
  ScriptedSoundCues33, ScriptedSoundCues33FollowReplayCamera,
  ScriptedSoundCues33ResumeFromReplay, ScriptedSpriteEffectOnce33,
} from "./cues";
import {
  ScriptedBridgeCrashStrip33, ScriptedFireLoopUntilCue33,
  ScriptedStaticSlotDraw33,
} from "./strips";
import { ScriptedPropDrawUntilFlag } from "./draw_until_flag";
import { ScriptedEffectOnFirstFrame33 } from "./effect_first_frame";
import { ScriptedPushableUpdate33, SCENERY_SKIP_COLLISION }
  from "./pushable";
import { ScriptedScenerySelector } from "./state";

export { ScriptedScenerySelector };
export { ScriptedEffectAtCameraCue33 } from "./effect_cue";
export { ScriptedPropDrawUntilFlag } from "./draw_until_flag";
export { ScriptedEffectOnFirstFrame33 } from "./effect_first_frame";
export { ScriptedPushableUpdate33 } from "./pushable";

/**
 * The draw slot whose arms the two routines special-case.
 *
 * `CMP EAX, 0x1B0E` appears three times — at `0x00433238`, `0x004334DE` and
 * `0x00433910` — and it is the only slot that plays the driving sound, takes
 * effect kind {@link EFFECT_KIND_ARRIVED} and carries the five sub-models.
 * Stage 5's carrier is this one; stage 2's two are `0x1A35` and `0x1A36`.
 */
const SLOT_STAGE5_CAR = 0x1b0e;

/** `SUB EAX, 0x1A35` / `DEC EAX` at `0x004339AB` — the two scaled slots. */
const SLOT_SCALED_A = 0x1a35;
const SLOT_SCALED_B = 0x1a36;

/**
 * `PUSH 0x44` at `0x00433249` and `PUSH 0x45` at `0x00433268` — the sprite
 * effect kind, picked by the draw slot.
 */
const EFFECT_KIND_DEFAULT = 0x44;
const EFFECT_KIND_ARRIVED = 0x45;

/**
 * `PUSH 0x0` / `PUSH 0x2` beside them: `SpawnSpriteEffect`'s face-camera mode.
 * 2 is "yaw toward the camera, pitch forced to zero".
 */
const EFFECT_FACE_DEFAULT = 0;
const EFFECT_FACE_ARRIVED = 2;

/** `PUSH -0x1` — the player the effect belongs to, which is none. */
const EFFECT_NO_PLAYER = -1;

/**
 * `STAGE5_SE\DRIVE_DEAD2_22.wav` and its `_OFF`, then
 * `STAGE5_SE\CAR_FIRE_22.wav` and its `_OFF`. Resolved through
 * `g_se_name_list`; see the module note.
 */
const SND_DRIVE = 0x423a9;
const SND_DRIVE_OFF = 0x523a9;
const SND_FIRE = 0x723a9;
const SND_FIRE_OFF = 0x823a9;

/** `CMP ECX, 0x14` at `0x004332A5` — frames from the effect to the fire. */
const FIRE_DELAY_FRAMES = 0x14;

/**
 * `CMP EAX, 0xBF800000` at `0x0043320E` — the descriptor's "never" for
 * `effect_frame`, tested as the **raw dword** before the float compare.
 */
const EFFECT_FRAME_NONE = -1.0;

/** `ADD ECX, 0x4000` at `0x004339DB` — a quarter turn, slot `0x1A36` only. */
const SLOT_B_YAW_BIAS = 0x4000;

/** `FSUB float ptr [0x0055D2B4]` at `0x004339CD` — the raw is `0x40A00000`. */
const SLOT_CAR_X_BIAS = 5.0;

/**
 * `MOV dword [ESI+0x118],0x3f800000` at `0x004339B3`, and `0x40200000` at
 * `0x004339E1`/`0x004339F3` for the two scaled slots.
 */
const DRAW_SCALE = 1.0;
const DRAW_SCALE_BOAT = 2.5;

/** `obj+0x1354/+0x1358/+0x135C` as the seat writes them, `0x004338CE`. */
const LOOP_A_FIRST = 0x24a;
const LOOP_A_LAST = 0x25f;
const LOOP_B_FIRST = 0x260;
const LOOP_B_LAST = 0x275;

/** `MOV EAX,0x1aab` / `MOV dword [EBP+0x136c],0x1ad2` at `0x004332B7`. */
const FIRE_FIRST = 0x1aab;
const FIRE_LAST = 0x1ad2;

/**
 * The two sprite loops' matrix after the object's: `PUSH 0x41c80000; PUSH 0;
 * PUSH 0` then `MatrixScale(0x3f19999a, 0x3f000000, 0x3f333333)` at
 * `0x0043352A`..`0x00433547`.
 */
const LOOP_Z = 25.0;
const LOOP_SCALE: readonly [number, number, number] = [
  Math.fround(0.6), 0.5, Math.fround(0.7)];

/**
 * Stage 5's car parts, `0x0043362B`..`0x00433813`: each under the object's
 * `T RotZ RotY RotX`, then its own offset. The floats are the pushed raws.
 */
const CAR_PART_DOOR = 0x899;
const CAR_PART_DOOR_AT: readonly [number, number, number] = [
  Math.fround(-5.2664), Math.fround(8.3328), Math.fround(6.717)];  // 0xc0a88659..
const CAR_PART_DOOR_PITCH = -0x2d3a;                                // PUSH 0xffffd2c6
const CAR_PART_WHEEL = 0x8cb;
const CAR_PART_WHEEL_Y = Math.fround(3.5437);                       // 0x4062cbfb
const CAR_PART_WHEEL_FRONT_Z = Math.fround(17.0281);                // 0x4188398c
const CAR_PART_WHEEL_BACK_Z = Math.fround(-12.384);                 // 0xc14624dd
/** `ADD EDX,0x2000` at `0x004336E8` — the wheels' turn a frame. */
const CAR_WHEEL_TURN_STEP = 0x2000;
const CAR_PART_LEFT = 0x1b0a;
const CAR_PART_RIGHT = 0x1b0d;
const CAR_PART_SIDE_X = 10.0;                                       // 0x41200000
const CAR_PART_SIDE_Y = Math.fround(6.216);                         // 0x40c6e979
const CAR_PART_SIDE_Z = Math.fround(6.878);                         // 0x40dc1893

/**
 * `ScriptedSceneryDispatch33` — `FUN_00432FF0`. Class 0x33's `Init`.
 *
 * The engine's switch installs one of twelve update pointers into `*obj`, and
 * **every** arm then calls `ActorClaimHitSlot` (`FUN_00409270`): `PUSH EAX` /
 * `CALL 0x00409270` closes each of them, `0x00433020` for selector 1 through
 * `0x004330AC` for 11, and the default at `0x004330B9` -- which selector 99's
 * arm falls into after installing `0x00433160`, and which an out-of-range
 * selector jumps to directly, installing nothing. So the claim is not a
 * choice between arms and is not written as one.
 *
 * The install itself is {@link ScriptedSceneryUpdate33}'s test on the
 * selector, because the port has one table entry per class.
 *
 * `MOV [0x009a5c34], EAX` at `0x00433014` is inside selector 1's arm, so the
 * carrier publishes itself **here** as well as on every frame of its update:
 * a state that reads `g_carrier_object` on the same frame the object is made
 * finds it.
 */
export function ScriptedSceneryDispatch33(obj: Actor): void {
  if (obj.hp === ScriptedScenerySelector.Carrier) {
    G.g_carrier_object = obj.at;
  }
  ActorClaimHitSlot(obj);
}

/**
 * `ScriptedCarrierStepPath33` — `FUN_00433860`. Seat the object, then ride.
 *
 * `obj+0x1312` is this routine's own two-step cursor and not a state: 0 seats
 * the object from the descriptor tail and falls through into the step, 1
 * steps, and **2 and up return at once** (`0x00433881`), which is what freezes
 * `obj+0x1370` at the end of the run for good.
 *
 * The cursor is seeded to `g_cam_path_frame - 1` — `FILD` at `0x004338F7`,
 * off `DEC EDX` — and then advanced by a literal `1.0` (`0x004C4380`) every
 * frame. So it agrees with the camera only for as long as the camera runs the
 * same path at the same rate, and the two frame cues in
 * {@link ScriptedCarrierUpdate33} are read against **this** counter, not
 * against the camera's.
 */
export function ScriptedCarrierStepPath33(obj: ScriptedSceneryActor,
                                          host?: GameHost,
                                          events?: ClassFrame["events"]): void {
  const t = obj.class33;
  const s = obj.scenery;
  if (!t) return;

  if (obj.sub === 0) {
    // `OR ECX, 0x80000001` at `0x00433889`, and `OR ECX, 0x50` on top of it
    // for a descriptor that names a shot mesh. Bit `0x10` is what sends the
    // shot test to `ShotTestMesh` instead of `ShotTestSphere`.
    obj.flags |= 0x80000001;
    if (t.shot_mesh === -1) {
      // `obj+0x124 = obj+0x128 = tail+0x08` — both radii, one value.
      obj.hitRadius = t.shot_radius;
      obj.bodyRadius = t.shot_radius;
    } else {
      // ...and `obj+0x14C = tail+0x04`, which the port carries resolved.
      obj.flags |= 0x50;
      obj.coliBlob = t.shot_blob ?? null;
    }
    s.slot = t.slot;
    s.pathSlot = t.path;
    s.pathEnd = t.path_end;
    // `0x004338CE`..`0x004338E2`: the two sprite loops' cursors and the
    // wheels' turn, which the update's draw steps.
    s.loopA = LOOP_A_FIRST;
    s.loopB = LOOP_B_FIRST;
    s.wheelTurn = 0;
    s.pathFrame = G.g_cam_path_frame - 1;
    if (s.slot === SLOT_STAGE5_CAR) events?.emit("sound.play", { id: SND_DRIVE });
    obj.sub += 1;
  } else if (obj.sub !== 1) {
    return;
  }

  const at = s.pathFrame + 1.0;
  s.pathFrame = at;
  if (s.pathEnd <= at) { obj.sub += 1; return; }

  // `CamEvalObjectPath6` (`FUN_004042D0`) — six values, and the three
  // rotations are **ints**, which is `L2`. A host with no `op_` paths is a
  // valid host; the counter above has already advanced, which is the half
  // every cue in the update reads.
  const p = host?.objectPath?.(s.pathSlot, at);
  if (!p) return;
  obj.pos.x = p.x;
  obj.pos.y = p.y;
  obj.pos.z = p.z;
  // `AND ECX, 0xFFFF` at `0x00433982`/`0x0043398F`/`0x004339A5`: the engine
  // masks each of the three on the way onto the object.
  obj.pitch = (p.pitch ?? 0) & 0xffff;
  obj.roll = (p.roll ?? 0) & 0xffff;
  obj.yaw = (p.yaw ?? 0) & 0xffff;
  // `MOV dword [ESI+0x118],0x3f800000` at `0x004339B3`, before the slot test.
  s.drawScale = DRAW_SCALE;

  if (s.slot === SLOT_SCALED_A) { s.drawScale = DRAW_SCALE_BOAT; return; }
  if (s.slot === SLOT_SCALED_B) {
    // **Not masked.** `MOV [ESI+0x68], ECX` at `0x004339EB` takes the *raw*
    // `ry` the routine kept in ECX before the `AND`, plus a quarter turn.
    s.drawScale = DRAW_SCALE_BOAT;
    obj.yaw = (p.yaw ?? 0) + SLOT_B_YAW_BIAS;
    return;
  }
  if (s.slot === SLOT_STAGE5_CAR) obj.pos.x = p.x - SLOT_CAR_X_BIAS;
}

/**
 * `ScriptedCarrierUpdate33` — `FUN_004331D0`. One frame of the carrier.
 *
 * Read top to bottom, because the order is the behaviour: the two cues are
 * tested against the cursor the **previous** frame's ride left, the fire is
 * drawn where the descriptor put it and the routine runs on, and then either
 * the despawn arm or the ride and the draw. A burning carrier keeps riding
 * until `tail+0x10` stops it, and leaves on its despawn cue with
 * `CAR_FIRE_22_OFF`.
 *
 * The despawn cue is `g_cam_path_frame == tail+0x1C || g_cam_path_frame_2 ==
 * tail+0x1C`, camera blocks 0 and 2 by address (`0x004333D7`, `0x004333DF`),
 * the same pair `class30/entrance.ts`'s `CamCueHit` tests. Block 2's frame is
 * always 0, so the second arm is "the cue is 0". Of the three shipped
 * carriers only stage 5's names a frame at all (650); stage 2's two both carry
 * `-1` there and leave on their script flag instead.
 */
export function ScriptedCarrierUpdate33(obj: ScriptedSceneryActor,
                                        f: ClassFrame): void {
  const t = obj.class33;
  const s = obj.scenery;
  if (!t) return;

  // `MOV dword ptr [0x009a5c34], EBP` at `0x004331E1` — every frame, not once.
  G.g_carrier_object = obj.at;
  s.draws.length = 0;

  // `MOV AL, byte ptr [EBX + 0x20]` / `CMP byte ptr [EAX + 0x9C7200], 0x1` at
  // `0x004331E7` — the flag index is used raw, with no "none" test in front of
  // it. All three shipped carriers carry `0xFF` there and nothing in the image
  // raises `g_script_flags[255]`, so the descriptor's "no flag" is arithmetic
  // rather than a branch. Transcribed as written, `despawn_flag` included.
  if (G.g_script_flags[t.commit_flag] === 1 || t.commit_frame === s.pathFrame) {
    obj.flags |= ActorFlag.Committed;
  }

  // `FCOMP float ptr [EBX + 0x14]` at `0x0043321C` — an **exact** float
  // equality against a cursor that starts on an integer and gains 1.0, so it
  // is a single frame and not a threshold.
  if (t.effect_frame !== EFFECT_FRAME_NONE && s.pathFrame === t.effect_frame) {
    const at = vec3(t.effect[0], t.effect[1], t.effect[2]);
    if (s.slot === SLOT_STAGE5_CAR) {
      f.events?.emit("sound.play", { id: SND_DRIVE_OFF });
      SpawnSpriteEffect(at, t.effect[3], t.effect[4], EFFECT_KIND_ARRIVED,
                        EFFECT_FACE_ARRIVED, EFFECT_NO_PLAYER, f.host,
                        f.events);
    } else {
      SpawnSpriteEffect(at, t.effect[3], t.effect[4], EFFECT_KIND_DEFAULT,
                        EFFECT_FACE_DEFAULT, EFFECT_NO_PLAYER, f.host,
                        f.events);
    }
    s.effectFrames = 0;
    obj.flags |= ActorFlag.Reacting;
  }

  if (obj.flags & ActorFlag.Reacting) {
    s.effectFrames += 1;
    if (s.effectFrames === FIRE_DELAY_FRAMES) {
      obj.flags |= ActorFlag.FireLoop;
      s.fireSlot = FIRE_FIRST;
      s.fireFirst = FIRE_FIRST;
      s.fireLast = FIRE_LAST;
      f.events?.emit("sound.play", { id: SND_FIRE });
    }
    // `0x004332DA`: the fire is drawn and the routine **carries on** into
    // the despawn test and the ride below -- `ADD ESP,0x8` at `0x004333B8`
    // falls through to `0x004333BB`. The port returned here, on a reading of
    // pseudocode that ended early, which froze a burning carrier and made
    // `SND_FIRE_OFF` unreachable.
    if (obj.flags & ActorFlag.FireLoop) Carrier33DrawFire(s, t.effect);
  }

  if (G.g_script_flags[t.despawn_flag] !== 1
      && G.g_cam_path_frame !== t.despawn_frame
      && G.g_cam_path_frame_2 !== t.despawn_frame) {
    ScriptedCarrierStepPath33(obj, f.host, f.events);
    Carrier33Draw(obj, f.host);
    return;
  }

  if (obj.flags & ActorFlag.FireLoop) {
    f.events?.emit("sound.play", { id: SND_FIRE_OFF });
  }
  ActorDespawn(obj);
}

/**
 * `AssetDrawSlot` (`FUN_00418560`) under `m`, recorded rather than made.
 * `[port-only]` as a function, as `Class26DrawSlot` is.
 */
function Carrier33DrawSlot(s: ScriptedSceneryActor["scenery"], m: Mat,
                           slot: number): void {
  s.draws.push({ slot, m: m.slice(0, 16) });
}

/** `MatrixStackPush; MatrixTranslate(pos); RotZ; RotY; RotX` — every draw's head. */
function Carrier33ObjectMatrix(obj: ScriptedSceneryActor): Mat {
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixRotateX(m, obj.pitch);
  return m;
}

/**
 * `ScriptedCarrierUpdate33`'s fire, `0x004332E7`..`0x004333B8`: the slot loop
 * at the descriptor's effect point (`tail+0x24`), turned to face the camera
 * block's eye in yaw alone (`MOV dword [ESP+0x40],0x0` zeroes the pitch
 * `VecToAngles` gave). The cursor steps **before** it is drawn, so the first
 * slot drawn is `0x1AAC`.
 *
 * `[port-only]` as a function: a stretch of the update, split out because
 * the update runs it before the despawn test and the model after it.
 */
function Carrier33DrawFire(s: ScriptedSceneryActor["scenery"],
                           at: readonly number[]): void {
  const eye = CameraBlockEye(G.g_camera_index);
  const ang = VecToAngles(eye.x - at[0], eye.y - at[1], eye.z - at[2]);
  const m = MatIdentity();
  MatrixTranslate(m, at[0], at[1], at[2]);
  MatrixRotateY(m, FtolS16(ang.yaw));
  MatrixRotateX(m, 0);
  s.fireSlot += 1;
  if (s.fireLast < s.fireSlot) s.fireSlot = s.fireFirst;
  Carrier33DrawSlot(s, m, s.fireSlot);
}

/**
 * `ScriptedCarrierUpdate33`'s draw after the ride, `0x004333F1`..`0x0043382F`,
 * and the shot-test registration in the middle of it.
 *
 * The model is `obj+0x13F0` under `T RotZ RotY RotX Scale(obj+0x118)`
 * (`NoOpStub` is handed the scale and does nothing). Then slot `0x1B0E`
 * draws its five parts and returns; any other slot draws the two sprite loops
 * 25 units along its own Z, scaled `(0.6, 0.5, 0.7)`, but only while
 * `obj+0x1312` is 1 -- while the ride runs -- each loop stepped after it is
 * drawn.
 *
 * `[port-only]` as a function, for the reason {@link Carrier33DrawFire} is.
 */
function Carrier33Draw(obj: ScriptedSceneryActor, host: GameHost): void {
  const s = obj.scenery;
  let m = Carrier33ObjectMatrix(obj);
  MatrixScale(m, s.drawScale, s.drawScale, s.drawScale);
  Carrier33DrawSlot(s, m, s.slot);
  // `MatrixStore(obj+0x150)` at `0x00433457`, built on the identity -- the
  // matrix `RegisterForShotTest`'s mesh arm leaves (`combat/shot_test.ts`).
  ColiStoreObjectMatrix(obj, m);
  // `obj+0x70..0x78 = g_camera_blocks[g_camera_index] * obj+0x40..0x48`
  // (`0x00433463`..`0x004334C7`): the view-space point, which the port keeps
  // in world space (`Actor.shotCentre`). Then the registration at
  // `0x004334D0`.
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, host);

  if (s.slot === SLOT_STAGE5_CAR) {
    m = Carrier33ObjectMatrix(obj);
    MatrixTranslate(m, CAR_PART_DOOR_AT[0], CAR_PART_DOOR_AT[1],
                    CAR_PART_DOOR_AT[2]);
    MatrixRotateZ(m, 0);
    MatrixRotateY(m, 0);
    MatrixRotateX(m, CAR_PART_DOOR_PITCH);
    Carrier33DrawSlot(s, m, CAR_PART_DOOR);

    m = Carrier33ObjectMatrix(obj);
    MatrixTranslate(m, 0, CAR_PART_WHEEL_Y, CAR_PART_WHEEL_FRONT_Z);
    s.wheelTurn = (s.wheelTurn + CAR_WHEEL_TURN_STEP) | 0;
    MatrixRotateX(m, s.wheelTurn);
    Carrier33DrawSlot(s, m, CAR_PART_WHEEL);

    m = Carrier33ObjectMatrix(obj);
    MatrixTranslate(m, 0, CAR_PART_WHEEL_Y, CAR_PART_WHEEL_BACK_Z);
    MatrixRotateX(m, s.wheelTurn);
    Carrier33DrawSlot(s, m, CAR_PART_WHEEL);

    m = Carrier33ObjectMatrix(obj);
    MatrixTranslate(m, CAR_PART_SIDE_X, CAR_PART_SIDE_Y, CAR_PART_SIDE_Z);
    Carrier33DrawSlot(s, m, CAR_PART_LEFT);

    m = Carrier33ObjectMatrix(obj);
    MatrixTranslate(m, -CAR_PART_SIDE_X, CAR_PART_SIDE_Y, CAR_PART_SIDE_Z);
    Carrier33DrawSlot(s, m, CAR_PART_RIGHT);
    return;
  }

  if (obj.sub !== 1) return;
  m = Carrier33ObjectMatrix(obj);
  MatrixTranslate(m, 0, 0, LOOP_Z);
  MatrixScale(m, LOOP_SCALE[0], LOOP_SCALE[1], LOOP_SCALE[2]);
  Carrier33DrawSlot(s, m, s.loopA);
  s.loopA += 1;
  if (LOOP_A_LAST < s.loopA) s.loopA = LOOP_A_FIRST;

  m = Carrier33ObjectMatrix(obj);
  MatrixTranslate(m, 0, 0, LOOP_Z);
  MatrixScale(m, LOOP_SCALE[0], LOOP_SCALE[1], LOOP_SCALE[2]);
  Carrier33DrawSlot(s, m, s.loopB);
  s.loopB += 1;
  if (LOOP_B_LAST < s.loopB) s.loopB = LOOP_B_FIRST;
}

/**
 * [port-only] The engine chooses between the twelve sub-handlers once, in the
 * `Init`, by writing one of them to `*obj`. The port has one table entry per
 * class, so the choice is a test on the selector here — the same shape
 * `MouseUpdate` has, and for the same reason. Each arm is the pointer the
 * dispatch's jump table installs for that selector: `0x004331D0` at
 * `0x0043301A`, `0x00433A10` at `0x00433028`, `0x00433AC0` at `0x00433036`,
 * `0x00433B70` at `0x00433044`, `0x00433B00` at `0x00433052`, and the seven
 * in the switch.
 */
export function ScriptedSceneryUpdate33(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.ScriptedScenery) return;
  if (obj.hp === ScriptedScenerySelector.Carrier) {
    ScriptedCarrierUpdate33(obj, f);
    return;
  }
  if (obj.hp === ScriptedScenerySelector.DrawUntilFlag) {
    ScriptedPropDrawUntilFlag(obj);
    return;
  }
  if (obj.hp === ScriptedScenerySelector.EffectOnFirstFrame) {
    ScriptedEffectOnFirstFrame33(obj, f);
    return;
  }
  if (obj.hp === ScriptedScenerySelector.Pushable) {
    ScriptedPushableUpdate33(obj, f);
    return;
  }
  if (obj.hp === ScriptedScenerySelector.EffectAtCameraCue) {
    ScriptedEffectAtCameraCue33(obj, f);
    return;
  }
  // `0x00433E30` at `0x00433060` .. `0x00434260` at `0x004330A6`, and
  // `0x00433160` at `0x004330B3` for 99 -- `class33/cues.ts` and
  // `class33/strips.ts`.
  switch (obj.hp) {
    case ScriptedScenerySelector.SpriteEffectOnce:
      ScriptedSpriteEffectOnce33(obj, f); return;
    case ScriptedScenerySelector.SoundCues:
      ScriptedSoundCues33(obj, f); return;
    case ScriptedScenerySelector.BridgeCrashStrip:
      ScriptedBridgeCrashStrip33(obj, f); return;
    case ScriptedScenerySelector.FireLoopUntilCue:
      ScriptedFireLoopUntilCue33(obj, f); return;
    case ScriptedScenerySelector.SoundAndFlagAtCue:
      ScriptedSoundAndFlagAtCue33(obj, f); return;
    case ScriptedScenerySelector.EndingTrackSelect:
      ScriptedEndingTrackSelect33(obj, f); return;
    case ScriptedScenerySelector.StaticSlotDraw:
      ScriptedStaticSlotDraw33(obj); return;
  }
}

function ScriptedSceneryInit33(obj: Actor, _rng?: Rng): void {
  ScriptedSceneryDispatch33(obj);
}

function ScriptedSceneryDebug33(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.ScriptedScenery) return { summary: "not 0x33" };
  if (obj.hp === ScriptedScenerySelector.Pushable) {
    const t = obj.class33Push;
    const armed = !(obj.flags & SCENERY_SKIP_COLLISION);
    return {
      summary: `pushable · slot 0x${(t?.slot ?? 0).toString(16)}`
        + ` · ${armed ? "armed" : `held (flag ${t?.push_flag ?? -1})`}`,
      detail: [
        `sphere ${obj.bodyRadius} · at`
        + ` (${obj.pos.x.toFixed(2)}, ${obj.pos.y.toFixed(2)},`
        + ` ${obj.pos.z.toFixed(2)})`,
        `pushed by ${obj.pushedBy < 0 ? "nothing"
          : `0x${obj.pushedBy.toString(16).toUpperCase()}`}`
        + ` · depth ${obj.pushDepth.toFixed(2)}`
        + ` · despawn flag ${t?.despawn_flag ?? -1}`,
      ],
      hot: obj.pushedBy >= 0,
    };
  }
  if (obj.hp === ScriptedScenerySelector.EffectAtCameraCue) {
    const cue = obj.class33Cue?.cue ?? -1;
    return {
      summary: `effect at camera frame ${cue}`,
      detail: [`camera at ${G.g_cam_path_frame}`
               + ` · kind 0x44 at (${obj.pos.x.toFixed(2)},`
               + ` ${obj.pos.y.toFixed(2)}, ${obj.pos.z.toFixed(2)})`],
      hot: false,
    };
  }
  if (obj.class33Sub) {
    const s = obj.scenery;
    return {
      summary: `selector ${obj.hp} · sub ${obj.sub} · frames ${s.frames}`
        + ` · cue ${s.cue}`,
      detail: [`slot 0x${s.slot.toString(16)}`
               + ` · camera at ${G.g_cam_path_frame}`],
      hot: false,
    };
  }
  if (obj.hp === ScriptedScenerySelector.DrawUntilFlag) {
    const t = obj.class33Prop;
    return {
      summary: `drawn until flag ${t?.despawn_flag ?? -1}`
        + ` or camera frame ${t?.despawn_frame ?? -1}`,
      detail: [`slot 0x${obj.scenery.slot.toString(16)}`
               + ` · flag reads ${G.g_script_flags[t?.despawn_flag ?? 0] ?? 0}`
               + ` · camera at ${G.g_cam_path_frame}`],
      hot: false,
    };
  }
  if (obj.hp === ScriptedScenerySelector.EffectOnFirstFrame) {
    return { summary: "kind 0x62 on its first frame", hot: false };
  }
  if (obj.hp !== ScriptedScenerySelector.Carrier) {
    return { summary: `selector ${obj.hp} · unported`, hot: false };
  }
  const s = obj.scenery;
  const t = obj.class33;
  const bits = [
    obj.flags & ActorFlag.Committed ? "committed" : null,
    obj.flags & ActorFlag.Reacting ? "effect" : null,
    obj.flags & ActorFlag.FireLoop ? "fire" : null,
  ].filter(Boolean).join(" · ");
  return {
    summary: `carrier · path ${s.pathSlot} frame ${s.pathFrame.toFixed(0)}`
      + `/${s.pathEnd.toFixed(0)}${bits ? ` · ${bits}` : ""}`,
    detail: [
      `slot 0x${s.slot.toString(16)} · effect at ${t?.effect_frame ?? -1}`
      + ` · commit at ${t?.commit_frame ?? -1}`,
      `g_carrier_object ${G.g_carrier_object}`,
    ],
    hot: (obj.flags & ActorFlag.Reacting) !== 0,
  };
}

/**
 * `[port-only]` -- a replay's question, `ClassHandler.outlivedByReplay`: has
 * the replay gone past this record's own way out, so that at the landing
 * address the engine's object is gone and must not be rebuilt?
 *
 * * **Selector 2** leaves on the first frame its flag reads 1 or block 0's
 *   camera frame equals its word -- the two tests
 *   `ScriptedPropDrawUntilFlag` (`FUN_00433A10`) makes every frame. A replay
 *   raises the flag with the `set_script_flag` it steps over, and is asked
 *   straight after, so the record goes then. Without it the replay rebuilt
 *   the object at the landing, to leave on its first frame -- or not at all
 *   when the flag did not survive to that frame, which on a seek into stage
 *   2's block 9 it does not: the class-0x44 swing-then-break builder
 *   (`class44/swing_then_break.ts`) writes `g_script_flags[0] = 0` from its
 *   zero placer words on that first frame, and all five of stage 2's stood
 *   for the rest of the stage. In the engine they left on the frame block 3
 *   raised the flag, long before.
 * * **Selector 3** has no test: `ScriptedEffectOnFirstFrame33`
 *   (`FUN_00433AC0`) throws its sprite and leaves on the first frame it
 *   runs, and a replay runs none -- so every record a replay has seen is
 *   outlived. The one address this answers early is a landing between the
 *   spawn instruction and the next instruction that yields a frame, where
 *   the engine would still throw it; without the answer, every landing past
 *   it threw the sprite on the landing frame instead.
 *
 * The other selectors' exits are not answered here.
 */
function ScriptedSceneryOutlivedByReplay33(rec: ReplaySpawnRecord): boolean {
  if (rec.hp === ScriptedScenerySelector.EffectOnFirstFrame) return true;
  if (rec.hp !== ScriptedScenerySelector.DrawUntilFlag) return false;
  const t = (T.chars?.placements ?? []).find((p) => p.at === rec.at)
    ?.class33_prop;
  if (!t) return false;
  return t.despawn_frame === G.g_cam_path_frame
    || G.g_script_flags[t.despawn_flag] === 1;
}

/**
 * `[port-only]` -- `ClassHandler.followReplayCamera`, for the one selector
 * whose object outlives the camera frames it tests: 7 (`class33/cues.ts`).
 */
function ScriptedSceneryFollowReplayCamera33(
    rec: ReplaySpawnRecord, cam: ReplayCamera,
    state: Record<string, number>): void {
  if (rec.hp !== ScriptedScenerySelector.SoundCues) return;
  const t = (T.chars?.placements ?? []).find((p) => p.at === rec.at)
    ?.class33_sub;
  if (t?.selector !== 7) return;
  ScriptedSoundCues33FollowReplayCamera(t.cues, cam, state);
}

/** `[port-only]` -- `ClassHandler.resumeFromReplay`, selector 7's. */
function ScriptedSceneryResumeFromReplay33(
    obj: Actor, state: Readonly<Record<string, number>>): void {
  if (obj.cls !== SpawnClass.ScriptedScenery) return;
  if (obj.hp !== ScriptedScenerySelector.SoundCues) return;
  ScriptedSoundCues33ResumeFromReplay(obj, state);
}

export const ScriptedSceneryHandler: ClassHandler = {
  init: ScriptedSceneryInit33,
  followReplayCamera: ScriptedSceneryFollowReplayCamera33,
  resumeFromReplay: ScriptedSceneryResumeFromReplay33,
  // The class's two registrations -- the carrier's at `0x004334D0` and the
  // pushable's at `0x00433CC7`, the only calls of `RegisterForShotTest` in
  // its routines (a rel32 scan of `0x00432FF0..0x00434400`) -- are made
  // where the routines make them, so the pick is `game/`'s.
  registersForShotTest: true,
  // `MarkActorShot` and nothing else: no routine of the class reads the hit
  // bits, so a shot on it must never reach the damage tables.
  ownsShotResult: true,
  update: ScriptedSceneryUpdate33,
  // `ScriptedSceneryDispatch33` installs the selector's routine, claims
  // the hit slot and returns (`0x0043301A`..`0x004330BA`).
  firstUpdateNextWalk: true,
  debug: ScriptedSceneryDebug33,
  outlivedByReplay: ScriptedSceneryOutlivedByReplay33,
};

registerClass(SpawnClass.ScriptedScenery, ScriptedSceneryHandler);
