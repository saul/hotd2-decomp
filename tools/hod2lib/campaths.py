"""Slot-keyed `cam/` path resolution.

A `cam/` file numbers its paths from zero, but nothing in the game ever refers
to a path that way. Every consumer -- the event script's ``queue_event`` sel
``0x40``, the runtime descriptor array at ``DAT_0059C9F8``, the owning-file
byte table at ``DAT_004C479C`` -- uses a **global slot id** drawn from a single
0..417 space that all 23 files tile between them.

This module is the one place that join is made. Give it a set of parsed
:class:`hod2lib.cam.CamFile` objects and an :class:`hod2lib.exetab.ExeTables`,
and it hands back ``{global_slot: PathRef}``.

Both the glTF exporter and the player bundle need exactly that mapping, and
having two copies of it is how the exported rails and the script's camera
events would come to disagree about which curve slot 59 is.

Reference: docs/formats/cam.md, section *Binding*.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import cam as camlib

__all__ = ["PathRef", "CamPaths"]


@dataclass(frozen=True)
class PathRef:
    """One `cam/` path, addressed the way the game addresses it."""

    slot: int                 #: global path slot id, 0..417
    file: str                 #: owning cam file stem, e.g. ``cp_st2``
    index: int                #: path index within that file
    path: camlib.Path         #: the parsed curves

    @property
    def is_object_path(self) -> bool:
        return self.file.startswith("op_")

    @property
    def channel_names(self) -> tuple[str, ...]:
        return (camlib.OP_CHANNELS if self.is_object_path
                else camlib.CP_CHANNELS)

    @property
    def duration(self) -> float:
        """Length in frames (the cam/ timebase is 60 Hz frame numbers)."""
        return self.path.duration

    @property
    def start_frame(self) -> float:
        for c in self.path.channels.values():
            ks = c.keys
            if ks:
                return ks[0].time
        return 0.0


class CamPaths:
    """The global path-slot space, resolved over a set of parsed cam files."""

    def __init__(self, tables, cam_files):
        self.by_slot: dict[int, PathRef] = {}
        self.by_file: dict[str, list[PathRef]] = {}
        self._tables = tables
        #: What the parse could not make sense of, per file.
        #:
        #: `CamFile.warnings` -- a descriptor running past the end of the file,
        #: a channel index that is not a curve start -- existed and was read by
        #: `verify_phase6.py` alone, which runs over the *game directory*.
        #: Nothing on the export path looked at it, so a stage whose `cam/`
        #: file had a bad descriptor exported a bundle quietly missing those
        #: paths, and the camera simply did not move where it should have.
        #: `evt`'s equivalent has travelled in the stage JSON since the
        #: beginning and `stage_load.ts` surfaces it; this is the same channel
        #: for the other half of the same scene.
        self.warnings: list[str] = []

        for cf in cam_files:
            for w in cf.warnings:
                self.warnings.append(f"{cf.name}: {w}")
            stem = cf.name[:-4] if cf.name.endswith(".bin") else cf.name
            slots = tables.cam_slots_for(stem) if tables else []
            refs: list[PathRef] = []
            for path in cf.paths:
                # The slot list is in path order; a file with no EXE entry
                # (there are none in the shipped game, but a caller may hand
                # us a loose file) simply has no global identity.
                if path.index >= len(slots):
                    continue
                slot = slots[path.index]
                if slot < 0:
                    continue
                ref = PathRef(slot=slot, file=stem, index=path.index, path=path)
                self.by_slot[slot] = ref
                refs.append(ref)
            if refs:
                self.by_file[stem] = refs

    def get(self, slot: int) -> PathRef | None:
        return self.by_slot.get(slot)

    def __contains__(self, slot: int) -> bool:
        return slot in self.by_slot

    def __len__(self) -> int:
        return len(self.by_slot)

    @property
    def camera_slots(self) -> list[int]:
        return sorted(s for s, r in self.by_slot.items() if not r.is_object_path)

    @property
    def object_slots(self) -> list[int]:
        return sorted(s for s, r in self.by_slot.items() if r.is_object_path)

    # -- serialisation -----------------------------------------------------

    @staticmethod
    def channel_json(curve: camlib.Curve) -> list[list[float]]:
        """One curve as ``[[time, value, tangent_out, tangent_in], ...]``."""
        return [[k.time, k.value, k.tangent_out, k.tangent_in]
                for k in curve.keys]

    def path_json(self, ref: PathRef) -> dict:
        keys = {n: self.channel_json(c) for n, c in ref.path.channels.items()}
        out = {
            "file": ref.file,
            "index": ref.index,
            "start": ref.start_frame,
            "duration": ref.duration,
            "channels": keys,
        }
        # The eighth cp_ descriptor index no consumer reads. Recorded rather
        # than dropped: it is a real curve, and its purpose is still open.
        if ref.path.trailing:
            out["trailing_curve"] = ref.path.trailing
        return out

    def to_json(self, fps: float = 60.0) -> dict:
        """The `<stage>.cam.json` payload: raw Hermite curves, keyed by slot.

        Curves rather than baked samples, because the client must evaluate at
        an arbitrary frame and must be able to highlight the ``start..end``
        sub-range a single ``queue_event`` command plays. A baked LINEAR
        animation can express neither.
        """
        paths, objects = {}, {}
        for slot, ref in sorted(self.by_slot.items()):
            (objects if ref.is_object_path else paths)[str(slot)] = \
                self.path_json(ref)
        return {"fps": fps, "paths": paths, "object_paths": objects,
                "warnings": self.warnings}
