#!/usr/bin/env python3
"""Are the captors' kill cues reachable in the clock the engine counts in?

`ZombieStateTargetMotionScript` (`FUN_0045AAA0`) kills the civilian on the
frame its script entry names::

    if (obj[0x19C] == obj[0x1354] && (target[0x34] & 0x4000000) == 0)
        target[0x34] |= 0x4000000;

`obj+0x19C` is the **play** clock -- it ticks once per 60 Hz frame over data
authored at 30 Hz, so it counts to `g_motion_play_length[motion]`, about twice
the frame count. Read it as the authored frame index instead and every cue past
halfway is simply never reached: the animation plays, the zombie mauls, and the
civilian gets up and walks away.

So this checks both directions across every captor script in the game:

* **every cue must be reachable in the play clock** -- if one were not, the
  reading of the entry's fourth short as a frame would be wrong;
* and it reports how many are *unreachable in authored frames*, which is the
  fingerprint of the bug and the reason this check exists.

    python3 tools/verify_maul_cues.py --game-dir ~/"THE HOUSE OF THE DEAD 2"

It reads the built bundles for the scripts and the exe for the play lengths, so
it needs `npm run export -- --all` to have run.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import stage as stagelib  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--bundle", type=Path,
                    default=Path(__file__).resolve().parent.parent
                    / "extract" / "player")
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()

    tables = stagelib.Stage(game, stage=1).tables
    rows: list[tuple[int, int, int, int, int, int]] = []
    for n in range(1, 7):
        path = args.bundle / f"stage{n}" / f"stage{n}.script.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text())
        types = doc.get("characters", {}).get("types", {})
        for pl in doc.get("characters", {}).get("placements", []):
            ct = types.get(str(pl.get("char_type")), {})
            for key in ("target_script", "attack_script"):
                scr = pl.get(key)
                if not scr:
                    continue
                for e in scr.get("entries", []):
                    cue, mid = e.get("mode"), e.get("motion")
                    if cue is None or cue < 0 or not mid or mid < 0:
                        continue        # a negative mode is "no kill"
                    play = tables.motion_play_length(mid) or 0
                    frames = (ct.get("motions", {}).get(str(mid)) or {}).get(
                        "frames", 0)
                    rows.append((n, pl["at"], mid, cue, play, frames))

    if not rows:
        print("FAIL  no captor script in the bundle names a kill cue "
              "(build it with `npm run export -- --all`, in web/)")
        return 1

    unreachable_play = [r for r in rows if r[4] <= 0 or r[3] >= r[4]]
    unreachable_frames = [r for r in rows if r[5] > 0 and r[3] >= r[5]]

    print(f"{len(rows)} kill cues across the game's captor scripts")
    ok = True
    if unreachable_play:
        ok = False
        print(f"FAIL  {len(unreachable_play)} are past the end of their own "
              f"clip's play length:")
        for n, at, mid, cue, play, frames in unreachable_play[:10]:
            print(f"        stage {n} spawn {at}: motion {mid} cue {cue} "
                  f"against play {play} ({frames} frames)")
    else:
        print(f"  ok    all {len(rows)} are inside their clip's play length")

    # Not a failure -- it is the measurement that says the play clock is the
    # right one. If this were zero, both readings would agree and the check
    # would be proving nothing.
    print(f"  note  {len(unreachable_frames)} of {len(rows)} would be "
          f"unreachable if the cue were read as an authored frame index -- "
          f"that many civilians the maul would never kill")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
