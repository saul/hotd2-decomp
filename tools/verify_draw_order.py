#!/usr/bin/env python3
"""Check the player's two draw passes and translucent order against the EXE.

`web/src/render/draw_order.ts` puts `TranslatePvr2StateToD3D`'s state on every
exported material and gives the renderer `RenderCommandCompare`'s order. Both
halves rest on readings of the binary that no other check touches, and one of
them had been read backwards in this repository's docs for as long as it had
been written down -- "farthest first, painter's order" -- because the sign of
eye-space z was assumed rather than read. What this asserts, from bytes:

  * **The three tables are the port's.** `g_ZFuncTable`, `g_SrcBlendTable`
    and `g_DstBlendTable`, eight dwords each, against the arrays of the same
    names in `draw_order.ts`.
  * **The pass state is where the port says.** `TranslatePvr2StateToD3D`
    sends `(tsp & 0x180000) != 0x80000` as state 0x0F, `ALPHATESTENABLE`;
    `RenderFlushCommandList` turns 0x1B, `ALPHABLENDENABLE`, on before the
    translucent pass and `RenderBeginCommandList` turns it off when the list
    opens; `RenderInitStates` sets `ALPHAREF` to the port's `ALPHA_REF` under
    `ALPHAFUNC` `GREATEREQUAL`. `WalkMeshChainAndDraw` selects the pass with
    the same mask, and lowers the sort depth to a skipped mesh's z only when
    it is less -- a minimum.
  * **Nearest first.** `RenderInitStates` installs `VIEW` = diag(1, 1, -1, 1)
    and `BuildPerspectiveProjection` builds a left-handed matrix (`_34` = 1),
    so eye z on the matrix stack is negative in front of the camera;
    `RenderCommandCompare` subtracts `a` from `b` and returns -1 on a negative
    difference, which is descending. Together: the command whose least z --
    its farthest point -- is greatest goes first.
  * **The corpus premise.** Every mesh in `pol/` has ISP bit 26 clear (depth
    write on) and compare mode 4 (`LESSEQUAL`). The port maps any value; the
    docs and `draw_order.ts` say "no mesh disables the depth write", and this
    is what keeps that sentence true.
  * **The bundle carries what the sort reads**, when one is present: every
    triangle primitive of every stage glTF has `hod2_model` and a four-number
    `hod2_sphere`. Without a bundle that part is reported as not run; the rest
    still asserts.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import container, nl1  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402
from hod2lib.lz import LZError  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PORT = ROOT / "web" / "src" / "render" / "draw_order.ts"

G_SRC_BLEND_TABLE = 0x00598AB0
G_DST_BLEND_TABLE = 0x00598AD0
G_ZFUNC_TABLE = 0x00598B00
VIEW_MATRIX = 0x00598B38

#: `(address, bytes, what they are)`. Each is an instruction sequence read off
#: the disassembly; a different build or a wrong reading fails here.
SEQUENCES = [
    (0x004A786B, "0f95c1516a0f",
     "TranslatePvr2StateToD3D: SETNZ CL; PUSH ECX; PUSH 0x0F "
     "(ALPHATESTENABLE = pass is translucent)"),
    (0x004A785B, "81e200001800",
     "TranslatePvr2StateToD3D: AND EDX, 0x180000 (the pass bits)"),
    (0x004A7865, "81fa00000800",
     "TranslatePvr2StateToD3D: CMP EDX, 0x80000 (the opaque value)"),
    (0x004A8905, "6a016a1b",
     "RenderFlushCommandList: PUSH 1; PUSH 0x1B (ALPHABLENDENABLE on)"),
    (0x004A7A1E, "6a0024fc6a1b",
     "RenderBeginCommandList: PUSH 0; AND AL, 0xFC; PUSH 0x1B "
     "(ALPHABLENDENABLE off; the AND aligns the queue pointer)"),
    (0x004A7666, "6a076a19",
     "RenderInitStates: PUSH 7; PUSH 0x19 (ALPHAFUNC GREATEREQUAL)"),
    (0x004A773E, "68388b59006a02",
     "RenderInitStates: PUSH 0x00598B38; PUSH 2 (SetTransform VIEW)"),
    (0x004A7F69, "8b45082500001800" "3d00000800",
     "WalkMeshChainAndDraw: the same pass selector"),
    (0x004A7FBE, "d90538797e00d8d9dfe0f6c441",
     "WalkMeshChainAndDraw: FLD depth; FCOMP z; TEST AH, 0x41 "
     "(keep the stored depth unless z is less: a minimum)"),
    (0x004A8A3C, "d94204d86104",
     "RenderCommandCompare: FLD [b+4]; FSUB [a+4] (b - a: descending)"),
    (0x004ABD76, "c74424300000803f",
     "BuildPerspectiveProjection: _34 = 1.0 (left-handed)"),
]
#: `RenderInitStates`' `PUSH ref; PUSH 0x18`; the ref byte is the port's.
ALPHAREF_PUSH = 0x004A7657


class Failures:
    def __init__(self) -> None:
        self.n = 0
        self.asserted = 0

    def check(self, ok: bool, msg: str) -> None:
        self.asserted += 1
        if ok:
            return
        self.n += 1
        print(f"  FAIL {msg}")


def port_array(src: str, name: str) -> list[int] | None:
    m = re.search(rf"export const {name} = \[([^\]]*)\]", src)
    if not m:
        return None
    return [int(x.strip(), 0) for x in m.group(1).split(",") if x.strip()]


def port_const(src: str, name: str) -> int | None:
    m = re.search(rf"export const {name} = (0x[0-9a-fA-F]+|\d+);", src)
    return int(m.group(1), 0) if m else None


def corpus(game_dir: Path) -> tuple[int, int, int]:
    """`(meshes, depth-write disabled, compare mode not 4)` over `pol/`."""
    n = nozw = notle = 0
    for p in sorted((game_dir / "pol").glob("*.bin")):
        try:
            models = nl1.parse_container(container.load(p.read_bytes()))
        except (nl1.NL1Error, LZError, ValueError, IndexError, struct.error):
            # Not every file in pol/ is a model container; the count below
            # is what says the walk saw the whole corpus.
            continue
        for m in models:
            if m is None:
                continue
            for me in m.meshes:
                n += 1
                if me.isp_tsp & (1 << 26):
                    nozw += 1
                if (me.isp_tsp >> 29) & 7 != 4:
                    notle += 1
    return n, nozw, notle


def glb_json(path: Path) -> dict:
    b = path.read_bytes()
    ln = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + ln])


def builder_digest(bd: Path) -> str | None:
    """The `gltf.ts` digest the bundle's exporter stamped into its manifest."""
    m = json.loads((bd / "manifest.json").read_text())
    return ((m.get("builder") or {}).get("files") or {}).get("gltf.ts")


