#!/usr/bin/env python3
"""No exporter may swallow a failure silently, and the two libraries agree.

Four checks. Three are about an exporter telling the truth about what it
produced; the fourth is about `web/src/hod2lib/` and `tools/hod2lib/` being the
same library twice.

Thirty sites under `tools/hod2lib/` and `tools/export_*.py` answer an
exception with an empty result -- `return {}`, `return []`,
`cache[stem] = ([], None)`. That is the right behaviour: an install missing one
`pol/` file should still produce a glTF, and refusing to export a stage because
one prop model will not parse would be worse than exporting without it.

What was wrong is that they were **silent**. A parser regression anywhere under
`hod2lib` produced a valid bundle with zero characters, exit code 0 and no
message; the player then drew an empty stage, which looks exactly like a
gameplay bug. `docs/PLAN.md` P6 named "a silent exporter regression" as the
thing nothing in this repository could catch. F16 of docs/REVIEW-2026-09-03.md
is the same finding from the other side.

So this is the rule that keeps them honest: **a broad `except` in an exporter
must record what it gave up**, through `hod2lib.degraded.note`. On the bundle
path the count reaches `manifest.json` and the exporter's exit code; the
TypeScript half of `degraded` does the same thing on the other side.

Fixing the thirty instances without this check would have been a fix with a
shelf life.

The second check is what makes the bundle's schema digest work at all.
``manifest.json`` carries a hash of the declarations in `web/src/bundle/*.ts`
and the client compares it against `web/src/bundle/schema_hash.ts`, which
`tools/gen_schema_hash.py` generates from the same sources and which is
committed. A generated file that is regenerated only when someone remembers is
`BUNDLE_FORMAT` again -- so this re-derives it and fails when the committed
copy is stale. **That is what makes the digest impossible to forget**: the
digest catches a stale bundle, and this catches a stale digest.

The fourth check exists because `web/src/hod2lib/` is the TypeScript port of
`tools/hod2lib/`, and it is now the **only** thing that writes a bundle: the
Python writer was removed once the two agreed byte for byte, and what is left
of the Python package is the parsers the twenty `verify_*` checks read the game
with. So the two are no longer a writer and a second writer -- they are one
library with one half of it duplicated, and the check is that the duplication
stays honest: every parser has a counterpart, the version they claim is the
same, and the two generated TypeScript files are current.

`tools/compare_bundles.py` still exists and still compares two bundles; there
is simply no longer a second implementation to point it at. Its use now is a
browser export against a CLI one, or one revision against the next.

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

import gen_builder_hash                                         # noqa: E402
import gen_rig_data                                             # noqa: E402
import gen_schema_hash                                          # noqa: E402

#: Only the exporters. `tools/verify_*.py`, `tools/blender_*.py` and the other
#: one-shot readers are diagnostics -- they print what they found and nobody
#: builds a bundle out of them, so a broad `except` there costs a line of
#: output rather than a stage's worth of characters.
EXPORTERS = ["tools/export_level.py"]

#: `except Exception:` / `except Exception as exc:` / `except (A, B):` -- any
#: handler broad enough to catch a bug rather than a condition.
#: **Every** `except`, not just the broad ones.
#:
#: This matched `Exception|BaseException` alone, and three handlers lost game
#: data under narrower names where it could not see them: a NaomiLib model that
#: would not parse was dropped from its container, a `coli/` file that stopped
#: parsing went into the bundle short, and an install with no `coli/` directory
#: exported a stage with no collision in it at all. Each was `except <specific>:
#: pass`, each produced a valid bundle and exit 0, and the third turns every
#: wall in a stage passable -- which reads as a gameplay bug.
#:
#: The narrowness of the `except` was never the point. What matters is whether
#: the handler *says* something, and that question is the same for every
#: handler, so it is asked of every handler.
ANY_EXCEPT = re.compile(r"^(\s*)except\b[^:]*:")

#: A handler carrying this, on its own line or the `except` line, is declaring
#: that nothing was lost -- the failure *is* the answer. The reason is required
#: and is the whole value of the marker: `classify()` failing to decompress a
#: blob means the blob is not compressed, which is what it returns.
NOT_A_LOSS = re.compile(r"#\s*not-a-loss:\s*\S")
#: How far past the handler to look for the record. A handler that needs more
#: than this before it says anything is doing too much.
WINDOW = 6


def sources() -> list[Path]:
    out = [ROOT / p for p in EXPORTERS]
    out += sorted(p for p in LIB.rglob("*.py") if p.name != "degraded.py")
    return [p for p in out if p.is_file()]


def check_schema_hash() -> list[str]:
    """The committed `schema_hash.ts` against the declarations it covers."""
    path = ROOT / gen_schema_hash.SCHEMA_DIR / gen_schema_hash.GENERATED
    want = gen_schema_hash.client_source(ROOT)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return []
    return [f"{path.relative_to(ROOT)} is stale"]


def check_builder_hash() -> list[str]:
    """The committed `builder_hash.ts` against the exporter it covers.

    Same contract as :func:`check_schema_hash` and a different question. That
    one is "can this client read the bundle"; this one is "is the bundle what
    this exporter would write". A stale digest here means a bundle that is out
    of date cannot be told that it is, which is the failure that let a cached
    stage with holes in it win over the rebuilt one indefinitely.
    """
    path = ROOT / gen_builder_hash.OUT_DIR / gen_builder_hash.GENERATED
    want = gen_builder_hash.client_source(ROOT)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return []
    return [f"{path.relative_to(ROOT)} is stale"]


def check_schema_sources() -> list[str]:
    """`SOURCES` against the directory, in both directions."""
    return gen_schema_hash.check_sources(ROOT)


def check_module_list() -> list[str]:
    """`hod2lib/__init__.py`'s module list against the package on disk.

    That docstring is the front door to the library and it announced `mot` as
    "the last unsolved format" for weeks after `mot.py` landed, through a
    bundle format bump, while nine other modules it never mentioned were added
    around it. A list of files is checkable, so it is checked.
    """
    pkg = ROOT / "tools" / "hod2lib"
    on_disk = {p.stem for p in pkg.glob("*.py")
               if not p.stem.startswith("_")}
    doc = (pkg / "__init__.py").read_text().split('"""')[1]
    # A module row is exactly four spaces, the name, then two or more spaces.
    # The docstring's prose sits in column 0 and a wrapped description indents
    # past the name column, so neither can be mistaken for a row. Free prose
    # and a regex do not mix: an earlier draft of this check read `is`,
    # `which` and `unimplemented` as modules.
    named = {m for m in
             re.findall(r"^    ([a-z][a-z0-9_]*) +\S", doc, re.M)}
    out = []
    for m in sorted(named - on_disk):
        out.append(f"hod2lib/__init__.py names `{m}`, which does not exist")
    for m in sorted(on_disk - named):
        out.append(f"hod2lib/{m}.py is not in `__init__.py`'s module list -- "
                   f"add a line saying what it is")
    return out


