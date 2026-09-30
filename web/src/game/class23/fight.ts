/**
 * Class 0x23's fight and fall — `Class23FightBesideCompanion`
 * (`FUN_00490150`), `Class23TakeShots` (`FUN_00491420`), `Class23Collapse`
 * (`FUN_00490B00`), `Class23LieUntilCameraCue` (`FUN_00490C50`) and the two
 * small routines they share.
 *
 * The walker is the flier's shield: it walks at the camera on root motion,
 * swings at the player when the camera is in reach, and every shot it takes
 * is ten points and **one hit point off the flier** -- `Class23TakeShots`
 * adds 1.0 a hit into the flier's `+0x132C` -- while its own hit points never
 * move outside Training. It falls on the frame the flier's hit points reach
 * its own (90, the flier's phase-2 floor).
 */
import { ActorFlag, type Actor, type JudgmentCompanionActor } from "../actor";
import { ActorRegisterCameraPoint } from "../camera/track";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ScoreAddForPlayer } from "../combat/score";
import { RegisterForShotTest } from "../combat/shot_test";
import { GameMode } from "../game_mode";
import { ActorByAt, G } from "../globals";
import { CameraBlockEye } from "../camera/view";
import { ActorReleaseHitSlot } from "../hit_slots";
import type { GameHost } from "../host";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint,
} from "../matrix";
import { ActorAdvanceMotion } from "../motion";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { MotionPlayLength } from "../tables";
import { VecToAngles, type Vec3 } from "../vec";
import { Class22SampleCursor, JudgmentEmitTrackedBone }
  from "../class22/draw";
import { ActorDespawn } from "../despawn";
import type { SpriteEffect } from "../effects/sprite";
import { Class22FaceCamera } from "../class22/paths";
import {
  Class22PlaySound, Class22StrikePlayers,
  JudgmentReleaseEnemySlot,
} from "../class22/shot";
import {
  ARENA0_X_MIN, ARENA0_Z_MAX, ARENA0_Z_MIN, ARENA1_X_MAX, ARENA1_X_MIN,
  ARENA1_Z_MIN, BACK_OFF_DISTANCE, CLASS23_AFTER_STRIKE, CLASS23_BACK_OFF,
  CLASS23_BLEND_AFTER_REACT, CLASS23_BLEND_AFTER_STRIKE, CLASS23_BLEND_WALK,
  CLASS23_KNOCKBACK_BY_RANK, CLASS23_MOTION_IDS, CLASS23_REACT,
  CLASS23_REACT_FOLLOW, CLASS23_STRIKES, CLASS23_WALK, Class23BlendStart,
  Class23Motion, LIE_X_MAX,
} from "./records";
import { Class23State, Class23Subtype }
  from "./state";

/** `obj+0x34` bits the pair signal each other with. */
const STRIKING = 0x10000000;
const REACTING = 0x40000000;
/** `0x18` — the screen shake a footstep or a landing strike sets, if none is running. */
const SHAKE_STEP = 0x18;
/** The strike's axe sound: `STAGE1_SE\AXE_44K` / its stage-5 copy. */
const SND_AXE: Readonly<Record<number, number>> = {
  [Class23Subtype.Stage1]: 0x18a9, [Class23Subtype.Stage5]: 0x2423a9,
};
/** The walk's footfall, `BOS_WALK1_44`. */
const SND_WALK1: Readonly<Record<number, number>> = {
  [Class23Subtype.Stage1]: 0x218a9, [Class23Subtype.Stage5]: 0x2523a9,
};
/** The heavy footfall, `BOS_WALK3`. */
const SND_WALK3: Readonly<Record<number, number>> = {
  [Class23Subtype.Stage1]: 0x418a9, [Class23Subtype.Stage5]: 0x2723a9,
};
/** `COMMON2\ZOMBIE_007_16` — the back-off's groan. */
export const SND_GROAN = 0x417a9;
/** `SWORD11_22` — the react's follow-on swing. */
const SND_SWORD = 0x3c16a9;
/** The sparks' sounds, `BULLET_OTH1` and `BULLET_SND1`. */
const SND_RICOCHET_A = 0x1216a9;
const SND_RICOCHET_B = 0x1316a9;
/** `DOORKICK3_22K_1` — the collapse hitting the ground. */
const SND_COLLAPSE = 0x2216a9;

