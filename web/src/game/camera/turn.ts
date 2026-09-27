/**
 * The look-at ease, and the rate curve that drives it.
 *
 * `TurnLookAtToward` — `FUN_00403C00`. Rotate *current* toward *desired* by
 * `num / (num + rate)` of the angle between them, seen from the eye, and
 * re-emit the result at a fixed 100-unit radius. Every caller passes `num = 1`,
 * so the step is `1 / (1 + rate)` and a **larger rate is a slower turn**:
 * rate 0 is a snap, rate 12 (the untracked constant) crosses a 16-degree gap
 * in about thirty frames, rate 64 barely moves. The angle and the step are
 * both whole BAMS, the step truncated, so a gap narrower than `1 + rate`
 * BAMS does not close at all.
 *
 * `ComputeLookAtAngleError` — `FUN_00403B00` — is what refreshes that rate.
 * Despite the name it does not return an angle: it measures the one between
 * where the camera is looking and where it wants to look, clamps it to 0x1FFF
 * (45 degrees), and uses it to index a 64-entry curve — **64 below about 18
 * degrees, ramping down to 16 past 23** — writing the result into
 * `g_camera_turn_rate` for the *next* frame to read. That curve is the feel of
 * it: the camera holds almost still for small offsets and swings briskly for
 * wide ones.
 */
import { G } from "../globals";
import { T } from "../tables";
import { FtolS16, MatIdentity, MatrixLoadIdentity, MatrixRotateX,
         MatrixRotateY, MatrixRotateZ, MatrixTransformPoint, MatrixTranslate,
         RADIANS_TO_BAMS, VecAimXAxisZThenY } from "../matrix";
import { LOOKAT_RADIUS, TURN_ERROR_CLAMP } from "./constants";
import { vec3, type Vec3 } from "../vec";

/**
 * `VecAngleBetween` — `FUN_00401D70`. The angle between two directions in
 * BAMS, as the engine takes it:
 *
 * ```c
 * dot = a . b;
 * return (s16)__ftol(atan2(sqrt(|a|^2 |b|^2 - dot^2), dot) * 65536 / 2pi);
 * ```
 *
 * Truncated, not rounded, and with no degenerate test: two zero vectors are
 * `atan2(0, 0)`, which is 0. `[proved]`
 */
export function VecAngleBetween(ax: number, ay: number, az: number,
                                bx: number, by: number, bz: number): number {
  const dot = az * bz + ay * by + ax * bx;
  const cross2 = (bz * bz + by * by + bx * bx) * (az * az + ay * ay + ax * ax)
               - dot * dot;
  return FtolS16(Math.atan2(Math.sqrt(Math.max(0, cross2)), dot)
                 * RADIANS_TO_BAMS);
}

/**
 * `sign(cos) * cos^2` between two directions. `VecCosSquaredSigned`,
 * `FUN_00401DF0`, with each direction taken from `eye`.
 *
 * The engine never takes the square root, so its `> 0.99999` convergence test
 * is against the **square** of the cosine — about 0.18 degrees, not 0.26. A
 * degenerate direction is `0 / 0` on the FPU, a NaN that fails every test;
 * the port answers 0, which fails the same tests. `[proved]`
 */
export function LookAtCosineSquared(eye: Vec3, a: Vec3, b: Vec3): number {
  const ax = a.x - eye.x, ay = a.y - eye.y, az = a.z - eye.z;
  const bx = b.x - eye.x, by = b.y - eye.y, bz = b.z - eye.z;
  const dot = az * bz + ay * by + ax * bx;
  const den = (bz * bz + by * by + bx * bx) * (az * az + ay * ay + ax * ax);
  if (!(den > 0)) return 0;
  const v = (dot * dot) / den;
  return dot < 0 ? -v : v;
}

/**
 * `ComputeLookAtAngleError` — `FUN_00403B00`.
 *
 * ```c
 * a = VecAngleBetween(block.target - eye, g_camera_lookat_target - eye);
 * if ((u16)a > 0x1FFF) a = 0x1FFF;
 * g_camera_turn_rate = (s8)g_camera_turn_rate_curves[g_camera_turn_curve][a / 128];
 * ```
 *
 * Writes `g_camera_turn_rate` from the angle between the camera block's
 * current look-at and the desired one, through `g_camera_turn_curve`.
 */
