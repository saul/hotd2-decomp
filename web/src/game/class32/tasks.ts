/**
 * The draw-only tasks class 0x32 allocates: the afterimage, the body loop
 * effect, the hands effect, the projectile's trail, the death burst and the
 * exit effect.
 *
 * Each is an `ActorAlloc` (`FUN_004A6FA0`) of its own in the engine,
 * `ActorClearGameFields` (`FUN_004A73D0`) on the next line, appended to the
 * task ring and stepped where the walk reaches it; here each is a plain
 * record in `G.g_class32_tasks`, stepped by {@link Class32TasksTick} after
 * the actors, which is where an appended task runs. Every one of them draws
 * one `AssetDrawSlot` a frame under a matrix built on the spot; the routine
 * leaves that draw on the record (`Class32Task.draw`) -- the matrix in world
 * space, the engine's being the same product on top of the camera's -- and
 * `render/class32.ts` hangs a clone of the slot's model there.
 *
 * `ActorKill` (`FUN_004A7040`) and `ActorDespawn` (`FUN_00409CC0`) both end
 * the routine where they are called: a frame a task kills itself draws
 * nothing (L72).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, MotionFlag, type Actor, type Boss5Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import { CameraBlockViewToWorld, CameraBlockWorldToView } from "../camera/view";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTransformPoint, MatrixTranslate, type Mat,
} from "../matrix";
import { ActorSetPartVisibility } from "../model_draw";
import { SpawnClass } from "../spawn_class";
import { vec3, type Vec3 } from "../vec";
import {
  Class32Flag2, Class32TaskRoutine, type Class32Task, type Class32TaskDraw,
} from "./state";

/** `RAND_MAX + 1` -- the MSVC CRT's `rand()` returns fifteen bits. */
const CRT_RAND_RANGE = 0x8000;

/** `MOV [EAX+0x13F0], 0x5E5` at `0x0047DC19` -- `boss5.bin` 206. */
export const CLASS32_AFTERIMAGE_SLOT = 0x5e5;
/** `FSUB float ptr [0x005691B4]`'s neighbour: the view point's z less 5.0 (`0x40A00000`). */
const AFTERIMAGE_BACK = 5.0;
/** `ADD EDX, -0x6` -- the afterimage fades six a frame... */
const AFTERIMAGE_FADE = 6;
/** ...to `CMP EAX, 0x5A`, where it despawns. */
const AFTERIMAGE_END = 0x5a;
/** `FDIVR float ptr [0x004C43A8]` -- `0x3F4CCCCD`, 0.8. */
const AFTERIMAGE_LIGHT = Math.fround(0.8);
/** `FMUL float ptr [0x0055CB28]` -- 0.125. */
const AFTERIMAGE_DIM = 0.125;
/** `CMP CL, 0xF; JL` -- from rank 15 the afterimage is always white. */
const AFTERIMAGE_WHITE_RANK = 0xf;

/** `+0x1350 = 0xB3`, `+0x1354 = 0xB4`, `+0x1358 = 199` -- `eff_boss5.bin`'s twenty-cel loop. */
const BODY_LOOP_CEL = 0xb3;
const BODY_LOOP_FIRST = 0xb4;
const BODY_LOOP_LAST = 0xc7;
/** `FADD float ptr [0x004C4398]` -- 15.0 above the boss. */
const BODY_LOOP_RISE = 15.0;
/** `FADD float ptr [0x004C4C88]` -- `0x3D4CCCCD`, 0.05 a frame, to `[0x004C4380]` 1.0. */
const BODY_LOOP_FADE_IN = Math.fround(0.05);
const BODY_LOOP_FULL = 1.0;
/** `FMUL float ptr [0x004C4C58]` -- 0.25, the green; `[0x004C43AC]` 0.5, the alpha. */
const BODY_LOOP_GREEN = 0.25;
const BODY_LOOP_ALPHA = 0.5;
/** `SetDrawLayerNibble(9)` around the draw, then `(8)`. */
const BODY_LOOP_LAYER = 9;

