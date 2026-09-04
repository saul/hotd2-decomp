#!/usr/bin/env python3
"""Every clip a scripted class can put on an actor is in that actor's bundle.

This is the check that would have caught B13, and it is a whole-corpus one: it
runs the real exporter over all six stages, asks each class-0x25 command block
and each class-0x20 descriptor which motion ids its class can reach, and
demands that every one of them came out of `resolve_for_stage` **baked for that
spawn's own character type**.

**Why an unbaked clip is not a cosmetic gap.** A class-0x25 program's `op 1`
mode 2 is *hold when the clip reaches its last frame*, and the port measures
that against `BakedMotion.frames`. A clip with no frames pins the authored
frame at 0, the wait can never fire, and the VM parks on that command with the
skeleton stuck on whatever pose it last had -- for the rest of the stage. Two
stage-2 humanoids in the bug report were doing exactly that: their `op 2` set
motion 180, and nothing had ever added an `op 2` operand to the bake list, so
**118 of the six stages' 263 (program, clip) pairs had no frames at all**.

The class-0x20 half is the same property one class over:
`OneHitTargetInit` (`FUN_00448ED0`) draws one of `g_class20_idle_motions` with
`rand() & 3` when the tail names no motion -- so **all four** have to exist
before the draw is made, not just the one the exporter happened to pose the
placement in -- and `OneHitTargetUpdate` (`FUN_00449020`) cues motion 988 on
the frame the actor is shot.

It asks the **exporter** rather than `charmotion.bake`, and the distinction is
the whole point: every one of the 118 missing clips was perfectly bakeable, and
a check that only asked whether the data decodes would have passed the entire
time the bug was live. What was wrong was the list of clips the exporter asked
for, so that list is what this measures.

    python3 tools/verify_scripted_clips.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import (  # noqa: E402
    characters as charlib, charmotion, evt as evtlib, script as scriptlib,
    stage as stagelib,
)

STAGES = range(1, 7)
SCRIPTED_CLASSES = (0x20, 0x25)


def clips_for(rec, cls: int) -> list[int]:
    """Every motion id this spawn's class can put on it.

    Class 0x25: the command block's header motion plus every `op 2` / `op 3`
    operand -- the only three ways `ScriptedHumanoidUpdate` (`FUN_004842A0`)
    writes `obj+0x1B4`.

    Class 0x20: the four `g_class20_idle_motions` (0x005647A4), because the
    Init's `rand() & 3` can land on any of them; motion 988, which the shot
    cues; and the tail's own `+0x06` when it names one.
    """
    if cls == 0x25:
        return charmotion.humanoid_motion_ids(rec.evt, rec)
    if cls == 0x20:
        authored = rec.param(0x06, "i16") or 0
        out = list(charmotion.CLASS20_IDLE_MOTIONS)
        out.append(charmotion.CLASS20_DEATH_MOTION)
        if authored > 0:
            out.append(authored)
        return out
    return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True)
    args = ap.parse_args()
    game = Path(args.game_dir).expanduser()

    print("\nevery clip a scripted class can reach, in the bundle it exports")
    checked = 0
    missing: list[str] = []
    per_class = {0x20: 0, 0x25: 0}

    for n in STAGES:
        try:
            st = stagelib.Stage(game, stage=n)
            prog = scriptlib.load(st)
            chars, _places, _entries = charlib.resolve_for_stage(st, prog)
        except Exception as exc:                       # noqa: BLE001
            print(f"  stage{n}: unreadable -- {exc}")
            return 1
        for rec in evtlib.spawns(prog.evt):
            if rec.cls not in SCRIPTED_CLASSES:
                continue
            ct = rec.param(0x00, "i8")
            c = chars.get(ct)
            if c is None:
                # A spawn whose character type the exporter could not build at
                # all. Reported rather than skipped: it is the same defect one
                # step earlier.
                missing.append(f"stage{n} 0x{rec.offset:04X} class "
                               f"0x{rec.cls:02X}: character type {ct} is not "
                               f"in the exported bundle")
                continue
            for mid in dict.fromkeys(clips_for(rec, rec.cls)):
                checked += 1
                per_class[rec.cls] += 1
                if mid not in c.motions:
                    missing.append(
                        f"stage{n} 0x{rec.offset:04X} class 0x{rec.cls:02X} "
                        f"type {ct} ({c.name}): motion {mid} is not baked")

    print(f"  {checked - len(missing)} of {checked} (spawn, clip) pairs are "
          f"baked -- {per_class[0x25]} from class 0x25 command blocks, "
          f"{per_class[0x20]} from class 0x20 descriptors")
    if missing:
        for m in missing[:40]:
            print(f"  MISSING  {m}")
        if len(missing) > 40:
            print(f"  ... and {len(missing) - 40} more")
        print(f"\n{len(missing)} failed")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
