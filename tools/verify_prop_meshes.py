#!/usr/bin/env python3
"""The class-0x44 objects that are shot through their own mesh carry that
mesh into the bundle, and the EXE still says they are shot that way.

Two builders of class 0x44 hand their object a collision blob and the
`obj+0x34` bits that send the shot test to it: `PlaceStoryModeSwitch`
(`FUN_00473A70`, selector 17 -- the route-branch writer behind five of the
game's branch records) and `PropBuildScriptFlagEffect` (`FUN_00472B30`,
selector 0 -- stage 1's window). The port has them in
`game/class44/story_switch.ts` and `game/class44/script_flag_effect.ts`, and
until the exporter resolved the descriptor's `+0x08` to a `coli.blobs` key no
shipped switch could be shot at all. Three things can put that back, and this
is the check for all three:

* **The EXE is not what the port read.** Every instruction the port's
  reading rests on -- the tail loads, the `OR` of `0x50`/`0x51`, the store to
  `obj+0x14C`, the draw's `MatrixStore(obj+0x150)` and the
  `RegisterForShotTest` past the pop -- is quoted below and re-read out of
  `Hod2.exe` every run, as bytes, including each `CALL`'s target.
* **The exporter reads the tail somewhere else.** `storySwitchTail` and
  `scriptFlagEffectColi` in `web/src/hod2lib/props.ts` are read out of the
  source, field by field, and held against the loads quoted here.
* **The bundle carries something else.** For every class-0x44 spawn of
  selectors 0 and 17 in every stage's `evt/`, the Python half's
  `story_switch_tail` / `script_flag_effect_coli` decodes the same bytes, the
  bundle's placement must agree field for field, every pointer must resolve
  to a blob -- a pointer that lands on no blob header is what a wrong reading
  looks like -- and that blob must be in the stage's own `coli.blobs`.

    python3 tools/verify_prop_meshes.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
    HOTD2_BUNDLE=/path/to/export python3 tools/verify_prop_meshes.py --game-dir ...
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from hod2lib import evt as evtlib  # noqa: E402
from hod2lib import props as propslib  # noqa: E402
from hod2lib import stage as stagelib  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

PROPS_TS = ROOT / "web" / "src" / "hod2lib" / "props.ts"

#: `PlaceStoryModeSwitch`'s loads out of the tail (`EAX` = `placer+0x1390`),
#: as `(address, bytes, field, tail offset, kind)`. `8A`/`0F BE` are byte
#: loads (the second sign-extending), `66 8B` a word, `8B` a dword; the
#: store beside each says where it lands.
SWITCH_READS = [
    (0x00473B14, "8a08", "hinge_curve", 0x00, "i8"),
    (0x00473AF6, "668b4804", "slot", 0x04, "i16"),
    (0x00473B02, "8b4808", "coli", 0x08, "u32"),
    (0x00473B0B, "8b480c", "swing_sign", 0x0C, "i32"),
    (0x00473B1C, "0fbe4810", "branch_flag", 0x10, "i8"),
    (0x00473B26, "0fbe4811", "remove_flag", 0x11, "i8"),
    (0x00473B36, "8b4814", "scale", 0x14, "f32"),
    (0x00473B51, "660fbe4820", "keys", 0x20, "i8"),
]
SWITCH_CODE = [
    (0x00473B16, "888e94010000", "tail+0x00 -> obj+0x194, the curve"),
    (0x00473AD5, "837808ff", "CMP tail+0x08, -1"),
    (0x00473ADB, "83c950", "...else OR 0x50: the mesh arm"),
    (0x00473AE9, "c7862401000000000041", "...-1: obj+0x124 = 8.0, the sphere"),
    (0x00473B05, "898e4c010000", "tail+0x08 -> obj+0x14C, the blob"),
    (0x00473B0E, "898edc010000", "tail+0x0C -> obj+0x1DC, the swing's sign"),
    (0x00473B39, "898ea8010000", "tail+0x14 -> obj+0x1A8, the scale"),
    (0x00473B81, "8815ec269a00", "g_story_switch_thrown = 0"),
    # `StoryModeSwitchUpdate`'s tail: the scale, the store, the registration.
    (0x0047536D, "e84e490300", "CALL MatrixScale"),
    (0x004753C0, "8d8e50010000", "LEA ECX, [ESI + 0x150]"),
    (0x004753C7, "e8d4380300", "CALL MatrixStore"),
    (0x004753D7, "e884fdf8ff", "CALL RegisterForShotTest"),
]
#: `PropBuildScriptFlagEffect`'s one load the port adds, and the routine's
#: capture copy and registration.
EFFECT_READS = [
    (0x00472BB3, "8b5008", "coli", 0x08, "u32"),
]
EFFECT_CODE = [
    (0x00472B4F, "83ca51", "OR 0x51"),
    (0x00472BC0, "89964c010000", "tail+0x08 -> obj+0x14C, the blob"),
    (0x00473CAF, "8dbb50010000", "LEA EDI, [EBX + 0x150]"),
    (0x00473CBB, "f3a5", "REP MOVSD: the capture into obj+0x150"),
    (0x00473CDF, "e87c14f9ff", "CALL RegisterForShotTest"),
]
#: Where each quoted `CALL` must land.
CALL_TARGETS = {
    0x0047536D: 0x004A9CC0,     # MatrixScale
    0x004753C7: 0x004A8CA0,     # MatrixStore
    0x004753D7: 0x00405160,     # RegisterForShotTest
    0x00473CDF: 0x00405160,
}


def exporter_reads(fn: str) -> dict[str, tuple[int, str]]:
    """One of `props.ts`'s tail readers, field by field, out of the source."""
    text = PROPS_TS.read_text(encoding="utf-8")
    m = re.search(rf"export function {fn}\(.*?\n\}}\n", text, re.S)
    if not m:
        raise SystemExit(f"{PROPS_TS}: {fn} not found")
    out: dict[str, tuple[int, str]] = {}
    body = m.group(0)
    for f, off, kind in re.findall(
            r'(\w+):\s*(?:coliKey\()?rec\.param\((0x[0-9a-fA-F]+|\d+),'
            r'\s*"(\w+)"\)', body):
        out.setdefault(f, (int(off, 0), kind))
    # The array fields read their first element with an offset expression.
    for f, off, kind in re.findall(
            r'(\w+):\s*\[.*?rec\.param\((0x[0-9a-fA-F]+|\d+)(?:\s*\+\s*k)?,'
            r'\s*"(\w+)"\)', body, re.S):
        out.setdefault(f, (int(off, 0), kind))
    if fn == "scriptFlagEffectColi":
        w = re.search(r'rec\.param\((0x[0-9a-fA-F]+|\d+),\s*"(\w+)"\)', body)
        if w:
            out["coli"] = (int(w.group(1), 0), w.group(2))
    return out


