"""Minimal PNG writer. Stdlib only -- no PIL dependency."""

from __future__ import annotations

import struct
import zlib

__all__ = ["write_rgba"]


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_rgba(path, width: int, height: int, pixels: bytes | bytearray) -> None:
    """Write RGBA8888 pixel data (len == width*height*4) as a PNG."""
    if len(pixels) != width * height * 4:
        raise ValueError(
            f"expected {width * height * 4} bytes, got {len(pixels)}")

    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type: none
        raw += pixels[y * stride : (y + 1) * stride]

    out = b"\x89PNG\r\n\x1a\n"
    out += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    out += _chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    out += _chunk(b"IEND", b"")

    with open(path, "wb") as fh:
        fh.write(out)
