/**
 * Class 0x45 sub-type 5: the body -- a `boss3l.bin` that swims the canal
 * along a path it builds from eight or nine `op_` segments, drives the
 * camera itself along the matching `cp_` segments, surfaces at seven places
 * a lap and lunges at the player. Its death is the second gate of a stage-3
 * block, and it hands the camera back as it dies.
 */
import { EvtOpPlayDialogue2D } from "../dialogue";
import type { Boss3Actor } from "../actor";
import { ActorFlag } from "../actor";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import type { GameHost } from "../host";
import type { CamPose } from "../camera/curve";
import { BossHpBarSpawn } from "../boss_hp_bar";
import { ScoreAddForPlayer } from "../combat/score";
import { RegisterForShotTest } from "../combat/shot_test";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { PlayerTakeDamage } from "../combat/player";
import { SpawnBoneHitSprite } from "../effects/blood";
import { ActorBuildSkinnedModel } from "../spawn";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { PlayerState } from "../player_state";
import { MotionPlayLength } from "../tables";
import { FtolS16 } from "../matrix";
import { vec3, VecToAngles } from "../vec";
import {
  Boss3BlockNew, Boss3BodyState, Boss3BodyTables, Boss3PoseHook,
  Boss3Routine, BOSS3_MAX_BONES, BOSS3_MAX_PATH_POINTS,
  type Boss3Block,
} from "./state";
import {
  BOSS3_BODY_ATTACK_MOTIONS_B, BOSS3_BODY_CAM_PATHS_A, BOSS3_BODY_CAM_PATHS_B,
  BOSS3_BODY_EVENTS_A, BOSS3_BODY_EVENTS_B, BOSS3_BODY_OBJ_PATHS_A,
  BOSS3_BODY_OBJ_PATHS_B, type Boss3BodyEvent, type Boss3PathSeg,
} from "./tables";
import {
  Boss3DrawModel, Boss3ModelStep, Boss3SetMotion, Boss3SetMotionBlended,
} from "./model";
import {
  Boss3ComposeBonePose, Boss3DrawBoneParts, PoseHookNone, SOUND_SIBUKI2,
  BOSS3_PATH_RESTART_A, BOSS3_PATH_RESTART_B,
} from "./pose";
import { Boss3PlayStageSound, CrtRand, PlaySoundId } from "./rand";
import {
  Boss3SpawnBoneSpark, Boss3SpawnMeshBulge, Boss3SpawnPathEffects,
  Boss3SpawnSplashAt,
} from "./tasks";
import { BOSS3_BAR_X, BOSS3_BAR_Y } from "./heads";

