/**
 * Class 0x15 -- **a row of floating planks**, stage 2's boss arena.
 *
 * The class's handler is a placer: `FloatingPropRowSpawn` builds `N` planks a
 * fixed step apart, each an object of its own running `FloatingPropUpdate`,
 * and kills itself. Every plank floats on the class-0x16 wave field -- it
 * samples the surface at four corners, rides their mean and turns toward
 * their normal a little each frame -- tips and sinks under the stage-2 boss's
 * feet (`g_class14_foot_contacts`), swings back when the foot lifts, and is a
 * collision mesh while it lasts (its descriptor flags carry `0x10 | 0x40`).
 *
 * Two descriptors, both `komono_boss2.bin[6]` (slot `0x16E0`) with blob
 * `coli2.bin` offset 6160 (the descriptor's `0x0CED0810`), flag 8 and camera
 * cue `(114, 0)`:
 *
 * | evt | spawned at | planks | leave on flag 8 |
 * |---|---|---|---|
 * | 84156 | blocks 16 step 14, 20 step 2, 35 step 0 | 30, 10 apart along -z from `(-1338.17, -23.0, -1902.56)` | the first 24 allocated, 10 frames apart; 6 stay |
 * | 91256 | block 39 step 1 | 6, the same row's near end | none |
 *
 * A plank that leaves on the flag throws `sanbasi.bin[12..90]` (strip kind 1,
 * `SIBUKI2_16`) every third and shakes the screen. Each spawn comes two ops
 * after the class-0x16 field it floats on, in the same step.
 *
 * ## The draw
 *
 * `AssetDrawSlot(obj+0x1F4)` under `T(x, mean - sink, z) RotX RotZ RotY` and
 * the pushed tilt, built on the camera's view. The port builds it on the
 * identity -- the world matrix, as `class12/` does for the same reason (see
 * `RegisterForShotTest` in `combat/shot_test.ts`) -- stores it as the
 * object's mesh matrix and records the draw for `render/view_slots.ts`.
 */
import type { Actor } from "../actor";
import { CameraBlockYaw } from "../camera/view";
import { PropBehaviour } from "../class13";
import { WaterFieldSampleHeight } from "../class16";
import { NoOpStub } from "../class45";
import { ColiStoreObjectMatrix } from "../coli";
import { RegisterForShotTest } from "../combat/shot_test";
import { PropStripKind, SpawnPropStripEffect } from "../effects/prop_strip";
import { G } from "../globals";
import {
  FtolS16, MatIdentity, MatrixLoadIdentity, MatrixRotateAxis, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixToEulerBams, MatrixTransformPoint,
  MatrixTranslate, RADIANS_TO_BAMS, type Mat, type Rot3,
} from "../matrix";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { vec3, type Vec3 } from "../vec";
import { DrawSlotInWorld } from "../view_slot";
import {
  FloatingPropRoutine, makeFloatingPropTail, type FloatingPropTail,
} from "./state";

type FloatingPropActor = Extract<Actor, { cls: SpawnClass.FloatingPropRow }>;

/** `FADD/FSUB float ptr [0x004C4C8C]` -- 20.0, the corners' x half-span. */
const CORNER_X = 20;
/** `[0x0055D2B4]` -- 5.0, their z half-span and the contacts' z window. */
const CORNER_Z = 5;
/** `FADD float ptr [0x004C4CBC]` -- 2.5 above the surface. */
const FLOAT_RISE = 2.5;
/** `FMUL float ptr [0x004C4C58]` -- 0.25: the mean, and the sink's easing. */
const QUARTER = 0.25;
/** `CMP EDI, 0x60` / `CMP EDI, -0x60` -- the most the plank turns a frame. */
const TILT_STEP_MAX = 0x60;
/** `FMUL float ptr [0x0056451C]` -- BAMS of tip per unit of distance x strength. */
const CONTACT_TIP = Math.fround(0.65536);
/** `FMUL float ptr [0x00564518]` -- sink per unit of strength. */
const CONTACT_SINK = Math.fround(0.005);
/** `[0x004C43B0]` and `[0x00564514]` -- 100.0 and -100.0, the push axis. */
const PUSH_AXIS_SCALE = 100;
/** `ADD EAX, 0x400` -- the swing's phase step. */
const SWING_STEP = 0x400;
/** `FMUL float ptr [0x005644F4]` -- 0.7, the sink's decay at a node. */
const SWING_DECAY = Math.fround(0.7);
/** `FMUL double ptr [0x004C4370]` -- `g_bams_to_rad`, a double. */
const BAMS_TO_RAD_F64 = 9.587379924285257e-05;
/** `PUSH 0x3F333333` -- the leaving strip's scale. */
const LEAVE_STRIP_SCALE = Math.fround(0.7);
/** `MOV [0x009C8E8C], 6` -- `g_screen_shake_frames` as it leaves. */
const LEAVE_SHAKE_FRAMES = 6;
/** `CMP EDX, 1` after `IDIV 3` -- every third plank leaves with a strip. */
const LEAVE_STRIP_EVERY = 3;
const LEAVE_STRIP_PHASE = 1;
/** `AND AL, 0xFE; OR EAX, 0x80008000` -- what the kill leaves in `obj+0x34`. */
const KILL_FLAGS_CLEAR = 1;
const KILL_FLAGS_SET = 0x80008000;

