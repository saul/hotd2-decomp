"""
Texture descriptor tables extracted from Hod2.exe.

The tex/ files carry no metadata at all. Each bank's texture layout lives in a
table compiled into the executable's .rdata, and the game looks it up by bank
index:

    descriptor_table = *(u32 *)(0x0055B9B8 + bank_index * 4)
    descriptor       = descriptor_table + texture_id * 16

Reverse-engineered from FUN_00418E40 (bank setup) and FUN_004AC980 (per-model
texture binding); the decoder at FUN_004AC270 confirms the field meanings.

Descriptor, 16 bytes:

    +0x00  u16  width
    +0x02  u16  height
    +0x04  u8   pixel format   (0 ARGB1555, 1 RGB565, 2 ARGB4444)
    +0x05  u8   data layout    (PVR code: 1 twiddled, 3 VQ,
                                9 rectangle/linear, 13 twiddled rectangle)
    +0x06  u16  reserved
    +0x08  u32  byte offset into the texture bank
    +0x0C  u32  global texture slot id

A row of all zeros terminates the table.

This is authoritative and replaces the earlier prefix-sum guess, which could
not work: sizes are padded up to 2048-byte boundaries, and for VQ textures the
model's TSP size field is *half* the real dimensions (it describes the index
array, where each entry covers a 2x2 pixel block).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

__all__ = ["ExeTables", "TexEntry"]

BANK_PTR_TABLE = 0x0055B9B8
TEX_NAME_TABLE = 0x004D1410
IMAGE_BASE = 0x00400000
MAX_BANKS = 512

# PVR data layout codes
LAYOUT_TWIDDLED = 1
LAYOUT_VQ = 3
LAYOUT_RECTANGLE = 9
LAYOUT_TWIDDLED_RECT = 13


@dataclass(frozen=True)
class TexEntry:
    index: int
    width: int
    height: int
    pixfmt: int
    layout: int
    offset: int
    slot: int

    @property
    def vq(self) -> bool:
        return self.layout == LAYOUT_VQ

    @property
    def twiddled(self) -> bool:
        return self.layout in (LAYOUT_TWIDDLED, LAYOUT_TWIDDLED_RECT)


class ExeTables:
    """Reads the compiled-in texture descriptor tables out of Hod2.exe."""

    def __init__(self, exe_path: str | Path):
        self.data = Path(exe_path).read_bytes()
        self._sections = self._parse_sections()
        self._cache: dict[str, list[TexEntry]] = {}
        self.banks = self._parse_banks()

    # -- PE plumbing ----------------------------------------------------
    def _parse_sections(self):
        d = self.data
        pe = struct.unpack_from("<I", d, 0x3C)[0]
        nsec = struct.unpack_from("<H", d, pe + 6)[0]
        osz = struct.unpack_from("<H", d, pe + 20)[0]
        out = []
        off = pe + 24 + osz
        for _ in range(nsec):
            name = d[off : off + 8].rstrip(b"\0").decode("ascii", "replace")
            vs, va, rs, ra = struct.unpack_from("<IIII", d, off + 8)
            out.append((name, va, vs, ra, rs))
            off += 40
        return out

    def _v2r(self, va: int) -> int | None:
        for _, sva, vs, ra, rs in self._sections:
            lo = IMAGE_BASE + sva
            if lo <= va < lo + max(vs, rs):
                return ra + (va - lo)
        return None

    def _u32(self, va: int) -> int | None:
        r = self._v2r(va)
        if r is None or r + 4 > len(self.data):
            return None
        return struct.unpack_from("<I", self.data, r)[0]

    def _cstr(self, va: int) -> str | None:
        r = self._v2r(va)
        if r is None:
            return None
        end = self.data.find(b"\0", r)
        if end < 0 or end - r > 64:
            return None
        try:
            return self.data[r:end].decode("ascii")
        except UnicodeDecodeError:
            return None

    # -- tables ---------------------------------------------------------
    def _parse_banks(self) -> dict[str, int]:
        """bank name (without .bin) -> descriptor table VA."""
        banks: dict[str, int] = {}
        for i in range(MAX_BANKS):
            name_ptr = self._u32(TEX_NAME_TABLE + i * 4)
            desc_ptr = self._u32(BANK_PTR_TABLE + i * 4)
            if not name_ptr or not desc_ptr:
                continue
            name = self._cstr(name_ptr)
            if not name or not name.endswith(".bin"):
                continue
            banks.setdefault(name[:-4], desc_ptr)
        return banks

    def entries(self, bank: str) -> list[TexEntry]:
        """Descriptor list for a bank, or [] if the bank is unknown."""
        if bank in self._cache:
            return self._cache[bank]

        va = self.banks.get(bank)
        out: list[TexEntry] = []
        if va is not None:
            r = self._v2r(va)
            if r is not None:
                for i in range(4096):
                    o = r + i * 16
                    if o + 16 > len(self.data):
                        break
                    w, h = struct.unpack_from("<2H", self.data, o)
                    pf, lay = self.data[o + 4], self.data[o + 5]
                    off, slot = struct.unpack_from("<2I", self.data, o + 8)
                    if w == 0 and h == 0 and off == 0 and slot == 0:
                        break
                    if w == 0 or h == 0 or w > 4096 or h > 4096:
                        break
                    out.append(TexEntry(i, w, h, pf, lay, off, slot))
        self._cache[bank] = out
        return out
