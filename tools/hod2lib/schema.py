"""The digest that ties a bundle to the TypeScript that reads it.

`web/src/bundle/*.ts` is forty-odd interfaces hand-mirroring the dicts this
package emits. Nothing checked that the two agreed: `getJson<T>` is a bare
cast, so a field renamed on one side and not the other produced `undefined` at
the read site and a stage that rendered *almost* right. `BUNDLE_FORMAT` was
supposed to catch it and never moved, because bumping it is a thing a person
has to remember.

So the exporter hashes the declarations it is mirroring and writes the digest
into ``manifest.json``; the client compares it against the digest generated
into :mod:`web/src/bundle/schema_hash.ts` and refuses a bundle that does not
match. Nobody has to remember anything.

**What is hashed is the declarations, not the file.** Comments and whitespace
are stripped first (:func:`declarations`). A digest that changed when someone
fixed a typo in a doc comment would demand a full re-export for a change that
cannot affect a single byte of the bundle, and a check that expensive to
satisfy is a check that gets deleted. What survives the strip is exactly the
part a bundle can disagree with.

**The client's copy is generated, not maintained.** ``schema_hash.ts`` is
written by :func:`write_client_hash`, which every export calls, and is
committed. `tools/verify_exporters.py` re-derives it and fails if the
committed file is stale, so the generated file cannot drift from its sources
without a check saying so -- which is the whole point, one level down.

``schema_hash.ts`` is itself excluded from the digest: a file that contained
its own hash could not have one.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

__all__ = ["SCHEMA_DIR", "GENERATED", "SOURCES", "declarations", "file_digests",
           "schema_hash", "client_source", "write_client_hash"]

#: The interfaces the bundle is mirrored by, relative to the repository root.
SCHEMA_DIR = Path("web") / "src" / "bundle"
#: The generated file, which is excluded from its own digest.
GENERATED = "schema_hash.ts"

#: **The declaration files, named rather than globbed.**
#:
#: This was `d.glob("*.ts")` minus the generated file, which meant the digest
#: covered `stage.ts`'s loader as well as its interfaces -- `getJson`, the
#: format checks, and every refusal string in them. Rewording "Rebuild with
#: tools/export_player.py" moved the hash, which invalidated every bundle on
#: disk and demanded a full re-export, for an edit that cannot change one byte
#: of a bundle. The digest is supposed to be cheap to keep; a check that
#: expensive to satisfy is one that gets deleted.
#:
#: A bundle can disagree with a declaration. It cannot disagree with a
#: function. So the loader moved to `load.ts` and this list names what is
#: hashed -- and `verify_exporters.py` fails if a file on it grows runtime
#: code, or if a declaration file appears in the directory and is not on it.
#: A list that can silently omit a file would be worse than the glob.
SOURCES = ("cameras.ts", "characters.ts", "manifest.ts", "scene.ts",
           "script.ts", "sound.ts", "stage.ts")


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


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
    d = (root or _repo_root()) / SCHEMA_DIR
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
 * Written by `tools/hod2lib/schema.py` on every export and committed; re-run
 * `tools/export_player.py`, or `python3 -c` over that module, after changing
 * any declaration in this directory. `tools/verify_exporters.py` fails when
 * this file is stale, so it cannot quietly drift from its sources.
 *
 * The digest covers the *declarations* in `web/src/bundle/*.ts` -- comments
 * and whitespace are stripped before hashing -- so editing a doc comment
 * costs nothing and changing a field invalidates every bundle built before it.
 * See `docs/formats/bundle.md`.
 */

/** The per-file digests, so a mismatch can name the block that moved. */
export const SCHEMA_FILES: Readonly<Record<string, string>> = {{
{rows}}};

/** One digest over {{@link SCHEMA_FILES}}, in filename order. */
export const SCHEMA_HASH = "{schema_hash(root)}";
'''


def write_client_hash(root: Path | None = None) -> tuple[Path, bool]:
    """Regenerate :data:`GENERATED`. Returns ``(path, changed)``.

    Writes only when the content differs, so an export does not touch the
    working tree it did not need to.
    """
    root = root or _repo_root()
    path = root / SCHEMA_DIR / GENERATED
    want = client_source(root)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    if have == want:
        return path, False
    path.write_text(want, encoding="utf-8")
    return path, True
