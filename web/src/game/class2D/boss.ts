/**
 * Class 0x2D's boss: the handler, `Class2DUpdate` and the seven states of
 * `g_class2d_states` (`0x005898A8`), the stage-5 cameo's update, and the
 * routines they share. See `docs/re/boss-emperor.md` for the reading; every
 * routine here was read from its instruction stream.
 */
import type { Events } from "../../core/events";
import { ActorFlag, type EmperorActor } from "../actor";
import { BossIntroBannerSpawn } from "../boss_banner";
import { BossHpBarSpawn, BossHpFractionOf } from "../boss_hp_bar";
import { BossModeRecordGrade } from "../boss_mode";
import { CamEvalPath7 } from "../camera/path";
import { RegisterEnemySlot, ReleaseCameraEnemySlot } from "../camera/slots";
import { ActorRegisterCameraPoint } from "../camera/track";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { CrtRand, PlaySoundId } from "../class45/rand";
import { ScoreAddForPlayer } from "../combat/score";
import {
  RayTestSphere, ShotRayAnglesFromView,
} from "../combat/shot_test";
import { PlayerTakeDamage } from "../combat/player";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { G, HIT_SLOT_NONE } from "../globals";
import { ActorFreeHitSlot } from "../hit_slots";
import type { GameHost } from "../host";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixLoadIdentity,
  MatrixRotateX, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { ActorBuildSkinnedModel } from "../spawn";
import { MakeSkeletonModel } from "../skeleton";
import { CharacterTypeOf, MotionPlayLength } from "../tables";
import { LerpWeighted, VecToAngles, vec3, type Vec3 } from "../vec";
import {
  CLASS2D_WEAK_POINT_X, CLASS2D_WEAK_POINT_Y, Class2DDraw,
} from "./draw";
import {
  Class2DAttackPick, Class2DChargeArriveDist, Class2DChargeSteps,
  Class2DChildKindPick, Class2DChildOffset, Class2DHitDamage,
  Class2DPathSegmentOf, Class2DStaggerHits, Class2DWaypoint,
  g_class2d_intro_end_frame, g_class2d_join_frames,
  g_class2d_path185_end_frame, g_class2d_rise_end_frame,
} from "./tables";
import {
  Class2DCue, Class2DRoutine, Class2DState, makeClass2DBossWords,
  type Class2DBossWords,
} from "./state";
import { Class2DSpawnHitSpark, Class2DSpawnIntroFlipbook,
         Class2DSpawnDeathBurst } from "./tasks";
import { Class2DSpawnSatellite } from "./satellites";
import { Class2DSpawnChild } from "./children";

/** `[port-only]` -- the boss block, which the handler made. */
function Boss(obj: EmperorActor): Class2DBossWords {
  return obj.class2d.boss ?? (obj.class2d.boss = makeClass2DBossWords());
}

/** `g_script_flags[0x31]` (`0x009C7231`): Class2DState0 waits for it. */
const FLAG_RISEN = 0x31;
/** `g_script_flags[0x32]` (`0x009C7232`): raised when the fight's path ends. */
const FLAG_INTRO_DONE = 0x32;
/** `CMP EAX, 0xDF` -- the intro's camera path. */
const INTRO_CAM_PATH = 0xdf;
/** `PUSH 0x184`, `PUSH 0x185`, `PUSH 0x186` -- the three object paths. */
const PATH_RISE = 0x184;
const PATH_INTRO = 0x185;
const PATH_DEATH = 0x186;
/** `PUSH 0x44A3C000` -- 1310.0, the rise path's held frame. */
const RISE_HOLD_FRAME = 1310.0;
/** `CMP EAX, 0x51E` / `0x629` / `0x667` -- the intro's three camera frames. */
const INTRO_RIDE_FRAME = 0x51e;
const INTRO_PARK_FRAME = 0x629;
const INTRO_FLIPBOOK_FRAME = 0x667;
/** `FADD qword [0x0055D170]` 41.263, `[0x0055D160]` 40.763, `FSUB [0x0055D168]` 38.0. */
const RISE_LIFT_HELD = 41.263;
const RISE_LIFT_RIDING = 40.763;
const PARK_DROP = 38.0;
/** `MOV [ESI+0x40], 0x443C3805` -- 752.875; `+0x48` `0xC61A405C`, -9872.09. */
const INTRO_X = Math.fround(752.875);
const INTRO_Z = Math.fround(-9872.09);
/** The intro's angles: `(0x8000, 0xA20, 0)`, then `(0, 0x8A20, 0)`. */
const RISE_YAW = 0xa20;
const RISE_PITCH = 0x8000;
const PARK_YAW = 0x8a20;
/** `PUSH 0x44E24000` -- 1810.0: the intro path's last frame. */
const INTRO_PATH_END = 1810.0;
/** Clips. */
const CLIP_INTRO_POSE = 0xa1;
const CLIP_HOVER = 0xa3;
const CLIP_OPEN = 0xa4;
const CLIP_FLINCH = 0xb0;
const CLIP_DYING = 0x9f;

/** `(752.875, 2595.0, -9872.09)` and `(0x8000, 0xFAA8, 0)` -- the cameo's stand. */
const CAMEO_Y = Math.fround(2595.0);
const CAMEO_YAW = 0xfaa8;

/** `PUSH 0x42` ... the sound ids the states play. */
const SND_JOIN_A = 0x1225a9;
const SND_JOIN_B = 0x25a9;
const SND_ENGAGE = 0x1425a9;
const SND_CUE = 0x125a9;
const SND_FLINCH = 0x2225a9;
const SND_HIT = 0x1625a9;
const SND_RICOCHET = 0x1216a9;
const SND_STAGGER = 0x1c25a9;
const SND_STRIKE = 0x1d23a9;
const SND_CHARGE = 0x1b25a9;
const SND_ROUND3_OPEN = 0x225a9;
const SND_FADE = 0x1925a9;
const SND_KNOCKED = 0x2625a9;
const SND_PATH_STRIKE = 0x2725a9;
const SND_DEATH = 0x325a9;

/** `PUSH 0x43A00000`, `PUSH 0x420C0000` -- the health bar at (320, 35). */
const BAR_X = 320;
const BAR_Y = 35;
/** `PUSH 0x9C4` -- the kill's 2500 points. */
const KILL_SCORE = 0x9c4;
/** `PUSH 0x40A00000` -- the camera point's rise in states 3, 4 and 5. */
const CAMERA_RISE = 5.0;
/** `CMP EAX, 0x28` -- the glides' forty frames. */
const GLIDE_FRAMES = 0x28;
/** `CMP EAX, 4` -- five waypoints; `CMP EAX, 7` -- eight paths. */
const LAST_WAYPOINT = 4;
const LAST_PATH = 7;
/** `ADD EAX, 0x188` -- state 5's first object path. */
const PATH_ROUND3 = 0x188;
/** `PUSH 0x42700000` -- 60.0, state 5's first path frame. */
const ROUND3_START_FRAME = 60.0;
/** `MOV [ESI+0x1374], 0x3FCCCCCD` -- the weak point's radius in state 5. */
const ROUND3_WEAK_RADIUS = Math.fround(1.6);
/** `FSUB [0x0055D178]` -- 18.0: the warning runs from this far before the end. */
const WARN_LEAD = 18.0;
/** `FSUB qword [0x0055D180]` -- 0.016, state 5's fade a frame. */
const ROUND3_FADE = 0.016;
/** `CMP EAX, 0x3C` -- the fade's sixty frames. */
const ROUND3_FADE_FRAMES = 0x3c;
/** `FADD qword [0x0055D188]` -- 0.02, the death's fade back. */
const DEATH_FADE_IN = 0.02;
/** `CMP [0x009A2D78], 0xE2` -- the death's camera path; frames 100, 200. */
const DEATH_CAM_PATH = 0xe2;
const DEATH_BLEND_FRAME = 100;
const DEATH_BURST_FRAME = 200;
/** `PUSH 0xA`, `PUSH 0xC` -- clip 0xA1 from cursor 12, faded over 10. */
const DEATH_BLEND_START = 0xc;
const DEATH_BLEND_FADE = 0xa;
/** `CMP [EBP+8], 0x20` -- the death clip's frozen cursor. */
const DEATH_FREEZE_CURSOR = 0x20;
/** `CMP EAX, 0x1E` -- the death's last thirty frames. */
const DEATH_HOLD = 0x1e;
/** `FSUB [0x0055D19C]` 22.2 and `FSUB [0x004C4398]` 15.0. */
const PATH_DROP = Math.fround(22.200000762939453);
const EYE_DROP = 15.0;
/** The rank limit `Class2DAdjustRank` clamps to. */
const RANK_MAX = 0xf;

/** `[port-only]` -- a signed 16-bit read of a word. */
const s16 = (v: number): number => (v << 16) >> 16;

