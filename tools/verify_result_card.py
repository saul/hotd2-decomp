#!/usr/bin/env python3
"""Check the result card -- the end of a stage -- against the EXE.

`ResultCardInstall` (0x00434EF0), its figures (0x004356A0 / 0x00435760 /
0x004357F0), `ResultCardTally` (0x00435930) and the two number draws are read
in `docs/re/stage-end.md` and ported in `web/src/game/class61/`,
`class62/`, `rescue.ts` and `combat/accuracy.ts`. The port holds two kinds of
number from them -- the routines' immediates, as constants, and their
`.rdata`, through the bundle -- and a wrong one of either is a card that
stands the wrong people, awards the wrong life or never ends.

What this asserts, and what only this can see:

  * **Every constant the port transcribes from the routines is the
    immediate at the instruction that holds it** -- the dwell, the bonus's
    dwell, the count's, the camera frame figure 0 turns on, the cursor it
    freezes on and the window it holds the life up in, the slot it holds,
    the bgm, the idle clips and the first tile -- read out of the instruction
    bytes, not typed in twice.
  * **The `.rdata` spans the card reads with no bound are what the exporter
    writes**: `ExeTables.result_card_tables` is the EXE's bytes, each scene's
    list ends inside the record span, each per-type attachment list ends
    within its three words, and every glyph the strings name is a
    `result.bin` model.
  * **Every type a shipped script can rescue has an attachment list** --
    the `[likely]` in `stage-end.md` section 4: the card indexes
    `g_result_figure_attachments` by the rescued type with no bound, so a
    rescuable civilian outside 0x20..0x37 would read past it. Checked over
    every stage's civilians, through the scripts they run.
  * With a bundle (`HOTD2_BUNDLE` or `extract/player`): its `result_card`
    block is the EXE's, and each stage that places the card carries a
    figure template for every type its list names and every type it can
    rescue, with the clips the card can put that type on baked.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib.exetab import ExeTables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "web/src/game"

SPAN_BASE = 0x0055DD80
SPAN_END = 0x0055E074
LISTS = 0x0055DF50
RECORD = 0x14
ATTACHMENTS = 0x0055DF68
LIFE_BONUS = 0x0055E044
TEMPLATE_BITS = 0x04000000 | 0x02000000


class Failures:
    def __init__(self) -> None:
        self.n = 0
        self.asserted = 0

    def check(self, ok: bool, msg: str, missing: str = "") -> None:
        self.asserted += 1
        if ok:
            return
        self.n += 1
        print(f"  FAIL {msg}" + (f"  (missing {missing})" if missing else ""))


def ts_const(path: Path, name: str) -> int | None:
    """`export const NAME = 0x...;` or `const NAME = 0x...;` in a TS file."""
    m = re.search(rf"\bconst {name}\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*;",
                  path.read_text())
    return int(m.group(1), 0) if m else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    tables = ExeTables(str(args.game_dir / "Hod2.exe"))
    raw = tables.data
    fail = Failures()

    def at(va: int) -> int:
        r = tables._v2r(va)
        assert r is not None, hex(va)
        return r

    def mem(va: int, n: int) -> bytes:
        return raw[at(va):at(va) + n]

    def s16(va: int) -> int:
        return struct.unpack_from("<h", raw, at(va))[0]

    def u32(va: int) -> int:
        return struct.unpack_from("<I", raw, at(va))[0]

    # -- the immediates -------------------------------------------------------
    card = GAME / "class61/index.ts"
    fig = GAME / "class61/figure.ts"
    state = GAME / "class61/state.ts"
    # (file, constant, instruction address, the instruction's bytes up to the
    # immediate, immediate width)
    imms = [
        (card, "RESULT_CARD_FRAMES", 0x00434FDC, "66c7851c010000", 2),
        (card, "RESULT_CARD_BONUS_AT", 0x00435107, "6683bd1c010000", 1),
        (card, "RESULT_CARD_BGM", 0x00434FBA, "68", 4),
        (card, "RESCUED_COUNT_FROM", 0x0043521F, "b9", 4),
        (card, "BONUS_TEXT_FROM", 0x004352A5, "6681bd1c010000", 2),
        (card, "BONUS_DIGIT_FROM", 0x0043533A, "6681bd1c010000", 2),
        (card, "ACCURACY_SHOWN_FROM", 0x00435521, "66833d845c9a00", 1),
        (fig, "RESULT_FIGURE_LIFE_CAM_FRAME", 0x0043578A, "813d10619a00", 4),
        (fig, "RESULT_FIGURE_LIFE_FREEZE_CURSOR", 0x004357B1, "817f08", 4),
        (fig, "RESULT_FIGURE_LIFE_SHOWN_FROM", 0x004358B5, "83f8", 1),
        (fig, "RESULT_FIGURE_LIFE_SHOWN_TO", 0x004358BA, "83f8", 1),
        (fig, "LIFE_FADE", 0x00435796, "6a", 1),
        (state, "RESULT_FIGURE_LIFE_SLOT", 0x004358EF, "68", 4),
        (state, "RESULT_FIGURE_LIFE_MOTION", 0x0043579A, "68", 4),
        (state, "RESULT_FIGURE_IDLE_MOTION_BASE", 0x00435055, "81c2", 4),
        (state, "RESULT_CARD_TILE_FIRST", 0x00435118, "bb", 4),
        (state, "RESCUE_TARGET_CHAR_TYPE", 0x00451B21, "66c70455c08e9c00", 2),
    ]
    for path, name, va, prefix, width in imms:
        want = ts_const(path, name)
        head = bytes.fromhex(prefix)
        code = mem(va, len(head) + width)
        ok_prefix = code[:len(head)] == head
        imm = int.from_bytes(code[len(head):], "little")
        fail.check(want is not None and ok_prefix and imm == want,
                   f"{path.name} {name} = {want} against the immediate at "
                   f"0x{va:08X} ({code.hex()})")

    # -- the .rdata -----------------------------------------------------------
    rc = tables.result_card_tables()
    fail.check(rc["base"] == SPAN_BASE and len(rc["bytes"]) == 2 * (SPAN_END - SPAN_BASE)
               and bytes.fromhex(rc["bytes"]) == mem(SPAN_BASE, SPAN_END - SPAN_BASE),
               "result_card_tables' span is the EXE's bytes")
    lists = [u32(LISTS + i * 4) for i in range(6)]
    fail.check(rc["lists"] == lists, f"the six list pointers: {lists}")
    for sc, lp in enumerate(lists):
        inside = SPAN_BASE <= lp < LISTS
        end = None
        if inside:
            va = lp
            while va + RECORD <= LISTS:
                if s16(va) == -1:
                    end = va
                    break
                va += RECORD
        fail.check(inside and end is not None,
                   f"scene {sc}'s list at 0x{lp:08X} is a record run that ends "
                   f"with type -1 before 0x{LISTS:08X}")
    # Ten records from each list -- `g_rescued_char_types`' ten a scene --
    # are inside the span the bundle carries, so every read the card makes
    # for a scene's first ten rescues is the EXE's bytes in the port too.
    fail.check(all(lp + 10 * RECORD <= SPAN_END for lp in lists),
               "ten records from every list are inside the exported span")
    for ct in range(0x20, 0x38):
        va = ATTACHMENTS + (ct - 0x20) * 6
        words = [s16(va + 2 * i) for i in range(3)]
        fail.check(-1 in words, f"type 0x{ct:02X}'s attachment list ends in "
                                f"its three words: {words}")
    fail.check(ATTACHMENTS + 0x18 * 6 == 0x0055DFF8,
               "the attachment table ends where the first glyph string starts")
    slots = tables.asset_slots()
    for name, va, n in [("rescued", 0x0055DFF8, 9), ("life bonus", 0x0055E00C, 12),
                        ("score", 0x0055E024, 7), ("accuracy", 0x0055E034, 8)]:
        glyphs = [struct.unpack_from("<H", raw, at(va + 2 * i))[0] for i in range(n)]
        bad = [g for g in glyphs if g and slots.get(g, ("", 0))[0] != "result.bin"]
        fail.check(not bad, f"the {name} string's glyphs are result.bin models: {bad}")
    fail.check(slots.get(0x10C3, ("",))[0] == "common.bin",
               "slot 0x10C3, the life figure 0 holds up, is common.bin's")
    bonus = list(mem(LIFE_BONUS, 48))
    fail.check(all(v <= 2 for v in bonus) and bonus[:8] == [0, 0, 0, 0, 0, 1, 1, 1],
               f"g_result_life_bonus: {bonus}")
    fail.check(rc["accuracy_bonus"][:11] == [0, 0, 0, 0, 500, 1000, 1500, 2000,
                                             2500, 3000, 4000]
               and len(rc["accuracy_bonus"]) == (0x005679FC - 0x00567990) // 2,
               f"g_accuracy_bonus_table: {rc['accuracy_bonus'][:11]}")

    # -- every rescuable type has a list ---------------------------------------
    civ = tables.civilian_scripts()
    scripts = civ["scripts"] if isinstance(civ, dict) else civ.scripts

    def rescues(i: int, seen: set[int]) -> bool:
        if i is None or i < 0 or i >= len(scripts) or i in seen:
            return False
        seen.add(i)
        for op in scripts[i]:
            args_ = op.get("args") or []
            if op.get("op") == 0x2C and args_ and args_[0] & 0x10000000:
                return True
        return any(rescues(sub, seen) for op in scripts[i]
                   for sub in (op.get("scripts") or []))

    bundle = os.environ.get("HOTD2_BUNDLE") or str(ROOT / "extract" / "player")
    stage_files = sorted(Path(bundle).glob("stage[0-9]/stage[0-9].script.json")) \
        if Path(bundle).is_dir() else []
    if not stage_files:
        print("  (no bundle: the rescuable types, the exported block and the "
              "figure templates unchecked)")
    rescuable: set[int] = set()
    for sf in stage_files:
        j = json.loads(sf.read_text())
        c = j.get("civilians") or {}
        entries = c.get("entries") or []
        here: set[int] = set()
        for sp in (c.get("spawns") or {}).values():
            e = entries[sp["script"]] if sp["script"] < len(entries) else None
            if e is not None and rescues(e, set()):
                here.add(sp["charType"])
        if any(p.get("class") == 0x21 for p in j["characters"]["placements"]):
            here.add(0x36)
        rescuable |= here
        block = j.get("result_card")
        fail.check(block == json.loads(json.dumps(rc)),
                   f"{sf.name}'s result_card block is the EXE's")
        places = any(any(r.get("class") == 0x61 for r in (o.get("simple") or []))
                     for b in j["blocks"] if not b.get("hole")
                     for s in b["steps"] for o in s["ops"])
        if not places:
            continue
        scene = j["scene"]
        want: list[int] = []
        va = lists[scene]
        while s16(va) != -1:
            want.append(s16(va))
            va += RECORD
        # Rescue `i` stands on record `i`'s clip (`+0x02`), figure 0 may turn
        # to 0x180, and with no rescue the list's own types lie on
        # 0x18B + rand() % 3: every type this stage can rescue needs the
        # first set, every list type both.
        placed = {s16(lists[scene] + i * RECORD + 2) for i in range(len(want))}
        placed.add(0x180)
        idle = {0x18B, 0x18C, 0x18D}
        rows = {p["at"]: p for p in j["characters"]["placements"]}
        types = j["characters"]["types"]
        for t in sorted(set(want) | here):
            row = rows.get(TEMPLATE_BITS | t)
            need = placed | (idle if t in want else set())
            clips = {int(k) for k in types.get(str(t), {}).get("motions", {})}
            fail.check(row is not None and row.get("char_type") == t
                       and need <= clips,
                       f"{sf.name}: the template for type 0x{t:02X} with "
                       + ",".join(f"0x{m:X}" for m in sorted(need)) + " baked",
                       ",".join(f"0x{m:X}" for m in sorted(need - clips)))
    if stage_files:
        fail.check(bool(rescuable) and all(0x20 <= t <= 0x37 for t in rescuable),
                   "every rescuable type is inside g_result_figure_attachments: "
                   + ",".join(f"0x{t:02X}" for t in sorted(rescuable)))

    if fail.n:
        print(f"verify_result_card: {fail.n} of {fail.asserted} failed")
        return 1
    print(f"verify_result_card: {fail.asserted} checks against the EXE hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