/** The body's index, `obj+0x131B = 8`, and its 120 hit points. */
const BODY_INDEX = 8;
const BODY_HP = 0x78;
/** `[0x0055CB44]` -- a hundred-and-twentieth, the bar's scale. */
const BODY_BAR_SCALE = Math.fround(1 / 120);
/** A damaging hit: `[0x0055CB4C]` -6.0 with two players, `[0x0055CB48]` -10.0 with one. */
const BODY_DAMAGE_2P = -6;
const BODY_DAMAGE_1P = -10;
/** The weak bone the shot must enter, a literal `0x18`. */
const BODY_WEAK = 0x18;
/** `CMP EAX, 0x1700` -- the jaw open. */
const JAW_OPEN = 0x1700;
const HIT_POINTS = 10;
const KILL_POINTS = 0x5dc;
/** Where the dead body is put, by variant, and its yaw `-0x311C`. */
const DEATH_POS_A = vec3(Math.fround(-849.7), -5, -4252);
const DEATH_POS_B = vec3(Math.fround(-1604.1), -12, Math.fround(-3927.6));
const DEATH_YAW = -0x311c;
/** The death bob: rate `0x400`, amplitude 1.25, and `[0x004E30F8]` 0.35 a cycle. */
const BOB_RATE = 0x400;
const BOB_START = 1.25;
const BOB_DECAY = Math.fround(0.35);
/** `[0x004C4C58]` 0.25 and `[0x004C4398]` 15.0 -- the dead body sinking. */
const SINK_RATE = Math.fround(0.25);
const WATER_LINE = 15;
/** The dead body's cue, cursor `0x6E`, and its sink window from `0x46`. */
const DEATH_CUE = 0x6e;
const SINK_FROM = 0x46;
/** The clips: the swim `0x42`, the surface `0x3D`, the two lunges, the death. */
const CLIP_SWIM = 0x42;
const CLIP_SURFACE = 0x3d;
const CLIP_LUNGE_EVEN = 0x3c;
const CLIP_LUNGE_ODD = 0x3b;
const CLIP_DEATH = 0x41;
/** The lunges' hit frames. */
const HIT_EVEN = 0x26;
const HIT_ODD = 0x2f;
const HIT_B = 0x2d;
/** The body's lunge surfaces at -13.5, `0xC1580000`. */
const LUNGE_Y = -13.5;
/** Splash heights: -15 (variant 0) and -13.5; the stage-6-style `-12`. */
const SPLASH_Y_A = -15;
const SPLASH_Y_B = -13.5;
const SPLASH_Y_DEAD_B = -12;
/** `g_screen_shake_frames = 0x30`. */
const SHAKE_BIG = 0x30;
/** `COMMON\BOMB1_11`, `COMMON\SIBUKI3`, `STAGE3_SE\BOSS3_1`. */
const SOUND_BOMB1 = 0xb16a9;
const SOUND_SIBUKI3 = 0x4216a9;
const SOUND_STAGE3_BOSS3_1 = 0x241aa9;
/** `COMMON\BULLET_OTH1_16`. */
const SOUND_MISS = 0x1216a9;
/** The path cues: the splash at `0x5F`, the mesh at 10, the line at `0x3C`, the bar at `0xB4`. */
const CUE_SPLASH = 0x5f;
const CUE_BULGE = 10;
const CUE_LINE = 0x3c;
const CUE_BAR = 0xb4;
/** `EvtOpPlayDialogue2D(0x83)` and the shutter's two states. */
const LINE_GROUP = 0x83;
const SHUTTER_CLOSED = 5;
const SHUTTER_OPENING = 1;
/** Variant 0's and 1's path jumps: `(4, 0x2B2) -> 0x523`, `(6, 0x325) -> 0x6B8`. */
const JUMP_A_SEG = 4, JUMP_A_FRAME = 0x2b2, JUMP_A_TO = 0x523;
const JUMP_B_SEG = 6, JUMP_B_FRAME = 0x325, JUMP_B_TEST = 0x6f4, JUMP_B_TO = 0x6b8;
/** The lunge freezes the camera for `0x1E` frames. */
const CAM_FREEZE = 0x1e;
/** Retreat after this many hits in one surfacing: 3 with two players, 2 with one. */
const RETREAT_2P = 3;
const RETREAT_1P = 2;
/** The surfacings wrap past 6: to 1 on variant 0, to 0 otherwise. */
const EVENT_LAST = 6;
/** State 11 holds its clip on cursor `0x1E`. */
const SURFACE_HOLD = 0x1e;
/** State 13: `[0x004C4C88]` 0.05 a frame to 1.0. */
const RECOVER_RATE = Math.fround(0.05);
/** `MoveAndDriveCamera`'s lunge: `[0x004C4D10]` 0.3 a frame, `[0x004C4CB8]` 1.5 and 0.5. */
const LUNGE_RATE = Math.fround(0.3);
const LUNGE_FAST = 1.5;
const LUNGE_SLOW = 0.5;
/** Variant 1's two blends of the path toward fixed points, and their spans. */
const BLEND1_FROM = 0x2f3, BLEND1_TO = 0x334;
const BLEND1_X = Math.fround(-1818.88), BLEND1_Z = Math.fround(-3982.87);
const BLEND1_RATE = Math.fround(0.015384615);
const BLEND2_FROM = 0x335, BLEND2_TO = 0x398;
const BLEND2_X = Math.fround(-1949.44), BLEND2_Z = Math.fround(-3927.83);
const BLEND2_RATE = Math.fround(0.009615385);
/** Variant 0 swims at -15 and closes on the camera below path point `0x41`. */
const SWIM_Y_A = -15;
const APPROACH_END = 0x41;
const APPROACH_RATE = Math.fround(0.30769232);
/** Variant 1's depth: -12.5, or easing to -16.5 by 0.08. */
const SWIM_Y_B = -12.5;
const DIVE_Y = -16.5;
const DIVE_RATE = Math.fround(0.08);
const DIVE_LATE = 0x840;
const DIVE_EARLY_FROM = 0xc8, DIVE_EARLY_TO = 0x140;
/** Variant 0's camera rides 2.0 higher (`[0x0055CAF8]`, a double). */
const CAM_LIFT = 2;
/** The camera restart at the end of the last segment. */
const CAM_RESTART_A = 0x29, CAM_RESTART_FRAMES_A = 0x11e;
const CAM_RESTART_B = 0xdd;

/** Clips the camera's pitch follows the body in: the surfacing and the lunges. */
const PITCH_CLIPS = new Set([0x3b, 0x3c, 0x3e, 0x3f, 0x3d]);

/** The body's object-path table, `+0x77B8`. */
function ObjPaths(blk: Boss3Block): readonly Boss3PathSeg[] {
  return blk.bodyTables === Boss3BodyTables.A
    ? BOSS3_BODY_OBJ_PATHS_A : BOSS3_BODY_OBJ_PATHS_B;
}
/** ...its camera table, `+0x77BC`... */
function CamPaths(blk: Boss3Block): readonly Boss3PathSeg[] {
  return blk.bodyTables === Boss3BodyTables.A
    ? BOSS3_BODY_CAM_PATHS_A : BOSS3_BODY_CAM_PATHS_B;
}
/** ...and its surfacings, `+0x77C0`. */
function Events(blk: Boss3Block): readonly Boss3BodyEvent[] {
  return blk.bodyTables === Boss3BodyTables.A
    ? BOSS3_BODY_EVENTS_A : BOSS3_BODY_EVENTS_B;
}

