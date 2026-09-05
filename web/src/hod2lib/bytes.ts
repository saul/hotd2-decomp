/**
 * What Python's `struct` gives the reference implementation for free.
 *
 * Every parser under `tools/hod2lib/` is `struct.unpack_from("<3f", b, off)`.
 * The game is x86 and there is no big-endian path in it, so everything here is
 * little-endian with no option to be otherwise — an endianness flag would only
 * ever be a way to get it wrong.
 *
 * `view()` caches one `DataView` per buffer. A `Uint8Array` that is a
 * subarray of another shares the buffer, so the cache is keyed on the buffer
 * and the byte offset is added at every read; building a fresh `DataView` per
 * field costs more than the reads do.
 */

const VIEWS = new WeakMap<ArrayBufferLike, DataView>();

function view(b: Uint8Array): DataView {
  let v = VIEWS.get(b.buffer);
  if (v === undefined || v.byteLength !== b.buffer.byteLength) {
    v = new DataView(b.buffer as ArrayBuffer);
    VIEWS.set(b.buffer, v);
  }
  return v;
}

export function u8(b: Uint8Array, off: number): number {
  return b[off];
}

export function i8(b: Uint8Array, off: number): number {
  return view(b).getInt8(b.byteOffset + off);
}

export function u16(b: Uint8Array, off: number): number {
  return view(b).getUint16(b.byteOffset + off, true);
}

export function i16(b: Uint8Array, off: number): number {
  return view(b).getInt16(b.byteOffset + off, true);
}

export function u32(b: Uint8Array, off: number): number {
  return view(b).getUint32(b.byteOffset + off, true);
}

export function i32(b: Uint8Array, off: number): number {
  return view(b).getInt32(b.byteOffset + off, true);
}

export function f32(b: Uint8Array, off: number): number {
  return view(b).getFloat32(b.byteOffset + off, true);
}

/** *n* consecutive u32s. `struct.unpack_from("<%dI" % n, b, off)`. */
export function u32s(b: Uint8Array, off: number, n: number): number[] {
  const v = view(b);
  const base = b.byteOffset + off;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = v.getUint32(base + i * 4, true);
  return out;
}

/** *n* consecutive i32s. */
export function i32s(b: Uint8Array, off: number, n: number): number[] {
  const v = view(b);
  const base = b.byteOffset + off;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt32(base + i * 4, true);
  return out;
}

/** *n* consecutive u16s. */
export function u16s(b: Uint8Array, off: number, n: number): number[] {
  const v = view(b);
  const base = b.byteOffset + off;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = v.getUint16(base + i * 2, true);
  return out;
}

/** *n* consecutive f32s. */
export function f32s(b: Uint8Array, off: number, n: number): number[] {
  const v = view(b);
  const base = b.byteOffset + off;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = v.getFloat32(base + i * 4, true);
  return out;
}

/**
 * The float a u32's bits spell. `struct.unpack("<f", struct.pack("<I", w))`.
 *
 * The event tables and the descriptor tables store floats as dwords and the
 * decoders reinterpret rather than convert; doing it by hand loses denormals
 * and NaN payloads, so it goes through a real buffer.
 */
const REINTERPRET = new DataView(new ArrayBuffer(4));

export function asF32(word: number): number {
  REINTERPRET.setUint32(0, word >>> 0, true);
  return REINTERPRET.getFloat32(0, true);
}

/** The u32 a float's bits spell. */
export function asU32(value: number): number {
  REINTERPRET.setFloat32(0, value, true);
  return REINTERPRET.getUint32(0, true);
}

/** Latin-1, which is what a fixed-width name field in these tables holds. */
export function latin1(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}

/** A NUL-terminated name, `b[off:b.index(0, off)].decode("latin-1")`. */
export function cstring(b: Uint8Array, off: number, max = 0x100): string {
  let end = off;
  const stop = Math.min(b.length, off + max);
  while (end < stop && b[end] !== 0) end++;
  return latin1(b, off, end - off);
}

/**
 * A growable little-endian byte writer.
 *
 * `gltf.py`'s `_Buf` appends packed structs into one `bytearray` and hands out
 * offsets; this is the same object. It doubles rather than reallocating per
 * append because a stage's buffer reaches 25 MB one vertex at a time.
 */
export class Writer {
  private buf: Uint8Array;
  private dv: DataView;
  /** Bytes written. This is the value callers use as an offset. */
  length = 0;

  constructor(capacity = 1 << 16) {
    this.buf = new Uint8Array(capacity);
    this.dv = new DataView(this.buf.buffer);
  }

  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.buf.subarray(0, this.length));
    this.buf = grown;
    this.dv = new DataView(grown.buffer);
  }

  u8(v: number): void { this.room(1); this.dv.setUint8(this.length, v); this.length += 1; }
  u16(v: number): void { this.room(2); this.dv.setUint16(this.length, v, true); this.length += 2; }
  u32(v: number): void { this.room(4); this.dv.setUint32(this.length, v >>> 0, true); this.length += 4; }
  i16(v: number): void { this.room(2); this.dv.setInt16(this.length, v, true); this.length += 2; }
  f32(v: number): void { this.room(4); this.dv.setFloat32(this.length, v, true); this.length += 4; }

  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  /** Pad to a multiple of *align* with *fill*. glTF wants 4, and 0x20 in JSON. */
  align(align: number, fill = 0): void {
    const pad = (align - (this.length % align)) % align;
    for (let i = 0; i < pad; i++) this.u8(fill);
  }

  /** The bytes written so far. A view, not a copy — do not keep writing. */
  view(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }

  take(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** UTF-8, for the glTF JSON chunk and for anything the sink writes as text. */
const ENCODER = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return ENCODER.encode(s);
}

const DECODER = new TextDecoder();

export function fromUtf8(b: Uint8Array): string {
  return DECODER.decode(b);
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** `int.from_bytes(b[:4], "little")` over a possibly-short buffer. */
export function u32le(b: Uint8Array, off = 0): number {
  return ((b[off] | (b[off + 1] << 8) | (b[off + 2] << 16)) >>> 0)
    + b[off + 3] * 0x1000000;
}
