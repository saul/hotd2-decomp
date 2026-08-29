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

    #: One dword per global cam path slot: how many frames the game plays that
    #: path for. Object draw routines clamp with it -- `FUN_0048E600` and
    #: `FUN_0048F050` both do `n = min(current_frame, CAM_PATH_LENGTH[slot])`
    #: before calling `CamEvalObjectPath6`.
    CAM_PATH_LENGTH = 0x00576D38

    def cam_path_length(self, slot: int) -> int:
        """Authored play length of a global cam path slot, in 60 Hz frames.

        This is *not* the same as the curve's key extent, and the difference is
        the point: the curves say where the path goes, this says how much of it
        the game runs. **[measured]** over all 418 slots, 417 are non-zero and
        323 equal the parsed duration to within 2 frames; the rest clamp short
        of the last key or hold past it.
        """
        off = self._v2r(self.CAM_PATH_LENGTH)
        if off is None:
            return 0
        return struct.unpack_from("<i", self.data, off + slot * 4)[0]

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
    #
    # draw_mode selects how RegionDrawResidentSet submits the model:
    #
    #   0  default        AssetDrawSlot -> RenderSubmitModelDefaultLight
    #                     draw command flags = 0
    #   1  scene-lit      when the opcode-0x14 toggle DAT_009A2BB4 is set,
    #                     AssetDrawSlotLitByScene -> RenderSubmitModelSceneLights
    #                     draw command flags = 0x04000000. That bit makes
    #                     RenderEnqueueCommand install SetLightingSceneArray
    #                     (up to 16 D3DLIGHT7s) instead of the default single
    #                     directional light. Falls back to mode 0 when the
    #                     toggle is clear.
    #   2  early layer    the draw is bracketed by SetDrawLayerNibble(7) /
    #                     SetDrawLayerNibble(8). That nibble is OR'd into the
    #                     command header, and 8 is the default from
    #                     RenderInitStates -- so mode 2 pushes the model into
    #                     an earlier draw layer.
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

    #: draw_mode values, see the note above.
    DRAW_DEFAULT, DRAW_SCENE_LIT, DRAW_EARLY_LAYER = 0, 1, 2

    def scene_draw_modes(self, scene: int, mode1: bool = False) -> dict[int, int]:
        """asset slot -> draw_mode, for every slot any region of a scene draws."""
        out: dict[int, int] = {}
        for region in self.scene_regions(scene, mode1):
            for slot, mode in region:
                out[slot] = max(out.get(slot, 0), mode)
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

    # -- sound ----------------------------------------------------------
    #
    # One id space for every sound in the game. `PlaySoundId` (0x0041CFD0)
    # switches on the **top nibble**:
    #
    #   0  SE      linked list at 0x005845F8, stride 0x34 {u32 id; char[0x30]}
    #   1  BGM     `id & 0xFFF` indexes a table of filename pointers
    #   2  voice   `(id & 0xFFF) * 0x24` into the records at 0x0058044A
    #   8  control 0x80000000 stops whatever is playing
    #
    # BGM has *two* parallel filename tables and picks between them:
    #
    #   if (DAT_009C8E98 == 6 && g_GameMode == 0) name = plain[id & 0xFFF];
    #   else                                      name = ar[id & 0xFFF];
    #
    # The tables are contiguous -- `BGM_NAMES_AR + 41*4 == BGM_NAMES_PLAIN` --
    # which is what fixes their lengths, since neither is terminated. The AR
    # table's 41 entries cover every track; the plain table's 20 are the same
    # tracks without the `_AR` mix.
    #
    # `EvtOpBgmEntryPlay5F` -> `BgmStopThenPlay` consumes four operands and
    # uses only the third: `PlaySoundId(0x80000000)` then `PlaySoundId(op2)`.

    VOICE_RECORDS = 0x0058044A
    VOICE_STRIDE = 0x24

    SE_NAME_LIST = 0x005845F8
    SE_RECORD_STRIDE = 0x34
    SE_TERMINATOR = 0xFFFF

    BGM_NAMES_AR = 0x00580354
    BGM_NAMES_PLAIN = 0x005803F8
    BGM_AR_COUNT = 41
    BGM_PLAIN_COUNT = 20

    SOUND_NS_SE = 0
    SOUND_NS_BGM = 1
    SOUND_NS_VOICE = 2
    SOUND_NS_CONTROL = 8
    SOUND_STOP = 0x80000000

    def _ptr_names(self, base: int, count: int) -> list[str | None]:
        out: list[str | None] = []
        for i in range(count):
            p = self._u32(base + i * 4)
            out.append(self._cstr(p) if p else None)
        return out

    def bgm_names(self) -> dict[str, list[str | None]]:
        """The two BGM filename tables, indexed by ``id & 0xFFF``.

        Holes are real: indices 2, 4 and 7 have a null pointer in both tables
        and no shipped script names them.
        """
        return {
            "ar": self._ptr_names(self.BGM_NAMES_AR, self.BGM_AR_COUNT),
            "plain": self._ptr_names(self.BGM_NAMES_PLAIN, self.BGM_PLAIN_COUNT),
        }

    def se_names(self) -> dict[int, str]:
        """SE sound id -> path under ``sound/SE/``.

        A flat array of ``{u32 id; char name[0x30]}`` records walked linearly
        by ``PlaySoundId`` comparing the id, terminated by ``id == 0xFFFF``.
        Names carry their subdirectory (``COMMON\\BLOOD01_16.WAV``), so the
        full path is the prefix at 0x00588B7C plus the stored name.

        The low half of an id is a category and the high half an index within
        it -- 0x0001_15A9 and 0x0002_15A9 are the second and third entries of
        category 0x15A9.
        """
        r = self._v2r(self.SE_NAME_LIST)
        out: dict[int, str] = {}
        if r is None:
            return out
        for i in range(4096):
            o = r + i * self.SE_RECORD_STRIDE
            if o + self.SE_RECORD_STRIDE > len(self.data):
                break
            sid = struct.unpack_from("<I", self.data, o)[0]
            if sid == self.SE_TERMINATOR:
                break
            name = self.data[o + 4:o + self.SE_RECORD_STRIDE].split(b"\0")[0]
            try:
                out[sid] = name.decode("ascii")
            except UnicodeDecodeError:
                continue
        return out

    def voice_names(self) -> dict[int, str]:
        """Voice id (``id & 0xFFF``) -> path under ``sound/voice/``.

        ``0x24``-byte records: a ``s16`` that is -1 for an empty slot, then
        the name. The count is not stored -- the table simply runs up to the
        SE list at :attr:`SE_NAME_LIST`, two bytes past its last record, which
        is the same "contiguous tables bound each other" pattern the two BGM
        name tables use. That gives **467** entries, and 463 of the non-empty
        ones resolve to files in ``sound/voice/`` (which holds 468).
        """
        r = self._v2r(self.VOICE_RECORDS)
        out: dict[int, str] = {}
        if r is None:
            return out
        count = (self.SE_NAME_LIST - self.VOICE_RECORDS) // self.VOICE_STRIDE
        for i in range(count):
            o = r + i * self.VOICE_STRIDE
            if o + self.VOICE_STRIDE > len(self.data):
                break
            if struct.unpack_from("<h", self.data, o)[0] == -1:
                continue
            name = self.data[o + 2:o + self.VOICE_STRIDE].split(b"\0")[0]
            try:
                out[i] = name.decode("ascii")
            except UnicodeDecodeError:
                continue
        return out

    def sound_file(self, sound_id: int) -> tuple[str, str] | None:
        """``(kind, path)`` for any sound id, dispatched the way the game does.

        ``PlaySoundId`` switches on the top nibble, so a single ``se_play``
        operand can name an SE, a BGM track or a voice line -- and in the
        shipped scripts it does all three. Returns None for the stop control,
        for id 0 (the early-out), and for ids with no table entry.
        """
        ns = sound_id >> 28
        if sound_id == 0:
            return None
        if ns == self.SOUND_NS_SE:
            n = self.se_names().get(sound_id)
            return ("se", n) if n else None
        if ns == self.SOUND_NS_BGM:
            n = self.bgm_file(sound_id)
            return ("bgm", n) if n else None
        if ns == self.SOUND_NS_VOICE:
            n = self.voice_names().get(sound_id & 0xFFF)
            return ("voice", n) if n else None
        return None

    def se_file(self, sound_id: int) -> str | None:
        """Filename for an SE id, or None.

        SE is namespace 0, and ``id == 0`` is ``PlaySoundId``'s early-out --
        the script's way of saying "no sound", not a real entry.
        """
        if sound_id == 0 or sound_id >> 28 != self.SOUND_NS_SE:
            return None
        return self.se_names().get(sound_id)

    def bgm_file(self, track_id: int, plain: bool = False) -> str | None:
        """Filename for a `bgm_entry_play` operand, or None.

        Returns None for the stop control, for the SE namespace (which is what
        a track id of 0 is -- `PlaySoundId` early-outs on it), and for the
        holes in the tables.
        """
        if track_id >> 28 != self.SOUND_NS_BGM:
            return None
        idx = track_id & 0xFFF
        names = self.bgm_names()
        table = names["plain"] if plain else names["ar"]
        return table[idx] if idx < len(table) else None