/** `+0x1350 = 0x1279`, `+0x1354 = 0x127A`, `+0x1358 = 0x1299`. */
const HANDS_CEL = 0x1279;
const HANDS_FIRST = 0x127a;
const HANDS_LAST = 0x1299;
/** The two bones whose points the effect sits between -- node records `+0x6F4` and `+0x544`. */
const HANDS_BONE_A = 8;
const HANDS_BONE_B = 5;
/** `FMUL float ptr [0x004C43AC]` -- halfway. */
const HANDS_MID = 0.5;
/** `SetRenderLightColour(0x3F800000, 0x41180000, 0x3F0A3D71)`. */
const HANDS_LIGHT: [number, number, number] = [1.0, 9.5, Math.fround(0.54)];

/** `FMUL float ptr [0x005646E8]` -- `0x3B449BA6`, 0.003, per `(rand() & 3) + 1`. */
const TRAIL_RISE = Math.fround(0.003);
/** `FADD float ptr [0x004C4D08]` -- 0.15 larger than the projectile. */
const TRAIL_GROW = Math.fround(0.15);
/** `FSUB float ptr [0x005644F8]` -- 0.03 smaller a frame, to `[0x004C4CC8]` 0.1. */
const TRAIL_SHRINK = Math.fround(0.03);
const TRAIL_MIN = Math.fround(0.1);
/** `ADD EAX, -0x5` a frame; below `0x5B` it despawns at `0x5A`. */
const TRAIL_FADE = 5;
const TRAIL_END = 0x5b;
/** `[0x005308D0]` 0.4 and `[0x0055D230]` 0.1: the final barrage's orange; `[0x004C43AC]` 0.5. */
const TRAIL_BARRAGE_GREEN = Math.fround(0.4);
const TRAIL_BARRAGE_BLUE = Math.fround(0.1);
const TRAIL_RED_LIFT = 0.5;
/** The attack kind whose trail is orange -- `CMP byte ptr [EAX+0x131A], 0x3`. */
const TRAIL_BARRAGE_ATTACK = 3;

/** `+0x13F0 = 0xC53`; the slot steps first and past `0xC68` the task dies. */
const BURST_CEL = 0xc53;
const BURST_LAST = 0xc68;
/** `rand() % 0xF + 1` -- one of bones 1..15. */
const BURST_BONES = 0xf;
/** `if (boss+0x1334 < 1) boss+0x1334 = 8`. */
const BURST_FLASH = 8;
/** `PlaySoundId(0xB16A9)`. */
const SND_BURST = 0xb16a9;

/** `+0x13F0 = 0x7F4`, the shrinking first model; then `0x7EF`..`0x815`. */
const EXIT_SHRINK_SLOT = 0x7f4;
const EXIT_FIRST = 0x7ef;
const EXIT_LAST = 0x815;
/** `FSUB float ptr [0x005644F8]` -- 0.03 a frame. */
const EXIT_SHRINK = Math.fround(0.03);
/** `+0x1330 = 0xF` -- the wait between the shrink and the burst. */
const EXIT_WAIT = 0xf;
/** `CMP EAX, 0x2` -- one cel every three frames. */
const EXIT_CEL_FRAMES = 2;
/** `PlaySoundId(0xE23A9)` -- `STAGE5_SE\MAG_BAKU1_22K.wav`. */
const SND_EXIT = 0xe23a9;

/**
 * `[port-only]` `ActorAlloc` + `ActorClearGameFields` for a draw-only task:
 * every word zero, the routine installed, appended to the pool.
 */