/**
 * `Class2DClassHandler` — `FUN_00426A70`. `g_class_handlers[0x2D]`.
 *
 * ```
 * g_cur_actor = obj; state = sub = 0; obj+0x3C = -1; obj+0x120 = 0xFF
 * obj+0x130C = (s8)tail[1]
 * char+0x60 = 0x4C; char+0x20 = (s16)tail[2]
 * ActorBuildSkinnedModel(char, obj+0x40, char+0x78)
 * char+0x68 = 5; char+0x64 |= 0xC; char+0x1158 = Class2DNodeDrawHook
 * char+0 = (s16)tail[4]
 * +0x1370 = +0x1344 = +0x1348 = +0x134C = 1.0
 * +0x124 = g_actor_radius_by_char[type]; +0x1374 = 2.0; +0x136C = 0
 * sub-type 0: Class2DSubtype0Update(obj); install it
 * sub-type 1: BossIntroBannerSpawn(g_class2d_banner_record)
 *             8 x { c = ActorAlloc(Class2DSatelliteInit, 0x13F4);
 *                   ActorClearGameFields(c); c+0x131B = i; c+0x1394 = obj }
 *             if (g_GameMode == 3) { CamEvalObjectPath6(0x185, 1810.0) ->
 *                 pos, angles; ActorSetMotion(char, 0xA3);
 *                 g_script_flags[0x32] = 1; +0x1330 = 0; +0x136C = 1;
 *                 state = 2 }
 *             Class2DUpdate(obj); install it
 * otherwise nothing: the handler stays installed
 * ```
 *
 * `[proved]`. The build is the port's `ActorBuildSkinnedModel`, on the model
 * block the class carries (`game/skeleton.ts`).
 */
export function Class2DClassHandler(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  G.g_cur_actor = obj.at;
  obj.state = 0;
  obj.sub = 0;
  obj.hitSlot = HIT_SLOT_NONE;
  obj.cameraSlot = -1;
  const type = CharacterTypeOf(obj);
  obj.skel = MakeSkeletonModel(type?.bone_count ?? 0, 5);
  obj.skel.motion = b.clip;
  obj.motion = b.clip;
  ActorBuildSkinnedModel(obj);
  obj.skel.order = 5;
  obj.motionFlags |= 0xc;
  obj.skel.counter = b.counterStart;
  b.alpha = 1.0;
  b.colour = [1.0, 1.0, 1.0];
  obj.radius = type?.actor_radius ?? 0;
  obj.hitRadius = obj.radius;
  b.weakRadius = 2.0;
  b.cue = Class2DCue.None;
  if (b.subtype === 0) {
    Class2DSubtype0Update(obj, f);
    obj.class2d.routine = Class2DRoutine.Subtype0Update;
    return;
  }
  if (b.subtype !== 1) return;
  BossIntroBannerSpawn(CLASS2D_BANNER_RECORD);
  for (let i = 0; i < 8; i++) Class2DSpawnSatellite(obj, i, f.rng, f.events);
  if (G.g_GameMode === GameMode.Boss) {
    const p = f.host.objectPath?.(PATH_INTRO, INTRO_PATH_END) ?? null;
    if (p) {
      obj.pos.x = Math.fround(p.x);
      obj.pos.y = Math.fround(p.y);
      obj.pos.z = Math.fround(p.z);
      obj.pitch = Math.trunc(p.pitch ?? 0);
      obj.yaw = Math.trunc(p.yaw ?? 0);
      obj.roll = Math.trunc(p.roll ?? 0);
    }
    ActorSetMotion(obj, CLIP_HOVER);
    G.g_script_flags[FLAG_INTRO_DONE] = 1;
    b.count = 0;
    b.cue = Class2DCue.Resume;
    obj.state = Class2DState.Join;
  }
  Class2DUpdate(obj, f);
  obj.class2d.routine = Class2DRoutine.Update;
}

/** `PUSH 0x5898C8` at `0x00426B46` -- `g_class2d_banner_record`. */
const CLASS2D_BANNER_RECORD = 0x005898c8;

/**
 * `Class2DUpdate` — `FUN_00426C30`. `g_cur_actor = obj;
 * g_class2d_states[(s16)obj+0x1310](obj)`. Seven entries, read out of
 * `0x005898A8` (a zero word follows the seventh). `[proved]`
 */
export function Class2DUpdate(obj: EmperorActor, f: ClassFrame): void {
  G.g_cur_actor = obj.at;
  switch (s16(obj.state) as Class2DState) {
    case Class2DState.IntroRise: Class2DState0(obj, f); break;
    case Class2DState.IntroPath185: Class2DState1(obj, f); break;
    case Class2DState.Join: Class2DState2(obj, f); break;
    case Class2DState.Round1: Class2DState3(obj, f); break;
    case Class2DState.Round2: Class2DState4(obj, f); break;
    case Class2DState.Round3: Class2DState5(obj, f); break;
    case Class2DState.Death: Class2DState6(obj, f); break;
  }
}

/** `[port-only]` -- `g_script_flags[i]` as the byte compare reads it. */
function Flag(i: number): number {
  return G.g_script_flags[i] ?? 0;
}

/** `[port-only]` -- `(s16)g_motion_play_length[clip]`, the `MOVSX` every exit reads. */
function PlayLength(obj: EmperorActor, clip: number): number {
  return MotionPlayLength(obj, clip);
}

/** `[port-only]` -- the model block's play cursor, `char+0x08`. */
function Cursor(obj: EmperorActor): number {
  return obj.skel?.cursor ?? 0;
}

/** `[port-only]` -- the model block's clip, `char+0x20`. */
function Clip(obj: EmperorActor): number {
  return obj.skel?.motion ?? 0;
}

/** `[port-only]` -- `char+0x00 += 1`, the frame counter. */
function StepCounter(obj: EmperorActor): void {
  if (obj.skel) obj.skel.counter += 1;
}

/**
 * `Class2DState0` — `FUN_00426C50`. The intro cut, while camera path 0xDF
 * plays.
 *
 * ```
 * if (g_active_cam_path == 0xDF) {
 *   f = g_cam_path_frame
 *   if (f < 0x51E) { y = OP6(0x184, 1310.0).y + 41.263; goto seat }
 *   else if (f >= 0x629) {
 *     if (f == 0x667) ActorClearGameFields(ActorAlloc(Class2DIntroFlipbookUpdate))
 *     if (g_script_flags[0x31] == 1) {
 *       +0x44 -= 38.0; angles = (0, 0x8A20, 0); state++
 *       Class2DDraw(obj); return
 *     }
 *   } else {
 *     y = OP6(0x184, min(f, g_class2d_rise_end_frame)).y + 40.763
 *   seat:
 *     pos = (752.875, y, -9872.09); angles = (0x8000, 0xA20, 0)
 *   }
 * }
 * Class2DDraw(obj)
 * ```
 *
 * `[proved]`. The frame counter is not stepped.
 */
export function Class2DState0(obj: EmperorActor, f: ClassFrame): void {
  if (G.g_active_cam_path === INTRO_CAM_PATH) {
    const frame = G.g_cam_path_frame;
    let y: number | null = null;
    if (frame < INTRO_RIDE_FRAME) {
      const p = f.host.objectPath?.(PATH_RISE, RISE_HOLD_FRAME) ?? null;
      y = Math.fround((p?.y ?? 0) + RISE_LIFT_HELD);
    } else if (frame >= INTRO_PARK_FRAME) {
      if (frame === INTRO_FLIPBOOK_FRAME) Class2DSpawnIntroFlipbook();
      if (Flag(FLAG_RISEN) === 1) {
        obj.pos.y = Math.fround(obj.pos.y - PARK_DROP);
        obj.pitch = 0;
        obj.yaw = PARK_YAW;
        obj.roll = 0;
        obj.state += 1;
        Class2DDraw(obj, f);
        return;
      }
    } else {
      const n = frame > g_class2d_rise_end_frame ? g_class2d_rise_end_frame
        : frame;
      const p = f.host.objectPath?.(PATH_RISE, n) ?? null;
      y = Math.fround((p?.y ?? 0) + RISE_LIFT_RIDING);
    }
    if (y !== null) {
      obj.pos.x = INTRO_X;
      obj.pos.y = y;
      obj.pos.z = INTRO_Z;
      obj.pitch = RISE_PITCH;
      obj.yaw = RISE_YAW;
      obj.roll = 0;
    }
  }
  Class2DDraw(obj, f);
}

/**
 * `Class2DState1` — `FUN_00426D70`. Object path 0x185 while camera path
 * 0xDF plays.
 *
 * ```
 * if (g_active_cam_path == 0xDF) {
 *   if (clip == 0xA1 && cursor == len(0xA1) - 1) ActorSetMotionBlended(0xA3, 0, 0x14)
 *   if (g_cam_path_frame == g_class2d_intro_end_frame) {
 *     g_script_flags[0x32] = 1; state++; +0x1330 = 0; +0x136C = 1 }
 *   p = OP6(0x185, min(g_cam_path_frame, g_class2d_path185_end_frame))
 *   pos = p.pos; angles = p.angles
 * }
 * Class2DDraw(obj); char+0++
 * ```
 *
 * `[proved]`.
 */
export function Class2DState1(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  if (G.g_active_cam_path === INTRO_CAM_PATH) {
    if (Clip(obj) === CLIP_INTRO_POSE
        && Cursor(obj) === PlayLength(obj, CLIP_INTRO_POSE) - 1) {
      ActorSetMotionBlended(obj, CLIP_HOVER, 0, 0x14);
    }
    if (G.g_cam_path_frame === g_class2d_intro_end_frame) {
      G.g_script_flags[FLAG_INTRO_DONE] = 1;
      obj.state += 1;
      b.count = 0;
      b.cue = Class2DCue.Resume;
    }
    const n = G.g_cam_path_frame > g_class2d_path185_end_frame
      ? g_class2d_path185_end_frame : G.g_cam_path_frame;
    const p = f.host.objectPath?.(PATH_INTRO, n) ?? null;
    if (p) {
      obj.pos.x = Math.fround(p.x);
      obj.pos.y = Math.fround(p.y);
      obj.pos.z = Math.fround(p.z);
      obj.pitch = Math.trunc(p.pitch ?? 0);
      obj.yaw = Math.trunc(p.yaw ?? 0);
      obj.roll = Math.trunc(p.roll ?? 0);
    }
  }
  Class2DDraw(obj, f);
  StepCounter(obj);
}

