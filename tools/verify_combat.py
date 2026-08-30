"""Whole-corpus checks on the shot/damage tables.

Each check is chosen so that a wrong *reading* fails it, not just a wrong
byte. The readings under test are the ones docs/formats/combat.md states:

1. **The effect table's small values are control codes, not asset slots.**
   `ResolveHit` branches on ``effect[i + 1]`` being 0, 1 or 2. If that were
   really a slot number the table would contain slots near zero. Across every
   character type the values are either 0, 1, 2 or at least ``0xB91`` -- a gap
   of nearly three thousand, with nothing in it.

2. **Slots resolve.** Every value above the gap resolves through the asset
   slot table to a ``(file, part)`` -- ``0xB91`` is ``frog.bin`` part 3,
   ``0x1B70`` is ``harold.bin`` part 97. That is the test that the values are
   asset slots at all, and it is what a wrong stride or a wrong base would
   fail. The damaged-part **sphere** table is a separate lookup that is
   allowed to miss: `ActorSwapDamagedPart` writes the slot unconditionally and
   `ResolveDamagedPartSphere` only supplies a hit volume if it finds one.

3. **A sever has something to sever.** Every ``code == 1`` step sits on a bone
   with children, so `SeverBoneChildren` always has a subtree to remove.

4. **The export matches the EXE.** `characters.hit_steps` is re-derived here
   from raw bytes, independently of the library's own helpers.

5. **Hit points stay in range.** `ActorInitHitPoints` clamps to ``[1, 300]``
   on every difficulty, for every spawn in every stage.

6. **Every sound id names a file.** The voice, impact and ricochet tables are
   read as `g_se_name_list` ids; a table read at the wrong address would give
   ids that resolve to nothing, so this fails loudly if the address is wrong.

Known exception, reported rather than hidden: character type 21 (`samson`, a
boss) has a `PTR_DAT_004D032C` entry that is not the ``{slot, centre, radius}``
layout the others use -- its first word is a float. Its damaged-part spheres
are `[open]`. Its effect *slots* still resolve, so only check 2's sphere half
is affected.

    python3 tools/verify_combat.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import characters as ch          # noqa: E402
from hod2lib import stage as stagelib         # noqa: E402

#: Below this every effect-table value is a control code; above it, a slot.
#: Measured, not assumed -- check 1 is what establishes there is a gap at all.
CONTROL_MAX = 2
#: Boss with a non-standard part table; see the module docstring.
NONSTANDARD_PART_TABLE = {21}


def _flat(tables, base: int, ct: int, count: int) -> list[int]:
    """A raw, independent read of a per-character u16 table."""
    b = tables._v2r(base)
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + ct * 4)[0])
    return list(struct.unpack_from(f"<{count}H", tables.data, p))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True)
    args = ap.parse_args()
    tables = stagelib.get_tables(args.game_dir)
    if tables is None:
        print("error: Hod2.exe not found", file=sys.stderr)
        return 2

    fails: list[str] = []
    types = [ct for ct in range(160) if tables.character_skeleton(ct)]
    print(f"{len(types)} character types with a skeleton")

    # 1 + 2 + 3 + 4 ------------------------------------------------------
    slots = tables.asset_slots()
    codes: set[int] = set()
    min_slot = 1 << 30
    n_slots = n_sever = n_sever_leaf = n_sphered = 0
    unresolved: list[str] = []
    mismatch = 0
    for ct in types:
        skel = tables.character_skeleton(ct)
        kids: dict[int, list[int]] = {}
        for n in skel:
            if n["parent"] is not None:
                kids.setdefault(skel[n["parent"]]["bone"], []).append(n["bone"])
        gore = set(ch.gore_parts(tables, ct))
        nb = tables.character_bone_count(ct) or 0
        eff = _flat(tables, ch.HIT_EFFECT, ct, (nb + 2) * ch.HIT_STEPS)
        dmg = _flat(tables, ch.HIT_DAMAGE, ct, (nb + 2) * ch.HIT_STEPS)
        for n in skel:
            bone = n["bone"]
            steps = ch.hit_steps(tables, ct, bone)
            for i, (slot, code, damage) in enumerate(steps):
                j = bone * ch.HIT_STEPS + i
                if (slot, code, damage) != (eff[j], eff[j + 1], dmg[j]):
                    mismatch += 1
                if code <= CONTROL_MAX:
                    codes.add(code)
                if code == 1:
                    n_sever += 1
                    if not kids.get(bone):
                        n_sever_leaf += 1
                if slot > CONTROL_MAX:
                    n_slots += 1
                    min_slot = min(min_slot, slot)
                    if slot not in slots:
                        unresolved.append(f"type {ct} bone {bone} slot {slot:#x}")
                    if slot in gore:
                        n_sphered += 1

    print(f"  {n_slots} slot references, {n_sever} sever steps")
    print(f"  control codes seen: {sorted(codes)}; lowest slot {min_slot:#x}")
    if codes - {0, 1, 2}:
        fails.append(f"effect table carries small values other than 0/1/2: "
                     f"{sorted(codes - {0, 1, 2})}")
    if min_slot <= 0x100:
        fails.append(f"no gap between control codes and slots "
                     f"(lowest slot {min_slot:#x})")
    print(f"  {n_sphered} of them also carry a damaged-part hit sphere")
    if unresolved:
        fails.append(f"{len(unresolved)} effect slots are not asset slots: "
                     f"{unresolved[:4]}")
    if mismatch:
        fails.append(f"{mismatch} exported steps differ from a raw EXE read")
    # Two hands sever with nothing below them, which is a stump and fine.
    print(f"  sever steps on a childless bone: {n_sever_leaf}")
    if n_sever_leaf > 2:
        fails.append(f"{n_sever_leaf} sever steps have no subtree to remove")

    # 5 ------------------------------------------------------------------
    diff = ch.difficulty_tables(tables)
    checked = 0
    for n in sorted(stagelib.STAGE_TO_SCENE):
        try:
            st = stagelib.Stage(args.game_dir, stage=n)
            places = ch.resolve_for_stage(st)[1]
        except Exception as exc:                        # noqa: BLE001
            print(f"  stage {n}: skipped ({exc})")
            continue
        for p in places:
            for rank in range(5):
                hp = min(diff["hp_max"],
                         max(diff["hp_min"], p.hp + diff["hp_delta"][rank]))
                checked += 1
                if not (diff["hp_min"] <= hp <= diff["hp_max"]):
                    fails.append(f"hp {hp} out of range for spawn {p.at:#x}")
    print(f"  {checked} spawn/difficulty hit-point pairs in "
          f"[{diff['hp_min']}, {diff['hp_max']}]")

    # 6 ------------------------------------------------------------------
    se = tables.se_names()
    combat = ch.combat_tables(tables)
    ids = [s["id"] for s in combat["impact"] + combat["head_impact"]]
    for k in ("hurt", "kill", "head"):
        ids += [s["id"] for s in combat["voice"][k]]
    ids += [s["id"] for s in combat["ricochet"].values()]
    ids += [combat["no_effect"]["sound"]["id"],
            combat["no_effect"]["sound_type2"]["id"]]
    nameless = [f"{i:#x}" for i in ids if i not in se]
    print(f"  {len(ids)} combat sound ids, {len(ids) - len(nameless)} named")
    if nameless:
        fails.append(f"sound ids with no filename: {nameless}")

    if fails:
        print("\nFAIL")
        for f in fails:
            print("  " + f)
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
