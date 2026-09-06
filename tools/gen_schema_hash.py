#!/usr/bin/env python3
"""Generate `web/src/bundle/schema_hash.ts` from the declarations beside it.

**The digest that ties a bundle to the TypeScript that reads it.**

`web/src/bundle/*.ts` is forty-odd interfaces mirroring the dicts the exporter
emits. Nothing checked that the two agreed: `getJson<T>` is a bare cast, so a
field renamed on one side and not the other produced `undefined` at the read
site and a stage that rendered *almost* right. `BUNDLE_FORMAT` was supposed to
catch it and never moved, because bumping it is a thing a person has to
remember.

So the digest is generated into :data:`GENERATED` and committed; the exporter
imports it and stamps it into `manifest.json`, and the client compares the two
and refuses a bundle that does not match. Nobody has to remember anything.

**This used to be `tools/hod2lib/schema.py`, and it moved when the Python
exporter went.** It was a library module because `export_player.py` called it
on every run; the TypeScript exporter is *compiled against* the declarations,
so it needs no such call -- but something still has to write the file the
compile reads, and that something is a repository tool, not a parser. It sits
beside `gen_rig_data.py`, which has the same shape and the same contract:
generate, `--check`, and a `verify_exporters.py` row that fails when the
committed copy is stale.

**What is hashed is the declarations, not the file.** Comments and whitespace
are stripped first (:func:`declarations`). A digest that changed when someone
fixed a typo in a doc comment would demand a full re-export for a change that
cannot affect a single byte of a bundle, and a check that expensive to satisfy
is a check that gets deleted.

    python3 tools/gen_schema_hash.py            # write, if it changed
    python3 tools/gen_schema_hash.py --check    # exit 1 if stale
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: The interfaces the bundle is mirrored by, relative to the repository root.
SCHEMA_DIR = Path("web") / "src" / "bundle"
#: The generated file, which is excluded from its own digest.
GENERATED = "schema_hash.ts"

#: **The declaration files, named rather than globbed.**
#:
#: This was `d.glob("*.ts")` minus the generated file, which meant the digest
#: covered `stage.ts`'s loader as well as its interfaces -- `getJson`, the
#: format checks, and every refusal string in them. Rewording "rebuild the
#: bundle" moved the hash, which invalidated every bundle on disk and demanded
#: a full re-export, for an edit that cannot change one byte of a bundle.
#:
#: A bundle can disagree with a declaration. It cannot disagree with a
#: function. So the loader lives in `load.ts` and this list names what is
#: hashed -- and :func:`check_sources` fails if a file on it grows runtime
#: code, or if a declaration file appears in the directory and is not on it. A
#: list that can silently omit a file would be worse than the glob.
SOURCES = ("cameras.ts", "characters.ts", "manifest.ts", "scene.ts",
           "script.ts", "sound.ts", "stage.ts")


def declarations(text: str) -> str:
    """*text* with comments and runs of whitespace removed.

    A hand-rolled scanner rather than a regex because a regex for "`//` that is
    not inside a string" is either wrong or unreadable, and getting it wrong
    here means a digest that is stable when it should move. The state machine
    is four states and fits on a screen; TypeScript's template literals nest
    ``${...}`` but no declaration in `web/src/bundle/` uses one, and a nested
    brace would only ever end the literal early -- it cannot make a comment
    look like code or the reverse.
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in "\"'`":                       # a string: copy it whole
            quote = c
            out.append(c)
            i += 1
            while i < n:
                out.append(text[i])
                if text[i] == "\\":
                    if i + 1 < n:
                        out.append(text[i + 1])
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        out.append(c)
        i += 1
    return " ".join("".join(out).split())


def _sources(root: Path | None = None) -> list[Path]:
    d = (root or ROOT) / SCHEMA_DIR
    return [d / name for name in sorted(SOURCES)]


def file_digests(root: Path | None = None) -> dict[str, str]:
    """``{filename: sha256 of its declarations}``, sorted by filename.

    Per file rather than one number for the lot, so the client can name *which*
    block drifted. "the bundle does not match this client" is true and useless;
    "`scene.ts` and `script.ts` changed" is where to look.
    """
    return {p.name: hashlib.sha256(
        declarations(p.read_text(encoding="utf-8")).encode()).hexdigest()
        for p in _sources(root)}


