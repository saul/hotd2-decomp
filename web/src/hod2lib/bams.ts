/**
 * Binary angles, and the rotation matrices they build.
 *
 * The port of `tools/hod2lib/bams.py`. The engine keeps every orientation as a
 * BAMS -- a 16-bit angle where 0x10000 is a full turn -- and `FUN_00410590`
 * feeds a spawn's three of them to `RotX; RotY; RotZ` in that order. Anything
 * that has to hand a composed orientation to glTF, which wants one rotation
 * and not three, comes through here.
 *
 * `web/src/core/bams.ts` is the *player's* binary angles and is a different
 * file on purpose: that one is the engine's arithmetic at runtime, this one is
 * the exporter's, and they answer to different references.
 */

/**
 * Radians per BAMS unit, for the **exporter**.
 *
 * `core/bams.ts` has one too and it is a different number: that one is
 * `Math.fround(2*pi/65536)`, because the exe stores the constant as a float32
 * and the player's job is to be the engine. This one is the double, because
 * the exporter's job is to write the same bytes as `tools/hod2lib/`, which
 * computes `math.tau / 65536.0`. They differ by about one part in 10^8.
 *
 * The two are not reconcilable without changing what one of the two programs
 * is faithful to, so they are two constants with a reason each -- and, as
 * `one-bams-constant` in `tools/verify_layers.py` requires, each lives in the
 * one file called `bams.ts` and every other module imports it.
 */
export const BAMS_TO_RAD = (Math.PI * 2) / 65536.0;

export type Mat3 = [number[], number[], number[]];
export type Bams3 = [number, number, number];

/** `Rz(rz) @ Ry(ry) @ Rx(rx)` -- the engine's order, as a 3x3. */
export function rotMatrix(bams: readonly number[]): Mat3 {
  const ax = bams[0] * BAMS_TO_RAD;
  const ay = bams[1] * BAMS_TO_RAD;
  const az = bams[2] * BAMS_TO_RAD;
  const ca = Math.cos(ax), sa = Math.sin(ax);
  const cb = Math.cos(ay), sb = Math.sin(ay);
  const cc = Math.cos(az), sc = Math.sin(az);
  return [
    [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
    [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
    [-sb, cb * sa, cb * ca],
  ];
}

/**
 * Python's `round`, which is banker's rounding, and JavaScript's is not.
 *
 * `Math.round(0.5)` is 1 and `Math.round(-0.5)` is -0; `round(0.5)` in Python
 * is 0 and `round(-0.5)` is 0. A BAMS is a sixteen-thousandth of a turn and a
 * half-unit disagreement is invisible on screen -- and it is still a byte in
 * the bundle that would not match, on exactly the ties a rotation of a
 * multiple of 90 degrees produces, which is most of the scenery.
 */
export function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Inverse of {@link rotMatrix}: a 3x3 back to a BAMS `(rx, ry, rz)` triple. */
export function bamsFromMatrix(M: readonly number[][]): Bams3 {
  const sb = Math.max(-1.0, Math.min(1.0, -M[2][0]));
  const ay = Math.asin(sb);
  let ax: number;
  let az: number;
  if (Math.abs(M[2][0]) < 0.999999) {
    ax = Math.atan2(M[2][1], M[2][2]);
    az = Math.atan2(M[1][0], M[0][0]);
  } else {                              // gimbal lock: fold into rx
    ax = Math.atan2(-M[1][2], M[1][1]);
    az = 0.0;
  }
  return [ax, ay, az].map((v) => roundHalfEven(v / BAMS_TO_RAD) & 0xffff) as Bams3;
}

/** The BAMS triple equivalent to applying *outer* then *inner*. */
export function composeBams(outer: readonly number[],
                            inner: readonly number[]): Bams3 {
  const A = rotMatrix(outer);
  const B = rotMatrix(inner);
  const P: number[][] = [];
  for (let i = 0; i < 3; i++) {
    P.push([0, 1, 2].map((j) => A[i][0] * B[0][j] + A[i][1] * B[1][j]
                                + A[i][2] * B[2][j]));
  }
  return bamsFromMatrix(P);
}