/**
 * The `g_prop_behaviours` entries a plank can have installed --
 * `0x005926A8`, by `sub+0x00`'s index. Both shipped descriptors name entry 0,
 * `NoOpStub`, and the exporter carries no other (`slotDrawnSpawn`).
 */
const PROP15_BEHAVIOURS: Partial<Record<number, (obj: Actor) => void>> = {
  [PropBehaviour.None]: NoOpStub,
};

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it: no `ActorDespawn` in
 * front and no hit slot. `[port-only]` as a name, as `PathRidingPropKill` in
 * `class28/index.ts` is.
 */
function FloatingPropKill(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
}

/** `__ftol` then `MOVSX AX`... into a word: the low sixteen bits, signed. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `FloatingPropRowSpawn` — `FUN_00441750`. Class 0x15's handler: the row,
 * then the kill.
 *
 * ```
 * 00441761  EDI = obj+0x130C; n = (s8)[EDI+0x24]; if (n == 0) goto clear
 *           for (rem = n, i = n - 1; rem; rem--, i--) {
 * 00441788    c = ActorAlloc(0x4418C0, 0x1314); ActorClearGameFields(c)
 * 00441799    c+0x34 = obj+0x34
 * 004417A5    c+0x40.. = i * [EDI+0x18..0x20] + obj+0x40..      ; FILD i
 * 004417C6    c+0x64.. = obj+0x64..;  c+0x3C = i;  c+0x130C = EDI
 * 004417E9    sub = ActorAllocRaw(0x34); c+0x1310 = sub; TaskSetUserBlock(c, sub)
 * 004417FD    c+0x1F4 = word [EDI];  c+0x14C = [EDI+4]
 * 00441813    sub+0 = g_prop_behaviours[(s16)[EDI+8]]
 * 00441820    sub+6, 8, A, C, E = words [EDI+0xA, 0xC, 0xE, 0x10, 0x12]
 * 0044184C    if (rem > (s8)[EDI+0x25]) { sub+4 = acc; acc += word [EDI+0x26] }
 *             else sub+4 = -1
 * 00441872    sub+0x10 = sub+0x20 = sub+0x24 = sub+0x28 = sub+0x2C = 0
 *           }
 * 00441898  clear: for (p = 0x9A3500; p < 0x9A3540; p += 0x10) *p = 0
 * 004418AE  ActorKill()
 * ```
 *
 * `[proved]`. Only the four `strength` words of `g_class14_foot_contacts`
 * are cleared, not the points. The delay is stored as a word, so only the
 * low sixteen bits of the sum matter.
 *
 * `[port-only]` in two places. A plank is put in the pool with
 * {@link ActorSpawn}, which runs the class's `init` -- this -- at once; the
 * engine allocates it with its update and no `Init`, so a plank returns here
 * on its routine. And the plank takes the next of `g_summoned_actor_at`'s
 * addresses, as every object made with no descriptor of its own does.
 */
