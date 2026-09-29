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
`ExportAnnotations` into a copy of `ghidra/annotations/`, and asserts:

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
* the program was imported from the `Hod2.exe` in `--game-dir`;
* **no export would put back a name the file has renamed away from**: a
  function or global whose database name is one this tree's history gave the
  address before its current row. The database wins on names in an export, so
  that rename is reverted by the next `export-annotations` -- the loss that
  reverted 19 curated comments before comments became the file's;
* every row of `functions.tsv` and `globals.tsv` applies.

Names and comments that differ **without** that are counted and printed, and
do not fail. Either the files are ahead (a row committed with
`tools/annotate.py` that `apply-annotations` has not written yet, which needs
the GUI closed) or the database is (a rename or a comment made over MCP that
nobody has exported -- a peer's work in progress, or a branch that never
landed). Neither is wrong, and failing on them would hold every session's
check red for someone else's work. A database comment that differs from a
non-empty file comment is listed as a conflict: the next apply replaces it
with the file's, and the export keeps the file's too, so prose that exists
only in the database has to be carried over by hand.

What only this check can see: a database that disagrees with the committed
annotations, a rename an export would silently undo, and a call the
decompiler has been told never comes back.

Exit 0 when it asserted all of that, 1 when any of it is wrong, and 3 when it
could assert nothing -- no Ghidra, no project, or no game.
"""
from __future__ import annotations

import argparse
import collections
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


RENAME = re.compile(r"\[hotd2\] export (functions|globals) rename ([0-9a-f]{8}) (\S+) -> (\S+)")


def former_names(table: str) -> dict[str, set[str]]:
    """Every name each address has carried in this tree's committed history.

    One `git log -p` over the file: a row's name appears on a `+` or `-` line
    of every commit that touched it. A name the database has that is in this
    set, but is not the row's name now, is a rename the file made and the
    database never followed.
    """
    p = subprocess.run(
        ["git", "-C", str(ROOT), "log", "-p", "-U0", "--no-renames", "--format=",
         "HEAD", "--", f"ghidra/annotations/{table}.tsv"],
        capture_output=True, text=True)
    names: dict[str, set[str]] = collections.defaultdict(set)
    for line in p.stdout.splitlines():
        if line[:1] not in "+-" or line.startswith(("+++", "---")):
            continue
        c = line[1:].split("\t", 2)
        if len(c) >= 2 and re.fullmatch(r"[0-9a-fA-F]{8}", c[0]):
            names[c[0].lower()].add(c[1].strip())
    return names


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
        # The scripts read -- and ExportAnnotations writes -- a copy of the
        # annotations, so what an export would do is measured without doing it.
        repo = Path(tmp) / "repo"
        shutil.copytree(ROOT / "ghidra" / "annotations", repo / "ghidra" / "annotations")
        env = dict(os.environ, HOTD2_REPO=str(repo), HOTD2_OUT=tmp)
        env.pop("HOTD2_APPLY", None)
        p = subprocess.run(
            [str(headless), str(copy), PROJECT_NAME, "-process", PROGRAM,
             "-noanalysis", "-readOnly", "-scriptPath", str(ROOT / "ghidra" / "scripts"),
             "-postScript", "ApplyAnnotations.java",
             "-postScript", "RepairFlowDamage.java",
             # Last: it rewrites the copy's prototypes.tsv, which RepairFlowDamage reads.
             "-postScript", "ExportAnnotations.java"],
            env=env, capture_output=True, text=True, timeout=900)
    out = p.stdout + p.stderr
    proto, flow = summary(out, "prototypes"), summary(out, "flow")
    fns, gbls = summary(out, "functions"), summary(out, "globals")
    xfns, xgbls = summary(out, "export functions"), summary(out, "export globals")
    got = [proto, flow, fns, gbls, xfns, xgbls]
    if p.returncode != 0 or None in got or "SCRIPT ERROR" in out:
        # A run that printed no summary did not look at the database (L13),
        # and a script that failed to compile is skipped with exit 0.
        print(f"FAIL  verify_ghidra_db: the headless run exited {p.returncode} "
              f"with {sum(g is not None for g in got)} of {len(got)} summaries")
        for line in out.splitlines()[-25:]:
            print(f"  {line}")
        return 1

    detail = [re.sub(r"^.*?\[hotd2\] ", "", l).strip().removesuffix("(GhidraScript)").strip()
              for l in out.splitlines()
              if re.search(r"\[hotd2\] (prototype |flow |name )", l)]
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

    # Names and comments. An export takes the database's name, so the one
    # disagreement that loses work is a database name the file already left.
    renames = [(t, a, have, db) for t, a, have, db in RENAME.findall(out)]
    history = {t: former_names(t) for t in ("functions", "globals")}
    stale = [(t, a, have, db) for t, a, have, db in renames if db in history[t].get(a, ())]
    rule(not stale,
         "no export would put back a name the file renamed away from",
         f"{len(stale)} database names are ones the file has since renamed, and "
         "export-annotations would put them back: "
         + ", ".join(f"0x{a.upper()} `{db}` (the file: `{have}`)" for _, a, have, db in stale[:6])
         + " -- rename them in the database (rename_function over MCP, or the GUI)")
    failed = int(fns["failed"]) + int(gbls["failed"])
    rule(failed == 0,
         "every row of functions.tsv and globals.tsv applies",
         f"{failed} rows of functions.tsv/globals.tsv fail to apply -- see "
         "ghidra/out/apply_annotations.txt after a report run")

    # Counted, never failed: someone's work on its way (see the docstring).
    notes: list[str] = []
    ahead_n = int(fns["named"]) + int(fns["created"]) + int(gbls["named"])
    ahead_c = int(fns["comments"]) + int(gbls["comments"])
    if ahead_n or ahead_c:
        notes.append(f"the files are ahead: {ahead_n} names and {ahead_c} comments "
                     "not in the database yet -- HOTD2_APPLY=1 ./ghidra/run.sh "
                     "apply-annotations (with the GUI closed) writes them")
    pending = [(t, a, have, db) for t, a, have, db in renames if (t, a, have, db) not in stale]
    new_rows = int(xfns["appended"]) + int(xgbls["appended"])
    filled = int(xfns["filled"])
    if pending or new_rows or filled:
        notes.append(f"the database is ahead: {new_rows} names no row has, "
                     f"{len(pending)} renames and {filled} comments for empty rows "
                     "-- ./ghidra/run.sh export-annotations brings them over; "
                     "check a branch has not already committed them")
        for t, a, have, db in pending[:6]:
            notes.append(f"  rename 0x{a.upper()} {t}: the file `{have}`, the database `{db}`")
    conflicts = int(xfns["conflicts"])
    if conflicts:
        notes.append(f"{conflicts} comments differ between a file row and the "
                     "database; both scripts keep the file's, and the database's "
                     "is replaced on the next apply -- carry anything worth keeping "
                     "over with tools/annotate.py (export-annotations lists them in "
                     "ghidra/out/export_comment_conflicts.tsv)")

    for line in ok:
        print(f"  ok    {line}")
    for line in notes:
        print(f"  note  {line}")
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
