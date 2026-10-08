/**
 * Class 0x41 constructor 65 — three hundred `garasu.bin` pieces falling from
 * one point for three hundred frames.
 *
 * One spawn in the game: stage 5 block 7 step 2 (evt `0x3D5C`), both modes,
 * at `(580.0, 2200.0, -9149.0)` -- and the pieces start round that same
 * point, though **not because the placer is there**: the constructor copies
 * the placer's position into its task and never reads it again; the point
 * the pieces start from is three literals that happen to equal it.
 * `garasu.bin[0..71]` is the file `PropUpdateType40`'s forty burst pieces
 * come from; `[likely]` glass, from the file's name.
 *
 * ## The constructor `[proved]`
 *
 * `PlaceType65Particles` at `0x00464360`, `g_class41_constructors[65]`, read
 * in the disassembly (`0x00464360`..`0x004644F3`):
 *
 * ```c
 * obj = ActorAlloc(PropUpdateType65Particles, 0x8500); ActorClearGameFields(obj);
 * obj->+0x194..0x19C = placer->+0x40..0x48;                   // never read
 * for (n = 300; n; n--) {
 *     x = rand() % 11 + 580.0f - 5.0f;                          // 0x00569030, 0x0055D2B4
 *     y = rand() % 11 + 2200.0f - 5.0f;                         // 0x0056902C
 *     z = rand() % 11 - 9149.0f - 5.0f;                         // 0x00569028
 *     vx = rand() % 0x51 * 0.01f - 0.4f;                        // 0x004D5464, 0x0055D1A0
 *     vy = rand() % 0x65 * 0.01f - 1.5;                         // a double, 0x0055D7D0
 *     vz = rand() % 0x65 * 0.01f + 0.5f;                        // 0x004C43AC
 *     wx = rand() % 0x601 - 0x300;  wy = ...;  wz = ...;
 *     s = 1.5f;                                                 // MOV [EBX-4], 0x3FC00000
 * }
 * ```
 *
 * ## The update `[proved]`
 *
 * `PropUpdateType65Particles` at `0x0046FCC0`:
 *
 * ```c
 * if (obj->+0x1A0++ > 300) { ActorKill(); return; }
 * for (i = 0; i < 300; i++) {
 *     vy[i] -= 0.10888f;                                        // 0x00569134
 *     x[i] += vx[i];  y[i] += vy[i];  z[i] += vz[i];
 *     rx[i] += wx[i]; ry[i] += wy[i]; rz[i] += wz[i];           // s16
 *     Push(0); Translate(x, y, z); RotZ(rz); RotY(ry); RotX(rx);
 *     Scale(s, s, s * 0.8f); NoOpStub(s);                       // 0x004C43A8
 *     AssetDrawSlot(i % 0x48 + 0xCA5);
 *     Pop(1);
 * }
 * ```
 *
 * No floor, no flag, no shot test, no counter: 301 frames of falling from the
 * frame it is placed, and gone.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import type { Vec3 } from "../vec";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
  type ScatterParticle,
} from "./prop_state";
import { PropWords } from "./words";
import { TYPE65_SLOT, TYPE65_SLOT_SPAN } from "./ctor_literals";

/** `MOV EBP, 0x12C` at `0x00464391` and `CMP EBX, 0x12C` at `0x0046FDE0`. */
export const TYPE65_PARTICLES = 300;
/** `MOV ECX, 0xB` — each coordinate's spread. */
export const TYPE65_SPREAD = 0xb;
/** `FADD [0x00569030]`, `FADD [0x0056902C]`, `FSUB [0x00569028]`. */
export const TYPE65_ORIGIN_X = 580.0;
export const TYPE65_ORIGIN_Y = 2200.0;
export const TYPE65_ORIGIN_Z = -9149.0;
/** `FSUB [0x0055D2B4]` — taken off all three, which centres the spread. */
export const TYPE65_HALF = 5.0;
/** `MOV ECX, 0x51`, `FMUL [0x004D5464]`, `FSUB [0x0055D1A0]` — `vx`. */
export const TYPE65_VX_SPREAD = 0x51;
export const TYPE65_STEP = Math.fround(0.01);
export const TYPE65_VX_BASE = Math.fround(0.4);
/** `MOV ECX, 0x65` and `FSUB double [0x0055D7D0]` — `vy`, a double 1.5. */
export const TYPE65_VY_SPREAD = 0x65;
export const TYPE65_VY_BASE = 1.5;
/** `MOV ECX, 0x65` and `FADD [0x004C43AC]` — `vz`. */
export const TYPE65_VZ_SPREAD = 0x65;
export const TYPE65_VZ_BASE = 0.5;
/** `MOV ECX, 0x601; IDIV; SUB EDX, 0x300` — a spin rate, both ways. */
export const TYPE65_SPIN_SPREAD = 0x601;
export const TYPE65_SPIN_HALF = 0x300;
/** `MOV dword ptr [EBX - 4], 0x3FC00000` at `0x004644E2`. */
export const TYPE65_SCALE = 1.5;
/** `CMP EAX, 0x12C` at `0x0046FCCB` — the task's last frame, pre-increment. */
export const TYPE65_LAST_FRAME = 300;
/** `FSUB [0x00569134]` (`0x3DDEFC7A`) — gravity, a frame. */
export const TYPE65_GRAVITY = Math.fround(0.10888);
/** `FMUL [0x004C43A8]` — the z scale is four fifths of the others. */
export const TYPE65_Z_SCALE = Math.fround(0.8);

