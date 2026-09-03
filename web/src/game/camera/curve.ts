/**
 * The `cam/` curves, evaluated where the camera's decisions are made.
 *
 * This is the Hermite evaluator the whole camera rests on. It lived in
 * `render/campath.ts` over three.js `Vector3`s, which meant the one routine
 * that turns a `cam_play` operand into a camera pose could only run with a
 * renderer attached — so `CamAdvancePathFrame`, an engine function that writes
 * an engine global, had to be *called from* `render/camera.ts`. That is the
 * shape `render-drives-the-port` exists to catch. The maths is plain numbers
 * and the keys come out of the bundle, so nothing about it ever needed
 * three.js: it belongs here, over {@link Vec3}, and the renderer reads the
 * pose it produced.
 *
 * `render/campath.ts` keeps the half that genuinely is three.js — turning a
 * pose into a camera quaternion — and the `path.y - 15` eye rule, which is a
 * property of the draw.
 *
 * Reference: docs/formats/cam.md.
 */
import type { CamJson, CamPathJson, Key } from "../../bundle";
import { BAMS_TO_RAD } from "../../core/bams";
import { vec3, type Vec3 } from "../vec";

const CP_CHANNELS = [
  "eye_x", "eye_y", "eye_z",
  "target_x", "target_y", "target_z",
  "roll",
] as const;

export const OP_CHANNELS = [
  "pos_x", "pos_y", "pos_z",
  "rot_x", "rot_y", "rot_z",
] as const;

/**
 * One scalar curve, evaluated as `CamEvalHermiteCurve` (`FUN_004040F0`) does.
 *
 * `evaluate` reproduces the game's behaviour exactly, including at the ends:
 * its binary search cannot leave the key array, so a time outside the curve
 * **extrapolates along the end segment** rather than clamping.
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

/**
 * Eye, look-at and roll: what one frame of a `cp_` path is.
 *
 * A three.js `Vector3` satisfies `Vec3` structurally, so the renderer can hand
 * its own scratch pose in and get it filled — the seam costs nothing and the
 * evaluator still knows nothing about three.js.
 */
export interface CamPose {
  eye: Vec3;
  target: Vec3;
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
   * One raw channel by index, in this path's own channel order.
   *
   * Needed for `op_` paths, whose channels 3-5 are a BAMS Euler triple rather
   * than a look-at point, so they cannot go through `pose`.
   */
  channel(i: number, t: number): number {
    return this.ch(i, t);
  }

  /**
   * Eye, look-at and roll at frame *t*, as `CamEvalPath7` (`FUN_004041E0`)
   * evaluates them.
   *
   * It always evaluates channels 0-5. It evaluates channel 6 -- roll --
   * **only when `DAT_009A21B0` is set**, which evt opcode `0x35` writes, and
   * forces roll to 0 otherwise. So the caller passes whether the script has
   * asked for roll; the curve exists in every path either way.
   */
  pose(t: number, rollEnabled: boolean, out?: CamPose): CamPose {
    const o = out ?? { eye: vec3(), target: vec3(), roll: 0 };
    o.eye.x = this.ch(0, t);
    o.eye.y = this.ch(1, t);
    o.eye.z = this.ch(2, t);
    o.target.x = this.ch(3, t);
    o.target.y = this.ch(4, t);
    o.target.z = this.ch(5, t);
    o.roll = rollEnabled ? this.ch(6, t) * BAMS_TO_RAD : 0;
    return o;
  }

  /** Position of an `op_` object path at frame *t*. */
  position(t: number, out?: Vec3): Vec3 {
    const o = out ?? vec3();
    o.x = this.ch(0, t);
    o.y = this.ch(1, t);
    o.z = this.ch(2, t);
    return o;
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

  /**
   * An `op_` object path **only**.
   *
   * `get` falls back from one map to the other, which is right for the rails
   * but wrong for `CamEvalObjectPath6`: the two slot spaces overlap, so a
   * class-0x25 actor asking for object path 331 was handed *camera* path 331
   * and placed on the lens, which fills the screen and reads as a black frame.
   */
  objectPath(slot: number): CamPath | undefined {
    return this.objectPaths.get(slot);
  }
}
