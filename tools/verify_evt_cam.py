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
SEL_SCENE_STATE = 0x11        # major = current, minor = operand
SEL_FINISH_SEQ = 0x21         # major = 2 (fixed), minor = operand

#: Live cells of the 6x9 scene state machine at 0x00576C14, per major.
#: Every other cell points at SceneStateInvalidHang (0x00402710), a `while(1);`
#: loop -- so an out-of-range transition locks the game up, which makes this a
#: hard statement about which states exist rather than a guess.
SCENE_STATE_LIVE = {
    0: {0},
    1: {1, 2, 3},
    2: {4, 5, 6, 7},
    3: set(),                 # every cell hangs; major 3 does not exist
    4: {0, 1, 2, 3, 4, 5, 8},
    5: {0, 3, 4, 6, 7, 8},
}

#: The two camera states that play a path stashed by `0x40` with flags & 2.
STASHED_PATH_STATES = {6, 7}


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
    state_ops: Counter = Counter()
    deferred = deferred_followed = 0
    flag_hist: Counter = Counter()
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
                queued = [i for i in prog if i.opcode == QUEUE_EVENT and i.raw]
                for k, ins in enumerate(queued):
                    sel_hist[ins.raw[0]] += 1

                    # -- scene state transitions land on a live cell ---------
                    if ins.raw[0] == SEL_FINISH_SEQ and len(ins.raw) > 1:
                        state_ops[(2, ins.raw[1])] += 1
                        if ins.raw[1] not in SCENE_STATE_LIVE[2]:
                            problems.append(
                                f"{name} @{ins.offset:#06x}: finish_sequence to "
                                f"state (2,{ins.raw[1]}) -- a hang-loop cell")

                    if ins.raw[0] != SEL_CAM_PLAY or len(ins.raw) < 5:
                        continue
                    a = ins.raw[1:]
                    start = a[0] - (1 << 32) if a[0] >= (1 << 31) else a[0]
                    end, pidx, flags = a[0:4][1], a[2], a[3]
                    flag_hist[flags] += 1

                    # -- a deferred play must be followed by the state that
                    #    consumes the stash ---------------------------------
                    if flags & 2:
                        deferred += 1
                        nxt = [j.raw[1] for j in queued[k + 1:k + 4]
                               if j.raw[0] == SEL_FINISH_SEQ and len(j.raw) > 1]
                        if any(v in STASHED_PATH_STATES for v in nxt):
                            deferred_followed += 1
                        else:
                            problems.append(
                                f"{name} @{ins.offset:#06x}: deferred cam play "
                                f"not followed by a state 6/7 transition")
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
    print(f"scene state transitions (selector 0x21, major 2): "
          + ", ".join(f"minor {m} x{n}" for (_, m), n in sorted(state_ops.items())))
    print(f"  all land on a live cell of the 6x9 table (the rest is a hang "
          f"loop): {not any('hang-loop' in p for p in problems)}")
    print()
    print(f"selector 0x40 (play a cam/ path): {total} instructions")
    print(f"  flags histogram: {dict(sorted(flag_hist.items()))}")
    print(f"  deferred (flags & 2) followed by a state 6/7 transition : "
          f"{deferred_followed}/{deferred}")
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
