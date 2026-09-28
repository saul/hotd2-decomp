/**
 * Class 0x22's path helpers and its facing, `0x0049DB40`..`0x0049DEA0`.
 *
 * Every one of them evaluates an `op_` object path through
 * `CamEvalObjectPath6` (`FUN_004042D0`), which the port asks `GameHost` for:
 * the curves are the camera bundle's. A host with no path leaves the actor
 * where it was.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { VecToAngles, type Vec3 } from "../vec";
import type { JudgmentTail } from "./state";

/** `FSUB double ptr [0x004c49c0]`, 3.0 — the phase-1 offset's drop. */
const PATH_OFFSET_DROP = 3.0;
/** `MatrixTranslate(0, 0, 0xC1200000)` — -10.0 in front of the camera. */
const CAMERA_PATH_DEPTH = -10.0;

/**
 * `Class22PlaceOnObjectPath` — `FUN_0049DB40`. `CamEvalObjectPath6(slot,
 * frame)` straight onto the position and all three angles.
 */
export function Class22PlaceOnObjectPath(obj: Actor, host: GameHost,
                                         slot: number, frame: number): void {
  const p = host.objectPath?.(slot, frame);
  if (!p) return;
  obj.pos.x = Math.fround(p.x);
  obj.pos.y = Math.fround(p.y);
  obj.pos.z = Math.fround(p.z);
  // `+0x64`, `+0x68`, `+0x6C` -- the int triple `FUN_004042D0` fills.
  obj.pitch = Math.trunc(p.pitch ?? obj.pitch);
  obj.yaw = Math.trunc(p.yaw ?? obj.yaw);
  obj.roll = Math.trunc(p.roll ?? obj.roll);
}

/**
 * `Class22EvalObjectPathOffset` — `FUN_0049DB90`. The path's point into
 * `+0x13C0`, three units lower: the offset phase 1 carries through the
 * companion's frame.
 */
export function Class22EvalObjectPathOffset(t: JudgmentTail, host: GameHost,
                                            slot: number,
                                            frame: number): void {
  const p = host.objectPath?.(slot, frame);
  if (!p) return;
  t.point.x = Math.fround(p.x);
  t.point.z = Math.fround(p.z);
  // `FLD [local_14]; FSUB [0x004c49c0]; FSTP [ESI+0x13C4]`.
  t.point.y = Math.fround(p.y - PATH_OFFSET_DROP);
}

const _m = MatIdentity();
const _p: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `Class22EvalCameraRelativePath` — `FUN_0049DBE0`. The path's point, carried
 * into the camera's frame: `T(g_camera_eye) RotY(g_camera_yaw_bams + 0x8000)
 * T(0, 0, -10)`, into `+0x13C0`. Phase 2's flight is drawn around the viewer.
 */
export function Class22EvalCameraRelativePath(t: JudgmentTail, host: GameHost,
                                              slot: number,
                                              frame: number): void {
  const p = host.objectPath?.(slot, frame);
  if (!p) return;
  for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
  // `g_camera_eye`, the three words by address (`0x0049DC03..0E`).
  const eye = G.g_camera_eye;
  MatrixTranslate(_m, eye.x, eye.y, eye.z);
  MatrixRotateY(_m, G.g_camera_yaw_bams + 0x8000);
  MatrixTranslate(_m, 0, 0, CAMERA_PATH_DEPTH);
  _p.x = p.x; _p.y = p.y; _p.z = p.z;
  MatrixTransformPoint(_m, _p, t.point);
  t.point.x = Math.fround(t.point.x);
  t.point.y = Math.fround(t.point.y);
  t.point.z = Math.fround(t.point.z);
}

/**
 * `Class22FaceCamera` — `FUN_0049DE60`. `VecToAngles(x - ex, 0, z - ez)` and
 * the yaw's low sixteen bits into `*out`. Used by both classes.
 *
 * ```
 * VecToAngles(param_1 - param_3, 0, param_2 - param_4, &pitch, &yaw);
 * *param_5 = (uint)yaw & 0xffff;
 * ```
 */
export function Class22FaceCamera(x: number, z: number, ex: number,
                                  ez: number): number {
  return Math.trunc(VecToAngles(x - ex, 0, z - ez).yaw) & 0xffff;
}
