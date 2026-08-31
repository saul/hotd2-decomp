#!/usr/bin/env python3
"""
Validate the evt/ and cam/ parsers across every shipped file.

These two formats are checked by *exhaustion*, not by spot-check, because both
were recovered from the binary and both have a property that makes a wrong
answer obvious:

  cam/  every byte of every file must be claimed by exactly one of
        {offset table, curve, path descriptor}. A wrong keyframe stride or
        descriptor size desynchronises the linear pool walk and coverage
        collapses. 100.0000% on all 24 files is the pass condition.

  evt/  the bytecode is walked with a hand-transcribed operand-length table.
        A wrong length lands the decoder on a garbage opcode almost at once,
        and five of the 96 dispatch slots are empty stubs that no real stream
        may contain. Zero decode errors and zero stub hits is the pass
        condition. The block count recovered from the file is independently
        cross-checked against the route tables compiled into Hod2.exe.

Usage:
    python3 tools/verify_phase6.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import cam, evt  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

STUB_OPCODES = {op for op, (_, kind, _) in evt.OPCODES.items() if kind == "bad"}


def verify_cam(game: Path) -> tuple[int, list[str]]:
    problems: list[str] = []
    files = sorted((game / "cam").glob("*.bin"))
    if not files:
        return 1, ["no cam/ files found"]

    total_bytes = covered_bytes = 0
    n_paths = n_curves = n_keys = 0

    print("cam/ -- Hermite spline paths")
    print(f"  {'file':<16}{'paths':>6}{'curves':>8}{'keys':>8}{'coverage':>11}")
    for p in files:
        f = cam.load(str(p))
        cov = (
            f.base
            + sum(c.size for c in f.curves.values())
            + sum(s for _, s in f.descriptor_spans)
        )
        total_bytes += len(f.raw)
        covered_bytes += cov
        n_paths += len(f.paths)
        n_curves += len(f.curves)
        n_keys += sum(len(c.keys) for c in f.curves.values())

        pct = 100.0 * cov / len(f.raw)
        print(f"  {p.name:<16}{len(f.paths):>6}{len(f.curves):>8}"
              f"{sum(len(c.keys) for c in f.curves.values()):>8}{pct:>10.4f}%")

        if cov != len(f.raw):
            problems.append(f"{p.name}: coverage {cov} != size {len(f.raw)}")
        for path in f.paths:
            if len(path.channels) != len(f.channel_names):
                missing = set(f.channel_names) - set(path.channels)
                problems.append(f"{p.name}: path {path.index} missing {sorted(missing)}")
        problems.extend(f"{p.name}: {w}" for w in f.warnings)

    # keyframe times should be whole frame numbers
    off_grid = 0
    for p in files:
        f = cam.load(str(p))
        for c in f.curves.values():
            for k in c.keys:
                if not math.isfinite(k.time) or abs(k.time - round(k.time)) > 0.01:
                    off_grid += 1

    print(f"\n  {n_paths} paths, {n_curves} curves, {n_keys:,} keyframes")
    print(f"  byte coverage {100.0 * covered_bytes / total_bytes:.4f}% "
          f"({covered_bytes:,} / {total_bytes:,})")
    # `cam.CamFile.parse` raises on any keyframe word that is not a value a
    # keyframe could hold, so reaching here means every word in every file is
    # intact. Stated rather than assumed: a damaged extract is what made this
    # parser invent data in the first place.
    print(f"  keyframe words outside the sane range: 0 (parse would have failed)")
    print(f"  keyframe times off the 60 Hz frame grid: {off_grid}")
    return (1 if problems else 0), problems


def verify_evt(game: Path) -> tuple[int, list[str]]:
    problems: list[str] = []
    tables = ExeTables(str(game / "Hod2.exe"))

    total_bytes = covered_bytes = 0
    n_blocks = n_steps = n_instr = n_spawn = 0
    opcodes: Counter[int] = Counter()

    print("\nevt/ -- event bytecode")
    print(f"  {'file':<16}{'blocks':>7}{'steps':>7}{'instrs':>8}{'spawns':>8}{'coverage':>11}")
    for scene in range(tables.SCENE_COUNT):
        name = tables.scene_evt_file(scene)
        if not name:
            continue
        expected = tables.scene_block_count(scene)
        path = game / "evt" / name
        if not path.exists():
            problems.append(f"{name}: missing")
            continue

        f = evt.load(str(path), expected)
        auto = evt.EvtFile(f.raw, name).parse()
        if len(auto.blocks) != expected:
            problems.append(
                f"{name}: file walk found {len(auto.blocks)} blocks, "
                f"Hod2.exe route table says {expected}"
            )

        n = len(f.raw)
        cov = bytearray(n)

        def mark(o: int, ln: int) -> None:
            for k in range(max(0, o), min(o + ln, n)):
                cov[k] = 1

        mark(0, expected * 4)
        spawn_offsets = set()
        for b in f.blocks:
            if b.offset < 0:
                continue
            mark(b.offset, (len(b.steps) + 1) * 4)
            for prog in b.programs:
                for ins in prog:
                    mark(ins.offset, ins.size)
                    opcodes[ins.opcode] += 1
                    n_instr += 1
                    if ins.opcode in STUB_OPCODES:
                        problems.append(
                            f"{name}: empty-stub opcode {ins.opcode:#04x} at {ins.offset:#x}"
                        )
        for s in evt.spawns(f):
            spawn_offsets.add(s.offset)
            if s.opcode == 0x09:
                mark(s.offset, evt.SPAWN_STRIDE_09)
            else:
                mark(s.offset, evt.SPAWN_HEADER)
            if not all(math.isfinite(v) for v in s.pos):
                problems.append(f"{name}: spawn at {s.offset:#x} has non-finite position")

        c = sum(cov)
        total_bytes += n
        covered_bytes += c
        n_blocks += sum(1 for b in f.blocks if b.offset >= 0)
        n_steps += sum(len(b.steps) for b in f.blocks)
        n_spawn += len(spawn_offsets)
        print(f"  {name:<16}{len(f.blocks):>7}{sum(len(b.steps) for b in f.blocks):>7}"
              f"{sum(len(pr) for b in f.blocks for pr in b.programs):>8}"
              f"{len(spawn_offsets):>8}{100.0 * c / n:>10.1f}%")
        problems.extend(f"{name}: {w}" for w in f.warnings)

    unknown = [op for op in opcodes if op not in evt.OPCODES]
    if unknown:
        problems.append(f"opcodes outside the 96-entry table: {unknown}")

    print(f"\n  {n_blocks} blocks, {n_steps} steps, {n_instr:,} instructions, "
          f"{n_spawn:,} spawn descriptors")
    print(f"  {len(opcodes)} distinct opcodes, all within the 96-entry dispatch table")
    print(f"  reachable-byte coverage {100.0 * covered_bytes / total_bytes:.1f}% "
          "(remainder is operand data for opcodes not yet followed)")
    return (1 if problems else 0), problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    rc_cam, prob_cam = verify_cam(args.game_dir)
    rc_evt, prob_evt = verify_evt(args.game_dir)

    problems = prob_cam + prob_evt
    if problems:
        print(f"\nPROBLEMS ({len(problems)}):")
        for p in problems[:40]:
            print(f"  {p}")
        return 1

    print("\nNo structural problems found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
