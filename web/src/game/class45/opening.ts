/**
 * Class 0x45's opening vignette and its civilians: sub-types 0, 1 and 3.
 *
 * Sub-type 0 is a `boss3.bin` head that takes the first civilian (sub-type
 * 1, `hito_oyaji.bin`) as she walks up the canal; sub-type 3 is the two
 * civilians held in the mouths of heads 0 and 4, whose release
 * `Boss3FightHeadIntroGrab` drives. Stage 3 blocks 11 and 13 only -- their
 * Boss-Mode replays open on the fight.
 */
import type { Boss3Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";
import { ActorClaimHitSlot } from "../hit_slots";
import { ActorDespawn } from "../despawn";
import {
  MatIdentity, MatrixGetTranslation, MatrixRotateY, MatrixTransformPoint,
  MatrixTranslate,
} from "../matrix";
import { MotionFlag } from "../actor";
import { vec3 } from "../vec";
import {
  Boss3BystanderState, Boss3PoseHook, Boss3Routine, Boss3Variant,
} from "./state";
import {
  Boss3DrawModel, Boss3ModelStep, Boss3SetMotion, Boss3SetMotionBlended,
} from "./model";
import { PoseHookNone } from "./pose";
import { Boss3PlayStageSound, PlaySoundId } from "./rand";

/** The opening head's clips: `0x5A` in block 11, `0x5B` otherwise. */
const CLIP_OPENING_A = 0x5a;
const CLIP_OPENING_B = 0x5b;
/** `obj+0x1340 = 15.0` (`0x41700000`), shrinking by `[0x0055CB40]` 0.95. */
const OPENING_OFFSET = 15;
const OPENING_SHRINK = Math.fround(0.95);
/** The head's seat on the civilian: `RotY(0x6400) (0, 3.0, 55.5)` and yaw `0x5400`. */
const SEAT_YAW = 0x6400;
const SEAT_X = 0, SEAT_Y = 3, SEAT_Z = 55.5;
const CARRY_YAW = 0x5400;
/** Carried away: `sin/cos(2.0617) * 3.0` (the BAMS `0x5400`), less 2.0 on z. */
const CARRY_ANGLE = 2.061670178918302;
const CARRY_STEP = 3;
const CARRY_DROP_Z = 2;
/** Variant 1 carries off along -x by `[0x004C49C0]` 3.0. */
const CARRY_STEP_B = 3;
/** The carry lasts until `obj+0x1330 > 0x27`. */
const CARRY_FRAMES = 0x27;
/** The civilian's clips: the walk `0x23D`, taken `0x24F` or `0x264` at 0x11. */
const CLIP_WALK = 0x23d;
const CLIP_TAKEN_A = 0x24f;
const CLIP_TAKEN_B = 0x264;
const TAKEN_B_FRAME = 0x11;
/** The walk: `0x6D` frames turning `0x75` a frame (variant 0), `0x46` (variant 1). */
const WALK_FRAMES_A = 0x6d;
const WALK_TURN = 0x75;
const WALK_FRAMES_B = 0x46;
/** Stopped: taken on frame `0x36` (variant 0) or `0x1D` (variant 1). */
const STOP_FRAMES_A = 0x36;
const STOP_FRAMES_B = 0x1d;
/** `COM\214_OM_B1` -- her cry. */
const SOUND_TAKEN = 0x20000015;
/** The held civilians: clip `0x21E`, 0x1E frames in for the second. */
const CLIP_HELD = 0x21e;
const HELD_START_1 = 0x1e;
/** The held civilians' seats, straight (variant 0) or turned by `RotY(0x1200)`. */
const HELD_TURN = 0x1200;
const HELD_SEAT_0 = [Math.fround(-2.2), 1.8, 4.3];
const HELD_SEAT_0_TURNED = [Math.fround(-2.2), Math.fround(1.8), Math.fround(4.3)];
const HELD_SEAT_1 = [Math.fround(0.3), Math.fround(2.2), Math.fround(4.4)];
/** A let-go civilian falls: `vx += 0.005`, `vy -= 0.02722`, `vz -= 0.05`, for 240 frames. */
const FALL_VX = Math.fround(0.005);
const FALL_VY = Math.fround(0.02722);
const FALL_VZ = Math.fround(0.05);
const FALL_FRAMES = 0xf0;
/** The civilian's shadow disc sits `[0x004C4D10]` 0.3 above her. */

/** The opening civilian, `g_boss3_bystanders[0]`. */
function OpeningBystander(): Boss3Actor | null {
  const a = ActorByAt(G.g_boss3_bystanders[0] ?? -1);
  return a && a.cls === 0x45 ? a as Boss3Actor : null;
}

/**
 * `Boss3OpeningHeadInit` — `FUN_0041FDB0`. `boss3.bin` on `0x5A` in block 11
 * and `0x5B` otherwise, `obj+0x34 |= 0x88000`, frame 0, and `obj+0x1340 =
 * 15.0`. Takes `g_boss3_heads[0]`.
 */
export function Boss3OpeningHeadInit(obj: Boss3Actor): void {
  const t = obj.boss3;
  G.g_boss3_heads[0] = obj.at;
  Boss3SetMotion(obj, G.g_evt_block_index === 0xb
    ? CLIP_OPENING_A : CLIP_OPENING_B);
  ActorClaimHitSlot(obj);
  // `ActorBuildSkinnedModel` leaves its own draw hook, and this Init keeps it.
  t.poseHook = Boss3PoseHook.Default;
  obj.flags |= 0x88000;
  t.modelFrame = 0;
  t.blend = OPENING_OFFSET;
  t.routine = Boss3Routine.OpeningHeadUpdate;
}

/**
 * `Boss3OpeningHeadUpdate` — `FUN_00423050`. Draws, then follows the opening
 * civilian: while she is being taken (her state 2) it stands over her at
 * `RotY(0x6400) (0, 3, 55.5)` plus a shrinking offset (variant 0) and steps
 * its clip; once she is carried (3) both go off together and the head dies
 * after `0x28` frames. It steps its clip in her state 2 and no other.
 */
export function Boss3OpeningHeadUpdate(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  void f;
  G.g_boss3_heads[0] = obj.at;
  Boss3DrawModel(obj);
  const bys = OpeningBystander();
  if (!bys) return;
  if (bys.state === Boss3BystanderState.Released) {
    if (G.g_boss3_variant === Boss3Variant.Stage3A) {
      const m = MatIdentity();
      MatrixRotateY(m, SEAT_YAW);
      const p = vec3();
      MatrixTransformPoint(m, vec3(SEAT_X, SEAT_Y, SEAT_Z), p);
      t.blend = Math.fround(t.blend * OPENING_SHRINK);
      const bp = G.g_boss3_opening_bystander_pos;
      obj.pos.x = Math.fround(p.x + t.blend + bp.x);
      obj.pos.y = Math.fround(p.y + bp.y);
      obj.pos.z = Math.fround(p.z + bp.z);
      obj.yaw = CARRY_YAW;
    }
    Boss3ModelStep(obj);
    return;
  }
  if (bys.state !== Boss3BystanderState.Carried) return;
  Boss3CarryStep(obj);
  const n = t.counter;
  t.counter = n + 1;
  if (n > CARRY_FRAMES) ActorDespawn(obj);
}

/** The carry's step, shared by the head and the civilian (`0x004230A4`, `0x0042073B`). */
function Boss3CarryStep(obj: Boss3Actor): void {
  if (G.g_boss3_variant === Boss3Variant.Stage3A) {
    obj.pos.x = Math.fround(Math.sin(CARRY_ANGLE) * CARRY_STEP + obj.pos.x);
    obj.pos.z = Math.fround(Math.cos(CARRY_ANGLE) * CARRY_STEP
                            - CARRY_DROP_Z + obj.pos.z);
  } else {
    obj.pos.x = Math.fround(obj.pos.x - CARRY_STEP_B);
  }
}

/**
 * `Boss3OpeningBystanderInit` — `FUN_004200F0`. The walk clip, `model+0x64
 * |= 4`, `obj+0x34 |= 0x8000`, frame 0, the civilians' draw hook, and her
 * position and yaw into the class's globals. Takes `g_boss3_bystanders[0]`.
 */
export function Boss3OpeningBystanderInit(obj: Boss3Actor): void {
  const t = obj.boss3;
  G.g_boss3_bystanders[0] = obj.at;
  Boss3SetMotion(obj, CLIP_WALK);
  ActorClaimHitSlot(obj);
  obj.motionFlags |= 4;
  obj.flags |= ActorFlag.NoShotTest;
  t.modelFrame = 0;
  t.poseHook = Boss3PoseHook.Bystander;
  const bp = G.g_boss3_opening_bystander_pos;
  bp.x = obj.pos.x; bp.y = obj.pos.y; bp.z = obj.pos.z;
  G.g_boss3_opening_bystander_yaw = obj.yaw;
  t.routine = Boss3Routine.OpeningBystanderUpdate;
}

/**
 * `Boss3OpeningBystanderUpdate` — `FUN_00420550`. Drawn once she has left
 * state 0, and her shadow disc always (`render/`'s). **0** waits on
 * `g_script_flags[3]`; **1** walks -- turning, on variant 0 -- for `0x6D`
 * or `0x46` frames and cues the head; **2** stops, and on frame `0x36`
 * (`0x1D`) is taken: the taken clip, her cry, state 3; **3** is carried off
 * and dies after `0x28` frames. Every frame she survives publishes her
 * position.
 */
export function Boss3OpeningBystanderUpdate(obj: Boss3Actor,
                                            f: ClassFrame): void {
  const t = obj.boss3;
  G.g_boss3_bystanders[0] = obj.at;
  if (obj.state > 0) Boss3DrawModel(obj);
  // `MatrixTranslate(x, y + 0.3, z); MatrixScale(10, 1, 10); NoOpStub(10.0);
  // AssetDrawSlot(0x10D0)` -- her shadow disc, in every state.
  t.shadow = true;
  const variant = G.g_boss3_variant;
  switch (obj.state) {
    case Boss3BystanderState.Standing:
      if (G.g_script_flags[3] === 1) obj.state = Boss3BystanderState.Moving;
      t.counter = 0;
      break;
    case Boss3BystanderState.Moving: {
      Boss3ModelStep(obj);
      const n = t.counter;
      t.counter = n + 1;
      if (variant === Boss3Variant.Stage3A) {
        if (n >= WALK_FRAMES_A) {
          Boss3PlayStageSound(4, f.events);
          obj.state = Boss3BystanderState.Released;
          t.counter = 0;
        }
        obj.yaw += WALK_TURN;
      } else if (n >= WALK_FRAMES_B) {
        Boss3PlayStageSound(4, f.events);
        obj.state = Boss3BystanderState.Released;
        t.counter = 0;
      }
      break;
    }
    case Boss3BystanderState.Released: {
      Boss3ModelStep(obj);
      const n = t.counter;
      t.counter = n + 1;
      if (variant === Boss3Variant.Stage3A) {
        if (n === STOP_FRAMES_A) {
          Boss3SetMotion(obj, CLIP_TAKEN_A);
          obj.state = Boss3BystanderState.Carried;
          obj.yaw = CARRY_YAW;
          PlaySoundId(SOUND_TAKEN, f.events);
          PoseHookNone(4, 0x14);
          t.counter = 0;
        }
      } else if (n === STOP_FRAMES_B) {
        Boss3SetMotionBlended(obj, CLIP_TAKEN_B, TAKEN_B_FRAME, 8);
        obj.state = Boss3BystanderState.Carried;
        PlaySoundId(SOUND_TAKEN, f.events);
        PoseHookNone(4, 0x14);
        t.counter = 0;
      }
      break;
    }
    case Boss3BystanderState.Carried: {
      Boss3CarryStep(obj);
      const n = t.counter;
      t.counter = n + 1;
      if (n > CARRY_FRAMES) {
        ActorDespawn(obj);
        return;
      }
      break;
    }
    default:
      break;
  }
  const bp = G.g_boss3_opening_bystander_pos;
  bp.x = obj.pos.x; bp.y = obj.pos.y; bp.z = obj.pos.z;
}

/**
 * `Boss3HeldBystanderInit` — `FUN_00420180`. `desc+0x22` is the civilian's
 * index (0 or 1) and is overwritten with 1; the held clip, root motion off
 * (`model+0x64 &= ~2`), `obj+0x34 |= 0x88000`, and her seat in the head's
 * mouth: added straight on variant 0 and turned `RotY(0x1200)` otherwise.
 * The second starts `0x1E` frames into her clip.
 */
export function Boss3HeldBystanderInit(obj: Boss3Actor): void {
  const t = obj.boss3;
  const idx = (obj.hp << 16) >> 16;
  if (idx >= 0 && idx < G.g_boss3_bystanders.length) {
    G.g_boss3_bystanders[idx] = obj.at;
  }
  t.index = (idx << 24) >> 24;
  obj.hp = 1;
  Boss3SetMotion(obj, CLIP_HELD);
  ActorClaimHitSlot(obj);
  t.poseHook = Boss3PoseHook.Bystander;
  obj.motionFlags &= ~MotionFlag.RootMotion;
  obj.flags |= 0x88000;
  const seat = t.index === 0 ? HELD_SEAT_0 : HELD_SEAT_1;
  if (G.g_boss3_variant === Boss3Variant.Stage3A) {
    // `FSUB float [0x0055CAF0]` / `FADD double [0x0055CAE8]` /
    // `FADD double [0x0055CAE0]` for the first; floats for the second.
    obj.pos.x = Math.fround(obj.pos.x + seat[0]);
    obj.pos.y = Math.fround(obj.pos.y + seat[1]);
    obj.pos.z = Math.fround(obj.pos.z + seat[2]);
  } else {
    const turned = t.index === 0 ? HELD_SEAT_0_TURNED : HELD_SEAT_1;
    const m = MatIdentity();
    MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
    MatrixRotateY(m, HELD_TURN);
    MatrixTranslate(m, turned[0], turned[1], turned[2]);
    const p = vec3();
    MatrixGetTranslation(m, p);
    obj.pos.x = Math.fround(p.x);
    obj.pos.y = Math.fround(p.y);
    obj.pos.z = Math.fround(p.z);
  }
  if (t.index !== 0) t.modelFrame = HELD_START_1;
  t.routine = Boss3Routine.HeldBystanderUpdate;
}

/**
 * `Boss3HeldBystanderUpdate` — `FUN_00420820`. Draws; in states 0 and 1 steps
 * her clip; once let go (2) falls under her own velocity for 240 frames and
 * dies -- the z velocity decremented and never applied, as the engine has it.
 * Her head moves her between the states (`Boss3FightHeadIntroGrab`).
 */
export function Boss3HeldBystanderUpdate(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  void f;
  if (t.index >= 0 && t.index < G.g_boss3_bystanders.length) {
    G.g_boss3_bystanders[t.index] = obj.at;
  }
  Boss3DrawModel(obj);
  const s = obj.state;
  if (s < 0) return;
  if (s <= Boss3BystanderState.Moving) {
    Boss3ModelStep(obj);
    return;
  }
  if (s !== Boss3BystanderState.Released) return;
  t.counter += 1;
  if (t.counter > FALL_FRAMES) {
    ActorDespawn(obj);
    return;
  }
  const vx = obj.vel.x + FALL_VX;
  const vy = obj.vel.y - FALL_VY;
  obj.vel.x = Math.fround(vx);
  obj.vel.y = Math.fround(vy);
  obj.vel.z = Math.fround(obj.vel.z - FALL_VZ);
  obj.pos.x = Math.fround(vx + obj.pos.x);
  obj.pos.y = Math.fround(vy + obj.pos.y);
}
