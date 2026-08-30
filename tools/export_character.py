#!/usr/bin/env python3
"""Assemble a skinned character and export it as a posed glTF hierarchy.

Puts together everything the `mot/` decomp established:

* the skeleton (bone offsets, parents, per-bone asset slot) comes from the EXE
  at `PTR_DAT_004E0430[char_type]` -- so a character assembles in bind pose
  with no motion data at all;
* a motion frame from `mot/<bank>` supplies the per-bone BAMS rotation triple
  and the root translation;
* each node is emitted as `MatrixTranslate(offset); RotZ; RotY; RotX`, which is
  exactly what `FUN_004107E0` does.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import gltf, mot as motlib, rigs as rigslib, stage as stagelib  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("char_type", type=lambda s: int(s, 0))
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / "THE HOUSE OF THE DEAD 2")
    ap.add_argument("--motion", type=lambda s: int(s, 0), default=None,
                    help="motion id; omit for the bind pose")
    ap.add_argument("--frame", type=int, default=0)
    ap.add_argument("--out", type=Path, default=Path("extract/characters"))
    args = ap.parse_args()

    t = stagelib.get_tables(args.game_dir)
    skel = t.character_skeleton(args.char_type)
    if not skel:
        print(f"character type {args.char_type:#04x} has no skeleton")
        return 1
    stem = t.character_asset_file(args.char_type) or f"type{args.char_type:02x}"
    name = stem.replace(".bin", "")
    bones = t.character_bone_count(args.char_type)

    pose = None
    if args.motion is not None:
        bank_id = t.motion_bank_of(args.motion)
        banks = t.motion_banks()
        if bank_id in banks:
            fname, ids = banks[bank_id]
            bank = motlib.load_bank(args.game_dir, fname, ids)
            if bank is not None:
                frames = bank.frames(args.motion, bones)
                if frames:
                    pose = frames[min(args.frame, len(frames) - 1)]
                    print(f"motion {args.motion} from {fname}: "
                          f"{len(frames)} frames, using {args.frame}")

    models, bank_tex = stagelib.load_asset(args.game_dir, name)
    slots = t.asset_slots()

    # A skeleton is exactly a rig: a tree of named parts, each with a
    # translation, a BAMS rotation triple and an asset slot. So it goes
    # through the existing rig writer rather than a second glTF path.
    names = [f"bone{n['bone']:02d}_{n['slot']:04x}" for n in skel]
    parts = []
    for i, node in enumerate(skel):
        rot = (0, 0, 0)
        if pose is not None and node["bone"] < len(pose.bones):
            rot = tuple(pose.bones[node["bone"]])
        part = rigslib.RigPart(
            names[i], (node["slot"],),
            translation=tuple(node["offset"]),
            rotation_bams=rot,
            parent=names[node["parent"]] if node["parent"] is not None else "",
            note=f"bone {node['bone']} of character type {args.char_type:#04x}")
        rec = slots.get(node["slot"])
        idx = rec[1] if rec else None
        model = models[idx] if idx is not None and idx < len(models) else None
        parts.append((part, [(model, bank_tex, name)] if model else []))

    rig = rigslib.Rig(name=name, routine=f"skeleton type {args.char_type:#04x}",
                      world_space=True,
                      parts=tuple(p for p, _ in parts),
                      note="assembled from the EXE skeleton"
                           + ("" if pose is None else
                              f", posed at motion {args.motion} frame {args.frame}"))
    entry = {"rig": rig, "routes": [], "anchors": {}, "biases": {},
             "fixed": [], "world": True, "placements": [], "blocked": "",
             "parts": [(p, m) for p, m in parts if m]}

    out = args.out / f"{name}{'_bind' if pose is None else f'_m{args.motion}'}"
    out.mkdir(parents=True, exist_ok=True)
    info = gltf.export_level(name, [], out, rigs=[entry], unlit=True)
    print(f"{name}: {len(parts)} bones, {info['meshes']} meshes, "
          f"{info['rigs']} instance -> {info['gltf']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
