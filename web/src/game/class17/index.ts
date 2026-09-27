/**
 * Class 0x17 -- **one wave source on the class-0x16 field**, and the two
 * kinds of wave it can be.
 *
 * `WaterWaveSourceAdd` (`FUN_004422D0`) is the class's whole handler: it takes
 * the field's first free slot, allocates a 0x68-byte task of the kind the
 * spawn's `obj+0x11C` names out of `g_wave_source_kinds` (`0x005644E4`), seeds
 * it from the spawn and `ActorKill`s itself. The task is what lasts: every
 * frame it advances the wave's phase, and `WaterFieldSampleHeight`
 * (`FUN_00442390`, `game/class16/`) calls its eval to add the wave to the
 * field's plane at a point.
 *
 * Stage 2's blocks 35 and 39 place two, both kind 0 (travelling), and the
 * stage-2 boss's summons are the only thing that samples them: class 0x14
 * seats every fish it calls one unit (round A) or ten (round B) below the
 * surface they make.
 *
 * All of it is `[proved]` from the instruction stream -- the evals' `__ftol`
 * operands are read from the x87 code, not the pseudocode (L1).
 */
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { CountFlag, type Actor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { registerClass, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";
import type { Vec3 } from "../vec";
import {
  WAVE_FIELD_SLOTS, WaveSourceKind, type WaveSource,
} from "../class16/state";

/** `FCOMP [0x004C43AC]` -- the travelling wave's axis test, 0.5. */
const TRAVEL_AXIS_COS = 0.5;
/** `FMUL [0x004E1FDC]` -- 65536.0, a wavelength's worth of BAMS. */
const WAVE_BAMS = 65536;
/** `FMUL [0x004D5464]` -- the circular wave's falloff, 0.01 as a float. */
const CIRCLE_FALLOFF = Math.fround(0.01);

/** `(int)__ftol(x)` -- truncation toward zero, the whole dword kept. */
function Ftol(x: number): number {
  return Math.trunc(x) | 0;
}

/**
 * `WaterWaveSourceAdd` — `FUN_004422D0`. Class 0x17's handler.
 *
 * ```c
 * for (i = 0; i < 8; i++) if (!(field[1] & (1 << i))) {
 *     src = ActorAlloc(g_wave_source_kinds[obj+0x11C].fn, .size);
 *     field[3 + i] = src;
 *     src+0x3C..+0x44 = obj+0x40..+0x48;  src+0x48..+0x50 = obj+0x64..+0x6C;
 *     src+0x38 = 0;  src+0x54 = i;  field[1] |= 1 << i;
 *     src+0x58 = obj+0x130C;          // the descriptor tail
 *     ActorKill();  return;
 * }
 * ```
 *
 * **A full field leaves the spawn alive**: the loop falls out without the
 * `ActorKill`, so the object is still on the ring and tries again next frame.
 * That is why this is the class's update as well as its init.
 */
export function WaterWaveSourceAdd(obj: Actor): void {
  const field = G.g_water_wave_field;
  // [port-only] The engine reads `g_water_wave_field` blind. Every shipped
  // class-0x17 spawn is two instructions after its block's class-0x16 one, so
  // the pointer is always this block's field; a port with none has nothing to
  // add to and leaves the spawn to try again, which is the full-field arm.
  if (!field) return;
  const t = obj.class17;
  if (!t) return;
  for (let i = 0; i < WAVE_FIELD_SLOTS; i++) {
    if (field.mask & (1 << i)) continue;
    const kind = t.kind === WaveSourceKind.Circular
      ? WaveSourceKind.Circular : WaveSourceKind.Travelling;
    field.sources[i] = {
      kind, evalKind: null, ticked: 0,
      x: Math.fround(obj.pos.x), y: Math.fround(obj.pos.y),
      z: Math.fround(obj.pos.z),
      pitch: obj.pitch, yaw: obj.yaw, roll: obj.roll,
      slot: i,
      tail: [t.amplitude, t.wavelength, t.speed],
      amplitude: 0, wavelength: 0, speed: 0,
    };
    field.mask |= 1 << i;
    // `ActorKill` -- the spawn never joined either enemy count.
    obj.flags38 |= CountFlag.LeftAlive | CountFlag.LeftPresent;
    ActorDespawn(obj);
    return;
  }
}

/**
 * The first tick both kinds share, `+0x38 == 0`: take the eval, copy the tail
 * and join the field's count. `[port-only]` as a function -- the engine has
 * the block twice, once in each tick, and they differ only in the eval.
 */
function WaveSourceFirstTick(src: WaveSource, kind: WaveSourceKind): void {
  src.evalKind = kind;
  src.amplitude = src.tail[0];
  src.wavelength = src.tail[1];
  src.speed = src.tail[2];
  // `INC dword ptr [g_water_wave_field]` -- whatever field is current.
  if (G.g_water_wave_field) G.g_water_wave_field.count += 1;
  src.ticked += 1;
}

/**
 * `WaveSourceTravellingTick` — `FUN_004420C0`. `+0x3C += speed`, every frame
 * including the first; nothing at all once `+0x38` is past 1, which it never
 * is.
 */
export function WaveSourceTravellingTick(src: WaveSource): void {
  if (src.ticked === 0) WaveSourceFirstTick(src, WaveSourceKind.Travelling);
  else if (src.ticked !== 1) return;
  src.x = Math.fround(src.speed + src.x);
}

/**
 * `WaveSourceCircularTick` — `FUN_004421B0`. The centre drifts along its own
 * yaw: `+0x3C += sin(yaw) * speed; +0x44 += cos(yaw) * speed`.
 */
export function WaveSourceCircularTick(src: WaveSource): void {
  if (src.ticked === 0) WaveSourceFirstTick(src, WaveSourceKind.Circular);
  else if (src.ticked !== 1) return;
  const a = src.yaw * BAMS_TO_RAD_F64;
  src.x = Math.fround(Math.sin(a) * src.speed + src.x);
  src.z = Math.fround(Math.cos(a) * src.speed + src.z);
}

/**
 * `WaveEvalTravelling` — `FUN_00442110`. A plane wave along whichever world
 * axis the source's yaw is nearer:
 *
 * ```
 * 00442115  FILD [src+0x4C]; FMUL [0x004C4370]; FLD ST0; FCOS
 * 00442128  FST float [ESP+8]                       ; c, as a float
 * 00442133  (c < 0) FMUL -1.0; FCOMP 0.5            ; |c| against 0.5
 * |c| >  0.5:  FLD c; FMUL p.z; FADD src+0x3C       ; u = c*z + phase
 * |c| <= 0.5:  FSIN;  FMUL p.x; FADD src+0x3C       ; u = sin(a)*x + phase
 * 00442156  FMUL 65536.0; FDIV src+0x60; CALL __ftol
 *           FILD; FMUL [0x004C4370]; FCOS; FMUL src+0x5C
 * ```
 *
 * The cosine is multiplied **as the float the routine stored**, and the sine
 * straight off the stack; the port keeps both.
 */
export function WaveEvalTravelling(src: WaveSource, p: Vec3): number {
  const a = src.yaw * BAMS_TO_RAD_F64;
  const c = Math.cos(a);
  const cf = Math.fround(c);
  const u = Math.abs(c) > TRAVEL_AXIS_COS
    ? cf * Math.fround(p.z) + src.x
    : Math.sin(a) * Math.fround(p.x) + src.x;
  const n = Ftol(u * WAVE_BAMS / src.wavelength);
  return Math.cos(n * BAMS_TO_RAD_F64) * src.amplitude;
}

/**
 * `WaveEvalCircular` — `FUN_00442210`. Rings about the source's centre that
 * fade out over a hundred units:
 *
 * ```
 * r = sqrt((p.x - src.x)^2 + (p.z - src.z)^2)      ; FST float -> rf
 * f = 1.0 - r * 0.01;  if (f < 0.0) f = 0.0
 * h = cos(ftol(rf * 65536.0 / wavelength) BAMS) * amplitude * f
 * ```
 */
export function WaveEvalCircular(src: WaveSource, p: Vec3): number {
  const dz = Math.fround(p.z) - src.z;
  const dx = Math.fround(p.x) - src.x;
  const r = Math.sqrt(dx * dx + dz * dz);
  const rf = Math.fround(r);
  let f = 1 - r * CIRCLE_FALLOFF;
  if (f < 0) f = 0;
  const n = Ftol(rf * WAVE_BAMS / src.wavelength);
  return Math.cos(n * BAMS_TO_RAD_F64) * src.amplitude * f;
}

/**
 * `[port-only]` -- the wave-source tasks, stepped in slot order.
 *
 * The engine's tasks run where `ActorAlloc` appended them. Every shipped
 * source is allocated by its block's first step, before the boss that samples
 * the field exists, so each runs ahead of the boss in the same frame; the
 * director steps them ahead of the actor walk for that reason. Nothing else
 * reads the field. Slot order is allocation order: a slot is never freed.
 */
export function WaterWaveSourcesTick(): void {
  const field = G.g_water_wave_field;
  if (!field) return;
  for (const src of field.sources) {
    if (!src) continue;
    if (src.kind === WaveSourceKind.Circular) WaveSourceCircularTick(src);
    else WaveSourceTravellingTick(src);
  }
}

const handler: ClassHandler = {
  init: WaterWaveSourceAdd,
  update: WaterWaveSourceAdd,
  debug: (obj) => ({
    summary: `wave source · kind ${obj.class17?.kind ?? "?"}`,
  }),
};

registerClass(SpawnClass.WaterWaveSource, handler);
