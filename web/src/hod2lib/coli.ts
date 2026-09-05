/**
 * `coli/` collision meshes. The port of `tools/hod2lib/coli.py`.
 *
 * The format is stated outright by the hit test, `ColiSegmentVsMesh`
 * (`0x004AAA40`), so none of it is inferred from the bytes:
 *
 *     blob:
 *         u32  group_count                 (always 1 in shipped data)
 *         repeat group_count:
 *             u32  quad_count
 *             f32  aabb_max[3]             <- MAX first, see below
 *             f32  aabb_min[3]
 *             repeat quad_count:           18 dwords = 72 bytes
 *                 f32  nx, ny, nz, d       plane
 *                 u32  axis                dominant axis: 0 = X, 1 = Y, 2 = Z
 *                 f32  v0[3] v1[3] v2[3] v3[3]
 *                 u32  surface             surface material id
 *
 * A file is a flat sequence of blobs packed end to end -- no header, no offset
 * table, no padding, and nothing marking the end.
 *
 * Two details that are obvious from the code and would be very hard to guess:
 *
 * **The AABB is stored max-then-min.** The reject test reads
 * `seg_min.x <= box[1] && ... && box[4] <= seg_max.x`, so `box[1..3]` is the
 * upper corner and `box[4..6]` the lower one. Reading it the natural way gives
 * an inverted box that rejects everything.
 *
 * **`axis` is an integer in a float slot.** The decompiler compares it against
 * 1.4013e-45 and 2.8026e-45, which are the bit patterns of the integers 1 and
 * 2. It selects which two components the point-in-quad test runs in.
 *
 * Full specification and the validation results: docs/formats/coli.md.
 */

import { f32s, u32 } from "./bytes";
import * as degraded from "./degraded";
import type { AssetSource } from "./io";

export const GROUP_HEADER = 28;    // u32 quad_count + f32 max[3] + f32 min[3]
export const QUAD = 72;            // 18 dwords

/** `ColiLoadForScene`'s two fixed load addresses. */
export const BUF_COMMON = 0x0098f200;   // coli0.bin, loaded for every scene
export const BUF_SCENE = 0x00990a00;    // coli<scene+1>.bin

/**
 * The evt relocation, mirrored from `evt` so a caller can resolve an
 * opcode-0x10/0x11 operand without importing the evt module.
 */
const RELOC_MASK = 0xfff80000;
const RELOC_TAG = 0x0ce80000;
const RELOC_SUB = 0x0c53e600;

/**
 * Surface ids that select the "wet" impact effect and splash sound. Confirmed
 * by two independent consumers: FUN_00456B70 spawns effect asset 0x61 with two
 * extra ripple calls instead of 0x46, and FUN_0040A230 plays sound 0x4416A9
 * instead of 0x2616A9 for a bouncing dropped object.
 */
export const WET_SURFACES = [5, 55];

/** Dominant-axis tag -> the two components the point-in-quad test uses. */
export const AXIS_COMPONENTS: Record<number, [string, string]> = {
  0: ["y", "z"], 1: ["x", "z"], 2: ["x", "y"],
};

export type Vec3 = [number, number, number];

export class ColiError extends Error {
  override name = "ColiError";
}

export interface Quad {
  offset: number;
  normal: Vec3;
  planeD: number;
  axis: number;
  verts: [Vec3, Vec3, Vec3, Vec3];
  surface: number;
}

export function wet(q: Quad): boolean {
  return WET_SURFACES.includes(q.surface);
}

/**
 * Worst `|n.v + d|` over the four vertices.
 *
 * Should be ~0: the stored plane is the plane of the stored vertices. A
 * non-trivial value means the record has been misread.
 */
export function planeError(q: Quad): number {
  let worst = 0;
  for (const v of q.verts) {
    const e = Math.abs(q.normal[0] * v[0] + q.normal[1] * v[1]
                       + q.normal[2] * v[2] + q.planeD);
    if (e > worst) worst = e;
  }
  return worst;
}

export interface Group {
  offset: number;
  aabbMin: Vec3;
  aabbMax: Vec3;
  quads: Quad[];
}

/** One `[group_count][groups...]` unit -- what an evt pointer names. */
export interface Blob {
  offset: number;
  groups: Group[];
}

export function blobQuads(b: Blob): Quad[] {
  return b.groups.flatMap((g) => g.quads);
}

export class ColiFile {
  blobs: Blob[] = [];
  consumed = 0;

  constructor(readonly name: string, readonly raw: Uint8Array) {}

  get coverage(): number {
    return this.raw.length ? this.consumed / this.raw.length : 0.0;
  }