#: Modules one implementation has and the other does not, with the reason.
#: A module that appears on neither side of this and only in one package is a
#: port that was forgotten, which is exactly what the check is for.
LIBRARY_ONLY = {
    # The bundle writer is the TypeScript's alone. The Python one was removed
    # once the two agreed byte for byte on all twelve stage bundles; what is
    # left of `tools/hod2lib/` is the parsers, which twenty `verify_*` checks
    # read the game with and which have no reason to move.
    "bundle": "typescript",
    # The seam, and the two things `struct` and `json.dumps` give Python for
    # free. See docs/TS_PORT.md.
    "io": "typescript",
    "bytes": "typescript",
    "pyjson": "typescript",
    # `hashlib` is Python's; `crypto.subtle` is a module because it is async.
    "sha256": "typescript",
    # Generated from `rigs.py` by `tools/gen_rig_data.py`; checked below.
    "rigs_data": "typescript",
}

TS_LIB = ROOT / "web" / "src" / "hod2lib"


def check_two_libraries() -> list[str]:
    """The Python package and the TypeScript one, module for module."""
    out: list[str] = []
    py = {p.stem for p in LIB.glob("*.py") if not p.stem.startswith("_")}
    ts = {p.stem for p in TS_LIB.glob("*.ts")}
    for m in sorted(py - ts):
        if LIBRARY_ONLY.get(m) == "python":
            continue
        out.append(f"tools/hod2lib/{m}.py has no web/src/hod2lib/{m}.ts -- "
                   f"port it, or say why not in verify_exporters.LIBRARY_ONLY")
    for m in sorted(ts - py):
        if LIBRARY_ONLY.get(m) == "typescript":
            continue
        out.append(f"web/src/hod2lib/{m}.ts has no tools/hod2lib/{m}.py -- "
                   f"the reference implementation is the Python one; add it "
                   f"there, or say why not in verify_exporters.LIBRARY_ONLY")
    for m in sorted(LIBRARY_ONLY):
        if m not in py and m not in ts:
            out.append(f"verify_exporters.LIBRARY_ONLY names `{m}`, which is "
                       f"in neither package")

    # `tool_version` is what a manifest says produced it, and it names the
    # library rather than the implementation -- `hod2lib`, whose Python half is
    # still where the formats are specified. The two spellings of the version
    # have to agree or a bundle would be able to say which side wrote it.
    #
    # `BUNDLE_FORMAT` has no Python side any more: there is one writer, and a
    # constant with one definition needs no check.
    from hod2lib import __version__ as pyversion
    src = (TS_LIB / "bundle.ts").read_text(encoding="utf-8")
    m = re.search(r'export const TOOL_VERSION = "([^"]+)";', src)
    if not m:
        out.append("web/src/hod2lib/bundle.ts declares no TOOL_VERSION")
    elif m.group(1) != pyversion:
        out.append(f"hod2lib.__version__ is {pyversion!r} and "
                   f"TOOL_VERSION is {m.group(1)!r}")
    return out


