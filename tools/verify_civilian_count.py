#!/usr/bin/env python3
"""Check the ways a civilian can leave `g_civilians_alive`.

`wait_scripted_actors` (evt `0x46`, `EvtOpWaitScriptedActors46` at
`0x0045FCD0`) blocks the script until `g_civilians_alive` (`0x009CA0E8`) falls
to its operand, and **all 68 sites in the shipped scripts pass 0** -- so it
waits for the last civilian to leave play. A civilian that never leaves the
count parks the interpreter forever.

`CivilianInit` raises the count **unconditionally** -- confirmed from the
disassembly at `0x0048A6FE`, an `INC word ptr` on the straight-line
fall-through with no branch around it. (An earlier annotation claimed the wait
word's `0x08000000` bit exempted a civilian from this count. It does not: that
bit guards two *other* counters, `0x009A21BA` and `word[0x009C9100 + stage*2]`,
incremented three instructions later under `TEST dword ptr [ECX],0x8000000`.)

There are then three ways back out, and the browser port implements two:

  * **op 0x2C with `0x00080000`** -- `CivilianRunScript` `0x0048BA3C`
    decrements at once and stamps sub+0x04 bit 0 so the teardown will not
    decrement again. *Ported.*
  * **the remove-delay teardown** -- `CivilianUpdate` `0x0048B003`, after the
    sub+0x2A countdown expires. Guarded by sub+0x04 bit 0. *Ported.*
  * **the off-camera teardown** -- `CivilianUpdate` `0x0048B0AC`, the wait
    word's `0x02000000` branch, taken when the civilian is off screen and the
    scene state major is not 2. Same guard. **Not ported.**

That third path is a real divergence, and this file exists to bound it: it can
only matter for a civilian that is still *in* the count when it fires. So the
invariant that makes the omission safe is

    every stream that carries 0x02000000 also carries 0x00080000

-- the civilian has already left the count by the time the off-camera teardown
removes it, so the missing path cannot strand `g_civilians_alive` above zero
and cannot hang a `wait_scripted_actors`. If a future reading of the wait word
changes, or the port starts driving streams this check has not seen, this
fails rather than the player quietly deadlocking.

    python3 tools/verify_civilian_count.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib.exetab import ExeTables  # noqa: E402

#: Civilian wait-word bits, by the names the port's `CivilianWait` enum uses.
LEAVE_COUNT_NOW = 0x00080000
REMOVE_OFF_CAMERA = 0x02000000
UNCOUNTED = 0x08000000

#: What the shipped exe holds. A change here is a change in the reading.
EXPECT_STREAMS = 136
EXPECT_LEAVE_COUNT_NOW = 125
EXPECT_REMOVE_OFF_CAMERA = 90

#: Streams that leave the count only by the remove-delay teardown -- they carry
#: none of the three bits above. Listed rather than counted so that a stream
#: moving into or out of this set is visible in the diff.
EXPECT_TEARDOWN_ONLY = [1, 54, 55, 56, 82, 97, 98, 132, 133, 134, 135]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    exe = next((p for p in game.iterdir() if p.suffix.lower() == ".exe"), None)
    if exe is None:
        raise SystemExit(f"no .exe under {game}")

    streams = ExeTables(exe).civilian_scripts()["scripts"]

    # The wait word accumulates: a stream may set bits in several 0x2C
    # commands, and what matters is whether the bit is ever set at all.
    words = []
    for stream in streams:
        acc = 0
        for cmd in stream:
            if cmd["op"] == 0x2C:
                acc |= cmd["args"][0] & 0xFFFFFFFF
        words.append(acc)

    leave = [i for i, w in enumerate(words) if w & LEAVE_COUNT_NOW]
    offcam = [i for i, w in enumerate(words) if w & REMOVE_OFF_CAMERA]
    # `UNCOUNTED` is deliberately *not* in this test. It exempts a civilian
    # from two other counters (0x009A21BA and word[0x009C9100 + stage*2]) and
    # not from this one -- `CivilianInit`'s `INC word ptr [0x009CA0E8]` at
    # 0x0048A6FE is unconditional, three instructions ahead of the
    # `TEST dword ptr [ECX],0x8000000` that guards those two. Treating it as an
    # exit here excused stage 1's hostage 0x1828, whose stream carries only
    # `UNCOUNTED` and which therefore depends entirely on the remove-delay
    # teardown -- the case this list exists to make visible.
    teardown_only = [i for i, w in enumerate(words)
                     if not w & (LEAVE_COUNT_NOW | REMOVE_OFF_CAMERA)]
    stranded = [i for i in offcam if not words[i] & LEAVE_COUNT_NOW]

    print(f"civilian scripts: {len(streams)} streams")
    print(f"  leave the count by op 0x2C (0x00080000): {len(leave)}")
    print(f"  removed off camera      (0x02000000): {len(offcam)}")
    print(f"  remove-delay teardown only          : {teardown_only}")

    problems: list[str] = []
    if len(streams) != EXPECT_STREAMS:
        problems.append(f"  {len(streams)} streams, expected {EXPECT_STREAMS}")
    if len(leave) != EXPECT_LEAVE_COUNT_NOW:
        problems.append(f"  {len(leave)} streams leave the count by op 0x2C, "
                        f"expected {EXPECT_LEAVE_COUNT_NOW}")
    if len(offcam) != EXPECT_REMOVE_OFF_CAMERA:
        problems.append(f"  {len(offcam)} streams remove off camera, "
                        f"expected {EXPECT_REMOVE_OFF_CAMERA}")
    if teardown_only != EXPECT_TEARDOWN_ONLY:
        problems.append(f"  remove-delay-only streams are {teardown_only}, "
                        f"expected {EXPECT_TEARDOWN_ONLY}")

    # The one that bounds the unported path.
    if stranded:
        problems.append(
            f"  {len(stranded)} stream(s) are removed off camera while still "
            f"counted: {stranded}\n"
            "  The port does not implement the off-camera teardown "
            "(CivilianUpdate 0x0048B0AC), so g_civilians_alive would never "
            "reach 0 for these and `wait_scripted_actors` would hang.")

    if problems:
        print("\nFAIL:")
        print("\n".join(problems))
        return 1
    print("\nclean: every off-camera removal has already left the count, so "
          "the unported teardown cannot strand `wait_scripted_actors`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
