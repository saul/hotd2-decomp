/**
 * Class 0x14's three deaths, `g_class14_states[18..20]`, one per ladder. The
 * reaction that saw the hit points run out has already raised the flag the
 * script waits on; what a death does is put the body where the ending needs
 * it, sink it into the water and, frames later, take it out of
 * `g_enemies_present` -- which is what `wait_enemies_present 0` at the end of
 * every boss block is waiting for.
 *
 * * **A** (phase 2, stage 2 blocks 35/39) and **B** (phase 7, blocks 37/41)
 *   teleport the body to a fixed spot, swim it along the middle route edge,
 *   drop it in (A when bone 1 reaches the surface, B when bone 2 does), then
 *   bob it on the wave field until 0x78 frames of floating are spent.
 * * **C** (phase 9, stage 5 block 3) dives and is gone 0x5A frames after the
 *   splash, with no surface ride.
 *
 * All `[proved]` from the decompilation, and DeathA's splash from the
 * instruction stream past its `MatrixStackPop` (L35): the second strip is the
 * same point with the yaw word zeroed, kind 2 at 3.0.
 *
 * `FUN_0041D650(0x2B)` / `FUN_0041D690(0x2B)` load and free pol 43
 * (`eff_2.bin`) around the splash; the port's bundle carries the strips'
 * slots already, so both are asset jobs with nothing to do here.
 */
import { ActorFlag, type Boss2Actor } from "../actor";
import { ActorTurnTowardXZ } from "../actor_turn";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { WaterFieldSampleHeight } from "../class16";
import { PropStripKind, SpawnPropStripEffect } from "../effects/prop_strip";
import { G } from "../globals";
import { MatrixGetTranslation } from "../matrix";
import type { ClassFrame } from "../registry";
import { ActorShiftToHoldBone1Position } from "../skeleton";
import { vec3, type Vec3 } from "../vec";
import { OBJ_BIT_80000, Class14Flag, type Boss2Tail } from "./state";
import { Class14FollowSegment } from "./steer";
import {
  Class14BlendAnim, Class14CameraBlockYaw, Class14ClipLength, Class14Cursor,
  Class14Sound as Sound,
} from "./motion";
import { CLASS14_TURN_STEP, Class14Sound } from "./tables";

/** Where each death puts the body (`MOV dword` immediates) and its facing. */
const DEATH_A_POS: Vec3 = { x: Math.fround(-1338.2), y: -23,
                            z: Math.fround(-1931.1) };
const DEATH_B_POS: Vec3 = { x: Math.fround(227.3), y: 23,
                            z: Math.fround(-2121.9) };
const DEATH_C_POS: Vec3 = { x: Math.fround(583.2), y: Math.fround(-71.3),
                            z: Math.fround(-4979.7) };
const DEATH_YAW = 0x8000;
/** The floating the body does before it leaves the count: 0x78 frames. */
const FLOAT_FRAMES = 0x78;
/** `target - dir * 50`. */
const SWIM_BACK = 50;
/** The motions: 0x3A the death, 0x1B the sink, 0x2C the float. */
const MOTION_DIE = 0x3a;
const MOTION_SINK = 0x1b;
const MOTION_FLOAT = 0x2c;
/** The float's drift and its rise: `-0.03, -0.005`, `0.0006805556`. */
const DRIFT_X = Math.fround(-0.03);
const DRIFT_Z = Math.fround(-0.005);
const FLOAT_RISE = Math.fround(0.0006805556);
const FLOAT_YAW = 0x4000;
/** The bob: a 0x200 phase step, damped 0.8 a half-cycle, slowed by 0x40. */
const BOB_RATE = 0x200;
const BOB_DAMP = Math.fround(0.8);
const BOB_MIN_RATE = 0x80;
const BOB_RATE_STEP = 0x40;
const BOB_STOP = Math.fround(0.3);
/** DeathB/C's dive: `0.7` along the yaw, `-1.0` down, `-0.08166666` gravity. */
const DIVE_SPEED = Math.fround(0.7);
const DIVE_GRAVITY = Math.fround(-0.08166666);
/** DeathB's entry into the water: half the speed, `0.013611111` up. */
const ENTRY_DAMP = 0.5;
const ENTRY_RISE = Math.fround(0.013611111);
/** DeathC's two waits: the dive, then the body gone. */
const DIVE_FRAMES_C = 0x1e;
const GONE_FRAMES_C = 0x5a;
/** The cues. */
const CUE_80000 = 0xf;
const CUE_DIVE = 0x2d;
/** The splash strips' scales. */
const SPLASH_LARGE = 8;
const SPLASH_SMALL = 3;

