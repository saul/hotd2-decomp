#!/usr/bin/env python3
"""Check the handover from one stage to the next: where a scene ends, and
where the ending it reached opens the scene after it.

**A terminal route record's ``next[0]`` is the next scene's starting block.**
``EvtAdvanceStepOrRoute`` (``FUN_0045F000``) ends a scene by walking onto a
hole and then reads, at ``0x0045F0DA``::

    g_evt_block_index =
        *(s16 *)(g_scene_routes[scene] + g_evt_block_index * 8 - 6);

``block * 8 - 6`` is route record ``block - 1`` at ``+0x02``, which is
``next[0]`` of the record the walk just left. Nothing between there and
``FUN_0045EBC0`` writes the block index again -- not ``AdvanceToNextScene``,
not ``LoadSceneAndReset``, not ``ResetSceneOnEnter`` -- so that value is what
the next scene opens on.

That reading makes four claims the shipped data can refute, and this is the
only check that looks at any of them:

1. **A hole follows every reachable terminal record.** A ``kind == 2`` record
   does not end a scene by itself -- it does ``block + 1`` and the scene ends
   because the block it lands on does not exist. If any of them were followed
   by a live block the reading is wrong and the scene would keep running.
2. **The ``-6`` read lands on a real record**, which is the same thing as
   saying no reachable terminal record sits at block 0.
3. **Every handover names a live block of the next scene** -- one the evt file
   supplies and the route table does not hole. A stage cannot open on nothing.
4. **The exporter's ``entries`` and ``exits`` agree** with a walk done here
   from the route tables alone, for both game modes.

Claim 3 is the one with teeth. Read ``next[1]`` instead of ``next[0]`` and
stage 2's block 37 hands stage 3 a ``-1``; read the record after the hole
rather than the one before it and every stage hands over a ``-1`` as well.
Take slot 2 out of the reachable walk and nothing changes, which is itself
worth recording: **Arcade and Original Mode reach the same set of endings in
all six stages**, so the two entries stage 3 and stage 4 each have are open to
both modes.

    python3 tools/verify_scene_exits.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib.exetab import ExeTables  # noqa: E402
from hod2lib.stage import Stage  # noqa: E402

STAGES = (1, 2, 3, 4, 5, 6)

#: What the shipped tables say. A change here is a change in the reading, and
#: the two stages with a choice are the whole point of the file.
EXPECTED_ENTRIES = {0: [0], 1: [0], 2: [0, 7], 3: [0, 4], 4: [0], 5: [0]}
EXPECTED_EXITS = {
    0: [(14, 0)],
    1: [(35, 0), (37, 7)],
    2: [(11, 0), (13, 4)],
    3: [(23, 0), (25, 0)],
    4: [(7, 0)],
    5: [(12, 0)],
}


def walk(routes, entries, slots):
    """Reachable blocks and terminal records, following only ``slots``."""
    seen: set[int] = set()
    stack = list(entries)
    ends: dict[int, int] = {}
    while stack:
        b = stack.pop()
        if b in seen or not 0 <= b < len(routes):
            continue
        seen.add(b)
        kind, *nxt = routes[b]
        if kind == ExeTables.ROUTE_GOTO:
            stack.append(nxt[0])
        elif kind == ExeTables.ROUTE_BRANCH:
            stack.extend(nxt[i] for i in slots if i < 3 and nxt[i] >= 0)
        elif kind == ExeTables.ROUTE_END:
            ends[b] = nxt[0]
    return seen, ends


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    exe = args.game_dir / "Hod2.exe"
    if not exe.is_file():
        print(f"no {exe}")
        return 3
    ex = ExeTables(exe)

    fails: list[str] = []
    checked = 0

    # Live blocks per scene, from the evt file the scene actually ships. The
    # route table says how many records there are; the file says which of them
    # are holes, and a handover has to name one that is not.
    live: dict[int, set[int]] = {}
    for stage in STAGES:
        st = Stage(args.game_dir, stage=stage)
        routes = st.routes
        live[st.scene] = {
            b.index for b in st.evt().blocks
            if b.programs and routes[b.index][0] != -1
        } if st.evt() else set()

    for stage in STAGES:
        st = Stage(args.game_dir, stage=stage)
        scene = st.scene
        routes = st.routes
        entries = ex.scene_entry_blocks(scene)
        _, ends = walk(routes, entries, (0, 1, 2))
        _, arcade = walk(routes, entries, (0, 1))

        # 4: the exporter and a walk done here from the tables alone.
        checked += 1
        if entries != EXPECTED_ENTRIES[scene]:
            fails.append(f"stage {stage}: entries {entries}, expected "
                         f"{EXPECTED_ENTRIES[scene]}")
        got = sorted(ends.items())
        if got != EXPECTED_EXITS[scene]:
            fails.append(f"stage {stage}: exits {got}, expected "
                         f"{EXPECTED_EXITS[scene]}")
        if got != ex.scene_exits(scene):
            fails.append(f"stage {stage}: ExeTables.scene_exits disagrees "
                         f"with this file's walk")
        # The recorded fact, not an accident: both modes end the same way.
        if sorted(arcade.items()) != got:
            fails.append(f"stage {stage}: Arcade reaches {sorted(arcade)} and "
                         f"Original {sorted(ends)}; they are meant to agree")

        for block, entry in got:
            checked += 1
            # 2: the -6 read is `routes[block]`, reached as `(block+1)*8 - 6`.
            if block == 0:
                fails.append(f"stage {stage}: scene ends at block 0, so the "
                             f"-6 read at 0x0045F0DA would go off the front "
                             f"of the route table")
            # 1: the hole is what ends the scene.
            after = routes[block + 1] if block + 1 < len(routes) else None
            if after is None:
                fails.append(f"stage {stage} block {block}: the terminal "
                             f"record is the last in the table, so `block+1` "
                             f"reads past it")
            elif after[0] != -1:
                fails.append(f"stage {stage} block {block}: record "
                             f"{block + 1} is {after}, not a hole -- a kind-2 "
                             f"record ends a scene only because `block+1` "
                             f"lands on nothing")
            # 3: the handover names a live block of the next scene.
            nxt_scene = scene + 1
            if nxt_scene > ExeTables.LAST_STAGE_SCENE:
                continue          # scene 6 is training, not the next stage
            if entry not in live.get(nxt_scene, set()):
                fails.append(f"stage {stage} block {block} hands stage "
                             f"{stage + 1} block {entry}, which is not a live "
                             f"block of it")

    for f in fails:
        print(f"FAIL {f}")
    if fails:
        return 1
    two = [s for s in STAGES if len(EXPECTED_ENTRIES[s - 1]) > 1]
    print(f"ok  {checked} assertions over {len(STAGES)} stages; "
          f"{len(two)} have more than one entry "
          f"({', '.join(f'stage {s} at {EXPECTED_ENTRIES[s - 1]}' for s in two)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
