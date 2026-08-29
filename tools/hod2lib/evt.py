"""`evt/` event tables — Dreamcast RAM images with a dword-based event bytecode.

The files are raw memory images captured from the NAOMI/Dreamcast build. They
still contain absolute SH-4 RAM pointers, which the PC port patches at load time
with a single relocation pass (``FUN_00413120`` at ``0x00413120``)::

    for each dword w in file:
        if (w & 0xFFF80000) == 0x0CE80000:
            w += 0xF3AC1A00          /* i.e. w -= 0x0C53E600 */

That is the whole fixup scheme: any dword landing in the 512 KB window
``0x0CE80000..0x0CEFFFFF`` is a pointer, everything else is payload. No
relocation table, no tagging -- the loader relies on the original data never
containing a non-pointer in that window.

Two buffers receive event data, at fixed PC addresses:

    comevtbl.bin  -> 0x00977200   (DC 0x0CEB5800)
    <stage>evtbl  -> 0x00977400   (DC 0x0CEB5A00)

so a Dreamcast pointer maps to a file offset by subtracting the DC base of the
buffer it belongs to. ``comevtbl`` is 0x200 bytes of scratch immediately before
the stage table, and stage tables do point back into it.

The bytecode itself is executed by ``FUN_0045ecc0`` (0x0045ECC0)::

    do {
        op = *pc;
        dispatch[op]();           /* table of 96 handlers at 0x005931D8 */
    } while (!yield);

Every handler advances ``pc`` itself, so operand length is per-opcode; the
``OPCODES`` table below is transcribed from those 96 handlers.

Reference: docs/formats/evt.md
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Iterator

# ---------------------------------------------------------------------------
# relocation
# ---------------------------------------------------------------------------

RELOC_MASK = 0xFFF80000
RELOC_TAG = 0x0CE80000
RELOC_ADD = 0xF3AC1A00  # add, mod 2**32; equivalently subtract 0x0C53E600
RELOC_SUB = 0x0C53E600

#: PC-side load addresses, from FUN_00413070 / FUN_00413160.
PC_BASE_COM = 0x00977200
PC_BASE_STAGE = 0x00977400

#: Dreamcast-side load addresses (PC address + RELOC_SUB).
DC_BASE_COM = PC_BASE_COM + RELOC_SUB    # 0x0CEB5800
DC_BASE_STAGE = PC_BASE_STAGE + RELOC_SUB  # 0x0CEB5A00

#: comevtbl occupies the 0x200 bytes below the stage table.
COM_RESERVED = PC_BASE_STAGE - PC_BASE_COM


def is_pointer(word: int) -> bool:
    """True if *word* is a Dreamcast pointer the loader would relocate."""
    return (word & RELOC_MASK) == RELOC_TAG


def relocate(word: int) -> int:
    """Apply the loader's fixup to a single dword."""
    return (word + RELOC_ADD) & 0xFFFFFFFF if is_pointer(word) else word


# ---------------------------------------------------------------------------
# opcode table
# ---------------------------------------------------------------------------

# Operand-length classes. Each entry is (name, kind, n) where *kind* is:
#   "fix"   -- fixed size, n = total dwords consumed including the opcode
#   "list"  -- [op][arg ...][-1]
#   "var"   -- [op][list ...][-1] repeated, selected by a global, ended by -2
#   "queue" -- [op][id][...]; total = 2 + (id >> 4)   (FUN_0045F7F0)
#   "tween" -- [op][sub][...]; size depends on sub-opcode
#   "set"   -- [op][sub][...]; FUN_0040B3F0 sub-opcode sizes
#   "halt"  -- does not advance pc
#   "next"  -- replaces pc entirely (end of block)
#   "bad"   -- maps to the empty stub, never legitimately encoded
Op = tuple[str, str, int]