/** A bone's world point: `cam * R(bone)+0x28`'s translation. */
function BoneWorld(obj: Boss2Actor, bone: number): Vec3 {
  const out = vec3();
  const m = obj.skel?.bones[bone]?.mat;
  if (m) MatrixGetTranslation(m, out);
  return out;
}

/**
 * Sub 0's common lines: the body where the ending wants it, the route
 * steering off, `+0x9C`, the float's pol loaded. `[port-only]` as a function.
 */
function Class14DeathPlace(obj: Boss2Actor, t: Boss2Tail, p: Vec3): void {
  t.flags |= Class14Flag.OffRoute;
  obj.pos.x = p.x;
  obj.pos.y = p.y;
  obj.pos.z = p.z;
  obj.pitch = 0;
  obj.yaw = DEATH_YAW;
  obj.roll = 0;
}

/**
 * Sub 1, the three deaths' swim along the middle route edge: past it, the
 * sink motion and ZOMBIE_032; not yet, turn toward `target - dir * 50`.
 * `[port-only]` as a function. Returns whether the sub advanced.
 */
function Class14DeathSwim(obj: Boss2Actor, t: Boss2Tail, f: ClassFrame,
                          sink: () => void): boolean {
  if (!Class14FollowSegment(obj.pos, t.route[1], t.route[2], 10)) {
    sink();
    Sound(f.events, Class14Sound.Sink);
    t.sub += 1;
    return true;
  }
  ActorTurnTowardXZ(obj,
    Math.fround((t.target.x - t.dir.x * SWIM_BACK) - obj.pos.x),
    Math.fround((t.target.z - t.dir.z * SWIM_BACK) - obj.pos.z),
    CLASS14_TURN_STEP);
  return false;
}

/**
 * A and B's float, their last three subs (A's 4..6, B's 5..7). `[port-only]`
 * as a function; the engine has it twice.
 *
 * ```
 * rise: x += vel.x; z += vel.z; vel.y += g; y += vel.y
 *       on the surface: bob phase 0, rate 0x200; vel.y /= sin(0x200);
 *       freeze the pose; next
 * bob:  x, z drift; phase += rate; a half-cycle crossed: vel.y *= 0.8,
 *       rate -= 0x40 while above 0x80, and below 0.3 stop the bob: next
 *       y = surface + sin(phase) * vel.y;  +0x9C--
 * ride: x, z drift; y = surface; +0x9C--
 * ```
 */
function Class14DeathFloat(obj: Boss2Actor, t: Boss2Tail, step: number): void {
  if (step === 0) {
    obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
    obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
    obj.vel.y = Math.fround(obj.accY + obj.vel.y);
    obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
    if (WaterFieldSampleHeight(obj.pos) <= obj.pos.y) {
      t.bobPhase = 0;
      t.bobRate = BOB_RATE;
      obj.vel.y = Math.fround(obj.vel.y
                              / Math.sin(t.bobRate * BAMS_TO_RAD_F64));
      obj.flags |= ActorFlag.PoseFrozen;
      t.sub += 1;
    }
    return;
  }
  obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
  obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
  if (step === 1) {
    const old = t.bobPhase;
    t.bobPhase = (t.bobRate + old) | 0;
    if ((t.bobPhase ^ old) & 0x8000) {
      obj.vel.y = Math.fround(obj.vel.y * BOB_DAMP);
      if (t.bobRate > BOB_MIN_RATE) t.bobRate -= BOB_RATE_STEP;
      if (obj.vel.y < BOB_STOP) {
        t.bobPhase = 0;
        t.sub += 1;
      }
    }
    const h = WaterFieldSampleHeight(obj.pos);
    obj.pos.y = Math.fround(
      Math.sin(t.bobPhase * BAMS_TO_RAD_F64) * obj.vel.y + h);
  } else {
    obj.pos.y = Math.fround(WaterFieldSampleHeight(obj.pos));
  }
  t.counter0 -= 1;
}