export function ComputeLookAtAngleError(): void {
  const eye = G.g_camera_block_eye;
  const cur = G.g_camera_block_target;
  const want = G.g_camera_lookat_target;
  let bams = VecAngleBetween(
    cur.x - eye.x, cur.y - eye.y, cur.z - eye.z,
    want.x - eye.x, want.y - eye.y, want.z - eye.z);
  if ((bams & 0xffff) > TURN_ERROR_CLAMP) bams = TURN_ERROR_CLAMP;
  // The curves are `.rdata` — `PTR_DAT_00576C04` — so they come from the
  // bundle; the clamp beside them is an immediate, so it does not.
  const curve = T.tracking?.curves?.[G.g_camera_turn_curve];
  if (!curve?.length) return;
  G.g_camera_turn_rate =
    curve[Math.min(curve.length - 1, Math.max(0, Math.trunc(bams / 128)))] ?? 0;
}

const _tm = MatIdentity();
const _tp = vec3();
const _tq = vec3();
const _tr = vec3();

/**
 * `TurnLookAtToward` — `FUN_00403C00`. The argument order is the exe's: eye,
 * **desired**, **current**, out, then `num` and `rate`.
 *
 * Read off the instruction stream, because the decompiler loses the float
 * arguments of the matrix calls (L1):
 *
 * ```
 * 00403C35  (ry, rz) = VecAimXAxisZThenY(current - eye)      ; +X onto current
 *           M = Ry(-ry) Rz(-rz) T(-eye);  d = M * desired
 * 00403C96  rx = (s16)ftol(atan2(d.z, d.y) * B)              ; desired into the XY plane
 *           M = Rx(-rx) Ry(-ry) Rz(-rz) T(-eye);  d = M * desired
 * 00403D0C  angle = (s16)ftol(atan2(d.y, d.x) * B)           ; current -> desired, BAMS
 * 00403D32  step  = angle * num / (num + rate)                ; IDIV: truncates
 *           p = (cos(step) * 100, sin(step) * 100, 0)
 * 00403D6C  out = T(eye) Rz(rz) Ry(ry) Rx(rx) * p
 * ```
 *
 * So the turn is a rotation of the current direction toward the desired one
 * by a **whole number of BAMS**, re-emitted 100 units from the eye. `[proved]`
 */
export function TurnLookAtToward(eye: Vec3, desired: Vec3, current: Vec3,
                                 out: Vec3, num: number, rate: number): void {
  const { ry, rz } = VecAimXAxisZThenY(current.x - eye.x, current.y - eye.y,
                                       current.z - eye.z);
  const m = _tm;
  MatrixLoadIdentity(m);
  MatrixRotateY(m, -ry);
  MatrixRotateZ(m, -rz);
  MatrixTranslate(m, -eye.x, -eye.y, -eye.z);
  MatrixTransformPoint(m, desired, _tp);
  const rx = FtolS16(Math.atan2(_tp.z, _tp.y) * RADIANS_TO_BAMS);
  MatrixLoadIdentity(m);
  MatrixRotateX(m, -rx);
  MatrixRotateY(m, -ry);
  MatrixRotateZ(m, -rz);
  MatrixTranslate(m, -eye.x, -eye.y, -eye.z);
  MatrixTransformPoint(m, desired, _tp);
  const angle = FtolS16(Math.atan2(_tp.y, _tp.x) * RADIANS_TO_BAMS);
  const step = Math.trunc((angle * num) / (num + rate));
  const a = step * BAMS_TO_RADIANS_D;
  _tq.x = Math.fround(Math.cos(a) * LOOKAT_RADIUS);
  _tq.y = Math.fround(Math.sin(a) * LOOKAT_RADIUS);
  _tq.z = 0;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, eye.x, eye.y, eye.z);
  MatrixRotateZ(m, rz);
  MatrixRotateY(m, ry);
  MatrixRotateX(m, rx);
  MatrixTransformPoint(m, _tq, _tr);
  out.x = _tr.x; out.y = _tr.y; out.z = _tr.z;
}

/** `FMUL double ptr [0x004C4370]`: `2pi / 65536`, as a double. */
const BAMS_TO_RADIANS_D = 9.587379924285257e-05;

/**
 * `LerpWeighted` — `FUN_00401E60`, `(a, b, num, den)`:
 *
 * ```
 * 00401E60  FILD [den]; FMUL [a]; FILD [num]; FMUL [b]; FADDP
 * 00401E80  FIDIV [num + den]
 * ```
 *
 * `(den * a + num * b) / (num + den)`: with the camera's `(1, 15)`, a
 * sixteenth of the way from `a` to `b`. `[proved]`
 */
export function LerpWeighted(a: number, b: number, num: number,
                             den: number): number {
  return (den * a + num * b) / (num + den);
}
