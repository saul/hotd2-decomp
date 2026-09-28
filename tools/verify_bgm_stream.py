#!/usr/bin/env python3
"""Where does the music loop -- read from the exe, and held against every track.

The answer, `[proved]`: **nowhere in particular.** There are no loop points in
the files and none in a table. `PlaySoundId` (`FUN_0041CFD0`) hands every BGM
id to `SoundPlayOnFreeChannel(name, loop, 0xF, -1)` (`FUN_004AC020`), channel
`0xF` is opened **streamed** with a 3000 ms ring
(`SoundChannelOpenWav(0xF, name, 1, 3000)`, `FUN_004A3EF0`), and when
`SoundStreamThread` (`FUN_004A4640`) reads past **end of file** it seeks back to
the first sample and keeps reading, if the loop bit is set:

    [first sample, EOF)  [first sample, EOF)  [first sample, EOF) ...

Three things follow, and each is asserted or printed here per track:

* the loop restarts at sample 0 -- the `data` chunk's first byte, which the
  header walk counts to (`+0x3C`);
* whatever follows the `data` chunk -- every shipped track ends in a `LIST`
  chunk -- is played as PCM once a pass;
* a pass that is not a whole number of frames starts the next one mid-frame,
  which on 16-bit stereo exchanges the channels every other pass.

It can fail on the exe as well as on the files:

1. the bytes that make the reading -- the three `CMP EBX, imm32` that pick the
   one-shot ids and the `PUSH 1` / `PUSH 0` they choose between, the
   `PUSH 0xBB8; PUSH 1` that opens channel `0xF` streamed, and the two loop-bit
   tests in the thread that are followed by a seek to `+0x3C` -- are checked in
   `Hod2.exe` itself;
2. the port's `BGM_ONE_SHOT_IDS` (`web/src/audio/bgm.ts`) must be exactly the
   exe's three;
3. every name in both BGM tables must open under the engine's own header walk,
   and **every looping track must be at least one ring long**: the first fill
   is made before the loop bit is set, so a shorter looping file would play
   once, then silence to the end of the ring, then wrap -- a case
   `web/src/audio/stream.ts` does not model because no shipped track needs it.

    python3 tools/verify_bgm_stream.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import re
import struct
import sys
from math import gcd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib.exetab import ExeTables  # noqa: E402

#: `PlaySoundId`'s loop-flag choice: (address, expected bytes, what it is).
EXE_BYTES: list[tuple[int, bytes, str]] = [
    (0x0041D1FB, bytes.fromhex("81fb09000010"), "CMP EBX, 0x10000009"),
    (0x0041D203, bytes.fromhex("7434"), "JZ 0x0041D239 (the unlooped call)"),
    (0x0041D205, bytes.fromhex("81fb25000010"), "CMP EBX, 0x10000025"),
    (0x0041D20B, bytes.fromhex("742c"), "JZ 0x0041D239"),
    (0x0041D20D, bytes.fromhex("81fb14000010"), "CMP EBX, 0x10000014"),
    (0x0041D213, bytes.fromhex("7424"), "JZ 0x0041D239"),
    (0x0041D215, bytes.fromhex("6aff6a0f"), "PUSH -1; PUSH 0xF (channel 0xF)"),
    (0x0041D21D, bytes.fromhex("6a01"), "PUSH 1 -- loop, every other id"),
    (0x0041D239, bytes.fromhex("6aff6a0f"), "PUSH -1; PUSH 0xF"),
    (0x0041D241, bytes.fromhex("6a00"), "PUSH 0 -- once, the three above"),
    # `SoundPlayOnFreeChannel`'s channel-0xF open: streamed, a 3000 ms ring.
    (0x004AC131, bytes.fromhex("68b80b0000"), "PUSH 3000 (ring ms)"),
    (0x004AC136, bytes.fromhex("6a01"), "PUSH 1 (open streamed)"),
    # `SoundStreamThread`'s end-of-file branches: the loop bit, then a seek to
    # the channel's +0x3C.
    (0x004A4991, bytes.fromhex("f644064308"), "TEST byte [+0x43], 0x08 (loop)"),
    (0x004A4998, bytes.fromhex("8b54063c"), "MOV EDX, [+0x3C] (first sample)"),
    (0x004A49A4, bytes.fromhex("ff1598404c00"), "CALL [SetFilePointer]"),
    (0x004A4AAF, bytes.fromhex("f7440640" "00000008"),
     "TEST [+0x40], 0x08000000 (loop)"),
    (0x004A4AB9, bytes.fromhex("8b54063c"), "MOV EDX, [+0x3C]"),
    (0x004A4AC5, bytes.fromhex("ff1598404c00"), "CALL [SetFilePointer]"),
]
EXE_ONE_SHOTS = [0x10000009, 0x10000025, 0x10000014]
RING_MS = 3000


def open_wav(b: bytes) -> dict | None:
    """`SoundChannelOpenWav`'s header walk (`FUN_004A3EF0`), to the first sample.

    Counts every tag and size into `+0x3C`, skips unknown chunks by their size
    with **no** pad byte, reads `fmt ` and stops at `data`.
    """
    at = counted = 0
    fmt = None
    while at + 4 <= len(b):
        tag = b[at:at + 4]
        at += 4
        counted += 4
        if tag == b"RIFF":
            at += 4
            counted += 4
        elif tag == b"WAVE":
            pass
        elif tag == b"fmt ":
            size = struct.unpack_from("<I", b, at)[0]
            at += 4
            counted += size + 4
            fmt = struct.unpack_from("<HHIIHH", b, at)
            at += size
        elif tag == b"data":
            counted += 4
            size = struct.unpack_from("<I", b, at)[0]
            if fmt is None:
                return None
            return {"start": counted, "size": size, "tag": fmt[0],
                    "channels": fmt[1], "rate": fmt[2], "avg": fmt[3],
                    "align": fmt[4], "bits": fmt[5]}
        else:
            size = struct.unpack_from("<I", b, at)[0]
            at += 4 + size
            counted += size + 4
    return None


def ring_bytes(avg: int) -> int:
    n = avg * RING_MS // 1000
    if n & 0x3F:
        n = (n + 0x40) & ~0x3F
    return n


def port_one_shots() -> list[int] | None:
    src = (ROOT / "web" / "src" / "audio" / "bgm.ts").read_text()
    m = re.search(r"BGM_ONE_SHOT_IDS[^=]*=\s*\[([^\]]*)\]", src)
    if not m:
        return None
    return [int(x, 16) for x in re.findall(r"0x[0-9a-fA-F]+", m.group(1))]


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
    ok = True

    # -- 1. the reading, in the exe's own bytes -----------------------------
    bad = []
    for va, want, what in EXE_BYTES:
        r = tables._v2r(va)
        got = tables.data[r:r + len(want)] if r is not None else b""
        if got != want:
            bad.append(f"0x{va:08X} {what}: want {want.hex()} got {got.hex()}")
    if bad:
        ok = False
        print(f"FAIL  {len(bad)} of the {len(EXE_BYTES)} instructions the "
              f"reading rests on are not what it says:")
        for line in bad:
            print(f"        {line}")
    else:
        print(f"  ok    all {len(EXE_BYTES)} instructions the reading rests on: "
              f"three one-shot ids, channel 0xF streamed with a "
              f"{RING_MS} ms ring, and both end-of-file branches seeking to "
              f"+0x3C on the loop bit")

    # -- 2. the port's constant is the exe's --------------------------------
    port = port_one_shots()
    if port is None or sorted(port) != sorted(EXE_ONE_SHOTS):
        ok = False
        print(f"FAIL  web/src/audio/bgm.ts BGM_ONE_SHOT_IDS is "
              f"{[hex(x) for x in port or []]}, the exe's are "
              f"{[hex(x) for x in EXE_ONE_SHOTS]}")
    else:
        print("  ok    the port's BGM_ONE_SHOT_IDS are the exe's three")

    # -- 3. every track, as the stream plays it ------------------------------
    names = tables.bgm_names()
    bgm_dir = game / "sound" / "bgm"
    on_disk = {p.name.lower(): p for p in bgm_dir.glob("*")} \
        if bgm_dir.exists() else {}
    if not on_disk:
        print(f"SKIP  no {bgm_dir}")
        return 3 if ok else 1
    tracks: dict[str, set[bool]] = {}
    for table in ("ar", "plain"):
        for idx, name in enumerate(names[table]):
            if name is None:
                continue
            loop = (0x10000000 | idx) not in EXE_ONE_SHOTS
            tracks.setdefault(name, set()).add(loop)

    print(f"\n  {'track':<18}{'mode':<6}{'first':>6}{'data':>10}{'tail':>6}"
          f"{'pass':>10}{'passes':>7}{'period frames':>15}  pass/ring")
    unopened, short, starts = [], [], set()
    for name in sorted(tracks, key=str.lower):
        p = on_disk.get(name.lower())
        if p is None:
            unopened.append(f"{name}: not on disc")
            continue
        b = p.read_bytes()
        h = open_wav(b)
        if h is None or h["tag"] != 1 or h["bits"] not in (8, 16):
            unopened.append(f"{name}: the header walk does not reach PCM data")
            continue
        starts.add(h["start"])
        pass_bytes = len(b) - h["start"]
        tail = pass_bytes - h["size"]
        ring = ring_bytes(h["avg"])
        for loop in sorted(tracks[name], reverse=True):
            passes = h["align"] // gcd(pass_bytes, h["align"]) if loop else 1
            frames = -(-passes * pass_bytes // h["align"])
            print(f"  {name:<18}{'loop' if loop else 'once':<6}{h['start']:>6}"
                  f"{h['size']:>10}{tail:>6}{pass_bytes:>10}{passes:>7}"
                  f"{frames:>15}  {pass_bytes / ring:6.1f}")
            if loop and pass_bytes < ring:
                short.append(f"{name}: {pass_bytes} bytes against a "
                             f"{ring}-byte ring")
    print()
    if unopened:
        ok = False
        print(f"FAIL  {len(unopened)} table names do not open as the engine "
              f"opens them:")
        for line in unopened:
            print(f"        {line}")
    else:
        print(f"  ok    all {len(tracks)} names in the two tables open under "
              f"the engine's header walk; first sample at "
              f"{', '.join(str(s) for s in sorted(starts))}")
    if short:
        ok = False
        print(f"FAIL  {len(short)} looping tracks are shorter than the ring, "
              f"which the port's stream model does not cover:")
        for line in short:
            print(f"        {line}")
    else:
        print("  ok    every looping track is at least one ring long, so the "
              "first fill wraps like every other and the port's model is exact")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
