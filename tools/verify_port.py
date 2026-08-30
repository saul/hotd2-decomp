#!/usr/bin/env python3
"""Check the browser player's `game/` tree against the Ghidra annotations.

The porting rules in docs/PLAYER_ARCHITECTURE.md are only worth having if they
are enforced, and they are cheaply checkable because both sides are text:

  1. every `FUN_` address named in a `game/` doc comment exists in
     ghidra/annotations/functions.tsv, under the same name;
  2. the coverage -- how much of the gameplay code has a port -- is a number;
  3. every `[diverges]` tag is gathered into one list;
  4. the class modules line up with the class table in docs/formats/spawns.md;
  5. and the three ways state can escape a save snapshot are grepped for:
     three.js in `game/`, `Math.random(`, and `export let` in globals.ts.

Exit code is non-zero when a check fails. Run from anywhere.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "web" / "src" / "game"
FUNCS = ROOT / "ghidra" / "annotations" / "functions.tsv"
SPAWNS = ROOT / "docs" / "formats" / "spawns.md"

# `/** `Name` -- `FUN_00455DE0`. ... */` in either dash flavour.
DOC = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`\s*[-—]+\s*`(FUN_[0-9A-Fa-f]{8})`")
ANY_FUN = re.compile(r"`(FUN_[0-9A-Fa-f]{8})`")
DIVERGES = re.compile(r"\[diverges\]")

failures: list[str] = []
notes: list[str] = []


def annotations() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in FUNCS.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        out[parts[0].lower()] = parts[1]
    return out


def game_files() -> list[Path]:
    return sorted(p for p in GAME.rglob("*.ts"))


def check_names(named: dict[str, str]) -> set[str]:
    """Rule 1: one exe function, one TS function, same name."""
    ported: set[str] = set()
    seen_addrs: set[str] = set()
    for path in game_files():
        text = path.read_text()
        rel = path.relative_to(ROOT)
        for name, fun in DOC.findall(text):
            addr = fun[4:].lower()
            seen_addrs.add(addr)
            real = named.get(addr)
            if real is None:
                failures.append(f"{rel}: {fun} is not in functions.tsv")
            elif real != name:
                failures.append(
                    f"{rel}: doc says `{name}` for {fun}, "
                    f"functions.tsv says `{real}`")
            else:
                ported.add(real)
                # The name must actually be declared, or the doc is decoration.
                if not re.search(rf"\b(function|const)\s+{re.escape(name)}\b", text):
                    failures.append(
                        f"{rel}: documents `{name}` ({fun}) but declares no "
                        f"such function")
        # An address with no name in front of it is a citation the check above
        # cannot verify, so say so rather than let it rot.
        for fun in ANY_FUN.findall(text):
            if fun[4:].lower() not in seen_addrs and fun[4:].lower() not in named:
                failures.append(f"{rel}: {fun} is not in functions.tsv")
    return ported


def check_coverage(named: dict[str, str], ported: set[str]) -> None:
    """Rule 2: report the coverage over the gameplay address ranges."""
    # The enemy, camera-director, player-damage and thrower code. Taken from
    # where the ported functions actually live, so the denominator is the code
    # this port is trying to cover rather than the whole binary.
    ranges = [(0x00402800, 0x00403E00),   # the camera director
              (0x00408C00, 0x0040B000),   # slots, ranking, class table
              (0x00415200, 0x00415500),   # player damage
              (0x00449000, 0x00451000),   # class 0x31
              (0x00452C00, 0x0045E000)]   # class 0x30
    total = 0
    for addr, name in named.items():
        a = int(addr, 16)
        if any(lo <= a < hi for lo, hi in ranges):
            total += 1
    notes.append(f"coverage: {len(ported)} of {total} annotated gameplay "
                 f"functions have a port "
                 f"({100 * len(ported) // max(1, total)}%)")


def check_divergences() -> None:
    """Rule 4: the places the port is knowingly wrong, in one list."""
    found: list[str] = []
    for path in game_files():
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if DIVERGES.search(line):
                found.append(f"{path.relative_to(ROOT)}:{n}")
    notes.append(f"divergences: {len(found)} declared")
    for f in found:
        notes.append(f"  {f}")


def check_classes() -> None:
    """Which spawn classes have behaviour, which are simply unread."""
    have = {d.name for d in GAME.iterdir()
            if d.is_dir() and d.name.startswith("class")}
    ported = {int(n[5:], 16) for n in have if n[5:].isalnum()}
    table = re.findall(r"^\| `0x([0-9A-Fa-f]{2})` \| [^|]+ \| (\d+) \|",
                       SPAWNS.read_text(), re.M)
    if not table:
        failures.append("spawns.md: could not read the class table")
        return
    known = [(int(c, 16), int(n)) for c, n in table]
    covered = sum(n for c, n in known if c in ported)
    total = sum(n for _, n in known)
    notes.append(f"classes: {len(ported)} of {len(known)} read classes have a "
                 f"module, covering {covered} of {total} placements")
    for c, n in sorted(known, key=lambda x: -x[1])[:6]:
        if c not in ported:
            notes.append(f"  unported: 0x{c:02X}, {n} placements")
    for c in sorted(ported):
        if c not in {k for k, _ in known}:
            failures.append(f"game/class{c:02x}/ has no row in spawns.md")


def check_snapshot_rules() -> None:
    """The three ways state escapes a save. Each has one honest spelling."""
    for path in game_files():
        rel = path.relative_to(ROOT)
        text = path.read_text()
        if re.search(r'from\s+"three"', text):
            failures.append(f"{rel}: imports three -- game/ must run headless")
        if "Math.random(" in text:
            failures.append(
                f"{rel}: Math.random() -- draw from the world Rng, or a "
                f"snapshot cannot be replayed")
    globals_ts = GAME / "globals.ts"
    if re.search(r"^export let ", globals_ts.read_text(), re.M):
        failures.append("game/globals.ts: `export let` cannot be enumerated, "
                        "so it cannot be snapshotted -- put it in `G`")


def main() -> int:
    if not GAME.is_dir():
        print(f"no {GAME}", file=sys.stderr)
        return 2
    named = annotations()
    ported = check_names(named)
    check_coverage(named, ported)
    check_divergences()
    check_classes()
    check_snapshot_rules()

    for n in notes:
        print(n)
    print()
    if failures:
        for f in failures:
            print(f"FAIL {f}")
        print(f"\n{len(failures)} failed")
        return 1
    print(f"{len(ported)} ported functions check out against functions.tsv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
