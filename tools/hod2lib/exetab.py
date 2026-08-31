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
    #: Bone count per character type, read by `FUN_00412F50` to size a motion
    #: frame. Note it is one MORE than the highest bone index in the skeleton,
    #: because bone 0 is the object root rather than a drawn node.
    CHARACTER_BONE_COUNTS = 0x004E0724
    #: Per-motion play length the scripts compare against. Roughly twice the
    #: frame count -- see `hod2lib.mot`.
    MOTION_PLAY_LENGTH = 0x004E07D0
    #: motion id -> bank id, the argument `FUN_00412F50` hands the loader.
    MOTION_BANK_OF = 0x004E2C40
    #: bank id -> filename / motion-id list / count. The filename table is
    #: shared with the camera paths, so an entry is a motion bank only when it
    #: also has an id list.
    MOTION_BANK_NAME = 0x004D1B00
    MOTION_BANK_IDS = 0x004E2B14
    MOTION_BANK_COUNT = 0x004E2BDC

    #: Skinned-character skeletons, one per character type. `FUN_00410590`
    #: reads ``PTR_DAT_004E0430[type]``; the block holds a node count at
    #: ``+0x16`` and that many node pointers at ``+0x18``. Each node is
    #: ``{u32 asset_slot; ... u16 index @+0x14; u16 child_count @+0x16;
    #: u32 children[] @+0x18}`` and recurses.
    #:
    #: This is the bridge from a spawn class to actual geometry: a class names
    #: a character type, the type names a skeleton, and the skeleton's nodes
    #: name asset slots -- which resolve through `asset_slots()` to a pol file.
    #: Type 0x1A's eighteen nodes all land in ``cat.bin``; a civilian's fifteen
    #: land in ``hito_manbest.bin``.
    #:
    #: The bind pose is **not** here -- every node's ``+0x04..+0x13`` is zero,
    #: so the rest pose lives in the motion data and an assembled character
    #: cannot be posed until `mot/` is decoded.
    CHARACTER_SKELETONS = 0x004E0430

    #: Sound records: ``{u32 id; char name[48]}``, stride 0x34, terminated
    #: by ``id == 0xFFFF``. `PlaySoundId` (0x0041CFD0) switches on ``id >> 28``
    #: through the 9-entry table at 0x0041D324; category 0 resolves here.
    #:
    #: This is the **only place the binary names anything**. There is no asset
    #: name table, so a `PlaySoundId` id is often the sole evidence for what an
    #: object is -- `STAGE2_SE\\CAR_SRIP_22.wav` is how the stage-2 vehicle was
    #: proved to be a car, and `COMMON\\SIBUKI2_16.WAV` (shibuki, "splash") is
    #: how class 0x51 was proved to live in water.
    SOUND_RECORDS = 0x005845F8
    SOUND_RECORD_STRIDE = 0x34

    #: The breakable-prop groups placed by spawn class 0x41 type 0
    #: (`FUN_00462A80`). ``BREAKABLE_COUNTS`` is nine member counts, one per
    #: group; ``BREAKABLE_GROUPS`` is nine pointers to the member records.
    BREAKABLE_COUNTS = 0x00593D14
    BREAKABLE_GROUPS = 0x00593CF0
    #: `g_breakable_hull_points` -- 96 {s16 x, s16 y, s16 z} in thousandths,
    #: the hull `BreakablePropGroundContact` (`FUN_00465590`) transforms to
    #: find which corner a toppling prop comes to rest on.
    BREAKABLE_HULL = 0x005937F8
    BREAKABLE_HULL_POINTS = 96
    #: `g_prop_kind_params` -- 11 records of 0xC, indexed by the class-0x41
    #: type-4 object kind in `obj+0x6C`.
    PROP_KIND_PARAMS = 0x00593DB8
    PROP_KIND_COUNT = 11
    #: The 48-point hull `FallingContainerUpdate` settles against, passed to
    #: `FUN_0046B040` as `(&DAT_00594788, 0x30)`.
    FALLING_HULL = 0x00594788
    FALLING_HULL_POINTS = 48
    #: `g_class41_constructors` (79 entries) and, immediately after it, the
    #: table of *update* routines `PlaceGenericProp` allocates against.
    CLASS41_CTORS = 0x00593580
    CLASS41_UPDATES = 0x005936BC
    CLASS41_TYPES = 79
    #: `PlaceGenericProp` itself -- the constructor 44 of the 79 types share.
    GENERIC_PROP_CTOR = 0x00461CF0
    #: Height of one stack level, from the constructor's own multiply.
    BREAKABLE_LEVEL_HEIGHT = 7.540296

    CAM_PATH_LENGTH = 0x00576D38

    def character_skeleton(self, char_type: int) -> list[dict]:
        """The node tree for a character type, flattened, parents first.

        Each entry is ``{"slot", "offset", "bone", "depth", "parent",
        "children"}``, parents always before children. ``parent`` is an index
        into the returned list, or ``None`` for a root.

        The node layout, from `FUN_004107E0`, which does
        ``MatrixTranslate(node[1], node[2], node[3]); RotZ; RotY; RotX``
        with the rotations coming from the motion frame at ``bone * 6``::

            +0x00  u32 asset slot
            +0x04  f32 bone offset x      <- the bind pose, and it is HERE,
            +0x08  f32 bone offset y         in the EXE, not in the motion data
            +0x0C  f32 bone offset z
            +0x10  u32 (always zero in this build)
            +0x14  u16 bone index, 1-based; bone 0 is the object root
            +0x16  u16 child count
            +0x18  u32 children[]

        Returns an empty list for a type with no skeleton.
        """
        base = self._v2r(self.CHARACTER_SKELETONS)
        if base is None or not (0 <= char_type < 0x100):
            return []
        ptr = struct.unpack_from("<I", self.data, base + char_type * 4)[0]
        off = self._v2r(ptr)
        if off is None or off + 0x18 > len(self.data):
            return []
        roots = struct.unpack_from("<h", self.data, off + 0x16)[0]
        if not (0 < roots < 64):
            return []
        out: list[dict] = []
        seen: set[int] = set()

        def walk(node_ptr: int, depth: int, parent: int | None) -> None:
            o = self._v2r(node_ptr)
            if o is None or node_ptr in seen or depth > 12:
                return
            if o + 0x18 > len(self.data):
                return
            seen.add(node_ptr)
            slot = struct.unpack_from("<I", self.data, o)[0]
            offset = struct.unpack_from("<3f", self.data, o + 4)
            idx = struct.unpack_from("<H", self.data, o + 0x14)[0]
            n = struct.unpack_from("<H", self.data, o + 0x16)[0]
            me = len(out)
            out.append({"slot": slot, "offset": offset, "bone": idx,
                        "index": idx, "depth": depth, "parent": parent,
                        "children": n})
            if n > 64 or o + 0x18 + n * 4 > len(self.data):
                return
            for i in range(n):
                cp = struct.unpack_from("<I", self.data, o + 0x18 + i * 4)[0]
                if cp:
                    walk(cp, depth + 1, me)

        for i in range(roots):
            walk(struct.unpack_from("<I", self.data, off + 0x18 + i * 4)[0],
                 0, None)
        return out

    def character_bone_count(self, char_type: int) -> int:
        """Bones in a character's motion frame, from `DAT_004E0724`."""
        r = self._v2r(self.CHARACTER_BONE_COUNTS)
        if r is None or not (0 <= char_type < 0x200):
            return 0
        return struct.unpack_from("<H", self.data, r + char_type * 2)[0]

    def motion_banks(self) -> dict[int, tuple[str, list[int]]]:
        """``{bank id: (filename, [motion ids])}`` for the real motion banks."""
        out: dict[int, tuple[str, list[int]]] = {}
        fn = self._v2r(self.MOTION_BANK_NAME)
        ip = self._v2r(self.MOTION_BANK_IDS)
        cp = self._v2r(self.MOTION_BANK_COUNT)
        if None in (fn, ip, cp):
            return out
        for b in range(64):
            p = struct.unpack_from("<I", self.data, fn + b * 4)[0]
            name = self._cstr(p) if p else None
            n = struct.unpack_from("<H", self.data, cp + b * 2)[0]
            if not name or not (0 < n <= 4096):
                continue
            io = self._v2r(struct.unpack_from("<I", self.data, ip + b * 4)[0])
            if io is None:
                continue          # a camera-path entry, not a motion bank
            out[b] = (name, list(struct.unpack_from(f"<{n}h", self.data, io)))
        return out

    def motion_bank_of(self, motion_id: int) -> int | None:
        """Which bank holds a motion, from `DAT_004E2C40`."""
        r = self._v2r(self.MOTION_BANK_OF)
        if r is None or r + motion_id >= len(self.data):
            return None
        return self.data[r + motion_id]

    def character_asset_file(self, char_type: int) -> str | None:
        """The pol file a character type's parts live in, if they agree.

        The filenames are the closest thing this binary has to an asset name
        table, and they are how a spawn class gets identified: `cat.bin`,
        `hito_manbest.bin`, `car_pl.bin`. An earlier revision of the notes
        claimed no name table existed and leaned on sound records alone.
        """
        slots = self.asset_slots()
        files = {slots[n["slot"]][0] for n in self.character_skeleton(char_type)
                 if n["slot"] in slots}
        return files.pop() if len(files) == 1 else None

    def sound_records(self) -> dict[int, str]:
        """``{sound id: filename}`` for every category-0 sound in the game."""
        out: dict[int, str] = {}
        base = self._v2r(self.SOUND_RECORDS)
        if base is None:
            return out
        for i in range(4096):
            off = base + i * self.SOUND_RECORD_STRIDE
            if off + self.SOUND_RECORD_STRIDE > len(self.data):
                break
            sid = struct.unpack_from("<I", self.data, off)[0]
            if sid == 0xFFFF:
                break
            raw = self.data[off + 4: off + self.SOUND_RECORD_STRIDE]
            name = raw.split(b"\0")[0]
            try:
                out[sid] = name.decode("ascii")
            except UnicodeDecodeError:
                continue
        return out

    def sound_name(self, sound_id: int) -> str | None:
        """The filename a `PlaySoundId` id names, if it is a category-0 id."""
        return self.sound_records().get(sound_id)

    def breakable_groups(self) -> list[list[dict]]:
        """The breakable-prop groups, decoded from `FUN_00462A80`'s tables.

        Spawn class 0x41 type 0 places a *group* of shootable props rather
        than one object: the spawn's ``obj+0x11C`` is the group id, and the
        constructor loops over that group's member records building a child
        actor each. One member of the group hides the group's item, which is
        released when the last prop of its item-set is broken.

        Each record is 10 bytes::

            +0x00 s16  x * 0.1
            +0x02 s16  z * 0.1
            +0x04 u8   item-set id
            +0x05 s8   g_GameMode == 1 item kind, -1 for none
            +0x06 s8   stack level; y = level * 7.540296 above the floor
            +0x07 u8   number of supporting members
            +0x08 u8   supporting member index a
            +0x09 u8   supporting member index b

        The support list is what makes a stack topple when a prop under it is
        destroyed. **[proved]** by self-consistency: across all 42 members of
        all nine groups, every member at level *n* names supports that are all
        at level *n-1*, and every ground-level member names none.

        The y here is *relative* -- the constructor adds
        ``g_camera_fixed_eye_y - 0.1`` as the floor.

        .. note::
           An earlier revision called ``+0x05`` an *asset variant*. It is not:
           `PlaceBreakableGroup` writes the prop's asset slot unconditionally
           (0x19E8, or 0x1A0F for a Training Mode target) and puts this byte in
           ``obj+0x2A0``, which only `SpawnStoryModeItem` reads, and only
           when ``g_GameMode == 1``. 39 of the 42 shipped records hold -1; the
           three that do not all hide an ordinary item set as well, so mode 1
           substitutes its own drop for theirs. **[proved]** from the one
           consumer.
        """
        out: list[list[dict]] = []
        cbase, base = (self._v2r(self.BREAKABLE_COUNTS),
                       self._v2r(self.BREAKABLE_GROUPS))
        if cbase is None or base is None:
            return out
        counts = self.data[cbase:cbase + 9]
        ptrs = struct.unpack_from("<9I", self.data, base)
        for ptr, n in zip(ptrs, counts):
            off = self._v2r(ptr)
            members = []
            for i in range(n):
                r = self.data[off + i * 10: off + i * 10 + 10]
                if len(r) < 10:
                    break
                nsup = r[7]
                members.append({
                    "index": i,
                    "x": struct.unpack_from("<h", r, 0)[0] * 0.1,
                    "z": struct.unpack_from("<h", r, 2)[0] * 0.1,
                    "item_set": r[4],
                    "story_item": struct.unpack_from("<b", r, 5)[0],
                    "level": struct.unpack_from("<b", r, 6)[0],
                    "y_offset": struct.unpack_from("<b", r, 6)[0]
                                * self.BREAKABLE_LEVEL_HEIGHT,
                    "supports": [r[8], r[9]][:nsup],
                })
            out.append(members)
        return out

    def class41_dispatch(self) -> list[dict]:
        """Per class-0x41 type: which constructor builds it, and which routine
        the object it builds then runs.

        Two parallel 79-entry tables, back to back in `.data`. The second one
        is what `PlaceGenericProp` (`FUN_00461CF0`) indexes when it allocates,
        which is how one constructor serves 44 different objects.
        """
        cb, ub = self._v2r(self.CLASS41_CTORS), self._v2r(self.CLASS41_UPDATES)
        if cb is None or ub is None:
            return []
        n = self.CLASS41_TYPES
        ctors = struct.unpack_from(f"<{n}I", self.data, cb)
        upds = struct.unpack_from(f"<{n}I", self.data, ub)
        return [{"type": i, "ctor": ctors[i], "update": upds[i]}
                for i in range(n)]

    def prop_kind_params(self) -> list[dict]:
        """`g_prop_kind_params` -- per class-0x41 type-4 object kind.

        `PlaceKindedProp` copies three of these into the prop and
        `KindedPropUpdate` plays the fourth when the prop is destroyed::

            +0x00  s16  effect id          -> obj+0x324
            +0x02  s16  effect variant     -> obj+0x328
            +0x04  u32  break sound        -> PlaySoundId
            +0x08  s16  hit radius         -> obj+0x124
            +0x0A  s16  shot-test y offset

        The sounds are the same three the group props use -- 0x1A16A9 break,
        0x1D16A9 crack, 0x2B16A9 -- so the kinds are three materials, not
        eleven.
        """
        base = self._v2r(self.PROP_KIND_PARAMS)
        if base is None:
            return []
        out: list[dict] = []
        for i in range(self.PROP_KIND_COUNT):
            o = base + i * 0xC
            if o + 0xC > len(self.data):
                break
            effect, variant = struct.unpack_from("<2h", self.data, o)
            sound, = struct.unpack_from("<I", self.data, o + 4)
            radius, y_off = struct.unpack_from("<2h", self.data, o + 8)
            out.append({"kind": i, "effect": effect, "effect_variant": variant,
                        "sound": sound, "radius": radius, "y_offset": y_off})
        return out

    def falling_hull_points(self) -> list[tuple[float, float, float]]:
        """The 48-point hull `FallingContainerUpdate` comes to rest on.

        Same shape as `breakable_hull_points` -- {s16 x, s16 y, s16 z} scaled
        by 0.001 -- but a different table, a different count, and **no** height
        offset: `FUN_0046B040` transforms the raw point where
        `BreakablePropGroundContact` first subtracts the prop's own 3.770148.
        """
        base = self._v2r(self.FALLING_HULL)
        if base is None:
            return []
        out: list[tuple[float, float, float]] = []
        for i in range(self.FALLING_HULL_POINTS):
            o = base + i * 6
            if o + 6 > len(self.data):
                break
            x, y, z = struct.unpack_from("<3h", self.data, o)
            out.append((x * 0.001, y * 0.001, z * 0.001))
        return out

    def breakable_hull_points(self) -> list[tuple[float, float, float]]:
        """`g_breakable_hull_points` -- the breakable prop's collision hull.

        96 points of {s16 x, s16 y, s16 z} scaled by 0.001.
        `BreakablePropGroundContact` (`FUN_00465590`) transforms every one of
        them by the prop's ``Ry * Rz * Rx`` and asks whether it has gone below
        the floor; the lowest one that has is the corner the prop settles on.
        The loop bound is the raw address compare ``psVar4 <= 0x593A39``, which
        is 96 strides of six bytes from 0x005937F8.
        """
        base = self._v2r(self.BREAKABLE_HULL)
        if base is None:
            return []
        out: list[tuple[float, float, float]] = []
        for i in range(self.BREAKABLE_HULL_POINTS):
            o = base + i * 6
            if o + 6 > len(self.data):
                break
            x, y, z = struct.unpack_from("<3h", self.data, o)
            out.append((x * 0.001, y * 0.001, z * 0.001))
        return out

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

    MESSAGE_VARIANTS = 0x0058B6B8
    MESSAGE_RECORDS = 0x00589DA8
    MESSAGE_RECORD_STRIDE = 0x10

    #: u16[variant][4], 0xFFFF-terminated -- the subtitle lines of a variant.
    DIALOGUE_LINES = 0x005919A8
    DIALOGUE_LINES_PER_VARIANT = 4
    #: 0x40-byte {f32 x_offset, char text[0x3A], u16 end_frame} line records.
    DIALOGUE_TEXT = 0x0058BC68
    DIALOGUE_TEXT_STRIDE = 0x40
    DIALOGUE_TEXT_END = 0x3E

    BACKDROP_PRESETS = 0x00579968
    BACKDROP_STRIDE = 0x10
    BACKDROP_COUNT = 12

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

    def screen_messages(self, max_groups: int = 512) -> list[dict]:
        """evt opcode 0x2D's message groups.

        `FUN_00435B80` picks a variant by player configuration and then a
        record::

            variant = s16[0x0058B6B8 + (group * 3 + player_cfg) * 2]
            if (variant == 0) return;                 /* group unused here */
            rec     = 0x00589DA8 + variant * 0x10
            if (rec.voice) PlaySoundId(rec.voice);
            task = {sprite: variant, frames: rec.frames}

        so a group holds three variants -- 1P/player 1, 1P/player 2, and 2P --
        and `player_cfg` (`DAT_009C7000`) selects between them. Scenes 10 and
        11 take a separate branch that always uses variant 0.

        Record, 16 bytes::

            +0x00  u16  sprite
            +0x02  u16  frames     how long it stays up
            +0x04  f32  x          screen position
            +0x08  f32  y
            +0x0C  u32  voice      a sound id for PlaySoundId, or 0

        Neither table stores a count. The **record** table is bounded by the
        variant table that follows it -- the same contiguous-tables pattern as
        the BGM and voice tables -- giving 401 records; a group whose variants
        all fall outside that range ends the group list. Stopping at the first
        all-zero group would be wrong: group 0 is unused (0, 0, 0) and group 6
        is (0, 0, 12), and the shipped scripts request groups up to 229.
        """
        vr = self._v2r(self.MESSAGE_VARIANTS)
        rr = self._v2r(self.MESSAGE_RECORDS)
        if vr is None or rr is None:
            return []
        n_records = ((self.MESSAGE_VARIANTS - self.MESSAGE_RECORDS)
                     // self.MESSAGE_RECORD_STRIDE)
        out: list[dict] = []
        for g in range(max_groups):
            o = vr + g * 6
            if o + 6 > len(self.data):
                break
            variants = list(struct.unpack_from("<3h", self.data, o))
            if any(v < 0 or v >= n_records for v in variants):
                break
            entry: dict = {"group": g, "variants": []}
            for cfg, v in enumerate(variants):
                if v == 0:
                    entry["variants"].append(None)
                    continue
                ro = rr + v * self.MESSAGE_RECORD_STRIDE
                if v >= n_records or ro + self.MESSAGE_RECORD_STRIDE > len(self.data):
                    entry["variants"].append(None)
                    continue
                sprite, frames = struct.unpack_from("<2H", self.data, ro)
                x, y = struct.unpack_from("<2f", self.data, ro + 4)
                voice, = struct.unpack_from("<I", self.data, ro + 12)
                entry["variants"].append({
                    "variant": v, "player_cfg": cfg, "sprite": sprite,
                    "frames": frames, "x": x, "y": y, "voice": voice,
                    "lines": self.dialogue_lines(v),
                    "voice_file": (self.voice_names().get(voice & 0xFFF)
                                   if voice >> 28 == self.SOUND_NS_VOICE
                                   else None),
                })
            out.append(entry)
        return out

    def dialogue_lines(self, variant: int) -> list[dict]:
        """The subtitle lines a message variant displays, in order.

        `FUN_00435AA0` -- the per-frame task `0x2D` starts -- is a subtitle
        renderer, not a sprite blitter::

            frames -= 1;
            if (frames == 0 || skip_flag || DAT_009A2230) { task_end(); return; }
            if (DAT_009C911E != 1) {
                line_id = lines[variant * 4 + line];
                if (frames < line_rec[line_id].end_frame) line++;
                DrawTextCentred(line_rec[line_id].x_offset, 384.0,
                                line_rec[line_id].text);
                return;
            }
            /* sprite path -- see below */

        The sprite branch is **dead**: `DAT_009C911E` has one writer in the
        whole binary (`FUN_0040AC60`) and it stores 2, and the global is BSS,
        so the `== 1` test is never true. The game always draws text.

        Lines advance on a countdown rather than a timer: the task's `frames`
        counts *down* from the record's duration, and the line index steps on
        whenever `frames` falls below the current line's ``end_frame``. So
        ``end_frame`` is "frames still remaining when this line gives way".

        Line record, 0x40 bytes at ``DIALOGUE_TEXT``::

            +0x00  f32   x_offset    added to the centred position
            +0x04  char  text[0x3A]  NUL-terminated ASCII
            +0x3E  u16   end_frame

        ``FUN_00436850`` draws it centred: ``x = 320 - len * 5.6 + x_offset``
        on a 384 baseline in the game's 640x480 screen, 11.2 px per glyph,
        with a per-letter baseline nudge for descenders and a char -> glyph
        table at 0x0055E054. Colour is (1.0, 0.8, 0.8).
        """
        lr = self._v2r(self.DIALOGUE_LINES)
        tr = self._v2r(self.DIALOGUE_TEXT)
        if lr is None or tr is None or variant < 0:
            return []
        out: list[dict] = []
        for i in range(self.DIALOGUE_LINES_PER_VARIANT):
            o = lr + (variant * self.DIALOGUE_LINES_PER_VARIANT + i) * 2
            if o + 2 > len(self.data):
                break
            line_id, = struct.unpack_from("<H", self.data, o)
            if line_id == 0xFFFF:
                break
            ro = tr + line_id * self.DIALOGUE_TEXT_STRIDE
            if ro + self.DIALOGUE_TEXT_STRIDE > len(self.data):
                break
            x_off, = struct.unpack_from("<f", self.data, ro)
            raw = self.data[ro + 4:ro + self.DIALOGUE_TEXT_END]
            text = raw.split(b"\0")[0].decode("ascii", "replace")
            end_frame, = struct.unpack_from(
                "<H", self.data, ro + self.DIALOGUE_TEXT_END)
            if not text:
                continue
            out.append({"line": line_id, "text": text,
                        "x_offset": x_off, "end_frame": end_frame})
        return out

    def backdrop_presets(self) -> list[dict]:
        """The 12 camera-following backdrop domes, indexed by evt opcode 0x1B.

        16 bytes each::

            +0x00  s16  asset slot A -- the dome that is drawn
            +0x02  s16  asset slot B -- a second slot, drawn by the variant
                                        paths for presets 8, 10 and 11
            +0x04  f32  dy           -- Y offset from the camera, 0 .. -3000
            +0x08  s32  spin         -- BAMS added to the angle every frame
            +0x0C  s32  angle0       -- BAMS the angle resets to on a change

        The draw is straightforward once read (the code at 0x004132D0, which
        Ghidra leaves as an undefined block):

            translate(camera.x, camera.y + dy, camera.z)
            if (mode != 2) angle += spin          /* mode 2 = drawn, frozen */
            if (preset == 5) { rotZ(180 deg); rotY(-angle); }
            else               rotY(angle)
            scale(1.2, 1.2, -1.2)                 /* note the negative Z */
            AssetDrawSlot(assetA)

        So it follows the camera in all three axes, spins about Y, and is
        turned inside out by the negative Z scale -- a sky dome seen from
        within. Opcode 0x1C is the mode: 0 off, 2 drawn but frozen, anything
        else drawn and animating.
        """
        r = self._v2r(self.BACKDROP_PRESETS)
        out: list[dict] = []
        if r is None:
            return out
        slots = self.asset_slots()
        for i in range(self.BACKDROP_COUNT):
            o = r + i * self.BACKDROP_STRIDE
            if o + self.BACKDROP_STRIDE > len(self.data):
                break
            a, b = struct.unpack_from("<2h", self.data, o)
            dy, = struct.unpack_from("<f", self.data, o + 4)
            spin, angle0 = struct.unpack_from("<2i", self.data, o + 8)
            entry = {
                "preset": i, "slot_a": a, "slot_b": b,
                "dy": dy, "spin_bams": spin, "angle0_bams": angle0,
            }
            for key, sl in (("a", a), ("b", b)):
                rec = slots.get(sl)
                if rec:
                    entry[f"file_{key}"] = rec[0]
                    entry[f"entry_{key}"] = rec[1]
            out.append(entry)
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
