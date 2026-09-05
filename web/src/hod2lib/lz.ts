/**
 * HOTD2 LZSS decompressor.
 *
 * A port of `tools/hod2lib/lz.py`, which is a clean-room reimplementation of
 * the routine at 0x0040ACD0 in Hod2.exe. See docs/formats/lz.md.
 *
 * Container form on disk:
 *
 *     +0x000  u32   uncompressed size
 *     +0x004  ...   bitstream
 *
 * The routine itself takes the bitstream only; {@link decompressFile} handles
 * the u32 header and verifies the result length against it.
 *
 * The output buffer is preallocated from that header where there is one. The
 * reference implementation appends to a `bytearray`, which amortises fine in
 * Python; here it is the difference between decompressing 80 MB of `pol/` and
 * decompressing it four times over, because every doubling copies.
 */

export class LZError extends Error {
  override name = "LZError";
}

/**
 * LSB-first bit reader over a byte stream.
 *
 * Flag bits and literal/match payload bytes share one stream: a payload byte
 * is taken from the current read position, which may sit mid-flag-byte. The
 * original loads a fresh flag byte only when the 8-bit budget is exhausted.
 */
class BitReader {
  private buf = 0;
  /** Bits remaining in {@link buf}; starts at 0 to force a load. */
  private cnt = 0;

  constructor(private readonly data: Uint8Array, public pos: number) {}

  bit(): number {
    this.cnt -= 1;
    if (this.cnt < 0) {
      if (this.pos >= this.data.length) {
        throw new LZError("stream truncated while reading a flag bit");
      }
      this.buf = this.data[this.pos];
      this.pos += 1;
      this.cnt = 7;
    }
    const b = this.buf & 1;
    this.buf >>= 1;
    return b;
  }

  byte(): number {
    if (this.pos >= this.data.length) {
      throw new LZError("stream truncated while reading a byte");
    }
    return this.data[this.pos++];
  }

  u16(): number {
    if (this.pos + 1 >= this.data.length) {
      throw new LZError("stream truncated while reading a u16");
    }
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
}

/**
 * Decompress a raw bitstream (no u32 size header).
 *
 * Grammar, one iteration of the outer loop:
 *
 *     while flag bit == 1:            emit one literal byte
 *     flag bit == 0 -> a match follows:
 *         next bit == 1  ->  long form
 *             u16 w
 *             w == 0                  -> end of stream
 *             offset = (w >> 3) - 8192
 *             n = w & 7
 *             length = n + 2          if n != 0
 *             length = u8 + 1         if n == 0
 *         next bit == 0  ->  short form
 *             two bits, MSB first     -> n
 *             offset = u8 - 256
 *             length = n + 2
 *
 * Offsets are always negative, i.e. relative to the current output position.
 * Matches are copied one byte at a time, so an offset of -1 is a legal run
 * fill and overlapping copies are intentional.
 */
export function decompress(src: Uint8Array, pos = 0,
                           expected: number | null = null): Uint8Array {
  const r = new BitReader(src, pos);
  let out = new Uint8Array(expected ?? Math.max(0x1000, src.length * 3));
  let n = 0;

  const room = (need: number): void => {
    if (n + need <= out.length) return;
    let cap = out.length * 2;
    while (cap < n + need) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(out.subarray(0, n));
    out = grown;
  };

  for (;;) {
    // Literal run.
    while (r.bit()) {
      room(1);
      out[n++] = r.byte();
    }

    let offset: number;
    let length: number;
    if (r.bit()) {
      // Long form: 13-bit offset, 3-bit length, optional extra length byte.
      const w = r.u16();
      if (w === 0) break;                                   // end of stream
      offset = (w >> 3) - 0x2000;
      const k = w & 7;
      length = k ? k + 2 : r.byte() + 1;
    } else {
      // Short form: 2-bit length (MSB first), 8-bit offset.
      const hi = r.bit();
      const lo = r.bit();
      offset = r.byte() - 0x100;
      length = ((hi << 1) | lo) + 2;
    }

    const start = n + offset;
    if (start < 0) {
      throw new LZError(
        `match offset ${offset} precedes output start at ${n}`);
    }
    room(length);
    for (let i = 0; i < length; i++) out[n + i] = out[start + i];
    n += length;

    if (expected !== null && n > expected) {
      throw new LZError(`overrun: produced ${n} > expected ${expected}`);
    }
  }

  return out.subarray(0, n);
}

/**
 * Decompress a whole on-disk file, honouring the u32 size header.
 *
 * Throws {@link LZError} if the produced length does not match the header
 * exactly.
 */
export function decompressFile(data: Uint8Array): Uint8Array {
  if (data.length < 4) throw new LZError("file too short to hold a size header");

  const expected = ((data[0] | (data[1] << 8) | (data[2] << 16)) >>> 0)
    + data[3] * 0x1000000;
  if (expected === 0) return new Uint8Array(0);

  const out = decompress(data, 4, expected);
  if (out.length !== expected) {
    throw new LZError(
      `length mismatch: header says ${expected}, produced ${out.length}`);
  }
  return out;
}