/**
 * The walk clips' footfall cursors: 0x393 at `0x37 0x81 0xCF 0x11A` (the byte
 * table at `0x00490A08`) and 0x394 at `0x2D 0x67 0xA7 0xE1` (`0x00490948`).
 */
const WALK_STEPS: Readonly<Record<number, readonly number[]>> = {
  0x393: [0x37, 0x81, 0xcf, 0x11a],
  0x394: [0x2d, 0x67, 0xa7, 0xe1],
};
/** The post-strike clips' heavy footfalls: 0x390 at `0x4B 0xA6`, 0x391 at `0x3C 0x84`. */
const AFTER_STRIKE_STEPS: Readonly<Record<number, readonly number[]>> = {
  0x390: [0x4b, 0xa6],
  0x391: [0x3c, 0x84],
};
/** The back-off clips' last cursors: 0x38E at `0x72`, 0x38F at `0x5B`. */
const BACK_OFF_END: Readonly<Record<number, number>> = { 0x38e: 0x72, 0x38f: 0x5b };
/** The react clips' footfalls: 0x388 at `0x39 0x5A`, 0x389 at `0x2F 0x48`. */
const REACT_STEPS: Readonly<Record<number, readonly number[]>> = {
  0x388: [0x39, 0x5a],
  0x389: [0x2f, 0x48],
};
/** The follow-on's swings: 0x38B at `0x0F 0x1E 0x28`, 0x38C at `0x0D 0x18 0x1E`. */
const REACT_FOLLOW_SWINGS: Readonly<Record<number, readonly number[]>> = {
  0x38b: [0x0f, 0x1e, 0x28],
  0x38c: [0x0d, 0x18, 0x1e],
};
/** `0x38A` — the collapse. */
const CLIP_COLLAPSE = 0x38a;
/** `CMP [+0x19C], 0x68` — the collapse's impact frame. */
const COLLAPSE_IMPACT = 0x68;
/** `ActorRegisterCameraPoint(6.0)` — `PUSH 0x40C00000` at `0x00490917`. */
export const CLASS23_CAMERA_RISE = 6.0;
/** The flier's relative state and sub the lying walker moves on: its death orbit. */
const FLIER_DEATH = 3;
const FLIER_DEATH_ORBIT = 2;

/**
 * The parts that spark white rather than dust — `(part - 1)` through the byte
 * table at `0x004916C0` into `{0x5A, 0x5C}`: parts 1, 2, 3, 4, 6, 7, 9, 11 and
 * 14 take 0x5A.
 */
const SPARK_A_PARTS: readonly number[] = [1, 2, 3, 4, 6, 7, 9, 11, 14];

const _m = MatIdentity();
const _v: Vec3 = { x: 0, y: 0, z: 0 };
const BACK: Vec3 = { x: 0, y: 0, z: -1.0 };

function Flier(obj: JudgmentCompanionActor): Actor | undefined {
  return ActorByAt(obj.companion.companionAt);
}

/**
 * `Class23Draw` — `FUN_004916D0`. `g_cur_actor = obj; LightsUseSecondarySet;
 * DrawSkinnedModelAndShadow; LightsRestoreScene`. The draw's two answers are
 * recorded where it stands, and the frame is marked drawn -- see
 * `Class22DrawAndPoseSubActor`.
 */
export function Class23Draw(obj: JudgmentCompanionActor,
                            host: GameHost): void {
  obj.alpha = 1;
  Class22SampleCursor(obj, obj.companion);
  JudgmentEmitTrackedBone(obj, host);
}

/** `Class23Draw(obj); obj+0x194++` — the tail most paths end in. `[port-only]` as a function. */
export function Class23DrawAndStep(obj: JudgmentCompanionActor,
                                   f: ClassFrame): void {
  Class23Draw(obj, f.host);
  ActorAdvanceMotion(obj, f.dt);
}

/**
 * `Class23LatchCompanionHpStage` — `FUN_004913F0`.
 * `if (comp+0x1320 == 1) obj+0x1320 = 1`.
 */
