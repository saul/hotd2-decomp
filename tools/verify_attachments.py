#!/usr/bin/env python3
"""Every attachment a spawn wears is in the bundle, and it is a real model.

An actor's **attachment list** is what puts a face on a civilian and hair on
top of it. `CivilianInit` (`FUN_0048A3E0`), `ScriptedHumanoidInit`
(`FUN_004840D0`) and `SetPiecePropInit` (`FUN_00482CE0`) each park a pointer
from their descriptor tail at `model+0x1170` and call `ActorBindPartList`
(`FUN_00412440`); `ActorDrawAttachedParts` (`FUN_004124F0`) draws it after
every skeleton node. The ids index `g_actor_attachment_table` (`0x004EC748`),
81 records of `{s32 bone; s32 asset_slot}`.

**This compares the export against the files it was made from**, which is the
only direction that can catch the failure it was written for. The port drew
civilians for months with no hair at all, because the exporter carried neither
the records nor the per-spawn lists and nothing in the tree could notice: a
civilian's *own* head model is a shell open at the back, so it rendered as a
face on a neck and every count in every check was right.

Four assertions, and each is a different way it can go wrong:

1. the bundle's record table is the exe's, row for row -- a table read at the
   wrong stride yields plausible small integers, not an error;
2. every spawn the evt gives a list to has that list in the bundle, and the
   same ids -- an exporter that reads the wrong tail offset for a class
   silently produces a shorter list, not a wrong one;
3. every accessory id a spawn names resolves to a model **that is in the
   glTF**, under the `gore_<slot>` name the client clones by. This is the one
   that fails when the models are left behind;
4. every id below the replace threshold resolves the same way, because a face
   swap with nothing to swap in leaves the default head.

    python3 tools/verify_attachments.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import evt as evtlib  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402
from hod2lib.placement import (ATTACHMENT_TAIL_OFFSET,  # noqa: E402
                               attachment_list)

#: Stage number -> the evt the exporter builds it from. Only the six stages
#: reach a bundle; the cutscene evts have no stage of their own.
EVT_OF_STAGE = {1: "st1evtbl.bin", 2: "st2evtbl.bin", 3: "st3evtbl.bin",
                4: "st4evtbl.bin", 5: "st5evtbl.bin", 6: "st6evtbl.bin"}


def glb_json(path: Path) -> dict:
    b = path.read_bytes()
    off = 12
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        if ty == 0x4E4F534A:
            return json.loads(b[off + 8:off + 8 + ln])
        off += 8 + ln
    raise SystemExit(f"{path}: no JSON chunk")


def cloneable_slots(gltf: dict) -> set[int]:
    """The asset slots the client can clone a model from.

    `CharacterLayer` harvests `gore_<slot>` nodes out of the hidden per-type
    templates and clones by slot; a slot with no such node draws nothing.
    """
    out: set[int] = set()
    for n in gltf.get("nodes", []):
        name = n.get("name") or ""
        i = name.rfind("_gore_")
        if i < 0:
            continue
        tail = name[i + 6:]
        if len(tail) == 4:
            try:
                out.add(int(tail, 16))
            except ValueError:
                pass
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    # `HOTD2_BUNDLE` is the same variable the dev server and the headless
    # suites read, so all of them look at one export.
    ap.add_argument("--bundle", type=Path,
                    default=Path(os.environ.get("HOTD2_BUNDLE")
                                 or ROOT / "extract" / "player"))
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    exe = next((p for p in game.iterdir() if p.suffix.lower() == ".exe"), None)
    if exe is None:
        raise SystemExit(f"no .exe under {game}")
    tables = ExeTables(exe)
    records = tables.attachment_records()
    split = tables.ATTACHMENT_REPLACES_BELOW

    manifest = args.bundle / "manifest.json"
    if not manifest.exists():
        print(f"SKIP  verify_attachments: no bundle at {args.bundle}")
        print("      build one with `cd web && npm run export -- "
              "--game-dir ...`")
        return 3

    bad: list[str] = []
    print(f"{len(records)} attachment records, "
          f"ids below 0x{split:02X} replace a bone's model")

    lists = 0
    ids_checked = 0
    stages = 0
    for entry in json.loads(manifest.read_text())["stages"]:
        stem = EVT_OF_STAGE.get(entry["stage"])
        if stem is None:
            continue
        name = entry["name"]
        script = args.bundle / name / entry["script"]
        glb = args.bundle / name / entry["geometry"]
        if not script.exists() or not glb.exists():
            bad.append(f"{name}: the manifest names files that are not there")
            continue
        stages += 1
        chars = json.loads(script.read_text())["characters"]

        # 1. the record table, row for row.
        got = chars.get("attachments")
        if got is None:
            bad.append(f"{name}: the bundle carries no attachment records")
            continue
        if len(got) != len(records):
            bad.append(f"{name}: {len(got)} records, {len(records)} in the exe")
        else:
            for i, (a, b) in enumerate(zip(got, records)):
                if a["bone"] != b["bone"] or a["slot"] != b["slot"]:
                    bad.append(
                        f"{name}: record 0x{i:02X} is "
                        f"{{bone {a['bone']}, slot 0x{a['slot']:04X}}}, "
                        f"the exe says {{bone {b['bone']}, "
                        f"slot 0x{b['slot']:04X}}}")
        if chars.get("attachment_replaces_below") != split:
            bad.append(f"{name}: the bundle's replace threshold is "
                       f"{chars.get('attachment_replaces_below')}, "
                       f"the exe's is {split}")

        # 2. the per-spawn lists, against the evt the stage was built from.
        e = evtlib.load(str(game / "evt" / stem))
        want = {}
        for sp in evtlib.spawns(e):
            if sp.cls not in ATTACHMENT_TAIL_OFFSET:
                continue
            ids = attachment_list(e, sp, sp.cls, len(records))
            if ids:
                want[sp.offset] = ids
        have = {p["at"]: p.get("attachments", []) or []
                for p in chars["placements"]}
        for at, ids in sorted(want.items()):
            lists += 1
            if at not in have:
                # A spawn the walker never reaches has no placement, which is
                # not this check's business.
                continue
            if have[at] != ids:
                bad.append(f"{name}: spawn {at:#x} wears {have[at]} in the "
                           f"bundle, {ids} in {stem}")

        # 3 and 4. every id a spawn names has a model the client can clone.
        clones = cloneable_slots(glb_json(glb))
        for at, ids in sorted(want.items()):
            if at not in have:
                continue
            for i in ids:
                rec = records[i]
                if rec["bone"] < 0 or not rec["slot"]:
                    bad.append(f"{name}: spawn {at:#x} names record "
                               f"0x{i:02X}, which resolves to nothing")
                    continue
                ids_checked += 1
                if rec["slot"] not in clones:
                    kind = "face" if i < split else "accessory"
                    bad.append(
                        f"{name}: spawn {at:#x}'s {kind} (record 0x{i:02X}, "
                        f"slot 0x{rec['slot']:04X}) has no model in the glTF "
                        f"-- the client has nothing to clone")

    print(f"{stages} stage bundles, {lists} spawn lists, "
          f"{ids_checked} attachment ids resolved to a model in the glTF")
    if bad:
        print()
        for line in bad[:40]:
            print(f"  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        print(f"\nFAIL {len(bad)} problem(s)")
        return 1
    if not stages:
        print("SKIP  verify_attachments: no stage bundle to compare")
        return 3
    print("\nOK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