function Class32AllocTask(routine: Class32TaskRoutine, parent: number):
    Class32Task {
  const t: Class32Task = {
    id: G.g_class32_task_seq++, routine, parent,
    pos: vec3(), vel: vec3(), accY: 0, pitch: 0, yaw: 0, roll: 0, size: 0,
    sub: 0, attack: 0, bright: 0, timer: 0, cel: 0, celFirst: 0, celLast: 0,
    light: 0, slot: 0, draw: null, killed: false,
  };
  G.g_class32_tasks.push(t);
  return t;
}

/** `[port-only]` The actor a task's `obj+0x1390` names, as the class's arm. */
export function Class32ParentOf(at: number): Boss5Actor | null {
  const a = ActorByAt(at);
  return a && a.cls === SpawnClass.Boss5 ? a : null;
}

/** `[port-only]` `T(pos) RotZ(roll) RotY(yaw) RotX(pitch)` from the identity. */
function TaskMatrix(t: Class32Task): Mat {
  const m = MatIdentity();
  MatrixTranslate(m, t.pos.x, t.pos.y, t.pos.z);
  MatrixRotateZ(m, t.roll);
  MatrixRotateY(m, t.yaw);
  MatrixRotateX(m, t.pitch);
  return m;
}

/** `[port-only]` The draw record: `AssetDrawSlot(slot)` under `m`. */
function TaskDraw(t: Class32Task, m: Mat, slot: number,
                  light: [number, number, number] | null,
                  alpha: number | null = null,
                  layer: number | null = null): void {
  const d: Class32TaskDraw = { slot, m, light, alpha, layer };
  t.draw = d;
}

/**
 * `[port-only]` A bone's point as the engine reads it for a task: node
 * record `+0x68` -- the bone's hit centre, in view space -- through
 * `g_camera_blocks[g_camera_index]`. The model block's records hold the
 * world point already (`game/skeleton.ts`); the draw wrote it this frame.
 */
function BonePoint(boss: Actor, bone: number, out: Vec3): void {
  const r = boss.skel?.bones[bone];
  out.x = r?.hit[0] ?? 0;
  out.y = r?.hit[1] ?? 0;
  out.z = r?.hit[2] ?? 0;
}

const _p = vec3();
const _q = vec3();
const _v = vec3();

/**
 * `Class32SpawnAfterimage` — `FUN_0047DB50`.
 *
 * ```
 * t = ActorAlloc(Class32AfterimageTick); ActorClearGameFields(t)
 * t+0x1390 = boss; t+0x34 = 1
 * t+0x40 = g_camera_blocks[g_camera_index] * (boss+0x70, +0x74, +0x78 - 5.0)
 * t+0x64 = boss+0x64; t+0x68 = boss+0x68 + 0x8000; t+0x6C = boss+0x6C
 * t+0x1320 = 0xFF; t+0x13F0 = 0x5E5
 * ```
 *
 * `boss+0x70` is the boss's camera point in view space as its last
 * `ActorRegisterCameraPoint` stored it; the port holds that point in the
 * world (`Actor.shotCentre`), so it is taken into view space through the
 * drawn block's matrix, pushed five units further off and taken back.
 */
export function Class32SpawnAfterimage(boss: Actor): void {
  const t = Class32AllocTask(Class32TaskRoutine.Afterimage, boss.at);
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index),
                       boss.shotCentre, _v);
  _v.z = Math.fround(_v.z - AFTERIMAGE_BACK);
  MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), _v, _p);
  t.pos.x = Math.fround(_p.x);
  t.pos.y = Math.fround(_p.y);
  t.pos.z = Math.fround(_p.z);
  t.pitch = boss.pitch;
  t.yaw = (boss.yaw + 0x8000) | 0;
  t.roll = boss.roll;
  t.bright = 0xff;
  t.slot = CLASS32_AFTERIMAGE_SLOT;
}

