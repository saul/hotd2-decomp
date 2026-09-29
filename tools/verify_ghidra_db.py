#!/usr/bin/env python3
"""The Ghidra database says what `ghidra/annotations/` says, and no call is cut.

    python3 tools/verify_ghidra_db.py --game-dir ~/"THE HOUSE OF THE DEAD 2"

Every other check reads the exe. This one reads the **database** every session
decompiles from -- the one the MCP bridge serves -- because that is where the
decompiler's model of the program lives, and a wrong model produces pseudocode
that reads cleanly and is missing code (L89).

It copies the saved project (the GUI's lock stays on the original, so this
runs with Ghidra open and reads what was last saved), then runs
`ApplyAnnotations` and `RepairFlowDamage` over the copy **in report mode**, and
asserts both have nothing to do:

* no `CALL` to a function that returns carries a `CALL_RETURN` flow override,
  and no such call falls into undisassembled bytes. This is the damage: 1,085
  of them once cut 517 functions short at `MatrixStackPop` and `PlaySoundId`,
  silently -- a `CALL_RETURN` prints as a clean `return;`;
* the "Non-Returning Functions - Discovered" analyzer is off in the program's
  own options, since the GUI's incremental analysis is what did it;
* every function flagged no-return is declared `noreturn` in `prototypes.tsv`,
  and every flag and prototype the file declares is what the database has.
  A prototype someone set by hand that differs from its row is reported
  separately, because the fix is `export-annotations`, not `apply`;
* the program was imported from the `Hod2.exe` in `--game-dir`.

What only this check can see: a database that disagrees with the committed
annotations, and a call the decompiler has been told never comes back.

Exit 0 when it asserted all of that, 1 when any of it is wrong, and 3 when it
could assert nothing -- no Ghidra, no project, or no game.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_NAME = "HOTD2"
PROGRAM = "Hod2.exe"

FIX_REPAIR = "HOTD2_APPLY=1 ./ghidra/run.sh repair-flow"
FIX_APPLY = "HOTD2_APPLY=1 ./ghidra/run.sh apply-annotations, then " + FIX_REPAIR


def summary(out: str, tag: str) -> dict[str, str] | None:
    """The one `[hotd2] <tag>: k=v ...` line a script prints, as a dict."""
    m = re.search(rf"\[hotd2\] {tag}: ((?:\S+=\S+ ?)+)", out)
    if not m:
        return None
    return dict(kv.split("=", 1) for kv in m.group(1).split())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", default=os.environ.get("GAME_DIR"))
    ap.add_argument("--project-dir",
                    default=os.environ.get("HOTD2_PROJECT_DIR",
                                           str(ROOT / "ghidra" / "project")))
    ap.add_argument("--ghidra-home",
                    default=os.environ.get("GHIDRA_HOME",
                                           str(Path.home() / "ghidra_12.1.3_PUBLIC")))
    args = ap.parse_args()

    headless = Path(args.ghidra_home) / "support" / "analyzeHeadless"
    project = Path(args.project_dir)
    exe = Path(args.game_dir or "") / PROGRAM
    if not headless.is_file():
        print(f"SKIP  verify_ghidra_db: no Ghidra at {args.ghidra_home} (set GHIDRA_HOME)")
        return 3
    if not (project / f"{PROJECT_NAME}.gpr").is_file():
        print(f"SKIP  verify_ghidra_db: no project at {project}; ./ghidra/run.sh rebuild makes one")
        return 3
    if not args.game_dir or not exe.is_file():
        print(f"SKIP  verify_ghidra_db: no {PROGRAM} (pass --game-dir)")
        return 3

    with tempfile.TemporaryDirectory(prefix="hotd2-ghidra-") as tmp:
        copy = Path(tmp) / "project"
        shutil.copytree(project, copy, ignore=shutil.ignore_patterns("*.lock", "*.lock~"))
        env = dict(os.environ, HOTD2_REPO=str(ROOT), HOTD2_OUT=tmp)
        env.pop("HOTD2_APPLY", None)
        p = subprocess.run(
            [str(headless), str(copy), PROJECT_NAME, "-process", PROGRAM,
             "-noanalysis", "-readOnly", "-scriptPath", str(ROOT / "ghidra" / "scripts"),
             "-postScript", "ApplyAnnotations.java",
             "-postScript", "RepairFlowDamage.java"],
            env=env, capture_output=True, text=True, timeout=900)
    out = p.stdout + p.stderr
    proto, flow = summary(out, "prototypes"), summary(out, "flow")
    if p.returncode != 0 or proto is None or flow is None:
        # A run that printed no summary did not look at the database (L13).
        print(f"FAIL  verify_ghidra_db: the headless run exited {p.returncode} "
              "without both summaries")
        for line in out.splitlines()[-25:]:
            print(f"  {line}")
        return 1

    detail = [re.sub(r"^.*?\[hotd2\] ", "", l).strip().removesuffix("(GhidraScript)").strip()
              for l in out.splitlines()
              if re.search(r"\[hotd2\] (prototype |flow )", l)]
    md5 = hashlib.md5(exe.read_bytes()).hexdigest()

    bad: list[str] = []
    ok: list[str] = []

    def rule(held: bool, good: str, wrong: str) -> None:
        (ok if held else bad).append(good if held else wrong)

    rule(flow["md5"] == md5,
         f"the database was imported from this {PROGRAM} ({md5})",
         f"the database's program md5 is {flow['md5']}, {exe} is {md5}: "
         "it was imported from a different executable")
    rule(flow["discovered"] == "false",
         "the Discovered no-return analyzer is off",
         f"the \"Non-Returning Functions - Discovered\" analyzer is on -- {FIX_REPAIR}")
    stale, dropped = int(flow["stale"]), int(flow["dropped"])
    rule(stale == 0 and dropped == 0,
         "no CALL to a returning function is cut short",
         f"{stale} CALLs to a function that returns carry CALL_RETURN and "
         f"{dropped} fall into undisassembled bytes -- the decompiler ends "
         f"those bodies at the call. {FIX_REPAIR}")
    rule(int(flow["undeclared"]) == 0,
         "every no-return flag is declared in prototypes.tsv",
         f"{flow['undeclared']} functions are flagged no-return and "
         "prototypes.tsv does not say so -- prove it and add a `noreturn` row, "
         f"or add a `returns` row and run {FIX_APPLY}")
    changes = int(proto["changed"]) + int(proto["flags"]) + int(proto["missing"])
    rule(changes == 0,
         f"all {proto['same']} prototypes and every flag in prototypes.tsv "
         "are applied",
         f"{proto['changed']} prototypes, {proto['flags']} flags and "
         f"{proto['missing']} missing functions differ from prototypes.tsv -- "
         f"{FIX_APPLY}")
    rule(int(proto["kept"]) == 0,
         "no prototype set by hand disagrees with its row",
         f"{proto['kept']} prototypes were set by hand and differ from their "
         "row -- ./ghidra/run.sh export-annotations if the database is right, "
         "else fix it and re-apply")
    rule(int(proto["failed"]) == 0,
         "every row of prototypes.tsv parses",
         f"{proto['failed']} rows of prototypes.tsv do not parse")

    for line in ok:
        print(f"  ok    {line}")
    if bad:
        for line in bad:
            print(f"  FAIL  {line}")
        for line in detail[:40]:
            print(f"        {line}")
        print(f"\nFAIL  verify_ghidra_db: {len(bad)} of {len(bad) + len(ok)} "
              "rules broken (read from the last saved database)")
        return 1
    print(f"\nclean: {len(ok)} rules over the saved database")
    return 0


if __name__ == "__main__":
    sys.exit(main())
