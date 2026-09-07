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
#   "set"   -- [op][sub][...]; ApplyLightChannelOperand sub-opcode sizes
#   "halt"  -- does not advance pc
#   "next"  -- replaces pc entirely (end of block)
#   "bad"   -- maps to the empty stub, never legitimately encoded
Op = tuple[str, str, int]

OPCODES: dict[int, Op] = {
    # Names and semantics are recovered from each handler and, where the
    # handler only writes a global, from that global's *consumers*. The
    # authoritative write-up with per-row evidence and confidence marks is
    # docs/formats/evt.md; a condensed copy is the plate comment on
    # EvtInterpreterLoop (0x0045ECC0) in the Ghidra database.
    #
    # Operand sizes below were validated independently of the names: 17,150
    # instructions across every shipped file decode with zero errors and no
    # stub opcode is ever reached.
    0x00: ("nop_stub", "bad", 0),
    # 0x01-0x08 are 0x09/0x0A/0x0B/0x0C behind a player-count gate, and
    # nothing else: EvtOpSpawnIfOnePlayer (0x00408820) and
    # EvtOpSpawnIfTwoPlayers (0x00408860) test g_max_attackers against 1 or 2
    # and either tail-jump into g_evt_spawn_gated_handlers[opcode] or walk the
    # operand list to its -1 and skip it. Same descriptors, same allocators --
    # so the old `spawn_if_mode*` naming was a guess at a difficulty or game
    # mode, and the gate is really "how many players are in play".
    0x01: ("spawn_placed_if_1p", "list", 0),
    0x02: ("spawn_simple_if_1p", "list", 0),
    0x03: ("spawn_obj_if_1p", "list", 0),
    0x04: ("spawn_obj_c_if_1p", "list", 0),
    0x05: ("spawn_placed_if_2p", "list", 0),
    0x06: ("spawn_simple_if_2p", "list", 0),
    0x07: ("spawn_obj_if_2p", "list", 0),
    0x08: ("spawn_obj_c_if_2p", "list", 0),
    0x09: ("spawn_placed", "list", 0),      # FUN_004088A0 -- the spawn opcode
    0x0A: ("spawn_simple", "list", 0),      # FUN_00408990
    0x0B: ("spawn_obj", "list", 0),         # FUN_00408AA0
    0x0C: ("spawn_obj_c", "list", 0),       # FUN_00408C40
    0x0D: ("spawn_obj_unless_skip", "list", 0),  # FUN_00408B70
    # 0x0E/0x0F/0x12 are the enemy approach-distance pacing table, not spawn
    # ids. A zombie's attack budget is chosen by its XZ distance to the camera
    # against three rings; the budget is how many walk cycles it may take to
    # close before attacking. 0x0E's operands are FLOATS -- the ROM defaults
    # decode as {25,38,51}, which as integers would be 0x41C80000.
    0x0E: ("set_approach_rings", "fix", 6),      # EvtOpSetApproachRings0E
    0x0F: ("set_approach_steps", "list", 0),     # EvtOpSetApproachSteps0F
    # 0x10/0x11 carry *relocated absolute pointers* to collision-mesh blobs --
    # legal because EvtRelocatePointers has already rewritten them. Set A is
    # consulted by both the ray and the sphere queries; set B by rays only.
    0x10: ("set_collision_set_full", "list", 0),      # EvtOpSetCollisionSetFull10
    0x11: ("set_collision_set_ray_only", "list", 0),  # EvtOpSetCollisionSetRayOnly11
    0x12: ("set_approach_steps_2p_bias", "list", 0),  # as 0x0F, +1 for 2 players
    0x13: ("set_scene_lighting_override", "list", 0),  # (enable, r, g, b, ambient)
    # 0x14 enables the scene light array for draw_mode 1 region entries, and
    # also gates 0x15 and 0x16. See docs/formats/pipeline.md.
    0x14: ("set_scene_lighting", "fix", 2),
    # One D3DLIGHT7 SPOT per entity (theta = phi = pi/8) into the 16-entry
    # array at 0x009A1A20. Only effective while 0x14 is on.
    0x15: ("enable_entity_spotlights", "fix", 2),
    # Three float refs -> the D3D ambient colour. NOT fog: the old name
    # "set_fog_or_clear3" was wrong, nothing on this path touches fog.
    0x16: ("set_ambient_light_rgb", "fix", 4),
    # 0x17-0x19 drive the two scene light/fog blocks (0x009A3540, 0x009A59E0).
    # These are NOT per-player view structs -- see the correction in evt.md.
    0x17: ("slerp_light0_direction", "fix", 4),   # (pitch, yaw, frames), async
    0x18: ("set_light0_direction", "fix", 3),     # (pitch, yaw) BAMS
    0x19: ("set_light1_direction", "fix", 3),
    # Ground plane: the fallback height when a downward raycast misses, and the
    # plane blob shadows project onto. Also what 0x36 pins the view Y to.
    0x1A: ("set_ground_plane_y", "fix", 2),
    # Camera-following backdrop dome, index 0..11 into a 12 x 16-byte table at
    # 0x00579968 {s16 assetA, s16 assetB, f32 dy, s32 spin, s32 angle0}.
    0x1B: ("set_backdrop_preset", "fix", 2),
    0x1C: ("set_backdrop_mode", "fix", 2),   # 0 off, 2 frozen, else animating
    0x1D: ("enable_rain", "fix", 2),
    # DEAD: DAT_009C8A78 has no readers anywhere in the binary.
    0x1E: ("set_unread_global", "fix", 2),
    # 9-state HUD shutter; also drives the gate on firing and ammo decrement.
    0x1F: ("set_hud_shutter_state", "fix", 2),
    # 0x20-0x27 tween the two light/fog blocks, NOT view structs. Channels:
    # 0/1 fog near/far, 2-4 fog RGB, 5 fog RGB triple, 6-8 light RGB,
    # 9 light RGB triple, 10 ambient.
    0x20: ("light0_set", "set", 0),          # ApplyLightChannelOperand(0)
    0x21: ("light0_tween_rate", "tween", 0),  # FUN_0040B650(0)
    0x22: ("light0_stop", "fix", 2),         # FUN_0040C1F0(0)
    0x23: ("light0_tween_time", "tween", 0),  # FUN_0040BA90(0)
    0x24: ("light1_set", "set", 0),          # ApplyLightChannelOperand(1)
    0x25: ("light1_tween_rate", "tween", 0),  # FUN_0040B650(1)
    0x26: ("light1_stop", "fix", 2),         # FUN_0040C1F0(1)
    0x27: ("light1_tween_time", "tween", 0),  # FUN_0040BA90(1)
    # Region streaming, NOT sound. 0x29 switches the current region and frees
    # what the new one does not need; 0x28 loads a region's assets. See
    # docs/formats/pipeline.md.
    0x28: ("region_load", "fix", 2),        # FUN_00401670 -> FUN_00401510
    0x29: ("region_enter", "fix", 2),       # FUN_00401630 -> FUN_004015A0
    0x2A: ("unused_2a", "bad", 0),
    # End-of-stage accuracy bonus: pct = hits*100/shots (needs shots > 0x13),
    # bonus = table[pct/10] at 0x00567990 = {0,0,0,0,500,1000,1500,2000,2500,
    # 3000,4000}.
    0x2B: ("award_accuracy_bonus", "fix", 1),
    # Opens/closes a "skippable" region. arg != 0 -> DAT_009A2230 = 0 and
    # DAT_009A2D7C = 1; arg == 0 -> DAT_009A2D7C = 0 and the skip flag clears.
    # The feature is live: both player-update routines poll Start while this is
    # set and the firing gate DAT_009C8E00 is down, and the standing task
    # CheckCutsceneSkipRequest (0x00435F40) turns that into DAT_009A2D74.
    # See docs/formats/evt.md.
    0x2C: ("set_skippable_region", "fix", 2),
    # Dialogue: a u16 group -> a variant by player configuration, then a voice
    # line through PlaySoundId and up to four timed subtitle lines drawn
    # centred at y = 384. Suppressed, and a line already on screen cut, while
    # the cutscene skip flag is up. The task FUN_00435AA0 has a sprite branch,
    # but DAT_009C911E is only ever written 2, so it never runs -- the game
    # always draws text. Suppressed entirely while the skip flag is up.
    0x2D: ("play_dialogue", "fix", 2),
    # `if (skip) PlaySoundId(0x80000002)` -- restart the BGM a skipped cutscene
    # interrupted.
    0x2E: ("resume_bgm_if_skipped", "fix", 1),
    0x2F: ("suppress_accuracy_stats", "fix", 2),  # gates the counters 0x2B grades
    0x30: ("queue_event", "queue", 0),      # FUN_0045F7F0
    0x31: ("goto_scene_state", "fix", 2),          # major fixed at 1
    0x32: ("goto_scene_state_when_alive", "fix", 2),  # parks until players live
    0x33: ("set_action_drain_mode", "fix", 3),     # (mode, pending delta)
    0x34: ("unused_34", "bad", 0),
    # CamEvalPath7 evaluates curve channel 6 (roll/bank) only when set.
    0x35: ("enable_camera_path_roll", "fix", 2),
    # Take the view Y from the ground plane (0x1A) instead of path.y - 15.
    0x36: ("pin_view_to_ground_plane", "fix", 2),
    # Advance the camera path every frame, bypassing the room-cleared gate.
    0x37: ("force_camera_path_advance", "fix", 2),
    0x38: ("se_play", "fix", 2),            # FUN_0045F700 -> FUN_0041CFD0
    0x39: ("se_play_3d", "fix", 4),         # FUN_0045F720 -> FUN_00435EE0
    0x3A: ("se_play_unless_skip", "fix", 2),
    0x3B: ("se_play_3d_unless_skip", "fix", 4),
    0x3C: ("unused_3c", "bad", 0),
    # Pure no-ops that only advance pc. 0x3F, 0x5B and 0x5C share ONE handler
    # which never reads the opcode, so all three are identical.
    0x3D: ("nop3", "fix", 4),
    0x3E: ("nop1", "fix", 2),
    0x3F: ("nop0", "fix", 1),
    0x40: ("wait_queued_events_done", "fix", 1),
    # operand 0 = wait for end of path; else wait until the path frame passes it
    0x41: ("wait_camera_path_frame", "fix", 2),
    0x42: ("wait_frames", "fix", 2),        # an external routine may shorten it
    # Two distinct enemy counters: "alive" drops at kill time, "present" at
    # death-animation end, so present >= alive.
    0x43: ("wait_enemies_present", "fix", 2),
    0x44: ("wait_enemies_alive", "fix", 2),
    0x45: ("wait_script_flag", "fix", 2),   # 256-byte array at 0x009C7200
    0x46: ("wait_scripted_actors", "fix", 2),
    0x47: ("wait_targets_clear", "fix", 1),
    0x48: ("set_script_flag", "fix", 2),    # the writer half of 0x45
    0x49: ("variant_call_a", "var", 0),     # FUN_0045F3E0
    0x4A: ("variant_call_b", "var", 0),     # FUN_0045F470
    0x4B: ("variant_spawn", "var", 0),      # FUN_00408AE0
    0x4C: ("unused_4c", "bad", 0),
    # Appends the current room id to the per-stage route history the
    # stage-clear map animates, reseeds the CRT RNG with 0 during gameplay, and
    # restores the default approach rings.
    0x4D: ("checkpoint", "fix", 1),         # FUN_0045EEC0
    0x4E: ("halt", "halt", 0),              # FUN_0045EFF0
    # 0x4F advances the *step*, and only reaches the route table when the
    # step list is exhausted -- see EvtAdvanceStepOrRoute. It was called
    # `end_block` for a long time, which reads as a block terminator and is
    # wrong: a block's steps are one continuous room and 0x4F fires between
    # them. Renamed to say what it does.
    0x4F: ("advance_step", "next", 0),      # EvtAdvanceStepOrRoute
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
    # Drain the asset job ring: everything, only tex\+pol\ (types < 8), or
    # only mot\ (types 8..10). The others are compacted and left pending.
    0x58: ("asset_wait_all_jobs", "fix", 1),
    0x59: ("asset_wait_tex_pol_jobs", "fix", 1),
    0x5A: ("asset_wait_motion_jobs", "fix", 1),
    0x5B: ("nop0_b", "fix", 1),             # same handler as 0x3F
    0x5C: ("nop0_c", "fix", 1),             # same handler as 0x3F
    # NAOMI sound-driver calls stubbed out for the PC port: the handlers are
    # OutputDebugStringA("SS_SndLoadPack") and nothing else. The PC build
    # streams individual .wav files instead.
    0x5D: ("snd_load_pack_stub", "fix", 3),
    0x5E: ("snd_free_pack_stub", "fix", 2),
    # Consumes four operands but uses ONLY the third: stop the current BGM,
    # then play that track id.
    0x5F: ("bgm_entry_play", "fix", 5),
}

