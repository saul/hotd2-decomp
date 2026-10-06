/**
 * The golden frog: item set 3, and class 0x41 constructor 68.
 *
 * `SpawnGoldenFrog` (`FUN_004722A0`) is what a broken container lets out
 * when its item set is 3 -- in `BreakablePropUpdate`, `KindedPropUpdate`,
 * `FallingContainerUpdate`, `PropUpdateType37` and `PropUpdateType63` -- and
 * constructor 68 (`FUN_00463E50`) places one from a table in Training. Both
 * allocate a full `0x13F4` actor of character type `0x1C`, whose eighteen
 * skeleton slots all resolve to `frog_gold.bin`, and hand it
 * `GoldenFrogUpdate` (`FUN_00471FA0`) with `GoldenFrogDrawBonePart`
 * (`FUN_00463F90`) as its node hook. It has no class id: the port files it
 * under class 0x41 with {@link PropContainerRoutine.GoldenFrog} on its tail
 * (`class41/placer_state.ts`).
 *
 * What it does, `[proved]` from the listings: it sits on clip `0x140`, its
 * light turning, until it is shot; then it pays the shooter 1000, plays
 * `0x13F` and `0x3B17A9`, and draws the shooter's 50-frame score strip at its
 * feet while its model fades out from frame 25 of the strip, and goes at 50.
 * It ages on its own step lifetime, the prop's `+0x11C`, and Training's
 * block 14 takes it away.
 *
 * Where it is shipped, from the bundles' placements: stage 2's three
 * kinded props in set 3 (`0x248C` and `0x24B4`, a set of two, and `0x8104`)
 * and constructor 37's pair at `0x812C`; stage 3's two kinded props in set
 * 3; and the one in `PropUpdateType63`'s table, stage 6. Constructor 68 is
 * placed in Training's block 7 only, which no bundle carries.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor, PropContainerActor } from "../actor";
import { ActorFlag } from "../actor";
import { CameraBlockEye } from "../camera/view";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ScoreAddForPlayer } from "../combat/score";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { G, HIT_SLOT_NONE } from "../globals";
import { BuildSceneLightDirection } from "../light_block";
import { SetRenderLightDirection } from "../light_sets";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { ActorRunNodeDrawHooks } from "../model_draw";
import { ActorAdvanceMotion } from "../motion";
import type { ClassFrame } from "../registry";
import { ActorBuildSkinnedModel, ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { RESULT_FIGURE_AT_BIT } from "../class61/state";
import { BreakablePropAwardHit } from "./prop";
import { PropMatrixPush } from "./prop_draw";
import { PropWord11C } from "./items";
import type { BreakableProp } from "./prop_state";
import {
  makeGoldenFrogWords, PropContainerRoutine, type GoldenFrogWords,
} from "./placer_state";
import {
  GOLDEN_FROG_CHAR_TYPE, GOLDEN_FROG_IDLE_MOTION, GOLDEN_FROG_SHOT_MOTION,
} from "./item_pickup_slots";

export {
  GOLDEN_FROG_CHAR_TYPE, GOLDEN_FROG_IDLE_MOTION, GOLDEN_FROG_SHOT_MOTION,
} from "./item_pickup_slots";

/** `ActorSetMotionBlended`'s cursor 0 (`PUSH 0x0`) and fade of 4 (`PUSH 0x4`). */
const GOLDEN_FROG_SHOT_FADE = 4;

