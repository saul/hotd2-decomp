#!/usr/bin/env python3
"""Every character skeleton, walked whole, against the EXE's own bone count.

`ExeTables.character_skeleton` flattens `g_character_skeletons` (0x004E0430)
into a node list, and everything downstream -- the glTF rig, the bone spheres
the shot test walks, the motion channels a clip is baked onto -- is built
from that list. **A node the walk misses is a bone the game has and the port
does not.** Nothing else notices: the rig still builds, the motion still
bakes onto the bones it has, and the actor still draws, with a piece missing.

That is exactly what happened. The walk stopped at depth 12, an arbitrary
bound (L22), and the stage-3 boss's heads -- `boss3.bin` nests 17 deep,
`boss3l.bin` and `b6boss3.bin` 24 -- came out with 13 of their nodes: no jaw
and no weak bone, so heads that could not be shot.

The invariant is the EXE's, and it is independent of the walk: the motion
frame's bone count at `DAT_004E0724` (`character_bone_count`) is one more than
the highest bone index in the tree -- bone 0 is the object root. It holds for
every character type that has a skeleton, and a walk that drops a node fails
it.

    python3 tools/verify_skeletons.py --game-dir ~/"THE HOUSE OF THE DEAD 2"

Exit 0 when it asserted things, 1 when they were wrong, 3 when it could not
assert anything -- no game directory.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import stage as stagelib  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", type=Path)
    args = ap.parse_args()
    if args.game_dir is None:
        print("no --game-dir given; nothing asserted")
        return 3
    tables = stagelib.get_tables(args.game_dir.expanduser().resolve())
    if tables is None:
        print(f"no Hod2.exe under {args.game_dir}; nothing asserted")
        return 3
    checked = 0
    bad: list[str] = []
    for ct in range(0x100):
        nodes = tables.character_skeleton(ct)
        if not nodes:
            continue
        checked += 1
        want = tables.character_bone_count(ct)
        top = max(n["bone"] for n in nodes)
        bones = sorted(n["bone"] for n in nodes)
        if top + 1 != want or bones != list(range(1, want)):
            bad.append(f"type 0x{ct:02X} ({tables.character_asset_file(ct)}): "
                       f"{len(nodes)} nodes, highest bone {top}, "
                       f"but the motion frame has {want} bones")
    if checked == 0:
        print("no character type has a skeleton; nothing asserted")
        return 3
    for line in bad:
        print("FAIL", line)
    print(f"{checked} skeletons walked whole against DAT_004E0724's bone "
          f"counts, {len(bad)} short")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
