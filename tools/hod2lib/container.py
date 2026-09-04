"""
HOTD2 pol/ and tex/ container.

See docs/formats/container.md.

A container is::

    +0x000   u32[n]   offset table   (n = entry[0] / 4)
    +entry[0] ...      payload

Entry 0 doubles as the table size: it is the byte offset where the payload
starts, so the table occupies exactly entry[0] bytes. The table is *not* a
fixed 0x800 -- that value simply happens to be common in the uncompressed
files. Compressed payloads carry a right-sized table (0x20, 0x120, ...).

Remaining entries are start/end pairs delimiting each model.

A file on disk is either this structure verbatim, or the same structure
LZ-compressed behind a u32 uncompressed-size header. Classification is done by
trial rather than by a magic value, because raw texture banks routinely begin
with pixel data whose first dword exceeds the file size.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from .lz import LZError, decompress_file

__all__ = ["Container", "classify", "load", "RAW", "COMPRESSED", "BLOB", "EMPTY", "BMP"]

RAW = "raw"
COMPRESSED = "compressed"
BLOB = "blob"
EMPTY = "empty"
BMP = "bmp"

# NL1 object header, see docs/formats/nl1.md
NL1_MIN = 0x18


def _is_nl1(b: bytes, off: int) -> bool:
    if off + NL1_MIN > len(b):
        return False
    obj, flag = struct.unpack_from("<2I", b, off)
    return obj in (0, 1) and bool(flag & 1) and not (flag & ~0x1F)


def is_container(b: bytes) -> bool:
    """True if b is a bare (already decompressed) container."""
    if len(b) < 12:
        return False
    first = struct.unpack_from("<I", b, 0)[0]
    # Table must be a whole number of entries, land inside the file, and be
    # large enough to hold at least the entry that describes it.
    if first < 8 or first % 4 or first >= len(b):
        return False
    entries = list(struct.unpack_from("<%dI" % (first // 4), b, 0))
    used = [e for e in entries if e]
    if not used:
        return False
    if max(used) > len(b):
        return False
    # Entries must be non-decreasing, and the payload must start with a model.
    if used != sorted(used):
        return False
    return _is_nl1(b, first)


@dataclass
class Container:
    """A parsed pol/ or tex/ container."""

    data: bytes
    kind: str
    table: list[int] = field(default_factory=list)
    models: list[tuple[int, int]] = field(default_factory=list)

    @property
    def model_count(self) -> int:
        return len(self.models)

    def model(self, i: int) -> bytes:
        start, end = self.models[i]
        return self.data[start:end]


def classify(raw: bytes) -> str:
    """Classify an on-disk file. Trial-based; see module docstring."""
    if len(raw) < 8:
        return EMPTY
    if raw[:2] == b"BM":
        return BMP
    if is_container(raw):
        return RAW
    # Only attempt decompression when the header could plausibly be a size.
    if struct.unpack_from("<I", raw, 0)[0] > len(raw):
        try:
            decompress_file(raw)
            return COMPRESSED
        except LZError:
            # not-a-loss: this *is* the classification. The header looked like
            # a plausible size, decompression says it was not one, so the blob
            # is not compressed -- which is what `BLOB` below reports.
            pass
    return BLOB


def _parse_table(b: bytes) -> tuple[list[int], list[tuple[int, int]]]:
    first = struct.unpack_from("<I", b, 0)[0]
    table = list(struct.unpack_from("<%dI" % (first // 4), b, 0))
    used = [e for e in table if e]

    # Entries form start/end pairs after the leading data-start marker.
    models: list[tuple[int, int]] = []
    bounds = sorted(set(used))
    for start, end in zip(bounds, bounds[1:]):
        if end > start and _is_nl1(b, start):
            models.append((start, end))
    return table, models


def load(raw: bytes) -> Container:
    """Parse an on-disk file, decompressing transparently if needed."""
    kind = classify(raw)
    if kind == COMPRESSED:
        body = decompress_file(raw)
        # A decompressed payload is not necessarily a container: tex/ banks
        # decompress to bare texture data with no offset table.
        if is_container(body):
            table, models = _parse_table(body)
            return Container(body, COMPRESSED, table, models)
        return Container(body, COMPRESSED)
    if kind == RAW:
        table, models = _parse_table(raw)
        return Container(raw, RAW, table, models)
    return Container(raw, kind)
