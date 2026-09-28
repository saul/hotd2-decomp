#!/usr/bin/env python3
"""Check the boss cards' page curl against the EXE and the model it bends.

`CurlModelSlot7EEByYaw` (`FUN_004759C0`) bends the loaded model of one asset
slot by a card's yaw. For as long as the routine was called
`CurlModelSlot3F7ByYaw` the port drew both tarot-card intros flat, because the
slot was read with a record stride of 0x20 -- which made it `0x3F7`, a model no
shipped stage ever loads -- where `AssetDrawSlot` indexes the table by 0x10,
which makes it `0x7EE`: the card back both intros draw. `render/card_curl.ts`
ports it. This asserts what that port rests on, each of which can fail:

* **The slot**, from the instruction bytes: the curl's two absolute reads and
  `AssetDrawSlot`'s `SHL EAX, 4; ADD EAX, 0x9A66A0` give slot 0x7EE for both
  the model pointer (+4) and the flags word (+0xC), the banner loads 0x7EE,
  and `g_boss3_card_piece_slots` draws it -- and the port's `CURL_SLOT` is it.
* **The arithmetic**: the four constants the routine reads, and the port's
  copies of them, bit for bit.
* **The callers**: a rel32 scan of `.text` finds exactly the two card loops,
  and no other instruction names the slot record.
* **The model**, out of `pol/`: the curl's own walk -- which does not triple a
  triangle list's count and treats any negative dword as a mesh header --
  visits exactly the full vertices the standard walk does, so bending every
  vertex of the exported geometry is bending what the routine bends; every
  mesh is in the opaque pass, which `RenderEnqueueCommand` draws at once, so
  each card is drawn under its own yaw and a copy per card is the same
  picture; and every vertex rests at the curl's own base z, so the model a
  step without the curl draws after a call at yaw 0 is the model as loaded.
"""
from __future__ import annotations

import argparse
import math
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import container, nl1  # noqa: E402
from hod2lib.exetab import IMAGE_BASE, ExeTables  # noqa: E402
from verify_draw_order import Failures  # noqa: E402

CURL = 0x004759C0
#: `(address, bytes, what)`, each read off the listing.
SEQUENCES = [
    (0x004759C1, "a18ce59a00", "MOV EAX, [0x009AE58C] -- the slot's flags"),
    (0x004759C7, "f6c480", "TEST AH, 0x80 -- the resident bit"),
    (0x004759CD, "a184e59a00", "MOV EAX, [0x009AE584] -- the slot's model"),
    (0x004759D2, "8d7018", "LEA ESI, [EAX + 0x18] -- the walk's start"),
    (0x004759F1, "d906d80d14dd5500e852750300",
     "FLD float [ESI]; FMUL float [0x0055DD14]; CALL __ftol"),
    (0x00475A2C, "dc2d90915600", "FSUBR double [0x00569190]"),
    (0x00475A3A, "894ee8", "MOV [ESI - 0x18], ECX -- the vertex's z"),
    (0x00418576, "c1e00405a0669a00",
     "AssetDrawSlot: SHL EAX, 4; ADD EAX, 0x9A66A0"),
    (0x00437BC9, "68ee070000", "BossIntroBannerUpdate: PUSH 0x7ee"),
]
SLOT_TABLE = 0x009A66A0
SLOT_STRIDE = 0x10
MODEL_READ, FLAGS_READ = 0x009AE584, 0x009AE58C
CALLERS = {0x0042499F: "Boss3IntroCardUpdate", 0x00437C7D: "BossIntroBannerUpdate"}
#: `g_boss3_card_piece_slots`.
BOSS3_PIECE_SLOTS = 0x00589120
CONSTANTS = [
    (0x0055DD14, "<f", "cba10045", "x to BAMS"),
    (0x004C4370, "<d", "182d4454fb21193f", "BAMS to radians"),
    (0x004C4CA8, "<d", "0000000000001040", "the depth, 4.0"),
    (0x00569190, "<d", "00000080732a093f", "the base z"),
]
PORT = (Path(__file__).resolve().parent.parent / "web" / "src" / "render"
        / "card_curl.ts")


