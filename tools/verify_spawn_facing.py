#!/usr/bin/env python3
"""Render a stage through one of its own camera paths, with the zombies posed.

The spawn yaw is the one thing in the character pipeline that cannot be settled
by reading the code alone. Every step of the chain is verifiable --
``FUN_004088A0`` copies the descriptor's orientation to ``obj+0x64/68/6C``,
``FUN_00410590`` feeds it to ``RotX; RotY; RotZ``, ``MatrixRotateY`` is
three.js's Y rotation exactly -- and it still leaves open which way the *model*
points, which is a fact about the art.

Two indirect answers already agree: a posed ``char_adv00``'s toe reaches world
``z = -2.47`` against a heel at ``+0.88``, so a character faces ``-Z`` and
``RotY(theta)`` aims it at ``theta + 180``; and measuring every class-0x30 spawn
against the camera playing when it spawns puts 131 of 191 facing the camera and
4 facing away. This is the direct one: put the camera where the game puts it and
look.

    tools/verify_spawn_facing.py --stage 2 --slot 59 --frame 120

writes a glTF with the characters **posed** rather than at bind -- bind is a
heap of parts and proves nothing -- and prints the Blender command that renders
it from that camera. The bundle deliberately exports bind, because the browser
poses at runtime; only a still needs this.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import characters as charlib, gltf, stage as stagelib  # noqa: E402

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / "THE HOUSE OF THE DEAD 2")
    ap.add_argument("--stage", type=int, default=2)
    ap.add_argument("--slot", type=int, required=True,
                    help="global cam path slot to look through")
    ap.add_argument("--frame", type=int, default=0, help="game frame (60 Hz)")
    ap.add_argument("--pose-frame", type=int, default=0,
                    help="motion frame to pose the characters at")
    ap.add_argument("--out", type=Path,
                    default=Path("extract/verify/spawn_facing"))
    ap.add_argument("--render", action="store_true",
                    help="run Blender rather than just printing the command")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    st = stagelib.Stage(game, stage=args.stage)
    parts, model_regions, _regions = st.geometry()

    _chars, places, entries = charlib.resolve_for_stage(
        st, pose_frame=args.pose_frame)
    posed = sum(1 for p in places if p.motion is not None)
    print(f"stage {args.stage}: {len(parts)} geometry parts, "
          f"{len(entries)} character types, {posed} posed spawns")

    cam_files = st.cam_files()
    ref = st.campaths().get(args.slot)
    if ref is None:
        raise SystemExit(f"slot {args.slot} is not a path of stage {args.stage}")
    node = f"{ref.file}_{ref.index:02d}_cam"
    print(f"camera slot {args.slot} = {ref.file}[{ref.index}], "
          f"frames {ref.start_frame:g}..{ref.start_frame + ref.duration:g} "
          f"-> node {node}")

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    info = gltf.export_level("spawn_facing", parts, out, rigs=entries,
                             cam_files=cam_files, unlit=True,
                             model_regions=model_regions)
    print(f"  -> {info['gltf']}  ({info['meshes']} meshes, "
          f"{info['rigs']} rig instances, {info['paths']} paths)")

    cmd = [BLENDER, "-b", "-P", "tools/blender_camview.py", "--",
           str(info["gltf"]), node, str(args.frame)]
    print("\n" + " ".join(cmd))
    if args.render:
        return subprocess.call(cmd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