export function FloatingPropRowSpawn(obj: Actor): void {
  if (obj.cls !== SpawnClass.FloatingPropRow) return;
  if (obj.float15.routine !== FloatingPropRoutine.RowSpawn) return;
  const tail = obj.class15;
  if (!tail) return;
  const n = tail.count;
  let acc = 0;
  for (let rem = n, i = n - 1; rem !== 0; rem--, i--) {
    const at = G.g_summoned_actor_at;
    G.g_summoned_actor_at -= 1;
    const t: FloatingPropTail = {
      ...makeFloatingPropTail(), routine: FloatingPropRoutine.Plank,
    };
    const c = ActorSpawn(at, SpawnClass.FloatingPropRow, -1, "plank",
                         { float15: t, visible: true } as Partial<Actor>);
    c.flags = obj.flags;
    c.pos = vec3(Math.fround(i * tail.delta[0] + obj.pos.x),
                 Math.fround(i * tail.delta[1] + obj.pos.y),
                 Math.fround(i * tail.delta[2] + obj.pos.z));
    c.pitch = obj.pitch;
    c.yaw = obj.yaw;
    c.roll = obj.roll;
    t.rowIndex = i;
    c.class15 = tail;
    t.slot = tail.slot;
    c.coliBlob = tail.coli;
    t.behaviour = tail.behaviour;
    t.camPath = tail.cam_path;
    t.camFrame = tail.cam_frame;
    t.word0A = tail.word_0e;
    t.word0C = tail.word_10;
    t.flag = tail.flag;
    if (rem > tail.keep) {
      t.delay = s16(acc);
      acc += tail.delay_step;
    } else {
      t.delay = -1;
    }
    t.tiltBams = 0;
    t.sink = 0;
    t.pressed = 0;
    t.swingBams = 0;
    t.swingSink = 0;
  }
  for (const contact of G.g_class14_foot_contacts) contact.strength = 0;
  FloatingPropKill(obj);
}

/** `RotY(-ry) RotZ(-rz) RotX(-rx)` and the rest of the frame's matrices. */
const _top: Mat = MatIdentity();
const _w: Vec3 = vec3();
const _up: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * The stack top's 3x3 as {@link MatrixToEulerBams} takes it: the transpose,
 * a column-vector rotation. `[port-only]` -- the engine hands the routine
 * the top itself.
 */
function TopAsRot3(m: Mat): Rot3 {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}

/** `MatrixTransformPoint` into a float-stored `out`. */
function TransformToFloats(m: Mat, v: Vec3, out: Vec3): void {
  MatrixTransformPoint(m, v, out);
  out.x = Math.fround(out.x);
  out.y = Math.fround(out.y);
  out.z = Math.fround(out.z);
}