/**
 * `Class32AfterimageTick` — `FUN_0047DC30`.
 *
 * ```
 * if ((t+0x1320 -= 6) <= 0x5A) { t+0x1320 = 0x5A; ActorDespawn(t); return }
 * push; T(pos) RotZ(roll) RotY(yaw) RotX(pitch)
 * v = 0.8f / (float)(0xFF / t+0x1320); t+0x138C = v    ; an integer quotient
 * k = (s8)boss+0x131A; if ((s8)boss+0x131E >= 0xF) k = 3
 * k == 0: SetRenderLightColour(0, v*0.125, v)
 * k == 1: SetRenderLightColour(v, v*0.125, 0)
 * else:   SetRenderLightColour(v, v, v)
 * AssetDrawSlot(t+0x13F0); pop
 * ```
 *
 * The three arms were read off the stores (`0x0047DCDB`..`0x0047DD28`): the
 * decompilation reuses the frame's first argument slot for one of them.
 * The boss outlives every afterimage it makes -- they last 27 frames and it
 * stops making them long before it despawns -- so its words are always its
 * own.
 */
export function Class32AfterimageTick(t: Class32Task): void {
  t.draw = null;
  t.bright -= AFTERIMAGE_FADE;
  if (t.bright <= AFTERIMAGE_END) {
    t.bright = AFTERIMAGE_END;
    t.killed = true;
    return;
  }
  const m = TaskMatrix(t);
  const v = Math.fround(AFTERIMAGE_LIGHT / Math.trunc(0xff / t.bright));
  t.light = v;
  const boss = Class32ParentOf(t.parent);
  let k = boss ? boss.boss5.attack : 0;
  if (boss && boss.boss5.rank >= AFTERIMAGE_WHITE_RANK) k = 3;
  const dim = Math.fround(v * AFTERIMAGE_DIM);
  const light: [number, number, number] = k === 0 ? [0, dim, v]
    : k === 1 ? [v, dim, 0] : [v, v, v];
  TaskDraw(t, m, t.slot, light);
}

/**
 * `Class32SpawnBodyLoopEffect` — `FUN_0047E0D0`.
 *
 * ```
 * t = ActorAlloc(Class32BodyLoopEffectTick); ActorClearGameFields(t)
 * t+0x1390 = boss; t+0x40..t+0x9F = boss+0x40..boss+0x9F     ; REP MOVSD, 0x18
 * t+0x1350 = 0xB3; t+0x1354 = 0xB4; t+0x1358 = 199
 * ```
 *
 * The copy is position, velocity, acceleration and angles; the tick draws
 * at the boss's own position and angles every frame, so only the record's
 * shape survives it.
 */
export function Class32SpawnBodyLoopEffect(boss: Actor): void {
  const t = Class32AllocTask(Class32TaskRoutine.BodyLoop, boss.at);
  t.pos.x = boss.pos.x; t.pos.y = boss.pos.y; t.pos.z = boss.pos.z;
  t.vel.x = boss.vel.x; t.vel.y = boss.vel.y; t.vel.z = boss.vel.z;
  t.accY = boss.accY;
  t.pitch = boss.pitch; t.yaw = boss.yaw; t.roll = boss.roll;
  t.cel = BODY_LOOP_CEL;
  t.celFirst = BODY_LOOP_FIRST;
  t.celLast = BODY_LOOP_LAST;
}

/**
 * `Class32BodyLoopEffectTick` — `FUN_0047E130`.
 *
 * ```
 * if (!(boss+0x136C & 0x20)) { ActorKill(); return }
 * if (++t+0x1350 > t+0x1358) t+0x1350 = t+0x1354
 * push; T(boss x, boss y + 15.0, boss z) RotZ RotY RotX (the boss's angles)
 * a = t+0x138C += 0.05; if (a > 1.0) t+0x138C = 1.0
 * SetRenderLightColour(a, a*0.25, 0); SetDrawLayerNibble(9)
 * AssetDrawSlotWithAlpha(t+0x1350, a*0.5); SetDrawLayerNibble(8); pop
 * ```
 *
 * `Class32StateRaiseFlagAndLeave` clears the bit on the frame the exit
 * effect is made, and the loop dies the frame after.
 */
