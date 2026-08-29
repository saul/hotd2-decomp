"""What a *stage* is: the single abstraction every exporter resolves against.

A stage is not a directory and not a filename glob. It is a **scene id** --
the event system's own index -- and everything else follows from tables
compiled into ``Hod2.exe``:

    scene ---> evt/ file          0x00579928 -> 0x004D1C7C
          ---> route table        0x00597890      block flow graph
          ---> region tables      0x00576A2C/0x00576A5C   (mode 1: 0x00576A8C/ABC)
          ---> geometry set       union of every region's asset slots,
                                  plus every slot opcode 0x50 loads
          ---> cam/ files         cp_st<N>, op_st<N>

This module holds that resolution once. ``export_level.py`` and
``export_player.py`` both consume it, so the glTF a human opens in Blender and
the bundle the browser player eats are guaranteed to describe the same set of
models, regions and draw modes. Duplicating the resolution is exactly how the
two would drift.

Reference: docs/formats/pipeline.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path as _Path

from . import cam as camlib, coli as colilib, container as C, evt, exetab, nl1, texbank
from .campaths import CamPaths

__all__ = ["STAGE_TO_SCENE", "SCENE_TO_STAGE", "Stage", "Part",
           "get_tables", "load_asset", "load_cam_paths"]

#: stage number -> scene id, the event system's own index.
STAGE_TO_SCENE = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}
SCENE_TO_STAGE = {v: k for k, v in STAGE_TO_SCENE.items()}

#: Reading Hod2.exe's tables costs a second or two; a process rarely wants
#: more than one game directory, and every exporter wants the tables.
_TABLES: dict[str, exetab.ExeTables] = {}


def get_tables(game: _Path) -> exetab.ExeTables | None:
    """Parsed ``Hod2.exe`` tables for a game directory, cached per process."""
    key = str(game)
    if key not in _TABLES:
        exe = _Path(game) / "Hod2.exe"
        if not exe.exists():
            return None
        _TABLES[key] = exetab.ExeTables(exe)
    return _TABLES.get(key)


@dataclass
class Part:
    """One ``pol/`` file's contribution to a stage."""

    name: str                 #: file stem, e.g. ``st2_07``
    models: list = field(default_factory=list)
    bank: object | None = None

    def __iter__(self):
        # Exporters take parts as (name, models, bank) tuples.
        return iter((self.name, self.models, self.bank))


def _bank_for(game: _Path, stem: str):
    """The ``tex/`` bank paired with a ``pol/`` file, or None.

    The EXE's descriptor table is authoritative; the prefix-sum solver is only
    a fallback for banks it does not list.
    """
    tex = game / "tex" / f"{stem}.bin"
    if not tex.exists():
        return None
    tc = C.load(tex.read_bytes())
    data = tc.data if tc.kind == C.COMPRESSED else tex.read_bytes()
    tables = get_tables(game)
    entries = tables.entries(stem) if tables else []
    if entries:
        return texbank.bank_from_exe(data, entries)
    return None


def load_asset(game: _Path, name: str):
    """Return ``(models, bank)`` for a ``pol/`` asset and its ``tex/`` bank."""
    pol = game / "pol" / f"{name}.bin"
    if not pol.exists():
        raise FileNotFoundError(f"no such asset: {pol}")

    c = C.load(pol.read_bytes())
    if not c.models:
        raise ValueError(f"{name}: no models ({c.kind})")
    models = nl1.parse_container(c)

    bank = None
    tex = game / "tex" / f"{name}.bin"
    if tex.exists():
        tc = C.load(tex.read_bytes())
        data = tc.data if tc.kind == C.COMPRESSED else tex.read_bytes()
        tables = get_tables(game)
        entries = tables.entries(name) if tables else []
        if entries:
            bank = texbank.bank_from_exe(data, entries)
        else:
            descs = texbank.harvest_descriptors(models)
            if descs:
                bank = texbank.solve_layout(data, descs)
    return models, bank


def load_cam_paths(game: _Path, stage: int | None, name: str | None):
    """The ``cam/`` files belonging to a stage: ``cp_stN`` then ``op_stN``.

    Returns ``[]`` when the asset has no matching camera file, which is
    normal -- only the six stages and a handful of cutscenes have one.
    """
    stems: list[str] = []
    if stage is not None:
        stems = [f"cp_st{stage}", f"op_st{stage}"]
    elif name:
        m = re.match(r"st(\d+)_", name)      # st2_07 -> stage 2
        if m:
            stems = [f"cp_st{m.group(1)}", f"op_st{m.group(1)}"]

    out = []
    for stem in stems:
        p = _Path(game) / "cam" / f"{stem}.bin"
        if p.exists():
            out.append(camlib.load(str(p)))
    return out


