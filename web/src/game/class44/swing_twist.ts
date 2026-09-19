/**
 * `EffectPoseNode`'s third interpolation arm: two keys' rotations blended as
 * **matrices**, a swing of the Y axis followed by a twist about it.
 *
 * `EffectPoseNode` (`FUN_0040D9D0`) takes it for an effect whose
 * `g_effect_interp_mode` is 2, on an odd cursor past 1, when all three of the
 * two keys' angles differ by more than `0x3000`: it builds each key's
 * `Rz . Ry . Rx`, stores the pair, calls `MatrixInterpolateSwingTwist` with
 * `t = 0.5` and multiplies the result onto the node's translation. Effect 0x13
 * — class 0x41 type 44's breaking chair — is mode 2, and motion 468 reaches
 * the arm on twelve of its node-frames.
 *
 * Matrices here are 3x3 and column-major, the engine's layout with the
 * translation row dropped: `m[0..2]` is the image of X, `m[3..5]` of Y,
 * `m[6..8]` of Z. Every translation the routine touches is zero.
 */

/** A rotation, column-major: `[Xx, Xy, Xz, Yx, Yy, Yz, Zx, Zy, Zz]`. */
export type Mat3 = [number, number, number, number, number, number,
                    number, number, number];

import { BAMS_TO_RAD as BAMS_TO_RAD_F32, BAMS_TO_RAD_F64 } from "../../core/bams";

/**
 * `g_bams_to_rad` (`0x004C4370`), the double `MatrixRotateAxis` uses, and
 * `g_rad_to_bams` (`0x004C4378`), exactly its reciprocal, 32768/pi.
 */
const TO_RAD = BAMS_TO_RAD_F64;
const RAD_TO_BAMS = 1 / BAMS_TO_RAD_F64;
/** `MatrixRotateY` scales by the float `9.58738e-05`, the rounded one. */
const ROTY_TO_RAD = BAMS_TO_RAD_F32;

/** `A . B`, as `MatrixMultiply` (`FUN_004A92A0`) post-multiplies. */
function Mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1]
        + a[6 + r] * b[c * 3 + 2];
    }
  }
  return o;
}

/** `M . v`, `MatrixTransformPoint` (`FUN_004A8A80`) with a zero translation. */
function Apply(m: Mat3, x: number, y: number, z: number): [number, number,
                                                               number] {
  return [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z,
          m[2] * x + m[5] * y + m[8] * z];
}

/**
 * `MatrixInvert` (`FUN_004A8D20`) on a matrix whose translation is zero and
 * whose fourth row and column are the identity's: the 3x3 inverse by
 * cofactors, which is what the 4x4 routine reduces to there.
 */
function Invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
          B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
          C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/**
 * `MatrixRotateAxis` (`FUN_004A98D0`)'s matrix: the axis normalised, then
 * Rodrigues' rotation by *bams* about it.
 */
function RotAxis(axis: [number, number, number], bams: number): Mat3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  const [x, y, z] = [axis[0] / len, axis[1] / len, axis[2] / len];
  const c = Math.cos(bams * TO_RAD), s = Math.sin(bams * TO_RAD);
  const k = 1 - c;
  return [x * x * k + c, y * x * k + z * s, z * x * k - y * s,
          y * x * k - z * s, y * y * k + c, z * y * k + x * s,
          z * x * k + y * s, z * y * k - x * s, z * z * k + c];
}

