#!/usr/bin/env python3
"""Is the looping-SE pairing real, or are the two tables merely adjacent?

`PlaySoundId` (`FUN_0041CFD0`) has one branch that decides whether a sound
effect loops, and it is not a property of the file::

    if (g_looping_se_ids != 0xFFFFFFFF) {
        i = 0; id = g_looping_se_ids;
        do {
            if (param_1 == id)                        { loop = 1; break; }
            if (param_1 == g_looping_se_stop_ids[i])   { SoundStopAllLoopingSe(); break; }
            id = g_looping_se_ids[i + 1]; i++;
        } while (id != 0xFFFFFFFF);
    }
    SoundPlayOnFreeChannel(name, loop, 0xFFFFFFFF, param_1);

So an id in the table at `0x005887FC` is played **looped** and an id in the
table at `0x005888B0` stops every loop in the mix. The engine keeps no handle
for a playing loop, which is why the chainsaw a zombie carries is started by
one call from its `Init` and stopped by another from its death -- see
`EnemyZombieInitByCharType` (`FUN_00452FD0`) and `ZombieReleaseWeaponLoopSe`
(`FUN_00456600`).

Neither table stores a count and neither bounds the other, so the walk to the
`0xFFFFFFFF` terminator is the only thing that fixes their lengths -- exactly
the shape **L6** warns about. This is the check that says the reading is right
rather than plausible, and it can fail four ways:

* the two walks must agree on a length. Two tables read to their own
  terminators that came out different lengths would mean the index-for-index
  pairing is invented;
* every id in both must resolve through `g_se_name_list` (`0x005845F8`). An
  entry that named no record would mean the stride or the base is wrong;
* **every pair must be `X.wav` against `X_OFF.wav`.** That is the assertion
  that could not pass by accident, and it is what makes the pairing a fact
  rather than an observation about two neighbouring arrays;
* and the stop file must *not* be shipped, while the play file is. A stop id is
  a control word, not a sound, and if the `_OFF` wavs were on disc that reading
  would be wrong.

It also names the two pairs class 0x30 uses, because those are the ones a
regression would be felt in: shoot the chainsaw out of a zombie's hands and the
noise has to stop.

    python3 tools/verify_looping_se.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib.exetab import ExeTables  # noqa: E402

#: `EnemyZombieInitByCharType`'s two character types, and the id each plays.
#: Both are `[proved]` -- the `PUSH`es at `0x00453143` and `0x0045314A`.
CLASS30_PLAY = {2: 0x004D17A9, 3: 0x001F25A9}
#: ...and `ZombieReleaseWeaponLoopSe`'s stoppers, at `0x00456620`/`0x00456627`.
CLASS30_STOP = {2: 0x004E17A9, 3: 0x002025A9}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    game = args.game_dir.expanduser().resolve()
    exe = game / "Hod2.exe"
    if not exe.exists():
        print(f"SKIP  no {exe}")
        return 3

    tables = ExeTables(str(exe))
    pairs = tables.looping_se()
    names = tables.se_names()
    ok = True

    if not pairs:
        print("FAIL  the looping-SE walk found nothing at all")
        return 1
    print(f"{len(pairs)} looping-SE pairs at 0x005887FC / 0x005888B0")

    # -- 1. both walks, to their own terminators, agree on a length ---------
    #
    # `looping_se` stops on the *play* table's terminator, so a stop table that
    # ended sooner would show up as an unresolvable id below rather than here.
    # This is the length itself, against the gap between the two bases.
    span = (ExeTables.LOOPING_SE_STOP_IDS - ExeTables.LOOPING_SE_IDS) // 4
    if len(pairs) != span - 1:
        ok = False
        print(f"FAIL  {len(pairs)} entries walked, but the two bases are "
              f"{span} dwords apart -- one terminator plus {span - 1} entries "
              f"is what a contiguous pair of tables would mean")
    else:
        print(f"  ok    the walk's {len(pairs)} entries and the terminator "
              f"exactly fill the {span} dwords between the two bases")

    # -- 2. every id resolves, and 3. every pair is X against X_OFF ---------
    unresolved: list[tuple[int, int, str]] = []
    mismatched: list[tuple[int, str, str]] = []
    for i, pair in enumerate(pairs):
        play, stop = pair["play"], pair["stop"]
        pn, sn = names.get(play), names.get(stop)
        if pn is None:
            unresolved.append((i, play, "play"))
        if sn is None:
            unresolved.append((i, stop, "stop"))
        if pn is None or sn is None:
            continue
        want = pn[:-4] + "_OFF" + pn[-4:] if pn[-4:].lower() == ".wav" else None
        if want is None or want.lower() != sn.lower():
            mismatched.append((i, pn, sn))

    if unresolved:
        ok = False
        print(f"FAIL  {len(unresolved)} ids do not resolve through "
              f"g_se_name_list:")
        for i, sid, which in unresolved[:10]:
            print(f"        entry {i} {which} 0x{sid:X}")
    else:
        print(f"  ok    all {len(pairs) * 2} ids resolve to an SE record")

    if mismatched:
        ok = False
        print(f"FAIL  {len(mismatched)} pairs are not X.wav against X_OFF.wav "
              f"-- the pairing is not index-for-index:")
        for i, pn, sn in mismatched[:10]:
            print(f"        entry {i}: {pn} paired with {sn}")
    else:
        print(f"  ok    every one of the {len(pairs)} pairs is X.wav against "
              f"X_OFF.wav, which is what proves the pairing")

    # -- 4. the stop file is a control word, not a sound --------------------
    se_dir = game / "sound" / "SE"
    shipped = {p.name.lower(): p for p in se_dir.rglob("*.wav")} \
        if se_dir.exists() else {}
    if not shipped:
        print("  note  no sound/SE on disc, so the shipped-file half is not "
              "asserted here")
    else:
        stops_on_disc = []
        plays_missing = []
        for pair in pairs:
            pn, sn = names.get(pair["play"]), names.get(pair["stop"])
            if sn and Path(sn.replace("\\", "/")).name.lower() in shipped:
                stops_on_disc.append(sn)
            if pn and Path(pn.replace("\\", "/")).name.lower() not in shipped:
                plays_missing.append(pn)
        if stops_on_disc:
            ok = False
            print(f"FAIL  {len(stops_on_disc)} stop ids name a file that IS "
                  f"shipped, so they may be sounds after all: "
                  f"{stops_on_disc[:3]}")
        else:
            print(f"  ok    none of the {len(pairs)} stop ids names a shipped "
                  f"file -- they are control words")
        if plays_missing:
            print(f"  note  {len(plays_missing)} play ids name a file that is "
                  f"not on disc: {plays_missing[:3]}")

    # -- 5. the duplicates, and why they are harmless ----------------------
    #
    # Eight of the 44 rows repeat a play id already listed -- the table's own
    # tail is a duplicate block. The engine breaks out of the walk on the
    # **first** match, so a duplicate is harmless only while both copies name
    # the same stopper -- if they disagreed, which row wins would be a fact
    # about the walk order and not about the data, and the reading above would
    # be underdetermined.
    seen: dict[int, int] = {}
    contradictions = []
    for i, pair in enumerate(pairs):
        first = seen.setdefault(pair["play"], i)
        if first != i and pairs[first]["stop"] != pair["stop"]:
            contradictions.append((pair["play"], first, i))
    dupes = len(pairs) - len(seen)
    if contradictions:
        ok = False
        print(f"FAIL  {len(contradictions)} repeated play ids name different "
              f"stoppers, so the first-match walk decides the behaviour:")
        for sid, a, b in contradictions[:10]:
            print(f"        0x{sid:X} at {a} and {b}")
    else:
        print(f"  ok    {dupes} play ids repeat, and every repeat names the "
              f"same stopper, so the first-match walk is not load-bearing")

    # -- and the two class 0x30 uses, by index -----------------------------
    #
    # First match, because that is the one the engine's walk stops at.
    index = seen
    for ct, play in CLASS30_PLAY.items():
        i = index.get(play)
        if i is None:
            ok = False
            print(f"FAIL  character type {ct}'s 0x{play:X} is not in the "
                  f"looping table at all, so it would play as a one-shot")
            continue
        stop = pairs[i]["stop"]
        if stop != CLASS30_STOP[ct]:
            ok = False
            print(f"FAIL  character type {ct} pairs 0x{play:X} with "
                  f"0x{stop:X}, but ZombieReleaseWeaponLoopSe plays "
                  f"0x{CLASS30_STOP[ct]:X}")
            continue
        print(f"  ok    character type {ct}: entry {i}, "
              f"{names.get(play)} stopped by {names.get(stop)}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
