#!/usr/bin/env python3
"""
Verify the LZ decompressor and container parser against every asset.

Acceptance criteria from docs/formats/lz.md:
  1. every compressed file decompresses to exactly dword0 bytes
  2. every decompressed pol/ file parses as a valid container

Usage:
    python3 tools/verify_lz.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import container as C  # noqa: E402
from hod2lib.lz import LZError  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    kinds: Counter[str] = Counter()
    failures: list[tuple[str, str]] = []
    total_in = total_out = 0
    models = 0
    no_model: list[str] = []

    for dirname in ("pol", "tex"):
        d = game / dirname
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.bin")):
            raw = path.read_bytes()
            rel = f"{dirname}/{path.name}"
            try:
                c = C.load(raw)
            except LZError as e:
                kinds["FAILED"] += 1
                failures.append((rel, str(e)))
                continue

            kinds[f"{dirname}: {c.kind}"] += 1

            if c.kind == C.COMPRESSED:
                total_in += len(raw)
                total_out += len(c.data)

            if c.kind in (C.RAW, C.COMPRESSED):
                models += c.model_count
                if dirname == "pol" and c.model_count == 0:
                    no_model.append(rel)

    print("Classification")
    for k, v in sorted(kinds.items()):
        print(f"  {k:28} {v}")

    if total_in:
        print(f"\nCompression")
        print(f"  bytes in  {total_in:>12,}")
        print(f"  bytes out {total_out:>12,}   ratio {total_out / total_in:.2f}x")

    print(f"\nModels parsed: {models}")

    if no_model:
        print(f"\npol/ containers with zero models ({len(no_model)}):")
        for r in no_model[:15]:
            print(f"  {r}")

    if failures:
        print(f"\nFailures ({len(failures)}):")
        for rel, err in failures[:20]:
            print(f"  {rel}: {err}")
        return 1

    print("\nNo decompression failures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