export function Class23LatchCompanionHpStage(obj: JudgmentCompanionActor): void {
  const comp = Flier(obj);
  if (comp?.cls === SpawnClass.Judgment && comp.judgment.hpStage === 1) {
    obj.companion.hpStage = 1;
  }
}

/** A footfall: the shake if none is running, and the stage's sound. */
function Footfall(obj: JudgmentCompanionActor, f: ClassFrame,
                  sounds: Readonly<Record<number, number>>): void {
  if (G.g_screen_shake_frames === 0) G.g_screen_shake_frames = SHAKE_STEP;
  const id = sounds[obj.companion.subtype];
  if (id !== undefined) Class22PlaySound(f, id);
}

/**
 * `Class23FightBesideCompanion` — `FUN_00490150`. State 1 for subtypes 0 and 1.
 *
 * ```
 * d = |(x, z) - (eye.x, eye.z)|; comp+0x1370 = d
 * Class23TakeShots(obj)
 * if comp.hp <= obj.hp: alive--; blend 0x38A; state 2; sub 0;
 *     draw; ++; obj+0x34 &= ~8; RegisterForShotTest; return
 * if comp reacting and not obj: react; +0x1350 = sub; sub = 6
 * switch sub (0..6)
 * arena clamp; draw; ++; obj+0x34 &= ~8; ActorRegisterCameraPoint(6.0)
 * ```
 */
