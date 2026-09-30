/**
 * Class 0x41 constructor 55 — eight hundred pieces of `eff_4.bin` that wait
 * for a script flag, then fly up, fall, bounce on a floor and are gone.
 *
 * One spawn in the game: stage 6 block 12 step 1 op 26 (evt `0x4780`), both
 * modes, at `(752.8, 2781.0, -9872.0)`. The same step raises
 * `g_script_flags[0x31]` at op 161, and that is what starts it. The pieces
 * are `eff_4.bin[0..47]`; `[open]` what they depict.
 *
 * ## The constructor `[proved]`
 *
 * `PlaceType55Particles` (`FUN_00463FE0`), `g_class41_constructors[55]`, read
 * in the disassembly (`0x00463FE0`..`0x004641E5`):
 *
 * ```c
 * obj = ActorAlloc(PropUpdateType55Particles, 0x8500); ActorClearGameFields(obj);
 * obj->+0x194..0x19C = placer->+0x40..0x48;
 * for (i = 0; i < 800; i++) {                               // CMP EAX, 0x320
 *     j = i;
 *     if (i >= 0x30) {                                      // CMP ESI, 0x30; JL
 *         j = rand() % 0x30;
 *         scale[i] = rand() % 0x29 * 0.01f + 0.1f;          // 0x004D5464, 0x004C4CC8
 *     }
 *     row = g_type55_particle_offsets[j];                   // 0x00594F2A, s16 x3
 *     x[i] = row.x * 0.001f + obj->+0x194;                  // 0x0055D2B0
 *     y[i] = row.y * 0.001f + obj->+0x198 + 10.5f;          // 0x0056901C
 *     z[i] = row.z * 0.001f + obj->+0x19C;
 *     vx[i] = rand() % 0x65 * 0.001f * row.x * 0.001f;
 *     vz[i] = rand() % 0x65 * 0.001f * row.z * 0.001f;
 *     vy[i] = rand() % 0x12D * 0.01f + 1.0f;                // 0x004C4380
 *     wx[i] = rand() % 0x601 - 0x300;  wy[i] = ...;  wz[i] = ...;
 * }
 * ```
 *
 * The draws are in that order: `j`, the scale, `vx`, `vz`, `vy` and the three
 * spin rates. **The first 48 pieces are never given a scale**: the `JL` steps
 * over the only store to it, so they keep `ActorClearGameFields`' zero and
 * are drawn collapsed to a point -- 752 of the 800 are ever seen. The angles
 * are never written either and start at zero.
 *
 * ## The update `[proved]`
 *
 * `PropUpdateType55Particles` (`FUN_0046EEB0`), not a Ghidra function until
 * named here:
 *
 * ```c
 * if (g_script_flags[0x31] == 0) return;                    // nothing at all
 * if (obj->+0x1A0++ > 0x8C) { ActorKill(); return; }
 * for (i = 0; i < 800; i++) {
 *     vy[i] -= 0.05444f;                                    // 0x00569098
 *     x[i] += vx[i];  y[i] += vy[i];  z[i] += vz[i];
 *     rx[i] += wx[i]; ry[i] += wy[i]; rz[i] += wz[i];       // s16
 *     if (y[i] < 2782.09f) {                                // 0x00569114
 *         vy[i] = -((rand() % 0x15 * 0.01f + 0.3f) * vy[i]);  // 0x004C4D10
 *         wx[i] = rand() % 0x601 - 0x300; wy[i] = ...; wz[i] = ...;
 *     }
 *     if (obj->+0x1A0 < 0x6F || g_scene_tick_counter == 0) {
 *         Push(0); Translate(x, y, z); RotZ(rz); RotY(ry); RotX(rx);
 *         Scale(s, s, s); NoOpStub(s);
 *         AssetDrawSlotWithAlpha(i % 0x30 + 0x19D, 0.5f);
 *         Pop(1);
 *     }
 * }
 * ```
 *
 * So the pieces move for 141 frames and are drawn for the first 110 of them;
 * the last 31 run the physics unseen (the scene counter is zero only on a
 * scene's first tick). The floor is a literal. Nothing registers for the shot
 * test and nothing touches a counter.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import type { Vec3 } from "../vec";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawSlotWithAlpha, PropMatrixPush }
  from "./prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
  type ScatterParticle,
} from "./prop_state";
import { PropWords } from "./words";
import { TYPE55_ROWS, TYPE55_SLOT, TYPE55_SLOT_SPAN } from "./ctor_literals";

/** `CMP EAX, 0x320` at `0x004641D3` — the pieces the task carries. */
export const TYPE55_PARTICLES = 800;
/** `MOV ECX, 0x29` at `0x0046405C` — the scale's spread. */
const TYPE55_SCALE_SPREAD = 0x29;
/** `FMUL [0x004D5464]` (0.01) and `FADD [0x004C4CC8]` (0.1). */
const TYPE55_SCALE_STEP = Math.fround(0.01);
const TYPE55_SCALE_BASE = Math.fround(0.1);
/** `FMUL [0x0055D2B0]` — the table's s16s are thousandths. */
const TYPE55_TABLE_UNIT = Math.fround(0.001);
/** `FADD [0x0056901C]` — every piece starts this far above the placer. */
export const TYPE55_RISE = 10.5;
/** `MOV ECX, 0x65` at `0x004640E7` — the outward speed's spread. */
const TYPE55_SPEED_SPREAD = 0x65;
/** `MOV ECX, 0x12D` at `0x00464153`, `FMUL [0x004D5464]`, `FADD [0x004C4380]`. */
const TYPE55_LIFT_SPREAD = 0x12d;
const TYPE55_LIFT_STEP = Math.fround(0.01);
const TYPE55_LIFT_BASE = 1.0;
/** `MOV ECX, 0x601; IDIV; SUB EDX, 0x300` — a spin rate, both ways. */
export const TYPE55_SPIN_SPREAD = 0x601;
export const TYPE55_SPIN_HALF = 0x300;

