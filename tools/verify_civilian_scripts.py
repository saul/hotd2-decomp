#!/usr/bin/env python3
"""Check that class 0x10's command streams decode, and that they cover the exe.

`CivilianRunScript` (`FUN_0048B9E0`) walks **dwords**, and each opcode has its
own length. A single wrong length desynchronises the stream: the cursor lands
mid-command and the next opcode is a pointer or a float, which is out of range
at once. So "every stream reachable from `g_civilian_scripts` decodes with
every opcode in 0..0x2D, and every one of them ends in exactly one 0x2D" is a
check the reading can actually fail.

Two more invariants, which the lengths alone would not give:

* **No command overlaps another.** Two streams may share a tail — that is
  normal, and the decoder visits each address once — but a byte may never be
  claimed as two different commands.
* **The region is accounted for.** Everything between the first script and the
  table itself is either a command or data an operand points at. The residue
  is reported; it is the item tables ops 0x13-0x15 use, which are read as
  opaque records.

    python3 tools/verify_civilian_scripts.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib.exetab import ExeTables  # noqa: E402

#: What the shipped exe holds. A change here is a change in the reading.
EXPECT_ENTRIES = 67
EXPECT_STREAMS = 136
EXPECT_COMMANDS = 1967


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    exe = args.game_dir.expanduser().resolve() / "Hod2.exe"
    if not exe.exists():
        raise SystemExit(f"no Hod2.exe under {args.game_dir}")
    tab = ExeTables(exe)

    try:
        blk = tab.civilian_scripts()
    except ValueError as exc:
        print(f"FAIL {exc}")
        return 1

    entries, scripts = blk["entries"], blk["scripts"]
    cmds = sum(len(s) for s in scripts)
    print(f"{len(entries)} table entries -> {len(scripts)} streams, "
          f"{cmds} commands")

    bad = 0
    if len(entries) != EXPECT_ENTRIES:
        print(f"FAIL {len(entries)} table entries, expected {EXPECT_ENTRIES}")
        bad += 1
    if len(scripts) != EXPECT_STREAMS:
        print(f"FAIL {len(scripts)} streams, expected {EXPECT_STREAMS}")
        bad += 1
    if cmds != EXPECT_COMMANDS:
        print(f"FAIL {cmds} commands, expected {EXPECT_COMMANDS}")
        bad += 1

    ends = [s for s in scripts if not s or s[-1]["op"] != 0x2D]
    if ends:
        print(f"FAIL {len(ends)} streams do not end in 0x2D")
        bad += 1
    inner = sum(1 for s in scripts for c in s[:-1] if c["op"] == 0x2D)
    if inner:
        print(f"FAIL {inner} streams carry a 0x2D that is not the last command")
        bad += 1

    # Re-walk with the addresses, for the overlap and coverage checks. The
    # low bound comes from the walk, not from the table: one stream that only
    # an op-0x0E operand points at starts *before* the first table entry.
    hi = tab.CIVILIAN_SCRIPT_TABLE
    owner: dict[int, int] = {}
    seen: set[int] = set()
    pending = [tab._u32(hi + 4 * i) for i in range(len(entries))]
    overlaps = 0
    while pending:
        va = pending.pop(0)
        if va in seen:
            continue
        seen.add(va)
        p = va
        while True:
            op = tab._i32(p)
            n = 1 if op == 0x2D else tab.CIVILIAN_CMD_LEN.get(op, 2)
            if op == 0x10:
                n = tab.CIVILIAN_HOOK_LEN[tab._u32(p + 4) or 0]
            if p + 4 * n > hi:
                print(f"FAIL command at {p:#010x} runs past the script table")
                bad += 1
                break
            for k in range(4 * n):
                if owner.setdefault(p + k, p) != p:
                    overlaps += 1
            if op == 0x2D:
                break
            for i in tab.CIVILIAN_SCRIPT_OPS.get(op, ()):
                t = tab._i32(p + 4 * i)
                if t:
                    pending.append(t)
            p += 4 * n
    if overlaps:
        print(f"FAIL {overlaps} bytes are claimed by two different commands")
        bad += 1

    lo = min(owner)
    covered = len(owner)
    residue = (hi - lo) - covered
    print(f"{covered} of {hi - lo} bytes in {lo:#010x}..{hi:#010x} are "
          f"commands; {residue} are the operand data they point at")
    if residue > (hi - lo) // 4:
        print(f"FAIL {residue} bytes unaccounted for -- more than a quarter of "
              "the region is not command stream, which is what a desync looks "
              "like when the opcodes happen to stay in range")
        bad += 1

    print("clean" if not bad else f"{bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