/** `CMP ECX, 0xA0` / `0xF0` -- state 2's two sounds. */
const JOIN_SOUND_A = 0xa0;
const JOIN_SOUND_B = 0xf0;

/**
 * `Class2DState2` — `FUN_00426E60`. The banner's 300 frames, then the fight.
 *
 * ```
 * n = ++obj+0x1330
 * if (n == 0xA0) PlaySoundId(0x1225A9)
 * else if (n == 0xF0) PlaySoundId(0x25A9)
 * else if (n >= g_class2d_join_frames) {
 *   hp = (s16)tail+0x0A; BossHpBarSpawn(320, 35)
 *   g_enemies_present++; g_enemies_alive++; RegisterEnemySlot(obj)
 *   g_boss_engaged = 1; obj+0x34 |= 0x100; PlaySoundId(0x1425A9)
 *   state++; sub = 0; +0x1368 = 0; +0x1320 = 1; +0x133C = -1
 *   +0x1324 = GetDamageRank(); +0x132C = 0; +0x1350 = 0
 *   pos = g_class2d_waypoints[0]; +0x1350 = 1; +0x13C0 = g_class2d_waypoints[1]
 *   +0x1330 = 0
 * }
 * Class2DDraw(obj); char+0++
 * ```
 *
 * `[proved]`.
 */
export function Class2DState2(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  b.count += 1;
  const n = b.count;
  if (n === JOIN_SOUND_A) {
    PlaySoundId(SND_JOIN_A, f.events);
  } else if (n === JOIN_SOUND_B) {
    PlaySoundId(SND_JOIN_B, f.events);
  } else if (n >= g_class2d_join_frames) {
    obj.hp = s16(b.fightHp);
    BossHpBarSpawn(BAR_X, BAR_Y);
    G.g_enemies_present += 1;
    G.g_enemies_alive += 1;
    RegisterEnemySlot(obj);
    G.g_boss_engaged = 1;
    obj.flags |= ActorFlag.ShotImmune;
    PlaySoundId(SND_ENGAGE, f.events);
    obj.state += 1;
    obj.sub = 0;
    b.phase = 0;
    b.next = 1;
    b.shooter = -1;
    b.rank = s16(G.g_damage_rank);
    b.hold = 0;
    b.index = 0;
    const w0 = Class2DWaypoint(b.index);
    obj.pos.x = w0.x;
    obj.pos.y = w0.y;
    obj.pos.z = w0.z;
    b.index += 1;
    SetTarget(b, Class2DWaypoint(b.index));
    b.count = 0;
  }
  Class2DDraw(obj, f);
  StepCounter(obj);
}

/** `[port-only]` -- `+0x13C0..+0x13C8 = v`. */
function SetTarget(b: Class2DBossWords, v: Vec3): void {
  b.target.x = v.x;
  b.target.y = v.y;
  b.target.z = v.z;
}

/**
 * `[port-only]` -- the three `LerpWeighted(pos, +0x13C0, 1, n)` calls every
 * glide makes, one axis at a time, each stored with `FSTP` to a float.
 */
function GlideToward(pos: Vec3, t: Vec3, n: number): void {
  pos.x = Math.fround(LerpWeighted(pos.x, t.x, 1, n));
  pos.y = Math.fround(LerpWeighted(pos.y, t.y, 1, n));
  pos.z = Math.fround(LerpWeighted(pos.z, t.z, 1, n));
}

/**
 * `Class2DAdjustRank` — `FUN_00428D60`. `(obj, d)`: `+0x1324 += d`, then 0
 * if it went negative (`JNS`) and 15 if it passed 15. `[proved]`
 */
export function Class2DAdjustRank(obj: EmperorActor, d: number): void {
  const b = Boss(obj);
  b.rank = (b.rank + d) | 0;
  if (b.rank < 0) {
    b.rank = 0;
    return;
  }
  if (b.rank > RANK_MAX) b.rank = RANK_MAX;
}

const _p = vec3();
const _pv = vec3();
const _ov = vec3();
const _ev = vec3();

/**
 * `Class2DWeakPointInReach` — `FUN_00428F00`. `(obj, player)`:
 *
 * ```
 * Push; SetTop(obj+0x2C4); Translate(2.3121, 0.1097, 0); P = translation; Pop
 * return RayTestSphere(player, P, obj+0x1374) >= 0
 * ```
 *
 * `[proved]`. `obj+0x2C4` is bone 1's record matrix; see
 * {@link Class2DViewRayReachesPoint} for how the port measures it.
 */
export function Class2DWeakPointInReach(obj: EmperorActor, player: number,
                                        host: GameHost): boolean {
  const b = Boss(obj);
  // `PUSH 0; PUSH 0x3DE0AA65; PUSH 0x4013F972` -- the weak point on bone 1.
  const local = { x: CLASS2D_WEAK_POINT_X, y: CLASS2D_WEAK_POINT_Y, z: 0 };
  return Class2DViewRayReachesPoint(obj, 1, local, b.weakRadius, player, host);
}

/**
 * `[port-only]` -- the measure the class's two weak-point routines share:
 * `local` on bone `bone`'s record, and `RayTestSphere(player, P, radius) >=
 * 0`. The engine's record is in view space and so is its ray; the port's
 * record is in the world, so the point and the fired ray go to view space
 * through the host's camera, as `Class14WeakPointInReach` in
 * `class14/shot.ts` takes them, and the ray is the pull that marked the
 * object (`Actor.shotRays`). With no camera there is no hit -- the engine
 * always has one.
 */
export function Class2DViewRayReachesPoint(obj: EmperorActor, bone: number,
                                           local: Vec3, radius: number,
                                           player: number,
                                           host: GameHost): boolean {
  const W = obj.skel?.bones[bone]?.mat;
  const ray = obj.shotRays[player] ?? G.g_crosshair_ray[player] ?? null;
  const toView = host.viewSpaceOfPoint;
  if (!W || !ray || !toView) return false;
  const m = MatCopy(MatIdentity(), W);
  MatrixTranslate(m, local.x, local.y, local.z);
  MatrixGetTranslation(m, _p);
  const e = { x: ray.origin.x + ray.dir.x, y: ray.origin.y + ray.dir.y,
              z: ray.origin.z + ray.dir.z };
  if (!toView(_p, _pv) || !toView(ray.origin, _ov) || !toView(e, _ev)) {
    return false;
  }
  const dx = _ev.x - _ov.x, dy = _ev.y - _ov.y, dz = _ev.z - _ov.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return false;
  const a = ShotRayAnglesFromView({ x: dx / len, y: dy / len, z: dz / len });
  return RayTestSphere(a, _pv.x - _ov.x, _pv.y - _ov.y, _pv.z - _ov.z,
                       radius) >= 0;
}

/** `MOV [ESI+0x1344], 1.0`, `+0x1348` 0.25, `+0x134C` 0.5 -- the hit's flash. */
const FLASH_COLOUR: readonly [number, number, number] = [1.0, 0.25, 0.5];

/**
 * `Class2DResolveShot` — `FUN_00428DA0`. The boss's shot, first in states 3,
 * 4 and 5. Returns 1 when a shot damaged it.
 *
 * ```
 * hit = 0; who = -1
 * if (0 < sub <= 5 && (obj+0x34 & 8) && !(obj+0x34 & 0x40000000))
 *   for p in 0, 1:
 *     bone = (s8)obj[0x190 + p]
 *     if (bone == 1) {
 *       if (!(obj+0x34 & 0x100) && Class2DWeakPointInReach(obj, p)) {
 *         hp -= g_class2d_hit_damage[g_players_in_play]; who += p + 1; hit = 1
 *         Class2DAdjustRank(obj, 1); flash; Class2DSpawnHitSpark(obj)
 *         PlaySoundId(0x1625A9)
 *       } else if (sub != 5) PlaySoundId(0x1216A9)
 *     } else if (bone != 0 && sub != 5) PlaySoundId(0x1216A9)
 *     obj[0x190 + p] = 0
 *     bone record(bone)+0x74 &= ~((1 << (p + 1)) | 8); obj+0x34 &= ~(1 << (p + 1))
 * obj+0x133C = (s16)who; return hit
 * ```
 *
 * `[proved]`. `hit` is the bone number, 1, when it is set. The port has no
 * bone record flags word to clear; the actor's is `obj.flags`.
 */
export function Class2DResolveShot(obj: EmperorActor, f: ClassFrame): number {
  const b = Boss(obj);
  let hit = 0;
  let who = -1;
  const sub = s16(obj.sub);
  if (sub > 0 && sub <= 5 && (obj.flags & ActorFlag.Hit)
      && !(obj.flags & ActorFlag.Reacting)) {
    for (let p = 0; p < 2; p++) {
      const bone = (obj.shotBones[p] << 24) >> 24;
      if (bone === 1) {
        if (!(obj.flags & ActorFlag.ShotImmune)
            && Class2DWeakPointInReach(obj, p, f.host)) {
          obj.hp = s16(obj.hp - Class2DHitDamage(G.g_players_in_play));
          who = who + p + 1;
          hit = bone;
          Class2DAdjustRank(obj, 1);
          b.colour = [...FLASH_COLOUR];
          Class2DSpawnHitSpark(obj.at);
          PlaySoundId(SND_HIT, f.events);
        } else if (sub !== 5) {
          PlaySoundId(SND_RICOCHET, f.events);
        }
      } else if (bone !== 0 && sub !== 5) {
        PlaySoundId(SND_RICOCHET, f.events);
      }
      obj.shotBones[p] = 0;
      obj.flags &= ~(1 << (p + 1));
    }
  }
  b.shooter = s16(who);
  return hit;
}

