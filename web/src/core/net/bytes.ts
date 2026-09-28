/**
 * Bytes on the wire: a growable writer and a bounds-checked reader.
 *
 * Plain arithmetic rather than bit operators for the variable-length integers,
 * because JavaScript's bit operators truncate to 32 bits and a spawn address,
 * a frame count or a serial is allowed to be anything up to 2^53. Every value
 * the codec writes goes through one of these, so a reader that runs off the
 * end throws here rather than producing a zero that looks like data.
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** The largest integer the varints carry exactly. */
export const MAX_VARINT = Number.MAX_SAFE_INTEGER;

/**
 * The largest magnitude written as a zigzag varint. Zigzag doubles the value,
 * so anything past half of 2^53 would lose its low bit; those go as f64.
 */
export const MAX_ZIGZAG = 2 ** 51;

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  /** Bytes written so far. */
  length = 0;

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    const need = this.length + n;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  /** Start again, keeping the allocation. */
  reset(): void {
    this.length = 0;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
  }

  /** An unsigned integer in 0..2^53, seven bits a byte. */
  uvar(v: number): void {
    if (!(v >= 0 && v <= MAX_VARINT && Number.isInteger(v))) {
      throw new RangeError(`uvar out of range: ${v}`);
    }
    this.ensure(8);
    while (v >= 0x80) {
      this.buf[this.length++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.length++] = v;
  }

  /** A signed integer, zigzagged. `|v|` must not exceed {@link MAX_ZIGZAG}. */
  svar(v: number): void {
    this.uvar(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  str(s: string): void {
    // Most keys and names are ASCII; they go byte for byte.
    let ascii = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 0x7f) { ascii = false; break; }
    }
    if (ascii) {
      this.uvar(s.length);
      this.ensure(s.length);
      for (let i = 0; i < s.length; i++) this.buf[this.length++] = s.charCodeAt(i);
      return;
    }
    const bytes = ENCODER.encode(s);
    this.uvar(bytes.length);
    this.bytes(bytes);
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  /** A copy of what has been written. */
  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** Thrown by the reader for a truncated or malformed message. */
export class WireError extends Error {}

export class ByteReader {
  private readonly view: DataView;
  pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new WireError(`read past the end: ${n} at ${this.pos}/${this.buf.length}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  uvar(): number {
    let v = 0;
    let mult = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      v += (b & 0x7f) * mult;
      if (b < 0x80) return v;
      mult *= 0x80;
    }
    throw new WireError("varint too long");
  }

  svar(): number {
    const z = this.uvar();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }

  str(): string {
    const n = this.uvar();
    this.need(n);
    let ascii = n <= 64;
    for (let i = 0; ascii && i < n; i++) {
      if (this.buf[this.pos + i] > 0x7f) ascii = false;
    }
    let s: string;
    if (ascii) {
      s = "";
      // Short strings: a loop is faster than a decoder call and allocates less.
      for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.pos + i]);
    } else {
      s = DECODER.decode(this.buf.subarray(this.pos, this.pos + n));
    }
    this.pos += n;
    return s;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}