def curl_walk(raw: bytes) -> list[int]:
    """`CurlModelSlot7EEByYaw`'s own walk: the offsets of the records it writes."""
    out: list[int] = []
    p = 0x18
    while True:
        w = struct.unpack_from("<i", raw, p)[0]
        if w == 0:
            return out
        if w < 0:
            p += 0x50
            continue
        n = struct.unpack_from("<i", raw, p + 4)[0]
        p += 8
        for _ in range(max(n, 0)):
            if raw[p] & 1:
                out.append(p)
                p += 0x20
            else:
                p += 8


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()
    exe = args.game_dir / "Hod2.exe"
    tables = ExeTables(str(exe))
    raw = exe.read_bytes()
    fail = Failures()

    def at(va: int) -> int:
        r = tables._v2r(va)
        assert r is not None, hex(va)
        return r

    for va, hexbytes, what in SEQUENCES:
        want = bytes.fromhex(hexbytes)
        got = raw[at(va):at(va) + len(want)]
        fail.check(got == want, f"{va:#010x} {what}: {got.hex()}")
    slot_m = (MODEL_READ - 4 - SLOT_TABLE) / SLOT_STRIDE
    slot_f = (FLAGS_READ - 0xC - SLOT_TABLE) / SLOT_STRIDE
    fail.check(slot_m == slot_f == 0x7EE,
               f"the curl's reads are slots {slot_m} (+4) and {slot_f} (+0xC), "
               "not 0x7EE at a stride of 0x10")
    pieces = list(struct.unpack_from("<8I", raw, at(BOSS3_PIECE_SLOTS)))
    fail.check([i for i, s in enumerate(pieces) if s == 0x7EE]
               == [1, 2, 3, 4, 5, 7],
               f"g_boss3_card_piece_slots is {[hex(s) for s in pieces]}")
    print(f"  slot: [{FLAGS_READ:#x}] and [{MODEL_READ:#x}] are slot "
          f"{int(slot_m):#x}'s record at a stride of {SLOT_STRIDE:#x}, the "
          "banner's card back and the Tower's")

    values = {}
    for va, fmt, hexbytes, what in CONSTANTS:
        got = raw[at(va):at(va) + struct.calcsize(fmt)]
        fail.check(got.hex() == hexbytes, f"[{va:#010x}] {what}: {got.hex()}")
        values[va] = struct.unpack(fmt, got)[0]
    fail.check(values[0x004C4370] == 2 * math.pi / 65536,
               f"[0x004C4370] is {values[0x004C4370]!r}, not 2pi/65536")

    src = PORT.read_text()

    def num(name: str) -> str | None:
        m = re.search(rf"export const {name} = ([^;]+);", src)
        return m.group(1).strip() if m else None

    slot = num("CURL_SLOT")
    fail.check(slot is not None and int(slot, 0) == 0x7EE,
               f"render/card_curl.ts CURL_SLOT is {slot}")
    across = num("CURL_ACROSS")
    m = re.fullmatch(r"Math\.fround\(([0-9.eE+-]+)\)", across or "")
    fail.check(bool(m) and struct.pack("<f", float(m.group(1)))
               == bytes.fromhex("cba10045"),
               f"render/card_curl.ts CURL_ACROSS is {across}, not 0x4500A1CB")
    for name, va in (("CURL_DEPTH", 0x004C4CA8), ("CURL_REST_Z", 0x00569190)):
        v = num(name)
        fail.check(v is not None and float(v) == values[va],
                   f"render/card_curl.ts {name} is {v}, the EXE's is "
                   f"{values[va]!r}")

    _, tva, _, traw, tsize = next(
        s for s in tables._sections if s[0] == ".text")
    base = IMAGE_BASE + tva
    body = raw[traw:traw + tsize]
    calls = set()
    for i in range(len(body) - 5):
        if body[i] in (0xE8, 0xE9):
            rel = struct.unpack_from("<i", body, i + 1)[0]
            if base + i + 5 + rel == CURL:
                calls.add(base + i)
    fail.check(calls == set(CALLERS),
               "the calls to the curl are at "
               + ", ".join(f"{c:#010x}" for c in sorted(calls)))
    for ref in (MODEL_READ, FLAGS_READ):
        pat = struct.pack("<I", ref)
        hits, j = [], body.find(pat)
        while j != -1:
            hits.append(base + j)
            j = body.find(pat, j + 1)
        fail.check(len(hits) == 1,
                   f"{ref:#x} is named at {[hex(h) for h in hits]}")
    print(f"  callers: {', '.join(f'{n} {a:#010x}' for a, n in sorted(CALLERS.items()))}"
          f"; constants and render/card_curl.ts agree")

    file, k = tables.asset_slots()[0x7EE]
    model_raw = container.load((args.game_dir / "pol" / file).read_bytes()).model(k)
    model = nl1.parse(model_raw)
    walked = curl_walk(model_raw)
    standard = [o for me in model.meshes for o in me.offsets]
    fail.check(sorted(walked) == sorted(standard),
               f"{file}[{k}]: the curl's walk writes {len(walked)} records, "
               f"the standard walk reads {len(standard)} vertices")
    fail.check(all(me.opaque_pass for me in model.meshes),
               f"{file}[{k}]: a mesh is in the translucent pass, which is "
               "drawn at the end of the frame from the last card's bend")
    rest = struct.unpack("<f", struct.pack("<f", values[0x00569190]))[0]
    zs = {v.pos[2] for me in model.meshes for v in me.vertices}
    fail.check(zs == {rest},
               f"{file}[{k}]: the vertices rest at z {sorted(zs)[:4]}, "
               f"not the curl's base {rest!r}")
    xs = [v.pos[0] for me in model.meshes for v in me.vertices]
    print(f"  model: slot 0x7EE is {file}[{k}], {len(model.meshes)} mesh, "
          f"{len(walked)} full vertices, x {min(xs):.3f}..{max(xs):.3f}, "
          f"all at z {rest!r}, opaque pass")

    if fail.n:
        print(f"verify_card_curl: {fail.n} of {fail.asserted} checks FAILED")
        return 1
    print(f"verify_card_curl: all {fail.asserted} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
