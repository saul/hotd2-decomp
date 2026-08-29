#!/usr/bin/env python3
"""
Replay the *binary's own* NL1 walkers over every model in the game.

The game contains two independent walkers over a model's mesh chain:

    FUN_00419270   load-time strip fixup (culling parity)
    WalkMeshChainAndDraw (0x004A7EF0)   the renderer

Both use exactly the same three rules and nothing else:

    * a chain word with bit 31 set is a mesh header, 0x50 bytes;
      skip its geometry with (mesh_data_size & ~3)
    * a chain word with bit 31 clear is a strip header, 8 bytes:
      {flags, count}; count is a triangle count when flags & 8
    * a vertex record is 8 bytes when bit 0 of its first dword is clear
      (a back-reference) and 32 bytes when it is set

There is no other stride and no other test -- in particular neither walker
consults parameter_control, the shading mode, or any 16-bit-UV flag.

So if that walk lands exactly on each mesh's declared end for every model in
the game, the model data contains no alternate vertex layout, and the
parameter_control bit 0 that PowerVR2 documents as "16-bit UV" cannot be
changing the stride here.

A wrong stride desynchronises a linear walk immediately, so this is a metric
that collapses: it is not "it did not crash".

Usage:
    python3 tools/verify_walk.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import struct
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import container as C  # noqa: E402


class Desync(Exception):
    pass


def walk_model(b: bytes, off: int, stats: Counter) -> None:
    """FUN_00419270's walk, verbatim, with every implied invariant asserted."""
    u32 = lambda p: struct.unpack_from("<I", b, p)[0]

    pos = off + 0x18
    while True:
        if pos + 4 > len(b):
            raise Desync(f"ran off the end at {pos:#x}")
        w = u32(pos)
        if w == 0:
            return

        if w & 0x80000000:
            # mesh header
            size = u32(pos + 0x4C)
            stats["meshes"] += 1
            if size & 3:
                stats["mesh_data_size not 4-aligned"] += 1
            if w & 1:
                stats["meshes with parameter_control bit 0 (docs: 16-bit UV)"] += 1
            geom = pos + 0x50
            end = geom + (size & ~3)
            if end > len(b):
                raise Desync(f"mesh at {pos:#x} declares {size} bytes past EOF")
            # walk the geometry the way the binary does and require it to
            # land exactly on `end`
            p = geom
            while p < end:
                if p + 8 > end:
                    raise Desync(f"strip header straddles mesh end at {p:#x}")
                flags, count = struct.unpack_from("<2I", b, p)
                if flags & 0x80000000:
                    raise Desync(f"mesh header inside geometry at {p:#x}")
                n = count * 3 if (flags & 8) else count
                stats["strips"] += 1
                stats[f"strip culling {flags & 3}"] += 1
                if flags & 0x100:
                    stats["strips with env-map flag (bit 8)"] += 1
                p += 8
                for _ in range(n):
                    if p + 4 > end:
                        raise Desync(f"vertex straddles mesh end at {p:#x}")
                    w0 = u32(p)
                    if w0 & 1:
                        stats["vertices"] += 1
                        p += 32
                    else:
                        stats["back-references"] += 1
                        # cross-check the old heuristic
                        if (w0 >> 20) != 0x5FF:
                            stats["back-ref NOT matching (w>>20)==0x5FF"] += 1
                        p += 8
            if p != end:
                raise Desync(
                    f"geometry walk ended at {p:#x}, mesh declares {end:#x}"
                )
            pos = end
        else:
            raise Desync(f"strip header at chain level at {pos:#x}: {w:#010x}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    files = sorted((game / "pol").glob("*.bin"))

    stats = Counter()
    problems: list[str] = []
    models = 0

    for path in files:
        if path.name.startswith("pol_"):
            continue
        try:
            c = C.load(path.read_bytes())
        except Exception as e:
            problems.append(f"{path.name}: container: {e}")
            continue
        if c.kind not in (C.RAW, C.COMPRESSED) or not c.models:
            continue
        for i, (start, end) in enumerate(c.models):
            blob = c.data[start:end]
            if len(blob) < 0x18:
                continue
            obj, flag = struct.unpack_from("<2I", blob, 0)
            if obj not in (0, 1) or not (flag & 1) or flag & ~0x1F:
                continue
            models += 1
            if flag & 0x04:
                stats["models with globalFlag bit 2 (env map)"] += 1
            if flag & 0x10:
                stats["models with globalFlag bit 4 (bump)"] += 1
            try:
                walk_model(blob, 0, stats)
            except Desync as e:
                stats["DESYNC"] += 1
                problems.append(f"{path.name}[{i}]: {e}")

    print(f"models walked : {models}")
    for k, v in sorted(stats.items()):
        print(f"  {k:<52} {v}")
    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems[:40]:
            print("  " + p)
        return 1
    print("clean: the binary's walk lands exactly on every declared mesh end")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
