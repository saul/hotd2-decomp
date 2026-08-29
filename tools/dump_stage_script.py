#!/usr/bin/env python3
"""
Decode a stage's event script into a readable timeline.

    python3 tools/dump_stage_script.py --game-dir "..." --stage 2
    python3 tools/dump_stage_script.py --game-dir "..." --stage 2 --assets
    python3 tools/dump_stage_script.py --game-dir "..." --stage 2 --block 3 --full

Resolves the numeric operands the event VM works in back to filenames, using
the tables compiled into Hod2.exe: asset slot ids to a pol/ file and entry
index, pol/tex file indices to filenames. That turns the bytecode into
something you can read against the level.

See docs/formats/pipeline.md for how the pieces fit together.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import cam, evt, exetab  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

# stage number -> scene id (the event system's own index)
STAGE_TO_SCENE = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}
ROUTE_KIND = {0: "goto", 1: "branch", 2: "end"}


def tex_names(t: ExeTables) -> dict[int, str]:
    out = {}
    for i in range(512):
        p = t._u32(exetab.TEX_NAME_TABLE + i * 4)
        if p:
            n = t._cstr(p)
            if n:
                out[i] = n
    return out


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

    t = ExeTables(str(game / "Hod2.exe"))
    name = t.scene_evt_file(scene)
    if not name:
        raise SystemExit(f"scene {scene} has no evt file")

    slots = t.asset_slots()
    pol = t.pol_files()
    tex = tex_names(t)
    routes = t.scene_routes(scene)
    f = evt.load(str(game / "evt" / name), len(routes))

    def operand(ins) -> str:
        v = ins.raw[0] if ins.raw else 0
        if ins.opcode in evt.SLOT_OPCODES:
            r = slots.get(v)
            return f"slot {v} = {r[0]}[{r[1]}]" if r else f"slot {v} = ?"
        if ins.opcode in (0x52, 0x53):
            r = pol.get(v)
            return f"pol {v} = {r[0]}" if r else f"pol {v} = ?"
        if ins.opcode in (0x54, 0x55, 0x56, 0x57):
            return f"tex {v} = {tex.get(v, '?')}"
        return " ".join("%08X" % w for w in ins.words)

    if args.assets:
        print(f"scene {scene}  {name}  ({len(routes)} blocks)\n")
        load_by_file: dict[str, Counter] = defaultdict(Counter)
        blocks_of: dict[str, set] = defaultdict(set)
        for b in f.blocks:
            if b.offset < 0:
                continue
            for prog in b.programs:
                for ins in prog:
                    v = ins.raw[0] if ins.raw else 0
                    fn = None
                    if ins.opcode in evt.SLOT_OPCODES:
                        r = slots.get(v)
                        fn = r[0] if r else None
                    elif ins.opcode in (0x52, 0x53):
                        r = pol.get(v)
                        fn = r[0] if r else None
                    elif ins.opcode in (0x54, 0x55, 0x56, 0x57):
                        fn = tex.get(v)
                    if fn:
                        load_by_file[fn][evt.OPCODES[ins.opcode][0]] += 1
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
    for b in f.blocks:
        if b.offset < 0:
            print(f"block {b.index:3d}  (hole)")
            continue
        if args.block is not None and b.index != args.block:
            continue
        r = routes[b.index] if b.index < len(routes) else (0, -1, -1, -1)
        kind = ROUTE_KIND.get(r[0], f"?{r[0]}")
        nxt = [x for x in r[1:] if x >= 0]
        print(f"block {b.index:3d}  @{b.offset:06X}  {len(b.steps)} steps  "
              f"route: {kind} -> {nxt}")
        if b.external_steps:
            print(f"           external steps: {b.external_steps}")
        for si, prog in enumerate(b.programs):
            print(f"  step {si}")
            for ins in prog:
                if not args.full and ins.opcode not in interesting:
                    continue
                print(f"    {ins.offset:06X}  {ins.opcode:02X} "
                      f"{evt.OPCODES[ins.opcode][0]:<22} {operand(ins)}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