OPCODES: dict[int, Op] = {
    0x00: ("nop_stub", "bad", 0),
    0x01: ("spawn_if_mode1_a", "list", 0),
    0x02: ("spawn_if_mode1_b", "list", 0),
    0x03: ("spawn_if_mode1_c", "list", 0),
    0x04: ("spawn_if_mode1_d", "list", 0),
    0x05: ("spawn_if_mode2_a", "list", 0),
    0x06: ("spawn_if_mode2_b", "list", 0),
    0x07: ("spawn_if_mode2_c", "list", 0),
    0x08: ("spawn_if_mode2_d", "list", 0),
    0x09: ("spawn_placed", "list", 0),      # FUN_004088A0 -- the spawn opcode
    0x0A: ("spawn_simple", "list", 0),      # FUN_00408990
    0x0B: ("spawn_obj", "list", 0),         # FUN_00408AA0
    0x0C: ("spawn_obj_c", "list", 0),       # FUN_00408C40
    0x0D: ("spawn_obj_unless_skip", "list", 0),  # FUN_00408B70
    0x0E: ("set_slot_xyz", "fix", 6),       # FUN_00408D10
    0x0F: ("set_pending_ids", "list", 0),   # FUN_00408C80
    0x10: ("mark_list_a", "list", 0),       # FUN_0045F130
    0x11: ("mark_list_b", "list", 0),       # FUN_0045F160
    0x12: ("set_pending_ids_bias", "list", 0),  # FUN_00408CC0
    0x13: ("set_stage_params", "list", 0),  # FUN_0045F190
    # DAT_009A2BB4: enables the scene light array for draw_mode 1 region
    # entries. Operand is 0/1. See docs/formats/pipeline.md.
    0x14: ("set_scene_lighting", "fix", 2),
    0x15: ("set_g_8d4c", "fix", 2),
    0x16: ("set_fog_or_clear3", "fix", 4),  # FUN_00480D20, 3 deref'd args
    0x17: ("cam_pair_c", "fix", 4),         # FUN_0045F2A0 -> FUN_0040E370
    0x18: ("cam_pair_a", "fix", 3),         # FUN_0045F240 -> FUN_0040E140(p1)
    0x19: ("cam_pair_b", "fix", 3),         # FUN_0045F270 -> FUN_0040E140(p2)
    0x1A: ("set_g_8e58", "fix", 2),
    0x1B: ("set_g_2c34", "fix", 2),
    0x1C: ("set_g_a090", "fix", 2),
    0x1D: ("set_g_8e50", "fix", 2),
    0x1E: ("set_g_8a78", "fix", 2),
    0x1F: ("set_g_a0f4", "fix", 2),
    0x20: ("view1_set", "set", 0),          # FUN_0040B3F0(0)
    0x21: ("view1_tween_rate", "tween", 0),  # FUN_0040B650(0)
    0x22: ("view1_stop", "fix", 2),         # FUN_0040C1F0(0)
    0x23: ("view1_tween_time", "tween", 0),  # FUN_0040BA90(0)
    0x24: ("view2_set", "set", 0),          # FUN_0040B3F0(1)
    0x25: ("view2_tween_rate", "tween", 0),  # FUN_0040B650(1)
    0x26: ("view2_stop", "fix", 2),         # FUN_0040C1F0(1)
    0x27: ("view2_tween_time", "tween", 0),  # FUN_0040BA90(1)
    # Region streaming, NOT sound. 0x29 switches the current region and frees
    # what the new one does not need; 0x28 loads a region's assets. See
    # docs/formats/pipeline.md.
    0x28: ("region_load", "fix", 2),        # FUN_00401670 -> FUN_00401510
    0x29: ("region_enter", "fix", 2),       # FUN_00401630 -> FUN_004015A0
    0x2A: ("unused_2a", "bad", 0),
    0x2B: ("score_bonus_sweep", "fix", 1),  # FUN_0045FE40
    0x2C: ("set_skip_flag", "fix", 2),      # FUN_0045FD90
    0x2D: ("call_35b80_u16", "fix", 2),     # FUN_0045FDD0
    0x2E: ("se_if_skipping", "fix", 1),     # FUN_0045FE00
    0x2F: ("set_g_5c48", "fix", 2),         # FUN_0045FE20
    0x30: ("queue_event", "queue", 0),      # FUN_0045F7F0
    0x31: ("cut_to", "fix", 2),             # FUN_0045F870
    0x32: ("cut_to_when_idle", "fix", 2),   # FUN_0045F900
    0x33: ("set_mode_and_pending", "fix", 3),  # FUN_0045F9F0
    0x34: ("unused_34", "bad", 0),
    0x35: ("set_g_21b0", "fix", 2),
    0x36: ("set_g_70f4", "fix", 2),
    0x37: ("set_g_a098", "fix", 2),
    0x38: ("se_play", "fix", 2),            # FUN_0045F700 -> FUN_0041CFD0
    0x39: ("se_play_3d", "fix", 4),         # FUN_0045F720 -> FUN_00435EE0
    0x3A: ("se_play_unless_skip", "fix", 2),
    0x3B: ("se_play_3d_unless_skip", "fix", 4),
    0x3C: ("unused_3c", "bad", 0),
    0x3D: ("skip4", "fix", 4),              # FUN_0045FEC0
    0x3E: ("skip2", "fix", 2),              # FUN_0045FEB0
    0x3F: ("skip1", "fix", 1),              # FUN_0045FED0
    0x40: ("wait_pending", "fix", 1),       # FUN_0045FA80
    0x41: ("wait_cond_a", "fix", 2),        # FUN_0045FAC0
    0x42: ("wait_frames", "fix", 2),        # FUN_0045FB30
    0x43: ("wait_cond_b", "fix", 2),        # FUN_0045FBC0
    0x44: ("wait_cond_c", "fix", 2),        # FUN_0045FC10
    0x45: ("wait_flag", "fix", 2),          # FUN_0045FC80
    0x46: ("wait_cond_d", "fix", 2),        # FUN_0045FCD0
    0x47: ("wait_ready", "fix", 1),         # FUN_0045FD20
    0x48: ("set_flag", "fix", 2),           # FUN_0045FD70
    0x49: ("variant_call_a", "var", 0),     # FUN_0045F3E0
    0x4A: ("variant_call_b", "var", 0),     # FUN_0045F470
    0x4B: ("variant_spawn", "var", 0),      # FUN_00408AE0
    0x4C: ("unused_4c", "bad", 0),
    0x4D: ("checkpoint", "fix", 1),         # FUN_0045EEC0
    0x4E: ("halt", "halt", 0),              # FUN_0045EFF0
    0x4F: ("end_block", "next", 0),         # FUN_0045F000
    # 0x50-0x57 are the asset streaming vocabulary. Each pushes a job onto
    # the 64-entry ring at DAT_007DA220 with a fixed job kind; see
    # ASSET_JOB_KIND and docs/formats/pipeline.md.
    0x50: ("asset_load_slot", "fix", 2),    # FUN_0041D5D0, kind 0/1
    0x51: ("asset_unload_slot", "fix", 2),  # FUN_0041D610, kind 2
    0x52: ("asset_load_polfile", "fix", 2),  # FUN_0041D650, kind 3
    0x53: ("asset_free_polfile", "fix", 2),  # FUN_0041D690, kind 4
    0x54: ("asset_load_texbank", "fix", 2),  # FUN_0041D6D0, kind 6
    0x55: ("asset_free_texbank", "fix", 2),  # FUN_0041D710, kind 7
    0x56: ("asset_job_8", "fix", 2),        # FUN_0041D750, kind 8
    0x57: ("asset_job_9", "fix", 2),        # FUN_0041D790, kind 9
    0x58: ("call_1d970", "fix", 1),
    0x59: ("call_1d9d0", "fix", 1),
    0x5A: ("call_1da70", "fix", 1),
    0x5B: ("skip1_b", "fix", 1),
    0x5C: ("skip1_c", "fix", 1),
    0x5D: ("call_1d3a0", "fix", 3),         # FUN_0045F6B0
    0x5E: ("call_1d3b0", "fix", 2),         # FUN_0045F6E0
    0x5F: ("call_1d450_4", "fix", 5),       # FUN_0045F7C0
}

