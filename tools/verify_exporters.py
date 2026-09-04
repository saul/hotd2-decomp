#!/usr/bin/env python3
"""No exporter may swallow a failure silently, and the schema digest is current.

Two checks, both about the exporter telling the truth about what it produced.

Thirty sites under `tools/hod2lib/` and `tools/export_*.py` answer an
exception with an empty result -- `return {}`, `return []`,
`cache[stem] = ([], None)`. That is the right behaviour: an install missing one
`pol/` file should still produce a bundle, and refusing to export a stage
because one prop model will not parse would be worse than exporting without it.

What was wrong is that they were **silent**. A parser regression anywhere under
`hod2lib` produced a valid bundle with zero characters, exit code 0 and no
message; the player then drew an empty stage, which looks exactly like a
gameplay bug. `docs/PLAN.md` P6 named "a silent exporter regression" as the
thing nothing in this repository could catch. F16 of docs/REVIEW-2026-09-03.md
is the same finding from the other side.

So this is the rule that keeps them honest: **a broad `except` in an exporter
must record what it gave up**, through `hod2lib.degraded.note`. The count then
reaches `manifest.json` and `export_player.py`'s exit code.

Fixing the thirty instances without this check would have been a fix with a
shelf life.

The second check is what makes the bundle's schema digest work at all.
``manifest.json`` carries a hash of the declarations in `web/src/bundle/*.ts`
and the client compares it against `web/src/bundle/schema_hash.ts`, which is
generated from the same sources and committed. A generated file that is
regenerated only when someone remembers is `BUNDLE_FORMAT` again -- so this
re-derives it and fails when the committed copy is stale. **That is what makes
the digest impossible to forget**: the digest catches a stale bundle, and this
catches a stale digest.

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

from hod2lib import schema                                     # noqa: E402

#: Only the exporters. `tools/verify_*.py`, `tools/blender_*.py` and the other
#: one-shot readers are diagnostics -- they print what they found and nobody
#: builds a bundle out of them, so a broad `except` there costs a line of
#: output rather than a stage's worth of characters.
EXPORTERS = ["tools/export_player.py", "tools/export_level.py"]

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
    """`web/src/bundle/schema_hash.ts` is what its sources say it should be."""
    path = ROOT / schema.SCHEMA_DIR / schema.GENERATED
    rel = path.relative_to(ROOT)
    want = schema.client_source(ROOT)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return []
    if have is None:
        return [f"{rel}: missing -- it is generated, and nothing generated it"]
    moved = [n for n, d in schema.file_digests(ROOT).items()
             if f'"{n}": "{d}"' not in have]
    return [f"{rel}: stale"
            + (f" -- {', '.join(moved)} changed" if moved else "")]


#: A declaration file declares. `export function`, `export class` and a
#: `let`/`var` are code; `export const` is allowed because `SUPPORTED_FORMAT`
#: is a contract constant a bundle genuinely can disagree with.
RUNTIME_IN_DECL = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|let|var)\b", re.M)


def check_schema_sources() -> list[str]:
    """`schema.SOURCES` names every declaration file, and only those.

    Two failures, and the list closes both.

    The digest used to be taken over `web/src/bundle/*.ts`, so `stage.ts`'s
    loader was in it: `getJson`, the format checks, and every refusal string.
    Rewording one of those moved the hash and invalidated every bundle on
    disk, for an edit that cannot change a byte of a bundle.

    But an explicit list has the opposite failure -- a new declaration file
    that nobody adds to it is a block of the bundle **nothing checks**, which
    is worse than the glob and silent. So the directory is still read, and a
    `.ts` in it that is neither on the list nor the generated file nor a pure
    loader is a failure.
    """
    d = ROOT / schema.SCHEMA_DIR
    named = set(schema.SOURCES)
    out: list[str] = []
    for path in sorted(d.glob("*.ts")):
        name = path.name
        text = path.read_text(encoding="utf-8")
        declares = "export interface" in text or "export type" in text
        runtime = RUNTIME_IN_DECL.search(text)
        if name in named:
            if not path.exists():
                out.append(f"schema.SOURCES names {name}, which does not exist")
            if runtime:
                out.append(
                    f"{schema.SCHEMA_DIR}/{name} is hashed by the schema "
                    f"digest and declares `{runtime.group(0).strip()}` -- "
                    f"runtime code belongs in load.ts, or the file comes off "
                    f"schema.SOURCES")
            continue
        if name in (schema.GENERATED, "index.ts", "load.ts"):
            continue
        if declares:
            out.append(
                f"{schema.SCHEMA_DIR}/{name} declares part of the bundle and "
                f"is not in `schema.SOURCES` -- nothing checks that block "
                f"against the exporter")
    for name in sorted(named):
        if not (d / name).exists():
            out.append(f"schema.SOURCES names {name}, which does not exist")
    return out


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
    undocumented = check_module_list()
    decl_sources = check_schema_sources()

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
              "moved it:\n  python3 tools/regen_schema_hash.py\n"
              "`tools/export_player.py` does the same thing on every run.")
        return 1
    if decl_sources:
        for m in decl_sources:
            print(f"FAIL {m}")
        print("\nThe digest covers what a bundle can disagree with. "
              "Declarations go on `schema.SOURCES` in tools/hod2lib/schema.py; "
              "code that runs goes in web/src/bundle/load.ts.")
        return 1
    print(f"  {len(schema.file_digests(ROOT))} declaration files, digest "
          f"{schema.schema_hash(ROOT)[:16]}...\n")
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