/**
 * `Class2DAnglesBetween` — `FUN_00429620`. `(a, b, &yaw, &pitch)`:
 * `VecToAngles(a - b, &pitch, &yaw); *yaw = yaw & 0xFFFF; *pitch = pitch &
 * 0xFFFF` -- both angles are the `s16` words `VecToAngles` stores, taken to
 * sixteen unsigned bits. `[proved]`
 */
export function Class2DAnglesBetween(a: Vec3, b: Vec3):
    { yaw: number; pitch: number } {
  const r = VecToAngles(Math.fround(a.x - b.x), Math.fround(a.y - b.y),
                        Math.fround(a.z - b.z));
  return { yaw: Math.trunc(r.yaw) & 0xffff,
           pitch: s16(Math.trunc(r.pitch)) & 0xffff };
}

/** `[port-only]` -- the tail every round's state ends on: face the eye, the bar. */
function FaceEyeAndPublishHp(obj: EmperorActor, flat: boolean): void {
  const eye = G.g_camera_eye;
  const a = flat
    ? Class2DAnglesBetween({ x: obj.pos.x, y: 0, z: obj.pos.z },
                           { x: eye.x, y: 0, z: eye.z })
    : Class2DAnglesBetween(obj.pos, eye);
  obj.yaw = a.yaw;
  obj.pitch = a.pitch;
  G.g_boss_hp_fraction = BossHpFractionOf(obj.hp, obj.maxHp);
}

/**
 * `Class2DSortSatelliteRecords` — `FUN_00429680`. `REP MOVSD` the eight
 * records into `g_class2d_satellite_order`, then an insertion sort of the
 * copy, largest `+0x10` first: `FCOMP` of `[j].+0x10` against `[j+1].+0x10`,
 * swapped while `C0` says the first is the smaller. `[proved]`
 */
export function Class2DSortSatelliteRecords(): void {
  const o = G.g_class2d_satellite_records.map((r) => ({
    index: r.index, active: r.active, order: r.order,
    point: { ...r.point }, viewZ: r.viewZ,
  }));
  for (let i = 0; i + 1 < 8; i++) {
    for (let j = i; j >= 0; j--) {
      if (!(o[j].viewZ < o[j + 1].viewZ)) break;
      const t = o[j];
      o[j] = o[j + 1];
      o[j + 1] = t;
    }
  }
  G.g_class2d_satellite_order = o;
}

/**
 * `Class2DSatellitesAllIdle` — `FUN_00429710`. 1 when byte `+1` of all eight
 * records is 0. `[proved]`
 */
export function Class2DSatellitesAllIdle(): number {
  let r = 1;
  for (const s of G.g_class2d_satellite_records) if (s.active !== 0) r = 0;
  return r;
}

/**
 * `[port-only]` -- `char+0x2A0`/`char+0x330`: bone 3's and bone 4's sphere
 * radius (`record + 0x78`), which the attack clips write from
 * `g_character_part_tables[type]` rows 3 and 4 (`[ECX + 0x4C]`, `[EAX +
 * 0x60]`) -- the rows of bones 4 and 5, one row past each bone's own, as the
 * instruction says -- and put back to 0 as the attack ends. The bundle carries
 * each row on the bone it belongs to (`CharacterBone.hit_radius`, row
 * `bone - 1`), so row `r` is bone `r + 1`'s.
 */
function PartRowRadius(obj: EmperorActor, row: number): number {
  const b = CharacterTypeOf(obj)?.bones.find((x) => x.bone === row + 1);
  return b?.hit_radius ?? 0;
}
function RaiseGuardSpheres(obj: EmperorActor): void {
  obj.boneRadius["3"] = PartRowRadius(obj, 3);
  obj.boneRadius["4"] = PartRowRadius(obj, 4);
}
function DropGuardSpheres(obj: EmperorActor): void {
  obj.boneRadius["3"] = 0;
  obj.boneRadius["4"] = 0;
}

/** `CMP ECX, 2` -- `g_active_player == 2` activates six satellites, else four. */
function ActivateSatellites(): void {
  const n = G.g_active_player !== 2 ? 4 : 6;
  for (let i = 0; i < n; i++) {
    const idx = (G.g_class2d_satellite_order[i]?.index ?? 0) << 24 >> 24;
    const r = G.g_class2d_satellite_records[idx];
    if (!r) continue;
    r.active = 1;
    r.order = i;
  }
}

/**
 * `[port-only]` -- the strike every close attack of the class makes, inline
 * at each site: by `g_active_player`, 0 player 0, 1 player 1, 2 both
 * (`PlayerTakeDamage(0)` then `(1)`), anything else nobody.
 */
export function Class2DStrikePlayers(latch: number, motion: number,
                                     events?: Events): void {
  switch (G.g_active_player) {
    case 0: PlayerTakeDamage(0, latch, motion, events); break;
    case 1: PlayerTakeDamage(1, latch, motion, events); break;
    case 2:
      PlayerTakeDamage(0, latch, motion, events);
      PlayerTakeDamage(1, latch, motion, events);
      break;
  }
}

/**
 * The end of every attack in states 3 and 4 -- `0xA3` held twenty frames --
 * when the hit points have reached the round's floor: the next state, the
 * waypoint, and the child kind for state 4. Inline twice in `Class2DState3`
 * (`0x004273D0`, `0x00427B8E`), transcribed once per site through this.
 * `[port-only]` as a function.
 */
function Round1EndsHere(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  obj.flags |= ActorFlag.ShotImmune;
  PlaySoundId(SND_ENGAGE, f.events);
  obj.state += 1;
  SetTarget(b, Class2DWaypoint(b.index));
  obj.sub = 0;
  b.phase = 0;
  // `CALL rand; AND EAX, 0x80000003` then `rand() % 10`: two draws.
  const row = CrtRand(f.rng) % 4;
  const col = CrtRand(f.rng) % 10;
  b.next = Class2DChildKindPick(row, col);
}

/** `[port-only]` -- the other arm: stay, glide on, and pick the next attack. */
function Round1Continues(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  SetTarget(b, Class2DWaypoint(b.index));
  obj.sub = 0;
  b.phase = 0;
  // `CALL rand; SAR EAX, 4; CDQ; IDIV 10` -- one draw, shifted.
  const col = (CrtRand(f.rng) >> 4) % 10;
  b.next = Class2DAttackPick(b.rank, col) + 1;
  PlaySoundId(SND_ENGAGE, f.events);
}

/**
 * `[port-only]` -- `0xA3`'s twenty frames: `+0x1334` counts them, and on the
 * twentieth the round's floor decides.
 */
function HoverThenDecide(obj: EmperorActor, f: ClassFrame, floor: number,
                         end: () => void, stay: () => void): void {
  const b = Boss(obj);
  if (Clip(obj) !== CLIP_HOVER) return;
  const n = b.span;
  b.span += 1;
  if (n !== 0x14) return;
  if (s16(obj.hp) > s16(floor)) stay();
  else end();
  void f;
}

/**
 * `Class2DState3` — `FUN_00426FD0`. The first round: glide to a waypoint,
 * make one of three attacks, repeat until the hit points reach `tail+0x0C`.
 *
 * `hit` is `Class2DResolveShot`'s answer, which every arm reads in `EAX`.
 * The subs, by `obj+0x1312` through the four-entry table at `0x00427D10`
 * (`CMP ECX, 3; JA`), and sub 3's steps through the six at `0x00427D20`:
 *
 * * **0** -- glide to `+0x13C0` over 40 frames, then `+0x1354 = +0x1350`,
 *   the waypoint index on (wrapping past 4), `sub = +0x1320`, clip 0xA4.
 * * **1** -- 0xA4 to its end, then 0xA5 (bones 3 and 4 lose their spheres):
 *   cue 2 at cursor 0x37; at 0xA5's end the satellites are sorted and the
 *   nearest 4 (6) activated, cue 3, clip 0x97. On 0x97 a hit flinches
 *   (0xB0, `obj+0x34 |= 0x40000000`); once every satellite is idle, cue 1,
 *   bones 3 and 4 get their spheres back, `obj+0x34 |= 0x100`, clip 0xA6,
 *   and from its cursor 0x26 the 0xA3 hover decides.
 * * **2** -- the same on 0xA7 (cue 2 at cursor 0x1E), 0x99 and 0xA8, with no
 *   activation: `Class2DSatelliteOrbitAndPick` sends every satellite on it.
 * * **3** -- 0xAA (cue 2 at cursor 0xB; bone 5 glows once a satellite is
 *   out), a charge at the eye on 0x9B (`LerpWeighted` by
 *   `g_class2d_charge_steps[rank]`), which `g_class2d_stagger_hits` hits stop
 *   (0xB0, then back); at 0x9B's cursor 0x2A the strike (`PlayerTakeDamage(p,
 *   1, 5)`, rank -3); back to the waypoint over 40 frames, the glow shrinks,
 *   0xA9, and the hover decides.
 *
 * The tail: face the eye, the bar, `Class2DDraw`, the counter unless
 * `+0x132C`, `obj+0x34 &= ~0xE`, `ActorRegisterCameraPoint(5.0)`. `[proved]`
 */
