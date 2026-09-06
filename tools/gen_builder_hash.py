#!/usr/bin/env python3
"""Generate `web/src/bundle/builder_hash.ts` from the exporter that writes bundles.

**The digest that says a bundle is out of date.**

`tools/gen_schema_hash.py` ties a bundle to the declarations that *read* it, and
refuses one that does not match. This is the other half: what wrote it. A bundle
can agree with every declaration in `web/src/bundle/` and still be wrong,
because `web/src/hod2lib/` decided its contents -- and nothing in the contract
noticed when that changed.

That gap is not hypothetical. `nl1.drop_collapsed_uv_triangles` deleted 3-5% of
every stage's geometry, and turning it off changed no declaration and no
`BUNDLE_FORMAT`, so a stage already built into the browser's OPFS cache went on
winning over the freshly exported one -- indefinitely, and silently, with holes
in it. Rebuilding the tree did not help, because the stale copy was in the
browser rather than in `extract/player/`.

**This warns; it does not refuse.** A schema mismatch means the bundle cannot be
read correctly and must be rebuilt before it is used. An exporter change usually
means it *can* be read and may be a little out of date, which is a thing to tell
someone about, not a thing to stop them playing over. The client marks the stage
stale, the Bundle button says so, and rebuilding is one click.

**What is hashed is the code, not the file.** Comments and whitespace are
stripped, so a doc comment costs nothing -- but unlike the schema digest, the
bodies are hashed, because a body is exactly what decides a byte of output.

    python3 tools/gen_builder_hash.py            # write, if it changed
    python3 tools/gen_builder_hash.py --check    # exit 1 if stale
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_schema_hash import declarations  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

#: Everything that decides what goes in a bundle, relative to the repo root.
BUILDER_DIR = Path("web") / "src" / "hod2lib"
#: The generated file, which lives with the declarations that read a bundle
#: because both halves of the contract are imported from there.
OUT_DIR = Path("web") / "src" / "bundle"
GENERATED = "builder_hash.ts"


def sources(root: Path | None = None) -> list[Path]:
    """Every `.ts` under `hod2lib/`, globbed rather than named.

    The opposite decision from `gen_schema_hash.SOURCES`, and for the opposite
    reason. There the list exists to keep the loader's *text* out of a digest a
    bundle is compared against. Here every file is implementation and every one
    of them can change a byte of output, so a file this misses is a stale
    bundle nobody is warned about -- and a new module is exactly when that
    would happen.
    """
    return sorted((root or ROOT).joinpath(BUILDER_DIR).glob("*.ts"))


def file_digests(root: Path | None = None) -> dict[str, str]:
    """``{filename: sha256 of its code}``, sorted by filename."""
    return {p.name: hashlib.sha256(
        declarations(p.read_text(encoding="utf-8")).encode()).hexdigest()
        for p in sources(root)}


def builder_hash(root: Path | None = None) -> str:
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
    return f'''/**
 * The digest of the exporter that wrote a bundle. **Generated file.**
 *
 * Written by `tools/gen_builder_hash.py` and committed; it covers the code in
 * `web/src/hod2lib/`, which is the only thing that decides what a bundle
 * contains. `tools/verify_exporters.py` fails when this file is stale.
 *
 * The exporter stamps it into `manifest.json` and onto every stage entry, and
 * `bundle/load.ts` compares -- but **warns rather than refuses**. A schema
 * mismatch means a bundle cannot be read; an exporter change usually means it
 * can be read and is merely out of date. See {{@link stageBuilderStale}}.
 *
 * The gap this closes: `nl1.dropCollapsedUvTriangles` was deleting 3-5% of
 * every stage, and turning it off moved no declaration and no `BUNDLE_FORMAT`
 * -- so a stage already built into the browser's OPFS cache kept winning over
 * the rebuilt one, with holes in it, however many times the tree was exported.
 */

/** The per-file digests, so a stale bundle can name what moved. */
export const BUILDER_FILES: Readonly<Record<string, string>> = {{
{"".join(f'  "{n}": "{d}",\n' for n, d in file_digests(root).items())}}};

/** One digest over {{@link BUILDER_FILES}}, in filename order. */
export const BUILDER_HASH = "{builder_hash(root)}";
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed file is stale")
    args = ap.parse_args()

    path = ROOT / OUT_DIR / GENERATED
    want = client_source()
    have = path.read_text(encoding="utf-8") if path.exists() else None
    rel = path.relative_to(ROOT)
    if args.check:
        if have == want:
            print(f"{rel} is current ({builder_hash()[:16]}...)")
            return 0
        print(f"{rel} is stale -- run `python3 tools/gen_builder_hash.py` and "
              f"commit it with the exporter change that moved it",
              file=sys.stderr)
        return 1
    if have == want:
        print(f"{rel} already current ({builder_hash()[:16]}...)")
        return 0
    path.write_text(want, encoding="utf-8")
    print(f"wrote {rel} ({builder_hash()[:16]}...)")
    print("commit it in the same commit as the exporter change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
