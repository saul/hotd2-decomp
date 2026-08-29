#!/usr/bin/env python3
"""
Decode a stage's event script into a readable timeline.

    python3 tools/dump_stage_script.py --game-dir "..." --stage 2
    python3 tools/dump_stage_script.py --game-dir "..." --stage 2 --assets
    python3 tools/dump_stage_script.py --game-dir "..." --stage 2 --block 3 --full
    python3 tools/dump_stage_script.py --game-dir "..." --stage 2 --json out.json

Resolves the numeric operands the event VM works in back to filenames, using
the tables compiled into Hod2.exe: asset slot ids to a pol/ file and entry
index, pol/tex file indices to filenames. That turns the bytecode into
something you can read against the level.

All of the decoding lives in `hod2lib.script`, which is also what the browser
player's bundle is serialised from -- so this dump stays a valid oracle for
that bundle rather than a second, drifting implementation.

See docs/formats/pipeline.md for how the pieces fit together.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import script as scriptlib, stage as stagelib  # noqa: E402

STAGE_TO_SCENE = stagelib.STAGE_TO_SCENE


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--stage", type=int)
    ap.add_argument("--scene", type=int, help="raw scene id (0-11)")
    ap.add_argument("--block", type=int, help="only this block")
    ap.add_argument("--assets", action="store_true",
                    help="summarise asset traffic instead of listing instructions")
    ap.add_argument("--full", action="store_true",
                    help="list every instruction, not just asset/flow ones")
    ap.add_argument("--json", type=Path,
                    help="write the resolved program as JSON instead of text")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    if args.scene is not None:
        scene = args.scene
    elif args.stage is not None:
        scene = STAGE_TO_SCENE.get(args.stage)
        if scene is None:
            raise SystemExit(f"stage {args.stage} has no scene")
    else:
        raise SystemExit("give --stage or --scene")

    st = stagelib.Stage(game, stage=args.stage, scene=scene)
    name = st.evt_file
    if not name:
        raise SystemExit(f"scene {scene} has no evt file")

    prog = scriptlib.Program(st)
    routes = prog.routes
    resolver = prog.resolver

    if args.json:
        args.json.write_text(json.dumps(prog.to_json(), indent=1))
        print(f"{name}: {len(prog.live_blocks())} blocks -> {args.json}")
        return 0

    if args.assets:
        print(f"scene {scene}  {name}  ({len(routes)} blocks)\n")
        load_by_file: dict[str, Counter] = defaultdict(Counter)
        blocks_of: dict[str, set] = defaultdict(set)
        for b in prog.blocks:
            if b.is_hole:
                continue
            for step in b.steps:
                for op in step.ops:
                    fn = resolver.asset_name(op)
                    if fn:
                        load_by_file[fn][op.name] += 1
                        blocks_of[fn].add(b.index)

        stage_pref = f"st{args.stage}_" if args.stage else None
        rows = sorted(load_by_file.items(), key=lambda kv: -sum(kv[1].values()))
        print(f"{'asset':<26}{'ops':>5}  blocks  operations")
        for fn, ops in rows:
            bl = sorted(blocks_of[fn])
            blist = ",".join(str(x) for x in bl[:8]) + ("…" if len(bl) > 8 else "")
            print(f"  {fn:<24}{sum(ops.values()):>5}  [{blist}]  "
                  + " ".join(f"{k}x{v}" for k, v in ops.most_common()))
        if stage_pref:
            seg = [fn for fn in load_by_file if fn.startswith(stage_pref)]
            print(f"\nstage geometry files ({stage_pref}*) referenced by the script: "
                  f"{len(seg)}")
            for fn in sorted(seg):
                print(f"  {fn:<24} blocks {sorted(blocks_of[fn])}")
        return 0

    print(f"scene {scene}  {name}  ({len(routes)} blocks)\n")
    interesting = set(range(0x50, 0x58)) | {0x09, 0x0B, 0x0C, 0x4D, 0x4F, 0x40,
                                            0x41, 0x42, 0x30, 0x31}
    for b in prog.blocks:
        if b.is_hole:
            print(f"block {b.index:3d}  (hole)")
            continue
        if args.block is not None and b.index != args.block:
            continue
        print(f"block {b.index:3d}  @{b.offset:06X}  {len(b.steps)} steps  "
              f"route: {b.route_kind} -> {b.route_targets}")
        if b.external_steps:
            print(f"           external steps: {b.external_steps}")
        for step in b.steps:
            print(f"  step {step.index}")
            for op in step.ops:
                if not args.full and op.opcode not in interesting:
                    continue
                print(f"    {op.offset:06X}  {op.opcode:02X} "
                      f"{op.name:<22} {resolver.operand_text(op)}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
