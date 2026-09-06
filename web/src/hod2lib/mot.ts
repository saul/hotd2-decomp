/**
 * `mot/` -- skeletal animation. The port of `tools/hod2lib/mot.py`.
 *
 * Read out of the loader, not out of the files. The chain is:
 *
 * * `FUN_00412C10` (motion job kind 8, sub-step 0) builds the path with the
 *   format string `"mot\\%s"` and the bank name from `DAT_004D1B00[bank]`,
 *   then `CreateFileA` / `GetFileSize` and allocates `size + 0x20`.
 * * `FUN_00412D40` (sub-step 1) `ReadFile`s the whole thing in one go. **There
 *   is no decompression** -- unlike `pol/`, a `mot/` file is raw on disk.
 * * `FUN_00412D90` (sub-step 2) is the entire parse:
 *
 *       p = buf;
 *       for each motion id m in bank:              // DAT_004E2B14[bank]
 *           g_motion_slot[m].base  = *p++ + buf;   // DAT_009A37E0 + m*8
 *           g_motion_slot[m].state = 2;            // DAT_009A37E4 + m*8
 *
 *   So the file begins with one **int32 offset per motion in the bank**, in
 *   the bank's own id order, each relative to the file start.
 *
 * * `FUN_00412F50(char_type, motion_id, frame)` is the sampler:
 *
 *       return ((bone_count[char_type] * 6 + 15) & ~3) * frame
 *              + 4 + g_motion_slot[motion_id].base;
 *
 *   Frames start 4 bytes into a motion block, and the stride is derived from
 *   the **character type**, not from the file. The same motion data read
 *   against a different skeleton would be read with a different stride, so a
 *   motion is only meaningful with the character it was authored for.
 *
 * A frame record is:
 *
 *     +0x00  f32 root translation x
 *     +0x04  f32 root translation y
 *     +0x08  f32 root translation z
 *     +0x0C  s16 bone[0].rx, .ry, .rz      <- applied at the object root
 *     +0x12  s16 bone[1].rx, .ry, .rz
 *     ...                                     padded to a multiple of 4
 *
 * Bone 0 is the object root; the skeleton nodes carry 1-based bone indices.
 *
 * **The rest pose is not in here.** Each skeleton node carries its own bone
 * offset in the EXE, so a character assembles in bind pose with no motion data
 * at all; `mot/` supplies only the per-bone rotations and the root translation.
 */

import { f32, i16, i32s, u32 } from "./bytes";
import type { AssetSource } from "./io";

/** The format string at 0x00579920, used by `FUN_00412C10`. */
export const MOT_DIR_FORMAT = "mot\\%s";

/** Bytes per frame, exactly as `FUN_00412F50` computes it. */
export function frameStride(boneCount: number): number {
  return (boneCount * 6 + 15) & ~3;
}

/**
 * Bytes per frame for an **effect**'s motion, which is not the character
 * stride and is not derived from a character at all.
 *
 * `EffectFrameTranslations` (`FUN_0040E040`) and `EffectFrameRotations`
 * (`FUN_0040E070`) both compute
 * `(g_effect_bone_counts[effect] * 0x12 - 0xF) & 0xFFFFFFFC`, and the mask
 * **truncates** rather than rounding up. An effect tree's node count includes
 * its root, which carries no animation, so one frame holds `n - 1`
 * translations of three floats followed by `n - 1` rotations of three BAMS
 * shorts -- `18(n-1)` bytes, which is what that expression comes to whenever
 * the truncation does not bite.
 *
 * Nothing may stand in for this: reading an effect's block at
 * {@link frameStride} walks a third of a frame per frame.
 */
export function effectFrameStride(nodeCount: number): number {
  return (nodeCount * 0x12 - 0xf) & ~3;
}

/**
 * One key of an effect's motion: a translation and a rotation per node,
 * indexed by the node's `bone - 1`.
 *
 * `EffectPoseNode` (`FUN_0040D9D0`) reads `bone - 1` into both arrays, so the
 * root -- bone 0 -- has no entry and the arrays are one shorter than the
 * tree's node count.
 */
export interface EffectFrame {
  /** World-space translation per bone index, three floats. */
  t: [number, number, number][];
  /** `(rx, ry, rz)` BAMS per bone index. */
  r: [number, number, number][];
}

export interface Frame {
  root: [number, number, number];
  /** `(rx, ry, rz)` BAMS per bone, index 0 being the object root. */
  bones: [number, number, number][];
}

export class MotionBank {
  constructor(
    readonly name: string,
    readonly size: number,
    /** motion id -> byte offset of its block, from the file's own header. */
    readonly offsets: Map<number, number>,
    readonly raw: Uint8Array,
  ) {}

  /** The frame count a motion block declares in its first four bytes. */
  frameCount(motionId: number): number {
    const base = this.offsets.get(motionId);
    if (base === undefined || base + 4 > this.raw.length) return 0;
    return u32(this.raw, base);
  }

  /** The byte after the last one this motion's block owns. */
  private blockEnd(base: number): number {
    // `min(o for o in offsets if o > base)`, and the file length when there is
    // no later block. Deliberately not clamped to the file length: an offset
    // past the end is a damaged bank, and the reference implementation lets
    // the slice come up short rather than inventing a bound.
    let end: number | null = null;
    for (const o of this.offsets.values()) {
      if (o > base && (end === null || o < end)) end = o;
    }
    return end ?? this.raw.length;
  }