class Stage:
    """One stage of the game, resolved from ``Hod2.exe``.

    Everything is lazy: constructing a ``Stage`` only reads the EXE tables, so
    it is cheap to ask what a stage *is* without paying to decode its
    geometry.
    """

    def __init__(self, game: _Path | str, *, stage: int | None = None,
                 scene: int | None = None, original: bool = False):
        self.game = _Path(game).expanduser().resolve()
        if scene is None:
            if stage is None:
                raise ValueError("give stage or scene")
            scene = STAGE_TO_SCENE.get(stage)
            if scene is None:
                raise ValueError(f"stage {stage} has no scene")
        self.scene = scene
        self.stage = stage if stage is not None else SCENE_TO_STAGE.get(scene)
        self.original = original
        self.game_mode = 1 if original else 0

        tables = get_tables(self.game)
        if tables is None:
            raise FileNotFoundError(
                f"Hod2.exe is required to resolve a stage: {self.game}")
        self.tables = tables

        self._geometry = None
        self._cam_files = None
        self._campaths = None
        self._evt = None
        self._colisets = None

    # -- identity ---------------------------------------------------------

    @property
    def name(self) -> str:
        """Bundle/export name: ``stage2``, or ``stage2_original``."""
        base = f"stage{self.stage}" if self.stage else f"scene{self.scene}"
        return base + ("_original" if self.original else "")

    @property
    def evt_file(self) -> str | None:
        return self.tables.scene_evt_file(self.scene)

    @property
    def routes(self) -> list[tuple[int, int, int, int]]:
        """``[(kind, next0, next1, next2), ...]`` -- the block flow graph."""
        return self.tables.scene_routes(self.scene)

    @property
    def block_count(self) -> int:
        return len(self.routes)

    @property
    def regions(self) -> list[list[tuple[int, int]]]:
        """``[[(asset_slot, draw_mode), ...], ...]`` indexed by region id."""
        return self.tables.scene_regions(self.scene, self.original)

    @property
    def draw_modes(self) -> dict[int, int]:
        return self.tables.scene_draw_modes(self.scene, self.original)

    # -- collision ---------------------------------------------------------

    def colisets(self) -> tuple | None:
        """``(common, per_scene)`` -- the two `coli/` files this scene loads.

        `ColiLoadForScene` (0x0048A3B0) loads `coli0.bin` for every scene plus
        `coli<scene+1>.bin`, and it guards `0 <= scene < 7`; scenes outside
        that range get no collision and this returns None.
        """
        if self._colisets is None:
            try:
                common_name, scene_name = colilib.scene_files(self.scene)
            except colilib.ColiError:
                self._colisets = ()
                return None
            d = self.game / "coli"
            try:
                self._colisets = (colilib.load(d / common_name),
                                  colilib.load(d / scene_name))
            except OSError:
                self._colisets = ()
        return self._colisets or None

    # -- event script ------------------------------------------------------

    def evt(self):
        """The parsed, relocated ``evt/`` table, or None if the scene has none."""
        if self._evt is None:
            name = self.evt_file
            if not name:
                return None
            path = self.game / "evt" / name
            if not path.exists():
                return None
            self._evt = evt.load(str(path), self.block_count)
        return self._evt

    # -- geometry ----------------------------------------------------------

    def geometry(self):
        """The authoritative geometry set for this stage.

        Globbing ``st<N>_*`` is wrong in both directions: it misses files the
        stage genuinely draws (``st3.bin``, and all of stage 6's reused
        ``st5_*`` geometry) and includes entries no region ever draws.

        The real set is the union of

          * every asset slot named by any of the scene's *regions* -- the
            sliding window the game streams and draws along the rail
            (:meth:`ExeTables.scene_regions`), and
          * every slot the event script loads with opcode ``0x50``.

        Whole-file loads (opcode ``0x52``) are deliberately excluded: those
        are spawnable actors -- enemies, characters -- instantiated at runtime
        from spawn descriptors, not placed scenery.

        With ``original`` set, the mode-1 region id tables are used instead --
        Original Mode. Region membership is byte-identical between the two
        modes; only a handful of id entries point at different models,
        swapping in the ``st_org00..st_org03`` files (and on stage 1,
        alternate ``st1_*`` entries) that Arcade Mode never draws. See
        docs/formats/pipeline.md.

        Returns ``(parts, model_regions, regions)`` where *parts* is the usual
        ``(name, models, bank)`` list, *model_regions* maps
        ``(part, model index)`` to the region ids that draw it, and *regions*
        is the raw region table.
        """
        if self._geometry is not None:
            return self._geometry

        game = self.game
        slots = self.tables.asset_slots()
        regions = self.regions

        wanted: dict[str, set[int]] = {}
        slot_regions: dict[tuple[str, int], set[int]] = {}
        for ri, region in enumerate(regions):
            for slot, _mode in region:
                rec = slots.get(slot)
                if not rec:
                    continue
                wanted.setdefault(rec[0], set()).add(rec[1])
                slot_regions.setdefault(rec, set()).add(ri)

        ev = self.evt()
        if ev is not None:
            for blk in ev.blocks:
                if blk.offset < 0:
                    continue
                for prog in blk.programs:
                    for ins in prog:
                        if ins.opcode in evt.SLOT_OPCODES and ins.raw:
                            rec = slots.get(ins.raw[0])
                            if rec:
                                wanted.setdefault(rec[0], set()).add(rec[1])

        draw_modes = self.draw_modes
        slot_of: dict[tuple[str, int], int] = {v: k for k, v in slots.items()}
        parts, model_regions = [], {}
        for fname in sorted(wanted):
            stem = fname[:-4] if fname.endswith(".bin") else fname
            pol = game / "pol" / fname
            if not pol.exists():
                continue
            cont = C.load(pol.read_bytes())
            bank = _bank_for(game, stem)
            models, order = [], sorted(wanted[fname])
            for entry in order:
                if entry >= cont.model_count:
                    continue
                try:
                    got = nl1.parse(cont.model(entry))
                except Exception:
                    continue
                for m in (got if isinstance(got, list) else [got]):
                    slot_id = slot_of.get((fname, entry))
                    model_regions[(stem, len(models))] = {
                        "regions": sorted(slot_regions.get((fname, entry), ())),
                        "draw_mode": (draw_modes.get(slot_id, 0)
                                      if slot_id is not None else 0),
                        "slot": slot_id,
                        "entry": entry,
                    }
                    models.append(m)
            if models:
                parts.append((stem, models, bank))
        self._geometry = (parts, model_regions, regions)
        return self._geometry

    # -- cameras -----------------------------------------------------------

    def cam_files(self):
        """``[cp_st<N>, op_st<N>]``, parsed."""
        if self._cam_files is None:
            self._cam_files = load_cam_paths(self.game, self.stage, None)
        return self._cam_files

    def campaths(self) -> CamPaths:
        """The stage's ``cam/`` paths keyed by their global slot id."""
        if self._campaths is None:
            self._campaths = CamPaths(self.tables, self.cam_files())
        return self._campaths

    # -- description -------------------------------------------------------

    def region_json(self) -> list[list[dict]]:
        """Region table with every slot resolved to a file and entry index."""
        slots = self.tables.asset_slots()
        return [[{"slot": s, "draw_mode": m,
                  "file": slots.get(s, ("?", 0))[0],
                  "entry": slots.get(s, ("?", 0))[1]} for s, m in reg]
                for reg in self.regions]

    def source_files(self) -> list[_Path]:
        """Every file on disk this stage's export is derived from.

        Recorded in the bundle manifest by SHA-256, so a bundle built from a
        different game build is detectable rather than mysteriously wrong.
        """
        out = [self.game / "Hod2.exe"]
        if self.evt_file:
            p = self.game / "evt" / self.evt_file
            if p.exists():
                out.append(p)
        com = self.game / "evt" / "comevtbl.bin"
        if com.exists():
            out.append(com)
        for cf in self.cam_files():
            p = self.game / "cam" / cf.name
            if p.exists():
                out.append(p)
        parts, _, _ = self.geometry()
        for stem, _models, _bank in parts:
            for sub in ("pol", "tex"):
                p = self.game / sub / f"{stem}.bin"
                if p.exists():
                    out.append(p)
        return out
