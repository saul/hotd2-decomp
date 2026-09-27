/**
 * The engine's matrix stack, one matrix at a time.
 *
 * Every routine in `Hod2.exe` that places an object builds its transform on
 * `g_MatrixStackTop`, sixteen floats in Direct3D's **row-vector** layout: rows
 * 0..2 are the images of +X, +Y and +Z and row 3 is the translation, and every
 * call post-multiplies, so `MatrixTranslate; MatrixRotateY; MatrixRotateX`
 * applies the X turn first and the translation last. The port has no stack in
 * `game/` — the stack is a single global the engine pushes and pops around
 * each routine, and none of it outlives the routine that built it — so the
 * top is passed explicitly: each function here takes the matrix it would have
 * read off `g_MatrixStackTop` and writes it back in place.
 *
 * The layout is the one three.js keeps in `Matrix4.elements` (column-major
 * for a column vector is the same sixteen numbers as row-major for a row
 * vector), which is why a bone's `matrixWorld` can cross the seam as it is.
 *
 * Each body is transcribed from its decompilation with the element indices as
 * the engine writes them, and nothing is rearranged into a textbook form: a
 * sign convention recovered by reasoning is exactly what `L1` and `L2` are
 * about, and these are short enough to copy.
 */
import type { Vec3 } from "./vec";

/** Sixteen floats, `g_MatrixStackTop`'s own layout. */
export type Mat = number[];

/** `* 9.58738e-05` — the engine's BAMS-to-radians factor, `2pi / 65536`. */
const BAMS_TO_RADIANS = 9.58738e-05;
/** `FMUL double ptr [0x004C4378]` — radians to BAMS, `65536 / 2pi`. */
export const RADIANS_TO_BAMS = 10430.378350470453;

/** A fresh identity. `[port-only]` — the engine's stack is never empty. */
export function MatIdentity(): Mat {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Copy `src` over `dst`. `MatrixStackSetTopFromArray` (`FUN_004A9230`).
 * `[port-only]` as a function.
 */
export function MatCopy(dst: Mat, src: ArrayLike<number>): Mat {
  for (let i = 0; i < 16; i++) dst[i] = src[i];
  return dst;
}

/** `MatrixLoadIdentity` — `FUN_004A9E10`. */
export function MatrixLoadIdentity(m: Mat): void {
  for (let i = 0; i < 16; i++) m[i] = i % 5 === 0 ? 1 : 0;
}

/** `MatrixTranslate` — `FUN_004A9D80`. `row3 += x*row0 + y*row1 + z*row2`. */
export function MatrixTranslate(m: Mat, x: number, y: number, z: number): void {
  m[12] = x * m[0] + z * m[8] + y * m[4] + m[12];
  m[13] = z * m[9] + y * m[5] + x * m[1] + m[13];
  m[14] = z * m[10] + y * m[6] + x * m[2] + m[14];
  m[15] = z * m[11] + y * m[7] + x * m[3] + m[15];
}

/** `MatrixRotateX` — `FUN_004A99F0`. Rows 1 and 2. */
export function MatrixRotateX(m: Mat, bams: number): void {
  const c = Math.cos(bams * BAMS_TO_RADIANS);
  const s = Math.sin(bams * BAMS_TO_RADIANS);
  for (let k = 0; k < 4; k++) {
    const r1 = m[4 + k], r2 = m[8 + k];
    m[4 + k] = r1 * c + s * r2;
    m[8 + k] = c * r2 - r1 * s;
  }
}

/** `MatrixRotateY` — `FUN_004A9AE0`. Rows 0 and 2. */
export function MatrixRotateY(m: Mat, bams: number): void {
  const c = Math.cos(bams * BAMS_TO_RADIANS);
  const s = Math.sin(bams * BAMS_TO_RADIANS);
  for (let k = 0; k < 4; k++) {
    const r0 = m[k], r2 = m[8 + k];
    m[k] = r0 * c - s * r2;
    m[8 + k] = r0 * s + c * r2;
  }
}

/** `MatrixRotateZ` — `FUN_004A9BD0`. Rows 0 and 1. */
export function MatrixRotateZ(m: Mat, bams: number): void {
  const c = Math.cos(bams * BAMS_TO_RADIANS);
  const s = Math.sin(bams * BAMS_TO_RADIANS);
  for (let k = 0; k < 4; k++) {
    const r0 = m[k], r1 = m[4 + k];
    m[k] = r0 * c + s * r1;
    m[4 + k] = c * r1 - r0 * s;
  }
}

/**
 * `MatrixScale` — `FUN_004A9CC0`. Row 0 by `x`, row 1 by `y`, row 2 by `z`,
 * all four columns of each: the scale is applied before everything already
 * on the stack, as every other post-multiplying call here is.
 */
export function MatrixScale(m: Mat, x: number, y: number, z: number): void {
  for (let k = 0; k < 4; k++) {
    m[k] *= x;
    m[4 + k] *= y;
    m[8 + k] *= z;
  }
}

/**
 * `MatrixMultiply` — `FUN_004A92A0`. `top = p * top`: the argument is applied
 * **first**, which is what lets a bone matrix be multiplied onto the view.
 */
export function MatrixMultiply(m: Mat, p: ArrayLike<number>): void {
  const o = m.slice(0, 16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      m[r * 4 + c] = p[r * 4] * o[c] + p[r * 4 + 1] * o[4 + c]
        + p[r * 4 + 2] * o[8 + c] + p[r * 4 + 3] * o[12 + c];
    }
  }
}

