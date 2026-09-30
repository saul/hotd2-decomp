/**
 * Class 0x32's way out: states 2, 3 and 4.
 *
 * `Class32OnShot` enters state 2 on the frame the hit points run out. The
 * boss hangs where it was hit while the music stops and the bars close,
 * plays its death clip and loops its tail while bursts go off on random
 * bones; state 3 gives both enemy counters back, frees the camera and puts
 * the body at a fixed point, and state 4 rides object path `0x181` with the
 * outro camera, bursts it into the exit effect at the camera's frame 170,
 * and 299 frames on raises `g_script_flags[30]` -- the flag
 * stage 5's `wait_script_flag 30` waits on -- and despawns.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Boss5Actor } from "../actor";
import { ActorFlag } from "../actor";
import { BossModeRecordGrade } from "../boss_mode";
import { CameraSlotVacate } from "../camera/slots";
import { PropEvalObjectPath6 } from "../class41/object_path";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { Vec3Normalize } from "../matrix";
import { MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import { Class32ReleaseAttackPermit, Class32StopMoving } from "./common";
import { Class32Attack, Class32Flag2, Class32State } from "./state";
import { Class32TailOf } from "./tables";
import { Class32SpawnDeathBurst, Class32SpawnExitEffect } from "./tasks";

/** `PlaySoundId(0xC23A9)` -- the scream both death states play. */
const SND_DEATH = 0xc23a9;
/** `PlaySoundId(0x80000000)` -- the music stops. */
const SND_STOP_BGM = 0x80000000;
/** `PlaySoundId(0x1023A9)` -- at cursor 0x1E of the death clip. */
const SND_DEATH_FALL = 0x1023a9;
/** `obj+0x1330 = 0x3C` -- the hang before the death clip. */
const DEATH_HANG = 0x3c;
/** `g_bHudShutterState = 3` -- close over forty frames, firing off. */
const SHUTTER_CLOSE = 3;
/** The death clip, `ActorSetMotionBlended(0x8F, 0, 4)`; its loop restarts at `0x1E` with fade 1. */
const CLIP_DEATH = 0x8f;
const DEATH_LOOP_FROM = 0x1e;
const DEATH_FADE = 4;
const DEATH_LOOP_FADE = 1;
/** `CMP [obj+0x19C], 0x1E; JLE` -- the fall's sound past cursor 30. */
const DEATH_FALL_CURSOR = 0x1e;

/** `ActorSetMotionBlended(0x8E, 0, 4)` -- the hover state 3 settles into. */
const CLIP_HOVER = 0x8e;
/** `obj+0x40..0x48 = 0x44110000, 0xC20C0000, 0xC60A036C`. */
const RETIRE_POINT = { x: 580.0, y: -35.0, z: f32(0xc60a036c) };

/** Object path `0x181` -- `PUSH 0x181`, the exit's rise. */
const EXIT_PATH = 0x181;
/** `CMP [g_cam_path_frame], 0xAA` -- the exit effect's frame. */
const EXIT_EFFECT_FRAME = 0xaa;
/** `obj+0x1330 = 0x78`, then `0xB4` -- the two counts to the flag. */
const EXIT_WAIT_A = 0x78;
const EXIT_WAIT_B = 0xb4;
/** `MOV byte ptr [0x009C7218], 1` and `[0x009C721E], 1`. */
export const CLASS32_LEAVING_FLAG = 24;
export const CLASS32_DEAD_FLAG = 30;
/** `obj+0x68 = 0x8000` in state 4's sub 0. */
const EXIT_YAW = 0x8000;

/** `[port-only]` A float's bits as the float. */
function f32(bits: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setUint32(0, bits >>> 0, true);
  return b.getFloat32(0, true);
}

/**
 * `Class32StateDeathSequence` — `FUN_00480140`. The subs fall through.
 *
 * ```
 * 0: Class32StopMoving; obj+0x34 |= 0x100
 *    PlaySoundId(0xC23A9); PlaySoundId(0x80000000)
 *    obj+0x1330 = 0x3C; g_bHudShutterState = 3; sub++
 * 1: if (--obj+0x1330 >= 1) return
 *    ActorSetMotionBlended(0x8F, 0, 4); sub++
 * 2: if (obj+0x19C <= 0x1E) return
 *    PlaySoundId(0x1023A9); sub++; obj+0x1330 = tail+0x2C
 * 3: if (obj+0x19C >= play_length - 2) ActorSetMotionBlended(0x8F, 0x1E, 1)
 *    if (obj+0x1330 % tail+0x34 == 0) Class32SpawnDeathBurst(obj)
 *    if (--obj+0x1330 < 1) { state 3; sub 0 }
 * ```
 */