/** `[0x004C4E48]` -- `g_actor_radius_by_char[0x48]`, the body's `obj+0x124`. */
const BODY_SHOT_RADIUS = 95;

/**
 * `Boss3BodyInit` — `FUN_00420360`. Index 8, 120 hit points, `boss3l.bin` on
 * the swim clip, three units up, shootable (`obj+0x34 |= 0x80080000`), state
 * 8; the block with the weak bone and jaws, the variant's three tables (and
 * on variant 1 the path effects), every bone's anchors on the body and every
 * rotation zeroed. Counts in both enemy counters.
 */
export function Boss3BodyInit(obj: Boss3Actor): void {
  const t = obj.boss3;
  G.g_boss3_heads[0] = obj.at;
  t.index = BODY_INDEX;
  obj.hp = BODY_HP;
  Boss3SetMotion(obj, CLIP_SWIM);
  ActorBuildSkinnedModel(obj);
  obj.pos.y = Math.fround(obj.pos.y + 3);
  // `MOV EDX, [0x004C4E48]` at `0x004203BA`: `g_actor_radius_by_char[0x48]`
  // (`0x004C4D28 + 0x48*4`) read at its own address, 95.0 -- the broad-phase
  // sphere the whole body sits in.
  obj.hitRadius = BODY_SHOT_RADIUS;
  obj.radius = BODY_SHOT_RADIUS;
  t.poseHook = Boss3PoseHook.None;
  obj.state = Boss3BodyState.BuildPath;
  obj.flags = (obj.flags | 0x80080000) | 0;
  const blk = Boss3BlockNew();
  t.block = blk;
  blk.boneCount = 0x1b; blk.weakBone = 0x18; blk.jawA = 0x19; blk.jawB = 0x1a;
  blk.pathCursor = 0;
  blk.pathCursorWeak = 0;
  if (G.g_boss3_variant === 0) {
    blk.bodyTables = Boss3BodyTables.A;
    blk.lastSegment = 7;
  } else {
    blk.bodyTables = Boss3BodyTables.B;
    blk.lastSegment = 8;
    Boss3SpawnPathEffects();
  }
  blk.eventIndex = 0; blk.cursorHold = 0; blk.hits = 0; blk.camFreeze = 0;
  blk.flashClock = 0; blk.splashLatch = 0; blk.laps = 0;
  for (let i = 0; i < BOSS3_MAX_BONES; i++) {
    blk.extraX[i] = 0; blk.extraY[i] = 0; blk.extraZ[i] = 0;
    blk.anchorX[i] = obj.pos.x; blk.anchorZ[i] = obj.pos.z;
    blk.pitch[i] = 0; blk.yaw[i] = 0;
    t.boneRot[i * 3] = 0; t.boneRot[i * 3 + 1] = 0; t.boneRot[i * 3 + 2] = 0;
  }
  G.g_enemies_present += 1;                       // `0x00420522`
  G.g_enemies_alive += 1;                         // `0x00420529`
  t.routine = Boss3Routine.BodyUpdate;
}

/**
 * `Boss3BodyBuildPathSegment` — `FUN_00424190`. Every frame of one `op_`
 * segment, `CamEvalObjectPath6(path, (float)f)`, onto the end of the
 * block's point list, counting in `obj+0x1334`.
 */
export function Boss3BodyBuildPathSegment(k: number, obj: Boss3Actor,
                                          host: GameHost): void {
  const blk = obj.boss3.block;
  if (!blk) return;
  const seg = ObjPaths(blk)[k];
  if (!seg) return;
  for (let fr = seg.from; fr <= seg.to; fr++) {
    const p = host.objectPath?.(seg.path, Math.fround(fr)) ?? null;
    const n = obj.boss3.camFrame;
    if (n < BOSS3_MAX_PATH_POINTS) {
      blk.points[n * 3] = Math.fround(p?.x ?? 0);
      blk.points[n * 3 + 1] = Math.fround(p?.y ?? 0);
      blk.points[n * 3 + 2] = Math.fround(p?.z ?? 0);
    }
    obj.boss3.camFrame = n + 1;
  }
}

const _pose: CamPose = { eye: vec3(), target: vec3(), roll: 0 };

/**
 * `Boss3BodyMoveAndDriveCamera` — `FUN_00424250`. Places the body on its path
 * (lerping toward the camera through a lunge, back through a recovery, and
 * on variant 1 blended toward two fixed points), steps the path cursor
 * (a lap restarts at `0x11E` or `0xDD`), and evaluates the camera segment
 * into `g_camera_block_eye` -- the frozen one while `+0x7642` counts down --
 * with the target and roll thrown away. Outside state 9 it steps the camera
 * frame and segment.
 */
