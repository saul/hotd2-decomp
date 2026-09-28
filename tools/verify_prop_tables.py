#!/usr/bin/env python3
"""The class-0x41 tables the port carries as literals match the EXE, word for word.

Types 38, 39, 40 and 44 build their objects out of tables compiled into
`Hod2.exe` -- positions, angles, hull corners, draw slots, counts, scales --
and `web/src/game/class41/type38.ts`, `type39.ts`, `type40.ts` and `type44.ts`
carry those tables as TypeScript literals, each citing the address it came
from. A literal is a copy, and a copy is only as good as the last time
somebody compared it (L21). This compares it: every row of every table is
read out of the image at the cited address and matched against the literal,
**as the 32-bit value the EXE holds** -- a float is equal when it packs to the
same four bytes, not when it is close.

What only this check can see: a table row mistyped, dropped or re-ordered in
the port -- which would put a church chair a few units from where the engine
draws it and nothing else would notice.

Class 0x28's three tables ride along (`web/src/game/class28/index.ts`): the
route table, the path lengths it is killed on and the `g_app_state` 10 poses
-- a freeze frame one off would throw stage 1's burning cars a frame early.

    python3 tools/verify_prop_tables.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from hod2lib.exetab import ExeTables  # noqa: E402

GAME = ROOT / "web" / "src" / "game" / "class41"


def ts_literal(path: Path, name: str):
    """`export const NAME ... = <literal>;` as a Python value.

    Only numbers, `-`, hex, `Math.fround(x)` (whose value is `x`), brackets,
    braces with numeric keys, and commas are expected; anything else fails.
    """
    text = path.read_text(encoding="utf-8")
    m = re.search(r"export const " + name + r"\b[^=]*=\s*", text)
    if not m:
        raise SystemExit(f"{path}: {name} not found")
    i = m.end()
    depth = 0
    j = i
    while j < len(text):
        c = text[j]
        if c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
        elif c == ";" and depth == 0:
            break
        j += 1
    body = text[i:j]
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"Math\.fround\(([^()]*)\)", r"\1", body)
    if not re.fullmatch(r"[\s\d.\-+xXa-fA-F,\[\]{}:e]*", body):
        raise SystemExit(f"{path}: {name} is not a plain numeric literal")
    return eval(body, {"__builtins__": {}})  # noqa: S307 -- checked above


def f32(v: float) -> bytes:
    return struct.pack("<f", v)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=False)
    args = ap.parse_args()
    if not args.game_dir:
        print("SKIP  verify_prop_tables: needs --game-dir")
        return 3
    exe = Path(args.game_dir).expanduser() / "Hod2.exe"
    if not exe.exists():
        print(f"SKIP  verify_prop_tables: no {exe}")
        return 3
    t = ExeTables(exe)

    def rd(va: int, n: int) -> bytes:
        r = t._v2r(va)
        return t.data[r:r + n]

    bad: list[str] = []
    checked = 0

    def same_f32(what: str, lit: float, raw: bytes) -> None:
        nonlocal checked
        checked += 1
        if f32(lit) != raw:
            bad.append(f"{what}: port {lit!r}, EXE "
                       f"{struct.unpack('<f', raw)[0]!r}")

    def same_int(what: str, lit: int, got: int) -> None:
        nonlocal checked
        checked += 1
        if lit != got:
            bad.append(f"{what}: port {lit}, EXE {got}")

    # g_prop_table38 / g_prop_table39: {f32 x,y,z; f32 rx,ry,rz}.
    for name, path, va in (("PROP_TABLE38", GAME / "type38.ts", 0x00593E70),
                           ("PROP_TABLE39", GAME / "type39.ts", 0x00593F48)):
        rows = ts_literal(path, name)
        for i, row in enumerate(rows):
            for k in range(6):
                same_f32(f"{name}[{i}][{k}]", row[k],
                         rd(va + i * 24 + k * 4, 4))

    # g_prop38_hull_points: s16 x,y,z.
    for i, row in enumerate(ts_literal(GAME / "type38.ts",
                                       "PROP38_HULL_POINTS")):
        got = struct.unpack("<3h", rd(0x00594008 + i * 6, 6))
        for k in range(3):
            same_int(f"PROP38_HULL_POINTS[{i}][{k}]", row[k], got[k])

    # g_prop_table44: {s16 x,y,z; pad; s32 rx,ry,rz}, stride 20.
    for i, row in enumerate(ts_literal(GAME / "type44.ts", "PROP_TABLE44")):
        raw = rd(0x005946F8 + i * 20, 20)
        got = list(struct.unpack_from("<3h", raw)) + list(
            struct.unpack_from("<3i", raw, 8))
        for k in range(6):
            same_int(f"PROP_TABLE44[{i}][{k}]", row[k], got[k])

    p40 = GAME / "type40.ts"
    counts = ts_literal(p40, "FRAGMENT_COUNTS")
    exe_counts = list(struct.unpack("<20b", rd(0x005945D8, 20)))
    for i in range(20):
        same_int(f"FRAGMENT_COUNTS[{i}]", counts[i], exe_counts[i])
    slots = ts_literal(p40, "FRAGMENT_SLOTS")
    exe_slots = struct.unpack("<20H", rd(0x0059463C, 40))
    for i in range(20):
        same_int(f"FRAGMENT_SLOTS[{i}]", slots[i], exe_slots[i])
    burst = ts_literal(p40, "FRAGMENT_BURST_SCALES")
    for i, b in enumerate(rd(0x0059469C, 20)):
        same_int(f"FRAGMENT_BURST_SCALES[{i}]", burst[i], b)
    for i, row in enumerate(ts_literal(p40, "FRAGMENT_SUBKIND0_OFFSETS")):
        for k in range(2):
            same_f32(f"FRAGMENT_SUBKIND0_OFFSETS[{i}][{k}]", row[k],
                     rd(0x00594158 + i * 8 + k * 4, 4))
    for i, row in enumerate(ts_literal(p40, "FRAGMENT_SUBKIND1_POSES")):
        for k in range(6):
            same_f32(f"FRAGMENT_SUBKIND1_POSES[{i}][{k}]", row[k],
                     rd(0x00594038 + i * 24 + k * 4, 4))
    poses = ts_literal(p40, "FRAGMENT_POSES")
    ptrs = struct.unpack("<20I", rd(0x005945EC, 80))
    for sk in range(20):
        if not ptrs[sk]:
            same_int(f"FRAGMENT_POSES has no row for sub-kind {sk}",
                     int(sk in poses), 0)
            continue
        rows = poses.get(sk, [])
        same_int(f"FRAGMENT_POSES[{sk}] row count", len(rows), exe_counts[sk])
        for i, row in enumerate(rows):
            for k in range(3):
                same_f32(f"FRAGMENT_POSES[{sk}][{i}][{k}]", row[k],
                         rd(ptrs[sk] + i * 12 + k * 4, 4))
    for name, va, n, fmt in (
            ("FRAGMENT_SUBKIND11_SCALES", 0x00594664, 3, "f"),
            ("FRAGMENT_SUBKIND12_SCALES", 0x00594670, 4, "f"),
            ("FRAGMENT_SUBKIND11_YAWS", 0x00594680, 3, "i"),
            ("FRAGMENT_SUBKIND12_YAWS", 0x0059468C, 4, "i")):
        lit = ts_literal(p40, name)
        for i in range(n):
            raw = rd(va + i * 4, 4)
            if fmt == "f":
                same_f32(f"{name}[{i}]", lit[i], raw)
            else:
                same_int(f"{name}[{i}]", lit[i], struct.unpack("<i", raw)[0])

    # Class 0x28 (`web/src/game/class28/index.ts`): g_class28_route_table
    # {s16 slot, s16 freeze}, g_cam_path_length at each route's slot, and
    # g_class28_fixed_poses as the raw words the image holds.
    p28 = ROOT / "web" / "src" / "game" / "class28" / "index.ts"
    routes = ts_literal(p28, "CLASS28_ROUTES")
    lengths = ts_literal(p28, "CLASS28_ROUTE_LENGTH")
    for i, (slot, freeze) in enumerate(routes):
        got = struct.unpack("<2h", rd(0x00589AE0 + i * 4, 4))
        same_int(f"CLASS28_ROUTES[{i}].slot", slot, got[0])
        same_int(f"CLASS28_ROUTES[{i}].freeze", freeze, got[1])
        same_int(f"CLASS28_ROUTE_LENGTH[0x{slot:x}]", lengths.get(slot, -1),
                 struct.unpack("<i", rd(0x00576D38 + slot * 4, 4))[0])
    same_int("CLASS28_ROUTE_LENGTH has one row per route", len(lengths),
             len(routes))
    for i, row in enumerate(ts_literal(p28, "CLASS28_FIXED_POSE_WORDS")):
        got = struct.unpack("<6I", rd(0x0055DD18 + i * 0x18, 0x18))
        for k in range(6):
            same_int(f"CLASS28_FIXED_POSE_WORDS[{i}][{k}]", row[k], got[k])

    print(f"{checked} table words compared against the EXE")
    if bad:
        for line in bad[:40]:
            print(f"  {line}")
        print(f"\nFAIL {len(bad)} words differ")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
