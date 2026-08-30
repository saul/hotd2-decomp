/**
 * `TurnLookAtToward` — `FUN_00403C00`.
 *
 * Ease *current* onto *desired* by `1 / (1 + rate)` of the angle between them,
 * re-emitted at a fixed radius from the eye. The rate comes from a 64-entry
 * curve indexed by the angle error clamped to 45 degrees: **64 below about 18
 * degrees, ramping to 16 past 23** — and a larger rate is a *slower* turn, so
 * the camera holds almost still for small offsets and swings briskly for wide
 * ones. That curve is the feel of it.
 */
import { G } from "../globals";
import { T } from "../tables";
import { BAMS, type Vec3 } from "../vec";

/** `ComputeLookAtAngleError` — `FUN_00403B00`. The angle between two look-ats. */
export function ComputeLookAtAngleError(a: Vec3, b: Vec3): number {
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  if (la < 1e-4 || lb < 1e-4) return 0;
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

export function TurnLookAtToward(eye: Vec3, current: Vec3, desired: Vec3,
                                 out: Vec3): void {
  const t = T.tracking;
  const radius = t?.lookat_radius ?? 100;
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
  const angle = ComputeLookAtAngleError(a, b);

  let rate = t?.rate_untracked ?? 12;
  if (G.g_camera_is_tracking && t?.curves?.length) {
    const bams = Math.min(t.error_clamp ?? 0x1fff, Math.round(angle * BAMS));
    const curve = t.curves[t.curve ?? 1] ?? [];
    rate = curve[Math.min(curve.length - 1, bams >> 7)] ?? rate;
  }
  const f = 1 / (1 + rate);

  if (angle < 1e-5) {
    out.x = eye.x + b.x * radius;
    out.y = eye.y + b.y * radius;
    out.z = eye.z + b.z * radius;
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
  out.x = eye.x + x * radius;
  out.y = eye.y + y * radius;
  out.z = eye.z + z * radius;
}