export function Boss3BodyMoveAndDriveCamera(obj: Boss3Actor,
                                            host: GameHost): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk) return;
  const variant = G.g_boss3_variant;
  const pts = blk.points;
  const cur = blk.pathCursor;
  const px = pts[cur * 3] ?? 0, pz = pts[cur * 3 + 2] ?? 0;
  const eye = G.g_camera_block_eye;
  if (obj.state === Boss3BodyState.Lunge) {
    let f = 1;
    const c = blk.hitFrame;
    if (c !== 0) {
      if (variant === 1) {
        if (blk.eventIndex === 0) f = LUNGE_FAST;
        if (blk.eventIndex === 4) f = LUNGE_SLOW;
      }
      obj.pos.x = Math.fround((eye.x - blk.lungeX) * t.blend / c * f
                              + blk.lungeX);
      obj.pos.z = Math.fround((eye.z - blk.lungeZ) * t.blend / c * f
                              + blk.lungeZ);
    }
    t.blend = Math.fround(t.blend + LUNGE_RATE);
  } else if (obj.state === Boss3BodyState.Recover) {
    obj.pos.x = Math.fround((px - blk.lungeX) * t.blend + blk.lungeX);
    obj.pos.z = Math.fround((pz - blk.lungeZ) * t.blend + blk.lungeZ);
  } else {
    obj.pos.x = px;
    obj.pos.z = pz;
    if (variant === 1) {
      if (cur >= BLEND1_FROM && cur <= BLEND1_TO) {
        const k = cur - BLEND1_FROM;
        obj.pos.x = Math.fround(k * (BLEND1_X - px) * BLEND1_RATE + px);
        obj.pos.z = Math.fround(k * (BLEND1_Z - pz) * BLEND1_RATE + pz);
      }
      if (cur >= BLEND2_FROM && cur <= BLEND2_TO) {
        const k = cur - BLEND2_FROM;
        obj.pos.x = Math.fround(k * (BLEND2_X - px) * BLEND2_RATE + px);
        obj.pos.z = Math.fround(k * (BLEND2_Z - pz) * BLEND2_RATE + pz);
      }
    }
    if (variant === 0) {
      obj.pos.y = SWIM_Y_A;
      if (cur <= APPROACH_END) {
        obj.pos.z = Math.fround((APPROACH_END - cur) * APPROACH_RATE
                                + obj.pos.z);
      }
    } else if (blk.eventIndex === 0
               && ((cur > DIVE_LATE && obj.motion !== CLIP_SURFACE)
                   || (cur > DIVE_EARLY_FROM && cur < DIVE_EARLY_TO))) {
      obj.pos.y = Math.fround((DIVE_Y - obj.pos.y) * DIVE_RATE + obj.pos.y);
    } else {
      obj.pos.y = SWIM_Y_B;
    }
  }
  if (blk.cursorHold > 0) blk.cursorHold -= 1;
  if (blk.cursorHold <= 0) {
    blk.pathCursor = ((blk.pathCursor + 1) << 16) >> 16;
    if (blk.pathCursor >= blk.pathCount) {
      blk.laps = ((blk.laps + 1) << 16) >> 16;
      blk.pathCursor = variant !== 0 ? BOSS3_PATH_RESTART_B : BOSS3_PATH_RESTART_A;
    }
  }
  const cams = CamPaths(blk);
  let seg: Boss3PathSeg | undefined;
  let frame: number;
  if (blk.camFreeze > 0) {
    blk.camFreeze -= 1;
    seg = cams[blk.frozenSegment];
    frame = blk.frozenFrame;
  } else {
    seg = cams[t.counter];
    frame = t.camFrame;
  }
  // `CamEvalPath7(slot, (float)frame, &g_camera_block_eye, &local...)` --
  // the eye alone: the target and roll go to locals and are dropped.
  const path = seg ? host.camPath?.(seg.path) ?? null : null;
  if (path) {
    path.pose(Math.fround(frame), false, _pose);
    eye.x = Math.fround(_pose.eye.x);
    eye.y = Math.fround(_pose.eye.y);
    eye.z = Math.fround(_pose.eye.z);
  }
  if (variant === 0) eye.y = Math.fround(eye.y + CAM_LIFT);
  if (obj.state !== Boss3BodyState.TakeCamera) {
    t.camFrames += 1;
    t.camFrame += 1;
    const now = cams[t.counter];
    if (now && t.camFrame > now.to) {
      t.counter += 1;
      if (t.counter > blk.lastSegment) {
        t.counter = 1;
        if (variant === 0) {
          t.camFrame = CAM_RESTART_A;
          t.camFrames = CAM_RESTART_FRAMES_A;
        } else {
          t.camFrame = CAM_RESTART_B;
          t.camFrames = CAM_RESTART_B;
        }
      } else {
        t.camFrame = cams[t.counter]?.from ?? 0;
      }
    }
  }
}