/**
 * `FloatingPropUpdate` — `FUN_004418C0`. One plank, one frame.
 *
 * ```
 * 004418E2  if (g_active_cam_path == (s16)sub+6 && g_cam_path_frame == (s16)sub+8) kill
 * 00441912  if ((s16)sub+4 >= 0 && g_script_flags[(s16)sub+0xE]) {
 *             if (sub+4-- == 0) {
 * 00441942      if (((s8)tail+0x24 - obj+0x3C) % 3 == 1) {
 *                 SpawnPropStripEffect({pos, 0, block yaw, 0}, 1, 0.7);
 *                 g_screen_shake_frames = 6; }
 * 004419B3      kill } }
 * 004419D3  CALL [sub+0]
 * 004419D5  corners (x+20, z+5) (x+20, z-5) (x-20, z-5) (x-20, z+5), each
 *           y = WaterFieldSampleHeight + 2.5; mean = sum / 4
 * 00441AE2  best = the highest (ties to the earlier best, from 3);
 *           a, b, c = corners (best-2)&3, (best+1)&3, (best-1)&3
 *           n = (c - a) x (b - a)
 * 00441B94  Push; LoadIdentity; RotY(-ry); RotZ(-rz); RotX(-rx); w = T(n)
 * 00441C11  tilt = s16(atan2(|w.xz|, w.y) * K)
 * 00441C21  if (tilt) { k = tilt == 0x8000 ? (1,0,0) : (w.z, 0, -w.x)
 *             LoadIdentity; RotX(rx); RotZ(rz); RotY(ry); RotAxis(k, clamp(tilt, +-0x60))
 *             MatrixToEulerBams(&rx, &ry, &rz); pos = (x, mean, z) }
 * 00441CF4  LoadIdentity; if (sub+0x10) RotAxis(sub+0x14, -sub+0x10); sum = 0
 * 00441D1C  for each foot contact with strength != 0 and z-5 <= c.z <= z+5:
 *             RotAxis((c.z - z, 0, x - c.x), ftol(|c - (x, mean, z)| * s * 0.65536))
 *             sum += s * 0.005
 * 00441DE6  if (sum == 0) { if (sub+0x24) { sub+0x28 = sub+0x10; sub+0x2C = sub+0x20;
 *                                           sub+0x30 = 0 } sub+0x24 = 0 }
 *           else { sub+0x24 = 1; sub+0x28 = sub+0x2C = 0 }
 * 00441E23  if (sub+0x24) { ...the pushed tilt, below...; sub+0x20 += (sum - sub+0x20) / 4 }
 * 00441F7E  else { sub+0x30 += 0x400; c = cos(sub+0x30)
 *             if (c == 0.0) { sub+0x28 = 2 * sub+0x28 / 3; sub+0x2C *= 0.7 }
 *             if (sub+0x28) sub+0x10 = ftol(sub+0x28 * c)
 *             if (sub+0x2C != 0) sub+0x20 = c * sub+0x2C }
 * 00441FFD  SetTop(view); Translate(x, mean - sub+0x20, z); RotX; RotZ; RotY
 *           if (sub+0x10) RotAxis(sub+0x14, sub+0x10)
 *           AssetDrawSlot((s16)obj+0x1F4); MatrixStore(obj+0x150); Pop
 *           RegisterForShotTest(obj)
 * ```
 *
 * The pushed tilt, from the top the contacts left: `w = T(0, 1, 0)`, `q =
 * s16(atan2(|w.xz|, 1.0) * K) / 4` (`CDQ; AND EDX, 3; ADD; SAR 2` -- toward
 * zero); then `LoadIdentity` and, with a tilt already held, `RotAxis(sub+0x14,
 * sub+0x10)`, `RotAxis((100 w.z, 0, -100 w.x), q)` when `q` is not 0, and
 * the held tilt re-read off the result the same way, without the quarter;
 * with none held, `q` becomes the tilt about `(w.z, 0, -w.x)`.
 *
 * `[proved]`, from the listing: the pseudocode's stack slots alias across
 * the four sampler calls. Three things worth knowing:
 *
 * - **The height the plank is drawn at is the mean, every frame; the height
 *   it stores is the mean only on a frame it turns.** On a frame the water
 *   under it is flat in its own frame, `obj+0x44` keeps the last turned
 *   frame's, and that is what the strip it leaves with is thrown from.
 * - **The release's decay never runs.** `cos(sub+0x30)` is tested against
 *   `0.0` exactly, and the phase is a multiple of `0x400` BAMS times a
 *   double that is not pi over a power of two, so the cosine at a node is
 *   about `6e-17`, not zero. So a released plank swings at the amplitude the
 *   last pressed frame left, for as long as it lives. The port's `Math.cos`
 *   gives the same non-zero values, so the arm is transcribed and dead here
 *   as it is there.
 * - **The `0x8000` arm is dead too**: the tilt is `MOVSX`'d, and a word
 *   sign-extended is never `+0x8000`.
 */
