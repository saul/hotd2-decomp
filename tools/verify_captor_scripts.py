#!/usr/bin/env python3
"""Check that class 0x30's captor scripts decode, in every stage.

Eleven of the 54 class-0x30 states work on ``obj+0x1394`` -- the object the
actor was built for, which for the 47 class-0x10 captors is the civilian.
Each takes a script through `ZombieScriptForState` (`FUN_0045CA10`): the
descriptor tail's ``+0x08`` when the actor is in the tail's attack state,
``+0x04`` otherwise. The blob opens with a header whose shape belongs to the
entering state and continues as a list of ``s16[4]`` motion entries.

The check that the header lengths are right is that **every** blob terminates:
a list ends on the first entry whose motion is below 1, and a wrong header
walks into the middle of a float, where the "motion" is a mantissa and the list
runs to the cap. It also asserts that both pointers on every such spawn resolve
to a real evt offset, and that every clip named is a plausible motion id.

    python3 tools/verify_captor_scripts.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import characters as charlib, evt as evtlib  # noqa: E402
from hod2lib import script as scriptlib, stage as stagelib  # noqa: E402

#: What the shipped stages hold. A change here is a change in the reading.
#:
#: 70 spawns reach *some* captor state; 69 reach one that takes a script. The
#: odd one starts in `ZombieStateAwaitCivilianOrder`, which reads the
#: civilian's own block rather than a script of its own, and attacks in state 1.
#:
#: These were 58 and 86 while `evt.SPAWN_OPCODES` stopped at the four ungated
#: spawn opcodes. Adding the player-count-gated 0x03/0x04/0x07/0x08 brought 11
#: more captors and 13 more scripts into view -- enemies the shipped scripts
#: place, and that a one- or two-player game really does get.
EXPECT_SPAWNS = 69
EXPECT_SCRIPTS = 99


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()
    if not (game / "Hod2.exe").exists():
        raise SystemExit(f"no Hod2.exe under {game}")

    spawns = scripts = bad = 0
    by_state: collections.Counter = collections.Counter()
    entries: collections.Counter = collections.Counter()
    for n in range(1, 7):
        try:
            st = stagelib.Stage(game, stage=n)
            prog = scriptlib.Program(st)
        except Exception as exc:                       # noqa: BLE001
            print(f"stage {n}: {exc}")
            continue
        recs = {r.offset: r for r in evtlib.spawns(prog.evt)}
        # The civilians' captors are not in the instruction stream; they exist
        # only as pointers in a class-0x10 tail. Without this the check misses
        # the 47 spawns it is most about.
        for r in list(recs.values()):
            if r.cls != 0x10:
                continue
            cnt = r.param(0x0C, "i32") or 0
            for k in range(max(0, min(cnt, 32))):
                w = r.param(0x10 + k * 4, "u32")
                off = prog.evt.to_offset(w) if w else None
                if off is not None and off not in recs:
                    recs[off] = evtlib.read_spawn(prog.evt, off, 0x0B)

        for rec in recs.values():
            if rec.cls != 0x30:
                continue
            init = rec.param(2, "i8") or 0
            atk = rec.param(3, "i8") or 0
            shapes = charlib.TARGET_SCRIPT_SHAPE
            if init not in shapes and atk not in shapes:
                continue
            spawns += 1
            for state, at in ((init, 4), (atk, 8)):
                if state not in shapes:
                    continue
                w = rec.param(at, "u32")
                off = prog.evt.to_offset(w) if w else None
                if off is None:
                    print(f"FAIL stage {n} spawn {rec.offset}: state {state}'s"
                          f" script pointer {w:#010x} is not an evt offset")
                    bad += 1
                    continue
                s = charlib.target_script(prog, off, state)
                if s is None:
                    print(f"FAIL stage {n} spawn {rec.offset}: state {state}'s"
                          " script does not decode")
                    bad += 1
                    continue
                scripts += 1
                by_state[state] += 1
                entries[len(s["entries"])] += 1
                if len(s["entries"]) >= 64:
                    print(f"FAIL stage {n} spawn {rec.offset}: state {state}'s"
                          " entry list never terminates -- the header length"
                          " for that state is wrong")
                    bad += 1
                for e in s["entries"]:
                    if not 0 < e["motion"] < 4096:
                        print(f"FAIL stage {n} spawn {rec.offset}: state"
                              f" {state} names motion {e['motion']}")
                        bad += 1

    print(f"{spawns} class-0x30 spawns reach a captor state, "
          f"{scripts} scripts decoded")
    print("  by entering state:",
          {k: v for k, v in sorted(by_state.items())})
    print("  entries per script:", {k: v for k, v in sorted(entries.items())})
    if spawns != EXPECT_SPAWNS:
        print(f"FAIL {spawns} spawns, expected {EXPECT_SPAWNS}")
        bad += 1
    if scripts != EXPECT_SCRIPTS:
        print(f"FAIL {scripts} scripts, expected {EXPECT_SCRIPTS}")
        bad += 1
    print("clean" if not bad else f"{bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
