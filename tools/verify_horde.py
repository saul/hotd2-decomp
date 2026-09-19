#!/usr/bin/env python3
"""Check the class-0x40 horde against the EXE it was read from.

`PlaceHorde` (`FUN_0043BD30`) builds its members from tables, not from the
descriptor: where each one walks in (`g_horde_formation`, 0x0055E200), how fast
(`g_horde_spline_rates`), when it may be shot (`g_horde_shot_delay`), where it
wanders (`g_horde_wander_origin` / `_cell`), and which skin it wears
(`g_submodel_bone_slots`, 0x004E1F88). The port carries all of them as
literals in `web/src/game/class40/tables.ts`, and the exporter carries the
second skin in `web/src/hod2lib/characters.ts`. What only this can see:

  * **every number in those tables is the EXE's**, byte for byte, so a
    transcription slip -- a sign, a swapped pair -- is caught rather than
    showing up as one member walking a slightly wrong line;
  * **the seven class-0x40 descriptors split five and two** on `desc+0x25`,
    the byte `PlaceHorde` switches on: five hordes, two props. The annotation
    that first described the class said all nine spawns were hordes;
  * **character type 0x1D is `mol.bin`** with nine nodes, and the two skin
    rows are its even and odd parts -- row 0 the skeleton's own slots;
  * **the sounds are what the port says they are**: `PDMG_MORR1/2_44.wav` in
    `STAGE1_SE` and `STAGE2_SE`, `BOBBLE1_22.wav`, `BULLET_MET3_22.WAV`.

    python3 tools/verify_horde.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import evt  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TABLES_TS = ROOT / "web/src/game/class40/tables.ts"
INDEX_TS = ROOT / "web/src/game/class40/index.ts"
CHARS_TS = ROOT / "web/src/hod2lib/characters.ts"

FORMATION = 0x0055E200
RATES = 0x0055E520
SHOT_DELAY = 0x0055E534
ORIGIN = 0x0055E568
CELL = 0x0055E574
BONE_SLOTS = 0x004E1F88
RIM = 0x00592688

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}"
          + ("" if ok or not detail else f" -- {detail}"))


def s8(v: int) -> int:
    return v - 256 if v > 127 else v


def exe_bytes(t: ExeTables, va: int, n: int) -> bytes:
    out = bytearray()
    for i in range(0, n, 2):
        out += struct.pack("<H", t._u16(va + i))
    return bytes(out[:n])


def ts_array(src: str, name: str) -> list[float]:
    """The numbers of `export const NAME ... = [ ... ];`, comments stripped."""
    m = re.search(rf"export const {name}\b[^=]*=\s*\[(.*?)\];", src, re.S)
    if not m:
        return []
    body = re.sub(r"//[^\n]*", "", m.group(1))
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", body)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", type=Path,
                    default=Path(os.path.expanduser("~/THE HOUSE OF THE DEAD 2")))
    args = ap.parse_args()
    exe = args.game_dir / "Hod2.exe"
    if not exe.exists():
        print(f"no {exe}: nothing asserted")
        return 3
    t = ExeTables(exe)
    tables = TABLES_TS.read_text()

    raw = exe_bytes(t, FORMATION, 800)
    want = [s8(b) for b in raw]
    got = [int(x) for x in ts_array(tables, "HORDE_FORMATION")]
    check("g_horde_formation: 400 points, as the EXE has them",
          got == want, f"{len(got)} numbers, first diff at "
          f"{next((i for i, (a, b) in enumerate(zip(got, want)) if a != b), -1)}")
    rates = [struct.unpack("<f", struct.pack("<I", t._u32(RATES + 4 * i)))[0]
             for i in range(5)]
    got = ts_array(tables, "HORDE_SPLINE_RATES")
    check("g_horde_spline_rates", len(got) == 5 and all(
        abs(a - b) < 1e-6 for a, b in zip(got, rates)), f"{got} vs {rates}")
    for name, va, n in (("HORDE_SHOT_DELAY", SHOT_DELAY, 50),
                        ("HORDE_WANDER_ORIGIN", ORIGIN, 10),
                        ("HORDE_WANDER_CELL", CELL, 10)):
        want = [s8(b) for b in exe_bytes(t, va, n)]
        got = [int(x) for x in ts_array(tables, name)]
        check(name.lower().replace("horde_", "g_horde_"), got == want,
              f"{got} vs {want}")
    rows = [t._u16(BONE_SLOTS + 2 * i) for i in range(20)]
    got = [int(x) for x in ts_array(tables, "SUBMODEL_BONE_SLOTS")]
    check("g_submodel_bone_slots: two rows of ten", got == rows,
          f"{got} vs {rows}")
    rim = [struct.unpack("<f", struct.pack("<I", t._u32(RIM + 4 * i)))[0]
           for i in range(8)]
    got = ts_array(tables, "EMERGE_PROP_RIM_POINTS")
    check("g_emerge_prop_rim_points", len(got) == 8 and all(
        abs(a - b) < 1e-5 for a, b in zip(got, rim)), f"{got}")
    m = re.search(r"CLASS40_SKIN_SLOTS = \[([^\]]*)\]", CHARS_TS.read_text())
    skin = [int(x) for x in re.findall(r"\d+", m.group(1))] if m else []
    check("the exporter's second skin is row 1, bones 1..9", skin == rows[11:],
          f"{skin} vs {rows[11:]}")

    check("character type 0x1D is mol.bin",
          t.character_asset_file(0x1D) == "mol.bin",
          str(t.character_asset_file(0x1D)))
    skel = t.character_skeleton(0x1D)
    check("...with nine nodes whose slots are row 0",
          len(skel) == 9 and [n["slot"] for n in sorted(
              skel, key=lambda n: n["bone"])] == rows[1:10],
          f"{[n['slot'] for n in skel]}")
    slots = t.asset_slots()
    check("...and row 1 is mol.bin's too",
          all((slots.get(s) or ("",))[0] == "mol.bin" for s in rows[11:20]))

    idx = INDEX_TS.read_text()
    sounds = {0x1E18A9: "STAGE1_SE\\PDMG_MORR2_44.wav",
              0x1D18A9: "STAGE1_SE\\PDMG_MORR1_44.wav",
              0x2119A9: "STAGE2_SE\\PDMG_MORR2_44.wav",
              0x2019A9: "STAGE2_SE\\PDMG_MORR1_44.wav",
              0x118A9: "STAGE1_SE\\BOBBLE1_22.wav",
              0x119A9: "STAGE2_SE\\BOBBLE1_22.wav",
              0x1116A9: "COMMON\\BULLET_MET3_22.WAV"}
    for sid, name in sounds.items():
        check(f"sound 0x{sid:X} is {name}", t.sound_name(sid) == name,
              str(t.sound_name(sid)))
    check("...and the kill's four are the ones the port plays",
          all(f"0x{sid:x}" in idx for sid in (0x1E18A9, 0x1D18A9, 0x2119A9,
                                              0x2019A9)))

    counts = {1: 0, 2: 0}
    for sc in range(6):
        f = t.scene_evt_file(sc)
        if not f:
            continue
        hits = list(args.game_dir.rglob(f.split("\\")[-1]))
        if not hits:
            continue
        e = evt.load(str(hits[0]))
        for s in evt.spawns(e):
            if s.cls != 0x40:
                continue
            sel = e.raw[s.offset + 0x25]
            counts[sel] = counts.get(sel, 0) + 1
    check("seven descriptors: five hordes and two props",
          counts.get(1) == 5 and counts.get(2) == 2, f"{counts}")

    print(f"\n{failures} failed" if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