/** `MOV dword ptr [ESI + 0x124], 0x40800000` -- its sphere, 4.0. */
export const GOLDEN_FROG_RADIUS = 4.0;
/** `PUSH 0x3E8` -- the points a shot frog pays. */
export const GOLDEN_FROG_SCORE = 1000;
/** `PUSH 0x3B17A9` -- the sound it is shot with. */
export const SFX_GOLDEN_FROG = 0x3b17a9;
/** The two players' strips: `0x116A` for player 0, `0x119C` for player 1. */
export const GOLDEN_FROG_STRIP_P0 = 0x116a;
export const GOLDEN_FROG_STRIP_P1 = 0x119c;
/** `LEA`s to `who * 50` -- one strip to the next. */
const GOLDEN_FROG_STRIP_STRIDE = 0x32;
/** `CMP dword ptr [ESI + 0x1350], 0x31; JG` -- the strip's last frame. */
export const GOLDEN_FROG_STRIP_LAST = 0x31;
/** `CMP EAX, 0x19` in the hook: from this strip frame the model fades... */
export const GOLDEN_FROG_FADE_FROM = 0x19;
/** ...by `[0x004E3100]` = 0.02 a frame, `FSUBR [0x004C4380]` = 1.0. */
const GOLDEN_FROG_FADE_STEP = 0.02;
/** `FSUB [0x004C4C58]` -- the sphere is 0.25 below the tracked bone. */
const GOLDEN_FROG_SHOT_DROP = 0.25;
/** `ADD EAX, 0x300` and `ADD EDI, 0xFFFFFE80` -- the light's turn a frame. */
const GOLDEN_FROG_LIGHT_PITCH_STEP = 0x300;
const GOLDEN_FROG_LIGHT_YAW_STEP = -0x180;
/** `CMP [0x009A1A08], 0` and `CMP [0x009A2BC0], 0xE` -- Training's block 14. */
const GOLDEN_FROG_GONE_SCENE = 0;
const GOLDEN_FROG_GONE_BLOCK = 0xe;
/**
 * `g_script_flags[0xF1]` (`0x009C72F1`) and `[0xF2]` (`0x009C72F2`): in
 * Training (`g_GameMode == 2`) the light turns and the clip steps only while
 * the first is up and the second down -- the same pair `WaterSurfaceUpdate`
 * tests.
 */
const GOLDEN_FROG_TRAINING_ON_FLAG = 0xf1;
const GOLDEN_FROG_TRAINING_OFF_FLAG = 0xf2;
/** `CMP word ptr [0x009A1A08], 0x5` -- stage 6, where it faces a fixed way. */
const GOLDEN_FROG_FIXED_YAW_SCENE = 5;
/** `MOV dword ptr [ESI + 0x34], 0x1` -- the flag word, after the build. */
const GOLDEN_FROG_FLAGS = 1;
/**
 * `AND DL, 0x7F; OR EDX, 0x80080000` -- on the word of the object it was
 * handed, not its own.
 */
const GOLDEN_FROG_PARENT_SET = 0x80080000;
const GOLDEN_FROG_PARENT_CLEAR = 0x80;

/** `g_rad_to_bams` -- `0x004C4378`, the double `32768/pi`. */
const RAD_TO_BAMS = 32768 / Math.PI;

/** `[port-only]` -- bit 23 of a golden frog's address. See {@link GoldenFrogAt}. */
export const GOLDEN_FROG_AT_BIT = 0x00800000;

/**
 * `[port-only]` -- a golden frog's address. It is allocated with no
 * descriptor, so it has no evt offset; it takes the result card figures'
 * bit (`RESULT_FIGURE_AT_BIT`, bit 26), which is what has the character
 * layer clone it from its type's hidden template row, and bit 23, which no
 * figure sets (a figure's index is eight bits), with the port's own object
 * id beneath.
 */
export function GoldenFrogAt(id: number): number {
  return (RESULT_FIGURE_AT_BIT | GOLDEN_FROG_AT_BIT
          | ((id & 0x7fff) << 8) | GOLDEN_FROG_CHAR_TYPE) >>> 0;
}

/** The frog's words, or null on an actor that is not one. */
function Words(obj: Actor): GoldenFrogWords | null {
  if (obj.cls !== SpawnClass.PropContainerPlacer) return null;
  return obj.placer.routine === PropContainerRoutine.GoldenFrog
    ? obj.placer.frog : null;
}

/**
 * The half the two allocators share: `ActorAlloc(GoldenFrogUpdate, 0x13F4)`,
 * `ActorClearGameFields`, `g_cur_actor = obj`, `obj+0x34 = 1`. Each writes
 * its own position and turn after it.
 *
 * `[port-only]` as a function. `ActorAlloc` links the task behind every
 * object already in the walk, which is where `ActorSpawn` pushes it; the
 * class-0x41 `Init` it runs is the placer's `visible`, the engine's frog has
 * none.
 */
