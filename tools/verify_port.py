#!/usr/bin/env python3
"""Check the browser player's `game/` tree against the Ghidra annotations.

The porting rules in docs/PLAYER_ARCHITECTURE.md are only worth having if they
are enforced, and they are cheaply checkable because both sides are text:

  1. every `FUN_` address named in a `game/` doc comment exists in
     ghidra/annotations/functions.tsv, under the same name, and every `0x00…`
     address exists in globals.tsv under the name beside it;
  2. the coverage -- how much of the gameplay code has a port -- is a number;
  3. every `[diverges]` tag is gathered into one list;
  4. the class modules line up with `SpawnClass` and with the class table in
     docs/formats/spawns.md;
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
GLOBALS = ROOT / "ghidra" / "annotations" / "globals.tsv"
SPAWNS = ROOT / "docs" / "formats" / "spawns.md"

# Two citation forms, and the difference matters.
#
#   definition   `ResolveHit` -- `FUN_00409430`      "this file ports it"
#   reference    `ZombieStateStrike` (`FUN_00455A40`) "this is where it lives"
#
# Both must agree with functions.tsv; only a definition has to be backed by a
# function of that name in the same file.
DEF = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`\s*[-—]+\s*`(FUN_[0-9A-Fa-f]{8})`")
REF = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`\s*\(`(FUN_[0-9A-Fa-f]{8})`\)")
ANY_FUN = re.compile(r"`(FUN_[0-9A-Fa-f]{8})`")
# `/** `g_attack_permits` -- `0x009A2BA0`, one per player. */`, and the same
# thing written as a trailing comment on the field itself.
GLOBAL_DOC = re.compile(
    r"`(g_[A-Za-z0-9_]+)`\s*[-—]+\s*`?0x([0-9A-Fa-f]{6,8})`?")
DIVERGES = re.compile(r"\[diverges\]")

failures: list[str] = []
notes: list[str] = []


def annotations(path: Path = FUNCS) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
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
    unnamed: set[str] = set()
    for path in game_files():
        text = path.read_text()
        rel = path.relative_to(ROOT)
        cited: set[str] = set()

        def cite(name: str, fun: str, is_def: bool) -> None:
            addr = fun[4:].lower()
            cited.add(addr)
            real = named.get(addr)
            if real is None:
                failures.append(
                    f"{rel}: {fun} is cited as `{name}` but is not in "
                    f"functions.tsv -- name it there first (/decomp)")
                return
            if real != name:
                # This is the check that catches a rename applied in Ghidra and
                # in the TSV but not here.
                failures.append(
                    f"{rel}: says `{name}` for {fun}, functions.tsv says "
                    f"`{real}`")
                return
            if not is_def:
                return
            ported.add(real)
            # A definition must actually be declared, or the doc is decoration.
            if not re.search(rf"\b(function|const)\s+{re.escape(name)}\b", text):
                failures.append(
                    f"{rel}: documents `{name}` -- {fun} as a port but declares "
                    f"no such function; cite it as `{name}` ({fun}) instead")

        for name, fun in REF.findall(text):
            cite(name, fun, is_def=False)
        refs = {(n, f) for n, f in REF.findall(text)}
        for name, fun in DEF.findall(text):
            if (name, fun) in refs:
                continue        # the reference form also matches the dash one
            cite(name, fun, is_def=True)

        # A bare address with no name beside it is a pointer at something
        # Ghidra has not named. Legitimate -- an unread class handler is still
        # worth citing -- but counted, so it does not become the norm.
        for fun in ANY_FUN.findall(text):
            if fun[4:].lower() not in cited and fun[4:].lower() not in named:
                unnamed.add(fun)
    if unnamed:
        notes.append(f"unnamed citations: {len(unnamed)} -- "
                     + ", ".join(sorted(unnamed)))
    return ported


def check_globals(named: dict[str, str]) -> int:
    """Rule 1, for the data segment.

    A global renamed in Ghidra and not renamed here is the failure this
    catches: the address still resolves, the name beside it no longer matches,
    and the port quietly documents a symbol that no longer exists.
    """
    seen: set[str] = set()
    for path in game_files():
        rel = path.relative_to(ROOT)
        for name, addr in GLOBAL_DOC.findall(path.read_text()):
            key = addr.lower().rjust(8, "0")
            real = named.get(key)
            if real is None:
                failures.append(f"{rel}: 0x{key.upper()} is not in globals.tsv")
            elif real != name:
                failures.append(
                    f"{rel}: doc says `{name}` for 0x{key.upper()}, "
                    f"globals.tsv says `{real}`")
            else:
                seen.add(real)
    notes.append(f"globals: {len(seen)} cited, all matching globals.tsv")
    return len(seen)


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

    # Every class module must have a `SpawnClass` member, so no registry key is
    # ever a bare number. This is the rule that keeps the cat from running the
    # zombie's state machine.
    enum_src = (GAME / "spawn_class.ts").read_text()
    members = {int(v, 16): n for n, v in
               re.findall(r"^\s*([A-Z][A-Za-z0-9]*) = 0x([0-9a-fA-F]{2}),",
                          enum_src, re.M)}
    for c in sorted(ported):
        if c not in members:
            failures.append(f"game/class{c:02x}/ has no SpawnClass member; "
                            f"add one rather than keying the registry on 0x{c:02X}")

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
    for c in sorted(members):
        if c not in {k for k, _ in known}:
            failures.append(f"SpawnClass 0x{c:02X} has no row in spawns.md")


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
    check_globals(annotations(GLOBALS))
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