export function Class32StateDeathSequence(obj: Boss5Actor, rng: Rng,
                                          events?: Events): void {
  const t = obj.boss5;
  const tail = Class32TailOf(obj);
  let s = obj.sub;
  if (s === 0) {
    Class32StopMoving(obj);
    obj.flags |= ActorFlag.ShotImmune;
    events?.emit("sound.play", { id: SND_DEATH });
    events?.emit("sound.play", { id: SND_STOP_BGM });
    t.timer = DEATH_HANG;
    G.g_bHudShutterState = SHUTTER_CLOSE;
    obj.sub += 1;
    s = 1;
  }
  if (s === 1) {
    t.timer -= 1;
    if (t.timer >= 1) return;
    ActorSetMotionBlended(obj, CLIP_DEATH, 0, DEATH_FADE);
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    if ((obj.skel?.cursor ?? 0) <= DEATH_FALL_CURSOR) return;
    events?.emit("sound.play", { id: SND_DEATH_FALL });
    obj.sub += 1;
    t.timer = tail?.death_frames ?? 0;
    s = 3;
  }
  if (s === 3) {
    if ((obj.skel?.cursor ?? 0) >= MotionPlayLength(obj, obj.motion) - 2) {
      ActorSetMotionBlended(obj, CLIP_DEATH, DEATH_LOOP_FROM, DEATH_LOOP_FADE);
    }
    const every = tail?.death_burst_interval ?? 0;
    if (t.timer % every === 0) Class32SpawnDeathBurst(obj, rng, events);
    t.timer -= 1;
    if (t.timer < 1) {
      obj.state = Class32State.DeathRetire;
      obj.sub = 0;
    }
  }
}

const _d = vec3();
const _n = vec3();

/**
 * `Class32StateDeathRetire` — `FUN_00480290`.
 *
 * ```
 * sub 0: obj+0x131A = 0xFF; obj+0x34 = (obj+0x34 & ~0x4000) | 0x10100
 *        ActorSetMotionBlended(0x8E, 0, 4); Class32StopMoving
 *        g_enemies_alive--; g_enemies_present--          ; 0x00480400, 0x00480407
 *        g_enemy_slots[(s8)obj+0x120 * 8] = 0; Class32ReleaseAttackPermit
 *        PlaySoundId(0xC23A9); g_camera_free = 1; g_camera_hand_back_started = 0
 *        pos = (580.0, -35.0, -8832.855)
 * sub 1: d = dest - pos; vel = Vec3Normalize(d) * tail+0x28
 *        if (|d.x| > speed || |d.y| > speed || |d.z| > speed) return
 *        Class32StopMoving
 * else:  return
 * state 4; sub 0
 * ```
 *
 * Sub 0 goes straight on to state 4 on the same frame, and nothing in the
 * class writes sub 1 while the state is 3: the steering arm is in the routine
 * and unreachable, and is carried as it stands.
 */
export function Class32StateDeathRetire(obj: Boss5Actor,
                                        events?: Events): void {
  const t = obj.boss5;
  if (obj.sub === 0) {
    t.attack = Class32Attack.None;
    obj.flags = (obj.flags & ~ActorFlag.PoseFrozen)
      | ActorFlag.NoCameraTrack | ActorFlag.ShotImmune;
    ActorSetMotionBlended(obj, CLIP_HOVER, 0, DEATH_FADE);
    Class32StopMoving(obj);
    G.g_enemies_alive -= 1;
    G.g_enemies_present -= 1;
    CameraSlotVacate(obj);
    Class32ReleaseAttackPermit(obj);
    events?.emit("sound.play", { id: SND_DEATH });
    G.g_camera_free = 1;
    G.g_camera_hand_back_started = 0;
    obj.pos.x = RETIRE_POINT.x;
    obj.pos.y = RETIRE_POINT.y;
    obj.pos.z = RETIRE_POINT.z;
  } else if (obj.sub === 1) {
    _d.x = t.dest.x - obj.pos.x;
    _d.y = t.dest.y - obj.pos.y;
    _d.z = t.dest.z - obj.pos.z;
    Vec3Normalize(_d, _n);
    const speed = Class32TailOf(obj)?.retire_speed ?? 0;
    obj.vel.x = Math.fround(speed * Math.fround(_n.x));
    obj.vel.y = Math.fround(speed * Math.fround(_n.y));
    obj.vel.z = Math.fround(speed * Math.fround(_n.z));
    if (Math.abs(_d.x) > speed) return;
    if (Math.abs(_d.y) > speed) return;
    if (Math.abs(_d.z) > speed) return;
    Class32StopMoving(obj);
  } else {
    return;
  }
  obj.state = Class32State.RaiseFlagAndLeave;
  obj.sub = 0;
}