  /**
   * The bone count this block was authored for, from its own size.
   *
   * A block declares its frame count in its first four bytes and occupies
   * everything up to the next block, and `verify_mot.py` shows that
   * `frames * stride` accounts for that span exactly on all 1058 blocks. So
   * the stride is `span / frames`, and the bone count follows by inverting
   * {@link frameStride}.
   *
   * This is what makes "may this character play this motion" answerable
   * without a magic number: a motion belongs to the skeleton whose bone count
   * its own block size implies, and reading it at any other stride walks into
   * the next motion's data.
   */
  impliedBoneCount(motionId: number): number | null {
    const base = this.offsets.get(motionId);
    if (base === undefined) return null;
    const declared = this.frameCount(motionId);
    if (declared <= 0) return null;
    const start = base + 4;
    const span = this.blockEnd(base) - start;
    if (span <= 0 || span % declared) return null;
    const stride = span / declared;
    // `(b * 6 + 15) & ~3 == stride` -- at most one b can satisfy it, because
    // the step of 6 is wider than the 4 the mask rounds to.
    const lo = Math.floor((stride - 15) / 6);
    const hi = Math.floor((stride + 3) / 6);
    for (let b = lo; b <= hi; b++) {
      if (b > 0 && frameStride(b) === stride) return b;
    }
    return null;
  }

  /**
   * Decode a motion's frames for a given character's bone count.
   *
   * *count* defaults to as many whole frames as fit before the next motion
   * block (or the end of the file).
   */
  frames(motionId: number, boneCount: number,
         count: number | null = null): Frame[] {
    const base = this.offsets.get(motionId);
    if (base === undefined) return [];
    const stride = frameStride(boneCount);
    const start = base + 4;
    const end = this.blockEnd(base);
    let avail = Math.max(0, Math.floor((end - start) / stride));
    const declared = this.frameCount(motionId);
    if (declared > 0 && declared <= avail) avail = declared;
    const n = count === null ? avail : Math.min(count, avail);
    const out: Frame[] = [];
    for (let f = 0; f < n; f++) {
      const o = start + f * stride;
      const bones: [number, number, number][] = [];
      for (let b = 0; b < boneCount; b++) {
        const p = o + 12 + b * 6;
        bones.push([i16(this.raw, p), i16(this.raw, p + 2), i16(this.raw, p + 4)]);
      }
      out.push({ root: [f32(this.raw, o), f32(this.raw, o + 4),
                        f32(this.raw, o + 8)], bones });
    }
    return out;
  }

  /**
   * Decode a motion as an **effect**'s, at {@link effectFrameStride}.
   *
   * *nodeCount* is `g_effect_bone_counts[effect]` -- the tree's node count
   * including its root -- and the arrays come back one shorter than it, so
   * a node's key is `frame.t[node.bone - 1]`, exactly as `EffectPoseNode`
   * indexes them.
   */
  effectFrames(motionId: number, nodeCount: number,
               count: number | null = null): EffectFrame[] {
    const base = this.offsets.get(motionId);
    if (base === undefined || nodeCount < 2) return [];
    const stride = effectFrameStride(nodeCount);
    if (stride <= 0) return [];
    const bones = nodeCount - 1;
    const start = base + 4;
    const end = this.blockEnd(base);
    let avail = Math.max(0, Math.floor((end - start) / stride));
    const declared = this.frameCount(motionId);
    if (declared > 0 && declared <= avail) avail = declared;
    const n = count === null ? avail : Math.min(count, avail);
    const out: EffectFrame[] = [];
    for (let f = 0; f < n; f++) {
      const o = start + f * stride;
      const t: [number, number, number][] = [];
      const r: [number, number, number][] = [];
      for (let b = 0; b < bones; b++) {
        const q = o + b * 12;
        t.push([f32(this.raw, q), f32(this.raw, q + 4), f32(this.raw, q + 8)]);
      }
      // `base + stride*f - 8 + nodeCount*0xC`, which is `bones * 0xC` past
      // the frame's own start. The `-8` and the `+4` are the engine's, and
      // they cancel to exactly the end of the translations.
      for (let b = 0; b < bones; b++) {
        const q = o + bones * 12 + b * 6;
        r.push([i16(this.raw, q), i16(this.raw, q + 2), i16(this.raw, q + 4)]);
      }
      out.push({ t, r });
    }
    return out;
  }
}

/** Load one `mot/` bank and apply the header exactly as sub-step 2 does. */
export async function loadBank(source: AssetSource, name: string,
                               motionIds: Iterable<number>):
    Promise<MotionBank | null> {
  const path = `mot/${name}`;
  if (!await source.exists(path)) return null;
  const raw = await source.read(path);
  const ids = [...motionIds];
  if (raw.length < ids.length * 4) return null;
  const offs = i32s(raw, 0, ids.length);
  const map = new Map<number, number>();
  // `dict(zip(ids, offs))` -- a repeated id keeps the last offset.
  ids.forEach((id, i) => map.set(id, offs[i]));
  return new MotionBank(name, raw.length, map, raw);
}
