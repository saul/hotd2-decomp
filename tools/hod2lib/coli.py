"""
coli/ collision meshes.

The format is stated outright by the hit test, ``ColiSegmentVsMesh``
(``0x004AAA40``), so none of it is inferred from the bytes::

    blob:
        u32  group_count                 (always 1 in shipped data)
        repeat group_count:
            u32  quad_count
            f32  aabb_max[3]             <- MAX first, see below
            f32  aabb_min[3]
            repeat quad_count:           18 dwords = 72 bytes
                f32  nx, ny, nz, d       plane
                u32  axis                dominant axis: 0 = X, 1 = Y, 2 = Z
                f32  v0[3] v1[3] v2[3] v3[3]
                u32  surface             surface material id

A file is a flat sequence of blobs packed end to end -- no header, no offset
table, no padding, and nothing marking the end.

Two details that are obvious from the code and would be very hard to guess:

**The AABB is stored max-then-min.** The reject test reads
``seg_min.x <= box[1] && ... && box[4] <= seg_max.x``, so ``box[1..3]`` is the
upper corner and ``box[4..6]`` the lower one. Reading it the natural way gives
an inverted box that rejects everything.

**``axis`` is an integer in a float slot.** The decompiler compares it against
1.4013e-45 and 2.8026e-45, which are the bit patterns of the integers 1 and 2.
It selects which two components the point-in-quad test runs in.

Which files a scene uses: ``ColiLoadForScene`` (``0x0048A3B0``) loads
``coli0.bin`` into a buffer at ``BUF_COMMON`` for every scene, and
``coli<scene+1>.bin`` into another at ``BUF_SCENE``. ``evt`` opcodes 0x10/0x11
then name individual blobs by **absolute address**, which is legal because the
evt relocation pass has already rewritten them -- see :func:`resolve_pointer`.

``coli.bin`` is **not loaded by the game**: it is absent from the filename
table the loader indexes, starts with 0x800 bytes of zeros and contains the
other files at 0x800-aligned offsets. A build artifact.

Full specification and the validation results: ``docs/formats/coli.md``.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "GROUP_HEADER", "QUAD", "BUF_COMMON", "BUF_SCENE", "WET_SURFACES",
    "Quad", "Group", "Blob", "ColiFile", "load", "scene_files",
    "resolve_pointer",
]

GROUP_HEADER = 28          # u32 quad_count + f32 max[3] + f32 min[3]
QUAD = 72                  # 18 dwords

#: ColiLoadForScene's two fixed load addresses.
BUF_COMMON = 0x0098F200    # coli0.bin, loaded for every scene
BUF_SCENE = 0x00990A00     # coli<scene+1>.bin

#: The evt relocation, mirrored from hod2lib.evt so a caller can resolve an
#: opcode-0x10/0x11 operand without importing the evt module.
RELOC_MASK, RELOC_TAG, RELOC_SUB = 0xFFF80000, 0x0CE80000, 0x0C53E600

#: Surface ids that select the "wet" impact effect and splash sound. Confirmed
#: by two independent consumers: FUN_00456B70 spawns effect asset 0x61 with two
#: extra ripple calls instead of 0x46, and FUN_0040A230 plays sound 0x4416A9
#: instead of 0x2616A9 for a bouncing dropped object. The other ids in the data
#: (0, 2, 3, 50, 52, 53, 56, 60, 61, 90, 99) are a material palette that
#: nothing read so far distinguishes.
WET_SURFACES = (5, 55)

#: Dominant-axis tag -> the two components the point-in-quad test uses.
AXIS_COMPONENTS = {0: ("y", "z"), 1: ("x", "z"), 2: ("x", "y")}

Vec3 = tuple[float, float, float]


class ColiError(Exception):
    pass


@dataclass
class Quad:
    offset: int
    normal: Vec3
    plane_d: float
    axis: int
    verts: tuple[Vec3, Vec3, Vec3, Vec3]
    surface: int

    @property
    def wet(self) -> bool:
        return self.surface in WET_SURFACES

    def plane_error(self) -> float:
        """Worst |n.v + d| over the four vertices.

        Should be ~0: the stored plane is the plane of the stored vertices.
        A non-trivial value means the record has been misread.
        """
        n, d = self.normal, self.plane_d
        return max(abs(sum(n[k] * v[k] for k in range(3)) + d) for v in self.verts)


@dataclass
class Group:
    offset: int
    aabb_min: Vec3
    aabb_max: Vec3
    quads: list[Quad] = field(default_factory=list)


@dataclass
class Blob:
    """One `[group_count][groups...]` unit -- what an evt pointer names."""
    offset: int
    groups: list[Group] = field(default_factory=list)

    @property
    def quads(self) -> list[Quad]:
        return [q for g in self.groups for q in g.quads]


@dataclass
class ColiFile:
    name: str
    raw: bytes
    blobs: list[Blob] = field(default_factory=list)
    consumed: int = 0

    @property
    def coverage(self) -> float:
        return self.consumed / len(self.raw) if self.raw else 0.0

    @property
    def blob_starts(self) -> set[int]:
        return {b.offset for b in self.blobs}

    @property
    def quads(self) -> list[Quad]:
        return [q for b in self.blobs for q in b.quads]


def _parse_blob(b: bytes, off: int) -> tuple[Blob, int]:
    (ngroups,) = struct.unpack_from("<I", b, off)
    blob = Blob(offset=off)
    p = off + 4
    for _ in range(ngroups):
        if p + GROUP_HEADER > len(b):
            raise ColiError(f"group header past EOF at {p:#x}")
        (nquads,) = struct.unpack_from("<I", b, p)
        hi = struct.unpack_from("<3f", b, p + 4)      # MAX first
        lo = struct.unpack_from("<3f", b, p + 16)
        if p + GROUP_HEADER + nquads * QUAD > len(b):
            raise ColiError(f"group at {p:#x} declares {nquads} quads past EOF")
        g = Group(offset=p, aabb_min=lo, aabb_max=hi)
        q = p + GROUP_HEADER
        for _ in range(nquads):
            g.quads.append(Quad(
                offset=q,
                normal=struct.unpack_from("<3f", b, q),
                plane_d=struct.unpack_from("<f", b, q + 12)[0],
                axis=struct.unpack_from("<I", b, q + 16)[0],
                verts=tuple(struct.unpack_from("<3f", b, q + 20 + 12 * k)
                            for k in range(4)),
                surface=struct.unpack_from("<I", b, q + 68)[0],
            ))
            q += QUAD
        blob.groups.append(g)
        p = q
    return blob, p


def load(path: str | Path) -> ColiFile:
    """Parse a whole coli file into its sequence of blobs.

    Stops at the first record that cannot be a blob rather than raising, so a
    caller can see how far the walk got: ``ColiFile.coverage`` is 1.0 for every
    file the game actually loads, and a wrong stride shows up immediately as a
    short walk.
    """
    path = Path(path)
    b = path.read_bytes()
    f = ColiFile(name=path.name, raw=b)
    off = 0
    while off < len(b):
        try:
            blob, end = _parse_blob(b, off)
        except (ColiError, struct.error):
            break
        if end <= off:
            break
        f.blobs.append(blob)
        off = end
    f.consumed = off
    return f


def scene_files(scene: int) -> tuple[str, str]:
    """The two files ``ColiLoadForScene`` loads for *scene* (0-based).

    Returns ``(common, per_scene)``. The loader guards ``0 <= scene < 7``.
    """
    if not 0 <= scene < 7:
        raise ColiError(f"scene {scene} is outside the loader's 0..6 range")
    return "coli0.bin", f"coli{scene + 1}.bin"


def resolve_pointer(operand: int) -> int:
    """An evt 0x10/0x11 operand -> the runtime address it names.

    The operand is stored unrelocated in the file; the evt loader's fixup pass
    subtracts 0x0C53E600 from any dword in 0x0CE80000..0x0CEFFFFF.
    """
    if (operand & RELOC_MASK) == RELOC_TAG:
        return operand - RELOC_SUB
    return operand


def pointer_to_offset(operand: int, common: ColiFile,
                      per_scene: ColiFile) -> tuple[str, int] | None:
    """Resolve an evt collision-set pointer to ``(file name, blob offset)``.

    Returns None if it does not land on a blob header of either file, which is
    what a wrong reading looks like -- across the shipped scripts all 86 of
    them resolve.
    """
    addr = resolve_pointer(operand)
    for base, f in ((BUF_COMMON, common), (BUF_SCENE, per_scene)):
        off = addr - base
        if off in f.blob_starts:
            return f.name, off
    return None