#: Sub-opcode sizes for the "set" class (FUN_0040B3F0), in dwords, including
#: the opcode and the sub-opcode. Sub 5 and 9 take three value operands.
SET_SIZES = {0: 3, 1: 3, 2: 3, 3: 3, 4: 3, 5: 5, 6: 3, 7: 3, 8: 3, 9: 5, 10: 3}
SET_DEFAULT = 2

#: FUN_0040B650 / FUN_0040BA90: every defined sub-opcode takes two operands.
TWEEN_SIZES = {s: 4 for s in range(11)}
TWEEN_DEFAULT = 2

#: Which view field each tween/set channel targets. Channels 5 and 9 are
#: "all three axes at once" forms of 2/3/4 and 6/7/8 respectively.
CHANNELS = {
    0: "field_0x30",
    1: "field_0x34",
    2: "int_0x24",
    3: "int_0x28",
    4: "int_0x2c",
    5: "int_0x24_0x28_0x2c",
    6: "float_0x240",
    7: "float_0x244",
    8: "float_0x248",
    9: "float_0x240_0x244_0x248",
    10: "float_0x24c",
}

#: evt opcode -> job kind pushed onto the asset queue at DAT_007DA220.
#: The queue is 64 x 16 bytes {u32 kind, _, u32 arg, u32 state}; FUN_0041D5A0
#: runs one job by calling handler[kind](job) from the table at 0x00588C20.
ASSET_JOB_KIND = {0x50: (0, 1), 0x51: (2,), 0x52: (3,), 0x53: (4,),
                  0x54: (6,), 0x55: (7,), 0x56: (8,), 0x57: (9,)}

