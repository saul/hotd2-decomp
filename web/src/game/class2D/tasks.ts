/**
 * Class 0x2D's small tasks: the boss's hit spark, the intro's flipbook, the
 * death burst and its UV scroll, the satellites' hit spark and their trails.
 *
 * Each is an `ActorAlloc(routine, size)` task in the engine, linked into the
 * ring after whatever allocated it and run by the same walk. The port keeps
 * them as records in `G.g_class2d_tasks` and steps them after the actor walk
 * in allocation order ({@link Class2DTasksTick}) -- the place an appended
 * task runs, so a task made this frame draws this frame, as the engine's
 * does. What each draws goes into `G.g_class2d_draws`.
 */
import type { Events } from "../../core/events";
import { ActorByAt, G } from "../globals";
import type { EmperorActor } from "../actor";
import { CameraBlockWorldToView } from "../camera/view";
import { PlaySoundId } from "../class45/rand";
import type { GameHost } from "../host";
import {
  MatCopy, MatIdentity, MatrixClearRotation, MatrixLoadIdentity,
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { SpawnClass } from "../spawn_class";
import { vec3, type Vec3 } from "../vec";
import {
  CLASS2D_FLARE_CELS, CLASS2D_FLARE_LAST, Class2DCameraLight,
  Class2DPushDraw,
} from "./draw";
import { Class2DTaskKind, makeClass2DTask, type Class2DTask } from "./state";

/** `[port-only]` -- a new task record at the end of the pool. */
function Alloc(kind: Class2DTaskKind): Class2DTask {
  const t = makeClass2DTask(G.g_class2d_task_seq++, kind);
  G.g_class2d_tasks.push(t);
  return t;
}

/**
 * `Class2DSpawnHitSpark` — `FUN_00429730`. `(obj)`:
 * `ActorAlloc(Class2DHitSparkUpdate, 0x40)`, `+0x34 = obj`, `+0x3C = 1` (the
 * bone), `+0x38 = 0`. `[proved]`
 */
export function Class2DSpawnHitSpark(ownerAt: number): void {
  const t = Alloc(Class2DTaskKind.HitSpark);
  t.owner = ownerAt;
  t.bone = 1;
  t.frame = 0;
}

/** `ADD ECX, 0x276` -- the spark's 25 cels, `eff_boss6.bin`. */
const SPARK_FIRST = 0x276;
/** `CMP EAX, 0x18; JLE` -- ActorKill past the 25th. */
const SPARK_LAST = 0x18;
/** `FCOMP [0x004C4C60]` -20.0, `FMUL [0x004C4C5C]`, `FADD [0x004C4C58]` 0.25. */
const SPARK_NEAR = -20.0;
const SPARK_RATE = Math.fround(0.03750009462237358);
const SPARK_BASE = 0.25;
/** `FLD [0x004C4380]` -- 1.0 inside the near plane; `FMUL qword [0x004C4C48]` 0.3. */
const SPARK_FULL = 1.0;
const SPARK_SCALE = 0.3;

const _v = vec3();

/**
 * `Class2DHitSparkUpdate` — `FUN_00429760`. The spark on the boss's bone:
 *
 * ```
 * r = owner's bone record (+0x3C); s = r.z + r.radius     ; view space
 * k = (s >= -20.0 ? -s * 0.0375 + 0.25 : 1.0) * 0.3
 * Push; Identity; Translate(r.x, r.y, s); Scale(k); NoOpStub(k)
 * AssetDrawSlot(0x276 + +0x38); Pop
 * if (+++0x38 > 0x18) ActorKill
 * ```
 *
 * `[proved]`. The record's `+0x68..+0x70` is the bone's hit centre in view
 * space; the port holds it in the world (`SkeletonBone.hit`) and takes it
 * through the frame's view matrix. The owner outlives any spark it makes --
 * its death runs for hundreds of frames -- so the engine never reads a freed
 * one; the port's lookup would draw nothing if it did.
 */
function Class2DHitSparkUpdate(t: Class2DTask): void {
  const obj = ActorByAt(t.owner);
  const rec = obj?.skel?.bones[t.bone];
  if (obj && rec) {
    const w2v = CameraBlockWorldToView(G.g_camera_index);
    MatrixTransformPoint(w2v, { x: rec.hit[0], y: rec.hit[1], z: rec.hit[2] },
                         _v);
    const radius = obj.boneRadius[String(t.bone)] ?? 0;
    const s = Math.fround(_v.z + radius);
    const k = Math.fround((s >= SPARK_NEAR ? -s * SPARK_RATE + SPARK_BASE
      : SPARK_FULL) * SPARK_SCALE);
    const m = MatIdentity();
    MatrixLoadIdentity(m);
    MatrixTranslate(m, _v.x, _v.y, s);
    MatrixScale(m, k, k, k);
    Class2DPushDraw(SPARK_FIRST + t.frame, m, true, null, false, null);
  }
  t.frame += 1;
  if (t.frame > SPARK_LAST) t.killed = true;
}

/**
 * `[port-only]` -- `Class2DState0`'s `ActorAlloc(Class2DIntroFlipbookUpdate,
 * 0x13F4)` and `ActorClearGameFields` at `0x00426CB9`, as a record.
 */
export function Class2DSpawnIntroFlipbook(): void {
  Alloc(Class2DTaskKind.IntroFlipbook);
}

/** `PUSH 0xC109999A` -- -8.6; `PUSH 0xF000`; `ADD EAX, 0x161B`. */
const FLIP_Z = Math.fround(-8.6);
const FLIP_TILT = 0xf000;
const FLIP_FIRST = 0x161b;
/** `CMP EAX, 0xF` -- the shake; `MOV [0x009C8E8C], 0x30`. */
const FLIP_SHAKE_AT = 0xf;
const FLIP_SHAKE_FRAMES = 0x30;
/** `CMP EAX, 0x20; JLE` -- ActorKill past it. */
const FLIP_LAST = 0x20;

/**
 * `Class2DIntroFlipbookUpdate` — `FUN_00429830`. Allocated at camera path
 * 0xDF frame 0x667:
 *
 * ```
 * Push; Identity; Translate(0, 0, -8.6); RotX(0xF000)
 * AssetDrawSlot(0x161B + +0x1320 / 2); Pop
 * if (+++0x1320 == 0xF) g_screen_shake_frames = 0x30
 * if (+++0x1320 > 0x20) ActorKill
 * ```
 *
 * `[proved]`: one cel a frame, `0x161B..0x162B` (`eff_2.bin`), in the
 * camera's own space, and the screen shakes on the eighth.
 */
function Class2DIntroFlipbookUpdate(t: Class2DTask): void {
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixTranslate(m, 0, 0, FLIP_Z);
  MatrixRotateX(m, FLIP_TILT);
  Class2DPushDraw(FLIP_FIRST + Math.trunc(t.frame / 2), m, true, null, false,
                  null);
  t.frame += 1;
  if (t.frame === FLIP_SHAKE_AT) G.g_screen_shake_frames = FLIP_SHAKE_FRAMES;
  t.frame += 1;
  if (t.frame > FLIP_LAST) t.killed = true;
}

/**
 * `[port-only]` -- `Class2DState6`'s `ActorAlloc(Class2DDeathBurstUpdate,
 * 0x13F4)`, `ActorClearGameFields` and the position copy at `0x00428C35`.
 */
export function Class2DSpawnDeathBurst(pos: Vec3): void {
  const t = Alloc(Class2DTaskKind.DeathBurst);
  t.pos = vec3(pos.x, pos.y, pos.z);
}

/** `PUSH 0x191`, `PUSH 0x190` -- the burst's two curves (object paths). */
const BURST_CURVE_A = 0x191;
const BURST_CURVE_B = 0x190;
/** `CMP [+0x1320], 0x50` and `FSUB [0x004E1FC4]` 80.0, `FMUL [0x0055D1A8]` 0.0625. */
const BURST_FADE_FROM = 0x50;
const BURST_FADE_ORIGIN = 80.0;
const BURST_FADE_RATE = 0.0625;
/** The burst's sounds and their frames. */
const BURST_SOUND_A_FRAME = 0x1a;
const BURST_SOUND_B_FRAME = 5;
const SND_BURST_A1 = 0xd25a9;
const SND_BURST_A2 = 0x1825a9;
const SND_BURST_B = 0x1725a9;
/** `PUSH 0x40400000` x3 -- the burst's scale. */
const BURST_SCALE = 3.0;
/** Its slots. */
const BURST_SHELL = 0x16b6;
const BURST_RING = 0xb00;
const BURST_CORE_FIRST = 0x18c4;
const BURST_CORE = 0x18c5;
const BURST_STRIP_FIRST = 0x190d;
/** `FMUL [0x0055D1A4]` -- 0.065217, the core's growth a frame. */
const BURST_CORE_GROWTH = Math.fround(0.06521739065647125);
/** `PUSH 0x41F00000` -- the flare behind it, scale 30, turned half round. */
const BURST_FLARE_SCALE = 30.0;
const BURST_FLARE_TURN = 0x8000;
/** `FADD [0x0055D1A0]` -- 0.4, the curves' frame a frame; `CMP EAX, 0x60`. */
const BURST_STEP = Math.fround(0.4000000059604645);
const BURST_LAST = 0x60;
/** The frames the pieces show from and until. */
const BURST_SHELL_FROM = 0x1b;
const BURST_RING_UNTIL = 0x18;
const BURST_CORE_FROM = 0x1a;

/**
 * `Class2DScrollBurstModelUVs` — `FUN_00429C90`. Slot `0x16B6`'s resident
 * model, every full vertex's `+0x1C` lowered by 0.005 in place (the low bit,
 * the vertex format's marker, forced back on). Its argument is unread.
 *
 * `[port-only]` in representation: the model is the renderer's, so the port
 * counts the calls (`G.g_class2d_burst_uv_scroll`) and `render/` applies the
 * accumulated scroll to the model's second UV coordinate. A slot that is not
 * resident (`+0x0C` bit `0x8000` clear) is left alone by the engine; the port
 * counts regardless, and the renderer has no model to scroll until it loads.
 */
function Class2DScrollBurstModelUVs(): void {
  G.g_class2d_burst_uv_scroll += 1;
}

/**
 * `Class2DDeathBurstUpdate` — `FUN_004298C0`. The boss's end, at its last
 * position. `n` is `+0x1320`, `u` `+0x1340`:
 *
 * ```
 * alpha = n >= 0x50 ? 1.0 - (u - 80.0) * 0.0625 : 1.0
 * A = CamEvalPath7(0x191, u); B = CamEvalPath7(0x190, u)     ; scale triples
 * if (!+0x1324 && n == 0x1A) { +0x1324 = 1; PlaySoundId(0xD25A9, 0x1825A9) }
 * else if (!+0x1328 && n == 5) { +0x1328 = 1; PlaySoundId(0x1725A9) }
 * LightsUseCustomSet(1.0, camera block pitch, yaw, 1, 1, 1)
 * Push; Translate(pos); MatrixClearRotation; Scale(3)         ; a billboard
 * if (n >= 0x1B) { Push; Class2DScrollBurstModelUVs; Scale(B.look);
 *                  AssetDrawSlotWithAlpha(0x16B6, alpha); Pop }
 * if (n <= 0x18) { Push; Scale(A.look); AssetDrawSlot(0xB00); Pop }
 * if (n >= 0x1B) { Push; Scale(A.eye); AssetDrawSlotWithAlpha(0xB00, alpha); Pop
 *                  Push; MatrixClearRotation; RotZ(0x8000); Scale(30)
 *                  AssetDrawSlotWithAlpha(0x19B3 - g_blink_frame_counter % 24, alpha); Pop }
 * if (n >= 0x1A) { Push; n == 0x1A ? AssetDrawSlot(0x18C4)
 *                    : { Scale(1 + (n - 0x1B) * 0.065217); AssetDrawSlotWithAlpha(0x18C5, alpha) }
 *                  Pop; Push; AssetDrawSlotWithAlpha(0x190D + n, alpha); Pop }
 * Pop; LightsRestoreScene
 * u += 0.4; n = __ftol(u); if (n > 0x60) ActorKill
 * ```
 *
 * `[proved]`. The two curves are `op_st6`'s, evaluated for their six floats
 * by `CamEvalPath7` -- the eye triple and the look-at triple -- which the
 * host's object path hands over as the position and the three angle
 * channels, unrounded. The billboard is built on the view the walk left on
 * the stack, so its matrix is the camera's own space.
 */
function Class2DDeathBurstUpdate(t: Class2DTask, host: GameHost,
                                 events?: Events): void {
  const n = t.frame;
  const alpha = n >= BURST_FADE_FROM
    ? Math.fround(1.0 - (t.curveFrame - BURST_FADE_ORIGIN) * BURST_FADE_RATE)
    : 1.0;
  const a = host.objectPath?.(BURST_CURVE_A, t.curveFrame) ?? null;
  const b = host.objectPath?.(BURST_CURVE_B, t.curveFrame) ?? null;
  const aEye = [a?.x ?? 0, a?.y ?? 0, a?.z ?? 0];
  const aLook = [a?.pitch ?? 0, a?.yaw ?? 0, a?.roll ?? 0];
  const bLook = [b?.pitch ?? 0, b?.yaw ?? 0, b?.roll ?? 0];
  if (t.sound1 === 0 && n === BURST_SOUND_A_FRAME) {
    t.sound1 = 1;
    PlaySoundId(SND_BURST_A1, events);
    PlaySoundId(SND_BURST_A2, events);
  } else if (t.sound2 === 0 && n === BURST_SOUND_B_FRAME) {
    t.sound2 = 1;
    PlaySoundId(SND_BURST_B, events);
  }
  const light = Class2DCameraLight();
  const base = MatCopy(MatIdentity(),
                       CameraBlockWorldToView(G.g_camera_index));
  MatrixTranslate(base, t.pos.x, t.pos.y, t.pos.z);
  MatrixClearRotation(base);
  MatrixScale(base, BURST_SCALE, BURST_SCALE, BURST_SCALE);
  if (n >= BURST_SHELL_FROM) {
    const m = MatCopy(MatIdentity(), base);
    Class2DScrollBurstModelUVs();
    MatrixScale(m, bLook[0], bLook[1], bLook[2]);
    Class2DPushDraw(BURST_SHELL, m, true, alpha, false, light);
  }
  if (n <= BURST_RING_UNTIL) {
    const m = MatCopy(MatIdentity(), base);
    MatrixScale(m, aLook[0], aLook[1], aLook[2]);
    Class2DPushDraw(BURST_RING, m, true, null, false, light);
  }
  if (n >= BURST_SHELL_FROM) {
    const m = MatCopy(MatIdentity(), base);
    MatrixScale(m, aEye[0], aEye[1], aEye[2]);
    Class2DPushDraw(BURST_RING, m, true, alpha, false, light);
    const f = MatCopy(MatIdentity(), base);
    MatrixClearRotation(f);
    MatrixRotateZ(f, BURST_FLARE_TURN);
    MatrixScale(f, BURST_FLARE_SCALE, BURST_FLARE_SCALE, BURST_FLARE_SCALE);
    Class2DPushDraw(CLASS2D_FLARE_LAST
                    - ((G.g_blink_frame_counter >>> 0) % CLASS2D_FLARE_CELS),
                    f, true, alpha, false, light);
  }
  if (n >= BURST_CORE_FROM) {
    const m = MatCopy(MatIdentity(), base);
    if (n === BURST_CORE_FROM) {
      Class2DPushDraw(BURST_CORE_FIRST, m, true, null, false, light);
    } else {
      const s = Math.fround((n - 0x1b) * BURST_CORE_GROWTH + 1.0);
      MatrixScale(m, s, s, s);
      Class2DPushDraw(BURST_CORE, m, true, alpha, false, light);
    }
    Class2DPushDraw(BURST_STRIP_FIRST + n, base, true, alpha, false, light);
  }
  t.curveFrame = Math.fround(t.curveFrame + BURST_STEP);
  t.frame = Math.trunc(t.curveFrame);
  if (t.frame > BURST_LAST) t.killed = true;
}

/**
 * `Class2DSatelliteSpawnHitSpark` — `FUN_0042BE50`. `(obj)`:
 * `ActorAlloc(Class2DSatelliteHitSparkUpdate, 0x58)`, `+0x38..+0x40` = the
 * satellite's view-space point `+0x70..+0x78` with `z + 1.0`, `+0x50 = 0`.
 * `[proved]`
 */
export function Class2DSatelliteSpawnHitSpark(view: Vec3): void {
  const t = Alloc(Class2DTaskKind.SatelliteHitSpark);
  t.pos = vec3(view.x, view.y, view.z + 1.0);
  t.frame = 0;
}

/** `ADD EAX, 0x17B0` -- five cels of `eff_2.bin`; `CMP EAX, 4; JL`. */
const SAT_SPARK_FIRST = 0x17b0;
const SAT_SPARK_LAST = 4;

/**
 * `Class2DSatelliteHitSparkUpdate` — `FUN_0042BE90`. `Push; Identity;
 * Translate(+0x38, +0x3C, +0x40); AssetDrawSlot(0x17B0 + +0x50); Pop;
 * if (+0x50++ >= 4) ActorKill` -- five cels in the camera's own space.
 * `[proved]`
 */
function Class2DSatelliteHitSparkUpdate(t: Class2DTask): void {
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixTranslate(m, t.pos.x, t.pos.y, t.pos.z);
  Class2DPushDraw(SAT_SPARK_FIRST + t.frame, m, true, null, false, null);
  const n = t.frame;
  t.frame += 1;
  if (n >= SAT_SPARK_LAST) t.killed = true;
}

/** Twenty points; `MOV EDX, 0x14`. */
const TRAIL_POINTS = 0x14;

/**
 * `Class2DSatelliteSpawnTrail` — `FUN_0042BEE0`. `(obj)`:
 *
 * ```
 * t = ActorAlloc(Class2DSatelliteTrailUpdate, 0x130)
 * 20 times: t+0x34..+0x3C = obj+0x40..+0x48
 * t+0x12C = obj; t+0x128 = obj+0x1340; obj+0x1368 = 0
 * ```
 *
 * `[proved]`. The loop's destination never moves: all twenty stores go to
 * the first point, and the other nineteen are the allocation's zeroes until
 * the update shifts the first along them.
 */
export function Class2DSatelliteSpawnTrail(obj: EmperorActor): void {
  const s = obj.class2d.sat;
  if (!s) return;
  const t = Alloc(Class2DTaskKind.SatelliteTrail);
  t.points = Array.from({ length: TRAIL_POINTS }, () => vec3());
  for (let k = 0; k < TRAIL_POINTS; k++) {
    t.points[0].x = obj.pos.x;
    t.points[0].y = obj.pos.y;
    t.points[0].z = obj.pos.z;
  }
  t.owner = obj.at;
  t.scale = s.scale;
  s.trailOff = 0;
}

/**
 * The byte map at `0x0042C090` through the table at `0x0042C084`: point 0 is
 * the owner's (arm 0), points 1, 4, 10 and 18 are drawn and shifted (arm 1,
 * which runs into arm 2), every other point is shifted (arm 2). Point 19 is
 * past the map (`CMP ESI, 0x12; JA`) and shifted.
 */
const TRAIL_DRAWN: ReadonlySet<number> = new Set([1, 4, 10, 18]);
/** `PUSH 0x72B` -- the trail's model; `FSUBR [0x004C43A8]` 0.8, `FMUL [0x0055D230]` 0.1. */
const TRAIL_SLOT = 0x72b;
const TRAIL_ALPHA_BASE = Math.fround(0.800000011920929);
const TRAIL_ALPHA_STEP = Math.fround(0.10000000149011612);
/** `SHL EAX, 8` -- the spin. */
const SPIN_SHIFT = 8;

/**
 * `Class2DSatelliteTrailUpdate` — `FUN_0042BF30`.
 *
 * ```
 * if (owner+0x1368 == 1) ActorKill
 * LightsUseCustomSet(1.0, camera block pitch/yaw, 1, 1, 1)
 * for i = 19 .. 0:
 *   i == 0: point[0] = owner.pos
 *   i in {1, 4, 10, 18}: Push; Translate(point[i]); RotY(g_frame_counter << 8)
 *                         Scale(+0x128); UVs(0x72B)
 *                         AssetDrawSlotWithAlpha(0x72B, 0.8 - i * 0.1); Pop
 *   i >= 1: point[i] = point[i - 1]
 * LightsRestoreScene
 * ```
 *
 * `[proved]`. The alpha goes below zero at points 10 and 18.
 */
function Class2DSatelliteTrailUpdate(t: Class2DTask): void {
  const owner = ActorByAt(t.owner);
  const s = owner?.cls === SpawnClass.Emperor ? owner.class2d.sat : null;
  if (!s || s.trailOff === 1) {
    t.killed = true;
    return;
  }
  const light = Class2DCameraLight();
  for (let i = TRAIL_POINTS - 1; i >= 0; i--) {
    if (i === 0) {
      t.points[0].x = owner!.pos.x;
      t.points[0].y = owner!.pos.y;
      t.points[0].z = owner!.pos.z;
      continue;
    }
    if (TRAIL_DRAWN.has(i)) {
      const p = t.points[i];
      const m = MatIdentity();
      MatrixTranslate(m, p.x, p.y, p.z);
      MatrixRotateY(m, (G.g_frame_counter << SPIN_SHIFT) | 0);
      MatrixScale(m, t.scale, t.scale, t.scale);
      Class2DPushDraw(TRAIL_SLOT, m, false,
                      Math.fround(TRAIL_ALPHA_BASE - i * TRAIL_ALPHA_STEP),
                      true, light);
    }
    t.points[i].x = t.points[i - 1].x;
    t.points[i].y = t.points[i - 1].y;
    t.points[i].z = t.points[i - 1].z;
  }
}

/**
 * `[port-only]` -- the pool's walk: every task one engine frame, in
 * allocation order, and the killed ones out after it.
 */
export function Class2DTasksTick(host: GameHost, events?: Events): void {
  for (const t of G.g_class2d_tasks) {
    switch (t.kind) {
      case Class2DTaskKind.HitSpark: Class2DHitSparkUpdate(t); break;
      case Class2DTaskKind.IntroFlipbook: Class2DIntroFlipbookUpdate(t); break;
      case Class2DTaskKind.DeathBurst:
        Class2DDeathBurstUpdate(t, host, events);
        break;
      case Class2DTaskKind.SatelliteHitSpark:
        Class2DSatelliteHitSparkUpdate(t);
        break;
      case Class2DTaskKind.SatelliteTrail: Class2DSatelliteTrailUpdate(t); break;
    }
  }
  G.g_class2d_tasks = G.g_class2d_tasks.filter((t) => !t.killed);
}

