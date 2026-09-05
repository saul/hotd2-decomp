/**
 * HOTD2 texture banks. The port of `tools/hod2lib/texbank.py`.
 *
 * See docs/formats/texbank.md.
 *
 * A tex/ file is the raw PowerVR2 texture payloads concatenated in texture-ID
 * order, with no header, no padding and no alignment. All metadata -- width,
 * height, pixel format, VQ, twiddling -- lives in the *model* that references
 * the texture, in its TSP and texture_control words.
 *
 * Empirically, across the whole game:
 *   * pixel formats are only RGB565, ARGB4444 and ARGB1555 (all 16-bit)
 *   * there are no palettised textures, so no palette data exists anywhere
 *   * there are no mipmaps
 *   * VQ and plain twiddled/linear layouts both occur
 */

import { u16s } from "./bytes";
import type { Mesh, Model } from "./nl1";

/** 256 entries x 2x2 pixels x 2 bytes. */
export const VQ_CODEBOOK_BYTES = 2048;

/** Everything needed to locate and decode one texture. */
export interface TexDesc {
  width: number;
  height: number;
  pixfmt: number;
  vq: boolean;
  mipmap: boolean;
  twiddled: boolean;
}

export function descFromMesh(mesh: Mesh): TexDesc {
  return {
    width: mesh.textureWidth,
    height: mesh.textureHeight,
    pixfmt: mesh.pixelFormat,
    vq: mesh.vqCompressed,
    mipmap: mesh.mipmapped,
    twiddled: mesh.twiddled,
  };
}

/** Bytes this texture occupies in the bank. */
export function descSize(d: TexDesc): number {
  if (d.vq) return VQ_CODEBOOK_BYTES + Math.floor((d.width * d.height) / 4);
  const bpp = d.pixfmt === 5 ? 4 : d.pixfmt === 6 ? 8 : 16;
  return Math.floor((d.width * d.height * bpp) / 8);
}

// ---------------------------------------------------------------------------
// Pixel formats. All 16-bit little-endian; output is RGBA8888.
// ---------------------------------------------------------------------------

/**
 * Each decoder writes four bytes into *out* rather than returning a tuple.
 *
 * The reference implementation returns `(r, g, b, a)` and the caller unpacks
 * it. That is one tuple allocation per pixel, and a stage decodes about
 * seventeen million of them.
 */
type Decoder = (p: number, out: Uint8Array, o: number) => void;

const argb1555: Decoder = (p, out, o) => {
  out[o] = (((p >> 10) & 0x1f) * 255 / 31) | 0;
  out[o + 1] = (((p >> 5) & 0x1f) * 255 / 31) | 0;
  out[o + 2] = ((p & 0x1f) * 255 / 31) | 0;
  out[o + 3] = (p >> 15) & 1 ? 255 : 0;
};

const rgb565: Decoder = (p, out, o) => {
  out[o] = (((p >> 11) & 0x1f) * 255 / 31) | 0;
  out[o + 1] = (((p >> 5) & 0x3f) * 255 / 63) | 0;
  out[o + 2] = ((p & 0x1f) * 255 / 31) | 0;
  out[o + 3] = 255;
};

const argb4444: Decoder = (p, out, o) => {
  out[o] = ((p >> 8) & 0xf) * 17;
  out[o + 1] = ((p >> 4) & 0xf) * 17;
  out[o + 2] = (p & 0xf) * 17;
  out[o + 3] = ((p >> 12) & 0xf) * 17;
};

const DECODERS: Record<number, Decoder> = {
  0: argb1555, 1: rgb565, 2: argb4444, 5: argb1555, 6: argb1555,
};

// ---------------------------------------------------------------------------
// Twiddling (Morton order)
// ---------------------------------------------------------------------------

/**
 * `spread[v]` is *v* with its bits moved to the even positions.
 *
 * The reference implementation interleaves in a sixteen-iteration loop per
 * pixel. A texture is up to 1024x1024 and a stage has 1,730 of them, so the
 * loop is the decode; a table of 1024 entries is the same arithmetic done
 * once. The largest texture dimension in the game is 1024, and
 * {@link morton} asserts nothing beyond that because a wider one would index
 * past the end of a bank long before it produced a wrong pixel.
 */
const SPREAD = (() => {
  const t = new Uint32Array(1024);
  for (let v = 0; v < 1024; v++) {
    let s = 0;
    for (let i = 0; i < 10; i++) s |= ((v >> i) & 1) << (2 * i);
    t[v] = s;
  }
  return t;
})();

/** Interleave bits: y at even positions, x at odd. */
export function morton(x: number, y: number): number {
  return SPREAD[y] | (SPREAD[x] << 1);
}

/**
 * Index into twiddled data for pixel (x, y).
 *
 * Non-square textures are handled as a run of square blocks of side
 * min(w, h), laid out linearly along the longer axis.
 */
