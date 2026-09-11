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
 * **Two of the twelve are ported.** Selector 4 is the pushable scenery in
 * `class33/pushable.ts` — stage 1's two chairs. Selector 1 is here: the object
 * stage 5 block 2's room is held by, and stage 2's two riders leave on:
 *
 * ```
 * ScriptedSceneryDispatch33   FUN_00432FF0   the switch, and g_carrier_object
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
 * the first stops. That also settles `rigs.py`'s `[likely] fire or smoke` on
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
 * ## What is not ported, by name
 *
 * * **The other nine sub-handlers.** Selector 2's ten spawns already reach the
 *   player through the bundle's `props`; the rest are unread and the bundle
 *   carries no tail for them, so they keep the nothing they had.
 * * `ActorClaimHitSlot` (`FUN_00409270`), which every arm of the dispatch
 *   ends with. `g_hit_slots` is not ported at all — `game/globals.ts` records
 *   the whole 14-slot table as absent, and one class is not the place to
 *   start it.
 * * `RegisterForShotTest` (`FUN_00405160`), at `0x004334D0` in the tail of
 *   the draw. The carrier's sphere is `tail+0x08`, which is `0.1` on stage
 *   5's and `0.0` on stage 2's two, and `tail+0x04 != -1` puts stage 2's on
 *   the **mesh** test (`obj+0x34 |= 0x50`), which the port has not got — see
 *   `game/class41/shot_test.ts`.
 * * Everything from `0x00433463` to `0x0043382F`, which is drawing: the two
 *   22-slot sprite loops at `obj+0x1354`/`+0x1358`, the 45-degree spin at
 *   `obj+0x135C`, and the five sub-models slot `0x1B0E` carries. It is in
 *   `tools/hod2lib/rigs.py` as `obj_4331d0` and the renderer already places
 *   it. **The decompiler shows none of it** — its pseudocode ends at
 *   `0x0043345E` with a `return` the code does not have, which is `L37`.
 */
import type { Rng } from "../../core/rng";
import { type Actor, ActorFlag, type ScriptedSceneryActor } from "../actor";
import { ActorDespawn } from "../despawn";
import { SpawnSpriteEffect } from "../effects/sprite";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { vec3 } from "../vec";
import { ScriptedPushableUpdate33, SCENERY_SKIP_COLLISION }
  from "./pushable";
import { ScriptedScenerySelector } from "./state";

export { ScriptedScenerySelector };
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
 * `ScriptedSceneryDispatch33` — `FUN_00432FF0`. Class 0x33's `Init`.
 *
 * The engine's switch installs one of twelve update pointers and every arm
 * then calls `ActorClaimHitSlot`. The port has one of the twelve, so this is
 * the switch with one arm and no default — an actor whose selector is not
 * {@link ScriptedScenerySelector.Carrier} keeps the nothing it had, which is
 * what {@link ScriptedSceneryUpdate33} spells out.
 *
 * `MOV [0x009a5c34], EAX` at `0x00433014` is inside the arm, so the carrier
 * publishes itself **here** as well as on every frame of its update: a state
 * that reads `g_carrier_object` on the same frame the object is made finds it.
 */
export function ScriptedSceneryDispatch33(obj: Actor): void {
  if (obj.hp !== ScriptedScenerySelector.Carrier) return;
  G.g_carrier_object = obj.at;
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
      obj.flags |= 0x50;
    }
    s.slot = t.slot;
    s.pathSlot = t.path;
    s.pathEnd = t.path_end;
    // `obj+0x1354/+0x1358/+0x135C = 0x24A/0x260/0` are the sprite cursors the
    // draw tail cycles, and the draw is `render/`'s — see the module note.
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
  obj.yaw = (p.yaw ?? 0) & 0xffff;
  // `obj+0x6C` (the roll) and `obj+0x118` (the uniform scale, 1.0 here and
  // 2.5 for the two slots below) are written by the engine and read only by
  // its own draw. The port has no field for either and the renderer takes
  // both from the exported rig, so they are left out rather than invented.

  if (s.slot === SLOT_SCALED_A) return;
  if (s.slot === SLOT_SCALED_B) {
    // **Not masked.** `MOV [ESI+0x68], ECX` at `0x004339EB` takes the *raw*
    // `ry` the routine kept in ECX before the `AND`, plus a quarter turn.
    obj.yaw = (p.yaw ?? 0) + SLOT_B_YAW_BIAS;
    return;
  }
  if (s.slot === SLOT_STAGE5_CAR) obj.pos.x = p.x - SLOT_CAR_X_BIAS;
}

/**
 * `ScriptedCarrierUpdate33` — `FUN_004331D0`. One frame of the carrier.
 *
 * Read top to bottom, because the order is the behaviour: the two cues are
 * tested against the cursor the **previous** frame's ride left, the fire's
 * early return is what stops the ride, and the despawn arm is reached only by
 * falling past both.
 *
 * [diverges] The despawn cue is `g_cam_path_frame == tail+0x1C ||
 * g_cam_path_frame_2 == tail+0x1C`, camera blocks 0 and 2. The port models one
 * camera block, so it tests the one it has — the same divergence, for the same
 * reason, as `class30/entrance.ts`'s `CamCueHit`. Of the three shipped
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
      // `obj+0x1364/+0x1368 = 0x1AAB` and `obj+0x136C = 0x1AD2`, the first and
      // last slots of the fire loop. Drawing, and `render/`'s.
      f.events?.emit("sound.play", { id: SND_FIRE });
    }
    // **The early return, and it is not a drawing detail.** Once the fire is
    // up the routine never reaches `ScriptedCarrierStepPath33` again, so the
    // cursor freezes and the object stops moving — and it never reaches the
    // despawn arm either, so it stays on the field burning.
    if (obj.flags & ActorFlag.FireLoop) return;
  }

  if (G.g_script_flags[t.despawn_flag] !== 1
      && G.g_cam_path_frame !== t.despawn_frame) {
    ScriptedCarrierStepPath33(obj, f.host, f.events);
    return;
  }

  if (obj.flags & ActorFlag.FireLoop) {
    f.events?.emit("sound.play", { id: SND_FIRE_OFF });
  }
  ActorDespawn(obj);
}

/**
 * [port-only] The engine chooses between the twelve sub-handlers once, in the
 * `Init`, by writing one of them to `*obj`. The port has one table entry per
 * class, so the choice is a test on the selector here — the same shape
 * `MouseUpdate` has, and for the same reason.
 */
export function ScriptedSceneryUpdate33(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.ScriptedScenery) return;
  if (obj.hp === ScriptedScenerySelector.Carrier) {
    ScriptedCarrierUpdate33(obj, f);
    return;
  }
  if (obj.hp === ScriptedScenerySelector.Pushable) {
    ScriptedPushableUpdate33(obj, f);
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

export const ScriptedSceneryHandler: ClassHandler = {
  init: ScriptedSceneryInit33,
  update: ScriptedSceneryUpdate33,
  debug: ScriptedSceneryDebug33,
};

registerClass(SpawnClass.ScriptedScenery, ScriptedSceneryHandler);
