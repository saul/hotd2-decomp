"""
HOTD2 LZSS decompressor.

Clean-room reimplementation of the routine at 0x0040ACD0 in Hod2.exe.
See docs/formats/lz.md for the format specification.

Container form on disk:

    +0x000  u32   uncompressed size
    +0x004  ...   bitstream

The routine itself takes the bitstream only; ``decompress_file`` handles the
u32 header and verifies the result length against it.
"""

from __future__ import annotations

from collections import OrderedDict

__all__ = ["decompress", "decompress_file", "LZError"]


class LZError(Exception):
    """Malformed or truncated LZ stream."""


class _BitReader:
    """LSB-first bit reader over a byte stream.

    Flag bits and literal/match payload bytes share one stream: a payload byte
    is taken from the current read position, which may sit mid-flag-byte. The
    original loads a fresh flag byte only when the 8-bit budget is exhausted.
    """

    __slots__ = ("data", "pos", "_buf", "_cnt")

    def __init__(self, data: bytes, pos: int = 0):
        self.data = data
        self.pos = pos
        self._buf = 0
        self._cnt = 0  # bits remaining in _buf; forces a load on first read

    def bit(self) -> int:
        self._cnt -= 1
        if self._cnt < 0:
            if self.pos >= len(self.data):
                raise LZError("stream truncated while reading a flag bit")
            self._buf = self.data[self.pos]
            self.pos += 1
            self._cnt = 7
        b = self._buf & 1
        self._buf >>= 1
        return b

    def byte(self) -> int:
        if self.pos >= len(self.data):
            raise LZError("stream truncated while reading a byte")
        b = self.data[self.pos]
        self.pos += 1
        return b

    def u16(self) -> int:
        if self.pos + 1 >= len(self.data):
            raise LZError("stream truncated while reading a u16")
        v = self.data[self.pos] | (self.data[self.pos + 1] << 8)
        self.pos += 2
        return v


def decompress(src: bytes, pos: int = 0, expected: int | None = None) -> bytes:
    """Decompress a raw bitstream (no u32 size header).

    Grammar, one iteration of the outer loop:

        while flag bit == 1:            emit one literal byte
        flag bit == 0 -> a match follows:
            next bit == 1  ->  long form
                u16 w
                w == 0                  -> end of stream
                offset = (w >> 3) - 8192
                n = w & 7
                length = n + 2          if n != 0
                length = u8 + 1         if n == 0
            next bit == 0  ->  short form
                two bits, MSB first     -> n
                offset = u8 - 256
                length = n + 2

    Offsets are always negative, i.e. relative to the current output position.
    Matches are copied one byte at a time, so an offset of -1 is a legal run
    fill and overlapping copies are intentional.
    """
    r = _BitReader(src, pos)
    out = bytearray()

    while True:
        # Literal run.
        while r.bit():
            out.append(r.byte())

        if r.bit():
            # Long form: 13-bit offset, 3-bit length, optional extra length byte.
            w = r.u16()
            if w == 0:
                break  # end of stream
            offset = (w >> 3) - 0x2000
            n = w & 7
            length = n + 2 if n else r.byte() + 1
        else:
            # Short form: 2-bit length (MSB first), 8-bit offset.
            hi = r.bit()
            lo = r.bit()
            offset = r.byte() - 0x100
            length = ((hi << 1) | lo) + 2

        start = len(out) + offset
        if start < 0:
            raise LZError(
                f"match offset {offset} precedes output start at {len(out)}"
            )
        for i in range(length):
            out.append(out[start + i])

        if expected is not None and len(out) > expected:
            raise LZError(f"overrun: produced {len(out)} > expected {expected}")

    return bytes(out)


#: Decompressed files by their compressed bytes, most recently used last --
#: and the failures too, as their message. See `decompress_file`.
_CACHE: OrderedDict[bytes, bytes | str] = OrderedDict()
_CACHE_BYTES = 0
#: Enough for every file one check touches -- `verify_combat` reads 23 MB
#: from 123 files -- and a ceiling for a tool that reads the whole game once.
_CACHE_LIMIT = 256 * 1024 * 1024


def decompress_file(data: bytes) -> bytes:
    """Decompress a whole on-disk file, honouring the u32 size header.

    Raises LZError if the produced length does not match the header exactly.

    **Memoised on the input bytes.** It is a pure function of them, and the
    tools ask it the same question over and over: `verify_combat` made 3,060
    calls on 123 distinct files -- every stage it resolves loads the same
    character models, and `container.classify` trial-decompresses a file
    that `container.load` then decompresses again -- and spent 85% of its
    three minutes here. The key is the bytes themselves, not a path, so a
    cache hit is the same input by construction. A failed trial is kept as
    its message and raised again.
    """
    global _CACHE_BYTES
    if not isinstance(data, bytes):
        return _decompress_file(data)
    hit = _CACHE.get(data)
    if hit is not None:
        _CACHE.move_to_end(data)
        if isinstance(hit, str):
            raise LZError(hit)
        return hit
    try:
        out: bytes | str = _decompress_file(data)
    except LZError as e:
        # not-a-loss: kept as the entry and raised again just below, and on
        # every later call with the same bytes.
        out = str(e)
    _CACHE[data] = out
    _CACHE_BYTES += len(data) + len(out)
    while _CACHE_BYTES > _CACHE_LIMIT and len(_CACHE) > 1:
        k, v = _CACHE.popitem(last=False)
        _CACHE_BYTES -= len(k) + len(v)
    if isinstance(out, str):
        raise LZError(out)
    return out


def _decompress_file(data: bytes) -> bytes:
    if len(data) < 4:
        raise LZError("file too short to hold a size header")

    expected = int.from_bytes(data[:4], "little")
    if expected == 0:
        return b""

    out = decompress(data, 4, expected)
    if len(out) != expected:
        raise LZError(f"length mismatch: header says {expected}, produced {len(out)}")
    return out