/** `MatrixTransformPoint` — `FUN_004A8A80`. No perspective divide. */
export function MatrixTransformPoint(m: ArrayLike<number>, v: Vec3,
                                     out: Vec3): void {
  const x = v.x * m[0] + m[4] * v.y + m[8] * v.z + m[12];
  const y = m[5] * v.y + m[1] * v.x + m[9] * v.z + m[13];
  const z = m[6] * v.y + m[2] * v.x + m[10] * v.z + m[14];
  out.x = x; out.y = y; out.z = z;
}

/** `MatrixTransformVector` — `FUN_004A8AF0`. The same without row 3. */
export function MatrixTransformVector(m: ArrayLike<number>, v: Vec3,
                                      out: Vec3): void {
  const x = v.x * m[0] + m[4] * v.y + m[8] * v.z;
  const y = m[5] * v.y + m[1] * v.x + m[9] * v.z;
  const z = m[6] * v.y + m[2] * v.x + m[10] * v.z;
  out.x = x; out.y = y; out.z = z;
}

/** `MatrixGetTranslation` — `FUN_004A8CC0`. Row 3. */
export function MatrixGetTranslation(m: ArrayLike<number>, out: Vec3): void {
  out.x = m[12]; out.y = m[13]; out.z = m[14];
}

/**
 * `__ftol` (the CRT routine at `0x004ACF50`) and then the `MOVSX` every caller here applies:
 * truncate toward zero, keep the low sixteen bits, sign-extend.
 * `[port-only]` as a function.
 */
export function FtolS16(v: number): number {
  return (Math.trunc(v) << 16) >> 16;
}

/**
 * `VecAimXAxisYThenZ` — `FUN_00401720`. The BAMS pair that carries +X onto
 * `(dx, dy, dz)` as `MatrixRotateY(ry); MatrixRotateZ(rz)`.
 *
 * ```
 * 00401721  FLD [ESP+0x10]; FCHS; FLD [ESP+8]; FPATAN   ; atan2(-dz, dx)
 * 0040172d  FMUL double ptr [0x004C4378]                 ; * 65536/2pi
 * 0040174e  TEST AH, 0x40 after ADD EAX, 0x2000          ; cos or sin?
 * ```
 */
export function VecAimXAxisYThenZ(dx: number, dy: number, dz: number):
    { ry: number; rz: number } {
  const ry = FtolS16(Math.atan2(-dz, dx) * RADIANS_TO_BAMS);
  const a = ry * BAMS_TO_RADIANS;
  const h = ((ry + 0x2000) & 0x4000) === 0 ? dx / Math.cos(a)
    : -(dz / Math.sin(a));
  const rz = FtolS16(Math.atan2(dy, h) * RADIANS_TO_BAMS);
  return { ry, rz };
}

/**
 * `VecAimXAxisZThenY` — `FUN_00401790`. The same for the other order:
 * `MatrixRotateZ(rz); MatrixRotateY(ry)`, with `ry` negated on the way out.
 */
export function VecAimXAxisZThenY(x: number, y: number, z: number):
    { ry: number; rz: number } {
  const rz = FtolS16(Math.atan2(y, x) * RADIANS_TO_BAMS);
  const a = rz * BAMS_TO_RADIANS;
  const h = ((rz + 0x2000) & 0x4000) === 0 ? x / Math.cos(a) : y / Math.sin(a);
  const ry = -FtolS16(Math.atan2(z, h) * RADIANS_TO_BAMS);
  return { ry, rz };
}

/**
 * `MatrixToEulerZYX` — `FUN_004019E0`. The three angles that rebuild the
 * rotation of `m` as `MatrixRotateZ(rz); MatrixRotateY(ry); MatrixRotateX(rx)`.
 *
 * The image of +X gives `ry` and `rz`; the image of +Y is taken back through
 * `MatrixRotateY(-ry); MatrixRotateZ(-rz)` and `rx` is its angle about X.
 */