/** The world point of a bone's matrix origin, as the class reads one back. */
function BoneWorld(obj: Boss3Actor, bone: number): { x: number; y: number;
                                                      z: number } {
  const o = bone * 3;
  const b = obj.boss3.boneOrigin;
  return { x: b[o], y: b[o + 1], z: b[o + 2] };
}

/** `ScoreAddForPlayer`'s player for the kill, a second draw when both fired. */
function Killer(obj: Boss3Actor, f: ClassFrame): number {
  const p0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const p1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  if (p0 && p1) return CrtRand(f.rng) & 1;
  return p0 ? 0 : 1;
}

/** Enough hits to send it back under: 3 with two players, 2 with fewer. */
function Retreats(blk: Boss3Block): boolean {
  const n = G.g_players_in_play;
  if (n === 2) return blk.hits >= RETREAT_2P;
  if (n < 2) return blk.hits >= RETREAT_1P;
  return false;
}

/** `+0x59E` one on, past 6 to 1 (variant 0) or 0. */
function NextEvent(blk: Boss3Block): void {
  blk.eventIndex = (blk.eventIndex + 1) & 0xff;
  if (blk.eventIndex > EVENT_LAST) {
    blk.eventIndex = G.g_boss3_variant === 0 ? 1 : 0;
  }
}

/**
 * `Boss3BodyUpdate` — `FUN_004231C0`. The shot (any state, but only a
 * surfacing or a lunge with the mouth open on bone `0x18` does damage), the
 * seven states, and the tail: the draw and the pose, `obj+0x100` on the weak
 * bone, and in states 10..13 the camera block's yaw and pitch turned onto it
 * and the shot test.
 */
export function Boss3BodyUpdate(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk) return;
  G.g_boss3_heads[0] = obj.at;
  const variant = G.g_boss3_variant;

  // -- 1. the shot.
  if (obj.flags & ActorFlag.Hit) {
    const p = Killer(obj, f);
    const s = obj.state;
    let ok = s === Boss3BodyState.Surfaced || s === Boss3BodyState.Lunge;
    if (ok) {
      ok = ((obj.flags & ActorFlag.HitByPlayer0) !== 0
            && obj.shotBones[0] === BODY_WEAK)
        || ((obj.flags & ActorFlag.HitByPlayer1) !== 0
            && obj.shotBones[1] === BODY_WEAK);
    }
    if (ok) {
      const a = t.boneRot[blk.jawA * 3 + 2];
      const b = t.boneRot[blk.jawB * 3 + 2];
      if (Math.abs((a - b) | 0) <= JAW_OPEN) ok = false;
    }
    if (ok) {
      ScoreAddForPlayer(p, HIT_POINTS, f.events);
      SpawnBoneHitSprite(obj.at, obj.shotBones[p] ?? 0);
      blk.hits = (blk.hits + 1) & 0xff;
      // The body's weapon scale is the shooter's own: no second draw.
      const m = G.g_GameMode === GameMode.Original
        ? ((G.g_original_weapon_damage_scale[p] ?? 1) === -1
          ? 2 : (G.g_original_weapon_damage_scale[p] ?? 1))
        : 1;
      const d = Math.trunc(m * (G.g_players_in_play === 2
        ? BODY_DAMAGE_2P : BODY_DAMAGE_1P));
      obj.hp = ((obj.hp + d) << 16) >> 16;
      G.g_boss_hp_fraction = Math.fround(obj.hp * BODY_BAR_SCALE); // `0x00423329`
      if (G.g_boss_hp_fraction < 0) G.g_boss_hp_fraction = 0;     // `0x0042333C`
      if (obj.hp <= 0) Boss3BodyDie(obj, f);
    } else {
      PlaySoundId(SOUND_MISS, f.events);
      Boss3SpawnBoneSpark(obj.at, obj.shotBones[p] ?? 0);
    }
    obj.flags &= ~(ActorFlag.Hit | ActorFlag.HitByPlayer0
                   | ActorFlag.HitByPlayer1);
  }

  // -- 2. the state, before the draw: it reads the last frame's cursor.
  switch (obj.state) {
    case Boss3BodyState.BuildPath:
      Boss3BodyBuildPathSegment(t.counter, obj, f.host);
      t.counter += 1;
      if (t.counter > blk.lastSegment) {
        t.counter = 0;
        blk.pathCount = (t.camFrame << 16) >> 16;
        t.camFrame = 0;
        obj.pos.x = blk.points[blk.pathCursor * 3] ?? 0;
        obj.pos.z = blk.points[blk.pathCursor * 3 + 2] ?? 0;
        obj.state = Boss3BodyState.TakeCamera;
      }
      break;
    case Boss3BodyState.TakeCamera:
      obj.state = Boss3BodyState.Swim;
      G.g_camera_driver_held = 1;
      // The body eases from the block's yaw and pitch as they stand: the
      // camera block carries its angles every frame (`UpdateSceneViewAndLight`
      // reads them back out of the view it builds), so there is nothing to
      // seat.
      break;
    case Boss3BodyState.Swim:
      Boss3BodyStateSwim(obj, f);
      break;
    case Boss3BodyState.Surfaced:
      Boss3BodyStateSurfaced(obj, f);
      break;
    case Boss3BodyState.Lunge:
      Boss3BodyStateLunge(obj, f);
      break;
    case Boss3BodyState.Recover:
      Boss3BodyMoveAndDriveCamera(obj, f.host);
      if (variant === 0 && t.cursor === blk.hitFrame + 4
          && blk.eventIndex !== 3) {
        PlaySoundId(SOUND_SIBUKI2, f.events);
      }
      if (!(t.blend < 1)) obj.state = Boss3BodyState.Swim;
      t.blend = Math.fround(t.blend + RECOVER_RATE);
      Boss3ModelStep(obj);
      break;
    case Boss3BodyState.Dead:
      if (!Boss3BodyStateDead(obj, f)) return;
      break;
    default:
      break;
  }

  // -- 3. the tail (`0x00423F2C`).
  Boss3DrawModel(obj);
  if (obj.state !== Boss3BodyState.Dead) obj.yaw = 0x8000;
  Boss3ComposeBonePose(obj);
  if (obj.state !== Boss3BodyState.BuildPath
      && obj.state !== Boss3BodyState.TakeCamera) {
    Boss3DrawBoneParts(obj, f.events);
  }
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  const w = blk.weakBone * 3;
  obj.lookAt.x = t.bonePoint[w];
  obj.lookAt.y = t.bonePoint[w + 1];
  obj.lookAt.z = t.bonePoint[w + 2];
  const s = obj.state;
  if (s === Boss3BodyState.Swim || s === Boss3BodyState.Surfaced
      || s === Boss3BodyState.Lunge || s === Boss3BodyState.Recover) {
    Boss3AimCamera(obj);
    // `PUSH ESI; CALL 0x00405160` at `0x00424160`, on the aim's path: the
    // state test at `0x00424062`..`0x00424082` jumps past it to the `RET`
    // for anything but 10..13, so building its path, taking the camera and
    // dead the body cannot be shot.
    RegisterForShotTest(obj, f.host);
  }
}

