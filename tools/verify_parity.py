#!/usr/bin/env python3
"""Export one stage with both implementations and prove they agree.

`tools/hod2lib/` is the reference and `web/src/hod2lib/` is the same library in
TypeScript, so that a bundle can be built inside the browser. That is two
implementations of one format specification, which is precisely the drift this
repository spends most of its checks preventing.

`tools/verify_exporters.py` checks the *shape* -- same modules, same
`BUNDLE_FORMAT`, same `tool_version` -- on every commit, with no game
directory. This is the other half and the expensive one: it builds a stage
twice and compares the bytes.

**One stage, and both game modes.** The check has to be fast enough that people
run it, and a stage exercises every module in the package: containers, LZ,
NL1, PowerVR2, the exe tables, `cam/`, `evt/`, `coli/`, `mot/`, the characters,
the rigs, the props and both writers. Original Mode is in because it is the
other half of the region tables and costs nothing extra to compare. Stage 1 by
default because it is the smallest; `--stage` picks another and the full sweep
is a command in `docs/TS_PORT.md`, not a gate.

`--ulps 1` is the documented allowance, and `tools/compare_bundles.py` prints
what it covered: `sin`, `cos`, `asin` and `atan2` are not required by IEEE 754
to be correctly rounded, and V8's fdlibm and CPython's libm disagree in the
last place on a few dozen quaternion components across the whole game. Nothing
that is plain arithmetic is allowed to move at all.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: The one the two exports are compared on. Stage 1 is the smallest and still
#: reaches every module.
DEFAULT_STAGE = 1

#: See the module docstring. Zero would fail on the libm difference alone.
DEFAULT_ULPS = 1


def run(cmd: list[str], cwd: Path, label: str) -> bool:
    print(f"  {label}: {' '.join(cmd[:3])} ...", flush=True)
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode == 0:
        return True
    print(f"FAIL {label} exited {r.returncode}")
    for line in (r.stdout + r.stderr).splitlines()[-20:]:
        print(f"    {line}")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--stage", type=int, default=DEFAULT_STAGE)
    ap.add_argument("--ulps", type=int, default=DEFAULT_ULPS)
    ap.add_argument("--keep", action="store_true",
                    help="leave the two bundles behind, to look at")
    args = ap.parse_args()

    game = str(args.game_dir.expanduser())
    tmp = Path(tempfile.mkdtemp(prefix="hod2-parity-"))
    py_out, ts_out = tmp / "python", tmp / "typescript"

    print(f"parity -- stage {args.stage}, both modes, in {tmp}\n")
    ok = run(["python3", "tools/export_player.py", "--game-dir", game,
              "--stage", str(args.stage), "--out", str(py_out)],
             ROOT, "python export")
    if ok:
        ok = run(["node", "tools/run_ts.mjs", "tools/export.ts",
                  "--game-dir", game, "--stage", str(args.stage),
                  "--out", str(ts_out)],
                 ROOT / "web", "typescript export")

    if ok:
        r = subprocess.run(
            ["python3", "tools/compare_bundles.py", str(py_out), str(ts_out),
             "--ulps", str(args.ulps)],
            cwd=ROOT, capture_output=True, text=True)
        print()
        print(r.stdout.rstrip())
        if r.stderr.strip():
            print(r.stderr.rstrip(), file=sys.stderr)
        ok = r.returncode == 0

    if args.keep:
        print(f"\nkept: {tmp}")
    else:
        shutil.rmtree(tmp, ignore_errors=True)
    if not ok:
        print("\nThe two exporters disagree. `tools/hod2lib/` is the "
              "reference; see docs/TS_PORT.md for what identical means and "
              "re-run with --keep to look at both bundles.", file=sys.stderr)
        # The likeliest cause in a repository several people are working in,
        # and the one that is not a bug: the reference has been edited and the
        # TypeScript has not followed yet. Saying so turns a confusing red into
        # an instruction, and it does not soften the check -- this still fails.
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", "tools/hod2lib"],
            cwd=ROOT, capture_output=True, text=True).stdout.strip()
        if dirty:
            print("\n`tools/hod2lib/` has uncommitted changes:\n"
                  + "\n".join(f"  {ln}" for ln in dirty.splitlines())
                  + "\n\nA format change lands in the Python first and in "
                    "`web/src/hod2lib/` in the same commit. If those edits are "
                    "yours, port them; if they are a peer's work in progress, "
                    "this check cannot pass until they land.",
                  file=sys.stderr)
        return 1
    print("\nclean: both implementations wrote the same bundle")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