/** `+0x9C == 0`: off the camera, out of the present count, pol 43 freed. */
function Class14DeathGone(obj: Boss2Actor, t: Boss2Tail): void {
  if (t.counter0 !== 0) return;
  obj.flags |= ActorFlag.NoCameraTrack;
  G.g_enemies_present -= 1;
}

/**
 * The float's start, A's sub 3 and B's sub 4 at the end of the sink motion:
 *
 * ```
 * anim 0x12; char+0x20 = 0x2C; char+0x08 = 0; ActorShiftToHoldBone1Position(obj)
 * blend(0x2C, 0, 10); vel = (-0.03, 0, -0.005); g = 0.0006805556; yaw = 0x4000
 * ```
 *
 * `[port-only]` as a function.
 */
function Class14DeathSurface(obj: Boss2Actor, t: Boss2Tail): void {
  t.animSlot = 0x12;
  if (obj.skel) {
    obj.skel.motion = MOTION_FLOAT;
    obj.skel.cursor = 0;
  }
  ActorShiftToHoldBone1Position(obj);
  ActorSetMotionBlended(obj, MOTION_FLOAT, 0, 10);
  obj.vel.x = DRIFT_X;
  obj.vel.z = DRIFT_Z;
  obj.vel.y = 0;
  obj.accY = FLOAT_RISE;
  obj.yaw = FLOAT_YAW;
  t.sub += 1;
}

/**
 * `Class14StateDeathA` — `FUN_0047BAD0`. `g_class14_states[18]`.
 *
 * ```
 * sub 0: anim 0x1C (blend); flags |= 1; the body to (-1338.2, -23, -1931.1),
 *        facing 0x8000; +0x9C = 0x78; load pol 43; g_boss_engaged = 0; sub++ (into 1)
 * sub 1: the swim; past the edge: anim 6 (blend), ZOMBIE_032, sub++
 * sub 2: cursor 0xF: obj+0x34 |= 0x80000
 *        bone 1 at or under the surface: obj+0x34 |= 0x20000; flags |= 2;
 *        the four foot contacts 0; a splash strip at bone 1 (kind 0, 3.0,
 *        facing the camera block) and one more (kind 2, 3.0, yaw 0); sub++
 * sub 3: cursor == len: the float's start
 * subs 4..6: the float
 * every frame: +0x9C == 0: off the camera, g_enemies_present--, pol 43 freed
 * ```
 */
export function Class14StateDeathA(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
    case 1:
      if (t.sub === 0) {
        Class14BlendAnim(obj, t, 0x1c);
        Class14DeathPlace(obj, t, DEATH_A_POS);
        t.counter0 = FLOAT_FRAMES;
        G.g_boss_engaged = 0;
        t.sub += 1;
      }
      Class14DeathSwim(obj, t, f, () => Class14BlendAnim(obj, t, 6));
      break;
    case 2: {
      if (Class14Cursor(obj) === CUE_80000) obj.flags |= OBJ_BIT_80000;
      const B1 = BoneWorld(obj, 1);
      if (!(WaterFieldSampleHeight(B1) < B1.y)) {
        obj.flags |= ActorFlag.Airborne;
        t.flags |= Class14Flag.FeetOff;
        for (const c of G.g_class14_foot_contacts) c.strength = 0;
        SpawnPropStripEffect({ pos: B1, pitch: 0,
                               yaw: Class14CameraBlockYaw(), roll: 0 },
                             PropStripKind.Kind0, SPLASH_SMALL, f.events);
        SpawnPropStripEffect({ pos: vec3(B1.x, B1.y, B1.z), pitch: 0, yaw: 0,
                               roll: 0 },
                             PropStripKind.Kind2, SPLASH_SMALL, f.events);
        t.sub += 1;
      }
      break;
    }
    case 3:
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        Class14DeathSurface(obj, t);
      }
      break;
    case 4:
    case 5:
    case 6:
      Class14DeathFloat(obj, t, t.sub - 4);
      break;
    default:
      break;
  }
  Class14DeathGone(obj, t);
}