#: queue_event (0x30) selectors. EvtRunQueuedActions dispatches through a
#: two-level table at 0x005776EC: handler = table[sel >> 4][sel & 0xF]. The
#: high nibble is BOTH the group index and the operand count, so the
#: instruction is 2 + (sel >> 4) dwords and the groups are organised by arity.
#: There are exactly ten handlers; 0x13 is defined but never used in shipped
#: data. See docs/formats/evt.md.
QUEUE_ACTIONS: dict[int, str] = {
    0x10: "set_player_flag",
    0x11: "scene_state",            # EvtEnterSceneState(current_major, op0)
    0x12: "set_update_routine",
    0x13: "set_continuation",       # never used
    0x14: "set_global",
    0x15: "set_flag",
    0x20: "hold_camera_preset",     # op0 frames, op1 indexes 0x00576CF0
    0x21: "finish_sequence",        # EvtEnterSceneState(2, op0)
    # (start_frame, end_frame, global_cam_path_index, flags)
    #   start_frame == -1  resume rather than seek
    #   flags & 2          stash for a later camera state 6/7 to play
    0x40: "cam_play",
    0x60: "store_six",
}

#: Sub-opcode sizes for the "set" class (ApplyLightChannelOperand), in dwords, including
#: the opcode and the sub-opcode. Sub 5 and 9 take three value operands.
SET_SIZES = {0: 3, 1: 3, 2: 3, 3: 3, 4: 3, 5: 5, 6: 3, 7: 3, 8: 3, 9: 5, 10: 3}
SET_DEFAULT = 2