function GoldenFrogAlloc(rng?: Rng, events?: Events): PropContainerActor | null {
  const a = ActorSpawn(GoldenFrogAt(G.g_breakable_next_id++),
                       SpawnClass.PropContainerPlacer, GOLDEN_FROG_CHAR_TYPE,
                       "golden frog", undefined, rng, events);
  if (a.cls !== SpawnClass.PropContainerPlacer) return null;
  a.placer.routine = PropContainerRoutine.GoldenFrog;
  a.placer.frog = makeGoldenFrogWords();
  G.g_cur_actor = a.at;
  a.flags = GOLDEN_FROG_FLAGS;
  return a;
}

/**
 * The half after the position: the build and the words, which the two
 * allocators write identically (`0x00463EDF`..`0x00463F7B` in constructor
 * 68, `0x00472350`..`0x004723DD` in `SpawnGoldenFrog`):
 *
 * ```
 * obj+0x3C = -1;  obj+0x120 = 0xFF;  obj+0x1F4 = 0x1C;  obj+0x1B4 = 0x140
 * TaskListSaveCurrent(obj); ActorBuildSkinnedModel(obj+0x194, obj+0x40, obj+0x20C)
 * TaskListCurrentIgnoringSaved()
 * obj+0x1FC = 5;  obj+0x194 = 0;  obj+0x12EC = GoldenFrogDrawBonePart
 * obj+0x1310 = 0;  obj+0x124 = 4.0;  obj+0x34 = 1
 * parent+0x34 = (parent+0x34 & ~0x80) | 0x80080000      ; the PARENT's word
 * obj+0x11C = (u16)parent+0x11C;  obj+0x1330 = (s16)g_evt_step_index
 * obj+0x1334 = 0;  obj+0x1350 = 0
 * ```
 *
 * The build claims the frog a hit slot and raises `+0x34` bit 0x80; the
 * `MOV dword ptr [ESI+0x34], 1` after it takes the bit back, so the frog is
 * one sphere, and the `AND 0x7F` lands on the object it was handed. The
 * task-list pair changes nothing the game reads. `+0x1FC`, the rotation
 * order, is the build's own 5 and a lone yaw draws the same in every order.
 *
 * Returns the parent's new flag word for the caller to store, because the
 * parent is a prop for one allocator and an actor for the other.
 */
function GoldenFrogBuild(a: PropContainerActor, parentFlags: number,
                         parent11C: number): number {
  a.hitSlot = HIT_SLOT_NONE;
  a.cameraSlot = -1;
  a.charType = GOLDEN_FROG_CHAR_TYPE;
  a.motion = GOLDEN_FROG_IDLE_MOTION;
  ActorBuildSkinnedModel(a);
  a.playTicks = 0;
  a.state = 0;
  a.hitRadius = GOLDEN_FROG_RADIUS;
  a.flags = GOLDEN_FROG_FLAGS;
  a.hp = (parent11C << 16) >> 16;
  const w = a.placer.frog!;
  w.stepSeen = (G.g_evt_step_index << 16) >> 16;
  w.steps = 0;
  w.strip = 0;
  a.visible = true;
  return ((parentFlags & ~GOLDEN_FROG_PARENT_CLEAR)
          | GOLDEN_FROG_PARENT_SET) >>> 0;
}

/**
 * `SpawnGoldenFrog` — `FUN_004722A0`. Item set 3: the golden frog, at the
 * prop and turned to face the camera.
 *
 * ```
 * 004722D8  obj+0x40..0x48 = p+0x19C..0x1A4
 * 00472322  obj+0x68 = (s16)ftol(atan2(x - eye.x, z - eye.z) * 32768/pi)  ; no + 0x8000
 * 0047233F  if (g_GameMode != 2 && g_scene_index == 5) obj+0x68 = 0
 * ```
 *
 * then {@link GoldenFrogBuild}. `[proved]`. The eye is camera block
 * `g_camera_index`'s, as `SpawnExtraLifePickup`'s is.
 *
 * The `item.released` event is the port's own notice for its feed.
 */
