#!/usr/bin/env python3
"""Class 0x12's descriptor tail is read the way the EXE reads it, and every
slot its strip draws is in the bundle.

Class 0x12 -- `ScriptedPropInit12` (`FUN_0043F9D0`) and `ScriptedPropUpdate12`
(`FUN_0043FA60`), `game/class12/` -- is stage 1's wooden door, the one the bin
captor bursts out of: `door_1.bin[41]` until script flag 34, then
`door_1.bin[42..95]` a slot a frame, then gone. Before it had a module the
spawn built nothing and the captor walked out of an empty doorway, and nothing
anywhere said a class was missing. Three things can each put it back there,
and this is the check for all three:

* **The exporter reads the tail at the wrong place or width.**
  `class12Tail` in `web/src/hod2lib/characters.ts` is read out of the source,
  field by field, and each `rec.param(offset, kind)` is held against the
  instruction in `ScriptedPropInit12` that reads the same field -- the bytes
  quoted below are re-read out of `Hod2.exe` every run, so the table cannot
  drift from the image either. A cam frame read two bytes off would despawn
  the door on a frame the camera never reaches; a flag read as a u8 would wait
  on a flag nothing raises.
* **The bundle carries something else.** Every class-0x12 spawn in every
  stage's `evt/` table whose behaviour the port runs (`g_prop_behaviours`
  entry 0) has a placement, and the placement's `class12` is what the Python
  half's `class12_tail` decodes out of the same bytes -- the two halves of
  the library agreeing on the disc, not on each other's text.
* **A frame of the strip has no model.** `AssetDrawSlot(__ftol(sub+0x14))`
  draws the cursor truncated, and the cursor runs from `first` by `step` until
  it is past `last`: every slot that walk truncates to, and the one the prop
  waits on, is a `_slot_<hex>` node in the stage's glTF, or that frame draws
  nothing. The walk is simulated here in f32, as the FPU stores it, rather
  than taken from the exporter's own list.

    python3 tools/verify_flag_strips.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
    HOTD2_BUNDLE=/path/to/export python3 tools/verify_flag_strips.py --game-dir ...
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from hod2lib import characters as charlib  # noqa: E402
from hod2lib import evt as evtlib  # noqa: E402
from hod2lib import stage as stagelib  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

CHARACTERS_TS = ROOT / "web" / "src" / "hod2lib" / "characters.ts"

#: `ScriptedPropInit12`'s reads of the tail, `ESI` = `obj+0x130C`, as
#: `(address, bytes, field, tail offset, kind)`. Every one is a load from
#: `[ESI + disp]`: `0F BF` is a sign-extending word load, `66 8B` a word move
#: into a word of the block (which the update then loads with `MOVSX`), `8B` a
#: dword. The dword at `+0x04` is stored to `obj+0x14C` (`0x0043F9FD`), a
#: pointer; `+0x14` and `+0x18` go to `sub+0x18` and `sub+0x10`, which the
#: update loads with `FLD` (`0x0043FB81`, `0x0043FB25`) -- floats.
INIT12 = 0x0043F9D0
READS = [
    (0x0043F9EC, "0fbf0e", "slot", 0x00, "i16"),
    (0x0043FA10, "668b4e02", "delay", 0x02, "i16"),
    (0x0043F9FA, "8b5604", "coli", 0x04, "u32"),
    (0x0043FA03, "0fbf4e08", "behaviour", 0x08, "i16"),
    (0x0043FA18, "668b560a", "cam_path", 0x0A, "i16"),
    (0x0043FA20, "668b4e0c", "cam_frame", 0x0C, "i16"),
    (0x0043FA28, "668b560e", "first", 0x0E, "i16"),
    (0x0043FA30, "668b4e10", "last", 0x10, "i16"),
    (0x0043FA38, "668b5612", "flag", 0x12, "i16"),
    (0x0043FA40, "8b4e14", "step", 0x14, "f32"),
    (0x0043FA46, "8b5618", "scale", 0x18, "f32"),
]
#: ...and the three instructions that say which is which: the slot is FILD'd
#: into `sub+0x14` (the cursor), `+0x14` lands in `sub+0x18` (the step the
#: update adds), `+0x18` in `sub+0x10` (the scale it compares with 1.0).
STORES = [
    (0x0043F9F7, "d95814", "slot -> sub+0x14, the cursor"),
    (0x0043FA43, "894818", "tail+0x14 -> sub+0x18, the step"),
    (0x0043FA49, "895010", "tail+0x18 -> sub+0x10, the scale"),
]


def exporter_reads() -> dict[str, tuple[int, str]]:
    """`class12Tail`'s own reads, out of the exporter source."""
    text = CHARACTERS_TS.read_text(encoding="utf-8")
    m = re.search(r"export function class12Tail\(.*?\n\}\n", text, re.S)
    if not m:
        raise SystemExit(f"{CHARACTERS_TS}: class12Tail not found")
    body = m.group(0)
    out: dict[str, tuple[int, str]] = {}
    for f, off, kind in re.findall(
            r'(\w+):\s*rec\.param\((0x[0-9a-fA-F]+|\d+),\s*"(\w+)"\)', body):
        out[f] = (int(off, 0), kind)
    # The coli word is read once, into `word`, and resolved after.
    w = re.search(r'const word = rec\.param\((0x[0-9a-fA-F]+|\d+),\s*"(\w+)"\)',
                  body)
    if w:
        out["coli"] = (int(w.group(1), 0), w.group(2))
    return out


