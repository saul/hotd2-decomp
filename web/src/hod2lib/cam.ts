/**
 * `cam/` camera and object paths -- cubic Hermite spline curves.
 * The port of `tools/hod2lib/cam.py`.
 *
 * A `cam/` file is a pool of independent scalar animation curves plus a small
 * descriptor per path that names the curves for each channel.
 *
 * File layout:
 *
 *     +0x00   u32 path_offset[n]     byte offset of each path descriptor
 *             u32 0xFFFFFFFF         terminator -- gives *n* without the EXE
 *     +base   ...                    curve pool and path descriptors,
 *                                    interleaved (base = 4 + n*4)
 *
 * Curve indices inside a path descriptor are **dword indices relative to
 * base**, i.e. `curve_addr = base + index * 4`.
 *
 * Curve:
 *
 *     +0x00   u16 key_count          always a power of two
 *     +0x02   u16 search_steps       log2(key_count), the binary-search depth
 *     +0x04   key[key_count]         16 bytes each:
 *                 +0x00  f32 time
 *                 +0x04  f32 value
 *                 +0x08  f32 tangent_out   (used leaving this key)
 *                 +0x0C  f32 tangent_in    (used arriving at this key)
 *
 * Path descriptor: one u32 curve index per channel.
 *
 *     cp_*  7 channels  eye.x eye.y eye.z  target.x target.y target.z  roll
 *     op_*  6 channels  pos.x pos.y pos.z  rot.x rot.y rot.z
 *
 * That split is what distinguishes the two families: identical container, two
 * different consumers. `CamEvalPath7` reads seven channels and produces an eye
 * point, a look-at point and an integer roll; `CamEvalObjectPath6` reads six
 * and converts the last three with `__ftol`, i.e. they are BAMS angles, not
 * floats.
 *
 * Evaluation is a textbook cubic Hermite segment, so tangents are expressed in
 * value-per-unit-time and the curves map directly onto glTF `CUBICSPLINE`
 * samplers.
 *
 * Reference: docs/formats/cam.md
 */

import { f32, u16, u32, u32s } from "./bytes";

export const TERMINATOR = 0xffffffff;
export const KEY_SIZE = 16;

/**
 * Anything beyond this is not a coordinate in a level that spans ~6700 units.
 * Nothing in a correct `cam/` file comes close; a word that exceeds it means
 * the file on disk is damaged.
 */
export const FLOAT_LIMIT = 1e30;

/** Channel order for the two path families. */
export const CP_CHANNELS = ["eye_x", "eye_y", "eye_z",
                            "target_x", "target_y", "target_z", "roll"];
export const OP_CHANNELS = ["pos_x", "pos_y", "pos_z",
                            "rot_x", "rot_y", "rot_z"];

/** Channels the consumer reads through `__ftol`, i.e. integers (BAMS angles). */
export const CP_INT_CHANNELS = new Set(["roll"]);
export const OP_INT_CHANNELS = new Set(["rot_x", "rot_y", "rot_z"]);

export const FIELDS = ["time", "value", "tangent_out", "tangent_in"] as const;

/** True if *v* is a value a keyframe could legitimately hold. */
function isSane(v: number): boolean {
  return v === v && v > -FLOAT_LIMIT && v < FLOAT_LIMIT;
}

export class CamError extends Error {
  override name = "CamError";
}

export interface Key {
  time: number;
  value: number;
  tangent_out: number;
  tangent_in: number;
}

/**
 * `bisect_left` over the key times.
 *
 * Spelled out rather than reached for, because Python's is over a list the
 * reference implementation rebuilds on every evaluate and this one indexes the
 * keys in place. A camera rail is sampled a few thousand times per export.
 */
