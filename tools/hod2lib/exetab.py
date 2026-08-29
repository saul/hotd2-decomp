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

    # -- scene / event routing ------------------------------------------
    #
    # The event system indexes everything by "scene", a small id held in
    # DAT_009A1A08. Three parallel tables in .data key off it:
    #
    #   0x00579928   s32  scene -> index into the evt/ filename table
    #                     (-1 = the scene has no file of its own)
    #   0x004D1C7C   ptr  evt/ filename table
    #   0x00597890   ptr  scene -> route table (block flow graph)
    #
    # A route record is 8 bytes, read by FUN_0045F000 when a block's step
    # list runs out:
    #
    #   +0x00  s16  kind   0 = go to next[0]
    #                      1 = branch, go to next[branch_choice]
    #                      2 = end of scene
    #   +0x02  s16  next[0]
    #   +0x04  s16  next[1]
    #   +0x06  s16  next[2]
    #
    # The record count is not stored; consecutive scenes' table pointers are
    # adjacent in address order, so each table ends where the next begins.

    SCENE_FILE_INDEX = 0x00579928
    EVT_NAME_TABLE = 0x004D1C7C
    SCENE_ROUTE_TABLE = 0x00597890
    SCENE_COUNT = 12

    ROUTE_GOTO = 0
    ROUTE_BRANCH = 1
    ROUTE_END = 2

    def scene_evt_file(self, scene: int) -> str | None:
        """evt/ filename for a scene, or None if it has no file."""
        idx = self._u32(self.SCENE_FILE_INDEX + scene * 4)
        if idx is None or idx == 0xFFFFFFFF:
            return None
        ptr = self._u32(self.EVT_NAME_TABLE + idx * 4)
        return self._cstr(ptr) if ptr else None

    def scene_routes(self, scene: int) -> list[tuple[int, int, int, int]]:
        """Route records for a scene: [(kind, next0, next1, next2), ...].

        The list length is also the number of event blocks the scene's evt
        file must supply, which is what makes it useful to the evt parser --
        the root pointer array uses -1 as a *hole* marker, not a terminator,
        so it cannot be sized from the file alone.
        """
        starts = [self._u32(self.SCENE_ROUTE_TABLE + s * 4) or 0
                  for s in range(self.SCENE_COUNT)]
        va = starts[scene]
        if not va:
            return []
        # The tables sit contiguously below the pointer table itself, so each
        # one ends where the next-highest starts.
        after = [v for v in starts if v > va] + [self.SCENE_ROUTE_TABLE]
        end = min(after)
        r = self._v2r(va)
        if r is None:
            return []
        n = (end - va) // 8
        return [tuple(struct.unpack_from("<4h", self.data, r + i * 8))
                for i in range(n)]

    def scene_block_count(self, scene: int) -> int:
        return len(self.scene_routes(scene))

    # -- asset slots and streaming --------------------------------------
    #
    # A pol/ file is a bundle of numbered *asset slots*. The streaming loader
    # FUN_00418820 loads one slot at a time by seeking into its file, so a
    # stage's segments are not all resident at once -- the event script pages
    # them in and out. Four parallel tables map it:
    #
    #   0x004D0EF4  ptr  pol file index -> filename
    #   0x004E803C  u16  pol file index -> number of entries in that file
    #   0x004E794C  ptr  pol file index -> s16[count], the slot id of each
    #                    entry, in container order
    #   0x004E83B4  u16  slot id -> owning pol file index
    #
    # Indices >= 328 are a second, disabled copy of the name list with a count
    # of 0 -- the pol_-prefixed duplicates. They are never loaded.

    POL_NAME_TABLE = 0x004D0EF4
    POL_ENTRY_COUNT = 0x004E803C
    POL_SLOT_LIST = 0x004E794C
    SLOT_TO_POL = 0x004E83B4
    MAX_POL_FILES = 400

    def _u16(self, va: int) -> int | None:
        r = self._v2r(va)
        if r is None or r + 2 > len(self.data):
            return None
        return struct.unpack_from("<H", self.data, r)[0]

    def pol_files(self) -> dict[int, tuple[str, int]]:
        """pol file index -> (filename, entry count). Live entries only."""
        out: dict[int, tuple[str, int]] = {}
        for i in range(self.MAX_POL_FILES):
            ptr = self._u32(self.POL_NAME_TABLE + i * 4)
            if not ptr:
                continue
            name = self._cstr(ptr)
            if not name or not name.endswith(".bin"):
                continue
            cnt = self._u16(self.POL_ENTRY_COUNT + i * 2) or 0
            if cnt:
                out[i] = (name, cnt)
        return out

    def asset_slots(self) -> dict[int, tuple[str, int]]:
        """asset slot id -> (pol filename, entry index within that file).

        The entry index is the slot's position in the file's slot list, which
        is also its index in the container's offset table -- so it selects a
        model directly.
        """
        out: dict[int, tuple[str, int]] = {}
        for fi, (name, cnt) in self.pol_files().items():
            lst = self._u32(self.POL_SLOT_LIST + fi * 4)
            if not lst:
                continue
            r = self._v2r(lst)
            if r is None:
                continue
            for k in range(cnt):
                slot = struct.unpack_from("<h", self.data, r + k * 2)[0]
                out.setdefault(slot, (name, k))
        return out

    def slot_pol_file(self, slot: int) -> str | None:
        fi = self._u16(self.SLOT_TO_POL + slot * 2)
        if fi is None:
            return None
        rec = self.pol_files().get(fi)
        return rec[0] if rec else None

    # -- cam/ path slot binding -----------------------------------------
    #
    # Which global path slot a cam file's entry k occupies is not in the file.
    # FUN_00404000 applies three tables at load:
    #
    #   ptr = base + offset_table[k];  slot = slot_list[file][k];
    #   slot_record[slot] = {ptr, state}
    #
    # NOTE THE STRIDES. They differ, and reading the count table with a u32
    # stride silently yields garbage rather than failing:
    #
    #   0x004C476C   u16   [file * 2]   path count        <- TWO bytes
    #   0x004C470C   u32   [file * 4]   -> s16[count], slot id of each entry
    #   0x004C479C   s8    [slot * 1]   owning cam file index
    #   0x004D1BC8   u32   [file * 4]   filename
    #
    # cp_st2.bin is file 7: the u16 read gives 66 paths, a u32 read gives
    # 65537.

    CAM_NAME_TABLE = 0x004D1BC8
    CAM_PATH_COUNT = 0x004C476C      # u16 stride
    CAM_SLOT_LIST = 0x004C470C       # u32 stride -> s16[]
    SLOT_TO_CAM = 0x004C479C         # s8 stride
    MAX_CAM_FILES = 32

    def cam_files(self) -> dict[int, tuple[str, int]]:
        """cam file index -> (filename, path count)."""
        out: dict[int, tuple[str, int]] = {}
        for i in range(self.MAX_CAM_FILES):
            ptr = self._u32(self.CAM_NAME_TABLE + i * 4)
            if not ptr:
                continue
            name = self._cstr(ptr)
            if not name or not name.endswith(".bin"):
                continue
            cnt = self._u16(self.CAM_PATH_COUNT + i * 2) or 0
            if cnt:
                out[i] = (name, cnt)
        return out

    def cam_path_slots(self) -> dict[int, tuple[str, int]]:
        """global path slot id -> (cam filename, path index within that file).

        The path index is the entry's position in the file's leading offset
        table, i.e. ``CamFile.paths[index]``.
        """
        out: dict[int, tuple[str, int]] = {}
        for fi, (name, cnt) in self.cam_files().items():
            lst = self._u32(self.CAM_SLOT_LIST + fi * 4)
            if not lst:
                continue
            r = self._v2r(lst)
            if r is None:
                continue
            for k in range(cnt):
                slot = struct.unpack_from("<h", self.data, r + k * 2)[0]
                if slot >= 0:
                    out.setdefault(slot, (name, k))
        return out

    def cam_slots_for(self, cam_name: str) -> list[int]:
        """The global slot ids a cam file owns, in path order."""
        stem = cam_name[:-4] if cam_name.endswith(".bin") else cam_name
        for fi, (name, cnt) in self.cam_files().items():
            if name[:-4] == stem:
                lst = self._u32(self.CAM_SLOT_LIST + fi * 4)
                r = self._v2r(lst) if lst else None
                if r is None:
                    return []
                return [struct.unpack_from("<h", self.data, r + k * 2)[0]
                        for k in range(cnt)]
        return []

    def slot_cam_file(self, slot: int) -> str | None:
        """Owning cam file for a path slot, via the s8 reverse table."""
        r = self._v2r(self.SLOT_TO_CAM + slot)
        if r is None or r >= len(self.data):
            return None
        fi = struct.unpack_from("<b", self.data, r)[0]
        rec = self.cam_files().get(fi)
        return rec[0] if rec else None

    # -- stage regions --------------------------------------------------
    #
    # A stage is divided into *regions*. The current region id lives in
    # DAT_009A2224 and is set by evt opcode 0x29; opcode 0x28 preloads a
    # region's assets. Each region names a small set of asset slots, and that
    # set is used for BOTH drawing and streaming:
    #
    #   FUN_00401260  draw:   for each id in region -> frustum cull -> draw
    #   FUN_00401510  load:   load  (new region \ old region)
    #   FUN_004015A0  unload: free  (old region \ new region)
    #
    # Consecutive regions overlap heavily -- a sliding window along the rail.
    # That is why a whole-stage export shows geometry interpenetrating while
    # the game never does: only one region is ever resident and drawn.
    #
    #   0x00576A2C  ptr  scene -> region table, 0x18 bytes per region,
    #                    s16 ids terminated by -1 (max 12 entries)
    #   0x00576A5C  ptr  scene -> id table, 4 bytes: {s16 asset_slot, s16 draw_mode}
    #   0x00576A8C / 0x00576ABC   the same pair for game mode 1
    #
    # The indirection means several regions can share an id entry.

    SCENE_REGION_TABLE = 0x00576A2C
    SCENE_REGION_IDS = 0x00576A5C
    SCENE_REGION_TABLE_MODE1 = 0x00576A8C
    SCENE_REGION_IDS_MODE1 = 0x00576ABC
    REGION_STRIDE = 0x18
    REGION_MAX_ENTRIES = 12

    def _region_table_bounds(self, va: int) -> int:
        """Where the region table starting at *va* ends.

        The region and id tables for every scene and both game modes are packed
        contiguously, so a table ends where the next-highest one begins. The
        count is not stored anywhere -- reading a fixed maximum instead walks
        off into the neighbouring table and invents regions.
        """
        starts = set()
        for base in (self.SCENE_REGION_TABLE, self.SCENE_REGION_IDS,
                     self.SCENE_REGION_TABLE_MODE1, self.SCENE_REGION_IDS_MODE1):
            for s in range(self.SCENE_COUNT):
                v = self._u32(base + s * 4)
                if v:
                    starts.add(v)
        starts.add(self.SCENE_REGION_TABLE)      # the pointer tables follow
        after = [v for v in starts if v > va]
        return min(after) if after else va + self.REGION_STRIDE * 64

    def scene_regions(self, scene: int, mode1: bool = False
                      ) -> list[list[tuple[int, int]]]:
        """Region list for a scene: [[(asset_slot, draw_mode), ...], ...].

        Index into the result is the region id written by evt opcode 0x29.
        """
        rt = self._u32((self.SCENE_REGION_TABLE_MODE1 if mode1
                        else self.SCENE_REGION_TABLE) + scene * 4)
        it = self._u32((self.SCENE_REGION_IDS_MODE1 if mode1
                        else self.SCENE_REGION_IDS) + scene * 4)
        if not rt or not it:
            return []
        r0, i0 = self._v2r(rt), self._v2r(it)
        if r0 is None or i0 is None:
            return []
        max_regions = max(0, (self._region_table_bounds(rt) - rt) // self.REGION_STRIDE)
        out: list[list[tuple[int, int]]] = []
        blank = 0
        for r in range(max_regions):
            base = r0 + r * self.REGION_STRIDE
            if base + self.REGION_STRIDE > len(self.data):
                break
            ids = []
            for k in range(self.REGION_MAX_ENTRIES):
                e = struct.unpack_from("<h", self.data, base + k * 2)[0]
                if e == -1:
                    break
                ids.append(e)
            entries = []
            for e in ids:
                off = i0 + e * 4
                if off + 4 > len(self.data):
                    continue
                slot, mode = struct.unpack_from("<2h", self.data, off)
                entries.append((slot, mode))
            blank = blank + 1 if not entries else 0
            out.append(entries)
        while out and not out[-1]:
            out.pop()
        return out

    def scene_geometry_slots(self, scene: int, mode1: bool = False) -> list[int]:
        """Every asset slot any region of a scene draws, in first-use order."""
        seen: dict[int, None] = {}
        for region in self.scene_regions(scene, mode1):
            for slot, _mode in region:
                seen.setdefault(slot, None)
        return list(seen)

    def scene_geometry_files(self, scene: int, mode1: bool = False
                             ) -> dict[str, list[int]]:
        """pol filename -> sorted entry indices the scene actually draws.

        This is the authoritative stage geometry set. It supersedes globbing
        `st<N>_*`, which both misses files (st3.bin, st_org01) and includes
        entries no region ever draws.
        """
        slots = self.asset_slots()
        out: dict[str, set] = {}
        for slot in self.scene_geometry_slots(scene, mode1):
            rec = slots.get(slot)
            if rec:
                out.setdefault(rec[0], set()).add(rec[1])
        return {k: sorted(v) for k, v in sorted(out.items())}