def same(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        return (a is not None and b is not None
                and struct.pack("<f", a) == struct.pack("<f", b))
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", type=Path, default=None)
    ap.add_argument("--bundle", type=Path,
                    default=Path(os.environ.get("HOTD2_BUNDLE")
                                 or ROOT / "extract" / "player"))
    args = ap.parse_args()
    if args.game_dir is None:
        print("SKIP  verify_prop_meshes: needs --game-dir")
        return 3
    game = args.game_dir.expanduser().resolve()
    exe_path = game / "Hod2.exe"
    if not exe_path.exists():
        print(f"SKIP  verify_prop_meshes: no Hod2.exe under {game}")
        return 3
    exe = ExeTables(exe_path)

    def read_va(va: int, n: int) -> bytes | None:
        r = exe._v2r(va)
        return None if r is None else exe.data[r:r + n]

    bad: list[str] = []

    # -- the routines, against the image -------------------------------------
    quoted = ([(a, b, f"{f} read") for a, b, f, _, _ in SWITCH_READS]
              + SWITCH_CODE
              + [(a, b, f"{f} read") for a, b, f, _, _ in EFFECT_READS]
              + EFFECT_CODE)
    for addr, want, what in quoted:
        got = read_va(addr, len(want) // 2)
        if got is None or got.hex() != want:
            bad.append(f"0x{addr:08X}: expected {want} ({what}), the EXE has "
                       f"{got.hex() if got else 'nothing'}")
    for addr, target in CALL_TARGETS.items():
        got = read_va(addr, 5)
        if got is None or got[0] != 0xE8:
            continue          # already reported above
        dest = (addr + 5 + struct.unpack_from("<i", got, 1)[0]) & 0xFFFFFFFF
        if dest != target:
            bad.append(f"0x{addr:08X} calls 0x{dest:08X}, not 0x{target:08X}")
    for fn, reads in (("storySwitchTail", SWITCH_READS),
                      ("scriptFlagEffectColi", EFFECT_READS)):
        have = exporter_reads(fn)
        for addr, _, field, off, kind in reads:
            if have.get(field) != (off, kind):
                bad.append(f"{fn} reads `{field}` as {have.get(field)}, and "
                           f"the builder reads it at tail+0x{off:02X} as "
                           f"{kind} (0x{addr:08X})")
    print(f"PlaceStoryModeSwitch / StoryModeSwitchUpdate: "
          f"{len(SWITCH_READS)} tail reads and {len(SWITCH_CODE)} instructions "
          f"quoted; PropBuildScriptFlagEffect / ScriptFlagEffectUpdate: "
          f"{len(EFFECT_READS)} and {len(EFFECT_CODE)}")

    # -- every stage: the spawns, the placements, the blobs ------------------
    manifest = args.bundle / "manifest.json"
    if not manifest.exists():
        print(f"SKIP  verify_prop_meshes: no bundle at {args.bundle} "
              f"(the routines above were checked)")
        if bad:
            for line in bad:
                print(f"  {line}")
            print(f"\nFAIL {len(bad)}")
            return 1
        return 3
    entries = json.loads(manifest.read_text())["stages"]
    switches = meshes = windows = 0
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
        recs = [r for r in evtlib.spawns(ev)
                if r.cls == 0x44 and r.hp in (0, 17)]
        script = json.loads((args.bundle / name / entry["script"]).read_text())
        blobs = set((script.get("coli") or {}).get("blobs") or {})
        pls = {(p["at"], p["container"]): p
               for p in (script.get("breakables") or {}).get("placements", [])
               if p.get("container") in ("story_switch", "script_flag_effect")}
        for rec in recs:
            if rec.hp == 17:
                switches += 1
                want = propslib.story_switch_tail(rec, sets)
                pl = pls.get((rec.offset, "story_switch"))
                label = f"{name}: switch 0x{rec.offset:X}"
            else:
                windows += 1
                want = {"coli": propslib.script_flag_effect_coli(rec, sets)}
                pl = pls.get((rec.offset, "script_flag_effect"))
                label = f"{name}: window 0x{rec.offset:X}"
            if pl is None:
                bad.append(f"{label} has no placement, so nothing builds it")
                continue
            coli = want["coli"]
            if coli == propslib.COLI_UNRESOLVED:
                bad.append(f"{label}: tail+0x08 lands on no blob of either "
                           f"coli file")
                continue
            if coli is not None:
                meshes += rec.hp == 17
                if coli not in blobs:
                    bad.append(f"{label}: its blob {coli} is not in the "
                               f"stage's coli.blobs")
            for k, v in want.items():
                if not same(pl.get(k), v):
                    bad.append(f"{label}.{k} is {pl.get(k)!r}, the evt says "
                               f"{v!r}")

    print(f"{len(entries)} bundles: {switches} story-mode switches, {meshes} "
          f"of them on the mesh arm, and {windows} windows, held to the evt")
    if not switches or not windows:
        bad.append("no story-mode switch or no window in any stage -- stage "
                   "1 has both")
    elif meshes != switches:
        bad.append(f"{switches - meshes} switches on the sphere arm; every "
                   f"shipped one names a mesh")
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