export function Class23FightBesideCompanion(obj: JudgmentCompanionActor,
                                            f: ClassFrame): void {
  // `g_camera_eye` by address (`0x0049015B`, `0x00490294`): the gameplay eye.
  const eye = G.g_camera_eye;
  const t = obj.companion;
  const comp = Flier(obj);
  const dz = obj.pos.z - eye.z;
  const dx = obj.pos.x - eye.x;
  const d = Math.fround(Math.sqrt(dz * dz + dx * dx));
  if (comp?.cls === SpawnClass.Judgment) comp.judgment.companionDist = d;
  Class23TakeShots(obj, f);
  // `MOVSX; CMP; JG` at `0x004901AC` -- the flier at or below the walker's
  // own hit points, which is 90 against 90 on the frame phase 2 begins.
  if (comp && comp.hp <= obj.hp) {
    G.g_enemies_alive -= 1;                            // 0x004901AE
    ActorSetMotionBlended(obj, CLIP_COLLAPSE, 0, 3);
    obj.state += 1;
    obj.sub = 0;
    Class23DrawAndStep(obj, f);
    obj.flags &= ~ActorFlag.Hit;
    // `RegisterForShotTest` at `0x004901E9`, on the `obj+0x70` the last
    // frame's `ActorRegisterCameraPoint` left: this arm writes no point.
    RegisterForShotTest(obj, f.host);
    return;
  }
  if (comp && (comp.flags & REACTING) !== 0 && (obj.flags & REACTING) === 0) {
    obj.flags |= REACTING;
    ActorSetMotionBlended(obj, Class23Motion(CLASS23_REACT, t.hpStage), 0, 3);
    t.savedSub = obj.sub;
    obj.sub = 6;
  }
  const clip = obj.motion;
  const cursor = t.cursor;
  // Sub 0 falls into sub 1.
  if (obj.sub === 0) {
    t.strike = f.rng.int(2);
    ActorSetMotionBlended(obj, Class23Motion(CLASS23_WALK, t.hpStage), 0, 5);
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1: {
      obj.yaw = Class22FaceCamera(obj.pos.x, obj.pos.z, eye.x, eye.z);
      if ((WALK_STEPS[obj.motion] ?? []).includes(cursor)) {
        Footfall(obj, f, SND_WALK1);
      }
      const rec = CLASS23_STRIKES[t.hpStage + t.strike * 2];
      if (rec.range < d || (obj.flags & REACTING) !== 0) break;
      ActorSetMotionBlended(obj, rec.motion, 0, 5);
      Footfall(obj, f, SND_WALK1);
      obj.sub += 1;
      obj.flags |= STRIKING;
      break;
    }
    case 2: {
      const rec = CLASS23_STRIKES[t.hpStage + t.strike * 2];
      if (cursor === rec.soundFrame && (obj.flags & REACTING) === 0) {
        const id = SND_AXE[t.subtype];
        if (id !== undefined) Class22PlaySound(f, id);
      }
      if (cursor === rec.hitFrame && (obj.flags & REACTING) === 0) {
        if (comp?.cls === SpawnClass.Judgment) {
          comp.judgment.companionStruck += 1;
        }
        Class22StrikePlayers(obj, f, rec.overlay);
      }
      if (t.done !== 0) {
        obj.flags &= ~STRIKING;
        ActorSetMotionBlended(
          obj, Class23Motion(CLASS23_AFTER_STRIKE, t.hpStage),
          Class23BlendStart(CLASS23_BLEND_AFTER_STRIKE, t.hpStage), 5);
        obj.sub += 1;
      }
      break;
    }
    case 3:
      if ((AFTER_STRIKE_STEPS[clip] ?? []).includes(cursor)) {
        Footfall(obj, f, SND_WALK3);
      }
      if (BACK_OFF_DISTANCE <= d && (obj.flags & REACTING) === 0) {
        ActorSetMotionBlended(obj, Class23Motion(CLASS23_BACK_OFF, t.hpStage),
                              0, 5);
        Class22PlaySound(f, SND_GROAN);
        obj.sub += 1;
      }
      break;
    case 4:
      if (BACK_OFF_END[clip] !== undefined && cursor === BACK_OFF_END[clip]) {
        obj.sub += 1;
      }
      break;
    case 5:
      if (G.g_active_player < 0) break;
      t.strike = f.rng.int(2);
      Class23LatchCompanionHpStage(obj);
      ActorSetMotionBlended(obj, Class23Motion(CLASS23_WALK, t.hpStage),
                            Class23BlendStart(CLASS23_BLEND_WALK, t.hpStage),
                            15);
      obj.sub = 1;
      break;
    case 6: {
      const react = Class23Motion(CLASS23_REACT, t.hpStage);
      const follow = Class23Motion(CLASS23_REACT_FOLLOW, t.hpStage);
      if (clip === react && (REACT_STEPS[clip] ?? []).includes(cursor)) {
        Footfall(obj, f, SND_WALK3);
      }
      if (clip === follow
          && (REACT_FOLLOW_SWINGS[clip] ?? []).includes(cursor)) {
        Class22PlaySound(f, SND_SWORD);
      }
      if (clip === react && cursor === MotionPlayLength(obj) - 1) {
        ActorSetMotionBlended(obj, follow, 0, 5);
      }
      if (obj.motion !== follow || cursor !== MotionPlayLength(obj) - 1) break;
      const was = obj.flags;
      obj.flags = was & ~REACTING;
      // The saved sub, through the jump table at `0x00490AEC`.
      switch (t.savedSub) {
        case 1:
        case 5:
          ActorSetMotionBlended(
            obj, CLASS23_MOTION_IDS[t.hpStage + t.savedSub * 2], 0, 5);
          obj.sub = t.savedSub;
          break;
        case 2:
        case 3:
          obj.flags = was & ~(REACTING | STRIKING);
          ActorSetMotionBlended(
            obj, Class23Motion(CLASS23_AFTER_STRIKE, t.hpStage),
            Class23BlendStart(CLASS23_BLEND_AFTER_REACT, t.hpStage), 20);
          obj.sub = 3;
          break;
        case 4:
          ActorSetMotionBlended(obj, Class23Motion(CLASS23_WALK, t.hpStage),
                                0, 5);
          obj.sub = 1;
          break;
        default:
          break;
      }
      break;
    }
    default:
      break;
  }
  // The arena clamp, `0x0049085F`.
  if (t.subtype === Class23Subtype.Stage1) {
    if (obj.pos.x < ARENA0_X_MIN) obj.pos.x = ARENA0_X_MIN;
    if (ARENA0_Z_MAX < obj.pos.z) obj.pos.z = ARENA0_Z_MAX;
    if (obj.pos.z < ARENA0_Z_MIN) obj.pos.z = ARENA0_Z_MIN;
  } else if (t.subtype === Class23Subtype.Stage5) {
    if (obj.pos.x < ARENA1_X_MIN) obj.pos.x = ARENA1_X_MIN;
    if (ARENA1_X_MAX < obj.pos.x) obj.pos.x = ARENA1_X_MAX;
    if (obj.pos.z < ARENA1_Z_MIN) obj.pos.z = ARENA1_Z_MIN;
  }
  Class23DrawAndStep(obj, f);
  obj.flags &= ~ActorFlag.Hit;
  // `ActorRegisterCameraPoint(6.0)` at `0x00490917`, no gate: the shot list
  // (its own tail call) and the camera candidacy, which the port answers
  // with `tracksCamera` reading `cameraListed`.
  ActorRegisterCameraPoint(obj, f.host, CLASS23_CAMERA_RISE);  // 0x00490917
  t.cameraListed = true;
}