export function Class2DState3(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  const hit = Class2DResolveShot(obj, f);
  switch (s16(obj.sub)) {
    case 0: {
      GlideToward(obj.pos, b.target, GLIDE_FRAMES - b.count);
      const n = b.count;
      b.count += 1;
      if (n > GLIDE_FRAMES) {
        obj.pos.x = b.target.x;
        obj.pos.y = b.target.y;
        obj.pos.z = b.target.z;
        b.prevIndex = b.index;
        b.count = 0;
        b.index += 1;
        if (b.index > LAST_WAYPOINT) b.index = 0;
        obj.sub = s16(b.next);
        b.phase = 0;
        ActorSetMotionBlended(obj, CLIP_OPEN, 0, 2);
      }
      break;
    }
    case 1: Class2DState3Attack1(obj, f, hit); break;
    case 2: Class2DState3Attack2(obj, f, hit); break;
    case 3: Class2DState3Attack3(obj, f, hit); break;
  }
  FaceEyeAndPublishHp(obj, false);
  Class2DDraw(obj, f);
  if (b.hold === 0) StepCounter(obj);
  obj.flags &= ~0xe;
  ActorRegisterCameraPoint(obj, f.host, CAMERA_RISE);
}

/** `[port-only]` -- sub 1 of `Class2DState3`, the arm at `0x004270F7`. */
function Class2DState3Attack1(obj: EmperorActor, f: ClassFrame,
                              hit: number): void {
  const b = Boss(obj);
  const clip = Clip(obj);
  const cur = Cursor(obj);
  switch (b.phase) {
    case 0:
      if (clip === CLIP_OPEN) {
        if (cur === PlayLength(obj, CLIP_OPEN) - 1) {
          DropGuardSpheres(obj);
          obj.flags &= ~ActorFlag.ShotImmune;
          ActorSetMotionBlended(obj, 0xa5, 0, 2);
        }
      } else if (clip === 0xa5) {
        if (cur === 0x37) {
          b.cue = Class2DCue.Attack;
          PlaySoundId(SND_CUE, f.events);
        }
        if (Cursor(obj) === PlayLength(obj, 0xa5) - 1) {
          Class2DSortSatelliteRecords();
          ActivateSatellites();
          PlaySoundId(SND_JOIN_B, f.events);
          b.cue = Class2DCue.Go;
          b.span = 0;
          ActorSetMotionBlended(obj, 0x97, 0, 2);
          b.phase += 1;
        }
      }
      break;
    case 1:
      Class2DFlinchOrOpen(obj, f, hit, 0x97, 0xa6, false);
      break;
    case 2:
      if (clip === 0xa6 && cur === 0x26) {
        b.span = 0;
        ActorSetMotionBlended(obj, CLIP_HOVER, 0, 0x14);
      }
      HoverThenDecide(obj, f, b.round2Hp, () => Round1EndsHere(obj, f),
                      () => Round1Continues(obj, f));
      break;
  }
}

/**
 * `[port-only]` -- the step both sub 1 and sub 2 of `Class2DState3` (and sub
 * 4 of `Class2DState4`) make while their satellites are out: on the wait
 * clip a hit flinches; once every satellite is idle and no flinch runs, cue
 * 1 and the closing clip. Inline at each site; the arms differ only by the
 * wait clip, the closing clip, and whether the cue sound plays first.
 */
function Class2DFlinchOrOpen(obj: EmperorActor, f: ClassFrame, hit: number,
                             wait: number, close: number,
                             soundFirst: boolean): void {
  const b = Boss(obj);
  const clip = Clip(obj);
  if (clip === wait) {
    if (hit !== 0 && !(obj.flags & ActorFlag.Reacting)) {
      obj.flags |= ActorFlag.Reacting;
      ActorSetMotionBlended(obj, CLIP_FLINCH, 0, 5);
      PlaySoundId(SND_FLINCH, f.events);
    }
    if (Class2DSatellitesAllIdle() !== 0
        && !(obj.flags & ActorFlag.Reacting)) {
      if (soundFirst) PlaySoundId(SND_JOIN_B, f.events);
      b.cue = Class2DCue.Resume;
      RaiseGuardSpheres(obj);
      obj.flags |= ActorFlag.ShotImmune;
      ActorSetMotionBlended(obj, close, 0, 2);
      b.phase += 1;
    }
  } else if (clip === CLIP_FLINCH) {
    if (Cursor(obj) === PlayLength(obj, CLIP_FLINCH) - 1) {
      obj.flags &= ~ActorFlag.Reacting;
      ActorSetMotionBlended(obj, wait, 0, 0xa);
    }
  }
}

/** `[port-only]` -- sub 2 of `Class2DState3`, the arm at `0x00427353`. */
function Class2DState3Attack2(obj: EmperorActor, f: ClassFrame,
                              hit: number): void {
  const b = Boss(obj);
  const clip = Clip(obj);
  const cur = Cursor(obj);
  switch (b.phase) {
    case 0:
      if (clip === CLIP_OPEN) {
        if (cur === PlayLength(obj, CLIP_OPEN) - 1) {
          ActorSetMotionBlended(obj, 0xa7, 0, 2);
        }
      } else if (clip === 0xa7) {
        if (cur === 0x1e) {
          DropGuardSpheres(obj);
          obj.flags &= ~ActorFlag.ShotImmune;
          b.cue = Class2DCue.Attack;
          PlaySoundId(SND_CUE, f.events);
          PlaySoundId(SND_JOIN_A, f.events);
        }
        if (Cursor(obj) === PlayLength(obj, 0xa7) - 1) {
          b.cue = Class2DCue.Go;
          b.span = 0;
          ActorSetMotionBlended(obj, 0x99, 0, 2);
          b.phase += 1;
        }
      }
      break;
    case 1:
      Class2DFlinchOrOpen(obj, f, hit, 0x99, 0xa8, true);
      break;
    case 2:
      if (clip === 0xa8 && cur === PlayLength(obj, 0xa8) - 1) {
        b.span = 0;
        ActorSetMotionBlended(obj, CLIP_HOVER, 0, 0x14);
      }
      HoverThenDecide(obj, f, b.round2Hp, () => Round1EndsHere(obj, f),
                      () => Round1Continues(obj, f));
      break;
  }
}

/** `MOVSX EAX, word [EDX*2 + 0x0055CFA0]` sits at `+0x1334`; the charge's hits. */
const CHARGE_CUE_CURSOR = 0x1e;
const CHARGE_STRIKE_CURSOR = 0x2a;
/** `PUSH 0x5` -- the charge's strike motion, `PlayerTakeDamage(p, 1, 5)`. */
const CHARGE_STRIKE_MOTION = 5;
/** `PUSH -3` -- a strike's rank change. */
const STRIKE_RANK = -3;

/** `[port-only]` -- sub 3 of `Class2DState3`, the arm at `0x00427666`. */
function Class2DState3Attack3(obj: EmperorActor, f: ClassFrame,
                              hit: number): void {
  const b = Boss(obj);
  switch (b.phase) {
    case 0: {
      const clip = Clip(obj);
      if (clip === CLIP_OPEN) {
        if (Cursor(obj) === PlayLength(obj, CLIP_OPEN) - 1) {
          DropGuardSpheres(obj);
          obj.flags &= ~ActorFlag.ShotImmune;
          ActorSetMotionBlended(obj, 0xaa, 0, 2);
        }
        break;
      }
      if (clip !== 0xaa) break;
      const cur = Cursor(obj);
      if (cur === 0xb) {
        b.cue = Class2DCue.Attack;
        PlaySoundId(SND_CUE, f.events);
        PlaySoundId(SND_JOIN_A, f.events);
      }
      if (b.cue === Class2DCue.Attack && b.glowMode === 0) {
        let out = 0;
        for (const r of G.g_class2d_satellite_records) if (r.active === 1) out = 1;
        if (out !== 0) {
          b.glowMode = 1;
          b.glow = 0;
        }
      }
      const c2 = Cursor(obj);
      if (c2 === 0x37) {
        PlaySoundId(SND_HIT, f.events);
      } else if (c2 === PlayLength(obj, Clip(obj)) - 1) {
        const eye = G.g_camera_eye;
        SetTarget(b, eye);
        b.count = 0;
        b.span = Class2DChargeSteps(b.rank);
        b.hits = 0;
        ActorSetMotionBlended(obj, 0x9b, 0, 0xa);
        PlaySoundId(SND_CHARGE, f.events);
        b.phase += 1;
      }
      break;
    }
    case 1: {
      if (hit !== 0) b.hits += 1;
      if (Clip(obj) === 0x9b && Cursor(obj) === CHARGE_CUE_CURSOR) b.hold = 1;
      if (b.hits >= Class2DStaggerHits(G.g_players_in_play)) {
        Class2DChargeStagger(obj, f);
        break;
      }
      GlideToward(obj.pos, b.target, b.span - b.count);
      const dx = obj.pos.x - b.target.x;
      const dy = obj.pos.y - b.target.y;
      const dz = obj.pos.z - b.target.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(d > Class2DChargeArriveDist())) {
        b.hold = 0;
        b.phase += 1;
      }
      break;
    }
    case 2: {
      if (hit !== 0) b.hits += 1;
      const cur = Cursor(obj);
      if (cur < CHARGE_STRIKE_CURSOR
          && b.hits >= Class2DStaggerHits(G.g_players_in_play)) {
        Class2DChargeStagger(obj, f);
        break;
      }
      if (cur === CHARGE_STRIKE_CURSOR) {
        Class2DStrikePlayers(1, CHARGE_STRIKE_MOTION, f.events);
        Class2DAdjustRank(obj, STRIKE_RANK);
        obj.flags |= ActorFlag.ShotImmune;
        PlaySoundId(SND_STAGGER, f.events);
        PlaySoundId(SND_STRIKE, f.events);
        break;
      }
      if (cur === PlayLength(obj, Clip(obj)) - 1) {
        SetTarget(b, Class2DWaypoint(b.prevIndex));
        obj.flags |= ActorFlag.ShotImmune;
        b.count = 0;
        ActorSetMotionBlended(obj, 0x9a, 0, 2);
        b.phase += 1;
      }
      break;
    }
    case 3: {
      GlideToward(obj.pos, b.target, GLIDE_FRAMES - b.count);
      const n = b.count;
      b.count += 1;
      if (n > GLIDE_FRAMES) {
        obj.pos.x = b.target.x;
        obj.pos.y = b.target.y;
        obj.pos.z = b.target.z;
        b.count = 0;
        b.cue = Class2DCue.Resume;
        PlaySoundId(SND_JOIN_B, f.events);
        b.glowMode = 2;
        RaiseGuardSpheres(obj);
        ActorSetMotionBlended(obj, 0xa9, 0, 2);
        b.phase += 1;
      }
      break;
    }
    case 4:
      if (Clip(obj) === 0xa9 && Cursor(obj) === 0xf) {
        b.span = 0;
        ActorSetMotionBlended(obj, CLIP_HOVER, 0, 0x14);
      }
      HoverThenDecide(obj, f, b.round2Hp, () => Round1EndsHere(obj, f),
                      () => Round1Continues(obj, f));
      break;
    case 5:
      if (Clip(obj) === CLIP_FLINCH
          && Cursor(obj) === PlayLength(obj, CLIP_FLINCH) - 1) {
        SetTarget(b, Class2DWaypoint(b.prevIndex));
        obj.flags |= ActorFlag.ShotImmune;
        b.count = 0;
        ActorSetMotionBlended(obj, 0x9a, 0, 0x14);
        b.phase = 3;
      }
      break;
  }
}