/**
 * `Class14StateDeathB` — `FUN_0047BFE0`. `g_class14_states[19]`, off the
 * pier.
 *
 * ```
 * sub 0: blend(0x3A, 0, 0); flags |= 1; the body to (227.3, 23, -2121.9),
 *        facing 0x8000, still; +0x9C = 0x78; load pol 43; ZOMBIE_036;
 *        g_boss_engaged = 0; sub++                                  (into 1)
 * sub 1: the swim; past the edge: blend(0x1B, 0, 5), ZOMBIE_032, sub++
 * sub 2: cursor 0x2D: freeze; vel = (sin(yaw) 0.7, -1.0, cos(yaw) 0.7);
 *        g = -0.08166666; sub++  / cursor 0xF: obj+0x34 |= 0x80000
 * sub 3: pos += vel; vel.y += g
 *        bone 2 at or under the surface: splash strips at bone 2 (kind 0,
 *        8.0, facing the camera block; kind 2, 3.0, yaw 0); vel *= 0.5;
 *        g = 0.013611111; unfreeze; sub++
 * sub 4: pos += vel; vel.y += g; cursor == len: the float's start
 * subs 5..7: the float
 * every frame: +0x9C == 0: off the camera, g_enemies_present--, pol 43 freed
 * ```
 *
 * No `0x20000` here, so the y-follow keeps pulling the body toward the
 * ground under its feet the whole way down -- the engine's.
 */
export function Class14StateDeathB(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
    case 1:
      if (t.sub === 0) {
        ActorSetMotionBlended(obj, MOTION_DIE, 0, 0);
        Class14DeathPlace(obj, t, DEATH_B_POS);
        obj.accY = 0;
        obj.vel.z = 0;
        obj.vel.y = 0;
        obj.vel.x = 0;
        t.counter0 = FLOAT_FRAMES;
        Sound(f.events, Class14Sound.DeathCry);
        G.g_boss_engaged = 0;
        t.sub += 1;
      }
      Class14DeathSwim(obj, t, f,
        () => ActorSetMotionBlended(obj, MOTION_SINK, 0, 5));
      break;
    case 2:
      Class14DeathDive(obj, t, false);
      break;
    case 3: {
      Class14DeathIntegrate(obj);
      const h = WaterFieldSampleHeight(obj.pos);
      const B2 = BoneWorld(obj, 2);
      if (B2.y <= Math.fround(h)) {
        SpawnPropStripEffect({ pos: B2, pitch: 0,
                               yaw: Class14CameraBlockYaw(), roll: 0 },
                             PropStripKind.Kind0, SPLASH_LARGE, f.events);
        SpawnPropStripEffect({ pos: vec3(B2.x, B2.y, B2.z), pitch: 0, yaw: 0,
                               roll: 0 },
                             PropStripKind.Kind2, SPLASH_SMALL, f.events);
        obj.vel.x = Math.fround(obj.vel.x * ENTRY_DAMP);
        obj.vel.y = Math.fround(obj.vel.y * ENTRY_DAMP);
        obj.vel.z = Math.fround(obj.vel.z * ENTRY_DAMP);
        obj.accY = ENTRY_RISE;
        obj.flags &= ~ActorFlag.PoseFrozen;
        t.sub += 1;
      }
      // `MatrixStackPop(1); return;` -- sub 3 skips the tail's count test.
      return;
    }
    case 4:
      Class14DeathIntegrate(obj);
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        Class14DeathSurface(obj, t);
      }
      break;
    case 5:
    case 6:
    case 7:
      Class14DeathFloat(obj, t, t.sub - 5);
      break;
    default:
      break;
  }
  Class14DeathGone(obj, t);
}

