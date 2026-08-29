#!/usr/bin/env python3
"""
Prove the evt -> cam link: `queue_event` selector 0x40 plays a camera path.

`EvtRunQueuedActions` (0x00402320) dispatches an opcode-0x30 action through a
two-level table at 0x005776EC:

    handler = table[selector >> 4][selector & 0xF]

Selector 0x40 reaches `EvtActionCamPlay40`, which drives
`CamEvalPath7(DAT_009A2D78, frame, ...)` once per frame:

    queue_event 0x40, start_frame, end_frame, path_index, flags

`path_index` is a GLOBAL index over every cam/ path, not a per-file one.
`DAT_004C479C` maps global index -> cam file id, and its run lengths are the
per-file path counts.

The check that collapses: **every selector-0x40 instruction in a stage's event
script must name a path that belongs to that stage's own cp_ file.** There are
233 cp_ paths in total and a stage owns 14-66 of them, so a wrong operand order
scatters the indices immediately.

Usage:
    python3 tools/verify_evt_cam.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import cam, evt, exetab  # noqa: E402

#: byte table: global cam path index -> cam file id
CAM_PATH_FILE_ID = 0x004C479C

#: scene -> (cp_ file stem, the file id DAT_004C479C uses for it)
STAGE_CAM = {
    0: ("cp_st1", 6), 1: ("cp_st2", 7), 2: ("cp_st3", 8),
    3: ("cp_st4", 9), 4: ("cp_st5", 10), 5: ("cp_st6", 11),
}

QUEUE_EVENT = 0x30
SEL_CAM_PLAY = 0x40


def path_bases(tables: exetab.ExeTables, n_paths: int) -> dict[int, tuple[int, int]]:
    """file id -> (first global path index, count), from DAT_004C479C.

    The table is one byte per *global* path and is exactly as long as the total
    number of paths across every cam/ file -- nothing marks its end, so read
    that many bytes and no more. Reading past it picks up unrelated data whose
    runs reuse the same small file ids and silently corrupt the bases.
    """
    off = tables._v2r(CAM_PATH_FILE_ID)
    raw = tables.data[off:off + n_paths]
    runs: list[list[int]] = []
    for b in raw:
        if runs and runs[-1][0] == b:
            runs[-1][1] += 1
        else:
            runs.append([b, 1])
    base, out = 0, {}
    for fid, n in runs:
        if fid in out:
            raise SystemExit(f"file id {fid} occurs twice in DAT_004C479C")
        out[fid] = (base, n)
        base += n
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    tables = exetab.ExeTables(str(game / "Hod2.exe"))

    # The table's length is the total path count over every cam/ file.
    cam_files = sorted((game / "cam").glob("*.bin"))
    n_paths = sum(len(cam.load(str(p)).paths) for p in cam_files)
    bases = path_bases(tables, n_paths)
    print(f"{len(cam_files)} cam/ files, {n_paths} paths total; "
          f"DAT_004C479C resolves {len(bases)} file ids\n")

    sel_hist: Counter = Counter()
    total = in_range = resumes = held = 0
    problems: list[str] = []

    for scene, (stem, fid) in STAGE_CAM.items():
        name = tables.scene_evt_file(scene)
        if not name or not (game / "evt" / name).exists():
            continue
        ev = evt.load(str(game / "evt" / name), tables.scene_block_count(scene))
        lo, count = bases[fid]
        paths = cam.load(str(game / "cam" / f"{stem}.bin")).paths
        if len(paths) != count:
            problems.append(
                f"{stem}: exe run length {count} != {len(paths)} paths in the file")

        for blk in ev.blocks:
            if blk.offset < 0:
                continue
            for prog in blk.programs:
                for ins in prog:
                    if ins.opcode != QUEUE_EVENT or not ins.raw:
                        continue
                    sel_hist[ins.raw[0]] += 1
                    if ins.raw[0] != SEL_CAM_PLAY or len(ins.raw) < 5:
                        continue
                    a = ins.raw[1:]
                    start = a[0] - (1 << 32) if a[0] >= (1 << 31) else a[0]
                    end, pidx = a[1], a[2]
                    total += 1
                    if lo <= pidx < lo + count:
                        in_range += 1
                        if start == -1:
                            resumes += 1
                        elif end > paths[pidx - lo].duration + 1:
                            held += 1
                    else:
                        problems.append(
                            f"{name} @{ins.offset:#06x}: path {pidx} outside "
                            f"{stem}'s range {lo}..{lo + count - 1}")
        print(f"scene {scene} {stem:8s} global paths {lo:3d}..{lo + count - 1:3d} "
              f"({count} paths)")

    print()
    print("queue_event selectors used: "
          + ", ".join(f"{s:#04x} x{n}" for s, n in sorted(sel_hist.items())))
    known = {0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x20, 0x21, 0x40, 0x60}
    unknown = set(sel_hist) - known
    if unknown:
        problems.append(f"selectors with no handler in the table: {sorted(unknown)}")
    print(f"  all {len(sel_hist)} distinct selectors have a handler "
          f"in the two-level table at 0x005776EC: {not unknown}")
    print()
    print(f"selector 0x40 (play a cam/ path): {total} instructions")
    print(f"  path index inside the stage's own cp_ file : {in_range}/{total}")
    print(f"  start_frame == -1 (resume)                 : {resumes}")
    print(f"  end_frame past the path duration (held)    : {held}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems[:20]:
            print("  " + p)
        return 1
    print("\nclean: every camera-play action names a path from its own stage")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