/** `MOV AL, [0x009C7231]` at `0x0046EEB0` — `g_script_flags[0x31]`. */
export const TYPE55_START_FLAG = 0x31;
/** `CMP EAX, 0x8C` at `0x0046EECA` — the task's last frame, pre-increment. */
export const TYPE55_LAST_FRAME = 0x8c;
/** `CMP dword ptr [ECX + 0x1A0], 0x6E; JLE` at `0x0046EFD3` — drawn to here. */
export const TYPE55_DRAWN_FRAMES = 0x6e;
/** `FSUB [0x00569098]` (`0x3D5EFC7A`) — gravity, a frame. */
export const TYPE55_GRAVITY = Math.fround(0.05444);
/** `FCOMP [0x00569114]` (`0x452DE171`) — the floor the pieces bounce on. */
export const TYPE55_FLOOR_Y = Math.fround(2782.09);
/** `MOV ECX, 0x15`, `FMUL [0x004D5464]`, `FADD [0x004C4D10]` — the bounce. */
const TYPE55_BOUNCE_SPREAD = 0x15;
const TYPE55_BOUNCE_STEP = Math.fround(0.01);
const TYPE55_BOUNCE_BASE = Math.fround(0.3);
/** `PUSH 0x3F000000` into `AssetDrawSlotWithAlpha`. */
export const TYPE55_ALPHA = 0.5;

/** The task's words beyond its pieces. */
export interface Type55Words {
  /** `obj+0x1A0` — frames the task has run since the flag, pre-increment. */
  o1A0: number;
  /** `obj+0x194..0x19C` — the placer's position, which the pieces start round. */
  o194: number;
  o198: number;
  o19C: number;
}
const TYPE55_WORDS: Type55Words = { o1A0: 0, o194: 0, o198: 0, o19C: 0 };

/** `(s16)` — the angle words are 16-bit and wrap there (`ADD word ptr`). */
function S16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `PlaceType55Particles` — `FUN_00463FE0`. `g_class41_constructors[55]`.
 *
 * `pos` is the placer's `+0x40..+0x48`; `offsets` is
 * `g_type55_particle_offsets` (`0x00594F2A`) as the bundle carries it, forty-
 * eight `[x, y, z]` rows of s16.
 */