def schema_hash(root: Path | None = None) -> str:
    """One digest over the per-file digests, in filename order."""
    h = hashlib.sha256()
    for name, digest in file_digests(root).items():
        h.update(name.encode())
        h.update(b"\0")
        h.update(digest.encode())
        h.update(b"\0")
    return h.hexdigest()


def client_source(root: Path | None = None) -> str:
    """The exact text :data:`GENERATED` must hold for this checkout."""
    files = file_digests(root)
    rows = "".join(f'  "{name}": "{digest}",\n'
                   for name, digest in files.items())
    return f'''/**
 * The schema digest this client was compiled against. **Generated file.**
 *
 * Written by `tools/gen_schema_hash.py` and committed; re-run it after
 * changing any declaration in this directory. `tools/verify_exporters.py`
 * fails when this file is stale, so it cannot quietly drift from its sources.
 *
 * The exporter imports {{@link SCHEMA_HASH}} and stamps it into
 * `manifest.json`, and `bundle/load.ts` refuses a bundle whose digest is not
 * this one -- so the exporter and the client agree by construction rather than
 * by anyone remembering.
 *
 * The digest covers the *declarations* in `web/src/bundle/*.ts` -- comments
 * and whitespace are stripped before hashing -- so editing a doc comment costs
 * nothing and changing a field invalidates every bundle built before it. See
 * `docs/formats/bundle.md`.
 */

/** The per-file digests, so a mismatch can name the block that moved. */
export const SCHEMA_FILES: Readonly<Record<string, string>> = {{
{rows}}};

/** One digest over {{@link SCHEMA_FILES}}, in filename order. */
export const SCHEMA_HASH = "{schema_hash(root)}";
'''


def check_sources(root: Path | None = None) -> list[str]:
    """`SOURCES` against the directory, in both directions.

    A declaration file that is not on the list is not hashed, so a bundle can
    disagree with it and nothing will say so; a file on the list that has grown
    runtime code makes the digest move for a reason a bundle cannot be wrong
    about.
    """
    root = root or ROOT
    d = root / SCHEMA_DIR
    out: list[str] = []
    for p in sorted(d.glob("*.ts")):
        # The two generated digests and the loader. `builder_hash.ts` is
        # `tools/gen_builder_hash.py`'s, and it is a constant rather than a
        # declaration a bundle can disagree with.
        if p.name in (GENERATED, "builder_hash.ts", "index.ts", "load.ts"):
            continue
        if p.name not in SOURCES:
            out.append(f"{p.name} is a declaration file and is not on "
                       f"gen_schema_hash.SOURCES, so nothing hashes it")
    for name in SOURCES:
        p = d / name
        if not p.is_file():
            out.append(f"SOURCES names {name}, which does not exist")
            continue
        body = declarations(p.read_text(encoding="utf-8"))
        # A declaration file declares. `function`, `=>` and `return` are the
        # three shapes runtime code takes, and none of them belongs in a file a
        # bundle is compared against.
        for token in ("function ", "=>", "return "):
            if token in body:
                out.append(f"{name} contains `{token.strip()}` -- it is on "
                           f"SOURCES, so it must hold declarations only; "
                           f"code that runs goes in web/src/bundle/load.ts")
                break
    return out


def write(root: Path | None = None) -> tuple[Path, bool]:
    """Regenerate :data:`GENERATED`. Returns ``(path, changed)``."""
    root = root or ROOT
    path = root / SCHEMA_DIR / GENERATED
    want = client_source(root)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return path, False
    path.write_text(want, encoding="utf-8")
    return path, True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed file is stale")
    args = ap.parse_args()

    bad = check_sources()
    if bad:
        for m in bad:
            print(f"FAIL {m}", file=sys.stderr)
        return 1

    path = ROOT / SCHEMA_DIR / GENERATED
    want = client_source()
    have = path.read_text(encoding="utf-8") if path.exists() else None
    rel = path.relative_to(ROOT)
    if args.check:
        if have == want:
            print(f"{rel} is current ({schema_hash()[:16]}...)")
            return 0
        print(f"{rel} is stale -- run `python3 tools/gen_schema_hash.py` and "
              f"commit it with the declaration change that moved it",
              file=sys.stderr)
        return 1
    if have == want:
        print(f"{rel} already current ({schema_hash()[:16]}...)")
        return 0
    path.write_text(want, encoding="utf-8")
    print(f"wrote {rel} ({schema_hash()[:16]}...)")
    print("commit it in the same commit as the declaration change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