/** `[port-only]` -- `0x0042790D`: the charge stopped by hits. */
function Class2DChargeStagger(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  obj.flags |= ActorFlag.ShotImmune;
  b.count = 0;
  ActorSetMotionBlended(obj, CLIP_FLINCH, 0, 0xf);
  PlaySoundId(SND_FLINCH, f.events);
  PlaySoundId(SND_STAGGER, f.events);
  b.hold = 0;
  b.phase = 5;
}

/** Clips of state 4's sub 4. */
const CLIP_R2_OPEN = 0xab;
const CLIP_R2_WAIT = 0xad;
const CLIP_R2_RISE = 0xae;
const CLIP_R2_HOLD = 0xaf;
const CLIP_R2_CLOSE = 0xac;

/**
 * `Class2DState4` — `FUN_00427D40`. The child round.
 *
 * * **sub 0** -- glide to the next waypoint over 40 frames; on arrival
 *   `g_class2d_child_busy = 1`, sub 4, clip 0xA4, and ONE child: the point
 *   `Translate(eye) RotY(yaw) RotX(pitch) * g_class2d_child_offsets[kind]`,
 *   `(yaw, pitch) = Class2DAnglesBetween(eye, the waypoint just left)`, made
 *   by the init the table at `0x004283E4` gives `+0x1320` (`CMP EAX, 4; JA`),
 *   seated there with `obj+0x34 |= 1`, `+0x1394 = obj`, angles `(-pitch,
 *   yaw + 0x8000, 0)`.
 * * **sub 4** -- 0xA4 (bones 3 and 4 lose their spheres) and 0xAB; at its
 *   end cue 2 and every satellite record active; 0xAD until every satellite
 *   is idle again, then every record active once more, cue 3, clip 0xAE,
 *   `obj+0x34 |= 0x10000`; 0xAE, then 0xAF with the flinch, until every
 *   satellite is idle: `obj+0x34 &= ~0x10000`, cue 1, spheres back, clip
 *   0xAC, then the hover: above `tail+0x0E` the next kind from row
 *   `+0x1320` and another waypoint, else state 5 sub 5.
 *
 * Any other sub does nothing but the tail, which steps the counter always.
 * `[proved]`
 */
export function Class2DState4(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  const hit = Class2DResolveShot(obj, f);
  const sub = s16(obj.sub);
  if (sub === 0) {
    GlideToward(obj.pos, b.target, GLIDE_FRAMES - b.count);
    const n = b.count;
    b.count += 1;
    if (n > GLIDE_FRAMES) {
      obj.pos.x = b.target.x;
      obj.pos.y = b.target.y;
      obj.pos.z = b.target.z;
      b.prevIndex = b.index;
      b.count = 0;
      b.index += 1;
      if (b.index > LAST_WAYPOINT) b.index = 0;
      G.g_class2d_child_busy = 1;
      obj.sub = 4;
      b.phase = 0;
      ActorSetMotionBlended(obj, CLIP_OPEN, 0, 2);
      Class2DState4MakeChild(obj, f);
    }
  } else if (sub === 4) {
    Class2DState4Children(obj, f, hit);
  }
  FaceEyeAndPublishHp(obj, false);
  Class2DDraw(obj, f);
  StepCounter(obj);
  obj.flags &= ~0xe;
  ActorRegisterCameraPoint(obj, f.host, CAMERA_RISE);
}

/**
 * `[port-only]` -- `0x004281D9..0x00428365`, the child's allocation, made
 * once sub 0's glide is done.
 */
function Class2DState4MakeChild(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  const eye = G.g_camera_eye;
  const a = Class2DAnglesBetween(eye, Class2DWaypoint(b.prevIndex));
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixTranslate(m, eye.x, eye.y, eye.z);
  MatrixRotateY(m, a.yaw);
  MatrixRotateX(m, a.pitch);
  const out = vec3();
  MatrixTransformPoint(m, Class2DChildOffset(b.next), out);
  // `CMP EAX, 4; JA` -- five entries, the fifth kind 3's init again. A value
  // past 4 takes whatever `[ESP + 0x30]` held; `g_class2d_child_kind_picks`
  // holds none.
  const kind = b.next === 4 ? 3 : b.next;
  Class2DSpawnChild(obj, kind, {
    x: Math.fround(out.x), y: Math.fround(out.y), z: Math.fround(out.z),
  }, -a.pitch, (a.yaw + 0x8000) | 0, f);
}

/** `[port-only]` -- sub 4 of `Class2DState4`, `0x00427D7A`. */
function Class2DState4Children(obj: EmperorActor, f: ClassFrame,
                               hit: number): void {
  const b = Boss(obj);
  const clip = Clip(obj);
  const cur = Cursor(obj);
  switch (b.phase) {
    case 0:
      if (clip === CLIP_OPEN) {
        if (cur === PlayLength(obj, CLIP_OPEN) - 1) {
          DropGuardSpheres(obj);
          obj.flags &= ~ActorFlag.ShotImmune;
          ActorSetMotionBlended(obj, CLIP_R2_OPEN, 0, 2);
          PlaySoundId(SND_JOIN_A, f.events);
        }
      } else if (clip === CLIP_R2_OPEN) {
        if (cur === PlayLength(obj, CLIP_R2_OPEN) - 1) {
          b.count = 0;
          b.cue = Class2DCue.Attack;
          for (const r of G.g_class2d_satellite_records) r.active = 1;
          PlaySoundId(SND_CUE, f.events);
          ActorSetMotionBlended(obj, CLIP_R2_WAIT, 0, 2);
        }
      } else if (clip === CLIP_R2_WAIT) {
        if (Class2DSatellitesAllIdle() !== 0) {
          for (const r of G.g_class2d_satellite_records) r.active = 1;
          b.cue = Class2DCue.Go;
          ActorSetMotionBlended(obj, CLIP_R2_RISE, 0, 2);
          obj.flags |= ActorFlag.NoCameraTrack;
          b.phase += 1;
        }
      }
      break;
    case 1:
      if (clip === CLIP_R2_RISE) {
        if (cur === PlayLength(obj, CLIP_R2_RISE) - 1) {
          ActorSetMotionBlended(obj, CLIP_R2_HOLD, 0, 2);
        }
      } else if (clip === CLIP_R2_HOLD) {
        if (hit !== 0 && !(obj.flags & ActorFlag.Reacting)) {
          obj.flags |= ActorFlag.Reacting;
          ActorSetMotionBlended(obj, CLIP_FLINCH, 0, 5);
          PlaySoundId(SND_FLINCH, f.events);
        }
        if (Class2DSatellitesAllIdle() !== 0
            && !(obj.flags & ActorFlag.Reacting)) {
          obj.flags &= ~ActorFlag.NoCameraTrack;
          PlaySoundId(SND_JOIN_B, f.events);
          b.cue = Class2DCue.Resume;
          RaiseGuardSpheres(obj);
          obj.flags |= ActorFlag.ShotImmune;
          ActorSetMotionBlended(obj, CLIP_R2_CLOSE, 0, 2);
          b.phase += 1;
        }
      } else if (clip === CLIP_FLINCH) {
        if (cur === PlayLength(obj, CLIP_FLINCH) - 1) {
          obj.flags &= ~ActorFlag.Reacting;
          ActorSetMotionBlended(obj, CLIP_R2_HOLD, 0, 0xa);
        }
      }
      break;
    case 2:
      if (clip === CLIP_R2_CLOSE && cur === PlayLength(obj, CLIP_R2_CLOSE) - 1) {
        b.span = 0;
        ActorSetMotionBlended(obj, CLIP_HOVER, 0, 0x14);
      }
      HoverThenDecide(obj, f, b.round3Hp, () => {
        obj.flags |= ActorFlag.ShotImmune;
        PlaySoundId(SND_ENGAGE, f.events);
        b.index = 0;
        obj.state = Class2DState.Round3;
        b.phase = 0;
        obj.sub = 5;
      }, () => {
        SetTarget(b, Class2DWaypoint(b.index));
        obj.sub = 0;
        b.phase = 0;
        b.warn = 0;
        b.struck = 0;
        const col = CrtRand(f.rng) % 10;
        b.next = Class2DChildKindPick(b.next, col);
        PlaySoundId(SND_ENGAGE, f.events);
      });
      break;
  }
}

