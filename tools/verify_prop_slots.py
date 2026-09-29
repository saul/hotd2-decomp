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
  regardless of the descriptor;
* for the Original Mode collectibles, types 70, 71 and 72, both models of
  every item the placement's row can draw and both pickup strips -- the
  descriptor's word is a lifetime for those, and `PickOriginalModeItem`
  writes the model -- and the same for row 0 of a type 7 or 43, whose drop
  picks from it, and for every story item's row.

A generic type outside that set is *not* checked: its `+0x11C` is a lifetime,
the port knows it, and demanding a model for `slot 4` would be demanding the
exporter carry `eff_3.bin` for every crate in the game.

**That exclusion is this check's blind spot, and it is where the van hid.** The
check reads the same table the exporter does, so a type that *should* be in the
set and is not is invisible to it -- mutate `GENERIC_DESCRIPTOR_SLOT` back to
`[5, 12, 33]` and the rising doors are caught at once while the van is not.
The set is **seven** types by the routines -- 5, 12, 31, 33, 51, 53 and 54 --
and all seven are in it now, so the ten spawns this check was agreeing to miss
are covered. The blind spot itself has not closed: this is still a check on the
exporter's table rather than on the routines, and `tools/verify_prop_pose.py`
is the one that reads the fifty routines out of the EXE.

**Two of the seven draw a strip, not a slot.** `PropDrawOnlyType31`
(`FUN_0046A1C0`) and `PropDrawOnlyType33` (`FUN_00472950`) pass
`obj+0x28C + obj+0x2A0` and step that cursor a frame at a time, with the strip
length in the descriptor's third orientation word, so every frame of the strip
is a slot a placed prop will really ask for and every one of them is checked
here. Carrying only the base would have been the van's bug one frame deep.

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


def _int_list(name: str) -> set[int]:
    """One `export const <name> = [...]` in the exporter, read and not copied."""
    text = BUNDLE_TS.read_text(encoding="utf-8")
    m = re.search(name + r"\s*=\s*\[([^\]]*)\]", text)
    if not m:
        raise SystemExit(f"{BUNDLE_TS}: {name} not found")
    return {int(x, 0) for x in m.group(1).replace("\n", " ").split(",") if x.strip()}


def descriptor_slot_types() -> set[int]:
    """`GENERIC_DESCRIPTOR_SLOT`, read out of the exporter."""
    return _int_list("GENERIC_DESCRIPTOR_SLOT")


def strip_types() -> set[int]:
    """`GENERIC_SLOT_STRIP`, read out of the exporter."""
    return _int_list("GENERIC_SLOT_STRIP")


def _int_const(name: str) -> int:
    """One `export const <name> = <int>;` in the exporter."""
    text = BUNDLE_TS.read_text(encoding="utf-8")
    m = re.search(r"export const " + name + r"\s*=\s*(0x[0-9a-fA-F]+|\d+);",
                  text)
    if not m:
        raise SystemExit(f"{BUNDLE_TS}: {name} not found")
    return int(m.group(1), 0)


def original_item_slots(breakables: dict, pl: dict,
                        who: str | None = None) -> list[tuple[int, str]]:
    """Every model a type-70, 71 or 72 placement can draw.

    `PickOriginalModeItem` (`FUN_004629C0`) writes the chosen item's model over
    `obj+0x28C`, so what the prop asks for is not the descriptor's word but
    both models of every id its row can draw -- read out of the bundle's own
    `original_items`, which is what the port picks from -- and the two pickup
    strips `obj+0x2A4 - 1 + obj+0x2A0` walks when it is taken. A row or a
    record the bundle does not carry is reported as slot -1: an item the port
    cannot pick is a gap in its own right.
    """
    orig = breakables.get("original_items") or {}
    row = (orig.get("rows") or {}).get(str(pl.get("field_1f4") or 0))
    out: list[tuple[int, str]] = []
    if row is None:
        out.append((-1, f"{who or 'type ' + str(pl.get('type'))}'s item "
                        f"row {pl.get('field_1f4')}"))
        return out
    recs = orig.get("records") or {}
    for item in row["ids"]:
        if item < 0:
            continue
        rec = recs.get(str(item))
        if rec is None:
            out.append((-1, f"item {item}'s record"))
            continue
        for key in ("slot", "slot2"):
            if rec[key] not in (0, 0xFFFF):
                out.append((rec[key], f"item {item}'s {key}"))
    frames = _int_const("ORIGINAL_ITEM_PICKUP_FRAMES")
    for base in sorted(_int_list("ORIGINAL_ITEM_PICKUP_STRIPS")):
        out += [(base + i, f"frame {i} of the pickup strip at 0x{base:04x}")
                for i in range(frames)]
    return out