function bisectLeftTime(keys: readonly Key[], t: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class Curve {
  constructor(
    /** Byte offset in the file. */
    readonly offset: number,
    /** Dword index relative to the curve base. */
    readonly index: number,
    readonly searchSteps: number,
    readonly keys: Key[],
  ) {}

  get size(): number {
    return 4 + this.keys.length * KEY_SIZE;
  }

  get duration(): number {
    const ks = this.keys;
    return ks.length ? ks[ks.length - 1].time - ks[0].time : 0.0;
  }

  /**
   * Cubic Hermite, matching `CamEvalHermiteCurve`.
   *
   * The game clamps by construction rather than by test: its binary search
   * cannot leave the key array, so times outside the curve extrapolate along
   * the end segments. This reproduces that.
   */
  evaluate(t: number): number {
    const keys = this.keys;
    if (!keys.length) return 0.0;
    if (keys.length === 1) return keys[0].value;
    let i = bisectLeftTime(keys, t);
    i = Math.min(Math.max(i, 1), keys.length - 1);
    const k0 = keys[i - 1];
    const k1 = keys[i];
    const h = k1.time - k0.time;
    if (h === 0.0) return k1.value;
    const s = (t - k0.time) / h;
    const s2 = s * s;
    const s3 = s * s * s;
    return (2 * s3 - 3 * s2 + 1) * k0.value
      + (s3 - 2 * s2 + s) * h * k0.tangent_out
      + (-2 * s3 + 3 * s2) * k1.value
      + (s3 - s2) * h * k1.tangent_in;
  }
}

export class Path {
  channels = new Map<string, Curve>();

  constructor(
    /** Position in the file's offset table. */
    readonly index: number,
    /** Byte offset of the descriptor. */
    readonly offset: number,
    /** The dword after the channel list; see the module comment. */
    readonly trailing: number,
  ) {}

  get duration(): number {
    let d = 0.0;
    for (const c of this.channels.values()) if (c.duration > d) d = c.duration;
    return d;
  }

  sample(t: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [n, c] of this.channels) out[n] = c.evaluate(t);
    return out;
  }
}

/** A parsed `cam/` file. */
export class CamFile {
  readonly isObjectPath: boolean;
  readonly channelNames: string[];
  /**
   * `cp_` descriptors carry an eighth curve index the seven-channel consumer
   * `CamEvalPath7` never reads; `op_` descriptors are exactly six.
   */
  readonly descriptorWords: number;
  pathOffsets: number[] = [];
  base = 0;
  /** By dword index. */
  curves = new Map<number, Curve>();
  paths: Path[] = [];
  unnamedDescriptors: number[] = [];
  descriptorSpans: [number, number][] = [];
  poolEnd = 0;
  warnings: string[] = [];

  constructor(readonly raw: Uint8Array, readonly name = "") {
    this.isObjectPath = name.startsWith("op_");
    this.channelNames = this.isObjectPath ? OP_CHANNELS : CP_CHANNELS;
    this.descriptorWords = this.isObjectPath ? 6 : 8;
  }

  parse(): CamFile {
    this.readTable();
    this.readCurvePool();
    this.readPaths();
    this.checkIntact();
    return this;
  }

  /**
   * Refuse a file whose keyframes cannot be what the authors wrote.
   *
   * Every shipped `cam/` file parses with every keyframe word finite and
   * inside {@link FLOAT_LIMIT}. A copy that fails this is damaged on disk, and
   * the right answer is to restore it from the disc rather than to guess at
   * the missing bytes -- this parser used to do the guessing, and the invented
   * values were mistaken for a property of the format.
   */
  private checkIntact(): void {
    const indices = [...this.curves.keys()].sort((a, b) => a - b);
    for (const ci of indices) {
      const c = this.curves.get(ci)!;
      c.keys.forEach((key, k) => {
        for (const name of FIELDS) {
          const v = key[name];
          if (!isSane(v)) {
            throw new CamError(
              `${this.name}: curve ${ci} (0x${c.offset.toString(16)}) key ${k} `
              + `${name} = ${v} -- the file is damaged; re-extract it from the `
              + "disc");
          }
        }
      });
    }
  }