/**
 * `Class23TakeShots` — `FUN_00491420`. Read from the instruction stream past
 * the `MatrixStackPop` the decompiler stops at (L35).
 *
 * ```
 * acc = 0.0; comp = obj+0x1394 unless Training
 * if !(obj+0x34 & 8): return
 * if !Training && state == 1 && sub == 1:           ; knockback, then on
 *     v = RotY(yaw + 0x8000) * (0, 0, -1)
 *     x += v.x * g_class23_knockback_by_rank[rank]; z += v.z * the same
 * for p in 0, 1:
 *     part = (s8)obj+0x190[p]
 *     if part:
 *         Training: hp -= 1
 *         else: ScoreAddForPlayer(p, 10)
 *               if state == 1: comp+0x135C++; acc += Original ? (*rec == -1 ? 2 : *rec) : 1.0
 *         the spark at the part (0x5A or 0x5C) and its sound
 *     obj+0x190[p] = 0; the part record's bits; obj+0x34 &= ~(1 << (p+1))
 * if !Training: comp+0x132C += __ftol(acc)
 * ```
 *
 * The spark is `SpawnSpriteEffectsTowardEye` (`FUN_00407BC0`) at the part's
 * view-space sphere centre pushed out by its extent.
 */
export function Class23TakeShots(obj: JudgmentCompanionActor,
                                 f: ClassFrame): void {
  const training = G.g_GameMode === GameMode.Training;
  const comp = training ? undefined : Flier(obj);
  if ((obj.flags & ActorFlag.Hit) === 0) return;
  if (!training && obj.state === Class23State.Fight && obj.sub === 1) {
    for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
    MatrixRotateY(_m, obj.yaw + 0x8000);
    MatrixTransformPoint(_m, BACK, _v);
    const k = CLASS23_KNOCKBACK_BY_RANK[G.g_damage_rank] ?? 0;
    obj.pos.x = Math.fround(_v.x * k + obj.pos.x);
    obj.pos.z = Math.fround(_v.z * k + obj.pos.z);
  }
  let acc = 0.0;
  for (let p = 0; p < 2; p++) {
    const part = (obj.shotBones[p] << 24) >> 24;
    if (part !== 0) {
      if (training) {
        obj.hp = ((obj.hp - 1) << 16) >> 16;
      } else {
        ScoreAddForPlayer(p, 10, f.events);
        if (obj.state === Class23State.Fight) {
          if (comp?.cls === SpawnClass.Judgment) {
            comp.judgment.companionHits += 1;
          }
          if (G.g_GameMode === GameMode.Original) {
            // `CMP [EBX], 0xBF800000; JNZ` -> `FADD [0x004E30F0]` 2.0, else
            // `FADD [EBX]`: `EBX` the player's
            // `g_original_weapon_damage_scale`, stepped by `0x14`.
            const scale = Math.fround(G.g_original_weapon_damage_scale[p] ?? 1);
            acc = Math.fround(scale === -1.0 ? acc + 2.0 : acc + scale);
          } else {
            acc = Math.fround(acc + 1.0);
          }
        }
      }
      const white = SPARK_A_PARTS.includes(part);
      if (Class23SparkPoint(obj, part, f.host, _pt)) {
        SpawnSpriteEffectsTowardEye(_pt, white ? SPARK_BURST : 0x5c, f.host);
      }
      Class22PlaySound(f, white ? SND_RICOCHET_A : SND_RICOCHET_B);
    }
    obj.shotBones[p] = 0;
    obj.flags &= ~(1 << (p + 1));
  }
  if (!training && comp?.cls === SpawnClass.Judgment) {
    comp.judgment.transfer = (comp.judgment.transfer + Math.trunc(acc)) | 0;
  }
}