export function SpawnGoldenFrog(p: BreakableProp, events?: Events,
                                rng?: Rng): void {
  const a = GoldenFrogAlloc(rng, events);
  if (!a) return;
  a.pos = vec3(p.x, p.y, p.z);
  // `FSUB [EAX+0x9A60C0]; FSUB [EAX+0x9A60C8]; FPATAN; FMUL g_rad_to_bams;
  // __ftol; MOVSX EAX, AX`.
  const eye = CameraBlockEye(G.g_camera_index);
  const b = Math.trunc(Math.atan2(p.x - eye.x, p.z - eye.z) * RAD_TO_BAMS);
  a.yaw = (b << 16) >> 16;
  if (G.g_GameMode !== GameMode.Training
      && G.g_scene_index === GOLDEN_FROG_FIXED_YAW_SCENE) {
    a.yaw = 0;
  }
  p.flags = GoldenFrogBuild(a, p.flags, PropWord11C(p));
  events?.emit("item.released", {
    set: 3, from: p.id, charType: GOLDEN_FROG_CHAR_TYPE,
    x: a.pos.x, y: a.pos.y, z: a.pos.z,
  });
}

/**
 * The scale `PlaceGoldenFrogFromLessonTable` puts on the table's words:
 * `FMUL float ptr [0x0055D230]`, 0.1.
 */
const GOLDEN_FROG_LESSON_SCALE = Math.fround(0.1);
/** `MOV dword ptr [ESI + 0x68], 0x9200` -- the turn the table's frog faces. */
export const GOLDEN_FROG_LESSON_YAW = 0x9200;
/** `MOV ECX, 0x3; IDIV ECX` -- three places a lesson. */
export const GOLDEN_FROG_LESSON_PLACES = 3;

/**
 * `PlaceGoldenFrogFromLessonTable` — `FUN_00463E50`.
 * `g_class41_constructors[68]`.
 *
 * ```
 * 00463E55  r = rand() % 3                                   ; before the alloc
 * 00463E6E  ActorAlloc(GoldenFrogUpdate, 0x13F4) ...
 * 00463EA0  obj+0x40 = (f32)(s16 g_golden_frog_lesson_xz[r + lesson * 3].x * 0.1f)
 * 00463EB9  obj+0x44 = placer+0x44
 * 00463ECC  obj+0x48 = (f32)(s16 g_golden_frog_lesson_xz[r + lesson * 3].z * 0.1f)
 * 00463EDF  obj+0x68 = 0x9200
 * ```
 *
 * then the build every frog shares, with the placer as the parent.
 * `[proved]`. `lesson` is `g_training_lesson` (`0x009C9118`), and the table
 * is `g_golden_frog_lesson_xz` (`0x0059579C`), five lessons of three places,
 * which travels on the placement (`xz`).
 */
export function PlaceGoldenFrogFromLessonTable(
    placer: Actor, xz: readonly (readonly [number, number])[],
    f: ClassFrame): void {
  // `CALL rand; CDQ; IDIV 3` -- rand() is never negative.
  const r = f.rng.int(GOLDEN_FROG_LESSON_PLACES);
  const a = GoldenFrogAlloc(f.rng, f.events);
  if (!a) return;
  const row = xz[r + ((G.g_training_lesson << 24) >> 24) * 3] ?? [0, 0];
  a.pos = vec3(Math.fround(row[0] * GOLDEN_FROG_LESSON_SCALE), placer.pos.y,
               Math.fround(row[1] * GOLDEN_FROG_LESSON_SCALE));
  a.yaw = GOLDEN_FROG_LESSON_YAW;
  placer.flags = GoldenFrogBuild(a, placer.flags, placer.hp);
}

/** Whether Training lets the light turn and the clip step this frame. */
function GoldenFrogTrainingLive(): boolean {
  return G.g_GameMode !== GameMode.Training
    || ((G.g_script_flags[GOLDEN_FROG_TRAINING_ON_FLAG] ?? 0) !== 0
        && (G.g_script_flags[GOLDEN_FROG_TRAINING_OFF_FLAG] ?? 0) === 0);
}

/**
 * `GoldenFrogDrawBonePart` — `FUN_00463F90`. The node hook both allocators
 * install at `model+0x1158`:
 *
 * ```
 * if (g_cur_actor+0x1350 < 0x19) AssetDrawSlot(record slot)
 * else AssetDrawSlotWithAlpha(record slot, 1.0 - g_cur_actor+0x1350 * 0.02)
 * ```
 *
 * `[proved]`. So the shot frog draws every node solid for the strip's first
 * 25 frames and then fades from 0.5 to nothing; what each node was drawn at
 * is {@link Actor.nodeDrawAlpha}, which `render/characters/draw_gates.ts`
 * applies.
 */
