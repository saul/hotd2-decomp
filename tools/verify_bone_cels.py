#!/usr/bin/env python3
"""The cel runs a class-0x30 bone draws, against the EXE and against the bundle.

`ZombieDrawBonePart` (`FUN_004534A0`) is class 0x30's per-bone draw callback,
installed at ``obj+0x12EC`` by `EnemyZombieInit` and called by
`SkeletonEmitNode` **instead of** `SkeletonDrawNodeSlot`. Nine arms of its
switch draw a *cel* out of a run of models chosen by a free-running counter,
and four of those draw the bone's own slot as well. `char_adv02`'s bone 1 is
the one a bug report found: the damaged torso is chest-only and the thirty-cel
run at ``0x1B52`` is what fills the band between it and the pelvis.

**No table in the EXE names any of it** -- the base and the count are
immediates in the routine's own code -- so the port carries the table in
`web/src/game/class30/bonecels.ts`, and a hand-written table is exactly the
thing that rots. Three assertions, each one something only this check can see:

1. **every row is in the binary.** Each ``(base, count)`` pair has to appear
   inside the routine as the fifteen bytes ``MOV ECX,count; CDQ; IDIV ECX;
   ADD EDX,base`` -- ``b9 <count> 99 f7 f9 81 c2 <base>``. A base or a count
   edited in the TypeScript and not in the game fails here.
2. **the models say what the reading says.** The two damaged torso stages the
   table gives a second draw to (``0x1B70``, ``0x1B71``) stop above the pelvis,
   and the three it does not (``0x1B72``..``0x1B74``) reach below it. That
   split is the reason the table has the rows it has, and it is measured from
   `pol/` rather than asserted in prose.
3. **the bundle carries the run.** A character whose bone or gore slots reach a
   trigger has to have every cel of that run in its hidden `gore_` rig, or the
   renderer looks the slot up, finds nothing and draws the hole this fixed. An
   exporter change that stops carrying them passes every other check in the
   tree: the counts are all still right.

    python3 tools/verify_bone_cels.py --game-dir ~/"THE HOUSE OF THE DEAD 2"

Exit 0 when it asserted things, 1 when they were wrong, 3 when it could not
assert anything -- no game directory, or no exported bundle.
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

from hod2lib import combat, container as C, exetab, nl1  # noqa: E402

TABLE_TS = ROOT / "web" / "src" / "game" / "class30" / "bonecels.ts"

#: `ZombieDrawBonePart`'s extent, from the Ghidra database: the entry point and
#: the first byte past the jump tables its switch ends with.
ROUTINE_LO = 0x004534A0
ROUTINE_HI = 0x00453940

#: The band `char_adv02`'s damaged torso leaves empty, from the pelvis' top to
#: the chest-only model's bottom. Both measured, not authored.
PELVIS_TOP = -0.45
CHEST_ONLY_BOTTOM = 1.3


def parse_table(path: Path) -> dict[int, dict]:
    """The port's table, out of the TypeScript.

    Read rather than imported because this is a Python checker and the table is
    the renderer's; parsing it is also what makes an edit to the *literals*
    visible here, which is the point.
    """
    text = path.read_text()
    body = text[text.index("g_class30_bone_cels"):]
    body = body[body.index("{"):body.index("\n};")]
    out: dict[int, dict] = {}
    for m in re.finditer(
            r"(0x[0-9a-f]+):\s*\{\s*self:\s*(true|false),\s*runs:\s*\[(.*?)\]\s*\}",
            body, re.S):
        runs = [(int(b, 16), int(c))
                for b, c in re.findall(r"base:\s*(0x[0-9a-f]+),\s*count:\s*(\d+)",
                                       m.group(3))]
        out[int(m.group(1), 16)] = {"self": m.group(2) == "true", "runs": runs}
    return out


def slot_extent(tables, slots, slot: int):
    """``(ymin, ymax)`` of every vertex of a slot's whole mesh chain, or None."""
    rec = slots.get(slot)
    if rec is None:
        return None
    game = Path(os.environ["HOTD2_GAME_DIR"])
    models = nl1.parse_container(C.load((game / "pol" / rec[0]).read_bytes()))
    if rec[1] >= len(models):
        return None
    ys = [v.pos[1] for me in models[rec[1]].meshes for v in me.vertices]
    return (min(ys), max(ys)) if ys else None


def bundle_root() -> Path | None:
    env = os.environ.get("HOTD2_BUNDLE")
    if env:
        return Path(env)
    d = ROOT / "extract" / "player"
    return d if d.is_dir() else None


