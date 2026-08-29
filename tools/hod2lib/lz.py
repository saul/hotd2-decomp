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


def decompress_file(data: bytes) -> bytes:
    """Decompress a whole on-disk file, honouring the u32 size header.

    Raises LZError if the produced length does not match the header exactly.
    """
    if len(data) < 4:
        raise LZError("file too short to hold a size header")

    expected = int.from_bytes(data[:4], "little")
    if expected == 0:
        return b""

    out = decompress(data, 4, expected)
    if len(out) != expected:
        raise LZError(f"length mismatch: header says {expected}, produced {len(out)}")
    return out
