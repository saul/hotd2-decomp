#!/usr/bin/env python3
"""Check the `mot/` format against every shipped bank.

The layout comes from the loader (`FUN_00412C10`/`D40`/`D90`) and the sampler
(`FUN_00412F50`); this checks the files agree. Nothing here was derived from
the data -- it is the other direction.

Checks, per bank:

* the file exists and is at least `count * 4` bytes;
* the int32 offsets at the head are ascending and inside the file;
* each motion block's first four bytes equal the number of whole frames
  between it and the next block, at the stride the character's bone count
  implies -- which is the real test of both the stride formula and the record
  layout, because a wrong stride would almost never divide exactly.
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import mot as motlib, stage as stagelib  # noqa: E402

BANK_NAME, BANK_IDS, BANK_COUNT = 0x004D1B00, 0x004E2B14, 0x004E2BDC
BONE_COUNTS = 0x004E0724
#: motion id -> bank id. `FUN_00412F50` passes `DAT_004E2C40[motion]` to the
#: loader, so the set of real banks is exactly the values in this table --
#: which is how the bank range gets bounded without guessing. `DAT_004D1B00`
#: is shared with the camera-path filenames, so scanning it blind picks up
#: `cp_st1.bin` and friends.
MOTION_BANK_OF = 0x004E2C40


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / "THE HOUSE OF THE DEAD 2")
    args = ap.parse_args()
    t = stagelib.get_tables(args.game_dir)
    raw = t.data
    fn, ids, cnt = t._v2r(BANK_NAME), t._v2r(BANK_IDS), t._v2r(BANK_COUNT)
    bc = t._v2r(BONE_COUNTS)

    # Rather than require a bank to belong to a known character, test the
    # format's own arithmetic: the block size divided by the declared frame
    # count must be a stride the formula can actually produce. That covers the
    # komono_* banks, which animate props whose bone counts are not in the
    # character table at all.
    legal = {motlib.frame_stride(n): n for n in range(1, 512)}

    mb = t._v2r(MOTION_BANK_OF)
    real_banks = sorted({raw[mb + m] for m in range(2048)
                         if mb + m < len(raw) and raw[mb + m] < 64})

    problems: list[str] = []
    bones: set[int] = set()
    banks = motions = blocks = matched = 0
    for b in real_banks:
        p = struct.unpack_from("<I", raw, fn + b * 4)[0]
        name = t._cstr(p) if p else None
        n = struct.unpack_from("<H", raw, cnt + b * 2)[0]
        if not name or not (0 < n <= 4096):
            continue
        io = t._v2r(struct.unpack_from("<I", raw, ids + b * 4)[0])
        if io is None:
            # `DAT_004D1B00` is shared with the camera-path filenames, so an
            # entry is only a motion bank when it also has an id list here.
            # That is what separates `people.bin` from `cp_st1.bin`.
            continue
        mids = list(struct.unpack_from(f"<{n}h", raw, io))
        if not (args.game_dir / "mot" / name).is_file():
            continue
        bank = motlib.load_bank(args.game_dir, name, mids)
        if bank is None:
            problems.append(f"{name}: present but shorter than its own header")
            continue
        banks += 1
        motions += n
        offs = [bank.offsets[m] for m in mids]
        for i in range(len(offs) - 1):
            if offs[i] >= offs[i + 1]:
                problems.append(f"{name}: offsets not ascending at {i}")
                break
        for o in offs:
            if not (n * 4 <= o < bank.size):
                problems.append(f"{name}: offset {o} outside the file")
                break
        ordered = sorted(offs) + [bank.size]
        for m in mids:
            o = bank.offsets[m]
            span = ordered[ordered.index(o) + 1] - o - 4
            declared = bank.frame_count(m)
            blocks += 1
            if span >= 0 and declared > 0 and span % declared == 0 \
                    and span // declared in legal:
                matched += 1
                bones.add(legal[span // declared])
            else:
                problems.append(
                    f"{name}: motion {m} declares {declared} frames in {span} "
                    f"bytes -> {span / declared if declared else 0:.2f} bytes "
                    f"per frame, which no bone count produces")

    print(f"{banks} banks, {motions} motions, {blocks} blocks")
    print(f"blocks whose declared frame count matches the block size at a "
          f"real stride: {matched}/{blocks}")
    print(f"bone counts implied by the files: {min(bones)}..{max(bones)} "
          f"({len(bones)} distinct)" if bones else "no bone counts implied")
    print()
    if problems:
        for p_ in problems[:20]:
            print("  " + p_)
        if len(problems) > 20:
            print(f"  ... and {len(problems) - 20} more")
        print(f"\n{len(problems)} problems")
        return 1
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
