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
 *
 * **That header is not trusted input.** `container.classify` decompresses on
 * spec to find out whether a blob is compressed at all, so this routine is
 * handed 865 of the game's files whose first dword merely looks like a size --
 * up to 4.03 GB of it in `tex/st5_01b.bin`. See {@link maxOutput}.
 */

export class LZError extends Error {
  override name = "LZError";
}

/**
 * The most output the grammar can produce from *n* bytes of stream.
 *
 * The cheapest 256 bytes of output is a long-form match with a zero length
 * field: two flag bits, a u16 and a length byte, so 3.25 bytes in for 256
 * out, and nothing in the grammar beats 78.8x. The highest ratio any file in
 * the game actually reaches is 25.4x, in `tex/scr_tv.bin`.
 *
 * A size header above this is arithmetically impossible, so saying so is a
 * classification and not a guess -- which is exactly what the caller wants,
 * because `container.classify` is asking whether the blob is compressed at
 * all. Without it the answer came from *trying*, and trying meant allocating
 * whatever the first dword said. Node hands over a 4 GB buffer and the LZ
 * then fails, which is why the CLI never noticed; a browser refuses, and a
 * `RangeError` is not an `LZError`, so it escaped the trial's catch and
 * killed the whole export at the first raw texture bank.
 */
function maxOutput(n: number): number {
  return n * 80 + 0x100;
}

/**
 * Cap on the *first* allocation. `room` grows past it as needed.
 *
 * Belt and braces beside {@link maxOutput}: a large enough blob can carry a
 * garbage header that is still under the arithmetic bound, and nothing should
 * commit hundreds of megabytes before a single byte has been decoded. The
 * biggest file in the game decompresses to 21 MB, so no real file ever grows.
 */
const FIRST_ALLOC = 32 << 20;

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
  if (expected !== null && expected > maxOutput(Math.max(0, src.length - pos))) {
    throw new LZError(
      `header claims ${expected} bytes from ${src.length - pos} of stream, `
      + "which the grammar cannot produce; this is not a compressed file");
  }
  const r = new BitReader(src, pos);
  let out = new Uint8Array(Math.min(
    expected ?? Math.max(0x1000, src.length * 3), FIRST_ALLOC));
  let n = 0;

  const room = (need: number): void => {
    if (n + need <= out.length) return;
    let cap = Math.max(0x1000, out.length * 2);
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