/**
 * `Class23Collapse` — `FUN_00490B00`. State 2, every subtype.
 *
 * Still shot at while it falls -- ten points a hit, no transfer (the
 * transfer is state 1's). On the frame the collapse clip's cursor reaches
 * its play length (not one short) it leaves the present count, gives back
 * its slots, raises `0x8000` and lies down (state 3).
 */
export function Class23Collapse(obj: JudgmentCompanionActor,
                                f: ClassFrame): void {
  const t = obj.companion;
  const training = G.g_GameMode === GameMode.Training;
  if (!training) Class23TakeShots(obj, f);
  Class23Draw(obj, f.host);
  if (t.cursor === COLLAPSE_IMPACT) {
    G.g_screen_shake_frames = SHAKE_STEP;
    Class22PlaySound(f, SND_COLLAPSE);
  }
  if (t.cursor === MotionPlayLength(obj)) {
    G.g_enemies_present -= 1;                          // 0x00490B5C
    ActorReleaseHitSlot(obj);
    JudgmentReleaseEnemySlot(t);
    obj.sub = 0;
    obj.state += 1;
    obj.flags |= ActorFlag.NoShotTest;
    return;
  }
  ActorAdvanceMotion(obj, f.dt);
  if (!training) {
    // `obj+0x70 = g_camera_world_to_view * obj+0x100; obj+0x34 &= ~8;
    // RegisterForShotTest(obj)` at `0x00490BBF`..`0x00490C3B` -- past the
    // pop, read from the bytes. `obj+0x100` is the draw's
    // (`JudgmentEmitTrackedBone`); the port keeps `obj+0x70` in world space.
    obj.shotCentre.x = obj.lookAt.x;
    obj.shotCentre.y = obj.lookAt.y;
    obj.shotCentre.z = obj.lookAt.z;
    obj.flags &= ~ActorFlag.Hit;
    RegisterForShotTest(obj, f.host);                // 0x00490C3B
  }
}

/**
 * `Class23LieUntilCameraCue` — `FUN_00490C50`. State 3.
 *
 * The descriptor's camera cue takes it off the field. Drawn but **not**
 * advanced -- the collapse's last pose, held. When the flier's death orbit
 * starts (its relative state 3, sub 2) a walker lying at x greater than
 * -1091 is put at x -1091, once. Stage 1's walker is clamped to x >= -1040 by
 * its arena and so is always moved; stage 5's, clamped to 550..610, is moved
 * the whole width of the map.
 */
export function Class23LieUntilCameraCue(obj: JudgmentCompanionActor,
                                         f: ClassFrame): void {
  const d = obj.class23;
  if (d && G.g_active_cam_path === d.despawn_path
      && d.despawn_frame <= G.g_cam_path_frame) {
    ActorDespawn(obj);
    return;
  }
  Class23Draw(obj, f.host);
  const comp = Flier(obj);
  if (obj.sub === 0 && G.g_GameMode !== GameMode.Training
      && comp && comp.state === FLIER_DEATH && comp.sub === FLIER_DEATH_ORBIT) {
    if (LIE_X_MAX < obj.pos.x) obj.pos.x = LIE_X_MAX;
    obj.sub += 1;
  }
  void f;
}