def story_item_rows() -> dict[int, int]:
    """`STORY_ITEM_ROW_BY_TYPE`, read out of the exporter: the rows types 74
    and 75 hand `SpawnStoryModeItem` from an immediate of their own."""
    text = BUNDLE_TS.read_text(encoding="utf-8")
    m = re.search(r"STORY_ITEM_ROW_BY_TYPE[^{]*\{([^}]*)\}", text)
    if not m:
        raise SystemExit(f"{BUNDLE_TS}: STORY_ITEM_ROW_BY_TYPE not found")
    return {int(k): int(v, 0) for k, v in
            re.findall(r"(\d+)\s*:\s*(0x[0-9a-fA-F]+|\d+)", m.group(1))}


def story_item_slots(breakables: dict, pl: dict) -> list[tuple[int, str]]:
    """What a group member's or a falling container's story item can draw.

    In Original Mode its destroy path hands `SpawnStoryModeItem`
    (`FUN_00467B90`) its `+0x2A0`, and that makes a collectible out of the
    row it names. Only a row the bundle carries is asked about here; a
    member naming a row the bundle does not carry is reported like a
    collectible's.
    """
    rows = []
    if pl.get("container") == "falling":
        rows.append(pl.get("story_item", -1))
    else:
        groups = breakables.get("groups") or []
        g = pl.get("group")
        if isinstance(g, int) and 0 <= g < len(groups):
            rows += [m.get("story_item", -1) for m in groups[g]]
    out: list[tuple[int, str]] = []
    for row in rows:
        if row is None or row < 0:
            continue
        out += original_item_slots(breakables, {"field_1f4": row},
                                   "a story item")
    return out
#: One generated run, `Array.from({ length: N }, (_, i) => 0xBASE + i)`.
_RUN = re.compile(r"Array\.from\(\{\s*length:\s*(\d+)\s*\}[^)]*\)\s*=>\s*"
                  r"(0x[0-9a-fA-F]+|\d+)\s*\+\s*i\s*\)")


def _run(text: str) -> list[int] | None:
    m = _RUN.fullmatch(text.strip())
    if not m:
        return None
    base = int(m.group(2), 0)
    return [base + i for i in range(int(m.group(1)))]


def static_slots() -> dict[int, list[int]]:
    """`GENERIC_STATIC_SLOTS`, read out of the exporter.

    A row is a list of literals, a generated run (``Array.from``), or a list
    that spreads runs among its literals; every run is expanded rather than
    skipped, because a routine that steps through ten slots needs all ten.
    An element this cannot read fails the check rather than being dropped: a
    row read short is a slot nobody checks.
    """
    text = BUNDLE_TS.read_text(encoding="utf-8")
    m = re.search(r"GENERIC_STATIC_SLOTS[^{]*\{(.*?)\n\};", text, re.S)
    if not m:
        raise SystemExit(f"{BUNDLE_TS}: GENERIC_STATIC_SLOTS not found")
    body = "\n".join(line.split("//")[0] for line in m.group(1).splitlines())
    out: dict[int, list[int]] = {}
    for e in re.finditer(r"(\d+):\s*(\[[^\]]*\]|Array\.from\([^\n]*?=>[^,\n]*\+\s*i\s*\))",
                         body):
        key, row = int(e.group(1)), e.group(2).strip()
        run = _run(row)
        if run is not None:
            out[key] = run
            continue
        slots: list[int] = []
        depth, cur, parts = 0, "", []
        for ch in row[1:-1]:
            depth += ch in "({"
            depth -= ch in ")}"
            if ch == "," and depth == 0:
                parts.append(cur)
                cur = ""
            else:
                cur += ch
        parts.append(cur)
        for part in (x.strip() for x in parts):
            if not part:
                continue
            if part.startswith("..."):
                spread = _run(part[3:])
                if spread is None:
                    raise SystemExit(f"{BUNDLE_TS}: GENERIC_STATIC_SLOTS[{key}]"
                                     f" spreads something unreadable: {part}")
                slots += spread
            else:
                slots.append(int(part, 0))
        out[key] = slots
    return out