  get blobStarts(): Set<number> {
    return new Set(this.blobs.map((b) => b.offset));
  }

  get quads(): Quad[] {
    return this.blobs.flatMap(blobQuads);
  }
}

function parseBlob(b: Uint8Array, off: number): [Blob, number] {
  const ngroups = u32(b, off);
  const blob: Blob = { offset: off, groups: [] };
  let p = off + 4;
  for (let gi = 0; gi < ngroups; gi++) {
    if (p + GROUP_HEADER > b.length) {
      throw new ColiError(`group header past EOF at 0x${p.toString(16)}`);
    }
    const nquads = u32(b, p);
    const hi = f32s(b, p + 4, 3) as Vec3;         // MAX first
    const lo = f32s(b, p + 16, 3) as Vec3;
    if (p + GROUP_HEADER + nquads * QUAD > b.length) {
      throw new ColiError(
        `group at 0x${p.toString(16)} declares ${nquads} quads past EOF`);
    }
    const g: Group = { offset: p, aabbMin: lo, aabbMax: hi, quads: [] };
    let q = p + GROUP_HEADER;
    for (let k = 0; k < nquads; k++) {
      g.quads.push({
        offset: q,
        normal: f32s(b, q, 3) as Vec3,
        planeD: f32s(b, q + 12, 1)[0],
        axis: u32(b, q + 16),
        verts: [0, 1, 2, 3].map((j) => f32s(b, q + 20 + 12 * j, 3)) as
          [Vec3, Vec3, Vec3, Vec3],
        surface: u32(b, q + 68),
      });
      q += QUAD;
    }
    blob.groups.push(g);
    p = q;
  }
  return [blob, p];
}

/**
 * Parse a whole coli file into its sequence of blobs.
 *
 * Stops at the first record that cannot be a blob rather than throwing, so a
 * caller can see how far the walk got: `coverage` is 1.0 for every file the
 * game actually loads, and a wrong stride shows up immediately as a short walk.
 */
export async function load(source: AssetSource, path: string,
                           name: string): Promise<ColiFile> {
  const b = await source.read(path);
  const f = new ColiFile(name, b);
  let off = 0;
  while (off < b.length) {
    let parsed: [Blob, number];
    try {
      parsed = parseBlob(b, off);
    } catch (exc) {
      // Stopping is right; `consumed` and `coverage` record where. But only
      // `verify_coli.py` ever looked at them, and it runs over the game
      // directory rather than over an export -- so on the *export* path a file
      // that stopped a third of the way through went into the bundle a third
      // complete, with nothing said. The wall the player walks through is the
      // same shape either way.
      degraded.note("hod2lib.coli.load",
                    `${f.name} past 0x${off.toString(16)}`,
                    `${Math.floor(100 * off / Math.max(1, b.length))}% of its `
                    + "collision blobs", exc);
      break;
    }
    const [blob, end] = parsed;
    if (end <= off) break;
    f.blobs.push(blob);
    off = end;
  }
  f.consumed = off;
  return f;
}

/**
 * The two files `ColiLoadForScene` loads for *scene* (0-based).
 *
 * Returns `[common, perScene]`. The loader guards `0 <= scene < 7`.
 */
export function sceneFiles(scene: number): [string, string] {
  if (!(scene >= 0 && scene < 7)) {
    throw new ColiError(`scene ${scene} is outside the loader's 0..6 range`);
  }
  return ["coli0.bin", `coli${scene + 1}.bin`];
}

/**
 * An evt 0x10/0x11 operand -> the runtime address it names.
 *
 * The operand is stored unrelocated in the file; the evt loader's fixup pass
 * subtracts 0x0C53E600 from any dword in 0x0CE80000..0x0CEFFFFF.
 */
export function resolvePointer(operand: number): number {
  if ((operand & RELOC_MASK) >>> 0 === RELOC_TAG) return operand - RELOC_SUB;
  return operand;
}

/**
 * Resolve an evt collision-set pointer to `[file name, blob offset]`.
 *
 * Returns null if it does not land on a blob header of either file, which is
 * what a wrong reading looks like -- across the shipped scripts all 86 of them
 * resolve.
 */
export function pointerToOffset(operand: number, common: ColiFile,
                                perScene: ColiFile): [string, number] | null {
  const addr = resolvePointer(operand);
  for (const [base, f] of [[BUF_COMMON, common], [BUF_SCENE, perScene]] as
       [number, ColiFile][]) {
    const off = addr - base;
    if (f.blobStarts.has(off)) return [f.name, off];
  }
  return null;
}