def tree_digest() -> str | None:
    """This tree's `gltf.ts` digest, from the generated `builder_hash.ts`."""
    src = (ROOT / "web" / "src" / "bundle" / "builder_hash.ts").read_text()
    m = re.search(r'"gltf\.ts": "([0-9a-f]+)"', src)
    return m.group(1) if m else None


def bundle_dir() -> Path | None:
    env = os.environ.get("HOTD2_BUNDLE")
    for d in ([Path(env)] if env else []) + [ROOT / "extract" / "player"]:
        if (d / "manifest.json").exists():
            return d
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    tables = ExeTables(str(args.game_dir / "Hod2.exe"))
    raw = (args.game_dir / "Hod2.exe").read_bytes()
    src = PORT.read_text()
    fail = Failures()

    def at(va: int) -> int:
        r = tables._v2r(va)
        assert r is not None, hex(va)
        return r

    def dwords(va: int, n: int) -> list[int]:
        return list(struct.unpack_from(f"<{n}I", raw, at(va)))

    # -- the tables ----------------------------------------------------------
    for va, name in ((G_ZFUNC_TABLE, "G_ZFUNC_TABLE"),
                     (G_SRC_BLEND_TABLE, "G_SRC_BLEND_TABLE"),
                     (G_DST_BLEND_TABLE, "G_DST_BLEND_TABLE")):
        exe = dwords(va, 8)
        port = port_array(src, name)
        fail.check(port == exe, f"{name}: EXE {exe} at {va:#010x}, port {port}")
    print(f"  tables: g_ZFuncTable {dwords(G_ZFUNC_TABLE, 8)}, "
          f"g_SrcBlendTable {dwords(G_SRC_BLEND_TABLE, 8)}, "
          f"g_DstBlendTable {dwords(G_DST_BLEND_TABLE, 8)}")

    # -- the instructions ------------------------------------------------------
    for va, hexbytes, what in SEQUENCES:
        want = bytes.fromhex(hexbytes)
        got = raw[at(va):at(va) + len(want)]
        fail.check(got == want, f"{va:#010x} {what}: {got.hex()}")
    ref = raw[at(ALPHAREF_PUSH):at(ALPHAREF_PUSH) + 4]
    fail.check(ref[0] == 0x6A and ref[2:] == bytes([0x6A, 0x18]),
               f"{ALPHAREF_PUSH:#010x} is not PUSH imm8; PUSH 0x18: {ref.hex()}")
    fail.check(port_const(src, "ALPHA_REF") == ref[1],
               f"ALPHA_REF: EXE {ref[1]}, port {port_const(src, 'ALPHA_REF')}")
    print(f"  instructions: {len(SEQUENCES)} sequences, ALPHAREF {ref[1]}")

    view = struct.unpack_from("<16f", raw, at(VIEW_MATRIX))
    fail.check(view == (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1),
               f"the VIEW matrix at {VIEW_MATRIX:#010x} is {view}")
    print("  eye space: VIEW = diag(1, 1, -1, 1) under a left-handed "
          "projection -- negative z is in front, so descending is nearest "
          "first")

    # -- the corpus ------------------------------------------------------------
    n, nozw, notle = corpus(args.game_dir)
    fail.check(n > 80000, f"only {n} meshes parsed from pol/")
    fail.check(nozw == 0, f"{nozw} of {n} meshes disable the depth write")
    fail.check(notle == 0, f"{notle} of {n} meshes compare with a mode other "
                           "than 4 (LESSEQUAL)")
    print(f"  corpus: {n} meshes, {nozw} with the depth write off, {notle} "
          "with a compare mode other than LESSEQUAL")

    # -- the bundle ------------------------------------------------------------
    bd = bundle_dir()
    stale = bd is not None and builder_digest(bd) != tree_digest()
    if bd is None:
        print("  bundle: none found -- the per-primitive extras were NOT "
              "checked (export one, or set HOTD2_BUNDLE)")
    elif stale:
        # A stale bundle warns and does not refuse (L24): it was written by
        # an older glTF writer, which is a thing to re-export, not a failure
        # of the tree. It is said, so that it cannot read as a pass.
        print(f"  bundle: {bd} was written by a different gltf.ts than this "
              "tree's -- the per-primitive extras were NOT checked; "
              "re-export it")
    else:
        prims = bad = 0
        for glb in sorted(bd.glob("stage*/stage*.glb")):
            doc = glb_json(glb)
            for mesh in doc.get("meshes", []):
                for pr in mesh["primitives"]:
                    if "material" not in pr:
                        continue          # collision: no material, no draw
                    prims += 1
                    ex = pr.get("extras") or {}
                    s = ex.get("hod2_sphere")
                    if (not isinstance(ex.get("hod2_model"), int)
                            or not isinstance(s, list) or len(s) != 4):
                        bad += 1
        fail.check(prims > 0, f"no primitives in {bd}")
        fail.check(bad == 0, f"{bad} of {prims} primitives in {bd} lack "
                             "hod2_model / hod2_sphere -- re-export")
        print(f"  bundle: {prims} primitives in {bd}, {bad} without "
              "hod2_model and hod2_sphere")

    if fail.n:
        print(f"verify_draw_order: {fail.n} of {fail.asserted} checks FAILED")
        return 1
    print(f"verify_draw_order: all {fail.asserted} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