def f32(v: float) -> float:
    return struct.unpack("<f", struct.pack("<f", v))[0]


def strip_slots(t: dict) -> list[int]:
    """What `ScriptedPropUpdate12` can hand `AssetDrawSlot`: the slot it waits
    on, then `__ftol` of every cursor from `first` by `step` while it is not
    past `last` -- the walk the update makes, in f32."""
    out = [t["slot"]]
    step = f32(t["step"])
    if step <= 0:
        return out
    c = f32(float(t["first"]))
    while c <= t["last"] and len(out) < 10000:
        s = math.trunc(c)
        if s not in out:
            out.append(s)
        c = f32(c + step)
    return out


def glb_json(path: Path) -> dict:
    b = path.read_bytes()
    off = 12
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        if ty == 0x4E4F534A:
            return json.loads(b[off + 8:off + 8 + ln])
        off += 8 + ln
    raise SystemExit(f"{path}: no JSON chunk")


def same(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        return (a is not None and b is not None
                and struct.pack("<f", a) == struct.pack("<f", b))
    return a == b


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", type=Path, default=None)
    ap.add_argument("--bundle", type=Path,
                    default=Path(os.environ.get("HOTD2_BUNDLE")
                                 or ROOT / "extract" / "player"))
    args = ap.parse_args()
    if args.game_dir is None:
        print("SKIP  verify_flag_strips: needs --game-dir")
        return 3
    game = args.game_dir.expanduser().resolve()
    exe_path = game / "Hod2.exe"
    if not exe_path.exists():
        print(f"SKIP  verify_flag_strips: no Hod2.exe under {game}")
        return 3
    exe = ExeTables(exe_path)

    def read_va(va: int, n: int) -> bytes | None:
        r = exe._v2r(va)
        return None if r is None else exe.data[r:r + n]

    bad: list[str] = []

    # -- the tail's layout, against the routine that reads it ---------------
    for addr, want, what in [(a, b, f"{f} read") for a, b, f, _, _ in READS] \
            + STORES:
        got = read_va(addr, len(want) // 2)
        if got is None or got.hex() != want:
            bad.append(f"ScriptedPropInit12 at 0x{addr:08X}: expected {want} "
                       f"({what}), the EXE has "
                       f"{got.hex() if got else 'nothing'}")
    reads = exporter_reads()
    for addr, _, field, off, kind in READS:
        have = reads.get(field)
        if have != (off, kind):
            bad.append(f"class12Tail reads `{field}` as {have}, and "
                       f"ScriptedPropInit12 reads it at tail+0x{off:02X} as "
                       f"{kind} (0x{addr:08X})")
    extra = sorted(set(reads) - {f for _, _, f, _, _ in READS})
    if extra:
        bad.append(f"class12Tail reads fields the routine does not: {extra}")
    print(f"ScriptedPropInit12 (0x{INIT12:08X}): {len(READS)} tail reads and "
          f"{len(STORES)} stores quoted; class12Tail reads {len(reads)} fields")

    # -- every stage: the spawns, the placements, the strips ----------------
    manifest = args.bundle / "manifest.json"
    if not manifest.exists():
        print(f"SKIP  verify_flag_strips: no bundle at {args.bundle} "
              f"(the layout above was checked)")
        if bad:
            for line in bad:
                print(f"  {line}")
            print(f"\nFAIL {len(bad)}")
            return 1
        return 3
    entries = json.loads(manifest.read_text())["stages"]
    spawns = placed = slots = 0
    for entry in entries:
        name = entry["name"]
        m = re.fullmatch(r"stage(\d+)(_original)?", name)
        if not m:
            continue
        st = stagelib.Stage(game, stage=int(m.group(1)),
                            original=bool(m.group(2)))
        ev = st.evt()
        if ev is None:
            continue
        sets = st.colisets()
        recs = {r.offset: r for r in evtlib.spawns(ev) if r.cls == 0x12}
        script = json.loads((args.bundle / name / entry["script"]).read_text())
        pls = {p["at"]: p for p in script["characters"]["placements"]
               if p.get("class") == 0x12}
        glb = args.bundle / name / entry["geometry"]
        nodes = {int(mm.group(1), 16)
                 for n in glb_json(glb).get("nodes", [])
                 for mm in [re.search(r"_slot_([0-9a-f]{4})$",
                                      n.get("name") or "")] if mm}
        for at, rec in sorted(recs.items()):
            spawns += 1
            want = charlib.class12_tail(rec, sets)
            pl = pls.get(at)
            if want["behaviour"] != 0:
                if pl is not None:
                    bad.append(f"{name}: 0x{at:X} runs behaviour "
                               f"{want['behaviour']}, which the port does not, "
                               f"and the bundle placed it anyway")
                continue
            if pl is None or not pl.get("class12"):
                bad.append(f"{name}: class-0x12 spawn 0x{at:X} has no "
                           f"placement, so nothing builds it")
                continue
            placed += 1
            got = pl["class12"]
            for k, v in want.items():
                if not same(got.get(k), v):
                    bad.append(f"{name}: 0x{at:X} class12.{k} is "
                               f"{got.get(k)!r}, the evt says {v!r}")
            if pl.get("init_flags") != rec.init_flags:
                bad.append(f"{name}: 0x{at:X} init_flags "
                           f"{pl.get('init_flags')!r}, the record says "
                           f"{rec.init_flags!r}")
            for s in strip_slots(want):
                slots += 1
                if s not in nodes:
                    bad.append(f"{name}: 0x{at:X} can draw slot 0x{s:04x} and "
                               f"the glTF has no `_slot_{s:04x}` node")
        for at in sorted(set(pls) - set(recs)):
            bad.append(f"{name}: a class-0x12 placement at 0x{at:X} with no "
                       f"spawn record behind it")

    print(f"{len(entries)} bundles: {spawns} class-0x12 spawns, {placed} "
          f"placed and held to the evt, {slots} strip slots looked for")
    if not spawns:
        bad.append("no class-0x12 spawn in any stage -- the three shipped ones "
                   "(stage 1 0x3D88, stage 2 0x15644, stage 5 0x2398) are gone")
    if bad:
        for line in bad[:40]:
            print(f"  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        print(f"\nFAIL {len(bad)}")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