/**
 * `SpawnSpriteEffectsTowardEye` — `FUN_00407BC0`, whose only callers are
 * `Class23TakeShots` and itself. One `SpriteEffectDrawAndTick` object at a
 * point, turned toward the camera block's eye, with its slot run and scale
 * chosen by kind; kind 0x5A is an empty object and three more:
 *
 * ```
 * obj = ActorAlloc(SpriteEffectDrawAndTick, 0x68); ActorClearGameFields(obj)
 * +0x38.. = pt; VecToAngles(block_eye - pt) -> +0x44 pitch, +0x48 yaw; +0x4C = 0
 * 0x5A: recurse 0x5B, 0x5C, 0x5D
 * 0x5B: slots 0xAA4..0xAB6, scale 4.0, roll 0xC000
 * 0x5C: slots 0xA87..0xAA3, scale 2.0, roll 0xC000
 * 0x5D: slots 0xAB7..0xAD3, scale 2.0
 * z = (g_camera_world_to_view * pt).z
 * if (-30.0 < z) { scale = z * -0.0333333 * scale; if (scale < 0.25) scale = 0.25 }
 * ```
 *
 * The objects are the port's sprite-effect pool (`effects/sprite.ts`), whose
 * step and draw are `SpriteEffectDrawAndTick`'s. The 0x5A object's own run is
 * slot 0 to 0: it draws `AssetDrawSlot(0)`, which is nothing, for one frame.
 */
export function SpawnSpriteEffectsTowardEye(pt: Vec3, kind: number,
                                           host: ClassFrame["host"]): void {
  const e: SpriteEffect = {
    id: G.g_sprite_effect_seq++,
    kind,
    pos: { x: pt.x, y: pt.y, z: pt.z },
    pitch: 0, yaw: 0, roll: 0,
    scale: { x: 0, y: 0, z: 0 },
    slot: 0, lastSlot: 0,
  };
  const eye = CameraBlockEye(G.g_camera_index);
  const a = VecToAngles(eye.x - pt.x, eye.y - pt.y, eye.z - pt.z);
  e.pitch = Math.trunc(a.pitch);
  e.yaw = Math.trunc(a.yaw);
  G.g_sprite_effects.push(e);
  const arm = SPARK_KINDS[kind];
  if (kind === SPARK_BURST) {
    for (const k of SPARK_BURST_PARTS) SpawnSpriteEffectsTowardEye(pt, k, host);
  } else if (arm) {
    e.slot = arm[0];
    e.lastSlot = arm[1];
    e.scale.x = e.scale.y = e.scale.z = arm[2];
    e.roll = arm[3];
  }
  if (host.viewSpaceOfPoint?.(e.pos, _v) && SPARK_NEAR_RANGE < _v.z) {
    let k = Math.fround(_v.z * SPARK_NEAR_RATE * e.scale.x);
    if (k < SPARK_NEAR_FLOOR) k = SPARK_NEAR_FLOOR;
    e.scale.x = e.scale.y = e.scale.z = k;
  }
}
/** Kind 0x5A, and the three it spawns. */
const SPARK_BURST = 0x5a;
const SPARK_BURST_PARTS: readonly number[] = [0x5b, 0x5c, 0x5d];
/** `[first slot, last slot, scale, roll]` by kind, the switch's literals. */
const SPARK_KINDS: Readonly<Record<number, readonly [number, number, number, number]>> = {
  0x5b: [0xaa4, 0xab6, 4.0, 0xc000],
  0x5c: [0xa87, 0xaa3, 2.0, 0xc000],
  0x5d: [0xab7, 0xad3, 2.0, 0],
};
/** `-30.0`, `-0.0333333` and `0.25` — the distance law's constants. */
const SPARK_NEAR_RANGE = -30.0;
const SPARK_NEAR_RATE = Math.fround(-0.0333333);
const SPARK_NEAR_FLOOR = 0.25;

/**
 * The part's spark point, as `Class23TakeShots` builds it: the part's
 * view-space sphere centre with its extent added to the depth,
 * `(rec+0x68, rec+0x6C, rec+0x70 + rec+0x78)`, carried back to the world
 * through `g_camera_blocks`. The part's sphere is the renderer's (the host's
 * `boneSphere`); the depth push is the port's arithmetic on it.
 */
function Class23SparkPoint(obj: JudgmentCompanionActor, part: number,
                           host: ClassFrame["host"], out: Vec3): boolean {
  const r = host.boneSphere?.(obj.at, part, _c);
  if (r === null || r === undefined) return false;
  if (!host.viewSpaceOfPoint?.(_c, _v)) return false;
  host.viewPoint(_v.x, _v.y, _v.z + r, out);
  return true;
}
const _c: Vec3 = { x: 0, y: 0, z: 0 };
const _pt: Vec3 = { x: 0, y: 0, z: 0 };