/**
 * The tail's aim, `0x00424088`: `VecToAngles` (`FUN_004016B0`) of the eye
 * from the weak bone; unless the lunge has frozen the camera, the block's yaw
 * eases an eighth of the way onto it and -- in the surfacing and lunge clips
 * -- its pitch a quarter, never below level; otherwise the pitch is level.
 * These are camera block 0's words, `0x009A60D0` and `0x009A60CC`.
 */
function Boss3AimCamera(obj: Boss3Actor): void {
  const blk = obj.boss3.block!;
  const eye = G.g_camera_block_eye;
  const a = VecToAngles(eye.x - obj.lookAt.x, eye.y - obj.lookAt.y,
                        eye.z - obj.lookAt.z);
  const yaw = FtolS16(a.yaw);
  const pitch = FtolS16(a.pitch);
  if (blk.camFreeze <= 0) {
    const old = G.g_camera_block_yaw_bams & 0xffff;
    let d = (yaw - old) & 0xffff;
    if (d > 0x8000) d -= 0x10000;
    G.g_camera_block_yaw_bams = old + Math.trunc(d / 8);
    if (PITCH_CLIPS.has(obj.motion)) {
      const pb = G.g_camera_block_pitch_bams;
      let np = pb + Math.trunc((pitch - pb) / 4);
      if (np < 0) np = 0;
      G.g_camera_block_pitch_bams = np;
    } else {
      G.g_camera_block_pitch_bams = 0;
    }
  } else {
    G.g_camera_block_pitch_bams = 0;
  }
  // No look-at is written. The view is built from these two words
  // (`UpdateSceneViewAndLight`, `FUN_00401F40`: `T(eye) Ry(yaw) Rx(pitch)`),
  // and the block's target keeps what it had when the body took the camera,
  // as the engine's does -- the hand-back turns from it.
}

/** The death, from the shot (`0x00423355`). */
function Boss3BodyDie(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block!;
  ScoreAddForPlayer(Killer(obj, f), KILL_POINTS, f.events);
  G.g_boss_hp_fraction = 0;                       // `0x00423392`
  obj.state = Boss3BodyState.Dead;
  obj.dead = true;
  t.unread133C = 0;
  Boss3SetMotion(obj, CLIP_DEATH);
  const at = G.g_boss3_variant === 0 ? DEATH_POS_A : DEATH_POS_B;
  obj.pos.x = at.x; obj.pos.y = at.y; obj.pos.z = at.z;
  obj.yaw = DEATH_YAW;
  blk.bobPhase = 0;
  blk.bobRate = BOB_RATE;
  t.bob = BOB_START;
  G.g_enemies_present -= 1;                       // `0x0042340C`
  G.g_enemies_alive -= 1;                         // `0x00423413`
  G.g_camera_driver_held = 0;
  G.g_camera_free = 1;
  G.g_camera_hand_back_started = 0;
  Boss3PlayStageSound(7, f.events);
  if (G.g_GameMode === GameMode.Boss) G.g_boss_engaged = 0;
}