#: Opcodes whose single operand is an asset slot id (resolvable to a pol file
#: and entry index through ExeTables.asset_slots()).
SLOT_OPCODES = (0x50, 0x51)

#: Opcodes whose single operand is a pol/tex file index.
FILE_OPCODES = (0x52, 0x53, 0x54, 0x55)

#: Opcodes whose single operand is a *region* id, indexing the per-scene
#: region table (ExeTables.scene_regions). 0x29 enters a region, 0x28 preloads
#: one.
REGION_OPCODES = (0x28, 0x29)

TERM = 0xFFFFFFFF
TERM2 = 0xFFFFFFFE


class EvtError(Exception):
    pass


# ---------------------------------------------------------------------------
# file
# ---------------------------------------------------------------------------


@dataclass
class Instr:
    offset: int
    opcode: int
    name: str
    words: list[int]        # operand dwords, relocated
    raw: list[int]          # operand dwords, as stored

    @property
    def size(self) -> int:
        return (len(self.words) + 1) * 4

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        args = " ".join("%08X" % w for w in self.words)
        return "%06X  %02X %-24s %s" % (self.offset, self.opcode, self.name, args)


@dataclass
class Block:
    """One event block: an array of step pointers, each a bytecode stream."""

    index: int
    offset: int
    steps: list[int] = field(default_factory=list)      # file offsets
    programs: list[list[Instr]] = field(default_factory=list)
    #: (slot, dreamcast pointer) for step entries that resolve outside this
    #: file -- in practice into the shared comevtbl buffer, which sits
    #: immediately below the scene table.
    external_steps: list[tuple[int, int]] = field(default_factory=list)


