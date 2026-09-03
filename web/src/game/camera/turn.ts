/**
 * The look-at ease, and the rate curve that drives it.
 *
 * `TurnLookAtToward` — `FUN_00403C00`. Rotate *current* toward *desired* by
 * `num / (num + rate)` of the angle between them, seen from the eye, and
 * re-emit the result at a fixed 100-unit radius. Every caller passes `num = 1`,
 * so the step is `1 / (1 + rate)` and a **larger rate is a slower turn**:
 * rate 0 is a snap, rate 12 (the untracked constant) crosses a 16-degree gap
 * in about thirty frames, rate 64 barely moves.
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
import { LOOKAT_RADIUS, TURN_ERROR_CLAMP } from "./constants";
import { BAMS, type Vec3 } from "../vec";

/** The angle between two directions, in BAMS. `FUN_00401D70`. */
function angleBetweenBams(ax: number, ay: number, az: number,
                          bx: number, by: number, bz: number): number {
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la < 1e-4 || lb < 1e-4) return 0;
  const dot = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.round(Math.acos(Math.min(1, Math.max(-1, dot))) * BAMS);
}

/**
 * `sign(cos) * cos^2` between two directions. `FUN_00401DF0`.
 *
 * The engine never takes the square root, so its `> 0.99999` convergence test
 * is against the **square** of the cosine — about 0.18 degrees, not 0.26.
 */
export function LookAtCosineSquared(eye: Vec3, a: Vec3, b: Vec3): number {
  const ax = a.x - eye.x, ay = a.y - eye.y, az = a.z - eye.z;
  const bx = b.x - eye.x, by = b.y - eye.y, bz = b.z - eye.z;
  const dot = ax * bx + ay * by + az * bz;
  const den = (ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz);
  if (den < 1e-12) return 0;
  const v = (dot * dot) / den;
  return dot < 0 ? -v : v;
}

/**
 * `ComputeLookAtAngleError` — `FUN_00403B00`.
 *
 * Writes `g_camera_turn_rate` from the angle between the camera block's
 * current look-at and the desired one, through `g_camera_turn_curve`.
 */
export function ComputeLookAtAngleError(): void {
  const eye = G.g_camera_block_eye;
  const cur = G.g_camera_block_target;
  const want = G.g_camera_lookat_target;
  let bams = angleBetweenBams(
    cur.x - eye.x, cur.y - eye.y, cur.z - eye.z,
    want.x - eye.x, want.y - eye.y, want.z - eye.z);
  if (bams > TURN_ERROR_CLAMP) bams = TURN_ERROR_CLAMP;
  // The curves are `.rdata` — `PTR_DAT_00576C04` — so they come from the
  // bundle; the clamp beside them is an immediate, so it does not.
  const curve = T.tracking?.curves?.[G.g_camera_turn_curve];
  if (!curve?.length) return;
  G.g_camera_turn_rate =
    curve[Math.min(curve.length - 1, Math.max(0, bams >> 7))] ?? 0;
}

/**
 * `TurnLookAtToward` — `FUN_00403C00`.
 *
 * The argument order is the exe's: eye, **desired**, **current**, out. `num`
 * and `rate` form the step fraction `num / (num + rate)`.
 */
export function TurnLookAtToward(eye: Vec3, desired: Vec3, current: Vec3,
                                 out: Vec3, num: number, rate: number): void {
  const a = { x: current.x - eye.x, y: current.y - eye.y, z: current.z - eye.z };
  const b = { x: desired.x - eye.x, y: desired.y - eye.y, z: desired.z - eye.z };
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  if (la < 1e-4 || lb < 1e-4) {
    out.x = desired.x; out.y = desired.y; out.z = desired.z;
    return;
  }
  a.x /= la; a.y /= la; a.z /= la;
  b.x /= lb; b.y /= lb; b.z /= lb;
  const angle = angleBetweenBams(a.x, a.y, a.z, b.x, b.y, b.z) / BAMS;
  const f = num / (num + rate);

  if (angle < 1e-5) {
    out.x = eye.x + b.x * LOOKAT_RADIUS;
    out.y = eye.y + b.y * LOOKAT_RADIUS;
    out.z = eye.z + b.z * LOOKAT_RADIUS;
    return;
  }
  // Slerp the direction by that fraction, then re-emit at the radius.
  const s = Math.sin(angle);
  const w0 = Math.sin((1 - f) * angle) / s;
  const w1 = Math.sin(f * angle) / s;
  let x = a.x * w0 + b.x * w1;
  let y = a.y * w0 + b.y * w1;
  let z = a.z * w0 + b.z * w1;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  out.x = eye.x + x * LOOKAT_RADIUS;
  out.y = eye.y + y * LOOKAT_RADIUS;
  out.z = eye.z + z * LOOKAT_RADIUS;
}