/** State 10, `0x00423536`: the swim. */
function Boss3BodyStateSwim(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block!;
  const variant = G.g_boss3_variant;
  if (variant === 0 && blk.pathCursor === CUE_SPLASH) {
    PlaySoundId(SOUND_SIBUKI2, f.events);
    PoseHookNone(4, 0x1e);
  }
  if (variant === 1 && blk.pathCursor === CUE_BULGE) Boss3SpawnMeshBulge();
  if (blk.pathCursor === CUE_LINE) {
    // `EvtOpPlayDialogue2D` (`FUN_00435B80`) with group 0x83, then the shutter.
    EvtOpPlayDialogue2D(LINE_GROUP, f.events);
    G.g_bHudShutterState = SHUTTER_CLOSED;
  }
  if (blk.pathCursor === CUE_BAR) G.g_bHudShutterState = SHUTTER_OPENING;
  const clip = obj.motion;
  if (variant === 0) {
    const splash = (clip === CLIP_SURFACE && t.cursor === 0x36
                    && blk.eventIndex !== 3)
      || ((clip === CLIP_LUNGE_ODD || clip === CLIP_LUNGE_EVEN)
          && t.cursor === blk.hitFrame + 4 && blk.eventIndex !== 3);
    if (splash) {
      const w = BoneWorld(obj, blk.jawB);
      PlaySoundId(SOUND_SIBUKI2, f.events);
      PoseHookNone(6, 0x1e);
      Boss3SpawnSplashAt(w.x, SPLASH_Y_A, w.z, 0);
    }
    if (t.counter === JUMP_A_SEG && t.camFrame === JUMP_A_FRAME
        && blk.pathCursor !== JUMP_A_TO) {
      blk.pathCursor = JUMP_A_TO;
    }
  } else {
    if (clip === CLIP_SURFACE && t.cursor === 0x36) {
      const w = BoneWorld(obj, blk.weakBone);
      PlaySoundId(SOUND_BOMB1, f.events);
      PoseHookNone(6, 0x1e);
      G.g_screen_shake_frames = SHAKE_BIG;
      Boss3SpawnSplashAt(w.x, SPLASH_Y_B, w.z, 1);
    }
    if (t.counter === JUMP_B_SEG && t.camFrame === JUMP_B_FRAME
        && blk.pathCursor !== JUMP_B_TEST) {
      blk.pathCursor = JUMP_B_TO;
    }
  }
  Boss3BodyMoveAndDriveCamera(obj, f.host);
  if (blk.pathCursor === CUE_BAR) {
    BossHpBarSpawn(BOSS3_BAR_X, BOSS3_BAR_Y);     // `0x004237B2`
    G.g_boss_hp_fraction = 1;                     // `0x004237BA`
  }
  const ev = Events(blk)[blk.eventIndex];
  if (ev && ev.start === blk.pathCursor) {
    obj.state = Boss3BodyState.Surfaced;
    blk.hits = 0;
    Boss3SetMotion(obj, CLIP_SWIM);
    Boss3PlayStageSound(3, f.events);
  }
  if (variant === 0 && blk.eventIndex <= 0) return;
  if (t.cursor === MotionPlayLength(obj, obj.motion) - 1
      && obj.motion !== CLIP_SWIM) {
    Boss3SetMotion(obj, CLIP_SWIM);
    t.modelFrame = 0;
  }
  if (obj.motion === CLIP_SWIM && t.cursor === 0) return;
  Boss3ModelStep(obj);
}

/** State 11, `0x0042385E`: surfaced. */
function Boss3BodyStateSurfaced(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block!;
  Boss3BodyMoveAndDriveCamera(obj, f.host);
  if (Retreats(blk)) {
    Boss3PlayStageSound(1, f.events);
    NextEvent(blk);
    obj.state = Boss3BodyState.Swim;
    blk.lungeX = obj.pos.x;
    blk.lungeZ = obj.pos.z;
    t.blend = 0;
    Boss3SetMotion(obj, CLIP_SURFACE);
    return;
  }
  const evs = Events(blk);
  const e = blk.eventIndex;
  if (G.g_boss3_variant === 0) {
    let go: boolean;
    if (e === EVENT_LAST) {
      go = blk.pathCursor < evs[6].start && evs[6].end === blk.pathCursor;
    } else {
      go = evs[e]?.end === blk.pathCursor;
    }
    if (go) {
      obj.state = Boss3BodyState.Lunge;
      if ((e & 1) === 0) {
        Boss3SetMotionBlended(obj, CLIP_LUNGE_EVEN, 0, 4);
        blk.hitFrame = HIT_EVEN;
      } else {
        Boss3SetMotionBlended(obj, CLIP_LUNGE_ODD, 0, 4);
        blk.hitFrame = HIT_ODD;
      }
      blk.lungeX = obj.pos.x;
      blk.lungeZ = obj.pos.z;
      t.blend = 0;
      PlaySoundId(SOUND_SIBUKI3, f.events);
      Boss3PlayStageSound(4, f.events);
    }
  } else if (evs[e]?.end === blk.pathCursor) {
    obj.state = Boss3BodyState.Lunge;
    const clip = BOSS3_BODY_ATTACK_MOTIONS_B[e] ?? CLIP_LUNGE_ODD;
    Boss3SetMotion(obj, clip);
    blk.hitFrame = HIT_B;
    if (clip === CLIP_LUNGE_ODD) blk.hitFrame = HIT_ODD;
    blk.lungeX = obj.pos.x;
    blk.lungeZ = obj.pos.z;
    t.blend = 0;
    Boss3PlayStageSound(4, f.events);
    obj.pos.y = LUNGE_Y;
  }
  if (t.cursor !== SURFACE_HOLD) Boss3ModelStep(obj);
}

