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

from . import __version__, gltf, script as scriptlib

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
    info = gltf.export_level(
        name, parts, out_dir,
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