#: FUN_0040B650 / FUN_0040BA90: every defined sub-opcode takes two operands.
TWEEN_SIZES = {s: 4 for s in range(11)}
TWEEN_DEFAULT = 2

#: Which field of a scene light/fog block each 0x20-0x27 channel targets.
#: Channels 5 and 9 are the "all three components at once" forms of 2/3/4 and
#: 6/7/8. The block offsets are given because the mapping was recovered from
#: them; see the correction in docs/formats/evt.md.
CHANNELS = {
    0: "fog_near",          # +0x30
    1: "fog_far",           # +0x34
    2: "fog_r",             # +0x24
    3: "fog_g",             # +0x28
    4: "fog_b",             # +0x2c
    5: "fog_rgb",           # +0x24/+0x28/+0x2c together
    6: "light_r",           # +0x240
    7: "light_g",           # +0x244
    8: "light_b",           # +0x248
    9: "light_rgb",         # +0x240/+0x244/+0x248 together
    10: "ambient",          # +0x24c
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
        #: The shared ``comevtbl`` buffer, when this is a stage table. Set by
        #: :func:`load`; see :meth:`resolve`.
        self.com: "EvtFile | None" = None

    # -- pointer helpers ---------------------------------------------------

    def to_offset(self, word: int) -> int | None:
        """Dreamcast pointer -> offset in this file, or None if not a pointer."""
        if not is_pointer(word):
            return None
        return word - self.dc_base

    def resolve(self, word: int) -> "tuple[EvtFile, int] | None":
        """(file, offset) for *word*, following into the shared com buffer.

        ``comevtbl`` is loaded at 0x00977200 and the stage table immediately
        behind it at 0x00977400, so a stage pointer below its own base is a
        pointer into the com buffer rather than a bad one. Six of the seven
        distinct ``spawn_simple`` operands in the game are exactly that: the
        four screen-furniture records live in ``comevtbl.bin`` and every stage
        names them at the same address. See :data:`COM_RESERVED`.
        """
        off = self.to_offset(word)
        if off is None:
            return None
        if off >= 0:
            return (self, off) if self.readable(off) else None
        if self.com is None:
            return None
        com_off = word - self.com.dc_base
        return (self.com, com_off) if self.com.readable(com_off) else None

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
        """Decode one bytecode stream, stopping at halt/advance_step."""
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
#   +0x20  u16  second flag word -> object +0x1316, and from there into the
#               class's own flag word at object +0x136C. **Not unused**: this
#               comment used to say "(unused in every shipped file)" and that
#               was false whole-corpus. See SPAWN_DESC_FLAGS below.
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

#: What the descriptor's ``+0x20`` word means, and the count of shipped
#: descriptors that set each bit.
#:
#: **[proved]** ``SpawnFromDescriptor`` (``FUN_00408A20``) copies it to
#: ``obj+0x1316`` -- ``MOV AX, word ptr [EDI + 0x20]`` (``668b4720``) then
#: ``MOV word ptr [ESI + 0x1316], AX`` (``66898616130000``) at 0x00408A77 --
#: and ``EnemyThrowerInit`` (``FUN_00449620``) makes it the low half of the
#: class flag word ``obj+0x136C``:
#:
#: .. code-block:: none
#:
#:     00449762  MOVSX EAX, word ptr [ESI + 0x1316]   0fbf8616130000
#:     00449769  OR    EAX, 0x180000                  0d00001800
#:     0044977a  MOV   dword ptr [ESI + 0x136c], EAX  89866c130000
#:
#: It is **sign-extended**, so a descriptor setting 0x8000 would raise the
#: whole high half; no shipped descriptor does.
#:
#: Whole-corpus counts over every ``evt/*.bin`` (re-derived 2026-09-03):
#:
#: =======  ====  ========  ==================================================
#: class    n     nonzero   values
#: =======  ====  ========  ==================================================
#: 0x31     51    23        0x1 x18, 0x40 x1, 0x80 x1, 0x100 x3
#: 0x30     345   76        0x1 x5, 0x2 x13, 0x5 x1, 0x6 x1, 0x20 x52,
#:                          0x22 x3, 0x40 x1
#: =======  ====  ========  ==================================================
#:
#: For class 0x31 the bits are the **starting surface**: 0x40 wall A, 0x80
#: wall B, 0x100 ceiling, and bit 0 the alternate part-draw entry point
#: (``ThrowerDrawPart``, ``FUN_0044A200``). The five class-0x31 descriptors
#: with surface bits are all in ``st6evtbl.bin``, all character type 0x18
#: entering state 34.
#:
#: Class 0x30 seeds its own flag word from it exactly the same way --
#: ``EnemyZombieInit`` (``FUN_00452DA0``) does ``MOVSX EDX, word ptr
#: [ESI + 0x1316]`` (``0fbf9616130000``) at 0x00452E9A, ``OR EDX, 0x60000000``
#: (``81ca00000060``), ``MOV dword ptr [ESI + 0x136c], EDX``
#: (``89966c130000``) at 0x00452EAF -- so the field is exported for both
#: classes. **[proved]** The names of class 0x30's bits are [open] here and
#: belong with that class.
#:
#: Beware: ``obj+0x1316`` is polymorphic like the rest of the tail.
#: ``FUN_00431810`` increments it as a counter and ``ScriptedHumanoidUpdate``
#: compares it against a register; neither is a flag word.
SPAWN_DESC_FLAGS = 0x20

#: What each player-count-gated opcode forwards to, from the table at
#: ``g_evt_spawn_gated_handlers`` (0x00577650), which is indexed by the opcode
#: itself. Entries 1-4 and 5-8 are the same four handlers, so 0x01-0x08 are
#: exactly 0x09/0x0A/0x0B/0x0C with a gate in front and nothing else changed.
GATED_SPAWN_FORWARD = {
    0x01: 0x09, 0x02: 0x0A, 0x03: 0x0B, 0x04: 0x0C,
    0x05: 0x09, 0x06: 0x0A, 0x07: 0x0B, 0x08: 0x0C,
}

#: How many players must be in play for a gated opcode to run at all --
#: ``g_max_attackers``, which is the count of players currently in a live
#: state, not a difficulty setting.
GATED_SPAWN_PLAYERS = {op: (1 if op <= 0x04 else 2) for op in GATED_SPAWN_FORWARD}


def effective_spawn_opcode(opcode: int) -> int:
    """The handler *opcode* actually runs -- itself, unless it is gated."""
    return GATED_SPAWN_FORWARD.get(opcode, opcode)


#: Opcodes whose operands are pointers to spawn descriptors.
#:
#: 0x0A and its two gated forms are absent on purpose: ``EvtOpSpawnSimple0A``
#: takes a two-word ``{class, hp}`` record, not a 0x24-byte placement
#: descriptor, so reading one as a descriptor yields a garbage position.
SPAWN_OPCODES = (0x01, 0x03, 0x04, 0x05, 0x07, 0x08,
                 0x09, 0x0B, 0x0C, 0x0D)

#: Opcodes whose operands are the two-word ``{class, hp}`` record instead.
#:
#: ``EvtOpSpawnSimple0A`` (``FUN_00408990``) walks its -1-terminated operand
#: list, and for each pointer allocates ``g_class_handlers[record[0]]`` at
#: 0x13F4 bytes and copies ``(short)record[1]`` into **both** ``obj+0x11C`` and
#: ``obj+0x11E``. Nothing writes a position: this is the opcode for objects
#: that place themselves, which in the shipped scripts is the screen furniture
#: -- the chapter card (class 0x60), the result card (0x61) and its two
#: companions (0x62, 0x63).
#:
#: 0x02 and 0x06 are the one- and two-player gated forms, through
#: ``g_evt_spawn_gated_handlers``; neither is encoded by a shipped script.
SIMPLE_SPAWN_OPCODES = (0x02, 0x06, 0x0A)

#: Opcodes that attach the descriptor's tail to the object as a per-class
#: parameter block. There are **three** allocators, not two:
#:
#: =======  ===================  ======  =====================================
#: opcode   allocator            size    tail pointer
#: =======  ===================  ======  =====================================
#: 0x09     ``FUN_004088A0``     0x13F4  none -- reads ``+0x24``/``+0x25``
#:                                       inline into ``obj+0x1F4``/``+0x130C``
#: 0x0B/0D  ``FUN_00408A20``     0x13F4  ``obj+0x1390 = descriptor + 0x24``
#: 0x0C     ``FUN_00408BC0``     0x1314  ``obj+0x130C = descriptor + 0x24``
#: =======  ===================  ======  =====================================
#:
#: **[proved]** all three end with ``= descriptor + 9`` on an ``int *``, so the
#: tail is at ``descriptor + 0x24`` regardless; only the object field and the
#: allocation size differ. ``FUN_00408A20`` additionally sets
#: ``obj+0x1316`` from the u16 at ``desc+0x20``.
#:
#: So a class handler that dereferences ``obj+0x1390`` is reading this file,
#: at ``spawn.offset + 0x24 + k``. Every field a handler names as
#: ``obj+0x1390 + k`` is therefore ``params_offset + k`` here.
#:
#: Beware: ``obj+0x1390`` is polymorphic across the codebase. ``FUN_00408770``
#: stores a pointer to a *parent actor* there instead, for objects it spawns
#: itself rather than from a descriptor.
#:
#: This is the set of *allocators*. The player-count-gated opcodes 0x03/0x04
#: and 0x07/0x08 reach them through ``effective_spawn_opcode``, so they are
#: not listed here and must not be tested against this tuple directly.
PARAM_OPCODES = (0x0B, 0x0C, 0x0D)


@dataclass
class SimpleSpawn:
    """``EvtOpSpawnSimple0A``'s whole operand: a class and a hit-point word.

    No position, no orientation and no tail -- the object places itself.
    """

    cls: int
    hp: int

    def to_json(self) -> dict:
        return {"class": self.cls, "hp": self.hp}


@dataclass
class Spawn:
    offset: int
    opcode: int
    cls: int
    init_flags: int
    pos: tuple[float, float, float]
    orient: tuple[int, int, int]
    hp: int
    #: The ``+0x20`` word, which reaches ``obj+0x1316`` and from there the
    #: class flag word ``obj+0x136C``. See :data:`SPAWN_DESC_FLAGS`. Carried
    #: whole rather than bit by bit, because that is what the engine does with
    #: it -- ``EnemyThrowerInit`` ORs 0x180000 onto the sign-extended word and
    #: stores the result.
    desc_flags: int = 0
    #: The file this descriptor was read from, so the tail can be read lazily.
    evt: "EvtFile | None" = None

    @property
    def yaw_deg(self) -> float:
        """Orientation b as degrees.

        **[proved] of the spawn path, NOT of every class.** All three spawn
        allocators copy the orientation words straight to
        ``obj+0x64/+0x68/+0x6C``, the triple every object root feeds to
        ``MatrixRotateX/Y/Z`` -- so by default all three are angles, and an
        earlier revision that hedged about the outer two was too cautious.

        But a class may then read those object fields as something else
        entirely. **[proved]** class 0x41 type 4 (``FUN_00462E10``) takes
        ``obj+0x6C`` (from ``desc+0x1C``) as an object *kind* and ``obj+0x64``
        (from ``desc+0x14``) as a *group size*. So "these are Euler angles" is
        the right default and the wrong universal: check the class before
        trusting the outer two.
        """
        return self.orient[1] * 360.0 / 65536.0

    @property
    def has_params(self) -> bool:
        """Whether this descriptor's tail reaches the object as a parameter
        block -- true only for the opcodes that write ``obj+0x1390``."""
        return effective_spawn_opcode(self.opcode) in PARAM_OPCODES

    @property
    def params_offset(self) -> int:
        """File offset of ``obj+0x1390``: the start of the parameter tail."""
        return self.offset + SPAWN_HEADER

    def param(self, at: int, kind: str = "i32"):
        """One field of the parameter tail, at byte offset *at* within it.

        *at* is the offset a class handler writes as ``obj+0x1390 + at``, so
        the two can be compared without arithmetic. Returns ``None`` when this
        descriptor carries no parameter block or the field runs off the end.
        """
        if self.evt is None or not self.has_params:
            return None
        fmt = {"i32": "<i", "u32": "<I", "i16": "<h", "u16": "<H",
               "i8": "<b", "u8": "<B", "f32": "<f"}[kind]
        off = self.params_offset + at
        if off < 0 or off + struct.calcsize(fmt) > len(self.evt.raw):
            return None
        return struct.unpack_from(fmt, self.evt.raw, off)[0]


def read_spawn(evt: EvtFile, off: int, opcode: int = 0x09) -> Spawn:
    """Decode the descriptor header at *off*."""
    cls, flags = struct.unpack_from("<2I", evt.raw, off)
    pos = struct.unpack_from("<3f", evt.raw, off + 0x08)
    orient = struct.unpack_from("<3i", evt.raw, off + 0x14)
    # +0x22 reaches BOTH obj+0x11C and obj+0x11E. Several classes use
    # obj+0x11C as a sub-type selector rather than a hit-point count --
    # class 0x28 indexes a 4-entry route table with it, class 0x33 picks one
    # of eleven handlers, class 0x26 one of eight states -- so the name `hp`
    # is the historical one, not a claim. See docs/formats/evt.md.
    hp = struct.unpack_from("<H", evt.raw, off + 0x22)[0]
    # +0x20 -> obj+0x1316 -> the class flag word obj+0x136C. See
    # SPAWN_DESC_FLAGS: this used to be documented as unused and is not.
    desc = struct.unpack_from("<H", evt.raw, off + SPAWN_DESC_FLAGS)[0]
    return Spawn(off, opcode, cls, flags, pos, orient, hp, desc, evt)


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


def read_simple_spawn(evt: EvtFile, word: int) -> "SimpleSpawn | None":
    """One ``{class, hp}`` record, as ``EvtOpSpawnSimple0A`` reads it."""
    at = evt.resolve(word)
    if at is None:
        return None
    src, off = at
    if off + 8 > len(src.raw):
        return None
    cls = src.w(off)
    hp = src.w(off + 4)
    # ``*(short *)(obj + 0x11e) = (short)record[1]`` -- a 16-bit store, so the
    # shipped 0xFFFF0000 is a zero and not a 4-billion hit-point count.
    hp = ((hp & 0xFFFF) ^ 0x8000) - 0x8000
    return SimpleSpawn(cls=cls, hp=hp)


def load(path: str, n_blocks: int | None = None,
         com: EvtFile | None = None) -> EvtFile:
    import os

    with open(path, "rb") as fh:
        f = EvtFile(fh.read(), os.path.basename(path))
    f.com = com
    return f.parse(n_blocks)