  private readTable(): void {
    let n = 0;
    for (;;) {
      if ((n + 1) * 4 > this.raw.length) {
        throw new CamError(`${this.name}: offset table has no terminator`);
      }
      const v = u32(this.raw, n * 4);
      if (v === TERMINATOR) break;
      this.pathOffsets.push(v);
      n += 1;
    }
    this.base = (n + 1) * 4;
  }

  /**
   * A curve header is unambiguous: `key_count` is a power of two and
   * `search_steps` is exactly its log2 (that is what the binary search in
   * `CamEvalHermiteCurve` needs to terminate on the right key).
   *
   * No descriptor dword can imitate one -- a channel index whose low half is a
   * power of two and whose high half is its log2 would address a curve
   * hundreds of kilobytes past the end of any shipped file.
   */
  private isCurveHeader(off: number): boolean {
    if (off + 4 > this.raw.length) return false;
    const count = u16(this.raw, off);
    const steps = u16(this.raw, off + 2);
    if (count === 0 || (count & (count - 1))) return false;
    if (31 - Math.clz32(count) !== steps) return false;
    return off + 4 + count * KEY_SIZE <= this.raw.length;
  }

  /**
   * Walk the pool linearly from *base*.
   *
   * Curves and path descriptors are interleaved: each path's curves are
   * followed by that path's descriptor. The walk chains `4 + key_count * 16`
   * through curves and steps over anything that is not a curve header as a
   * descriptor.
   *
   * The offset table is deliberately *not* used to locate descriptors --
   * `op_st1` and `op_st6` contain descriptors the table never names, so a
   * table-driven walk desynchronises on them. That the walk lands exactly on
   * the end of every one of the 23 shipped files, with no slack, is the check
   * that it stays in step.
   */
  private readCurvePool(): void {
    let off = this.base;
    const end = this.raw.length;
    const named = new Set(this.pathOffsets);
    while (off + 4 <= end) {
      if (!this.isCurveHeader(off)) {
        if (!named.has(off)) this.unnamedDescriptors.push(off);
        // Descriptor length is not fixed across op_ files, so take it
        // structurally: run to the next curve header.
        let step = this.descriptorWords * 4;
        let probe = off + 4;
        while (probe < end && !this.isCurveHeader(probe)) {
          probe += 4;
          if (probe - off > 16 * 4) break;
        }
        step = Math.max(step, probe - off);
        this.descriptorSpans.push([off, step]);
        off += step;
        continue;
      }
      const count = u16(this.raw, off);
      const steps = u16(this.raw, off + 2);
      const keys: Key[] = [];
      for (let i = 0; i < count; i++) {
        const k = off + 4 + i * KEY_SIZE;
        keys.push({
          time: f32(this.raw, k),
          value: f32(this.raw, k + 4),
          tangent_out: f32(this.raw, k + 8),
          tangent_in: f32(this.raw, k + 12),
        });
      }
      const idx = (off - this.base) / 4;
      this.curves.set(idx, new Curve(off, idx, steps, keys));
      off += 4 + count * KEY_SIZE;
    }
    this.poolEnd = off;
  }

  private readPaths(): void {
    const n = this.channelNames.length;
    const w = this.descriptorWords;
    this.pathOffsets.forEach((off, i) => {
      if (off + w * 4 > this.raw.length) {
        this.warnings.push(`path ${i}: descriptor past end`);
        return;
      }
      const idx = u32s(this.raw, off, w);
      const path = new Path(i, off, w > n ? idx[n] : 0);
      this.channelNames.forEach((name, ch) => {
        const curve = this.curves.get(idx[ch]);
        if (curve === undefined) {
          this.warnings.push(
            `path ${i}: channel ${name} index 0x${idx[ch].toString(16)} is not `
            + "a curve start");
          return;
        }
        path.channels.set(name, curve);
      });
      this.paths.push(path);
    });
  }
}

/** Parse *data* as the `cam/` file called *name*. */
export function parse(data: Uint8Array, name: string): CamFile {
  return new CamFile(data, name).parse();
}