export function GoldenFrogDrawBonePart(obj: Actor, bone: number,
                                       slot: number): void {
  void slot;
  const w = Words(obj);
  const n = w?.strip ?? 0;
  obj.nodeDrawAlpha[bone] = n < GOLDEN_FROG_FADE_FROM
    ? null : Math.fround(1.0 - n * GOLDEN_FROG_FADE_STEP);
}

const _dir: Vec3 = vec3();

/**
 * `GoldenFrogUpdate` — `FUN_00471FA0`. The whole routine, from its listing:
 *
 * ```
 * 00471FA0  if ((s16)g_evt_step_index != obj+0x1330) {
 *               if ((s16)obj+0x11C < ++obj+0x1334) {
 *                   if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0
 *                   ActorDespawn(obj); return }
 *               obj+0x1330 = (s16)g_evt_step_index }
 * 00472010  if (g_scene_index == 0 && g_evt_block_index == 0xE) { ActorDespawn(obj); return }
 * 00472035  g_cur_actor = obj;  obj+0x1338 += 0x300;  obj+0x133C -= 0x180
 *           if (g_GameMode != 2 || (flags[0xF1] && !flags[0xF2]))
 *               BuildSceneLightDirection(+0x1338, +0x133C, w, v); SetRenderLightDirection(v)
 * 004720A7  DrawSkinnedModelAndShadow(obj+0x194, obj+0x40, obj+0x20C)
 * 004720B1  SetRenderLightDirection(&g_scene_light_dir_view)
 * 004720BC  if ((obj+0x34 & 8) && obj+0x1310 == 0) {
 *               BreakablePropAwardHit(obj+0x34, 0)
 *               ActorSetMotionBlended(model, 0x13F, 0, 4);  obj+0x1310 = 1
 *               PlaySoundId(0x3B17A9)
 *               !p0 bit: ScoreAddForPlayer(1, 1000); obj+0x13F0 = 0x119C
 *               p0 alone: ScoreAddForPlayer(0, 1000); obj+0x13F0 = 0x116A
 *               both: who = rand() % 2; ScoreAddForPlayer(who, 1000); obj+0x13F0 = who * 50 + 0x116A }
 * 0047217D  if (obj+0x1310 == 1 && model+0x5D) obj+0x1310 = 2
 * 00472194  if (obj+0x1310 < 2 && (g_GameMode != 2 || (flags[0xF1] && !flags[0xF2]))) model[0]++
 * 004721B9  if (obj+0x1310 > 0 && obj+0x1350 <= 0x31) {
 *               AssetDrawSlot(obj+0x13F0 + obj+0x1350) under T(obj+0x40) Ry(obj+0x68)
 *               if (++obj+0x1350 > 0x31) { g_hit_slots[obj+0x3C] = 0 ...; ActorDespawn(obj); return } }
 * 00472242  obj+0x70 = (obj+0x100, obj+0x104 - 0.25, obj+0x108);  RegisterForShotTest(obj)
 * ```
 *
 * `[proved]`. Three readings it rests on:
 *
 * * **The hit bit is never cleared**, and nothing else is needed: the shot
 *   arm is closed by `+0x1310`, so a frog pays once.
 * * `model+0x5D` is the byte `SkeletonAdvancePlayCursor` (`FUN_004111A0`)
 *   writes in the draw at `0x004720A7`, so the test reads the cursor the
 *   draw left -- the clip it had **before** the shot arm changed it, on the
 *   frame of the shot. Once the shot clip has reached its play length the
 *   counter stops (`+0x1310` is 2), and the frog holds its last frame while
 *   the strip plays and the model fades.
 * * `obj+0x100` is `SkeletonEmitNode`'s write of bone 1 (type `0x1C` is
 *   outside `0..0x14`, so `sVar3` stays 1), which the director records from
 *   the drawn pose before the update (`SkeletonRecordCameraPoint`).
 *
 * The draw is the renderer's; what it is made under is left on the words:
 * {@link GoldenFrogWords.drawDir} -- the frog's own turning direction under
 * the scene's ambient and colour -- and the strip's
 * {@link GoldenFrogWords.stripDraw}. The shadow `DrawSkinnedModelAndShadow`
 * ends with is `ActorDrawShadow`'s, which no character's draw in the port
 * makes yet.
 */