export function PlaceType55Particles(at: number, pos: Vec3,
                                     offsets: readonly (readonly number[])[],
                                     rng: Rng): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Type55;
  p.at = at;
  p.state = BreakableState.Standing;
  p.flags = 0;
  p.removeFlag = 0;
  const w = PropWords(p, TYPE55_WORDS);
  w.o194 = pos.x;
  w.o198 = pos.y;
  w.o19C = pos.z;
  for (let i = 0; i < TYPE55_PARTICLES; i++) {
    let j = i;
    let s = 0;
    if (i >= TYPE55_ROWS) {
      j = rng.int(TYPE55_ROWS);
      s = Math.fround(rng.int(TYPE55_SCALE_SPREAD) * TYPE55_SCALE_STEP
                      + TYPE55_SCALE_BASE);
    }
    const row = offsets[j] ?? [0, 0, 0];
    const rx = row[0] ?? 0, ry = row[1] ?? 0, rz = row[2] ?? 0;
    const q: ScatterParticle = {
      x: Math.fround(rx * TYPE55_TABLE_UNIT + w.o194),
      y: Math.fround(ry * TYPE55_TABLE_UNIT + w.o198 + TYPE55_RISE),
      z: Math.fround(rz * TYPE55_TABLE_UNIT + w.o19C),
      vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0,
      wx: 0, wy: 0, wz: 0,
      s,
    };
    q.vx = Math.fround(rng.int(TYPE55_SPEED_SPREAD) * TYPE55_TABLE_UNIT * rx
                       * TYPE55_TABLE_UNIT);
    q.vz = Math.fround(rng.int(TYPE55_SPEED_SPREAD) * TYPE55_TABLE_UNIT * rz
                       * TYPE55_TABLE_UNIT);
    q.vy = Math.fround(rng.int(TYPE55_LIFT_SPREAD) * TYPE55_LIFT_STEP
                       + TYPE55_LIFT_BASE);
    q.wx = rng.int(TYPE55_SPIN_SPREAD) - TYPE55_SPIN_HALF;
    q.wy = rng.int(TYPE55_SPIN_SPREAD) - TYPE55_SPIN_HALF;
    q.wz = rng.int(TYPE55_SPIN_SPREAD) - TYPE55_SPIN_HALF;
    p.particles.push(q);
  }
  return p;
}

/** `PropUpdateType55Particles` — `FUN_0046EEB0`. */
export function PropUpdateType55Particles(p: BreakableProp, rng: Rng): void {
  PropDrawBegin(p);
  if ((G.g_script_flags[TYPE55_START_FLAG] ?? 0) === 0) return;
  const w = PropWords(p, TYPE55_WORDS);
  const t = w.o1A0;
  w.o1A0 = t + 1;
  if (t > TYPE55_LAST_FRAME) {
    ActorKillProp(p);
    return;
  }
  for (let i = 0; i < p.particles.length; i++) {
    const q = p.particles[i];
    q.vy = Math.fround(q.vy - TYPE55_GRAVITY);
    q.x = Math.fround(q.vx + q.x);
    q.y = Math.fround(q.vy + q.y);
    q.z = Math.fround(q.z + q.vz);
    q.rx = S16(q.rx + q.wx);
    q.ry = S16(q.ry + q.wy);
    q.rz = S16(q.rz + q.wz);
    if (q.y < TYPE55_FLOOR_Y) {
      q.vy = Math.fround(-((rng.int(TYPE55_BOUNCE_SPREAD) * TYPE55_BOUNCE_STEP
                            + TYPE55_BOUNCE_BASE) * q.vy));
      q.wx = rng.int(TYPE55_SPIN_SPREAD) - TYPE55_SPIN_HALF;
      q.wy = rng.int(TYPE55_SPIN_SPREAD) - TYPE55_SPIN_HALF;
      q.wz = rng.int(TYPE55_SPIN_SPREAD) - TYPE55_SPIN_HALF;
    }
    if (w.o1A0 <= TYPE55_DRAWN_FRAMES || G.g_scene_tick_counter === 0) {
      const m = PropMatrixPush();
      MatrixTranslate(m, q.x, q.y, q.z);
      MatrixRotateZ(m, q.rz);
      MatrixRotateY(m, q.ry);
      MatrixRotateX(m, q.rx);
      MatrixScale(m, q.s, q.s, q.s);
      PropDrawSlotWithAlpha(p, m, i % TYPE55_SLOT_SPAN + TYPE55_SLOT,
                            TYPE55_ALPHA);
    }
  }
}