export function Class32BodyLoopEffectTick(t: Class32Task): void {
  t.draw = null;
  const boss = ActorByAt(t.parent);
  if (!boss || (boss.flags2 & Class32Flag2.BodyLoop) === 0) {
    t.killed = true;
    return;
  }
  t.cel += 1;
  if (t.cel > t.celLast) t.cel = t.celFirst;
  const m = MatIdentity();
  MatrixTranslate(m, boss.pos.x, Math.fround(boss.pos.y + BODY_LOOP_RISE),
                  boss.pos.z);
  MatrixRotateZ(m, boss.roll);
  MatrixRotateY(m, boss.yaw);
  MatrixRotateX(m, boss.pitch);
  let a = Math.fround(t.light + BODY_LOOP_FADE_IN);
  if (a > BODY_LOOP_FULL) a = BODY_LOOP_FULL;
  t.light = a;
  TaskDraw(t, m, t.cel, [a, Math.fround(a * BODY_LOOP_GREEN), 0],
           Math.fround(a * BODY_LOOP_ALPHA), BODY_LOOP_LAYER);
}

/**
 * `Class32SpawnHandsEffect` — `FUN_0047E250`.
 *
 * ```
 * t = ActorAlloc(Class32HandsEffectTick); ActorClearGameFields(t)
 * t+0x1390 = boss; t+0x6C = rand() & 0xFFFF
 * t+0x1350 = 0x1279; t+0x1354 = 0x127A; t+0x1358 = 0x1299
 * ```
 *
 * `rand()` is below `0x8000`, so the mask keeps all of it.
 */
export function Class32SpawnHandsEffect(boss: Actor, rng: Rng): void {
  const t = Class32AllocTask(Class32TaskRoutine.Hands, boss.at);
  t.roll = rng.int(CRT_RAND_RANGE);
  t.cel = HANDS_CEL;
  t.celFirst = HANDS_FIRST;
  t.celLast = HANDS_LAST;
}

/**
 * `Class32HandsEffectTick` — `FUN_0047E2B0`.
 *
 * ```
 * if (++t+0x1350 > t+0x1358) { ActorKill(); return }
 * a = g_camera_blocks[cam] * boss's node 8 point (+0x6F4)
 * b = g_camera_blocks[cam] * boss's node 5 point (+0x544)
 * t+0x40 = (a - b) * 0.5 + b
 * push; T(t+0x40) RotZ(t+0x6C) RotY(0) RotX(0)
 * SetRenderLightColour(1.0, 9.5, 0.54); AssetDrawSlot(t+0x1350); pop
 * ```
 *
 * One cel a frame, thirty-two of them, at the midpoint of the two hands as
 * the boss's last draw placed them.
 */
export function Class32HandsEffectTick(t: Class32Task): void {
  t.draw = null;
  t.cel += 1;
  if (t.cel > t.celLast) {
    t.killed = true;
    return;
  }
  const boss = ActorByAt(t.parent);
  if (boss) {
    BonePoint(boss, HANDS_BONE_A, _p);
    BonePoint(boss, HANDS_BONE_B, _q);
    t.pos.x = Math.fround((_p.x - _q.x) * HANDS_MID + _q.x);
    t.pos.y = Math.fround((_p.y - _q.y) * HANDS_MID + _q.y);
    t.pos.z = Math.fround((_p.z - _q.z) * HANDS_MID + _q.z);
  }
  const m = MatIdentity();
  MatrixTranslate(m, t.pos.x, t.pos.y, t.pos.z);
  MatrixRotateZ(m, t.roll);
  MatrixRotateY(m, 0);
  MatrixRotateX(m, 0);
  TaskDraw(t, m, t.cel, [...HANDS_LIGHT]);
}

