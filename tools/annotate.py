#!/usr/bin/env python3
"""Upsert a row into ghidra/annotations/{functions,globals}.tsv.

Appending blind has now put a duplicate address in `functions.tsv` twice in one
session -- `ThrownWeaponFlyToTarget` and `RankEnemiesByDistance` -- because the
address was already named and I did not look. `verify_annotations.py` catches
it afterwards; this stops it happening.

Rules, which are the ones the decomp skill states:

* an address already present keeps its **name** unless `--rename` is given,
  because the port cites that name and a silent rename breaks it;
* the comment is replaced, because that is what improves as more is read;
* **a new row is inserted in address order**, not appended. The file used to
  be append-only, and two workstreams appending at the tail is where every TSV
  merge conflict came from: unrelated rows, same last line, every time. Sorted
  insertion puts them in different parts of the file. `ExportAnnotations.java`
  holds the same invariant from the other end.

    python3 tools/annotate.py functions 004090b0 RankEnemiesByDistance "..."
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("table", choices=("functions", "globals"))
    ap.add_argument("address")
    ap.add_argument("name")
    ap.add_argument("comment", nargs="?", default="")
    ap.add_argument("--rename", action="store_true",
                    help="allow changing the name of an address already there")
    args = ap.parse_args()

    # One row is one line, and one line is three tab-separated fields. A
    # comment pasted in with newlines in it silently splits into rows whose
    # first field is prose, which breaks `verify_annotations.py`, the exporter
    # and the address-ordered insert below all at once -- and it looks fine in
    # the tool's own output, because the write succeeded. Refuse it here
    # rather than let it reach the file both workstreams share.
    for field, text in (("name", args.name), ("comment", args.comment)):
        bad = [c for c in ("\n", "\r", "\t") if c in text]
        if bad:
            print(f"{field} contains {' and '.join(repr(c) for c in bad)}; "
                  f"a TSV row is one line -- write it as running prose",
                  file=sys.stderr)
            return 1

    path = ROOT / "ghidra" / "annotations" / f"{args.table}.tsv"
    addr = args.address.lower().lstrip("0x").rjust(8, "0")
    lines = path.read_text().split("\n")

    for i, line in enumerate(lines):
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if parts[0].lower() != addr:
            continue
        if parts[1] != args.name and not args.rename:
            print(f"0x{addr.upper()} is already `{parts[1]}`; pass --rename to "
                  f"change it, and update every citation if you do",
                  file=sys.stderr)
            return 1
        lines[i] = "\t".join([parts[0], args.name, args.comment])
        path.write_text("\n".join(lines))
        print(f"updated 0x{addr.upper()} `{args.name}`")
        return 0

    # New: insert in address order. The header block and its blank line stay
    # where they are; the row goes before the first data row with a higher
    # address, or at the end when there is none.
    row = "\t".join([addr, args.name, args.comment])
    while lines and not lines[-1]:
        lines.pop()
    here = int(addr, 16)
    at = None
    for i, line in enumerate(lines):
        if not line or line.startswith("#"):
            continue
        if int(line.split("\t")[0], 16) > here:
            at = i
            break
    if at is None:
        lines.append(row)
    else:
        lines.insert(at, row)
    path.write_text("\n".join(lines) + "\n")
    print(f"added 0x{addr.upper()} `{args.name}`")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