TYPE40_TS = ROOT / "web" / "src" / "game" / "class41" / "type40.ts"
TABLE_TS = {
    "table38": ROOT / "web" / "src" / "game" / "class41" / "type38.ts",
    "table39": ROOT / "web" / "src" / "game" / "class41" / "type38.ts",
    "table44": ROOT / "web" / "src" / "game" / "class41" / "type44.ts",
}


def _ts_const(path: Path, name: str) -> int:
    """One `export const NAME = 0x...;` out of a game module."""
    m = re.search(r"export const " + name + r"\s*=\s*(0x[0-9a-fA-F]+|\d+);",
                  path.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"{path}: {name} not found")
    return int(m.group(1), 0)


def fragment_slots(sub_kind: int) -> list[tuple[int, str]]:
    """Every slot `PropUpdateType40` can draw for one sub-kind, out of the
    port's own tables in `game/class41/type40.ts`: the starting slot, the one
    a hit swaps to, sub-kind 9's second model, and the forty burst pieces."""
    text = TYPE40_TS.read_text(encoding="utf-8")
    m = re.search(r"export const FRAGMENT_SLOTS = \[([^\]]*)\]", text)
    if not m:
        raise SystemExit(f"{TYPE40_TS}: FRAGMENT_SLOTS not found")
    table = [int(x, 0) for x in m.group(1).replace("\n", " ").split(",")
             if x.strip()]
    out: list[tuple[int, str]] = []
    if sub_kind == 0:
        base = [_ts_const(TYPE40_TS, "FRAGMENT_SUBKIND0_SLOT"),
                _ts_const(TYPE40_TS, "FRAGMENT_SUBKIND0_SLOT_HIT")]
    elif sub_kind == 1:
        base = [_ts_const(TYPE40_TS, "FRAGMENT_SUBKIND1_SLOT"),
                _ts_const(TYPE40_TS, "FRAGMENT_SUBKIND1_SLOT_TAKEN")]
    else:
        b = table[sub_kind] if sub_kind < len(table) else 0
        base = [b, b + 1] if b else []
        if b and sub_kind == 9:
            extra = _ts_const(TYPE40_TS, "FRAGMENT_SUBKIND9_EXTRA_SLOT")
            base += [b + extra, b + 1 + extra]
    out += [(x, f"type 40 sub-kind {sub_kind}'s own model") for x in base]
    first = _ts_const(TYPE40_TS, "FRAGMENT_BURST_SLOT")
    n = _ts_const(TYPE40_TS, "FRAGMENT_BURST_PIECES")
    out += [(first + i, "a type 40 burst piece") for i in range(n)]
    return out


def row_table_slots(kind: str, index: int) -> list[tuple[int, str]]:
    """The slots constructor 50's or 66's objects draw, out of the port's own
    literal rows in `game/class41/type50.ts` / `type66.ts` -- the first word
    of every row of the table the placement's `+0x1F4` picks, the way
    `PlaceTable50Props` and `PlaceTable66Props` pick it."""
    sys.path.insert(0, str(ROOT / "tools"))
    from verify_prop_tables import ts_literal  # noqa: E402
    game = ROOT / "web" / "src" / "game" / "class41"
    if kind == "table50":
        tables = ts_literal(game / "type50.ts", "PROP_TABLE50")
        rows = tables[index] if 0 <= index < len(tables) else []
    else:
        rows = ts_literal(game / "type66.ts",
                          "PROP_TABLE66_B" if index > 0 else "PROP_TABLE66_A")
    return [(row[0] & 0xFFFF, f"{kind} table {index} row {i}'s model")
            for i, row in enumerate(rows)]


