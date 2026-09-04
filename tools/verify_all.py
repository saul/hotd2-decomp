#!/usr/bin/env python3
"""Run every check this repo has, and say which ones actually ran.

**This file is the canonical list of checks.** It used to be a shell block
copied into `CLAUDE.md`, `.claude/skills/decomp/SKILL.md`,
`.claude/skills/gameplay-port/SKILL.md` and twice into
`.claude/skills/hang-investigation/SKILL.md` -- five copies, four of them
stale, three of them missing suites that had existed for weeks. A list that
lives in one place and is executable cannot drift from itself.

`tools/status.py` imports `CHECKS` from here to render the same table into
`docs/STATUS.md`, so the documentation of what is checked is one authored
source with two renderings.

Exit codes, and why a skip is not a pass:

* **0** -- every check that could run, ran and passed.
* **1** -- something failed.
* **2** -- `--strict` and something was skipped.

A check exits **3** when it asserted nothing. That is the convention the
bundle-gated suites use, and the reason it exists is that four regression
tests silently asserted nothing on any machine without game assets while the
record described them as passing. Here a skip is counted, named and printed
under its own heading; it never disappears into a green line.

    python3 tools/verify_all.py                       # what runs without assets
    python3 tools/verify_all.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
    python3 tools/verify_all.py --list                # the table, run nothing
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: What a check needs before it can assert anything.
NEEDS_NOTHING = ""
NEEDS_BUNDLE = "bundle"      # an exported player bundle (extract/player)
NEEDS_GAME = "game-dir"      # the installed game, for a byte-level comparison


@dataclass(frozen=True)
class Check:
    """One check, and the single sentence that says why it is not redundant.

    `sees` is the load-bearing field. A check whose `sees` duplicates another
    check's is a check to delete, and writing them next to each other is the
    only way that ever becomes visible.
    """

    name: str
    cwd: str              # "." or "web"
    cmd: list[str]        # argv; `{game_dir}` is substituted
    sees: str
    needs: str = NEEDS_NOTHING


#: Ordered cheapest-first, so a broken tree fails in seconds rather than
#: minutes. `tsc` comes before every suite that would fail confusingly
#: without it.
CHECKS: list[Check] = [
    Check("tsc", "web", ["npx", "tsc", "--noEmit"],
          "that the whole tree -- `test/` and `tools/` included -- typechecks"),
    Check("verify_layers", ".", ["python3", "tools/verify_layers.py"],
          "the layer boundaries, and any ratchet's current count"),
    Check("verify_port", ".", ["python3", "tools/verify_port.py"],
          "that every exe citation in the port matches `functions.tsv`, "
          "under the same name"),
    Check("verify_player_ops", ".", ["python3", "tools/verify_player_ops.py"],
          "that the opcode table and the implementations agree"),
    Check("verify_player_dom", ".", ["python3", "tools/verify_player_dom.py"],
          "that the stylesheet and the markup agree, in both directions"),
    Check("verify_exporters", ".", ["python3", "tools/verify_exporters.py"],
          "that no exporter swallows a failure and reports success"),
    Check("status", ".", ["python3", "tools/status.py", "--check"],
          "that `docs/STATUS.md` still matches the tree it describes"),
    Check("test:port", "web", ["npm", "run", "--silent", "test:port"],
          "the state machines, driven headless against hand-written tables"),
    Check("test:bundle", "web", ["npm", "run", "--silent", "test:bundle"],
          "that the bundle reader refuses what it should refuse"),
    Check("test:scope", "web", ["npm", "run", "--silent", "test:scope"],
          "that lifetimes are given back"),
    Check("test:projection", "web", ["npm", "run", "--silent", "test:projection"],
          "that unchanged slices keep their identity across a frame"),
    Check("test:ui", "web", ["npm", "run", "--silent", "test:ui"],
          "that the page has the shape the stylesheet expects"),
    Check("test:pose", "web", ["npm", "run", "--silent", "test:pose"],
          "that a skeleton posed from a motion lands where the exporter says"),
    Check("test:render", "web", ["npm", "run", "--silent", "test:render"],
          "that the renderers rebuild from engine state alone"),
    Check("test:texfilter", "web", ["npm", "run", "--silent", "test:texfilter"],
          "that the texture filter modes match the D3D7 translation"),
    Check("verify:ui", "web", ["npm", "run", "--silent", "verify:ui"],
          "the two UI rules that need an AST rather than a regex"),
    Check("test:seek", "web", ["npm", "run", "--silent", "test:seek"],
          "that a seek reaches the address it was asked for",
          NEEDS_BUNDLE),
    Check("test:state", "web", ["npm", "run", "--silent", "test:state"],
          "that a save/load and a seek reach the *same world* play did -- "
          "the only check that compares two histories rather than one",
          NEEDS_BUNDLE),
    Check("test:camera", "web", ["npm", "run", "--silent", "test:camera"],
          "that a camera path seats where the exe's own evaluation puts it",
          NEEDS_BUNDLE),
    Check("verify_annotations", ".",
          ["python3", "tools/verify_annotations.py", "--game-dir", "{game_dir}"],
          "that every annotated address is a real function in the EXE",
          NEEDS_GAME),
    Check("baseline", ".",
          ["python3", "tools/baseline.py", "--game-dir", "{game_dir}",
           "--verify"],
          "that the installed assets still hash to `manifest.csv`",
          NEEDS_GAME),
]

PASS, FAIL, SKIP = "pass", "fail", "skip"


def run_one(c: Check, game_dir: str | None, timeout: int) -> tuple[str, str, float]:
    """Returns (outcome, output, seconds). Exit 3 means it asserted nothing."""
    if c.needs == NEEDS_GAME and not game_dir:
        return SKIP, "no --game-dir given", 0.0
    cmd = [a.replace("{game_dir}", game_dir or "") for a in c.cmd]
    if shutil.which(cmd[0]) is None:
        return SKIP, f"{cmd[0]} not on PATH", 0.0
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=ROOT / c.cwd, capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return FAIL, f"timed out after {timeout}s", time.time() - t0
    out = (p.stdout or "") + (p.stderr or "")
    dt = time.time() - t0
    if p.returncode == 0:
        return PASS, out, dt
    if p.returncode == 3:
        return SKIP, out.strip() or "asserted nothing (exit 3)", dt
    return FAIL, out, dt


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", help="the installed game, for the two "
                                       "checks that compare against it")
    ap.add_argument("--list", action="store_true",
                    help="print the table and run nothing")
    ap.add_argument("--only", action="append", default=[],
                    help="run only these checks, by name (repeatable)")
    ap.add_argument("--strict", action="store_true",
                    help="exit 2 if any check was skipped")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    if args.list:
        w = max(len(c.name) for c in CHECKS)
        for c in CHECKS:
            need = f"  [needs {c.needs}]" if c.needs else ""
            print(f"  {c.name:<{w}}  {c.sees}{need}")
        return 0

    checks = [c for c in CHECKS if not args.only or c.name in args.only]
    unknown = set(args.only) - {c.name for c in CHECKS}
    if unknown:
        print(f"no such check: {', '.join(sorted(unknown))}", file=sys.stderr)
        return 1

    results: list[tuple[Check, str, str, float]] = []
    w = max(len(c.name) for c in checks)
    for c in checks:
        print(f"  {c.name:<{w}}  ... ", end="", flush=True)
        outcome, out, dt = run_one(c, args.game_dir, args.timeout)
        print(f"{outcome.upper():<4} {dt:5.1f}s")
        results.append((c, outcome, out, dt))

    failed = [(c, o) for c, r, o, _ in results if r == FAIL for o in [o]]
    skipped = [(c, o) for c, r, o, _ in results if r == SKIP for o in [o]]
    passed = sum(1 for _, r, _, _ in results if r == PASS)

    for c, out in failed:
        print(f"\n--- {c.name} FAILED " + "-" * (56 - len(c.name)))
        print(out.rstrip()[-4000:])

    print()
    if skipped:
        print(f"skipped {len(skipped)}, and a skip asserted nothing:")
        for c, why in skipped:
            print(f"  {c.name}: {why.splitlines()[0] if why else ''}")
        kinds = {c.needs for c, _ in skipped}
        if NEEDS_BUNDLE in kinds:
            print("  build a bundle with tools/export_player.py, or point "
                  "HOTD2_BUNDLE at one.")
        if NEEDS_GAME in kinds:
            print("  pass --game-dir for the checks that compare against the "
                  "installed game.")
    print(f"{passed} passed, {len(failed)} failed, {len(skipped)} skipped")

    if failed:
        return 1
    if skipped and args.strict:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