export function FloatingPropUpdate(obj: FloatingPropActor, f: ClassFrame):
    void {
  const t = obj.float15;
  const tail = obj.class15!;
  if (G.g_active_cam_path === t.camPath && G.g_cam_path_frame === t.camFrame) {
    obj.flags = (obj.flags & ~KILL_FLAGS_CLEAR) | KILL_FLAGS_SET;
    FloatingPropKill(obj);
    return;
  }
  if (t.delay >= 0 && (G.g_script_flags[t.flag] ?? 0) !== 0) {
    const was = t.delay;
    t.delay = s16(was - 1);
    if (was === 0) {
      if ((tail.count - t.rowIndex) % LEAVE_STRIP_EVERY === LEAVE_STRIP_PHASE) {
        SpawnPropStripEffect({
          pos: obj.pos, pitch: 0, yaw: CameraBlockYaw(G.g_camera_index),
          roll: 0,
        }, PropStripKind.Kind1, LEAVE_STRIP_SCALE, f.events);
        G.g_screen_shake_frames = LEAVE_SHAKE_FRAMES;
      }
      obj.flags = (obj.flags & ~KILL_FLAGS_CLEAR) | KILL_FLAGS_SET;
      FloatingPropKill(obj);
      return;
    }
  }
  PROP15_BEHAVIOURS[t.behaviour]?.(obj);

  // -- the four corners on the water --------------------------------------
  const x = obj.pos.x, z = obj.pos.z;
  const y0 = obj.pos.y;
  const P: Vec3[] = [
    vec3(Math.fround(x + CORNER_X), y0, Math.fround(z + CORNER_Z)),
    vec3(Math.fround(x + CORNER_X), y0, Math.fround(z - CORNER_Z)),
    vec3(Math.fround(x - CORNER_X), y0, Math.fround(z - CORNER_Z)),
    vec3(Math.fround(x - CORNER_X), y0, Math.fround(z + CORNER_Z)),
  ];
  for (const p of P) p.y = Math.fround(WaterFieldSampleHeight(p) + FLOAT_RISE);
  const mean = Math.fround((P[0].y + P[1].y + P[2].y + P[3].y) * QUARTER);
  let best = 3;
  for (let i = 0; i < 3; i++) if (P[i].y > P[best].y) best = i;
  const a = P[(best - 2) & 3], b = P[(best + 1) & 3], c = P[(best - 1) & 3];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = Math.fround(c.x - a.x), vy = Math.fround(c.y - a.y);
  const vz = c.z - a.z;
  const n = vec3(Math.fround(vy * uz - vz * uy), Math.fround(vz * ux - vx * uz),
                 Math.fround(vx * uy - vy * ux));

  // -- turn toward the surface ----------------------------------------------
  MatrixLoadIdentity(_top);
  MatrixRotateY(_top, -obj.yaw);
  MatrixRotateZ(_top, -obj.roll);
  MatrixRotateX(_top, -obj.pitch);
  TransformToFloats(_top, n, _w);
  const tilt = FtolS16(Math.atan2(Math.sqrt(_w.z * _w.z + _w.x * _w.x), _w.y)
                       * RADIANS_TO_BAMS);
  if (tilt !== 0) {
    const k = tilt === 0x8000 ? vec3(1, 0, 0) : vec3(_w.z, 0, -_w.x);
    MatrixLoadIdentity(_top);
    MatrixRotateX(_top, obj.pitch);
    MatrixRotateZ(_top, obj.roll);
    MatrixRotateY(_top, obj.yaw);
    const step = tilt > TILT_STEP_MAX ? TILT_STEP_MAX
      : tilt < -TILT_STEP_MAX ? -TILT_STEP_MAX : tilt;
    MatrixRotateAxis(_top, k, step);
    const e = MatrixToEulerBams(TopAsRot3(_top));
    obj.pitch = e.pitch;
    obj.yaw = e.yaw;
    obj.roll = e.roll;
    obj.pos.x = x;
    obj.pos.y = mean;
    obj.pos.z = z;
  }

  // -- the boss's feet ------------------------------------------------------
  MatrixLoadIdentity(_top);
  if (t.tiltBams !== 0) MatrixRotateAxis(_top, t.tiltAxis, -t.tiltBams);
  let sum = 0;
  const zHi = P[0].z, zLo = P[1].z;
  for (const ct of G.g_class14_foot_contacts) {
    // `FCOMP 0.0; TEST AH, 0x40` -- C3 is up for equal and for unordered.
    if (ct.strength === 0 || Number.isNaN(ct.strength)) continue;
    if (!(zHi >= ct.z)) continue;
    if (zLo > ct.z) continue;
    const axis = vec3(Math.fround(ct.z - z), 0, Math.fround(x - ct.x));
    const dz = ct.z - z, dx = ct.x - x, dy = ct.y - mean;
    const d = Math.sqrt(dz * dz + dx * dx + dy * dy);
    MatrixRotateAxis(_top, axis, Math.trunc(d * ct.strength * CONTACT_TIP));
    sum = Math.fround(ct.strength * CONTACT_SINK + sum);
  }
  if (sum === 0) {
    if (t.pressed !== 0) {
      t.swingBams = t.tiltBams;
      t.swingSink = t.sink;
      t.swingPhase = 0;
    }
    t.pressed = 0;
  } else {
    t.pressed = 1;
    t.swingBams = 0;
    t.swingSink = 0;
  }
  if (t.pressed !== 0) {
    TransformToFloats(_top, _up, _w);
    const q = Math.trunc(
      FtolS16(Math.atan2(Math.sqrt(_w.z * _w.z + _w.x * _w.x), 1.0)
              * RADIANS_TO_BAMS) / 4);
    MatrixLoadIdentity(_top);
    if (t.tiltBams !== 0) {
      MatrixRotateAxis(_top, t.tiltAxis, t.tiltBams);
      if (q !== 0) {
        MatrixRotateAxis(_top, vec3(Math.fround(_w.z * PUSH_AXIS_SCALE), 0,
                                    Math.fround(_w.x * -PUSH_AXIS_SCALE)), q);
      }
      TransformToFloats(_top, _up, _w);
      const held = FtolS16(Math.atan2(Math.sqrt(_w.z * _w.z + _w.x * _w.x), 1.0)
                           * RADIANS_TO_BAMS);
      t.tiltAxis.y = 0;
      t.tiltBams = held;
      t.tiltAxis.x = _w.z;
      t.tiltAxis.z = -_w.x;
    } else {
      t.tiltBams = q;
      if (q !== 0) {
        t.tiltAxis.y = 0;
        t.tiltAxis.x = _w.z;
        t.tiltAxis.z = -_w.x;
      }
    }
    t.sink = Math.fround((sum - t.sink) * QUARTER + t.sink);
  } else {
    t.swingPhase = (t.swingPhase + SWING_STEP) | 0;
    const cs = Math.cos(t.swingPhase * BAMS_TO_RAD_F64);
    if (cs === 0) {
      t.swingBams = Math.trunc(((t.swingBams << 1) | 0) / 3);
      t.swingSink = Math.fround(t.swingSink * SWING_DECAY);
    }
    if (t.swingBams !== 0) t.tiltBams = Math.trunc(t.swingBams * cs);
    if (t.swingSink !== 0) t.sink = Math.fround(cs * t.swingSink);
  }

  // -- the draw -------------------------------------------------------------
  MatrixLoadIdentity(_top);
  MatrixTranslate(_top, x, Math.fround(mean - t.sink), z);
  MatrixRotateX(_top, obj.pitch);
  MatrixRotateZ(_top, obj.roll);
  MatrixRotateY(_top, obj.yaw);
  if (t.tiltBams !== 0) MatrixRotateAxis(_top, t.tiltAxis, t.tiltBams);
  DrawSlotInWorld(t.slot, _top);
  ColiStoreObjectMatrix(obj, _top);
  RegisterForShotTest(obj, f.host);
}

