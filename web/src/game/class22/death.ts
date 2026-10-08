/**
 * `Class22Death` — `FUN_0049C910`, `g_class22_states[5]` and `[9]` — and the
 * two script flags the whole fight exists to raise.
 *
 * The flier is shot down, waits for the camera to free itself, then **takes
 * the camera**: it raises `g_camera_driver_held` (`0x009CA094`) so
 * `CameraDriverSelectMode` parks in mode 6, and for 300 frames writes the
 * camera block itself -- an orbit round the falling body. On the orbit's
 * 300th frame it lets the camera go (and in Arcade puts the block back where
 * it found it) and raises the gate: `g_script_flags[3]` in stage 1
 * (`0x0049CC95`), `g_script_flags[0]` in stage 5 (`0x0049CC85`) -- the flags
 * `wait_script_flag 3` in stage 1 blocks 14/16 and `wait_script_flag 0` in
 * stage 5 block 1 are waiting for. Nothing else in either stage writes
 * either flag.
 *
 * The orbit at the routine's tail sits past a `MatrixStackPop` Ghidra
 * believes does not return (L35), and was read from the instruction stream.
 */
import { EvtOpPlayDialogue2D } from "../dialogue";
import type { JudgmentActor } from "../actor";
import { ActorSetMotion } from "../class30/motion_cue";
import { CamBlockSetAnglesFromLookAt, CameraPoseBlock } from "../camera/path";
import { SpawnBoneHitSprite } from "../effects/blood";
import { GameMode } from "../game_mode";
import { ActorByAt, G } from "../globals";
import { ActorReleaseHitSlot } from "../hit_slots";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { ActorAdvanceMotion } from "../motion";
import type { ClassFrame } from "../registry";
import { MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import { Class22DrawAndPoseSubActor } from "./draw";
import { Class22Despawn, Class22TailCueReached } from "./entrance";
import {
  CLASS22_LANDING_BASE, Class22Clip, Class22RdataF32, DEATH_FALL_JERK,
  DEATH_LAND_HEIGHT, DEATH_REST_HEIGHT, DEATH_STAGE5_Z_MAX,
  DEATH_STAGE5_Z_MIN,
} from "./records";
import { Class22PlaySound, JudgmentReleaseEnemySlot } from "./shot";
import { Class22Variant, type Class22Descriptor } from "./state";

/** `g_script_flags[3]` — stage 1's gate, `MOV byte [0x009C7203], 1` at `0x0049CC95`. */
export const CLASS22_STAGE1_DEAD_FLAG = 3;
/** `g_script_flags[0]` — stage 5's, `MOV byte [0x009C7200], 1` at `0x0049CC85`. */
export const CLASS22_STAGE5_DEAD_FLAG = 0;

/** Sub 1's seat, variant 1: `(-1066.2, 40.0, -490.2)`. */
const STAGE1_FALL_FROM = {
  x: Math.fround(-1066.2), y: 40.0, z: Math.fround(-490.2),
};
/** Sub 1's height, variant 2: `0x42200000`. */
const FALL_FROM_Y = 40.0;
/** `CMP [+0x194], 0x1C` — the frame sub 3 starts the fall on. */
const FALL_START_FRAME = 0x1c;
/** `CMP EAX, 0x84` — the counter holds here while the body falls. */
const FALL_HOLD_FRAME = 0x84;
/** `CMP EAX, 0x8D` — the landing reads its height below this counter. */
const LAND_TABLE_END = 0x8d;
/** `CMP EAX, 0x92` — the counter the impact flipbook and its sound start on. */
const IMPACT_FRAME = 0x92;
/** `PlaySoundId(0x002A16A9)` — `COMMON\ENE_WALK7_22`, the impact. */
const SND_IMPACT = 0x2a16a9;
/** `CMP [+0x1330], 0x12C` — the orbit's length. */
const ORBIT_FRAMES = 0x12c;
/** `+0x1330 * 8` — the orbit's turn per frame, in BAMS. */
const ORBIT_STEP = 8;
/** The orbit's eye, in the body's frame: `(10.0, 0, -20.0)`. */
const ORBIT_EYE = { x: 10.0, y: 0, z: -20.0 };
/** The orbit's eye height: 30.0 (`0x41F00000`) in stage 1, -32.6 (`0xC2026666`) in stage 5. */
const ORBIT_EYE_Y: Readonly<Record<number, number>> = {
  [Class22Variant.Stage1]: 30.0,
  [Class22Variant.Stage5]: Math.fround(-32.6),
};
/** The dying line, `ST1\33_ZEA.WAV`: dialogue group `0x1D`, stage 1 only. */
const DYING_LINE = 0x1d;
/** `obj+0x1338 = 2` — node 2's second cycle, for the fall. */
const NODE2_FALLING = 2;
/** `g_bHudShutterState = 5` at `0x0049CA16`. */
const SHUTTER_CLOSED = 5;

const _m = MatIdentity();
const ORIGIN = vec3();

/**
 * `Class22ImpactFlipbookUpdate` (`FUN_0049DEA0`)'s object: `ActorAlloc`ed by
 * sub 4 at the landing point, it draws asset slot `0x94 + n` (`common.bin`
 * 25..39) under `T(pos)`, steps `n` and `ActorKill`s itself after `n` 14 --
 * fifteen frames, the first on the frame it is made.
 *
 * `[port-only]` as a record: it is the port's slot-strip pool
 * (`effects/prop_strip.ts`), whose step and draw over `{first 0x94, last
 * 0xA2, no angles, scale 1}` are exactly these -- `PropStripEffectUpdate`'s
 * `++slot > last` is `n++ > 14`, and its draw is `T(pos)` when the angles
 * are zero and the scale 1. `delay` 0 and `slot` 0x94 put the first cel on
 * this frame, as the engine's appended task draws it on this frame.
 */
function Class22SpawnImpactFlipbook(obj: JudgmentActor): void {
  G.g_prop_strip_effects.push({
    id: G.g_prop_strip_effect_seq++,
    pos: vec3(obj.pos.x, obj.pos.y, obj.pos.z),
    pitch: 0, yaw: 0, roll: 0,
    slot: IMPACT_SLOT_FIRST, delay: 0,
    first: IMPACT_SLOT_FIRST, last: IMPACT_SLOT_FIRST + IMPACT_CELS,
    scale: 1,
  });
}
/** `ADD EAX, 0x94` and `CMP EAX, 0xE` in `Class22ImpactFlipbookUpdate`. */
export const IMPACT_SLOT_FIRST = 0x94;
const IMPACT_CELS = 0xe;

/**
 * `Class22Death` — `FUN_0049C910`.
 *
 * ```
 * if tail cue: ActorDespawn(obj); return
 * Class22DrawAndPoseSubActor(obj)                  ; every frame, before the switch
 * switch sub:
 *   0  g_boss_hp_fraction = 0; SpawnBoneHitSprite(obj, 2); both counters -1;
 *      release obj's and the sub-actor's slots; sub++; +0x1330 = 0; into 1
 *   1  +0x194++; if g_camera_free: shutter 5; ActorSetMotion(0x40A); sub++;
 *      seat the fall
 *   2  +0x1330 = 0; g_camera_driver_held = 1; save the camera block; sub++; into 3
 *   3  +0x194 >= 0x1C: the dying line (stage 1); node 2 cycle B; vy = acc = 0; sub++
 *      +0x194++
 *   4  the fall and the landing
 *   5  +0x1330 >= 300: g_camera_driver_held = 0; Arcade: restore the block;
 *      raise the stage's flag; sub++
 * if 2 <= sub <= 5: the orbit
 * ```
 *
 * The counter tests are on `obj+0x194` itself -- the port's `playTicks` --
 * and the class steps it (`advancesOwnMotion`), held at `0x84` while the
 * body falls and stepped a second time on each landing frame.
 */
export function Class22Death(obj: JudgmentActor, f: ClassFrame,
                             d: Class22Descriptor): void {
  const t = obj.judgment;
  if (Class22TailCueReached(d)) {
    Class22Despawn(obj);
    return;
  }
  Class22DrawAndPoseSubActor(obj, f);

  switch (obj.sub) {
    case 0:
      Class22DeathRelease(obj);
      Class22DeathAwaitCamera(obj, f);                 // into sub 1
      break;
    case 1:
      Class22DeathAwaitCamera(obj, f);
      break;
    case 2:
      Class22DeathTakeCamera(obj);
      Class22DeathStartFall(obj, f);                   // into sub 3
      break;
    case 3:
      Class22DeathStartFall(obj, f);
      break;
    case 4:
      Class22DeathFallAndLand(obj, f);
      break;
    case 5:
      if (t.counter >= ORBIT_FRAMES) {
        // `MOV dword ptr [0x009ca094], 0x0` at `0x0049CC29`.
        G.g_camera_driver_held = 0;
        if (G.g_GameMode === GameMode.Arcade) {
          G.g_camera_block_eye.x = t.point.x;
          G.g_camera_block_eye.y = t.point.y;
          G.g_camera_block_eye.z = t.point.z;
          G.g_camera_block_target.x = t.savedTarget.x;
          G.g_camera_block_target.y = t.savedTarget.y;
          G.g_camera_block_target.z = t.savedTarget.z;
        }
        if (t.variant === Class22Variant.Stage1) {
          G.g_script_flags[CLASS22_STAGE1_DEAD_FLAG] = 1;     // 0x0049CC95
        } else if (t.variant === Class22Variant.Stage5) {
          G.g_script_flags[CLASS22_STAGE5_DEAD_FLAG] = 1;     // 0x0049CC85
        }
        obj.sub += 1;
      }
      break;
    default:
      break;
  }

  // The orbit, `0x0049CCA7`: the sub read after the switch.
  if (obj.sub >= 2 && obj.sub <= 5) Class22DeathOrbit(obj, t.variant);
}

/**
 * Sub 0, `0x0049C970`: the bar to empty, the counters, the slots; then sub 1.
 */
function Class22DeathRelease(obj: JudgmentActor): void {
  const t = obj.judgment;
  // `MOV dword ptr [0x009c8e10], 0x0` at `0x0049C974` -- the bar blinks out
  // on its own from here.
  G.g_boss_hp_fraction = 0;
  // `NoOpStub(obj, 2)` at `0x0049C97E`: an empty call.
  SpawnBoneHitSprite(obj.at, 2);
  G.g_enemies_alive -= 1;                              // 0x0049C98E
  G.g_enemies_present -= 1;                            // 0x0049C995
  // `ReleaseCameraEnemySlot` / `ActorFreeHitSlot` on the flier, then on its
  // sub-actor.
  JudgmentReleaseEnemySlot(t);
  ActorReleaseHitSlot(obj);
  const sub = ActorByAt(t.subActorAt);
  if (sub && sub.cls === obj.cls) {
    JudgmentReleaseEnemySlot(sub.judgment);
    ActorReleaseHitSlot(sub);
  }
  obj.sub += 1;
  t.counter = 0;
}

/**
 * Sub 1, `0x0049C9F9`: step the counter, and once the camera is free take the
 * fall's clip and seat -- (-1066.2, 40, -490.2) in stage 1; in stage 5 the
 * height and a z clamp only.
 */
function Class22DeathAwaitCamera(obj: JudgmentActor, f: ClassFrame): void {
  const t = obj.judgment;
  ActorAdvanceMotion(obj, f.dt);                       // INC [EBP] at 0x0049C9FC
  if (G.g_camera_free !== 1) return;
  G.g_bHudShutterState = SHUTTER_CLOSED;               // 0x0049CA16
  ActorSetMotion(obj, Class22Clip.Death);
  obj.sub += 1;
  if (t.variant === Class22Variant.Stage1) {
    obj.pos.x = STAGE1_FALL_FROM.x;
    obj.pos.y = STAGE1_FALL_FROM.y;
    obj.pos.z = STAGE1_FALL_FROM.z;
  } else if (t.variant === Class22Variant.Stage5) {
    obj.pos.y = FALL_FROM_Y;
    if (obj.pos.z < DEATH_STAGE5_Z_MIN) obj.pos.z = DEATH_STAGE5_Z_MIN;
    else if (DEATH_STAGE5_Z_MAX < obj.pos.z) obj.pos.z = DEATH_STAGE5_Z_MAX;
  }
}

/** Sub 2, `0x0049CA99`: hold the camera driver and save the block; then sub 3. */
function Class22DeathTakeCamera(obj: JudgmentActor): void {
  const t = obj.judgment;
  t.counter = 0;
  // `MOV dword ptr [0x009ca094], 0x1` at `0x0049CAAD`.
  G.g_camera_driver_held = 1;
  t.point.x = G.g_camera_block_eye.x;
  t.point.y = G.g_camera_block_eye.y;
  t.point.z = G.g_camera_block_eye.z;
  t.savedTarget.x = G.g_camera_block_target.x;
  t.savedTarget.y = G.g_camera_block_target.y;
  t.savedTarget.z = G.g_camera_block_target.z;
  obj.sub += 1;
}

/**
 * Sub 3, `0x0049CAF3`: on counter `0x1C` the dying line (stage 1), node 2's
 * second cycle and a still start to the fall; the counter steps either way.
 */
function Class22DeathStartFall(obj: JudgmentActor, f: ClassFrame): void {
  const t = obj.judgment;
  if (obj.playTicks >= FALL_START_FRAME) {
    if (t.variant === Class22Variant.Stage1) {
      // `EvtOpPlayDialogue2D(0x1D)` (`FUN_00435B80`) -- evt op 0x2D's handler.
      EvtOpPlayDialogue2D(DYING_LINE, f.events);
    }
    t.node2Mode = NODE2_FALLING;
    obj.vel.y = 0;
    obj.accY = 0;
    obj.sub += 1;
  }
  ActorAdvanceMotion(obj, f.dt);                       // INC [EBP] at 0x0049CB25
}

/**
 * Sub 4, `0x0049CB2D`..`0x0049CC0F`.
 *
 * ```
 * if (+0x194 < 0x84) +0x194++
 * if (ground + 7.4 < y):                         ; still falling
 *     +0x5C -= 1.3611e-4 (a double); +0x50 += +0x5C; y += +0x50
 * else:                                          ; landed
 *     if (+0x194 < 0x8D) y = ground + float[0x00570C78 + +0x194*4]
 *     if (+++0x194 == 0x92): the impact flipbook, ENE_WALK7_22
 *     if (+0x194 == g_motion_play_length[clip]): sub++; +0x1338 = 0
 * y = max(y, ground + 1.1)
 * ```
 *
 * The landing indexes a float table by the counter with no bound below; a
 * landing before `0x84` would read the tables beside it as floats, and the
 * port reads the same bytes (`Class22RdataF32`).
 */
function Class22DeathFallAndLand(obj: JudgmentActor, f: ClassFrame): void {
  const t = obj.judgment;
  const ground = G.g_camera_fixed_eye_y;
  if (obj.playTicks < FALL_HOLD_FRAME) ActorAdvanceMotion(obj, f.dt);
  if (Math.fround(ground + DEATH_LAND_HEIGHT) < obj.pos.y) {
    // `FLD [+0x5C]; FSUB double [0x00570F38]; FST [+0x5C]; FADD [+0x50];
    // FST [+0x50]; FADD [+0x44]; FSTP [+0x44]` -- each store a float, the
    // chain carried in the FPU.
    const acc = obj.accY - DEATH_FALL_JERK;
    obj.accY = Math.fround(acc);
    const vy = acc + obj.vel.y;
    obj.vel.y = Math.fround(vy);
    obj.pos.y = Math.fround(vy + obj.pos.y);
  } else {
    if (obj.playTicks < LAND_TABLE_END) {
      obj.pos.y = Math.fround(ground + Class22RdataF32(
        CLASS22_LANDING_BASE + obj.playTicks * 4));
    }
    ActorAdvanceMotion(obj, f.dt);
    if (obj.playTicks === IMPACT_FRAME) {
      Class22SpawnImpactFlipbook(obj);
      Class22PlaySound(f, SND_IMPACT);
    }
    if (obj.playTicks === MotionPlayLength(obj)) {
      obj.sub += 1;
      t.node2Mode = 0;
    }
  }
  // `FLD ground; FADD [0x00570F30]; FCOM [+0x44]; C0 ? discard : FSTP [+0x44]`.
  const floor = ground + DEATH_REST_HEIGHT;
  if (!(floor < obj.pos.y)) obj.pos.y = Math.fround(floor);
}

/**
 * The orbit, `0x0049CCC0`..`0x0049CDBC`:
 *
 * ```
 * +0x1330++
 * push; identity; T(pos); RotY(obj+0x68 + obj+0x1330 * 8)
 * g_camera_block_eye    = M * (10, 0, -20)
 * g_camera_block_target = M * (0, 0, 0)
 * g_camera_block_eye.y  = 30.0 (stage 1) | -32.6 (stage 5)
 * pop; CamBlockSetAnglesFromLookAt(&eye, &target, 0)
 * ```
 *
 * `CamBlockSetAnglesFromLookAt` (`FUN_00403AC0`, called at `0x0049CDBC`)
 * turns the eye/target pair into the block's orientation words, and those are
 * what the view is built from (`UpdateSceneViewAndLight`, `FUN_00401F40`) --
 * the pair alone would move the eye and leave the camera facing wherever it
 * faced before. The view is built in the camera actor's task at the head of
 * the next frame, and nothing overwrites the block in between:
 * `g_camera_driver_held` parks `CameraDriverSelectMode` in mode 6. `[proved]`
 */
function Class22DeathOrbit(obj: JudgmentActor, variant: number): void {
  const t = obj.judgment;
  t.counter += 1;
  for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
  MatrixTranslate(_m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateY(_m, obj.yaw + t.counter * ORBIT_STEP);
  MatrixTransformPoint(_m, ORBIT_EYE, G.g_camera_block_eye);
  MatrixTransformPoint(_m, ORIGIN, G.g_camera_block_target);
  const eyeY = ORBIT_EYE_Y[variant];
  if (eyeY !== undefined) G.g_camera_block_eye.y = eyeY;
  for (const v of [G.g_camera_block_eye, G.g_camera_block_target]) {
    v.x = Math.fround(v.x); v.y = Math.fround(v.y); v.z = Math.fround(v.z);
  }
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target, 0);
}