export function twiddledIndex(x: number, y: number, w: number,
                              h: number): number {
  if (w === h) return morton(x, y);
  if (w > h) return Math.floor(x / h) * h * h + morton(x % h, y);
  return Math.floor(y / w) * w * w + morton(x, y % w);
}

/** Decode one texture to RGBA8888 (`width * height * 4` bytes). */
export function decode(data: Uint8Array, off: number,
                       d: TexDesc): Uint8Array {
  const w = d.width, h = d.height;
  const conv = DECODERS[d.pixfmt] ?? rgb565;
  const out = new Uint8Array(w * h * 4);

  if (d.vq) {
    // 2048-byte codebook of 256 entries, each a 2x2 pixel block.
    const cbEnd = off + VQ_CODEBOOK_BYTES;
    const book = u16s(data, off, 1024);
    const idx = data.subarray(cbEnd, cbEnd + Math.floor((w * h) / 4));

    const bw = w >> 1, bh = h >> 1;
    // Column-major within the 2x2 block.
    const DX = [0, 0, 1, 1];
    const DY = [0, 1, 0, 1];
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        // Index data is itself twiddled, at half resolution.
        const i = idx[twiddledIndex(bx, by, bw, bh)];
        for (let k = 0; k < 4; k++) {
          const px = bx * 2 + DX[k];
          const py = by * 2 + DY[k];
          conv(book[i * 4 + k], out, (py * w + px) * 4);
        }
      }
    }
    return out;
  }

  const px16 = u16s(data, off, w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = d.twiddled ? twiddledIndex(x, y, w, h) : y * w + x;
      conv(px16[src], out, (y * w + x) * 4);
    }
  }
  return out;
}

/** Collect `textureId -> TexDesc` from parsed models. */
export function harvestDescriptors(models: Model[]): Map<number, TexDesc> {
  const out = new Map<number, TexDesc>();
  for (const m of models) {
    for (const mesh of m.meshes) {
      if (mesh.textureId >= 0 && !out.has(mesh.textureId)) {
        out.set(mesh.textureId, descFromMesh(mesh));
      }
    }
  }
  return out;
}

export interface Bank {
  data: Uint8Array;
  descs: Map<number, TexDesc>;
  offsets: Map<number, number>;
  complete: boolean;
  residual: number;
}

export function bankDecode(bank: Bank, texId: number):
    { width: number; height: number; pixels: Uint8Array } | null {
  const d = bank.descs.get(texId);
  const off = bank.offsets.get(texId);
  if (d === undefined || off === undefined) return null;
  if (off + descSize(d) > bank.data.length) return null;
  return { width: d.width, height: d.height,
           pixels: decode(bank.data, off, d) };
}

/** One entry of the exe's texture descriptor table. See `exetab`. */
export interface TexEntryLike {
  index: number;
  offset: number;
  width: number;
  height: number;
  pixfmt: number;
  vq: boolean;
  twiddled: boolean;
}

/**
 * Build a {@link Bank} from the authoritative descriptor table in Hod2.exe.
 *
 * Always prefer this over {@link solveLayout}: the exe carries exact offsets,
 * dimensions and layout codes, whereas a prefix sum cannot reproduce the
 * 2048-byte padding or the VQ half-size convention.
 */
export function bankFromExe(data: Uint8Array,
                            entries: readonly TexEntryLike[]): Bank {
  const descs = new Map<number, TexDesc>();
  const offsets = new Map<number, number>();
  for (const e of entries) {
    descs.set(e.index, {
      width: e.width, height: e.height, pixfmt: e.pixfmt,
      vq: e.vq, mipmap: false, twiddled: e.twiddled,
    });
    offsets.set(e.index, e.offset);
  }

  let used = 0;
  if (entries.length) {
    // `max(entries, key=...)` keeps the first of a tie; so does this.
    let last = entries[0];
    for (const e of entries) if (e.offset > last.offset) last = e;
    used = last.offset + descSize(descs.get(last.index)!);
  }
  return { data, descs, offsets, complete: used <= data.length,
           residual: data.length - used };
}

/**
 * Compute the byte offset of each texture in a bank.
 *
 * Textures are concatenated in ID order, so offsets are a prefix sum -- but
 * only if every ID from 0..max is known. A gap (an ID present in the bank but
 * referenced by no model we parsed) makes every later offset unknown.
 *
 * Returns a bank with whatever could be resolved. `complete` is true when the
 * prefix sum covers every ID and lands exactly on the file size.
 */
export function solveLayout(data: Uint8Array,
                            descs: Map<number, TexDesc>): Bank {
  if (descs.size === 0) {
    return { data, descs, offsets: new Map(), complete: false,
             residual: data.length };
  }

  const top = Math.max(...descs.keys());
  const offsets = new Map<number, number>();
  let pos = 0;
  let ok = true;
  for (let i = 0; i <= top; i++) {
    const d = descs.get(i);
    if (d === undefined) { ok = false; break; }
    offsets.set(i, pos);
    pos += descSize(d);
  }

  const residual = data.length - pos;
  return { data, descs, offsets, complete: ok && residual === 0, residual };
}