class EvtFile:
    """A relocated `evt/` table.

    ``self.data`` is the file with the loader's fixup applied and every pointer
    rewritten to a *file offset*, so the structure can be walked without
    reference to any load address.
    """

    def __init__(self, data: bytes, name: str = ""):
        self.name = name
        self.raw = data
        self.is_com = name.startswith("com")
        self.dc_base = DC_BASE_COM if self.is_com else DC_BASE_STAGE
        n = len(data) // 4
        self.words: list[int] = list(struct.unpack_from("<%dI" % n, data, 0))
        self.blocks: list[Block] = []
        self.warnings: list[str] = []

    # -- pointer helpers ---------------------------------------------------

    def to_offset(self, word: int) -> int | None:
        """Dreamcast pointer -> offset in this file, or None if not a pointer."""
        if not is_pointer(word):
            return None
        return word - self.dc_base

    def readable(self, off: int | None) -> bool:
        return off is not None and 0 <= off < len(self.raw) - 3

    def w(self, off: int) -> int:
        if off < 0 or off + 4 > len(self.raw):
            raise EvtError("read past end of %s at %#x" % (self.name, off))
        return self.words[off >> 2]

    # -- structure ---------------------------------------------------------

    def parse(self, n_blocks: int | None = None, max_blocks: int = 4096) -> "EvtFile":
        """Walk root table -> block tables -> bytecode.

        The root array uses ``-1`` as a *hole* -- a scene whose route graph
        never visits block *i* stores -1 there -- so it is not a terminator.
        Pass *n_blocks* from :meth:`ExeTables.scene_block_count` when known;
        otherwise the walk continues while entries remain pointer-or-hole,
        which recovers the same count on every shipped file.
        """
        limit = n_blocks if n_blocks is not None else max_blocks
        for i in range(limit):
            word = self.w(i * 4)
            if word == TERM:
                self.blocks.append(Block(index=i, offset=-1))  # hole
                continue
            off = self.to_offset(word)
            if not self.readable(off):
                if n_blocks is None:
                    break
                self.warnings.append("block %d: bad root entry %08X" % (i, word))
                self.blocks.append(Block(index=i, offset=-1))
                continue
            blk = Block(index=i, offset=off)
            self._parse_block(blk)
            self.blocks.append(blk)
        while self.blocks and self.blocks[-1].offset < 0:
            self.blocks.pop()
        return self

    def _parse_block(self, blk: Block) -> None:
        """Read a block's step table.

        A step entry that resolves outside this file is an **external**
        reference, not a terminator: the shared ``comevtbl`` buffer sits
        immediately below the scene table, so a scene can hand control to a
        stream living there. ``st1evtbl.bin`` block 0 does exactly that, and
        treating it as the end of the list silently drops the four steps that
        follow it.

        Only TERM, or a word that is not a pointer at all, ends the table.
        """
        if blk.offset < 0:
            return
        j = 0
        while j < 4096:
            word = self.w(blk.offset + j * 4)
            if word == TERM:
                break
            off = self.to_offset(word)
            if off is None:
                break                      # not a pointer: end of table
            if not self.readable(off):
                blk.external_steps.append((j, word))
                j += 1
                continue
            blk.steps.append(off)
            try:
                blk.programs.append(list(self.disasm(off)))
            except EvtError as exc:
                self.warnings.append(str(exc))
                blk.programs.append([])
            j += 1

    # -- bytecode ----------------------------------------------------------

    def disasm(self, off: int, limit: int = 20000) -> Iterator[Instr]:
        """Decode one bytecode stream, stopping at halt/end_block."""
        start = off
        for _ in range(limit):
            op = self.w(off)
            if op not in OPCODES:
                raise EvtError(
                    "%s: bad opcode %#x at %#x (stream from %#x)"
                    % (self.name, op, off, start)
                )
            name, kind, n = OPCODES[op]
            size = self._size(off, op, kind, n)
            raw = [self.w(off + 4 * k) for k in range(1, size)]
            yield Instr(off, op, name, [relocate(x) for x in raw], raw)
            if kind in ("halt", "next", "bad"):
                return
            off += size * 4
        raise EvtError("%s: runaway stream from %#x" % (self.name, start))

    def _size(self, off: int, op: int, kind: str, n: int) -> int:
        """Total instruction size in dwords, including the opcode."""
        if kind == "fix":
            return n
        if kind in ("halt", "bad"):
            return 1
        if kind == "next":
            return 1
        if kind == "list":
            k = 1
            while self.w(off + k * 4) != TERM:
                k += 1
                if k > 8192:
                    raise EvtError("%s: unterminated list at %#x" % (self.name, off))
            return k + 1
        if kind == "var":
            # one or more TERM-separated lists, the whole run closed by TERM2
            k = 1
            while True:
                word = self.w(off + k * 4)
                if word == TERM2:
                    return k + 1
                k += 1
                if k > 16384:
                    raise EvtError("%s: unterminated variant at %#x" % (self.name, off))
        if kind == "queue":
            return 2 + (self.w(off + 4) >> 4)
        if kind == "set":
            return SET_SIZES.get(self.w(off + 4), SET_DEFAULT)
        if kind == "tween":
            return TWEEN_SIZES.get(self.w(off + 4), TWEEN_DEFAULT)
        raise EvtError("unknown kind %r" % kind)


