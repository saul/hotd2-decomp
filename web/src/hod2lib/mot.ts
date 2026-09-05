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