/**
 * `Class32StateRaiseFlagAndLeave` — `FUN_00480470`.
 *
 * ```
 * if (obj+0x1B4 != 0x8F || obj+0x19C >= g_motion_play_length[0x8F] - 2)
 *     ActorSetMotionBlended(0x8F, 0x1E, 1)
 * 0: obj+0x34 |= 0x10000; g_script_flags[24] = 1; sub++; obj+0x68 = 0x8000; return
 * 1: CamEvalObjectPath6(0x181, (float)g_cam_path_frame, &p); pos = p.xyz
 *    if (g_cam_path_frame != 0xAA) return; sub++
 * 2: obj+0x136C &= ~0x20; Class32SpawnExitEffect(obj); sub++; obj+0x1330 = 0x78
 * 3: if (--obj+0x1330 >= 1) return; sub++; obj+0x1330 = 0xB4
 * 4: if (--obj+0x1330 >= 1) return
 *    g_script_flags[30] = 1 (MOV byte ptr [0x009C721E], 1); BossModeRecordGrade()
 *    ActorDespawn(obj)
 * ```
 *
 * Sub 2 falls into 3 and 3 into 4 (`0x0048054F`, `0x00480573`), so flag 30
 * is raised on the 299th frame counting the one the camera reads 0xAA.
 *
 * The path is the outro camera's (stage 5's `cam_play` slot 213, frames
 * 0..170), which the script queues after `goto_scene_state_when_alive` --
 * the ride and the exit effect run on that camera's own frame. The yaw
 * written in sub 0 is gone the same frame: `Class32Update` aims the boss away
 * from the eye after every state.
 */
export function Class32StateRaiseFlagAndLeave(obj: Boss5Actor): void {
  const t = obj.boss5;
  // `MOVSX EAX, word ptr [0x004E08EE]` -- `g_motion_play_length[0x8F]`.
  if (obj.motion !== CLIP_DEATH
      || (obj.skel?.cursor ?? 0) >= MotionPlayLength(obj, CLIP_DEATH) - 2) {
    ActorSetMotionBlended(obj, CLIP_DEATH, DEATH_LOOP_FROM, DEATH_LOOP_FADE);
  }
  let s = obj.sub;
  if (s === 0) {
    obj.flags |= ActorFlag.NoCameraTrack;
    G.g_script_flags[CLASS32_LEAVING_FLAG] = 1;
    obj.sub += 1;
    obj.yaw = EXIT_YAW;
    return;
  }
  if (s === 1) {
    const p = PropEvalObjectPath6(EXIT_PATH, G.g_cam_path_frame);
    if (p) {
      obj.pos.x = p.x; obj.pos.y = p.y; obj.pos.z = p.z;
    }
    if (G.g_cam_path_frame !== EXIT_EFFECT_FRAME) return;
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    obj.flags2 &= ~Class32Flag2.BodyLoop;
    Class32SpawnExitEffect(obj);
    obj.sub += 1;
    t.timer = EXIT_WAIT_A;
    s = 3;
  }
  if (s === 3) {
    t.timer -= 1;
    if (t.timer >= 1) return;
    obj.sub += 1;
    t.timer = EXIT_WAIT_B;
    s = 4;
  }
  if (s === 4) {
    t.timer -= 1;
    if (t.timer >= 1) return;
    G.g_script_flags[CLASS32_DEAD_FLAG] = 1;
    BossModeRecordGrade();
    ActorDespawn(obj);
  }
}