# ---------------------------------------------------------------------------
# spawn descriptors (opcode 0x09)
# ---------------------------------------------------------------------------

# Spawn descriptor header, 0x24 bytes, identical for opcodes 0x09, 0x0B and
# 0x0C (FUN_004088A0, FUN_00408A20, FUN_00408BC0):
#
#   +0x00  u32  class index -- selects the object size from DAT_009A2280
#   +0x04  u32  init flags  -- OR'd with 1 into object +0x34
#   +0x08  f32  position x      -> object +0x40
#   +0x0C  f32  position y      -> object +0x44
#   +0x10  f32  position z      -> object +0x48
#   +0x14  s32  orientation a   -> object +0x64
#   +0x18  s32  orientation b   -> object +0x68   (BAMS yaw: 0x4000 == 90 deg)
#   +0x1C  s32  orientation c   -> object +0x6C
#   +0x20  u16  (unused in every shipped file)
#   +0x22  u16  hit points  -- written to BOTH object +0x11C and +0x11E,
#                              i.e. current and maximum of the same quantity
#   +0x24  ...  variable behaviour tail. 0x0B/0x0C store its address in the
#               object (+0x1390 / +0x130C) and leave interpretation to the
#               class; 0x09 instead reads two bytes from it inline
#               (+0x24 -> object +0x1F4, +0x25 -> object +0x130C).
#
# Only 0x09's records have a known total size: they are laid out contiguously
# at a 0x28 stride in every shipped file, i.e. a two-byte tail.

SPAWN_HEADER = 0x24
SPAWN_STRIDE_09 = 0x28

#: Opcodes whose operands are pointers to spawn descriptors.
SPAWN_OPCODES = (0x09, 0x0B, 0x0C, 0x0D)


@dataclass
class Spawn:
    offset: int
    opcode: int
    cls: int
    init_flags: int
    pos: tuple[float, float, float]
    orient: tuple[int, int, int]
    hp: int

    @property
    def yaw_deg(self) -> float:
        """Orientation b as degrees, on the assumption it is a BAMS angle."""
        return self.orient[1] * 360.0 / 65536.0


def read_spawn(evt: EvtFile, off: int, opcode: int = 0x09) -> Spawn:
    """Decode the descriptor header at *off*."""
    cls, flags = struct.unpack_from("<2I", evt.raw, off)
    pos = struct.unpack_from("<3f", evt.raw, off + 0x08)
    orient = struct.unpack_from("<3i", evt.raw, off + 0x14)
    hp = struct.unpack_from("<H", evt.raw, off + 0x22)[0]
    return Spawn(off, opcode, cls, flags, pos, orient, hp)


def spawns(evt: EvtFile, opcodes: tuple[int, ...] = SPAWN_OPCODES) -> list[Spawn]:
    """Every spawn descriptor reachable from a spawn opcode in *evt*."""
    out: list[Spawn] = []
    seen: set[int] = set()
    for blk in evt.blocks:
        for prog in blk.programs:
            for ins in prog:
                if ins.opcode not in opcodes:
                    continue
                for w in ins.raw:
                    off = evt.to_offset(w)
                    if off is None or off in seen:
                        continue
                    if not (0 <= off <= len(evt.raw) - SPAWN_HEADER):
                        continue
                    seen.add(off)
                    out.append(read_spawn(evt, off, ins.opcode))
    out.sort(key=lambda s: s.offset)
    return out


def load(path: str, n_blocks: int | None = None) -> EvtFile:
    import os

    with open(path, "rb") as fh:
        return EvtFile(fh.read(), os.path.basename(path)).parse(n_blocks)