def glb_nodes(path: Path) -> set[str]:
    """Every node name in a `.glb`, out of its JSON chunk."""
    b = path.read_bytes()
    return {m.group(1).decode()
            for m in re.finditer(rb'"name":"([^"]+)"', b[:len(b)])}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", default=None)
    args = ap.parse_args()

    table = parse_table(TABLE_TS)
    if not table:
        print("error: no rows parsed out of bonecels.ts", file=sys.stderr)
        return 1
    print(f"{len(table)} arms in {TABLE_TS.relative_to(ROOT)}")

    if not args.game_dir:
        print("\nSKIP  verify_bone_cels: needs --game-dir")
        return 3
    game = Path(os.path.expanduser(args.game_dir))
    os.environ["HOTD2_GAME_DIR"] = str(game)
    tables = exetab.ExeTables(game / "Hod2.exe")
    slots = tables.asset_slots()
    lo = tables._v2r(ROUTINE_LO)
    hi = tables._v2r(ROUTINE_HI)
    code = tables.data[lo:hi]

    bad: list[str] = []
    asserted = 0

    # 1. every (base, count) is the routine's own arithmetic.
    for trigger, arm in sorted(table.items()):
        for base, count in arm["runs"]:
            want = (b"\xb9" + struct.pack("<I", count) + b"\x99\xf7\xf9"
                    + b"\x81\xc2" + struct.pack("<I", base))
            asserted += 1
            if code.find(want) < 0:
                bad.append(
                    f"0x{trigger:04X}: no 'MOV ECX,{count}; CDQ; IDIV ECX; "
                    f"ADD EDX,0x{base:X}' inside ZombieDrawBonePart")

    # 2. the split the table turns on, measured from pol/.
    #    char_adv02's bone 1: five damage stages, the first two chest-only.
    torso_stages = [v for v in combat._u16_table(tables, combat.HIT_EFFECT, 0, 1)
                    if v > 2]
    for i, slot in enumerate(torso_stages):
        ext = slot_extent(tables, slots, slot)
        if ext is None:
            bad.append(f"0x{slot:04X}: unresolved")
            continue
        asserted += 1
        has_cel = slot in table
        reaches_pelvis = ext[0] <= PELVIS_TOP
        if has_cel and reaches_pelvis:
            bad.append(f"0x{slot:04X} reaches y={ext[0]:.2f} and still takes a "
                       f"cel run -- the abdomen would be drawn twice")
        if not has_cel and not reaches_pelvis:
            bad.append(f"0x{slot:04X} stops at y={ext[0]:.2f} above the pelvis "
                       f"({PELVIS_TOP}) and takes no cel run -- a hole")
        print(f"  torso stage {i} 0x{slot:04X}  y {ext[0]:7.2f}..{ext[1]:6.2f}"
              f"  {'+cel run' if has_cel else 'alone'}")

    # ...and the run itself covers the band the chest-only stages leave.
    lower = table[0x1b3d]["runs"][-1]
    for i in range(lower[1]):
        ext = slot_extent(tables, slots, lower[0] + i)
        if ext is None:
            bad.append(f"0x{lower[0] + i:04X}: unresolved")
            continue
        asserted += 1
        if not (ext[0] <= PELVIS_TOP and ext[1] >= CHEST_ONLY_BOTTOM):
            bad.append(f"cel 0x{lower[0] + i:04X} spans y {ext[0]:.2f}.."
                       f"{ext[1]:.2f} and does not bridge "
                       f"{PELVIS_TOP}..{CHEST_ONLY_BOTTOM}")

    # 3. every bundle that carries a trigger character carries the whole run.
    root = bundle_root()
    if root is None:
        print("\nSKIP  verify_bone_cels: no exported bundle")
        return 3
    stages = sorted(p for p in root.glob("stage*/stage*.glb"))
    if not stages:
        print(f"\nSKIP  verify_bone_cels: no .glb under {root}")
        return 3
    for glb in stages:
        names = glb_nodes(glb)
        for ct in range(0x80):
            skel = tables.character_skeleton(ct)
            if not skel:
                continue
            stem = slots.get(skel[0]["slot"], (None,))[0]
            if not stem:
                continue
            stem = stem[:-4] if stem.endswith(".bin") else stem
            if not any(n.startswith(f"gore_{stem}_") for n in names):
                continue
            used = {n["slot"] for n in skel}
            # **Bounded by the character's own bone count** -- `HIT_EFFECT` is
            # a per-character `u16[bone][6]` and reading past the last bone
            # walks into the *next* character's table. Doing that once
            # attributed `znjoe`'s eighteen cels to `char_adv01`, which is L6.
            nb = tables.character_bone_count(ct) or 0
            for b in range(1, nb + 2):
                used |= {v for v in combat._u16_table(tables, combat.HIT_EFFECT,
                                                      ct, b) if v > 2}
            for trigger, arm in table.items():
                if trigger not in used:
                    continue
                for base, count in arm["runs"]:
                    missing = [base + i for i in range(count)
                               if not any(n.endswith(f"gore_{base + i:04x}")
                                          for n in names)]
                    asserted += 1
                    if missing:
                        bad.append(
                            f"{glb.parent.name}: {stem} draws 0x{trigger:04X} "
                            f"and the bundle is missing {len(missing)} of the "
                            f"{count} cels at 0x{base:04X}")
        print(f"  {glb.parent.name}: checked")

    print()
    for b in bad:
        print(f"  FAIL  {b}")
    if not asserted:
        print("SKIP  verify_bone_cels: nothing asserted")
        return 3
    print(f"{asserted} assertions, {len(bad)} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