/** The task's words beyond its pieces. */
export interface Type65Words {
  /** `obj+0x1A0` — frames the task has run, pre-increment. */
  o1A0: number;
  /** `obj+0x194..0x19C` — the placer's position, copied and never read. */
  o194: number;
  o198: number;
  o19C: number;
}
const TYPE65_WORDS: Type65Words = { o1A0: 0, o194: 0, o198: 0, o19C: 0 };

/** `(s16)` — the angle words are 16-bit and wrap there (`ADD word ptr`). */
function S16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `PlaceType65Particles` — `FUN_00464360`. `g_class41_constructors[65]`.
 * `pos` is the placer's `+0x40..+0x48`, kept and not used.
 */
export function PlaceType65Particles(at: number, pos: Vec3,
                                     rng: Rng): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Type65;
  p.at = at;
  p.state = BreakableState.Standing;
  p.flags = 0;
  p.removeFlag = 0;
  const w = PropWords(p, TYPE65_WORDS);
  w.o194 = pos.x;
  w.o198 = pos.y;
  w.o19C = pos.z;
  for (let n = 0; n < TYPE65_PARTICLES; n++) {
    const q: ScatterParticle = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, s: TYPE65_SCALE,
    };
    q.x = Math.fround(rng.int(TYPE65_SPREAD) + TYPE65_ORIGIN_X - TYPE65_HALF);
    q.y = Math.fround(rng.int(TYPE65_SPREAD) + TYPE65_ORIGIN_Y - TYPE65_HALF);
    // `FILD; FSUB [9149.0]; FSUB [5.0]`.
    q.z = Math.fround(rng.int(TYPE65_SPREAD) + TYPE65_ORIGIN_Z - TYPE65_HALF);
    q.vx = Math.fround(rng.int(TYPE65_VX_SPREAD) * TYPE65_STEP
                       - TYPE65_VX_BASE);
    q.vy = Math.fround(rng.int(TYPE65_VY_SPREAD) * TYPE65_STEP
                       - TYPE65_VY_BASE);
    q.vz = Math.fround(rng.int(TYPE65_VZ_SPREAD) * TYPE65_STEP
                       + TYPE65_VZ_BASE);
    q.wx = rng.int(TYPE65_SPIN_SPREAD) - TYPE65_SPIN_HALF;
    q.wy = rng.int(TYPE65_SPIN_SPREAD) - TYPE65_SPIN_HALF;
    q.wz = rng.int(TYPE65_SPIN_SPREAD) - TYPE65_SPIN_HALF;
    p.particles.push(q);
  }
  return p;
}

/** `PropUpdateType65Particles` — `FUN_0046FCC0`. */
export function PropUpdateType65Particles(p: BreakableProp): void {
  PropDrawBegin(p);
  const w = PropWords(p, TYPE65_WORDS);
  const t = w.o1A0;
  w.o1A0 = t + 1;
  if (t > TYPE65_LAST_FRAME) {
    ActorKillProp(p);
    return;
  }
  for (let i = 0; i < p.particles.length; i++) {
    const q = p.particles[i];
    q.vy = Math.fround(q.vy - TYPE65_GRAVITY);
    q.x = Math.fround(q.vx + q.x);
    q.y = Math.fround(q.vy + q.y);
    q.z = Math.fround(q.vz + q.z);
    q.rx = S16(q.rx + q.wx);
    q.ry = S16(q.ry + q.wy);
    q.rz = S16(q.rz + q.wz);
    const m = PropMatrixPush();
    MatrixTranslate(m, q.x, q.y, q.z);
    MatrixRotateZ(m, q.rz);
    MatrixRotateY(m, q.ry);
    MatrixRotateX(m, q.rx);
    MatrixScale(m, q.s, q.s, Math.fround(q.s * TYPE65_Z_SCALE));
    PropDrawSlot(p, m, i % TYPE65_SLOT_SPAN + TYPE65_SLOT);
  }
}