/**
 * `Class32EmitProjectileTrail` — `FUN_0047F400`. `proj` is the projectile
 * actor.
 *
 * ```
 * t = ActorAlloc(Class32ProjectileTrailTick); ActorClearGameFields(t)
 * t+0x34 = 1; t+0x1390 = proj
 * t+0x40..t+0x6F = proj+0x40..proj+0x6F            ; REP MOVSD, 0xC
 * t+0x50 = 0; t+0x5C = ((rand() & 3) + 1) * 0.003
 * t+0x1320 = proj+0x1320; t+0x131A = proj+0x131A; t+0x13F0 = proj+0x13F0
 * t+0x118 = proj+0x118 + 0.15
 * ```
 */
export function Class32EmitProjectileTrail(proj: Boss5Actor, rng: Rng): void {
  const p = proj.boss5;
  const t = Class32AllocTask(Class32TaskRoutine.ProjectileTrail, proj.at);
  t.pos.x = proj.pos.x; t.pos.y = proj.pos.y; t.pos.z = proj.pos.z;
  t.vel.x = proj.vel.x; t.vel.z = proj.vel.z;
  t.pitch = proj.pitch; t.yaw = proj.yaw; t.roll = proj.roll;
  t.vel.y = 0;
  t.accY = Math.fround((rng.int(4) + 1) * TRAIL_RISE);
  t.bright = p.bright;
  t.attack = p.attack;
  t.slot = p.slot;
  t.size = Math.fround(p.size + TRAIL_GROW);
}

/**
 * `Class32ProjectileTrailTick` — `FUN_0047F4A0`.
 *
 * ```
 * t+0x50 += t+0x5C; t+0x44 += t+0x50                 ; it rises, faster
 * if ((t+0x118 -= 0.03) < 0.1) t+0x118 = 0.1
 * if ((t+0x1320 -= 5) < 0x5B) { t+0x1320 = 0x5A; ActorDespawn(t); return }
 * push; T RotZ RotY RotX Scale(t+0x118)
 * v = 1.0 / (float)(0xFF / t+0x1320); t+0x138C = v
 * proj+0x131A == 3 ? SetRenderLightColour(v, v*0.4, v*0.1)
 *                  : SetRenderLightColour(v + 0.5, v, v)
 * AssetDrawSlot(t+0x13F0); pop
 * ```
 *
 * The attack kind is read through `t+0x1390`, the projectile -- which may
 * have burst and gone since. The trail's own `+0x131A` is the same word:
 * `Class32SpawnProjectile` writes the projectile's once and nothing writes
 * it again, and the trail copied it (`[proved]`, the class's only stores to
 * `+0x131A` of a projectile), so the port reads the copy.
 */
export function Class32ProjectileTrailTick(t: Class32Task): void {
  t.draw = null;
  const vy = Math.fround(t.accY + t.vel.y);
  t.vel.y = vy;
  t.pos.y = Math.fround(vy + t.pos.y);
  let s = Math.fround(t.size - TRAIL_SHRINK);
  if (s < TRAIL_MIN) s = TRAIL_MIN;
  t.size = s;
  t.bright -= TRAIL_FADE;
  if (t.bright < TRAIL_END) {
    t.bright = AFTERIMAGE_END;
    t.killed = true;
    return;
  }
  const m = TaskMatrix(t);
  MatrixScale(m, t.size, t.size, t.size);
  const v = Math.fround(1.0 / Math.trunc(0xff / t.bright));
  t.light = v;
  const light: [number, number, number] = t.attack === TRAIL_BARRAGE_ATTACK
    ? [v, Math.fround(v * TRAIL_BARRAGE_GREEN), Math.fround(v * TRAIL_BARRAGE_BLUE)]
    : [Math.fround(v + TRAIL_RED_LIFT), v, v];
  TaskDraw(t, m, t.slot, light);
}