def check_rig_data() -> list[str]:
    """`rigs_data.ts` against the transcription it is generated from."""
    want = gen_rig_data.render()
    path = gen_rig_data.OUT
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return []
    return [f"{path.relative_to(ROOT)} is stale -- run "
            f"`python3 tools/gen_rig_data.py` and commit it with the "
            f"`rigs.py` change that moved it"]


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
            m = ANY_EXCEPT.match(line)
            if not m:
                continue
            total += 1
            # The window counts *code*, not prose. A handler whose reason
            # takes eight lines of comment to explain is exactly the handler
            # you want explained, and measuring the two together made a
            # well-documented site look like a silent one.
            after = [ln for ln in lines[i + 1:i + 1 + WINDOW * 4]
                     if ln.strip() and not ln.lstrip().startswith("#")]
            body = "\n".join(after[:WINDOW])
            if "degraded.note(" in body:
                continue
            # A handler that re-raises, or that turns the failure into a
            # SystemExit, is not swallowing anything.
            if re.search(r"^\s*(raise\b|return\s+\w+\.fail\()", body, re.M):
                continue
            # ...nor one that puts it on a channel something reads: the
            # `warnings` list travels in the stage JSON and `stage_load.ts`
            # surfaces it, and a line on stderr is at least on screen.
            if re.search(r"warnings\.append\(|file=sys\.stderr", body):
                continue
            # ...nor one that has said, with a reason, that there is nothing
            # to lose.
            raw_span = "\n".join(lines[i:i + 1 + WINDOW])
            if NOT_A_LOSS.search(line) or NOT_A_LOSS.search(raw_span):
                continue
            bad.append(f"{rel}:{i + 1}: {line.strip()} -- says nothing")

    stale = check_schema_hash()
    stale_builder = check_builder_hash()
    undocumented = check_module_list()
    decl_sources = check_schema_sources()
    two_libs = check_two_libraries() + check_rig_data()

    print("exporters -- what a swallowed failure has to say\n")
    print(f"  {total} handlers, {len(bad)} of them silent"
          f" (baseline 0)\n")
    if bad:
        for b in bad:
            print(f"FAIL {b}")
        print(f"\n{len(bad)} failed. Record the loss with "
              f"`degraded.note(what, lost, exc)` -- see tools/hod2lib/"
              f"degraded.py -- or, if the failure *is* the answer and nothing "
              f"is lost, say so on the handler with a "
              f"`# not-a-loss: <reason>` comment.")
        return 1
    print("clean")

    print("\nthe schema digest the client compiles against\n")
    if stale:
        for m in stale:
            print(f"FAIL {m}")
        print("\nRegenerate it and commit it with the declaration change that "
              "moved it:\n  python3 tools/gen_schema_hash.py")
        return 1
    if decl_sources:
        for m in decl_sources:
            print(f"FAIL {m}")
        print("\nThe digest covers what a bundle can disagree with. "
              "Declarations go on `SOURCES` in tools/gen_schema_hash.py; "
              "code that runs goes in web/src/bundle/load.ts.")
        return 1
    print(f"  {len(gen_schema_hash.file_digests(ROOT))} declaration files, "
          f"digest {gen_schema_hash.schema_hash(ROOT)[:16]}...\n")
    print("clean")

    print("\nthe exporter digest a bundle is stamped with\n")
    if stale_builder:
        for m in stale_builder:
            print(f"FAIL {m}")
        print("\nRegenerate it and commit it with the exporter change that "
              "moved it:\n  python3 tools/gen_builder_hash.py")
        return 1
    print(f"  {len(gen_builder_hash.file_digests(ROOT))} exporter files, "
          f"digest {gen_builder_hash.builder_hash(ROOT)[:16]}...\n")
    print("clean")

    print("\nthe library's own account of itself\n")
    if undocumented:
        for m in undocumented:
            print(f"FAIL {m}")
        print("\nOne line per module in `hod2lib/__init__.py`'s docstring, "
              "saying what it is.")
        return 1
    print("  every hod2lib module is named in `__init__.py`, and every name "
          "exists\n")
    print("clean")

    print("\nthe two implementations of the library\n")
    if two_libs:
        for m in two_libs:
            print(f"FAIL {m}")
        print("\nThe Python package is the reference and the TypeScript one "
              "has to agree with it. `tools/compare_bundles.py` checks the "
              "output; this checks the shape. See docs/TS_PORT.md.")
        return 1
    n_py = len([p for p in LIB.glob("*.py") if not p.stem.startswith("_")])
    n_ts = len(list(TS_LIB.glob("*.ts")))
    print(f"  {n_py} python modules, {n_ts} typescript, same set either way "
          f"less {len(LIBRARY_ONLY)} declared; tool_version agrees; "
          f"rigs_data.ts is current\n")
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
