#!/usr/bin/env python3
"""No exporter may swallow a failure silently, and the schema digest is current.

Two checks, both about the exporter telling the truth about what it produced.

Thirty sites under `tools/hod2lib/` and `tools/export_*.py` answer an
exception with an empty result -- `return {}`, `return []`,
`cache[stem] = ([], None)`. That is the right behaviour: an install missing one
`pol/` file should still produce a bundle, and refusing to export a stage
because one prop model will not parse would be worse than exporting without it.

What was wrong is that they were **silent**. A parser regression anywhere under
`hod2lib` produced a valid bundle with zero characters, exit code 0 and no
message; the player then drew an empty stage, which looks exactly like a
gameplay bug. `docs/PLAN.md` P6 named "a silent exporter regression" as the
thing nothing in this repository could catch. F16 of docs/REVIEW-2026-09-03.md
is the same finding from the other side.

So this is the rule that keeps them honest: **a broad `except` in an exporter
must record what it gave up**, through `hod2lib.degraded.note`. The count then
reaches `manifest.json` and `export_player.py`'s exit code.

Fixing the thirty instances without this check would have been a fix with a
shelf life.

The second check is what makes the bundle's schema digest work at all.
``manifest.json`` carries a hash of the declarations in `web/src/bundle/*.ts`
and the client compares it against `web/src/bundle/schema_hash.ts`, which is
generated from the same sources and committed. A generated file that is
regenerated only when someone remembers is `BUNDLE_FORMAT` again -- so this
re-derives it and fails when the committed copy is stale. **That is what makes
the digest impossible to forget**: the digest catches a stale bundle, and this
catches a stale digest.

Run from anywhere; exit code is non-zero when a check fails.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "tools" / "hod2lib"
sys.path.insert(0, str(ROOT / "tools"))

from hod2lib import schema                                     # noqa: E402

#: Only the exporters. `tools/verify_*.py`, `tools/blender_*.py` and the other
#: one-shot readers are diagnostics -- they print what they found and nobody
#: builds a bundle out of them, so a broad `except` there costs a line of
#: output rather than a stage's worth of characters.
EXPORTERS = ["tools/export_player.py", "tools/export_level.py"]

#: `except Exception:` / `except Exception as exc:` / `except (A, B):` -- any
#: handler broad enough to catch a bug rather than a condition.
BROAD = re.compile(r"^(\s*)except\s+(Exception|BaseException)\b[^:]*:")
#: How far past the handler to look for the record. A handler that needs more
#: than this before it says anything is doing too much.
WINDOW = 6


def sources() -> list[Path]:
    out = [ROOT / p for p in EXPORTERS]
    out += sorted(p for p in LIB.rglob("*.py") if p.name != "degraded.py")
    return [p for p in out if p.is_file()]


def check_schema_hash() -> list[str]:
    """`web/src/bundle/schema_hash.ts` is what its sources say it should be."""
    path = ROOT / schema.SCHEMA_DIR / schema.GENERATED
    rel = path.relative_to(ROOT)
    want = schema.client_source(ROOT)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return []
    if have is None:
        return [f"{rel}: missing -- it is generated, and nothing generated it"]
    moved = [n for n, d in schema.file_digests(ROOT).items()
             if f'"{n}": "{d}"' not in have]
    return [f"{rel}: stale"
            + (f" -- {', '.join(moved)} changed" if moved else "")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # Accepted and unused: the verifier suite passes it to every tools/verify_*
    ap.add_argument("--game-dir", default=None, help=argparse.SUPPRESS)
    ap.parse_args()

    bad: list[str] = []
    total = 0
    for path in sources():
        lines = path.read_text(encoding="utf-8").splitlines()
        rel = path.relative_to(ROOT)
        for i, line in enumerate(lines):
            m = BROAD.match(line)
            if not m:
                continue
            total += 1
            body = "\n".join(lines[i + 1:i + 1 + WINDOW])
            if "degraded.note(" in body:
                continue
            # A handler that re-raises, or that turns the failure into a
            # SystemExit, is not swallowing anything.
            if re.search(r"^\s*(raise\b|return\s+\w+\.fail\()", body, re.M):
                continue
            bad.append(f"{rel}:{i + 1}: {line.strip()} -- says nothing")

    stale = check_schema_hash()

    print("exporters -- what a swallowed failure has to say\n")
    print(f"  {total} broad handlers, {len(bad)} of them silent"
          f" (baseline 0)\n")
    if bad:
        for b in bad:
            print(f"FAIL {b}")
        print(f"\n{len(bad)} failed. Record the loss with "
              f"`degraded.note(what, lost, exc)` -- see tools/hod2lib/"
              f"degraded.py -- or narrow the `except` to the condition you "
              f"actually mean.")
        return 1
    print("clean")

    print("\nthe schema digest the client compiles against\n")
    if stale:
        for m in stale:
            print(f"FAIL {m}")
        print("\nRegenerate it and commit it with the declaration change that "
              "moved it:\n  python3 tools/regen_schema_hash.py\n"
              "`tools/export_player.py` does the same thing on every run.")
        return 1
    print(f"  {len(schema.file_digests(ROOT))} declaration files, digest "
          f"{schema.schema_hash(ROOT)[:16]}...\n")
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