/**
 * `Class32SpawnDeathBurst` — `FUN_004805C0`.
 *
 * ```
 * t = ActorAlloc(Class32DeathBurstTick); ActorClearGameFields(t)
 * t+0x13F0 = 0xC53; t+0x1390 = boss; t+0x118 = 1.0
 * r = rand(); t+0x40 = g_camera_blocks[cam] * boss's node (r % 15 + 1) point
 * t+0x64 = rand() % 0xFFFF; t+0x68 = rand() % 0xFFFF; t+0x6C = rand() % 0xFFFF
 * t+0x118 = (float)((rand() & 3) + 1)
 * if (boss+0x1334 < 1) boss+0x1334 = 8
 * PlaySoundId(0xB16A9)
 * ```
 */
export function Class32SpawnDeathBurst(boss: Boss5Actor, rng: Rng,
                                       events?: Events): void {
  const t = Class32AllocTask(Class32TaskRoutine.DeathBurst, boss.at);
  t.slot = BURST_CEL;
  t.size = 1.0;
  const bone = rng.int(BURST_BONES) + 1;
  BonePoint(boss, bone, _p);
  t.pos.x = _p.x; t.pos.y = _p.y; t.pos.z = _p.z;
  // `rand() % 0xFFFF` for each angle: the CRT's `rand()` never reaches the
  // divisor, so each angle is `rand()` itself.
  t.pitch = rng.int(CRT_RAND_RANGE);
  t.yaw = rng.int(CRT_RAND_RANGE);
  t.roll = rng.int(CRT_RAND_RANGE);
  t.size = rng.int(4) + 1;
  if (boss.boss5.flash < 1) boss.boss5.flash = BURST_FLASH;
  events?.emit("sound.play", { id: SND_BURST });
}

/**
 * `Class32DeathBurstTick` — `FUN_00480700`.
 *
 * ```
 * if (++t+0x13F0 > 0xC68) { ActorKill(); return }
 * t+0x13F0 even ? boss+0x34 |= 8 : boss+0x34 &= ~8
 * push; T RotZ RotY RotX Scale(t+0x118); AssetDrawSlot(t+0x13F0); pop
 * ```
 *
 * Bit 3 is the one `MarkActorShot` raises, and `Class32OnShot` reads it the
 * next frame: with no shooter's bit beside it, `Class32ResolvePlayerShots`
 * charges nothing and clears it.
 */
export function Class32DeathBurstTick(t: Class32Task): void {
  t.draw = null;
  t.slot += 1;
  if (t.slot > BURST_LAST) {
    t.killed = true;
    return;
  }
  const boss = ActorByAt(t.parent);
  if (boss) {
    if (t.slot % 2 === 0) boss.flags |= ActorFlag.Hit;
    else boss.flags &= ~ActorFlag.Hit;
  }
  const m = TaskMatrix(t);
  MatrixScale(m, t.size, t.size, t.size);
  TaskDraw(t, m, t.slot, null);
}

/**
 * `Class32SpawnExitEffect` — `FUN_004807B0`.
 *
 * ```
 * t = ActorAlloc(Class32ExitEffectTick); ActorClearGameFields(t)
 * t+0x1390 = boss; t+0x40 = boss+0x100 (the tracked bone)
 * t+0x13F0 = 0x7F4; t+0x118 = 1.0
 * ```
 */
export function Class32SpawnExitEffect(boss: Actor): void {
  const t = Class32AllocTask(Class32TaskRoutine.ExitEffect, boss.at);
  t.pos.x = boss.lookAt.x;
  t.pos.y = boss.lookAt.y;
  t.pos.z = boss.lookAt.z;
  t.slot = EXIT_SHRINK_SLOT;
  t.size = 1.0;
}