export function GoldenFrogUpdate(obj: PropContainerActor, f: ClassFrame): void {
  const w = Words(obj);
  if (!w) return;
  w.stripDraw = null;
  const step = (G.g_evt_step_index << 16) >> 16;
  if (step !== w.stepSeen) {
    w.steps += 1;
    if (((obj.hp << 16) >> 16) < w.steps) {
      if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
      ActorDespawn(obj);
      return;
    }
    w.stepSeen = step;
  }
  if (G.g_scene_index === GOLDEN_FROG_GONE_SCENE
      && G.g_evt_block_index === GOLDEN_FROG_GONE_BLOCK) {
    ActorDespawn(obj);
    return;
  }
  G.g_cur_actor = obj.at;
  w.lightPitch = (w.lightPitch + GOLDEN_FROG_LIGHT_PITCH_STEP) | 0;
  w.lightYaw = (w.lightYaw + GOLDEN_FROG_LIGHT_YAW_STEP) | 0;
  w.drawDir = null;
  if (GoldenFrogTrainingLive()) {
    BuildSceneLightDirection(w.lightPitch, w.lightYaw, _dir);
    SetRenderLightDirection(_dir);
    const d = G.g_render_light_dir;
    w.drawDir = [d.x, d.y, d.z];
  }
  // `DrawSkinnedModelAndShadow`: the hook on every node, and the sampler's
  // done byte, `model+0x5D`.
  ActorRunNodeDrawHooks(obj, GoldenFrogDrawBonePart, f);
  const ended = MotionPlayFrame(obj) >= MotionPlayLength(obj);
  // `PUSH 0x9A354C` -- block 0's direction, back.
  SetRenderLightDirection(G.g_scene_light_block0.dir);
  if ((obj.flags & ActorFlag.Hit) !== 0 && obj.state === 0) {
    BreakablePropAwardHit(obj.flags, false, f.rng);
    ActorSetMotionBlended(obj, GOLDEN_FROG_SHOT_MOTION, 0,
                          GOLDEN_FROG_SHOT_FADE);
    obj.state = 1;
    f.events?.emit("sound.play", { id: SFX_GOLDEN_FROG });
    const p0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
    if (!p0 || (obj.flags & ActorFlag.HitByPlayer1) === 0) {
      if (!p0) {
        ScoreAddForPlayer(1, GOLDEN_FROG_SCORE, f.events);
        w.stripBase = GOLDEN_FROG_STRIP_P1;
      } else {
        ScoreAddForPlayer(0, GOLDEN_FROG_SCORE, f.events);
        w.stripBase = GOLDEN_FROG_STRIP_P0;
      }
    } else {
      // `rand() & 0x80000001`, sign-corrected: `rand() % 2`.
      const who = f.rng.int(2);
      ScoreAddForPlayer(who, GOLDEN_FROG_SCORE, f.events);
      w.stripBase = who * GOLDEN_FROG_STRIP_STRIDE + GOLDEN_FROG_STRIP_P0;
    }
  }
  if (obj.state === 1 && ended) obj.state = 2;
  if (obj.state < 2 && GoldenFrogTrainingLive()) ActorAdvanceMotion(obj, f.dt);
  if (obj.state > 0 && w.strip <= GOLDEN_FROG_STRIP_LAST) {
    const m = PropMatrixPush();
    MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
    MatrixRotateY(m, obj.yaw);
    w.stripDraw = { slot: w.stripBase + w.strip, m };
    w.strip += 1;
    if (w.strip > GOLDEN_FROG_STRIP_LAST) {
      if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
      ActorDespawn(obj);
      return;
    }
  }
  obj.shotCentre.x = obj.lookAt.x;
  obj.shotCentre.y = Math.fround(obj.lookAt.y - GOLDEN_FROG_SHOT_DROP);
  obj.shotCentre.z = obj.lookAt.z;
  RegisterForShotTest(obj, f.host);
}
