/**
 * Minimal PNG writer, the port of `tools/hod2lib/png.py`.
 *
 * Python has `zlib` in the standard library and this package cannot: node's
 * deflate and a browser's are different objects with different defaults, so
 * the compressor arrives as a {@link Deflate} and everything here is async.
 * That is the only structural change from the reference implementation.
 *
 * Node's `zlib.deflateSync(buf, {level: 6})` is the same zlib Python calls and
 * produces the same bytes, so a CLI export is byte-identical. A browser's
 * `CompressionStream("deflate")` picks its own level and may not be; the
 * pixels are identical either way, which is the guarantee docs/TS_PORT.md
 * makes and the property `tools/compare_bundles.py` asserts.
 */

import { Writer, utf8 } from "./bytes";
import type { Deflate } from "./io";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** `zlib.crc32`, which PNG uses for every chunk. */
export function crc32(data: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = (CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(w: Writer, tag: string, data: Uint8Array): void {
  const t = utf8(tag);
  const body = new Uint8Array(t.length + data.length);
  body.set(t);
  body.set(data, t.length);
  // Length is big-endian in PNG, which is the one place in this repository
  // that is not little-endian.
  w.u8((data.length >>> 24) & 0xff);
  w.u8((data.length >>> 16) & 0xff);
  w.u8((data.length >>> 8) & 0xff);
  w.u8(data.length & 0xff);
  w.bytes(body);
  const c = crc32(body);
  w.u8((c >>> 24) & 0xff);
  w.u8((c >>> 16) & 0xff);
  w.u8((c >>> 8) & 0xff);
  w.u8(c & 0xff);
}

/**
 * Encode RGBA8888 pixel data (`length === width * height * 4`) as a PNG.
 *
 * Filter type 0 on every row, like the reference implementation: the textures
 * are small, the result is embedded in a GLB that nothing re-compresses, and
 * an adaptive filter would be a second thing to keep byte-identical.
 */
export async function encodeRgba(width: number, height: number,
                                 pixels: Uint8Array,
                                 deflate: Deflate): Promise<Uint8Array> {
  if (pixels.length !== width * height * 4) {
    throw new Error(
      `expected ${width * height * 4} bytes, got ${pixels.length}`);
  }

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter type: none
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const w = new Writer(raw.length + 0x100);
  w.bytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const ihdr = new Writer(13);
  ihdr.u8((width >>> 24) & 0xff); ihdr.u8((width >>> 16) & 0xff);
  ihdr.u8((width >>> 8) & 0xff); ihdr.u8(width & 0xff);
  ihdr.u8((height >>> 24) & 0xff); ihdr.u8((height >>> 16) & 0xff);
  ihdr.u8((height >>> 8) & 0xff); ihdr.u8(height & 0xff);
  ihdr.u8(8); ihdr.u8(6); ihdr.u8(0); ihdr.u8(0); ihdr.u8(0);
  chunk(w, "IHDR", ihdr.view());

  chunk(w, "IDAT", await deflate(raw, 6));
  chunk(w, "IEND", new Uint8Array(0));
  return w.take();
}
