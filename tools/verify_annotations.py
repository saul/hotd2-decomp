#!/usr/bin/env python3
"""Check ghidra/annotations/*.tsv against the real executable.

The annotations are the committed source of truth for the Ghidra database, so
a typo in an address is a silent corruption: `ApplyAnnotations` would happily
name the wrong thing. This checks every row against the EXE's own section
table before anyone runs it.

What is verified:

* every address resolves to a real section of Hod2.exe;
* function addresses land in `.text`, and globals land in a data section --
  except inline jump tables, which MSVC emits inside the function body and
  which are therefore reported rather than rejected;
* no address is listed twice, and no name is used twice;
* the file parses as TSV with at least an address and a name per row.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import stage as stagelib  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ANNOT = ROOT / "ghidra" / "annotations"


def rows(path: Path):
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = [c.strip() for c in line.split("\t")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            yield n, None, None, None, "malformed row"
            continue
        try:
            va = int(parts[0], 16)
        except ValueError:
            yield n, None, parts[1], None, f"bad address {parts[0]!r}"
            continue
        yield n, va, parts[1], (parts[2] if len(parts) > 2 else ""), None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / "THE HOUSE OF THE DEAD 2")
    args = ap.parse_args()

    tables = stagelib.get_tables(args.game_dir)
    problems: list[str] = []

    # Section map straight out of the PE headers, so the check is against the
    # binary rather than against another copy of my own assumptions.
    sections = []
    for name, sva, vs, ra, rs in tables._sections:
        lo = 0x00400000 + sva
        sections.append((name, lo, lo + max(vs, rs)))
    print(f"{len(sections)} sections in Hod2.exe")
    for name, lo, hi in sections:
        print(f"  {name:<10} {lo:#010x}..{hi:#010x}")

    for fname, want_exec in (("functions.tsv", True), ("globals.tsv", False)):
        path = ANNOT / fname
        if not path.is_file():
            problems.append(f"{fname}: missing")
            continue
        seen_va: dict[int, str] = {}
        seen_name: dict[str, int] = {}
        inline_tables: list[str] = []
        count = 0
        for lineno, va, name, _comment, err in rows(path):
            if err:
                problems.append(f"{fname}:{lineno}: {err}")
                continue
            count += 1
            hit = next((s for s in sections if s[1] <= va < s[2]), None)
            if hit is None:
                problems.append(
                    f"{fname}:{lineno}: {name} at {va:#010x} is in no section")
                continue
            # .text is the only executable section in this build.
            in_text = hit[0].rstrip("\x00") == ".text"
            if want_exec and not in_text:
                problems.append(f"{fname}:{lineno}: {name} at {va:#010x} is in "
                                f"{hit[0]!r}, not .text")
            if not want_exec and in_text:
                # Not a problem: MSVC emits a switch's jump table inside the
                # function body, so a table this project has named legitimately
                # lives in .text. Reported so the list stays visible.
                inline_tables.append(f"{name} at {va:#010x}")
            if va in seen_va:
                problems.append(f"{fname}:{lineno}: {va:#010x} already used by "
                                f"{seen_va[va]}")
            seen_va[va] = name
            if name in seen_name:
                problems.append(f"{fname}:{lineno}: name {name!r} already used "
                                f"at {seen_name[name]:#010x}")
            seen_name[name] = va
        print(f"\n{fname}: {count} rows, {len(seen_va)} distinct addresses")
        if inline_tables:
            print(f"  {len(inline_tables)} inline jump tables inside .text "
                  f"(expected -- MSVC emits them in the function body):")
            for t in inline_tables:
                print(f"    {t}")

    print()
    if problems:
        for p in problems:
            print("  " + p)
        print(f"\n{len(problems)} problems")
        return 1
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