/**
 * `Class2DTargetOnPathFromEye` — `FUN_00429530`. `(obj, path, frame)`:
 *
 * ```
 * p = CamEvalObjectPath6(path, frame).pos; p.y -= 22.2
 * CamEvalPath7(0xDF, 1810.0, &e, &l, ..); e.y -= 15.0
 * Push; Identity; Translate(e); +0x13C0 = top * p; Pop
 * ```
 *
 * `[proved]`: the path's point, carried from the intro path's last eye.
 */
export function Class2DTargetOnPathFromEye(obj: EmperorActor, path: number,
                                           frame: number,
                                           host: GameHost): void {
  const b = Boss(obj);
  const q = host.objectPath?.(path, frame) ?? null;
  const p = vec3(Math.fround(q?.x ?? 0),
                 Math.fround((q?.y ?? 0) - PATH_DROP),
                 Math.fround(q?.z ?? 0));
  const e = vec3();
  const l = vec3();
  CamEvalPath7(INTRO_CAM_PATH, INTRO_PATH_END, e, l);
  e.y = Math.fround(e.y - EYE_DROP);
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixTranslate(m, e.x, e.y, e.z);
  const out = vec3();
  MatrixTransformPoint(m, p, out);
  b.target.x = Math.fround(out.x);
  b.target.y = Math.fround(out.y);
  b.target.z = Math.fround(out.z);
}

/** `CMP EAX, 7` -- the fade's `+0x1370` floor. */
const ROUND3_CLIP_FADE_IN = 0x9d;
const ROUND3_CLIP_FADE = 0x9e;
const ROUND3_CLIP_PATH = 0xa2;

/**
 * `Class2DState5` — `FUN_00428400`. The last round: the path segments, and
 * the kill.
 *
 * `Class2DResolveShot` first. `hp <= 0` is the kill (see the arm below).
 * Otherwise by `+0x1368` through the six-entry table at `0x00428AC0`:
 *
 * * **0** -- target path `0x188 + +0x1350` at frame 60, the weak point down to
 *   1.6, `+0x1340 = 60.0`; **falls into 1** (`0x00428554` runs on into
 *   `0x0042855A`, L53);
 * * **1** -- the 40-frame glide, then clip 0xA4;
 * * **2** -- 0xA4 to its end (cue 2), 0x9D to its end (`+0x1364 = 1`: bone
 *   1's core flipbook), 0x9E fading `+0x1370` by 0.016 for sixty frames
 *   to 0 with every bone sphere but bone 1's zeroed, then 0xA2;
 * * **3** -- ride the segment: `+0x1340 += step`, `+0x1358` from `end - 18`,
 *   and at `end` either the hits reached the row's count (a knock-back to
 *   the next path, sub 5) or not (ride on, sub 4);
 * * **4** -- ride on: at `strike` hit the players (`PlayerTakeDamage(p, 1,
 *   7)`, rank -3, `+0x135C = 1`), past `advance` the next path (sub 3);
 * * **5** -- the knock-back glide over the row's word 0 frames, then sub 3.
 *
 * The tail faces the eye on the flat, the bar, `Class2DDraw`, counter,
 * `obj+0x34 &= ~0xE`, `ActorRegisterCameraPoint(5.0)`. `[proved]`
 */
export function Class2DState5(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  const hit = Class2DResolveShot(obj, f);
  if (!(s16(obj.hp) > 0)) {
    Class2DState5Kill(obj, f);
    return;
  }
  const seg = Class2DPathSegmentOf(b.index);
  // Arm 0 runs on into arm 1 (`0x00428554` into `0x0042855A`, L53): it
  // steps `+0x1368` to 1 first, so the switch below takes arm 1 this frame.
  if (b.phase === 0) {
    Class2DTargetOnPathFromEye(obj, PATH_ROUND3 + b.index,
                               ROUND3_START_FRAME, f.host);
    b.weakRadius = ROUND3_WEAK_RADIUS;
    b.phase += 1;
    b.count = 0;
    b.pathFrame = ROUND3_START_FRAME;
  }
  switch (b.phase) {
    case 1: {
      GlideToward(obj.pos, b.target, GLIDE_FRAMES - b.count);
      const n = b.count;
      b.count += 1;
      if (n > GLIDE_FRAMES) {
        obj.pos.x = b.target.x;
        obj.pos.y = b.target.y;
        obj.pos.z = b.target.z;
        b.count = 0;
        ActorSetMotionBlended(obj, CLIP_OPEN, 0, 2);
        b.phase += 1;
      }
      break;
    }
    case 2: {
      const clip = Clip(obj);
      if (clip === ROUND3_CLIP_FADE_IN) {
        if (Cursor(obj) === PlayLength(obj, ROUND3_CLIP_FADE_IN) - 1) {
          b.count = 0;
          b.core = 1;
          ActorSetMotionBlended(obj, ROUND3_CLIP_FADE, 0, 2);
          PlaySoundId(SND_FADE, f.events);
        }
      } else if (clip === ROUND3_CLIP_FADE) {
        b.alpha = Math.fround(b.alpha - ROUND3_FADE);
        const n = b.count;
        b.count += 1;
        if (n >= ROUND3_FADE_FRAMES) {
          b.alpha = 0;
          obj.flags &= ~ActorFlag.ShotImmune;
          b.hits = 0;
          b.hold = 0;
          for (let bone = 0; bone < 0x10; bone++) {
            if (bone !== 1) obj.boneRadius[String(bone)] = 0;
          }
          ActorSetMotionBlended(obj, ROUND3_CLIP_PATH, 0, 2);
          b.phase += 1;
        }
      } else if (clip === CLIP_OPEN) {
        if (Cursor(obj) === PlayLength(obj, CLIP_OPEN) - 1) {
          b.cue = Class2DCue.Attack;
          PlaySoundId(SND_CUE, f.events);
          PlaySoundId(SND_ROUND3_OPEN, f.events);
          ActorSetMotionBlended(obj, ROUND3_CLIP_FADE_IN, 0, 2);
        }
      }
      break;
    }
    case 3: {
      if (hit !== 0) b.hits += 1;
      Class2DTargetOnPathFromEye(obj, PATH_ROUND3 + b.index, b.pathFrame,
                                 f.host);
      obj.pos.x = b.target.x;
      obj.pos.y = b.target.y;
      obj.pos.z = b.target.z;
      b.pathFrame = Math.fround(seg.step + b.pathFrame);
      if (!(b.pathFrame < Math.fround(seg.end - WARN_LEAD))) b.warn = 1;
      if (b.hold !== 0) break;
      if (b.pathFrame < seg.end) break;
      if (b.hits >= (seg.words[G.g_players_in_play] ?? 0)) {
        b.span = seg.words[0] ?? 0;
        b.index += 1;
        if (b.index > LAST_PATH) b.index = 0;
        b.pathFrame = 0;
        Class2DTargetOnPathFromEye(obj, PATH_ROUND3 + b.index, 0, f.host);
        PlaySoundId(SND_KNOCKED, f.events);
        b.warn = 0;
        b.phase += 2;
      } else {
        b.hold = 0;
        b.phase += 1;
      }
      break;
    }
    case 4: {
      Class2DTargetOnPathFromEye(obj, PATH_ROUND3 + b.index, b.pathFrame,
                                 f.host);
      obj.pos.x = b.target.x;
      obj.pos.y = b.target.y;
      obj.pos.z = b.target.z;
      b.pathFrame = Math.fround(seg.step + b.pathFrame);
      if (b.hold === 0 && !(b.pathFrame < seg.strike)) {
        b.hold = 1;
        Class2DStrikePlayers(1, 7, f.events);
        Class2DAdjustRank(obj, STRIKE_RANK);
        b.warn = 0;
        b.struck = 1;
        PlaySoundId(SND_PATH_STRIKE, f.events);
        break;
      }
      if (b.pathFrame > seg.advance) {
        b.index += 1;
        if (b.index > LAST_PATH) b.index = 0;
        b.pathFrame = 0;
        b.hits = 0;
        b.hold = 0;
        b.warn = 0;
        b.struck = 0;
        b.phase -= 1;
      }
      break;
    }
    case 5: {
      GlideToward(obj.pos, b.target, b.span - b.count);
      const n = b.count;
      b.count += 1;
      if (n > b.span) {
        obj.pos.x = b.target.x;
        obj.pos.y = b.target.y;
        obj.pos.z = b.target.z;
        b.pathFrame = 0;
        b.hits = 0;
        b.hold = 0;
        b.warn = 0;
        b.phase -= 2;
      }
      break;
    }
  }
  FaceEyeAndPublishHp(obj, true);
  Class2DDraw(obj, f);
  StepCounter(obj);
  obj.flags &= ~0xe;
  ActorRegisterCameraPoint(obj, f.host, CAMERA_RISE);
}

