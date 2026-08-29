"""Writes the static bundle the browser player loads.

The player does **not** parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe`.
Re-implementing `lz`, `container`, `nl1`, `texbank`, `exetab`, `cam`, `evt` and
the PowerVR2 decoder in TypeScript would be ~2500 lines and, worse, a second
implementation of every format that could drift from this one. So Python
pre-processes and the browser consumes.

The cost is stated plainly: the user runs ``tools/export_player.py`` once
before opening the player. What that buys is exactly one implementation of
every format, with ``dump_stage_script.py`` still a valid text oracle for the
JSON the browser eats, because both come out of :mod:`hod2lib.script`.

Layout::

    extract/player/
      manifest.json                stages present, tool version, source hashes
      stage2/
        stage2.glb                 geometry, materials, textures (or .gltf set)
        stage2.cam.json            Hermite curves keyed by global path slot
        stage2.script.json         the resolved event script and route graph
      stage2_original/             game mode 1, same shape

``manifest.json`` records the SHA-256 of every source file consumed, so a
bundle built from a different game build is detectable rather than
mysteriously wrong -- the same principle as ``manifest.csv``.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from . import __version__, gltf, rigs as rigslib, script as scriptlib

__all__ = ["BUNDLE_FORMAT", "build_stage", "write_manifest"]

#: Bumped when the on-disk shape changes in a way the client must notice. The
#: client refuses a bundle it does not know how to read rather than rendering
#: something subtly wrong.
BUNDLE_FORMAT = 1


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


#: Stage number -> the index in the BGM tables of that stage's own track.
#: The event script never plays these: every `bgm_entry_play` in the six
#: stage scripts names a *boss* or *transition* track, so the opening track is
#: started outside the event system by a path that has not been traced. The
#: names are unambiguous (`ST1_AR.WAV` ... `ST6_AR.WAV`), so the player offers
#: the stage track by name and labels it as not script-driven.
STAGE_BGM_INDEX = {1: 1, 2: 0, 3: 17, 4: 16, 5: 18, 6: 19}


def bgm_json(tables, stage_number: int | None, game_mode: int) -> dict:
    """The BGM mapping a stage needs: ids to filenames, plus its own track.

    Both tables travel, because which one the game picks depends on runtime
    state (`DAT_009C8E98 == 6 && g_GameMode == 0` selects the plain names, and
    everything else the `_AR` mix). The client defaults to the same rule it
    can actually evaluate -- Arcade gets `_AR`, which is what every stage
    scene resolves to -- and can be pointed at the other.
    """
    names = tables.bgm_names()
    idx = STAGE_BGM_INDEX.get(stage_number or -1)
    return {
        "names": names,
        "default_table": "ar",
        "stage_track": (
            None if idx is None else {
                "index": idx,
                "id": 0x10000000 | idx,
                "ar": names["ar"][idx],
                "plain": names["plain"][idx] if idx < len(names["plain"]) else None,
                "note": "the stage's own track, named by convention rather "
                        "than by the script -- no bgm_entry_play in any stage "
                        "script starts it",
            }
        ),
        "game_mode": game_mode,
    }


def sound_json(tables) -> dict:
    """The SE and voice name tables, for the ids `se_play` can carry.

    `se_play` (0x38) is not restricted to SE: its operand goes through
    `PlaySoundId`, which dispatches on the top nibble, and the shipped scripts
    use all three namespaces through it -- 9 BGM ids, 6 voice ids and one stop
    control across the six stages. So the client needs every table, not just
    the SE one.
    """
    return {
        "se": {str(k): v for k, v in sorted(tables.se_names().items())},
        "voice": {str(k): v for k, v in sorted(tables.voice_names().items())},
    }


def backdrop_json(tables, prog) -> dict:
    """The backdrop dome presets, plus the ones this scene's script selects.

    The dome models need no special export: every preset a stage uses is
    already pulled in, because the script loads its asset slot with opcode
    0x50 and `Stage.geometry()` includes those. The client finds them by the
    `hod2_slot` extras the glTF nodes already carry.
    """
    used: dict[int, int] = {}
    for b in prog.live_blocks():
        for st in b.steps:
            for op in st.ops:
                if op.opcode == 0x1B:
                    v = op.detail.get("value")
                    if isinstance(v, int):
                        used[v] = used.get(v, 0) + 1
    return {
        "presets": tables.backdrop_presets(),
        "used": sorted(used),
        "note": "evt 0x1B selects a preset, 0x1C the mode (0 off, 2 frozen, "
                "else animating). Drawn at (camera.x, camera.y + dy, "
                "camera.z), spun about Y by spin_bams per frame, scaled "
                "(1.2, 1.2, -1.2) -- the negative Z turns it inside out.",
    }


def rigs_json(instances, blocked, campaths) -> dict:
    """The rig routes, gates and animation rules the client needs.

    The **geometry** goes into the glTF as ordinary nodes; this is the part
    that cannot: which `op_` path each instance rides, which `cp_` camera
    paths select it, and the runtime rules the transcription records but
    cannot bake.

    The player evaluates the path itself rather than riding a baked animation,
    which is why the bundle keeps the *slot* -- it can then honour the frame
    clamp and the position bias exactly, at any frame, including while
    scrubbing.
    """
    out = []
    for inst in instances:
        rig = inst["rig"]
        routes = []
        for r in inst["routes"]:
            ref = campaths.get(r["slot"])
            routes.append({
                "slot": r["slot"],
                "bias": list(r["bias"]),
                # Empty means ungated: the rig is present whatever the camera
                # is doing. Otherwise it rides only while one of these cp_
                # slots is the active camera path.
                "cam_paths": r["cam_paths"],
                "file": ref.file if ref else None,
                "index": ref.index if ref else None,
                "duration": ref.duration if ref else None,
            })
        out.append({
            "name": rig.name,
            "routine": rig.routine,
            "note": rig.note,
            "routes": routes,
            "world_space": rig.world_space,
            "spawn_class": rig.spawn_class,
            # Rules the transcription records rather than bakes, so the client
            # can show them instead of pretending the part is static.
            "animated_parts": [
                {"part": p.name, "rule": p.animated, "condition": p.condition}
                for p, _models in inst["parts"] if p.animated or p.condition
            ],
        })
    return {
        "rigs": out,
        "blocked": [{"name": r.name, "routine": r.routine,
                     "reason": r.placement_blocked} for r in blocked],
        "note": "Object rigs are transcribed draw routines, not asset data -- "
                "there is no rig format. See docs/formats/rigs.md and "
                "hod2lib/rigs.py.",
    }


def build_stage(stage, out_root: Path, *, glb: bool = True,
                write_textures: bool = True, unlit: bool = True,
                cam_step: float = 2.0, progress=None) -> dict:
    """Write one stage's directory and return its manifest entry.

    Geometry is exported with ``--no-cameras``: the player draws camera rails
    itself, from the raw curves in ``<stage>.cam.json``, so it can colour them
    by playback state and highlight the ``start..end`` sub-range one
    ``queue_event`` command covers. A baked glTF animation can express
    neither.
    """
    say = progress or (lambda *_: None)
    name = stage.name
    out_dir = out_root / name
    out_dir.mkdir(parents=True, exist_ok=True)

    say(f"  {name}: geometry")
    parts, model_regions, regions = stage.geometry()

    # Rig geometry travels in the glTF, but *unparented*: the bundle exports
    # no camera nodes, so there is no baked animation to hang a rig under.
    # Passing `anchors = {slot: None}` makes the writer emit each instance as
    # a scene node tagged `hod2_path_slot`, which the client then drives from
    # the raw `op_` curve -- the same trick the camera rails use.
    say(f"  {name}: object rigs")
    rig_instances, rig_blocked = rigslib.resolve_for_stage(stage)
    rig_data = [dict(inst, anchors={r["slot"]: None for r in inst["routes"]},
                     biases={})
                for inst in rig_instances]

    info = gltf.export_level(
        name, parts, out_dir, rigs=rig_data,
        write_textures=write_textures,
        cam_files=[],                  # rails are drawn client-side
        unlit=unlit, model_regions=model_regions, glb=glb)

    say(f"  {name}: camera paths")
    cam_json = stage.campaths().to_json()
    (out_dir / f"{name}.cam.json").write_text(json.dumps(cam_json))

    say(f"  {name}: event script")
    prog = scriptlib.Program(stage)
    script_json = prog.to_json()
    # The region table travels with the script because the client's region
    # visibility is driven by opcodes 0x28/0x29, and it needs to resolve a
    # region id to the models that region draws. glTF nodes carry
    # extras.hod2_regions for the same join from the other side.
    script_json["regions"] = stage.region_json()
    script_json["cam_slots_used"] = prog.cam_slots_used()
    script_json["bgm"] = bgm_json(stage.tables, stage.stage, stage.game_mode)
    script_json["sound"] = sound_json(stage.tables)
    script_json["backdrop"] = backdrop_json(stage.tables, prog)
    script_json["rigs"] = rigs_json(rig_instances, rig_blocked, stage.campaths())
    (out_dir / f"{name}.script.json").write_text(json.dumps(script_json))

    n_spawns = sum(len(o.detail.get("spawns", ()))
                   for b in prog.live_blocks() for s in b.steps for o in s.ops)
    entry = {
        "name": name,
        "stage": stage.stage,
        "scene": stage.scene,
        "game_mode": stage.game_mode,
        "geometry": Path(info["gltf"]).name,
        "cam": f"{name}.cam.json",
        "script": f"{name}.script.json",
        "counts": {
            "parts": len(parts),
            "models": sum(len(m) for _n, m, _b in parts),
            "triangles": sum(m.triangle_count for _n, ms, _b in parts
                             for m in ms) - info["dropped_collapsed_uv"],
            "materials": info["materials"],
            "textures": info["textures"],
            "regions": len(regions),
            "blocks": len(prog.live_blocks()),
            "branch_points": len(prog.branch_blocks()),
            "cam_paths": len(stage.campaths()),
            "spawns": n_spawns,
            "rigs": info.get("rigs", 0),
        },
        "sources": {},
    }
    for p in stage.source_files():
        try:
            rel = p.relative_to(stage.game)
        except ValueError:
            rel = Path(p.name)
        entry["sources"][str(rel).replace("\\", "/")] = _sha256(p)
    return entry


def write_manifest(out_root: Path, stages: list[dict], *, game_dir: Path,
                   notes: dict | None = None) -> Path:
    """Write ``manifest.json``: what is in the bundle and what it came from."""
    doc = {
        "format": BUNDLE_FORMAT,
        "tool": "hod2lib",
        "tool_version": __version__,
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "game_dir": str(game_dir),
        "fps": 60,
        # Recovered from SetupSceneProjection. A compile-time constant for the
        # whole game -- there is no zoom and no per-camera FOV.
        "projection": {
            "yfov_deg": 41.100,
            "yfov_bams": gltf.CAM_FOV_BAMS,
            "aspect": 4.0 / 3.0,
            "znear": gltf.CAM_ZNEAR,
            "zfar": gltf.CAM_ZFAR,
        },
        "stages": stages,
    }
    if notes:
        doc["notes"] = notes
    path = out_root / "manifest.json"
    path.write_text(json.dumps(doc, indent=1))
    return path
