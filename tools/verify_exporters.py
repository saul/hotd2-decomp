#!/usr/bin/env python3
"""The exporter never swallows a failure, and its two digests are current.

Three checks over `web/src/hod2lib/` and `web/tools/export.ts`, the only code
that writes a bundle.

**A handler that gives something up says so.** A `catch` in the exporter that
answers a failure with an empty result is often right -- an install missing
one `pol/` file should still export, and refusing a stage because one prop
model will not parse would be worse than exporting without it. What is never
right is doing it silently: a parser regression then produces a valid bundle
with zero characters and exit code 0, and the player draws an empty stage,
which looks exactly like a gameplay bug. So every `catch` must, within a few
lines of code, record the loss through `degraded.note` (whose count reaches
`manifest.json` and the exporter's exit code), rethrow, push a warning the
stage JSON carries, print to stderr -- or declare with a reason that nothing is
lost, as `// not-a-loss: <reason>` on or just inside the handler.

**The digests are current.** `manifest.json` carries a hash of the declarations
in `web/src/bundle/*.ts`, which the client compares against the committed
`web/src/bundle/schema_hash.ts` and refuses a bundle on; and a hash of the
exporter's own code, which the client compares against `builder_hash.ts` and
marks a stage stale on. Both files are generated (`tools/gen_schema_hash.py`,
`tools/gen_builder_hash.py`). This re-derives them and fails when a committed
copy is stale, which is what makes the digests impossible to forget.

**`GameMode` is the exe's numbering in both places it is declared.** Its
values go into every bundle as `game_mode` and cross from the exporter to the
player untranslated, and a renumbering moves no declaration and so no digest.

Run from anywhere; exit code is non-zero when a check fails.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import gen_builder_hash                                         # noqa: E402
import gen_schema_hash                                          # noqa: E402

TS_LIB = ROOT / "web" / "src" / "hod2lib"
EXPORT_CLI = ROOT / "web" / "tools" / "export.ts"

#: Every `catch`, with or without a binding. The narrowness of what it catches
#: is not the question; whether the handler *says* something is, and that is
#: the same question for every handler.
ANY_CATCH = re.compile(r"\bcatch\b\s*(\([^)]*\))?\s*\{")

#: A handler carrying this, on the `catch` line or inside it, declares that
#: nothing was lost -- the failure *is* the answer. The reason is required.
NOT_A_LOSS = re.compile(r"//\s*not-a-loss:\s*\S")

#: What counts as saying something.
SAYS = re.compile(
    r"degraded\.note\(|\bnote\(|\bthrow\b|warnings\.push\(|console\.(error|warn)\(")

#: How many lines of code past the `catch` to look in. A handler that needs
#: more than this before it says anything is doing too much.
WINDOW = 6


def sources() -> list[Path]:
    out = sorted(TS_LIB.glob("*.ts")) + [EXPORT_CLI]
    return [p for p in out if p.is_file() and p.name != "degraded.ts"]


def is_comment(line: str) -> bool:
    s = line.lstrip()
    return s.startswith("//") or s.startswith("*") or s.startswith("/*")


def handler_body(lines: list[str], i: int) -> list[str]:
    """The lines of the `catch` block opening on line *i*, braces balanced.

    Braces inside strings and `//` comments are skipped; a handler body is
    simple enough that this is exact for every handler the exporter has.
    """
    depth, out, started = 0, [], False
    col = ANY_CATCH.search(lines[i]).end() - 1          # the opening `{`
    for j in range(i, len(lines)):
        text = lines[j][col:] if j == i else lines[j]
        out.append(lines[j])
        quote = None
        k = 0
        while k < len(text):
            c = text[k]
            if quote:
                if c == "\\":
                    k += 1
                elif c == quote:
                    quote = None
            elif c in "'\"`":
                quote = c
            elif text.startswith("//", k):
                break
            elif c == "{":
                depth += 1
                started = True
            elif c == "}":
                depth -= 1
                if started and depth == 0:
                    return out
            k += 1
    return out


def check_handlers() -> tuple[int, list[str]]:
    """Every `catch` in the exporter, and the ones that say nothing."""
    bad: list[str] = []
    total = 0
    for path in sources():
        lines = path.read_text(encoding="utf-8").splitlines()
        rel = path.relative_to(ROOT)
        for i, line in enumerate(lines):
            if is_comment(line) or not ANY_CATCH.search(line):
                continue
            total += 1
            body = handler_body(lines, i)
            if any(NOT_A_LOSS.search(ln) for ln in body):
                continue
            # The window counts *code*, not prose: a handler whose reason
            # takes eight lines of comment is the handler you want explained.
            head = line[ANY_CATCH.search(line).end():]
            code = [ln for ln in [head] + body[1:]
                    if ln.strip() and not is_comment(ln)]
            if SAYS.search("\n".join(code[:WINDOW])):
                continue
            bad.append(f"{rel}:{i + 1}: {line.strip()} -- says nothing")
    return total, bad


def check_schema_hash() -> list[str]:
    """The committed `schema_hash.ts` against the declarations it covers."""
    path = ROOT / gen_schema_hash.SCHEMA_DIR / gen_schema_hash.GENERATED
    want = gen_schema_hash.client_source(ROOT)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    return [] if have == want else [f"{path.relative_to(ROOT)} is stale"]


def check_builder_hash() -> list[str]:
    """The committed `builder_hash.ts` against the exporter it covers.

    The schema digest answers "can this client read the bundle"; this one
    answers "is the bundle what this exporter would write". A stale digest
    here is a bundle that is out of date and cannot be told so.
    """
    path = ROOT / gen_builder_hash.OUT_DIR / gen_builder_hash.GENERATED
    want = gen_builder_hash.client_source(ROOT)
    have = path.read_text(encoding="utf-8") if path.exists() else None
    return [] if have == want else [f"{path.relative_to(ROOT)} is stale"]


#: `g_GameMode` (0x009CA08C), from the title menu's own row order -- see
#: `TitleMenuRegisterSprites` (FUN_004962C0) and the note on either enum.
GAME_MODE = {"ARCADE": 0, "ORIGINAL": 1, "TRAINING": 2, "BOSS": 3}


def enum_members(path: Path) -> dict[str, int] | None:
    body = re.search(r"export enum GameMode \{(.*?)\n\}",
                     path.read_text(encoding="utf-8"), re.S)
    if not body:
        return None
    return {n: int(v) for n, v in
            re.findall(r"^\s*([A-Za-z_]+)\s*=\s*(\d+)\s*,", body.group(1), re.M)}


def check_game_mode() -> list[str]:
    """Both `GameMode` enums against the exe's numbering: the exporter's
    (`ARCADE`) and the player's (`Arcade`), which `game_mode` crosses between
    untranslated."""
    out: list[str] = []
    for path, spell in ((TS_LIB / "stage.ts", str.upper),
                        (ROOT / "web" / "src" / "game" / "game_mode.ts", str.title)):
        rel = path.relative_to(ROOT)
        found = enum_members(path)
        if found is None:
            out.append(f"{rel} declares no GameMode enum")
            continue
        want = {spell(k): v for k, v in GAME_MODE.items()}
        for name, v in want.items():
            if name not in found:
                out.append(f"{rel} GameMode has no {name}")
            elif found[name] != v:
                out.append(f"{rel} GameMode.{name} is {found[name]}, and "
                           f"g_GameMode's is {v}")
        for name in sorted(set(found) - set(want)):
            out.append(f"{rel} GameMode has member {name}, which g_GameMode "
                       f"does not")
    return out


def report(title: str, problems: list[str], fix: str, ok: str) -> bool:
    print(f"\n{title}\n")
    if problems:
        for m in problems:
            print(f"FAIL {m}")
        print(f"\n{fix}")
        return False
    print(f"  {ok}\n\nclean")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # Accepted and unused, so a caller may pass it to every check alike.
    ap.add_argument("--game-dir", default=None, help=argparse.SUPPRESS)
    ap.parse_args()

    total, silent = check_handlers()
    ok = report(
        "the exporter -- what a swallowed failure has to say", silent,
        "Record the loss with `degraded.note(where, what, lost, exc)` -- see "
        "web/src/hod2lib/degraded.ts -- or, if the failure *is* the answer and "
        "nothing is lost, say so on the handler with a `// not-a-loss: "
        "<reason>` comment.",
        f"{total} handlers, none of them silent")

    schema = check_schema_hash() + gen_schema_hash.check_sources(ROOT)
    ok &= report(
        "the schema digest the client compiles against", schema,
        "Regenerate it and commit it with the declaration change that moved "
        "it:\n  python3 tools/gen_schema_hash.py\nDeclarations go on `SOURCES` "
        "in tools/gen_schema_hash.py; code that runs goes in "
        "web/src/bundle/load.ts.",
        f"{len(gen_schema_hash.file_digests(ROOT))} declaration files, digest "
        f"{gen_schema_hash.schema_hash(ROOT)[:16]}...")

    ok &= report(
        "the exporter digest a bundle is stamped with", check_builder_hash(),
        "Regenerate it and commit it with the exporter change that moved it, "
        "then re-export (L33):\n  python3 tools/gen_builder_hash.py",
        f"{len(gen_builder_hash.file_digests(ROOT))} exporter files, digest "
        f"{gen_builder_hash.builder_hash(ROOT)[:16]}...")

    ok &= report(
        "GameMode, as g_GameMode numbers it", check_game_mode(),
        "The values travel in every bundle as `game_mode`; fix the enum, not "
        "this table.",
        "both enums are " + ", ".join(f"{k}={v}" for k, v in GAME_MODE.items()))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
