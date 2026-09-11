#!/usr/bin/env python3
"""Every `wait_camera_path_frame <n>` asks for a frame its own play publishes.

`EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`) advances the instruction pointer
only when the frame is **past** the operand::

    0045fae7  CMP dword ptr [0x009a6110],EAX     ; g_cam_path_frame, operand
    0045faed  JLE 0045fb29                       ; frame <= operand: keep waiting

so the wait needs frame ``operand + 1`` to be published. Which frames a play
publishes depends on *how* it is played, and the three ways differ at both
ends -- this is the arithmetic the port now transcribes, and the only thing
that can say the shipped scripts agree with it:

==========================================  =====================  ==========
routine                                     installed by           publishes
==========================================  =====================  ==========
``CamAdvancePathFrame`` (``FUN_004035E0``)   ``cam_play``           start..end
``CameraStepRailTick`` (``FUN_0040C790``)    scene state ``(2,6)``  start+1..end
``CameraPlayStashedPath`` (``FUN_0040C8A0``) scene state ``(2,7)``  start+1..end+1
==========================================  =====================  ==========

Both stashed routines increment before they publish, which is why they step
past their start frame; they differ by one byte of guard -- ``JGE`` at
``0x0040C7A0`` against ``JG`` at ``0x0040C8C0`` -- which is why state 7 carries
one frame beyond the range's end. `[proved]`

**Why this is a check and not a comment.** A strict wait that asks for a frame
nothing publishes is a hang, and the port only became strict once the shipped
data had been counted. That count is this file. It is also the guard on the
other direction: drop ``CamCommand.pastEnd`` and a stashed state-7 play stops
one frame short, which is what held stage 2's block 9 for ever -- a civilian's
killed stream waits on camera path 66 frame **385** while the step stashes
``351..384``. The 0-operand form is a different test in the engine
(``g_cam_path_frames_left > 0``) and is not counted here.

**What it cannot see**: a wait whose play was started in an earlier step, and
the deferred plays a `finish_sequence` in another step takes over. Those are
skipped rather than guessed at, and the number skipped is printed, because a
check that silently drops the cases it cannot model is how a count comes to
mean nothing.

    python3 tools/verify_cam_waits.py
    HOTD2_BUNDLE=/path/to/export python3 tools/verify_cam_waits.py
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: How many frames past its range's end each player of a stashed range
#: publishes. The guard byte, as a number.
STASH_PAST_END = {6: 0, 7: 1}


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
        print(f"SKIP  verify_cam_waits: no bundle at {args.bundle}")
        print("      build one with `cd web && npm run export -- "
              "--game-dir ...`")
        return 3

    entries = json.loads(manifest.read_text(encoding="utf-8")).get("stages", [])
    bad: list[str] = []
    checked = skipped = stashed_plays = bundles = 0

    for e in entries:
        name = e.get("name")
        script = e.get("script")
        if not name or not script:
            continue
        path = args.bundle / name / script
        if not path.exists():
            continue
        bundles += 1
        d = json.loads(path.read_text(encoding="utf-8"))
        for b in d.get("blocks", []):
            for st in b.get("steps") or []:
                # The play in force, as `(last frame published, how)`. Reset
                # per step: a play that began in an earlier step is one of the
                # cases this check does not model.
                play = None
                stash = None
                for op in st.get("ops", []):
                    nm = op.get("name")
                    action = op.get("action")
                    if nm == "queue_event" and action == "cam_play":
                        start, end = op.get("start", 0), op.get("end", 0)
                        if start != end and (op.get("flags", 0) & 2):
                            stash = (start, end)
                        else:
                            play = (end, f"cam_play {start}..{end}")
                    elif nm == "queue_event" and action == "finish_sequence":
                        minor = (op.get("args") or [None])[0]
                        if minor in STASH_PAST_END and stash:
                            s, en = stash
                            stashed_plays += 1
                            play = (en + STASH_PAST_END[minor],
                                    f"state {minor} on a stashed {s}..{en}")
                            stash = None
                    elif nm == "wait_camera_path_frame":
                        arg = op.get("arg", 0)
                        if arg == 0:
                            continue
                        if play is None:
                            skipped += 1
                            continue
                        checked += 1
                        if arg + 1 > play[0]:
                            bad.append(
                                f"{name}: block {b['index']} step "
                                f"{st['index']} op {op['i']} waits for frame "
                                f"{arg}, so it needs {arg + 1}, but "
                                f"{play[1]} publishes no further than "
                                f"{play[0]}")

    if not bundles:
        print("SKIP  verify_cam_waits: the manifest names no stages")
        return 3

    print(f"{bundles} bundles: {checked} camera-frame waits checked against "
          f"the play in force ({stashed_plays} of those plays are stashed "
          f"ranges), {skipped} skipped with no play in the same step")
    if bad:
        for line in bad[:40]:
            print(f"  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        print(f"\nFAIL {len(bad)} camera-frame waits ask for a frame their own "
              f"play never publishes, and a strict wait on one is a hang")
        return 1
    print("\nclean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