/**
 * `Class32ExitEffectTick` — `FUN_00480810`.
 *
 * ```
 * sub 0: if ((t+0x118 -= 0.03) > 0) draw
 *        t+0x1330 = 15; t+0x118 = 0; sub = 1        ; and on into sub 1
 * sub 1: if (--t+0x1330 > 0) draw
 *        t+0x13F0 = 0x7EF; t+0x118 = 1.0
 *        boss+0x1F8 &= ~1; ActorSetPartVisibility(boss+0x194, 0)
 *        PlaySoundId(0xE23A9); sub++; t+0x1330 = 0  ; and on into sub 2
 * sub 2: if (++t+0x1330 > 2) { t+0x1330 = 0; if (++t+0x13F0 > 0x815) { ActorKill(); return } }
 * draw:  push; T(t+0x40) Scale(t+0x118); AssetDrawSlot(t+0x13F0); pop
 * ```
 *
 * The listing returns at `0x00480881`, past the `MatrixStackPop` Ghidra
 * once ended it on (L35). The boss is hidden on the frame the burst
 * starts: its skeleton (`model+0x64` bit 0) and its parts.
 */
export function Class32ExitEffectTick(t: Class32Task, events?: Events): void {
  t.draw = null;
  let toSub1 = false;
  let toSub2 = false;
  if (t.sub === 0) {
    const s = Math.fround(t.size - EXIT_SHRINK);
    t.size = s;
    if (s > 0.0) {
      ExitEffectDraw(t);
      return;
    }
    t.timer = EXIT_WAIT;
    t.size = 0;
    t.sub = 1;
    toSub1 = true;
  } else if (t.sub === 1) {
    toSub1 = true;
  } else if (t.sub === 2) {
    toSub2 = true;
  }
  if (toSub1) {
    t.timer -= 1;
    if (t.timer > 0) {
      ExitEffectDraw(t);
      return;
    }
    t.slot = EXIT_FIRST;
    t.size = 1.0;
    const boss = ActorByAt(t.parent);
    if (boss) {
      boss.motionFlags &= ~MotionFlag.Drawn;
      ActorSetPartVisibility(boss, 0);
    }
    events?.emit("sound.play", { id: SND_EXIT });
    t.sub += 1;
    t.timer = 0;
    toSub2 = true;
  }
  if (toSub2) {
    t.timer += 1;
    if (t.timer > EXIT_CEL_FRAMES) {
      t.timer = 0;
      t.slot += 1;
      if (t.slot > EXIT_LAST) {
        t.killed = true;
        return;
      }
    }
  }
  ExitEffectDraw(t);
}

/** `[port-only]` The exit effect's draw: `T(t+0x40) Scale(t+0x118)`. */
function ExitEffectDraw(t: Class32Task): void {
  const m = MatIdentity();
  MatrixTranslate(m, t.pos.x, t.pos.y, t.pos.z);
  MatrixScale(m, t.size, t.size, t.size);
  TaskDraw(t, m, t.slot, null);
}

/**
 * `[port-only]` The task walk over the pool: each task's routine, once, in
 * creation order, after the actors that made them -- `ActorAlloc` appends.
 * A task killed on an earlier frame leaves the pool here.
 */
export function Class32TasksTick(events?: Events): void {
  if (G.g_class32_tasks.some((t) => t.killed)) {
    G.g_class32_tasks = G.g_class32_tasks.filter((t) => !t.killed);
  }
  for (const t of G.g_class32_tasks) {
    switch (t.routine) {
      case Class32TaskRoutine.Afterimage: Class32AfterimageTick(t); break;
      case Class32TaskRoutine.BodyLoop: Class32BodyLoopEffectTick(t); break;
      case Class32TaskRoutine.Hands: Class32HandsEffectTick(t); break;
      case Class32TaskRoutine.ProjectileTrail: Class32ProjectileTrailTick(t); break;
      case Class32TaskRoutine.DeathBurst: Class32DeathBurstTick(t); break;
      case Class32TaskRoutine.ExitEffect: Class32ExitEffectTick(t, events); break;
    }
  }
}