/** `pos += vel; vel.y += g`, in DeathB/C's order: x, y, z, then vel.y. */
function Class14DeathIntegrate(obj: Boss2Actor): void {
  obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
  obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
  obj.vel.y = Math.fround(obj.accY + obj.vel.y);
}

/**
 * B's and C's sub 2: the dive on cursor 0x2D, `0x80000` on 0xF. C also
 * starts its thirty-frame count. `[port-only]` as a function.
 */
function Class14DeathDive(obj: Boss2Actor, t: Boss2Tail, c: boolean): void {
  const cur = Class14Cursor(obj);
  if (cur === CUE_DIVE) {
    obj.flags |= ActorFlag.PoseFrozen;
    const a = obj.yaw * BAMS_TO_RAD_F64;
    obj.vel.x = Math.fround(Math.sin(a) * DIVE_SPEED);
    obj.vel.y = -1;
    obj.vel.z = Math.fround(Math.cos(a) * DIVE_SPEED);
    obj.accY = DIVE_GRAVITY;
    if (c) t.counter0 = DIVE_FRAMES_C;
    t.sub += 1;
  } else if (cur === CUE_80000) {
    obj.flags |= OBJ_BIT_80000;
  }
}

/**
 * `Class14StateDeathC` — `FUN_0047C5F0`. `g_class14_states[20]`, stage 5.
 *
 * ```
 * sub 0: blend(0x3A, 0, 0); obj+0x34 |= 0x10000; flags |= 1; the body to
 *        (583.2, -71.3, -4979.7), facing 0x8000, still; load pol 43;
 *        ZOMBIE_036; sub++                                          (into 1)
 * sub 1: the swim; past the edge: blend(0x1B, 0, 5), ZOMBIE_032, sub++
 * sub 2: cursor 0x2D: the dive and +0x9C = 0x1E / 0xF: |= 0x80000
 * sub 3: pos += vel; vel.y += g; +0x9C-- == 0: a splash strip at bone 2
 *        (kind 0, 8.0, facing the camera block); +0x9C = 0x5A; sub++
 * sub 4: +0x9C-- == 0: g_enemies_present--; pol 43 freed
 * ```
 *
 * No surface ride, no `g_boss_engaged` write, and sub 4 does not integrate:
 * the body is off the camera from sub 0 and simply stops.
 */
export function Class14StateDeathC(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
    case 1:
      if (t.sub === 0) {
        ActorSetMotionBlended(obj, MOTION_DIE, 0, 0);
        obj.flags |= ActorFlag.NoCameraTrack;
        Class14DeathPlace(obj, t, DEATH_C_POS);
        obj.accY = 0;
        obj.vel.z = 0;
        obj.vel.y = 0;
        obj.vel.x = 0;
        Sound(f.events, Class14Sound.DeathCry);
        t.sub += 1;
      }
      Class14DeathSwim(obj, t, f,
        () => ActorSetMotionBlended(obj, MOTION_SINK, 0, 5));
      return;
    case 2:
      Class14DeathDive(obj, t, true);
      return;
    case 3:
      Class14DeathIntegrate(obj);
      t.counter0 -= 1;
      if (t.counter0 === 0) {
        const B2 = BoneWorld(obj, 2);
        SpawnPropStripEffect({ pos: B2, pitch: 0,
                               yaw: Class14CameraBlockYaw(), roll: 0 },
                             PropStripKind.Kind0, SPLASH_LARGE, f.events);
        t.counter0 = GONE_FRAMES_C;
        t.sub += 1;
      }
      return;
    case 4:
      t.counter0 -= 1;
      if (t.counter0 === 0) G.g_enemies_present -= 1;
      return;
    default:
      return;
  }
}
