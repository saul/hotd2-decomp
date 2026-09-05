/**
 * HOTD2 pol/ and tex/ container. The port of `tools/hod2lib/container.py`.
 *
 * See docs/formats/container.md.
 *
 * A container is:
 *
 *     +0x000   u32[n]   offset table   (n = entry[0] / 4)
 *     +entry[0] ...      payload
 *
 * Entry 0 doubles as the table size: it is the byte offset where the payload
 * starts, so the table occupies exactly entry[0] bytes. The table is *not* a
 * fixed 0x800 -- that value simply happens to be common in the uncompressed
 * files. Compressed payloads carry a right-sized table (0x20, 0x120, ...).
 *
 * Remaining entries are start/end pairs delimiting each model.
 *
 * A file on disk is either this structure verbatim, or the same structure
 * LZ-compressed behind a u32 uncompressed-size header. Classification is done
 * by trial rather than by a magic value, because raw texture banks routinely
 * begin with pixel data whose first dword exceeds the file size.
 */

import { u32, u32s } from "./bytes";
import { LZError, decompressFile } from "./lz";

export const RAW = "raw";
export const COMPRESSED = "compressed";
export const BLOB = "blob";
export const EMPTY = "empty";
export const BMP = "bmp";

export type ContainerKind = "raw" | "compressed" | "blob" | "empty" | "bmp";

/** NL1 object header, see docs/formats/nl1.md. */
const NL1_MIN = 0x18;

function isNl1(b: Uint8Array, off: number): boolean {
  if (off + NL1_MIN > b.length) return false;
  const obj = u32(b, off);
  const flag = u32(b, off + 4);
  return (obj === 0 || obj === 1) && (flag & 1) !== 0 && (flag & ~0x1f) === 0;
}

/** True if *b* is a bare (already decompressed) container. */
export function isContainer(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const first = u32(b, 0);
  // The table must be a whole number of entries, land inside the file, and be
  // large enough to hold at least the entry that describes it.
  if (first < 8 || first % 4 || first >= b.length) return false;
  const entries = u32s(b, 0, first / 4);
  const used = entries.filter((e) => e !== 0);
  if (!used.length) return false;
  if (Math.max(...used) > b.length) return false;
  // Entries must be non-decreasing, and the payload must start with a model.
  for (let i = 1; i < used.length; i++) if (used[i] < used[i - 1]) return false;
  return isNl1(b, first);
}

/** A parsed pol/ or tex/ container. */
export interface Container {
  data: Uint8Array;
  kind: ContainerKind;
  table: number[];
  /** `[start, end)` per model, in file order. */
  models: [number, number][];
}

export function model(c: Container, i: number): Uint8Array {
  const [start, end] = c.models[i];
  return c.data.subarray(start, end);
}

/** Classify an on-disk file. Trial-based; see the module comment. */
export function classify(raw: Uint8Array): ContainerKind {
  if (raw.length < 8) return EMPTY as ContainerKind;
  if (raw[0] === 0x42 && raw[1] === 0x4d) return BMP as ContainerKind;
  if (isContainer(raw)) return RAW as ContainerKind;
  // Only attempt decompression when the header could plausibly be a size.
  if (u32(raw, 0) > raw.length) {
    try {
      decompressFile(raw);
      return COMPRESSED as ContainerKind;
    } catch (exc) {
      // not-a-loss: this *is* the classification. The header looked like a
      // plausible size, decompression says it was not one, so the blob is not
      // compressed -- which is what `BLOB` below reports.
      if (!(exc instanceof LZError)) throw exc;
    }
  }
  return BLOB as ContainerKind;
}

function parseTable(b: Uint8Array): { table: number[];
                                      models: [number, number][] } {
  const first = u32(b, 0);
  const table = u32s(b, 0, first / 4);
  const used = table.filter((e) => e !== 0);

  // Entries form start/end pairs after the leading data-start marker.
  const models: [number, number][] = [];
  const bounds = [...new Set(used)].sort((a, c) => a - c);
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end > start && isNl1(b, start)) models.push([start, end]);
  }
  return { table, models };
}

/** Parse an on-disk file, decompressing transparently if needed. */
export function load(raw: Uint8Array): Container {
  const kind = classify(raw);
  if (kind === COMPRESSED) {
    const body = decompressFile(raw);
    // A decompressed payload is not necessarily a container: tex/ banks
    // decompress to bare texture data with no offset table.
    if (isContainer(body)) {
      const { table, models } = parseTable(body);
      return { data: body, kind, table, models };
    }
    return { data: body, kind, table: [], models: [] };
  }
  if (kind === RAW) {
    const { table, models } = parseTable(raw);
    return { data: raw, kind, table, models };
  }
  return { data: raw, kind, table: [], models: [] };
}