/**
 * `CALL dword ptr [obj+0x00]` for this class: the placer the first time, the
 * plank's update every frame after. `[port-only]` as a function -- the walk
 * makes the call in the engine.
 */
function FloatingPropRun(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.FloatingPropRow) return;
  if (obj.float15.routine === FloatingPropRoutine.Plank) {
    FloatingPropUpdate(obj, f);
  } else {
    FloatingPropRowSpawn(obj);
  }
}

function FloatingPropDebug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.FloatingPropRow) return { summary: "not 0x15" };
  const t = obj.float15;
  if (t.routine === FloatingPropRoutine.RowSpawn) {
    return { summary: `row of ${obj.class15?.count ?? 0}` };
  }
  return {
    summary: `plank ${t.rowIndex} · `
      + (t.delay < 0 ? "stays" : `leaves ${t.delay} after flag ${t.flag}`),
    detail: [
      `tilt ${t.tiltBams} · sink ${t.sink.toFixed(2)}`
        + (t.pressed ? " · pressed" : ""),
    ],
    hot: t.pressed !== 0,
  };
}

const handler: ClassHandler = {
  // The placer runs here, from the walk -- `SpawnFromDescriptorSmall`
  // installs it as `obj+0x00` -- and kills itself, so the walk's `update`
  // never reaches the spawn object. A plank's `init` is a return.
  init: FloatingPropRowSpawn,
  update: FloatingPropRun,
  // It calls `RegisterForShotTest` itself, and the pick is the mesh arm:
  // every plank carries `obj+0x34 & 0x10`, copied off its placer.
  registersForShotTest: true,
  // Nothing in the update reads the hit bit; a shot on a plank is a mark
  // and a world impact and nothing else.
  ownsShotResult: true,
  debug: FloatingPropDebug,
};

registerClass(SpawnClass.FloatingPropRow, handler);
