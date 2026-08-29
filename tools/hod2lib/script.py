"""The event script as a *resolved* program, not a byte stream.

:mod:`hod2lib.evt` decodes the bytecode: opcodes, operand lengths, block and
step structure. It deliberately stops there, because the numbers an
instruction carries are meaningless without the tables in ``Hod2.exe`` -- an
asset slot id, a pol file index and a texture id are three different id spaces
that all look like small integers.

This module does that join, once. It produces a :class:`Program`: blocks,
steps and instructions with every operand resolved to a filename, a region, a
camera path slot or a spawn descriptor, plus the route table that orders the
blocks.

Two consumers, one decoder:

* ``tools/dump_stage_script.py`` renders it as text a human reads;
* ``hod2lib.bundle`` serialises it as the JSON the browser player interprets.

That is the point of the module. An operand-resolution bug shows up in both,
so the text dump stays a valid oracle for the bundle.

References: docs/formats/evt.md, docs/formats/pipeline.md.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from . import coli as colilib, evt, exetab


def _as_f32(word: int) -> float:
    """Reinterpret an operand dword as the float the handler reads it as.

    Several opcodes take float operands the bytecode stores as raw dwords --
    ``set_approach_rings``'s ROM defaults decode as ``{25, 38, 51}``, which as
    integers would read ``0x41C80000``. Non-finite results are reported as
    None rather than smuggled into JSON as NaN.
    """
    v = struct.unpack("<f", struct.pack("<I", word & 0xFFFFFFFF))[0]
    return v if v == v and abs(v) != float("inf") else None


def _bams_deg(word: int) -> float:
    """A BAMS angle as degrees. 0x4000 is 90 degrees, and the game reads every
    angle this way (through ``__ftol``)."""
    v = word - 0x100000000 if word >= 0x80000000 else word
    return v * 360.0 / 65536.0

__all__ = ["Resolver", "Program", "ScriptBlock", "Step", "Op", "load",
           "ROUTE_KIND", "WAIT_CONDITIONS", "CATEGORY"]

ROUTE_KIND = {0: "goto", 1: "branch", 2: "end"}

#: ``queue_event`` selector names come from :mod:`hod2lib.evt`, which is where
#: the handler table was transcribed. Aliased rather than copied so the two
#: cannot drift.
QUEUE_ACTIONS = evt.QUEUE_ACTIONS

#: Row 2 of the scene state table at 0x00576C14 -- the camera row, reached by
#: ``queue_event`` selector 0x21. Only 4, 6 and 7 occur in shipped data.
CAMERA_STATES: dict[int, str] = {
    4: "snap_to_path_eye",
    5: "path_with_impulse_shake",
    6: "play_stashed_path",          # publishes the current frame
    7: "play_stashed_path_exclusive",  # as 6, but `<` on the end frame
}

#: What each blocking opcode waits on, from the recovered handlers. These are
#: what make the script a timeline rather than a batch: they set the
#: interpreter's yield flag and do not advance ``pc`` until the condition
#: holds. See the opcode reference in docs/formats/evt.md.
WAIT_CONDITIONS: dict[int, str] = {
    0x40: "queued events pending == 0",
    0x41: "camera path frame past arg (arg 0 = end of path)",
    0x42: "arg frames elapsed",
    0x43: "enemies present <= arg, and the camera has settled",
    0x44: "enemies alive <= arg",
    0x45: "script flag arg set",
    0x46: "scripted actor count <= arg",
    0x47: "camera settled and no live targetable entity",
}

#: The two collision-set opcodes. Their operands are relocated absolute
#: pointers into the coli/ load buffers, not indices -- 0x10 selects the set
#: consulted by both the ray and the sphere queries, 0x11 the ray-only set.
#: See docs/formats/coli.md.
COLLISION_SET_OPCODES = (0x10, 0x11)

#: Coarse categories, for the player's event feed. Two of these groupings are
#: corrections that cost real time to establish, so they are worth stating:
#: the 0x20-0x27 family is **fog and light**, not the per-player view structs
#: an earlier reading called them; and 0x1A is filed under *camera* because
#: that is what the player does with it -- it is `g_camera_fixed_eye_y` as
#: well as the ground plane, and opcode 0x36 selects between them.
_CATEGORIES: dict[str, tuple[int, ...]] = {
    "spawn":     (*range(0x01, 0x0E), 0x0E, 0x0F, 0x12, 0x4B),
    "collision": (0x10, 0x11),
    "light":     (0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, *range(0x20, 0x28)),
    "scenery":   (0x1B, 0x1C, 0x1D),
    "hud":       (0x1F, 0x2D),
    "camera":    (0x1A, 0x30, 0x35, 0x36, 0x37),
    "region":    (0x28, 0x29),
    "audio":     (0x38, 0x39, 0x3A, 0x3B, 0x2E, 0x5D, 0x5E, 0x5F),
    "wait":      tuple(range(0x40, 0x48)),
    "flow":      (0x2B, 0x2C, 0x2F, 0x31, 0x32, 0x33, 0x48, 0x49, 0x4A,
                  0x4D, 0x4E, 0x4F),
    "assets":    tuple(range(0x50, 0x5B)),
    # Proved no-ops, and the one opcode whose global has no readers anywhere
    # in the binary. Grouped so the feed can render them quietly rather than
    # implying something happened.
    "nop":       (0x1E, 0x3D, 0x3E, 0x3F, 0x5B, 0x5C),
    # Dispatch slots that map to the empty stub. No shipped file encodes one;
    # seeing one in a feed means the decoder went wrong.
    "unused":    (0x00, 0x2A, 0x34, 0x3C, 0x4C),
}

CATEGORY: dict[int, str] = {
    op: name for name, ops in _CATEGORIES.items() for op in ops
}

#: Every opcode the interpreter can dispatch must be categorised, or the
#: player silently files a real instruction under "misc". Checked at import
#: because the opcode table is edited far more often than this map.
_uncategorised = sorted(set(evt.OPCODES) - set(CATEGORY))
if _uncategorised:  # pragma: no cover - a developer error, not a data one
    raise RuntimeError(
        "hod2lib.script.CATEGORY is missing opcodes: "
        + ", ".join(f"0x{o:02X} ({evt.OPCODES[o][0]})" for o in _uncategorised))
del _uncategorised


# ---------------------------------------------------------------------------
# operand resolution
# ---------------------------------------------------------------------------


class Resolver:
    """Turns event operands into names, using ``Hod2.exe``'s tables.

    Three id spaces reach the same handful of opcodes and all look like small
    integers. Confusing them is the single easiest way to produce a
    plausible-looking wrong answer, so each opcode's operand is resolved
    through exactly the table its handler uses:

    ==========  ==========================================================
    ``0x50/51``  asset **slot** id -> (pol file, entry index)
    ``0x52/53``  pol **file** index -> filename
    ``0x54-57``  tex **file** index -> filename
    ``0x28/29``  **region** id -> the scene's region table
    ==========  ==========================================================
    """

    def __init__(self, tables: exetab.ExeTables):
        self.tables = tables
        self.slots = tables.asset_slots()
        self.pol = tables.pol_files()
        self.tex = self._tex_names(tables)

    @staticmethod
    def _tex_names(t: exetab.ExeTables) -> dict[int, str]:
        out: dict[int, str] = {}
        for i in range(512):
            p = t._u32(exetab.TEX_NAME_TABLE + i * 4)
            if p:
                n = t._cstr(p)
                if n:
                    out[i] = n
        return out

    # -- text form ---------------------------------------------------------

    def operand_text(self, ins: evt.Instr) -> str:
        """One line of operand text, as ``dump_stage_script.py`` prints it."""
        v = ins.raw[0] if ins.raw else 0
        if ins.opcode in evt.SLOT_OPCODES:
            r = self.slots.get(v)
            return f"slot {v} = {r[0]}[{r[1]}]" if r else f"slot {v} = ?"
        if ins.opcode in (0x52, 0x53):
            r = self.pol.get(v)
            return f"pol {v} = {r[0]}" if r else f"pol {v} = ?"
        if ins.opcode in (0x54, 0x55, 0x56, 0x57):
            return f"tex {v} = {self.tex.get(v, '?')}"
        return " ".join("%08X" % w for w in ins.words)

    @staticmethod
    def detail_text(op) -> str | None:
        """A line rendered from an already-decoded :class:`Op`, or None.

        ``operand_text`` above only sees the raw instruction, so it cannot
        resolve anything that needed more than the EXE tables. Collision-set
        pointers need the `coli/` files, and those are decoded into
        ``op.detail`` when the Program is built.
        """
        if op.opcode not in COLLISION_SET_OPCODES:
            return None
        meshes = op.detail.get("meshes") or []
        if not meshes:
            return f"{op.detail.get('set', '?')}: clear"
        parts = []
        for m in meshes:
            if "file" in m:
                parts.append(f"{m['file']}+{m['offset']:#x}"
                             f"({m.get('quads', '?')}q "
                             f"surf {','.join(str(x) for x in m.get('surfaces', []))})")
            else:
                parts.append(f"{m['address']:#010x}=UNRESOLVED")
        return f"{op.detail.get('set', '?')}: " + " ".join(parts)

    def asset_name(self, ins: evt.Instr) -> str | None:
        """The file an asset opcode touches, or None if it touches none."""
        v = ins.raw[0] if ins.raw else 0
        if ins.opcode in evt.SLOT_OPCODES:
            r = self.slots.get(v)
            return r[0] if r else None
        if ins.opcode in (0x52, 0x53):
            r = self.pol.get(v)
            return r[0] if r else None
        if ins.opcode in (0x54, 0x55, 0x56, 0x57):
            return self.tex.get(v)
        return None


# ---------------------------------------------------------------------------
# the program
# ---------------------------------------------------------------------------


@dataclass
class Op:
    """One instruction, decoded and resolved."""

    index: int
    offset: int
    opcode: int
    name: str
    category: str
    words: list[int]
    raw: list[int]
    detail: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        out = {"i": self.index, "at": self.offset, "op": self.opcode,
               "name": self.name, "cat": self.category}
        out.update(self.detail)
        return out


@dataclass
class Step:
    index: int
    offset: int
    ops: list[Op] = field(default_factory=list)

    def to_json(self) -> dict:
        return {"index": self.index, "at": self.offset,
                "ops": [o.to_json() for o in self.ops]}


@dataclass
class ScriptBlock:
    index: int
    offset: int
    steps: list[Step] = field(default_factory=list)
    external_steps: list[tuple[int, int]] = field(default_factory=list)
    route: tuple[int, int, int, int] = (0, -1, -1, -1)

    @property
    def is_hole(self) -> bool:
        """A block the scene's route graph never visits.

        The root pointer array stores -1 for these. It is a *hole*, not a
        terminator -- sizing the array by stopping at the first -1 loses
        blocks.
        """
        return self.offset < 0

    @property
    def route_kind(self) -> str:
        return ROUTE_KIND.get(self.route[0], f"?{self.route[0]}")

    @property
    def route_targets(self) -> list[int]:
        return [x for x in self.route[1:] if x >= 0]

    def to_json(self) -> dict:
        out: dict = {"index": self.index, "at": self.offset,
                     "route": {"kind": self.route_kind,
                               "next": list(self.route[1:])}}
        if self.is_hole:
            out["hole"] = True
            return out
        out["steps"] = [s.to_json() for s in self.steps]
        if self.external_steps:
            out["external_steps"] = [{"index": i, "ptr": p}
                                     for i, p in self.external_steps]
        return out


class Program:
    """A whole scene's script: blocks, steps, resolved instructions, routes."""

    def __init__(self, stage, resolver: Resolver | None = None):
        self.stage = stage
        self.scene = stage.scene
        self.evt_name = stage.evt_file
        self.resolver = resolver or Resolver(stage.tables)
        self.evt = stage.evt()
        self.routes = stage.routes
        self.blocks: list[ScriptBlock] = []
        self.warnings: list[str] = list(self.evt.warnings) if self.evt else []
        if self.evt is not None:
            self._build()

    # -- construction ------------------------------------------------------

    def _build(self) -> None:
        campaths = self.stage.campaths()
        for b in self.evt.blocks:
            route = (tuple(self.routes[b.index]) if b.index < len(self.routes)
                     else (0, -1, -1, -1))
            blk = ScriptBlock(index=b.index, offset=b.offset,
                              external_steps=list(b.external_steps),
                              route=route)
            if not blk.is_hole:
                for si, prog in enumerate(b.programs):
                    step = Step(index=si,
                                offset=b.steps[si] if si < len(b.steps) else -1)
                    for oi, ins in enumerate(prog):
                        step.ops.append(self._decode(oi, ins, campaths))
                    blk.steps.append(step)
            self.blocks.append(blk)

    def _decode(self, index: int, ins: evt.Instr, campaths) -> Op:
        r = self.resolver
        op = Op(index=index, offset=ins.offset, opcode=ins.opcode,
                name=ins.name, category=CATEGORY.get(ins.opcode, "misc"),
                words=list(ins.words), raw=list(ins.raw))
        d = op.detail
        arg0 = ins.raw[0] if ins.raw else 0

        if ins.opcode in evt.SLOT_OPCODES:
            rec = r.slots.get(arg0)
            d["slot"] = arg0
            if rec:
                d["file"], d["entry"] = rec[0], rec[1]
        elif ins.opcode in (0x52, 0x53):
            rec = r.pol.get(arg0)
            d["pol"] = arg0
            if rec:
                d["file"] = rec[0]
        elif ins.opcode in (0x54, 0x55, 0x56, 0x57):
            d["tex"] = arg0
            name = r.tex.get(arg0)
            if name:
                d["file"] = name
        elif ins.opcode in evt.REGION_OPCODES:
            d["region"] = arg0
        elif ins.opcode in COLLISION_SET_OPCODES:
            d["set"] = "full" if ins.opcode == 0x10 else "ray_only"
            d["meshes"] = self._decode_collision_set(ins)
        elif ins.opcode == 0x30:
            d.update(self._decode_queue(ins, campaths))
        elif ins.opcode in evt.SPAWN_OPCODES:
            d["spawns"] = self._decode_spawns(ins)
        elif ins.opcode in WAIT_CONDITIONS:
            if len(ins.raw) >= 1:
                d["arg"] = ins.raw[0]
            d["blocks_on"] = WAIT_CONDITIONS[ins.opcode]
        elif ins.opcode == 0x48:                      # set_script_flag
            d["flag"] = arg0
        elif ins.opcode in (0x38, 0x3A):              # se_play
            d["sound"] = arg0
        elif ins.opcode in (0x39, 0x3B):              # se_play_3d
            d["sound"] = arg0
            d["pos_words"] = list(ins.raw[1:])
        elif ins.opcode == 0x5F:                      # bgm_entry_play
            # Consumes four operands and uses only the third: stop the current
            # BGM, then play that track id.
            d["track"] = ins.raw[2] if len(ins.raw) >= 3 else None
            d["unused_args"] = [ins.raw[0], ins.raw[1], ins.raw[3]] \
                if len(ins.raw) >= 4 else list(ins.raw)
        elif ins.opcode in (0x31, 0x32):              # goto_scene_state
            d["scene_state_minor"] = arg0
        elif ins.opcode == 0x14:                      # set_scene_lighting
            d["enabled"] = bool(arg0)
        elif ins.opcode == 0x35:
            # CamEvalPath7 evaluates a cp_ path's 7th channel (roll/bank) only
            # while this is set, and forces roll to 0 otherwise. So the client
            # must gate roll on it rather than always applying the curve.
            d["roll_enabled"] = bool(arg0)
        elif ins.opcode == 0x36:                      # pin_view_to_ground_plane
            # Selects g_camera_fixed_eye_y over the default. Three camera
            # hooks share one line:
            #     if (g_camera_use_fixed_y == 1) eye.y = g_camera_fixed_eye_y;
            #     else                           eye.y = path.y - 15.0f;
            d["use_fixed_eye_y"] = arg0 == 1
            d["enabled"] = arg0 == 1
        elif ins.opcode == 0x1A:                      # set_ground_plane_y
            # One global, two jobs: the height QueryGroundHeightAt falls back
            # to and blob shadows project onto, *and* the fixed camera eye
            # height opcode 0x36 selects.
            v = self._deref_f32(arg0)
            d["ground_y"] = v
            d["camera_fixed_eye_y"] = v
        elif ins.opcode == 0x37:                      # force_camera_path_advance
            d["force_path_advance"] = bool(arg0)
        elif ins.opcode == 0x33:                      # set_action_drain_mode
            d["drain_mode"] = arg0
            d["pending_delta"] = ins.raw[1] if len(ins.raw) > 1 else None
        elif ins.opcode == 0x2D:                      # show_screen_message
            d["message_group"] = arg0
        elif ins.opcode in (0x18, 0x19):              # set_lightN_direction
            d["pitch_deg"] = _bams_deg(ins.raw[0])
            d["yaw_deg"] = _bams_deg(ins.raw[1]) if len(ins.raw) > 1 else None
        elif ins.opcode == 0x17:                      # slerp_light0_direction
            d["pitch_deg"] = _bams_deg(ins.raw[0])
            d["yaw_deg"] = _bams_deg(ins.raw[1]) if len(ins.raw) > 1 else None
            d["frames"] = ins.raw[2] if len(ins.raw) > 2 else None
        elif ins.opcode == 0x0E:                      # set_approach_rings
            d["class"] = arg0
            d["rings"] = [_as_f32(w) for w in ins.raw[1:4]]
        elif ins.opcode in (0x1B, 0x1C, 0x1D, 0x1F):
            d["value"] = arg0
        elif ins.opcode in range(0x20, 0x28):
            d.update(self._decode_light_tween(ins))

        # Opcodes still identified only by the global they write show their
        # raw operands rather than a guessed label. The player surfaces these
        # verbatim; inventing a name for them would be worse than silence.
        if not d and ins.raw:
            d["raw"] = [f"0x{w:08X}" for w in ins.words]
        return op

    def _decode_collision_set(self, ins: evt.Instr) -> list[dict]:
        """Resolve an opcode-0x10/0x11 operand list to `coli/` blobs.

        The operands are *relocated absolute pointers* into the two collision
        buffers, not indices. Each should land exactly on a blob header --
        across the shipped scripts all 86 do -- so a missing ``file`` here
        means the reading is wrong, not that the data is unusual.
        """
        out: list[dict] = []
        sets = self.stage.colisets()
        for word in ins.raw:
            if word == 0xFFFFFFFF:
                continue
            entry: dict = {"operand": word,
                           "address": colilib.resolve_pointer(word)}
            hit = colilib.pointer_to_offset(word, *sets) if sets else None
            if hit:
                fname, off = hit
                entry["file"], entry["offset"] = fname, off
                f = next(x for x in sets if x.name == fname)
                blob = next((b for b in f.blobs if b.offset == off), None)
                if blob is not None:
                    quads = blob.quads
                    entry["quads"] = len(quads)
                    entry["surfaces"] = sorted({q.surface for q in quads})
            out.append(entry)
        return out

    def _decode_queue(self, ins: evt.Instr, campaths) -> dict:
        """``queue_event`` -- the scripted-action ring.

        ``handler = table[sel >> 4][sel & 0xF]``; the high nibble is both the
        group index and the operand count.
        """
        if not ins.raw:
            return {}
        sel = ins.raw[0]
        args = list(ins.raw[1:])
        out: dict = {"sel": sel, "action": QUEUE_ACTIONS.get(sel, f"sel_{sel:02X}"),
                     "args": args}
        if sel == 0x40 and len(args) >= 4:
            # queue_event 0x40, start_frame, end_frame, path_slot, flags
            #
            # args[1] is the END FRAME: CamStartPathPlayback loads the frame
            # counter (+0x144) from args[0] and the terminator (+0x148) from
            # args[1], and CamAdvancePathFrame increments until it reaches it.
            # Shipped data confirms it -- consecutive commands tile a path
            # exactly (0-50, 51-89, 90-169, 170-205, 206-300, 301-465, all
            # slot 59).
            start = args[0] if args[0] < 0x80000000 else args[0] - 0x100000000
            end = args[1] if args[1] < 0x80000000 else args[1] - 0x100000000
            out.update({"start": start, "end": end, "slot": args[2],
                        "flags": args[3]})
            # start == end holds a fixed pose (CamEvalStaticPose);
            # start == -1 resumes from the current frame rather than seeking.
            out["static"] = start == end
            out["resume"] = start == -1
            ref = campaths.get(args[2])
            if ref is not None:
                out["cam"] = {"file": ref.file, "path": ref.index,
                              "duration": ref.duration}
            else:
                out["cam"] = None
        elif sel == 0x21 and args:
            # EvtEnterSceneState(2, op0). Row 2 of the state table at
            # 0x00576C14 is the camera row, and its live cells are exactly the
            # operands that occur: 4 CameraSnapToPathEye, 6 and 7 the two
            # routines that play the range a deferred 0x40 stashed.
            #
            # This is NOT "hand control back from a path", which an earlier
            # reading of the same selector claimed.
            out["scene_state"] = {"major": 2, "minor": args[0]}
            out["camera_state"] = CAMERA_STATES.get(args[0])
        elif sel == 0x11 and args:
            out["scene_state"] = {"major": "current", "minor": args[0]}
        elif sel == 0x20 and len(args) >= 2:
            out["frames"], out["preset"] = args[0], args[1]
        elif sel == 0x60 and len(args) >= 6:
            # The arcade branch-preview shots -- one camera pose per route the
            # branch can take. **Proved**, by reading both halves:
            #
            # EvtActionStoreSixOperands60 scatters the operands
            #     009C6FE0 = args[0]   009C6FDC = args[1]
            #     009C6FE8 = args[2]   009C6FE4 = args[3]
            #     009C6FF0 = args[4]   009C6FEC = args[5]
            # and FUN_00403DB0 reads them back as
            #     path  = *(&009C6FDC + branch_choice * 8)
            #     frame = *(&009C6FE0 + branch_choice * 8)
            #
            # so they are three (frame, slot) pairs indexed by the branch
            # choice -- note the order, which is frame first. An earlier note
            # in PLAYER_PLAN.md guessed "(slot, frame)" and had it backwards.
            out["branch_preview"] = [
                {
                    "choice": i // 2,
                    "frame": args[i],
                    "slot": args[i + 1],
                    "cam": (lambda ref: {"file": ref.file, "path": ref.index}
                            if ref else None)(campaths.get(args[i + 1])),
                }
                for i in range(0, 6, 2)
            ]
        return out

    def _decode_spawns(self, ins: evt.Instr) -> list[dict]:
        """Resolve a spawn opcode's pointer list to descriptor headers."""
        out: list[dict] = []
        seen: set[int] = set()
        for w in ins.raw:
            off = self.evt.to_offset(w)
            if off is None or off in seen:
                continue
            if not (0 <= off <= len(self.evt.raw) - evt.SPAWN_HEADER):
                continue
            seen.add(off)
            s = evt.read_spawn(self.evt, off, ins.opcode)
            out.append({
                "at": s.offset,
                "class": s.cls,
                "flags": s.init_flags,
                "pos": [s.pos[0], s.pos[1], s.pos[2]],
                # +0x18 is a BAMS yaw (0x4000 == 90 deg). +0x14 and +0x1C
                # reach object +0x64/+0x6C and are plausibly the other two
                # Euler angles, but their value distributions do not look
                # like angles -- so they are carried raw, not as rotations.
                "yaw_deg": s.yaw_deg,
                "orient": list(s.orient),
                "hp": s.hp,
            })
        return out

    def _decode_light_tween(self, ins: evt.Instr) -> dict:
        """The 0x20-0x27 family: ``[op][channel][...]``.

        These drive the two **scene light / fog blocks**, not per-player view
        structs -- a reading overturned at the renderer end. Block 0 is pushed
        to the device every frame; block 1 only at scene init.
        """
        if not ins.raw:
            return {}
        sub = ins.raw[0]
        out = {"light_block": 0 if ins.opcode < 0x24 else 1,
               "channel": sub,
               "channel_name": evt.CHANNELS.get(sub, f"sub_{sub}")}
        vals = ins.raw[1:]
        if not vals:
            return out

        # The tween block is `{enabled, from, to, rate}` per channel, and the
        # two handlers fill it differently:
        #
        #   0x21 tween_rate  [op][ch][to][rate]    rate is a per-frame step
        #   0x23 tween_time  [op][ch][to][frames]  rate = |to - from| / frames,
        #                                          pre-divided by the handler
        #   0x20 set         [op][ch][value]       immediate
        #
        # Which operands are pointers to float constants and which are inline
        # integers depends on the channel, and the handlers are explicit about
        # it: the fog *colour* channels (2, 3, 4 and the 5 that sets all three)
        # read their target inline and convert int -> float, everything else
        # dereferences. `frames` is always inline.
        inline_target = sub in (2, 3, 4, 5)

        def target(word: int):
            return float(word) if inline_target else self._deref_f32(word)

        if sub in (5, 9):
            if ins.opcode == 0x20:
                out["components"] = list(vals)
                return out
            # One target applied to all three components.
            t = target(vals[0])
            out["components"] = [t, t, t] if t is not None else None
            out["value"] = t
        else:
            out["value"] = target(vals[0])
            if out["value"] is None:
                out["raw_value"] = f"0x{vals[0]:08X}"

        if ins.opcode == 0x21 and len(vals) >= 2:
            out["tween"] = "rate"
            out["rate"] = self._deref_f32(vals[1])
        elif ins.opcode == 0x23 and len(vals) >= 2:
            out["tween"] = "time"
            out["frames"] = vals[1]
        return out

    def _deref_f32(self, word: int) -> float | None:
        """Read the float an operand points at, or None if it is not a pointer.

        Operands are stored un-relocated, so ``EvtFile.to_offset`` -- which
        subtracts the Dreamcast load base -- takes the raw word.
        """
        off = self.evt.to_offset(word)
        if off is None or not (0 <= off <= len(self.evt.raw) - 4):
            return None
        v = struct.unpack_from("<f", self.evt.raw, off)[0]
        return v if v == v and abs(v) != float("inf") else None

    # -- views -------------------------------------------------------------

    def live_blocks(self) -> list[ScriptBlock]:
        return [b for b in self.blocks if not b.is_hole]

    def branch_blocks(self) -> list[ScriptBlock]:
        return [b for b in self.blocks if b.route[0] == exetab.ExeTables.ROUTE_BRANCH]

    def entry_block(self) -> int:
        """Where the scene starts.

        Block 0 in every shipped scene: the route table is a forward graph
        with no separate entry record.
        """
        for b in self.blocks:
            if not b.is_hole:
                return b.index
        return 0

    def entry_step(self) -> int:
        """Which step of the entry block runs first.

        Not 0. ``FUN_0045EBC0`` picks it by game mode and scene state:

        ===========================================  ====
        scene state 5 or 9 (continue / checkpoint)     0
        game mode 3 (a training or demo mode)          0
        game mode 2                                    0
        game mode 1 (Original) **and scene 0**         5
        everything else -- normal Arcade play          1
        ===========================================  ====

        This is the same rule ``EvtAdvanceBlockOrRoute`` follows on every
        later block change, where it sets the step index to 1 outright. Step 0
        is reached only through the checkpoint path, which is why it is
        presented as checkpoint state rather than run inline.
        """
        if self.stage_game_mode == 1 and self.scene == 0:
            return 5
        return 1

    @property
    def stage_game_mode(self) -> int:
        return self.stage.game_mode

    def cam_slots_used(self) -> list[int]:
        out: set[int] = set()
        for b in self.live_blocks():
            for s in b.steps:
                for o in s.ops:
                    if o.detail.get("action") == "cam_play":
                        out.add(o.detail["slot"])
        return sorted(out)

    def to_json(self) -> dict:
        return {
            "scene": self.scene,
            "stage": self.stage.stage,
            "game_mode": self.stage.game_mode,
            "evt_file": self.evt_name,
            "entry_block": self.entry_block(),
            "entry_step": self.entry_step(),
            "routes": [{"kind": ROUTE_KIND.get(k, f"?{k}"), "next": [a, b, c]}
                       for k, a, b, c in self.routes],
            "blocks": [b.to_json() for b in self.blocks],
            "warnings": self.warnings,
        }


def load(stage) -> Program:
    """Resolve a :class:`hod2lib.stage.Stage`'s event script."""
    return Program(stage)
