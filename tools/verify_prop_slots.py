#!/usr/bin/env python3
"""Every model a placed prop will ask for is in the bundle it was placed from.

A prop the script places and the port builds draws through `AssetDrawSlot`, and
`render/breakables.ts` answers that by cloning a hidden `slots_breakable_*`
node out of the stage's glTF. **A prop whose slot has no such node is placed,
updated, shot-tested and invisible** -- and from the level that is
indistinguishable from a placement the exporter never emitted, which is how
two of these survived for as long as they did:

* **stage 3's roller shutter.** Class 0x44 selector 11 was in no table
  anywhere: not `containerPlacements`, not the `props` block, not
  `g_class44_subtypes`. Reported as "there is no shutter there at all", and
  the report's own next line ruled out the placement path because stage 3 has
  no hinges and no statics -- correctly, and for the wrong family.
* **stage 5's van.** Its two rear doors are a class-0x44 hinge pair and drew
  fine; the **body** is a class-0x41 type-51 placement at the same position
  and yaw, which the port built all along. Type 51 was missing from
  `GENERIC_DESCRIPTOR_SLOT`, the one list that decides which descriptor slots'
  geometry travels, so `DrawSlotFor` asked for `0x1793` every frame and the
  renderer had nothing to clone. Four vans, and every one of them a pair of
  doors in mid-air.

Same shape as `verify_attachments.py`, which was written for the identical
failure on characters -- a table in the exe names an asset slot, the hidden rig
did not carry it, and the client's clone answered null.

**What is asserted, and what is not.** Only the slots the port will *really*
ask for:

* every `rising_door` placement's `slot`;
* every `generic` placement whose type is in `GENERIC_DESCRIPTOR_SLOT`, for
  which the descriptor's `+0x11C` is the asset slot rather than a lifetime;
* every literal in `GENERIC_STATIC_SLOTS`, which is what those routines draw
  regardless of the descriptor.

A generic type outside that set is *not* checked: its `+0x11C` is a lifetime,
the port knows it, and demanding a model for `slot 4` would be demanding the
exporter carry `eff_3.bin` for every crate in the game.

**That exclusion is this check's blind spot, and it is where the van hid.** The
check reads the same table the exporter does, so a type that *should* be in the
set and is not is invisible to it -- mutate `GENERIC_DESCRIPTOR_SLOT` back to
`[5, 12, 33]` and the rising doors are caught at once while the van is not. So
the blind spot is written down rather than left implicit: the set is **seven**
types by the routines -- 5, 12, 31, 33, 51, 53 and 54, every one of them read
and annotated -- and three of those are deliberately still out, which is ten
shipped spawns of scenery this check is currently agreeing to miss. See
`GENERIC_DESCRIPTOR_SLOT` in `web/src/game/class41/generic.ts`. Closing it is
adding a type with its retirement rule read; loosening this check is not.

    python3 tools/verify_prop_slots.py
    HOTD2_BUNDLE=/path/to/export python3 tools/verify_prop_slots.py
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

#: `web/src/hod2lib/bundle.ts` is the only writer of a bundle, so the two
#: tables are read out of it rather than copied here. A copy would be a second
#: source for a fact the exporter already states, and it would rot -- which is
#: exactly the failure this file is about, one level up.
BUNDLE_TS = ROOT / "web" / "src" / "hod2lib" / "bundle.ts"


def glb_json(path: Path) -> dict:
    b = path.read_bytes()
    off = 12
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        if ty == 0x4E4F534A:            # 'JSON'
            return json.loads(b[off + 8:off + 8 + ln])
        off += 8 + ln
    raise SystemExit(f"{path}: no JSON chunk")


def breakable_slots(gltf: dict) -> set[int]:
    """The asset slots `render/breakables.ts` can clone a model from.

    `BreakableLayer` harvests the `slots_breakable_*_slot_<hex>` nodes out of
    the hidden template rig and clones by slot; a slot with no such node draws
    nothing at all.
    """
    out: set[int] = set()
    for n in gltf.get("nodes", []):
        m = re.search(r"_slot_([0-9a-f]{4})$", n.get("name") or "")
        if m:
            out.add(int(m.group(1), 16))
    return out


def descriptor_slot_types() -> set[int]:
    """`GENERIC_DESCRIPTOR_SLOT`, read out of the exporter."""
    text = BUNDLE_TS.read_text(encoding="utf-8")
    m = re.search(r"GENERIC_DESCRIPTOR_SLOT\s*=\s*\[([^\]]*)\]", text)
    if not m:
        raise SystemExit(f"{BUNDLE_TS}: GENERIC_DESCRIPTOR_SLOT not found")
    return {int(x, 0) for x in m.group(1).replace("\n", " ").split(",") if x.strip()}


def static_slots() -> dict[int, list[int]]:
    """`GENERIC_STATIC_SLOTS`, read out of the exporter.

    The generated row -- type 21's ``Array.from`` -- is expanded here rather
    than skipped: a routine that steps through ten slots needs all ten.
    """
    text = BUNDLE_TS.read_text(encoding="utf-8")
    m = re.search(r"GENERIC_STATIC_SLOTS[^{]*\{(.*?)\n\};", text, re.S)
    if not m:
        raise SystemExit(f"{BUNDLE_TS}: GENERIC_STATIC_SLOTS not found")
    out: dict[int, list[int]] = {}
    for line in m.group(1).splitlines():
        line = line.split("//")[0].strip()
        e = re.match(r"(\d+):\s*(.*?),?$", line)
        if not e:
            continue
        key, body = int(e.group(1)), e.group(2)
        gen = re.match(r"Array\.from\(\{\s*length:\s*(\d+)\s*\}[^)]*\)\s*=>\s*"
                       r"(0x[0-9a-fA-F]+)\s*\+\s*i\s*\)", body)
        if gen:
            base = int(gen.group(2), 16)
            out[key] = [base + i for i in range(int(gen.group(1)))]
            continue
        b = re.match(r"\[(.*)\]$", body)
        if b:
            out[key] = [int(x, 0) for x in b.group(1).split(",") if x.strip()]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    # Accepted and unused: the suite passes it to every tools/verify_*.
    ap.add_argument("--game-dir", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--bundle", type=Path,
                    default=Path(os.environ.get("HOTD2_BUNDLE")
                                 or ROOT / "extract" / "player"))
    args = ap.parse_args()

    manifest = args.bundle / "manifest.json"
    if not manifest.exists():
        print(f"SKIP  verify_prop_slots: no bundle at {args.bundle}")
        print("      build one with `cd web && npm run export -- "
              "--game-dir ...`")
        return 3

    want_types = descriptor_slot_types()
    literals = static_slots()
    print(f"descriptor-slot types: {sorted(want_types)}")
    print(f"literal draw lists: {len(literals)} types, "
          f"{sum(len(v) for v in literals.values())} slots")

    bad: list[str] = []
    checked = 0
    doors = 0
    bodies = 0
    stages = 0
    for entry in json.loads(manifest.read_text())["stages"]:
        name = entry["name"]
        script = args.bundle / name / entry["script"]
        glb = args.bundle / name / entry["geometry"]
        if not script.exists() or not glb.exists():
            bad.append(f"{name}: the manifest names files that are not there")
            continue
        stages += 1
        have = breakable_slots(glb_json(glb))
        placements = (json.loads(script.read_text())
                      .get("breakables", {}).get("placements", []))

        for pl in placements:
            kind = pl.get("container")
            want: list[tuple[int, str]] = []
            if kind == "rising_door":
                slot = pl.get("slot") or 0
                if slot:
                    want.append((slot, "the model RisingDoorUpdate draws"))
                    doors += 1
            elif kind == "generic":
                ty = pl.get("type")
                if ty in want_types:
                    slot = pl.get("slot") or 0
                    if slot:
                        want.append((slot, f"type {ty}'s descriptor slot"))
                        bodies += 1
                for lit in literals.get(ty, []):
                    want.append((lit, f"a literal type {ty} draws"))
            for slot, why in want:
                checked += 1
                if slot not in have:
                    bad.append(
                        f"{name}: prop at {pl.get('at')} ({kind}) names slot "
                        f"0x{slot:04x} -- {why} -- and the glTF has no "
                        f"`_slot_{slot:04x}` node, so it draws nothing")

    if not stages:
        print("SKIP  verify_prop_slots: the manifest names no stages")
        return 3

    print(f"{stages} bundles: {checked} prop draw slots, all resolved "
          f"({doors} rising doors, {bodies} descriptor-slot props)")
    if bad:
        for line in bad[:40]:
            print(f"  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        print(f"\nFAIL {len(bad)} placed props have no model in their bundle")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
