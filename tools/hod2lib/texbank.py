"""
HOTD2 texture banks.

See docs/formats/texbank.md.

A tex/ file is the raw PowerVR2 texture payloads concatenated in texture-ID
order, with no header, no padding and no alignment. All metadata -- width,
height, pixel format, VQ, twiddling -- lives in the *model* that references the
texture, in its TSP and texture_control words.

Empirically, across the whole game:
  * pixel formats are only RGB565, ARGB4444 and ARGB1555 (all 16-bit)
  * there are no palettised textures, so no palette data exists anywhere
  * there are no mipmaps
  * VQ and plain twiddled/linear layouts both occur
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

__all__ = ["TexDesc", "decode", "harvest_descriptors", "solve_layout", "Bank"]

VQ_CODEBOOK_BYTES = 2048  # 256 entries x 2x2 pixels x 2 bytes


@dataclass(frozen=True)
class TexDesc:
    """Everything needed to locate and decode one texture."""

    width: int
    height: int
    pixfmt: int
    vq: bool
    mipmap: bool
    twiddled: bool

    @classmethod
    def from_mesh(cls, mesh) -> "TexDesc":
        return cls(
            width=mesh.texture_width,
            height=mesh.texture_height,
            pixfmt=mesh.pixel_format,
            vq=mesh.vq_compressed,
            mipmap=mesh.mipmapped,
            twiddled=mesh.twiddled,
        )

    @property
    def size(self) -> int:
        """Bytes this texture occupies in the bank."""
        if self.vq:
            return VQ_CODEBOOK_BYTES + (self.width * self.height) // 4
        bpp = 4 if self.pixfmt == 5 else 8 if self.pixfmt == 6 else 16
        return (self.width * self.height * bpp) // 8


# --------------------------------------------------------------------------
# Pixel formats. All 16-bit little-endian; output is RGBA8888.
# --------------------------------------------------------------------------

def _argb1555(p: int) -> tuple[int, int, int, int]:
    a = 255 if (p >> 15) & 1 else 0
    r = ((p >> 10) & 0x1F) * 255 // 31
    g = ((p >> 5) & 0x1F) * 255 // 31
    b = (p & 0x1F) * 255 // 31
    return r, g, b, a


def _rgb565(p: int) -> tuple[int, int, int, int]:
    r = ((p >> 11) & 0x1F) * 255 // 31
    g = ((p >> 5) & 0x3F) * 255 // 63
    b = (p & 0x1F) * 255 // 31
    return r, g, b, 255


def _argb4444(p: int) -> tuple[int, int, int, int]:
    a = ((p >> 12) & 0xF) * 17
    r = ((p >> 8) & 0xF) * 17
    g = ((p >> 4) & 0xF) * 17
    b = (p & 0xF) * 17
    return r, g, b, a


_DECODERS = {0: _argb1555, 1: _rgb565, 2: _argb4444, 5: _argb1555, 6: _argb1555}


# --------------------------------------------------------------------------
# Twiddling (Morton order)
# --------------------------------------------------------------------------

def _morton(x: int, y: int) -> int:
    """Interleave bits: y at even positions, x at odd."""
    v = 0
    for i in range(16):
        v |= ((y >> i) & 1) << (2 * i)
        v |= ((x >> i) & 1) << (2 * i + 1)
    return v


def twiddled_index(x: int, y: int, w: int, h: int) -> int:
    """Index into twiddled data for pixel (x, y).

    Non-square textures are handled as a run of square blocks of side
    min(w, h), laid out linearly along the longer axis.
    """
    if w == h:
        return _morton(x, y)
    if w > h:
        return (x // h) * h * h + _morton(x % h, y)
    return (y // w) * w * w + _morton(x, y % w)


# --------------------------------------------------------------------------
# Decode
# --------------------------------------------------------------------------

def decode(data: bytes, off: int, d: TexDesc) -> bytearray:
    """Decode one texture to RGBA8888 (width*height*4 bytes)."""
    w, h = d.width, d.height
    conv = _DECODERS.get(d.pixfmt, _rgb565)
    out = bytearray(w * h * 4)

    if d.vq:
        # 2048-byte codebook of 256 entries, each a 2x2 pixel block.
        cb_end = off + VQ_CODEBOOK_BYTES
        book = struct.unpack_from("<1024H", data, off)
        idx = data[cb_end : cb_end + (w * h) // 4]

        bw, bh = w // 2, h // 2
        for by in range(bh):
            for bx in range(bw):
                # Index data is itself twiddled, at half resolution.
                i = idx[twiddled_index(bx, by, bw, bh)]
                blk = book[i * 4 : i * 4 + 4]
                # Column-major within the 2x2 block.
                for k, (dx, dy) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
                    px, py = bx * 2 + dx, by * 2 + dy
                    r, g, b, a = conv(blk[k])
                    o = (py * w + px) * 4
                    out[o : o + 4] = bytes((r, g, b, a))
        return out

    px16 = struct.unpack_from("<%dH" % (w * h), data, off)
    for y in range(h):
        for x in range(w):
            src = twiddled_index(x, y, w, h) if d.twiddled else y * w + x
            r, g, b, a = conv(px16[src])
            o = (y * w + x) * 4
            out[o : o + 4] = bytes((r, g, b, a))
    return out


# --------------------------------------------------------------------------
# Bank layout
# --------------------------------------------------------------------------

def harvest_descriptors(models) -> dict[int, TexDesc]:
    """Collect texture_id -> TexDesc from parsed models."""
    out: dict[int, TexDesc] = {}
    for m in models:
        for mesh in m.meshes:
            if mesh.texture_id >= 0:
                out.setdefault(mesh.texture_id, TexDesc.from_mesh(mesh))
    return out


@dataclass
class Bank:
    data: bytes
    descs: dict[int, TexDesc]
    offsets: dict[int, int]
    complete: bool
    residual: int

    def decode(self, tex_id: int) -> tuple[int, int, bytearray] | None:
        d = self.descs.get(tex_id)
        off = self.offsets.get(tex_id)
        if d is None or off is None:
            return None
        if off + d.size > len(self.data):
            return None
        return d.width, d.height, decode(self.data, off, d)


def bank_from_exe(data: bytes, entries) -> Bank:
    """Build a Bank from the authoritative descriptor table in Hod2.exe.

    Always prefer this over solve_layout: the exe carries exact offsets,
    dimensions and layout codes, whereas a prefix sum cannot reproduce the
    2048-byte padding or the VQ half-size convention.
    """
    descs: dict[int, TexDesc] = {}
    offsets: dict[int, int] = {}
    for e in entries:
        descs[e.index] = TexDesc(
            width=e.width, height=e.height, pixfmt=e.pixfmt,
            vq=e.vq, mipmap=False, twiddled=e.twiddled,
        )
        offsets[e.index] = e.offset

    used = 0
    if entries:
        last = max(entries, key=lambda e: e.offset)
        used = last.offset + descs[last.index].size
    return Bank(data, descs, offsets, used <= len(data), len(data) - used)


def solve_layout(data: bytes, descs: dict[int, TexDesc]) -> Bank:
    """Compute the byte offset of each texture in a bank.

    Textures are concatenated in ID order, so offsets are a prefix sum -- but
    only if every ID from 0..max is known. A gap (an ID present in the bank but
    referenced by no model we parsed) makes every later offset unknown.

    Returns a Bank with whatever could be resolved. ``complete`` is True when
    the prefix sum covers every ID and lands exactly on the file size.
    """
    if not descs:
        return Bank(data, descs, {}, False, len(data))

    top = max(descs)
    offsets: dict[int, int] = {}
    pos = 0
    ok = True
    for i in range(top + 1):
        d = descs.get(i)
        if d is None:
            ok = False
            break
        offsets[i] = pos
        pos += d.size

    residual = len(data) - pos
    complete = ok and residual == 0
    return Bank(data, descs, offsets, complete, residual)
