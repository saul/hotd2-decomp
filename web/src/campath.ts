/**
 * Cubic Hermite evaluation and the camera pose it produces.
 *
 * This is a direct transcription of `FUN_004040F0` and `CamEvalPath7` -- the
 * whole reason the bundle ships raw curves rather than baked samples is that
 * the client must be able to evaluate at an arbitrary frame and highlight the
 * `start..end` sub-range one `cam_play` command covers.
 *
 * Reference: docs/formats/cam.md.
 */

import { Matrix4, Quaternion, Vector3 } from "three";
import type { CamJson, CamPathJson, Key } from "./bundle";

/** BAMS: the game stores every angle as 65536 = 360 degrees. */
export const BAMS_TO_RAD = (Math.PI * 2) / 65536;

const CP_CHANNELS = [
  "eye_x", "eye_y", "eye_z",
  "target_x", "target_y", "target_z",
  "roll",
] as const;

const OP_CHANNELS = [
  "pos_x", "pos_y", "pos_z",
  "rot_x", "rot_y", "rot_z",
] as const;

/**
 * One scalar curve. `evaluate` reproduces the game's behaviour exactly,
 * including at the ends: its binary search cannot leave the key array, so a
 * time outside the curve **extrapolates along the end segment** rather than
 * clamping.
 */
export class Curve {
  readonly keys: Key[];
  private readonly times: number[];

  constructor(keys: Key[]) {
    this.keys = keys;
    this.times = keys.map((k) => k[0]);
  }

  get first(): number {
    return this.times.length ? this.times[0] : 0;
  }

  get last(): number {
    return this.times.length ? this.times[this.times.length - 1] : 0;
  }

  evaluate(t: number): number {
    const k = this.keys;
    if (k.length === 0) return 0;
    if (k.length === 1) return k[0][1];

    // lower_bound, then clamped into [1, n-1] -- the same window the game's
    // fixed-depth binary search can land on.
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.min(Math.max(lo, 1), k.length - 1);

    const [t0, v0, m0] = k[i - 1];
    const [t1, v1, , m1] = k[i];
    const h = t1 - t0;
    if (h === 0) return v1;
    const s = (t - t0) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * v0 +
      (s3 - 2 * s2 + s) * h * m0 +
      (-2 * s3 + 3 * s2) * v1 +
      (s3 - s2) * h * m1
    );
  }
}

export interface CameraPose {
  eye: Vector3;
  target: Vector3;
  /** Roll in radians, already converted from BAMS. */
  roll: number;
}

/** A `cam/` path addressed the way the game addresses it: by global slot. */
export class CamPath {
  readonly slot: number;
  readonly file: string;
  readonly index: number;
  readonly start: number;
  readonly duration: number;
  readonly isObjectPath: boolean;
  private readonly curves: (Curve | null)[];

  constructor(slot: number, json: CamPathJson, isObjectPath: boolean) {
    this.slot = slot;
    this.file = json.file;
    this.index = json.index;
    this.start = json.start;
    this.duration = json.duration;
    this.isObjectPath = isObjectPath;
    const names = isObjectPath ? OP_CHANNELS : CP_CHANNELS;
    this.curves = names.map((n) => {
      const keys = json.channels[n];
      return keys && keys.length ? new Curve(keys) : null;
    });
  }

  get end(): number {
    return this.start + this.duration;
  }

  private ch(i: number, t: number): number {
    const c = this.curves[i];
    return c ? c.evaluate(t) : 0;
  }

  /**
   * Eye, look-at and roll at frame *t*.
   *
   * `CamEvalPath7` always evaluates channels 0-5. It evaluates channel 6 --
   * roll -- **only when `DAT_009A21B0` is set**, which evt opcode `0x35`
   * writes, and forces roll to 0 otherwise. So the caller passes whether the
   * script has asked for roll; the curve exists in every path either way.
   */
  pose(t: number, rollEnabled: boolean, out?: CameraPose): CameraPose {
    const o = out ?? { eye: new Vector3(), target: new Vector3(), roll: 0 };
    o.eye.set(this.ch(0, t), this.ch(1, t), this.ch(2, t));
    o.target.set(this.ch(3, t), this.ch(4, t), this.ch(5, t));
    o.roll = rollEnabled ? this.ch(6, t) * BAMS_TO_RAD : 0;
    return o;
  }

  /** Position of an `op_` object path at frame *t*. */
  position(t: number, out?: Vector3): Vector3 {
    const o = out ?? new Vector3();
    return o.set(this.ch(0, t), this.ch(1, t), this.ch(2, t));
  }

  /**
   * Polyline of a channel triple, for drawing the rail.
   *
   * `which` picks the eye track (0) or the look-at track (1); an `op_` path
   * has only the one.
   */
  polyline(which: 0 | 1, step = 1): Float32Array {
    const base = which === 0 ? 0 : 3;
    const n = Math.max(2, Math.ceil(this.duration / step) + 1);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = this.start + Math.min(this.duration, i * step);
      out[i * 3] = this.ch(base, t);
      out[i * 3 + 1] = this.ch(base + 1, t);
      out[i * 3 + 2] = this.ch(base + 2, t);
    }
    return out;
  }
}

export class CamPaths {
  readonly fps: number;
  readonly paths = new Map<number, CamPath>();
  readonly objectPaths = new Map<number, CamPath>();

  constructor(json: CamJson) {
    this.fps = json.fps || 60;
    for (const [slot, p] of Object.entries(json.paths)) {
      this.paths.set(Number(slot), new CamPath(Number(slot), p, false));
    }
    for (const [slot, p] of Object.entries(json.object_paths)) {
      this.objectPaths.set(Number(slot), new CamPath(Number(slot), p, true));
    }
  }

  get(slot: number): CamPath | undefined {
    return this.paths.get(slot) ?? this.objectPaths.get(slot);
  }
}

// -- pose -> three.js ------------------------------------------------------

const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _altUp = new Vector3(0, 0, 1);
const _fwd = new Vector3();
const _axis = new Vector3();
const _rollQ = new Quaternion();

/**
 * The rotation a three.js camera needs to sit at `eye` looking at `target`.
 *
 * three.js cameras look down -Z with +Y up, which is also glTF's convention,
 * so this is the same construction `hod2lib.gltf._look_at_quat` uses for the
 * exported cameras -- deliberately, so the browser and a Blender render of
 * the same glTF are comparable.
 */
export function applyPose(
  obj: { position: Vector3; quaternion: Quaternion },
  pose: CameraPose,
): void {
  _fwd.copy(pose.target).sub(pose.eye);
  if (_fwd.lengthSq() < 1e-12) _fwd.set(0, 0, -1);
  _fwd.normalize();
  const up = Math.abs(_fwd.y) > 0.9999 ? _altUp : _up;
  _m.lookAt(pose.eye, pose.target, up);
  obj.position.copy(pose.eye);
  obj.quaternion.setFromRotationMatrix(_m);
  if (pose.roll !== 0) {
    _axis.copy(_fwd);
    _rollQ.setFromAxisAngle(_axis, -pose.roll);
    obj.quaternion.premultiply(_rollQ);
  }
}