export function MatrixToEulerZYX(m: ArrayLike<number>):
    { rx: number; ry: number; rz: number } {
  const ax: Vec3 = { x: 0, y: 0, z: 0 };
  MatrixTransformVector(m, { x: 1, y: 0, z: 0 }, ax);
  const { ry, rz } = VecAimXAxisZThenY(ax.x, ax.y, ax.z);
  const ay: Vec3 = { x: 0, y: 0, z: 0 };
  MatrixTransformVector(m, { x: 0, y: 1, z: 0 }, ay);
  const u = MatIdentity();
  MatrixRotateY(u, -ry);
  MatrixRotateZ(u, -rz);
  const back: Vec3 = { x: 0, y: 0, z: 0 };
  MatrixTransformVector(u, ay, back);
  const rx = FtolS16(Math.atan2(back.z, back.y) * RADIANS_TO_BAMS);
  return { rx, ry, rz };
}

/**
 * `Vec3ScaleToUnitLength` — `FUN_004AA9C0`. In place; no zero test, so a zero
 * vector becomes NaNs, as the engine's does.
 */
export function Vec3ScaleToUnitLength(v: Vec3): void {
  const l = Math.sqrt(v.z * v.z + v.y * v.y + v.x * v.x);
  v.x /= l; v.y /= l; v.z /= l;
}

/**
 * `MatrixRotateAxis` — `FUN_004A98D0`. A turn of `bams` about `axis` (a
 * normalised copy), built in the scratch at `0x00598C18` and multiplied on
 * with `MatrixMultiply`, so it applies before whatever the top already holds.
 */
export function MatrixRotateAxis(m: Mat, axis: Vec3, bams: number): void {
  const c = Math.cos(bams * 9.587379924285257e-05);
  const s = Math.sin(bams * 9.587379924285257e-05);
  const a = { x: axis.x, y: axis.y, z: axis.z };
  Vec3ScaleToUnitLength(a);
  const t = 1 - c;
  const r = MatIdentity();
  r[0] = a.x * a.x * t + c;
  r[1] = a.z * s + a.y * a.x * t;
  r[2] = a.z * a.x * t - a.y * s;
  r[4] = a.y * a.x * t - a.z * s;
  r[5] = a.y * a.y * t + c;
  r[6] = a.x * s + a.z * a.y * t;
  r[8] = a.y * s + a.z * a.x * t;
  r[9] = a.z * a.y * t - a.x * s;
  r[10] = a.z * a.z * t + c;
  MatrixMultiply(m, r);
}

/**
 * `MatrixInvert` — `FUN_004A8D20`. The general 4x4 inverse by cofactors over
 * the determinant (`FUN_004A8B60`); a singular matrix becomes sixteen
 * `3.4e38`s. The port computes the same inverse by elimination, which agrees
 * to rounding.
 */
export function MatrixInvert(m: Mat): void {
  const a = m.slice(0, 16);
  const inv = MatIdentity();
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) {
      if (Math.abs(a[r * 4 + c]) > Math.abs(a[piv * 4 + c])) piv = r;
    }
    if (a[piv * 4 + c] === 0) {
      for (let i = 0; i < 16; i++) m[i] = 3.4e38;
      return;
    }
    if (piv !== c) {
      for (let k = 0; k < 4; k++) {
        [a[c * 4 + k], a[piv * 4 + k]] = [a[piv * 4 + k], a[c * 4 + k]];
        [inv[c * 4 + k], inv[piv * 4 + k]] = [inv[piv * 4 + k], inv[c * 4 + k]];
      }
    }
    const d = a[c * 4 + c];
    for (let k = 0; k < 4; k++) { a[c * 4 + k] /= d; inv[c * 4 + k] /= d; }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r * 4 + c];
      if (f === 0) continue;
      for (let k = 0; k < 4; k++) {
        a[r * 4 + k] -= f * a[c * 4 + k];
        inv[r * 4 + k] -= f * inv[c * 4 + k];
      }
    }
  }
  for (let i = 0; i < 16; i++) m[i] = inv[i];
}

/**
 * `VecAngleBetween` — `FUN_00401D70`. The angle between two vectors in BAMS,
 * `(s16)trunc(atan2(sqrt(|a|^2 |b|^2 - dot^2), dot) * 65536/2pi)`
 * (`0x00401DCE FXCH; FPATAN; FMUL [0x004C4378]`).
 */
export function VecAngleBetween(ax: number, ay: number, az: number,
                                bx: number, by: number, bz: number): number {
  const dot = az * bz + ay * by + ax * bx;
  const s = Math.sqrt((bz * bz + by * by + bx * bx)
                      * (az * az + ay * ay + ax * ax) - dot * dot);
  return FtolS16(Math.atan2(s, dot) * RADIANS_TO_BAMS);
}