def table_slots(kind: str) -> list[tuple[int, str]]:
    """The literals the three table constructors' routines draw."""
    names = {
        "table38": ["TYPE38_SLOT", "TYPE38_SLOT_HIT"],
        "table39": ["TYPE38_SLOT"],
        "table44": ["TYPE44_WHOLE_SLOT", "TYPE44_SHADOW_SLOT"],
    }[kind]
    return [(_ts_const(TABLE_TS[kind], n), f"{kind}'s {n}") for n in names]


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
    strips = strip_types()
    literals = static_slots()
    print(f"descriptor-slot types: {sorted(want_types)}  "
          f"(strips: {sorted(strips)})")
    print(f"literal draw lists: {len(literals)} types, "
          f"{sum(len(v) for v in literals.values())} slots")

    bad: list[str] = []
    checked = 0
    items = 0
    doors = 0
    bodies = 0
    frames = 0
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
        breakables = json.loads(script.read_text()).get("breakables", {})
        placements = breakables.get("placements", [])
        collectible_types = _int_list("ORIGINAL_ITEM_TYPES")
        row_zero_types = _int_list("ORIGINAL_ITEM_ROW_ZERO_TYPES")
        story_rows = story_item_rows()

        for pl in placements:
            kind = pl.get("container")
            want: list[tuple[int, str]] = []
            if kind == "flicker_light":
                # Class 0x41 type 48: the whole, broken and debris models
                # PropUpdateType48FlickerLight draws, carried on the placement.
                for slot in pl.get("slots") or []:
                    want.append((slot, "a model PropUpdateType48FlickerLight draws"))
            if kind == "rising_door":
                slot = pl.get("slot") or 0
                if slot:
                    want.append((slot, "the model RisingDoorUpdate draws"))
                    doors += 1
            elif kind == "generic":
                ty = pl.get("type")
                if ty in want_types:
                    slot = pl.get("slot") or 0
                    # A strip type draws `slot .. slot + roll` inclusive, one
                    # frame a tick; every frame is a slot it will really ask
                    # for. See `GENERIC_SLOT_STRIP`.
                    span = max(0, pl.get("roll") or 0) if ty in strips else 0
                    if slot:
                        for i in range(span + 1):
                            why = f"type {ty}'s descriptor slot"
                            if span:
                                why += f" + {i} of its {span + 1}-frame strip"
                            want.append((slot + i, why))
                        bodies += 1
                        frames += span
                for lit in literals.get(ty, []):
                    want.append((lit, f"a literal type {ty} draws"))
                if ty in collectible_types:
                    want += original_item_slots(breakables, pl)
                    items += 1
                if ty in row_zero_types:
                    # Type 7's drop and type 43's break pick from row 0.
                    want += original_item_slots(
                        breakables, {"field_1f4": 0}, f"type {ty}'s drop")
                if ty in story_rows:
                    want += original_item_slots(
                        breakables, {"field_1f4": story_rows[ty]},
                        f"type {ty}'s story item")
            elif kind == "fragment":
                want += fragment_slots(pl.get("sub_kind") or 0)
            elif kind in TABLE_TS:
                want += table_slots(kind)
            elif kind in ("table50", "table66"):
                want += row_table_slots(kind, pl.get("field_1f4") or 0)
            if kind in ("group", "falling"):
                want += story_item_slots(breakables, pl)
            for slot, why in want:
                checked += 1
                if slot < 0:
                    bad.append(f"{name}: prop at {pl.get('at')} ({kind}) "
                               f"needs {why}, and the bundle does not carry it")
                    continue
                if slot not in have:
                    bad.append(
                        f"{name}: prop at {pl.get('at')} ({kind}) names slot "
                        f"0x{slot:04x} -- {why} -- and the glTF has no "
                        f"`_slot_{slot:04x}` node, so it draws nothing")

    if not stages:
        print("SKIP  verify_prop_slots: the manifest names no stages")
        return 3

    print(f"{stages} bundles: {checked} prop draw slots checked "
          f"({doors} rising doors, {bodies} descriptor-slot props, "
          f"{frames} extra strip frames, {items} Original Mode collectibles)")
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