/** State 12, `0x00423A97`: the lunge. */
function Boss3BodyStateLunge(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block!;
  Boss3BodyMoveAndDriveCamera(obj, f.host);
  if (Retreats(blk)) {
    PlaySoundId(SOUND_STAGE3_BOSS3_1, f.events);
    NextEvent(blk);
    obj.state = Boss3BodyState.Swim;
    Boss3SetMotionBlended(obj, CLIP_SURFACE, 8, 0xc);
    blk.lungeX = obj.pos.x;
    blk.lungeZ = obj.pos.z;
    t.blend = 0;
    blk.frozenSegment = (t.counter << 16) >> 16;
    blk.frozenFrame = (t.camFrame << 16) >> 16;
    return;
  }
  if (t.cursor === blk.hitFrame) {
    blk.camFreeze = CAM_FREEZE;
    if (G.g_scene_state_major_entered === 2 && G.g_players_in_play > 0
        && (G.g_player_state[0] === PlayerState.InPlay
            || G.g_player_state[1] === PlayerState.InPlay)) {
      if (G.g_players_in_play === 2) {
        PlayerTakeDamage(0, 1, 9, f.events, obj);
        PlayerTakeDamage(1, 1, 9, f.events, obj);
      } else {
        if (G.g_active_player === 0) t.bitePlayer = 0;
        if (G.g_active_player === 1) t.bitePlayer = 1;
        PlayerTakeDamage(t.bitePlayer, 1, 9, f.events, obj);
      }
    }
    NextEvent(blk);
    blk.lungeX = obj.pos.x;
    blk.lungeZ = obj.pos.z;
    obj.state = Boss3BodyState.Swim;
    t.blend = 0;
    blk.frozenSegment = (t.counter << 16) >> 16;
    blk.frozenFrame = (t.camFrame << 16) >> 16;
  }
  Boss3ModelStep(obj);
}

/**
 * State 14, `0x00423D09`: dead. Returns false when it despawns, which it does
 * on `g_script_flags[4]` -- `BossModeRecordGrade` (`FUN_00425F40`) first,
 * which returns at once outside Boss Mode, the only mode a stage the port
 * enters is played in.
 */
function Boss3BodyStateDead(obj: Boss3Actor, f: ClassFrame): boolean {
  const t = obj.boss3;
  const blk = t.block!;
  if (!t.clipEnded) Boss3ModelStep(obj);
  if (G.g_script_flags[4] === 1) {
    ActorDespawn(obj);
    return false;
  }
  const cur = t.cursor;
  if (G.g_boss3_variant === 0) {
    if (cur >= SINK_FROM && cur <= DEATH_CUE) {
      obj.pos.y = Math.fround((DEATH_CUE - cur) * SINK_RATE - WATER_LINE);
    }
    if (cur === DEATH_CUE) {
      PlaySoundId(SOUND_SIBUKI2, f.events);
      PoseHookNone(6, 0x1e);
      const w = BoneWorld(obj, blk.jawB);
      Boss3SpawnSplashAt(w.x, SPLASH_Y_A, w.z, 0);
    }
    if (cur >= DEATH_CUE) {
      obj.pos.y = Math.fround(Math.sin(blk.bobPhase * BAMS_TO_RAD_F64)
                              * t.bob - WATER_LINE);
      blk.bobPhase = (blk.bobPhase + blk.bobRate) | 0;
      if (blk.bobPhase % 0x10000 === 0) {
        t.bob = Math.fround(t.bob * BOB_DECAY);
      }
    }
  } else if (cur === DEATH_CUE) {
    PlaySoundId(SOUND_BOMB1, f.events);
    G.g_screen_shake_frames = SHAKE_BIG;
    PoseHookNone(6, 0x1e);
    const w = BoneWorld(obj, blk.jawB);
    Boss3SpawnSplashAt(w.x, SPLASH_Y_DEAD_B, w.z, 1);
  }
  return true;
}