/** `MatrixRotateY` (`FUN_004A9AE0`)'s matrix. */
function RotY(bams: number): Mat3 {
  const r = bams * ROTY_TO_RAD;
  const c = Math.cos(r), s = Math.sin(r);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

/**
 * `Rz(roll) . Ry(yaw) . Rx(pitch)`, the matrix a key's three angles build —
 * `MatrixLoadIdentity; MatrixRotateZ; MatrixRotateY; MatrixRotateX` in
 * `EffectPoseNode`. [port-only] as a function.
 */
export function MatrixFromZYX(pitch: number, yaw: number, roll: number): Mat3 {
  const x = pitch * TO_RAD, y = yaw * TO_RAD, z = roll * TO_RAD;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  const rz: Mat3 = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  const ry: Mat3 = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rx: Mat3 = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  return Mul(Mul(rz, ry), rx);
}

/**
 * The three BAMS angles `(pitch, yaw, roll)` with `Rz . Ry . Rx` equal to *m*.
 *
 * [port-only] The engine never decomposes: it multiplies the matrix onto the
 * stack. The port's node pose is three angles drawn in Z, Y, X order, and this
 * is the exact inverse of {@link MatrixFromZYX}, so the drawn rotation is the
 * engine's matrix.
 */
export function MatrixToZYX(m: Mat3): { pitch: number; yaw: number;
                                         roll: number } {
  // Row r, column c is m[c * 3 + r].
  const yaw = Math.atan2(-m[2], Math.hypot(m[0], m[1]));
  const pitch = Math.atan2(m[5], m[8]);
  const roll = Math.atan2(m[1], m[0]);
  return { pitch: pitch * RAD_TO_BAMS, yaw: yaw * RAD_TO_BAMS,
           roll: roll * RAD_TO_BAMS };
}

/** `(s16)__ftol(x)`. */
function S16Trunc(x: number): number {
  return (Math.trunc(x) << 16) >> 16;
}

/**
 * `MatrixInterpolateSwingTwist` — `FUN_00412750`. *a* turned *t* of the way
 * to *b*.
 *
 * ```c
 * R = A^-1 . B;                                   // MatrixSetTop3x4, MatrixInvert,
 * v = R . (0,1,0);                                //   MatrixMultiply
 * s = (s16)__ftol(atan2(sqrt(vx*vx + vz*vz), vy) * 32768/pi);
 * if (s == 0) {
 *     w = R . (1,0,0);
 *     top = A . RotY(__ftol((s16)__ftol(atan2(-wz, wx) * 32768/pi) * t));
 * } else {
 *     c = s == 0x8000 ? (1,0,0) : (vz, 0, -vx);   // Y cross v
 *     w = (Rot(c, -s) . R) . (1,0,0);             // the twist left over
 *     top = A . Rot(c, __ftol(s * t))
 *             . RotY(__ftol((s16)__ftol(atan2(-wz, wx) * 32768/pi) * t));
 * }
 * ```
 *
 * `R = Rot(c, s) . RotY(twist)`: the swing takes A's Y axis onto B's, and the
 * twist about Y is what is left. At `t = 1` the result is B.
 */
export function MatrixInterpolateSwingTwist(a: Mat3, b: Mat3,
                                            t: number): Mat3 {
  const r = Mul(Invert(a), b);
  const v = Apply(r, 0, 1, 0);
  const swing = S16Trunc(Math.atan2(Math.hypot(v[0], v[2]), v[1])
                         * RAD_TO_BAMS);
  if (swing === 0) {
    const w = Apply(r, 1, 0, 0);
    const twist = S16Trunc(Math.atan2(-w[2], w[0]) * RAD_TO_BAMS);
    return Mul(a, RotY(Math.trunc(twist * t)));
  }
  // `MOVSX EDI, AX; CMP EDI, 0x8000`: the swing is sign-extended first, so
  // this test can never be true -- a half-turn swing reads -0x8000 and takes
  // the `(vz, 0, -vx)` arm with a zero axis. Transcribed as written.
  const axis: [number, number, number] = swing === 0x8000
    ? [1, 0, 0] : [v[2], 0, -v[0]];
  const w = Apply(Mul(RotAxis(axis, -swing), r), 1, 0, 0);
  const twist = S16Trunc(Math.atan2(-w[2], w[0]) * RAD_TO_BAMS);
  return Mul(Mul(a, RotAxis(axis, Math.trunc(swing * t))),
             RotY(Math.trunc(twist * t)));
}
