#!/usr/bin/env python3
"""Check that the browser player's opcode statuses agree with the docs.

The player used to hold its "how far is this opcode honoured" answers in a
table parallel to the interpreter's dispatch switch, and they drifted:
``enable_rain`` was implemented while the script tree struck it through, and
``set_skippable_region`` was marked dead after it had been wired up.

That table is gone. The status now lives on the same object as the handler, in
``Walker.OPS``, assembled from ``web/src/script/ops/``, so the code cannot disagree with
itself. What *can* still drift is the human-readable copy in
``docs/PLAYER_PROGRESS.md``, and this checks that one.

It is a text comparison, deliberately: parsing TypeScript properly would be a
larger dependency than the problem, and the two shapes being compared are both
simple and both hand-maintained.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPS_DIR = ROOT / "web" / "src" / "script" / "ops"
DOC = ROOT / "docs" / "PLAYER_PROGRESS.md"

#: The doc writes `**done**` for done and plain or italic text otherwise.
DOC_STATUS = re.compile(r"\*{0,2}_{0,2}(done|approx|tracked|shown|none|n/a)_{0,2}\*{0,2}$")


def walker_statuses() -> dict[int, str]:
    """`{opcode: status}` from the modules that make up `Walker.OPS`."""
    out: dict[int, str] = {}
    files = sorted(p for p in OPS_DIR.glob("*.ts") if p.name != "index.ts")
    if not files:
        raise SystemExit(f"verify_player_ops: no op modules under {OPS_DIR}; "
                         "the table moved and this script needs updating")
    for path in files:
        body = path.read_text()
        for m in re.finditer(
                r"0x([0-9a-f]{2}):\s*\{\s*(?://[^\n]*\n\s*)*"
                r"(?:[^\n]*\n\s*)??status:\s*\"(\w+)\"", body):
            op = int(m.group(1), 16)
            if op in out:
                raise SystemExit(f"verify_player_ops: opcode 0x{op:02X} is "
                                 f"registered twice; the last one silently wins")
            out[op] = m.group(2)
    return out


def doc_statuses() -> dict[int, str]:
    """`{opcode: status}` from the per-opcode table in PLAYER_PROGRESS.md."""
    out: dict[int, str] = {}
    for line in DOC.read_text().splitlines():
        if not line.startswith("| `"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 4:
            continue
        op = re.fullmatch(r"`([0-9A-F]{2})`", cells[0])
        st = DOC_STATUS.fullmatch(cells[3])
        if op and st:
            out[int(op.group(1), 16)] = st.group(1)
    if not out:
        raise SystemExit("verify_player_ops: no opcode rows found in the doc")
    return out


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    code = walker_statuses()
    doc = doc_statuses()

    problems: list[str] = []
    for op in sorted(set(code) | set(doc)):
        # An opcode absent from Walker.OPS defaults to "shown"; the doc writes
        # "n/a" where an opcode has no meaningful client behaviour at all.
        a = code.get(op, "shown")
        b = doc.get(op)
        if b is None:
            continue                      # not every opcode has a doc row
        if b == "n/a":
            b = "none"
        if a != b:
            problems.append(f"  0x{op:02X}: walker says {a!r}, "
                            f"PLAYER_PROGRESS.md says {b!r}")

    print(f"player opcode statuses: {len(code)} declared in Walker.OPS, "
          f"{len(doc)} rows in PLAYER_PROGRESS.md")
    if problems:
        print("\ndisagreements:")
        print("\n".join(problems))
        return 1
    print("clean: the doc matches the implementation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