/** `CMP AL, 0x63; JGE` -- the Original Mode kill count's cap. */
const KILL_COUNT_CAP = 0x63;
/**
 * `MOV AL, byte ptr [0x009C90D8]` -- `g_original_items_taken` (`0x009C90C0`)
 * `+ 0x18`, and its copy at `g_profile_original_items` (`0x009C9F3D`) `+
 * 0x18`: the boss's kills are counted in the item tally's entry 24, with
 * the same cap a pickup has. Whether any item also counts into entry 24 is
 * `[open]`.
 */
const ORIGINAL_ITEM_BOSS6 = 0x18;
/** `OR DL, 1` into `g_option_unlocks`. */
const UNLOCK_BOSS6 = 1;

/**
 * `Class2DState5`'s kill arm, `0x00428425..0x004284FE` -- inline in the
 * state, transcribed here for its length. `[port-only]` as a function.
 *
 * ```
 * g_boss_engaged = 0; g_screen_furniture_flags &= ~2
 * p = obj+0x133C; if (p == 2) p = rand() % 2
 * ScoreAddForPlayer(p, 0x9C4)
 * if (g_GameMode == 1) { g_option_unlocks |= 1
 *   if ((s8)g_original_items_taken[24] < 0x63)
 *     g_profile_original_items[24] = ++g_original_items_taken[24]
 *   g_profile_original_boss6_beaten = 1 }
 * BossModeRecordGrade()
 * obj+0x34 |= 0x100; state = 6; sub = 0; +0x1368 = 0; +0x1320 = 0
 * ActorSetMotion(char, 0x9F); +0x136C = 3; PlaySoundId(0x325A9)
 * +0x1358 = +0x135C = 0; Class2DDraw(obj); char+0++; return
 * ```
 */
function Class2DState5Kill(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  G.g_boss_engaged = 0;
  G.g_screen_furniture_flags &= ~2;
  let p = b.shooter;
  // `AND EAX, 0x80000001; JNS` -- `rand() % 2`, never negative.
  if (p === 2) p = CrtRand(f.rng) % 2;
  ScoreAddForPlayer(p, KILL_SCORE, f.events);
  if (G.g_GameMode === GameMode.Original) {
    G.g_option_unlocks |= UNLOCK_BOSS6;
    // `0x009C90D8` and `0x009C9F55` are entry 24 of the Original Mode item
    // tally and of its saved copy, compared as a signed byte.
    const n = G.g_original_items_taken[ORIGINAL_ITEM_BOSS6] ?? 0;
    if (((n << 24) >> 24) < KILL_COUNT_CAP) {
      G.g_original_items_taken[ORIGINAL_ITEM_BOSS6] = (n + 1) & 0xff;
      G.g_profile_original_items[ORIGINAL_ITEM_BOSS6] = (n + 1) & 0xff;
    }
    G.g_profile_original_boss6_beaten = 1;
  }
  BossModeRecordGrade();
  obj.flags |= ActorFlag.ShotImmune;
  obj.state = Class2DState.Death;
  obj.sub = 0;
  b.phase = 0;
  b.next = 0;
  ActorSetMotion(obj, CLIP_DYING);
  b.cue = Class2DCue.Go;
  PlaySoundId(SND_DEATH, f.events);
  b.warn = 0;
  b.struck = 0;
  Class2DDraw(obj, f);
  StepCounter(obj);
}

/**
 * `Class2DState6` — `FUN_00428AE0`. The death.
 *
 * ```
 * if (+0x1370 < 1.0) +0x1370 += 0.02
 * switch (sub) {          // four entries at 0x00428CC0
 * case 0: g_enemies_alive--; g_enemies_present--; g_boss_hp_fraction = 0
 *         g_camera_free = 1; g_camera_hand_back_started = 0
 *         if (obj+0x120 != 0xFF) ReleaseCameraEnemySlot(obj)
 *         if (obj+0x3C != -1) ActorFreeHitSlot(obj)
 *         sub++; +0x1370 = 0; +0x1320 = 0                    // falls into 1
 * case 1: if (g_active_cam_path != 0xE2) break; sub++       // falls into 2
 * case 2: if (g_cam_path_frame == 100) ActorSetMotionBlended(0xA1, 0xC, 10)
 *         if (clip == 0xA1 && cursor == 0x20) +0x1320 = 1
 *         if (g_cam_path_frame <= 200) {
 *           pos, angles = CamEvalObjectPath6(0x186, g_cam_path_frame)
 *           if (g_cam_path_frame == 200) { burst = ActorAlloc(
 *               Class2DDeathBurstUpdate); ActorClearGameFields(burst);
 *               burst.pos = pos; sub++; +0x1330 = 0 } }
 *         break
 * case 3: if (+++0x1330 >= 0x1E) { +0x136C = 4; ActorDespawn(obj); return }
 * }
 * Class2DDraw(obj); if (+0x1320 == 0) char+0++
 * ```
 *
 * `[proved]`. The two fall-throughs are the arms' own (L53).
 */
export function Class2DState6(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  if (b.alpha < 1.0) b.alpha = Math.fround(b.alpha + DEATH_FADE_IN);
  let sub = s16(obj.sub);
  if (sub === 0) {
    G.g_enemies_alive -= 1;
    G.g_enemies_present -= 1;
    G.g_boss_hp_fraction = 0;
    G.g_camera_free = 1;
    G.g_camera_hand_back_started = 0;
    if (obj.cameraSlot !== -1) ReleaseCameraEnemySlot(obj);
    if (obj.hitSlot !== HIT_SLOT_NONE) ActorFreeHitSlot(obj);
    obj.sub += 1;
    b.alpha = 0;
    b.next = 0;
    sub = 1;
  }
  if (sub === 1) {
    if (G.g_active_cam_path === DEATH_CAM_PATH) {
      obj.sub += 1;
      sub = 2;
    }
  }
  if (sub === 2) {
    const frame = G.g_cam_path_frame;
    if (frame === DEATH_BLEND_FRAME) {
      ActorSetMotionBlended(obj, CLIP_INTRO_POSE, DEATH_BLEND_START,
                            DEATH_BLEND_FADE);
    }
    if (Clip(obj) === CLIP_INTRO_POSE && Cursor(obj) === DEATH_FREEZE_CURSOR) {
      b.next = 1;
    }
    if (frame <= DEATH_BURST_FRAME) {
      const p = f.host.objectPath?.(PATH_DEATH, frame) ?? null;
      if (p) {
        obj.pos.x = Math.fround(p.x);
        obj.pos.y = Math.fround(p.y);
        obj.pos.z = Math.fround(p.z);
        obj.pitch = Math.trunc(p.pitch ?? 0);
        obj.yaw = Math.trunc(p.yaw ?? 0);
        obj.roll = Math.trunc(p.roll ?? 0);
      }
      if (G.g_cam_path_frame === DEATH_BURST_FRAME) {
        Class2DSpawnDeathBurst(obj.pos);
        obj.sub += 1;
        b.count = 0;
      }
    }
  } else if (sub === 3) {
    b.count += 1;
    if (b.count >= DEATH_HOLD) {
      b.cue = Class2DCue.Gone;
      ActorDespawn(obj);
      return;
    }
  }
  Class2DDraw(obj, f);
  if (b.next === 0) StepCounter(obj);
}

/**
 * `Class2DSubtype0Update` — `FUN_00428CD0`. Sub-type 0: stage 5 block 0's
 * cameo, one spawn (evt `0xF0C`, hp 0, clip `0xA0`).
 *
 * ```
 * g_cur_actor = obj
 * if (g_active_cam_path == (s16)tail+6 && g_cam_path_frame >= (s16)tail+8) {
 *   if (obj+0x3C != -1) ActorFreeHitSlot(obj)
 *   JMP ActorKill
 * }
 * if (sub == 0) { pos = (752.875, 2595.0, -9872.09);
 *                 angles = (0x8000, 0xFAA8, 0); sub++ }
 * if (!(g_screen_furniture_flags & 0x20)) Class2DDraw(obj)
 * ```
 *
 * `[proved]`. Its counter is never stepped, so the clip holds its first
 * frame. The shipped tail is path `0xCC` (`cp_st5` path 1), frame 0: the
 * cameo is gone the frame the stage's play starts.
 */
export function Class2DSubtype0Update(obj: EmperorActor, f: ClassFrame): void {
  const b = Boss(obj);
  G.g_cur_actor = obj.at;
  if (G.g_active_cam_path === s16(b.killPath)
      && G.g_cam_path_frame >= s16(b.killFrame)) {
    if (obj.hitSlot !== HIT_SLOT_NONE) ActorFreeHitSlot(obj);
    ActorKillClass2D(obj);
    return;
  }
  if (s16(obj.sub) === 0) {
    obj.pos.x = INTRO_X;
    obj.pos.y = CAMEO_Y;
    obj.pos.z = INTRO_Z;
    obj.pitch = RISE_PITCH;
    obj.yaw = CAMEO_YAW;
    obj.roll = 0;
    obj.sub += 1;
  }
  if (!(G.g_screen_furniture_flags & 0x20)) Class2DDraw(obj, f);
}

/**
 * The cameo's end, as `ActorKill` (`FUN_004A7040`) delivers it on the pool's
 * current object: unlinked and freed, and the routine does not return (L72).
 * Here the object leaves the pool as `ActorDespawn` takes it, without
 * `ActorDespawn`'s own lines -- the flags and the hit slot, which a caller
 * that wants them does itself. Named for the caller, as `ActorKillPlacer` is;
 * `[port-only]` as a function.
 */
export function ActorKillClass2D(obj: EmperorActor): void {
  obj.despawned = true;
  obj.visible = false;
  obj.action = null;
}
