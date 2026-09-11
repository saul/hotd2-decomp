#!/usr/bin/env python3
"""Every clip a class-0x30 death can play is baked for that spawn's character.

`ChooseDeathMotion` (`FUN_004560B0`) is the only thing that writes `obj+0x1B4`
on a dying zombie, and it has **ten** arms. Four of them travel already -- the
directional pick, `ChooseDeathMotionDirectional` (`FUN_00456220`), whose two
tables live in the EXE and whose other two arms are the literals 991 and 992.
Nothing carried the rest, and one of them cost a hang rather than a pose.

**Why an unbaked death clip is not a cosmetic gap.** `ZombieStateDeath6`
(`FUN_00454D20`) sub 2 leaves on `g_motion_play_length[obj+0x1B4] - 1 <=
obj+0x19C`, and `ZombieStateDeathFallAndBounce` (`FUN_00456DF0`) sub 1 leaves
on `obj+0x19C >= 0x3C`. With no clip the port's `MotionPlayFrame` answers 0
for ever:

* the `>= play - 1` wait passes at once, because `play` is 0 too -- so a
  condition-4 crawler snapped straight to a corpse with no animation, which
  looks like a fast death and not like a missing asset (40 shipped placements,
  stage 2's `znkager`, clips `0x404` and `0x41A`);
* the `>= 0x3C` wait **never** passes, because 0x3C is a literal. So an actor
  that dies holding something -- `obj+0x34` bit `0x1000000`, clip `0x3F9`,
  whose real play length is 85 -- can never leave state 12,
  `ZombieEnterCorpseState` never runs, `ReleaseEnemyPresentCount`
  (`FUN_00456580`) never runs, and `g_enemies_present` never falls. Stage 3's
  block 2 hung on a `wait_scripted_actors` behind a dead civilian who was
  herself parked on `CivilianWait.EnemiesPresent`. `PLAYER_HANGS.md` 22.

**It reads the bundle, not the exporter.** `verify_scripted_clips.py` asks
`hod2lib/characters.py` the same shape of question one class over, and that is
the right half to ask there. Here it is the wrong half: `web/src/hod2lib/` is
the only thing that writes a bundle, the Python package is the parser half, and
the two have drifted before (`FROG_CLIPS` is in the TypeScript and not in the
Python). A check that asked the Python exporter would go green on a fix that
never reached a byte the player loads, which is `L24`.

**The blind spot, written down rather than left implicit.** The four
destroyed-part arms -- `obj+0x1368` bits `0x8`, `0x10`, `0x40`, `0x80` giving
clips `0x1AC`, `0x1A5`, `0x279`, `0x229` -- are **not** demanded. All four
decode at 16 bones, so they are bakeable; nothing in the ported call graph
raises any of those bits, because `ZombieStateTargetMotionScript` and
`ZombieStateDragTarget` set them from a kill-move clip id the port does not
model. Demanding them would be demanding four clips for arms no actor can
take. When one of those bits gets a writer, its clip goes in
`CLASS30_DEATH_CLIPS` and in `PART_DEATH_CLIPS` below on the same day -- and
until then this check is agreeing to miss them, which is exactly the shape of
gap that hid stage 5's van from `verify_prop_slots.py`.

    python3 tools/verify_death_clips.py
    HOTD2_BUNDLE=/path/to/export python3 tools/verify_death_clips.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Class 0x30. Not a magic number twice: `spawns.md` names it.
CLASS_ZOMBIE = 0x30

#: `obj+0x34` bit `0x1000000`, seeded from the spawn record's `+0x04` init
#: flags, which the engine ORs with 1 into `obj+0x34`. `ChooseDeathMotion`
#: tests it at `0x004560DD` and `ZombieStateDeath6` at `0x00454DB8`.
HOLDING = 0x1000000

#: The arms above the directional pick, and the condition that reaches each.
#:
#: Keyed by `None` where the arm has no static gate -- body condition is
#: recomputed every frame by `ActorBodyConditionFromHands` (`FUN_00455920`) as
#: parts come off, and the holding bit has a runtime writer as well as the
#: descriptor, so **every** class-0x30 character type is asked for all of them.
#: That is not belt-and-braces: the two zombies that hung stage 3's block 2
#: were character type 19, whose own spawn records do not set `HOLDING`.
DEATH_ARMS: tuple[tuple[int, str], ...] = (
    (0x3DA, "body condition 4 with obj+0x136C bits 0x2000000 and 0x8000000"),
    (0x3DB, "conditions 5-6, and char types 0xF..0x11 while carried"),
    (0x3F8, "ZombieStateDeathFallAndBounce's landing clip"),
    (0x3F9, "obj+0x34 bit 0x1000000 -- and the way out of state 12"),
    (0x404, "body condition 4's coin toss, even draw"),
    (0x41A, "body condition 4's coin toss, odd draw"),
)

#: The four arms this check deliberately does not demand. Named so that the
#: gap is a list rather than a silence -- see the module docstring.
PART_DEATH_CLIPS: tuple[int, ...] = (0x1AC, 0x1A5, 0x279, 0x229)


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
        print(f"SKIP  verify_death_clips: no bundle at {args.bundle}")
        print("      build one with `cd web && npm run export -- "
              "--game-dir ...`")
        return 3

    print("every clip a class-0x30 death can play, in the bundle it plays from")
    bad: list[str] = []
    checked = 0
    spawns = 0
    holding = 0
    bundles = 0
    types: set[tuple[str, int]] = set()

    for entry in json.loads(manifest.read_text())["stages"]:
        name = entry["name"]
        script = args.bundle / name / entry["script"]
        if not script.exists():
            bad.append(f"{name}: the manifest names a script that is not there")
            continue
        bundles += 1
        chars = json.loads(script.read_text())["characters"]
        by_type = chars["types"]
        # The directional set, read out of the bundle rather than out of the
        # EXE: it is what the port's `ChooseDeathMotionDirectional` indexes,
        # and asking the bundle is what makes this a check on the bundle.
        directional = ([int(m) for m in chars["deaths"]["front"]]
                       + [int(m) for m in chars["deaths"]["back"]]
                       + [991, 992])

        for pl in chars["placements"]:
            if pl.get("class") != CLASS_ZOMBIE:
                continue
            spawns += 1
            ct = pl["char_type"]
            row = by_type.get(str(ct))
            if row is None:
                # A class-0x30 spawn whose character type the exporter could
                # not build. Reported rather than skipped: the same defect one
                # step earlier, and it would hide every clip below it.
                bad.append(f"{name}: spawn at {pl.get('at')} is character "
                           f"type {ct}, which is not in the bundle")
                continue
            types.add((name, ct))
            have = {int(k) for k in row["motions"]}
            if pl.get("init_flags", 0) & HOLDING:
                holding += 1
            want = [(m, "the directional pick") for m in directional]
            want += list(DEATH_ARMS)
            for mid, why in want:
                checked += 1
                if mid not in have:
                    bad.append(
                        f"{name}: spawn at {pl.get('at')} is character type "
                        f"{ct} ({row['name']}), and motion {mid} "
                        f"(0x{mid:03X}) -- {why} -- is not baked for it")

    if not bundles:
        print("SKIP  verify_death_clips: the manifest names no stages")
        return 3

    print(f"  {bundles} bundles: {checked - len(bad)} of {checked} "
          f"(spawn, death clip) pairs baked over {spawns} class-0x30 spawns "
          f"and {len(types)} (bundle, character type) pairs")
    print(f"  {holding} of those spawns carry obj+0x34 bit 0x1000000 from "
          f"their own record, so the engine sends them to state 12")
    print(f"  not demanded: the {len(PART_DEATH_CLIPS)} destroyed-part arms "
          f"{', '.join(f'0x{m:03X}' for m in PART_DEATH_CLIPS)} -- see the "
          f"module docstring")
    if bad:
        for line in bad[:40]:
            print(f"  FAULT  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        print(f"\n{len(bad)} failed")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
