#!/usr/bin/env python3
"""Check the browser player's `game/` tree against the Ghidra annotations.

The porting rules in docs/PLAYER_ARCHITECTURE.md are only worth having if they
are enforced, and they are cheaply checkable because both sides are text:

  1. every `FUN_` address named in a `game/` doc comment exists in
     ghidra/annotations/functions.tsv, under the same name, and every `0x00…`
     address exists in globals.tsv under the name beside it;
  2. the coverage -- how much of the gameplay code has a port -- is a number;
  3. every `[diverges]` tag is gathered into one list;
  4. the class modules line up with `SpawnClass` and with the class table in
     docs/formats/spawns.md;
  5. the three ways state can escape a save snapshot are grepped for:
     three.js in `game/`, `Math.random(`, and `export let` in globals.ts;
  6. and the same citation rule is applied to `docs/`, which was the one edge
     nothing checked -- `combat.md` named `FUN_004073B0` as `SpawnImpactSprite`
     while the TSV called it something else entirely, and both were wrong.

Exit code is non-zero when a check fails. Run from anywhere.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "web" / "src" / "game"
FUNCS = ROOT / "ghidra" / "annotations" / "functions.tsv"
GLOBALS = ROOT / "ghidra" / "annotations" / "globals.tsv"
SCRIPT = ROOT / "web" / "src" / "script"
SPAWNS = ROOT / "docs" / "formats" / "spawns.md"
DOCS = ROOT / "docs"
#: The session log is a record of what was believed **when**, so it is full of
#: names that were later changed and that is the point of it. `/decomp` says
#: in as many words never to rewrite it; a check that demanded it be current
#: would be asking for exactly that.
DOCS_SKIP = {"session-log.md"}

# Two citation forms, and the difference matters.
#
#   definition   `ResolveHit` -- `FUN_00409430`      "this file ports it"
#   reference    `ZombieStateStrike` (`FUN_00455A40`) "this is where it lives"
#
# Both must agree with functions.tsv; only a definition has to be backed by a
# function of that name in the same file.
DEF = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`\s*[-—]+\s*`(FUN_[0-9A-Fa-f]{8})`")
REF = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`\s*\(`(FUN_[0-9A-Fa-f]{8})`\)")
ANY_FUN = re.compile(r"`(FUN_[0-9A-Fa-f]{8})`")
# `/** `g_attack_permits` -- `0x009A2BA0`, one per player. */`, and the same
# thing written as a trailing comment on the field itself.
GLOBAL_DOC = re.compile(
    r"`(g_[A-Za-z0-9_]+)`\s*[-—]+\s*`?0x([0-9A-Fa-f]{6,8})`?")
DIVERGES = re.compile(r"\[diverges\]")

failures: list[str] = []
notes: list[str] = []


def annotations(path: Path = FUNCS) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        out[parts[0].lower()] = parts[1]
    return out


def game_files() -> list[Path]:
    return sorted(p for p in GAME.rglob("*.ts"))


def cited_files() -> list[Path]:
    """Everything whose exe citations are checked.

    Wider than `game_files()`: `web/src/script/` ports the event VM's opcode
    handlers, which are exe functions like any other, and their citations went
    unchecked while this only looked under `game/`. The boundary and coverage
    checks stay on `game/` -- `script/` legitimately touches the DOM, and the
    opcode handlers are not the gameplay call graph coverage is measuring.
    """
    return game_files() + sorted(p for p in SCRIPT.rglob("*.ts"))


def check_names(named: dict[str, str]) -> dict[str, tuple[str, str]]:
    """Rule 1: one exe function, one TS function, same name.

    Returns the ports found, keyed by **address** rather than by name. Keying
    by name was how one exe function came to be transcribed twice with
    different bodies (`FUN_0044AD60`, once in `class31/death.ts` retiring from
    both counts and once privately in `class31/scripted.ts` releasing only the
    permit): the set swallowed the second, and the thrower's counts diverged
    depending on which exit it took. An address is the identity the rule is
    actually about.
    """
    ported: dict[str, tuple[str, str]] = {}
    unnamed: set[str] = set()
    for path in cited_files():
        text = path.read_text()
        rel = path.relative_to(ROOT)
        cited: set[str] = set()

        def cite(name: str, fun: str, is_def: bool) -> None:
            addr = fun[4:].lower()
            cited.add(addr)
            real = named.get(addr)
            if real is None:
                failures.append(
                    f"{rel}: {fun} is cited as `{name}` but is not in "
                    f"functions.tsv -- name it there first (/decomp)")
                return
            if real != name:
                # This is the check that catches a rename applied in Ghidra and
                # in the TSV but not here.
                failures.append(
                    f"{rel}: says `{name}` for {fun}, functions.tsv says "
                    f"`{real}`")
                return
            if not is_def:
                return
            # One exe function, one TS function -- the port's first rule, and
            # until now nothing checked it across files.
            prev = ported.get(addr)
            if prev is not None and prev[1] != str(rel):
                failures.append(
                    f"{rel}: {fun} (`{real}`) is also ported in {prev[1]} -- "
                    f"one exe function, one TS function; make one of them "
                    f"call the other")
            ported[addr] = (real, str(rel))
            # A definition must actually be declared, or the doc is decoration.
            if not re.search(rf"\b(function|const)\s+{re.escape(name)}\b", text):
                failures.append(
                    f"{rel}: documents `{name}` -- {fun} as a port but declares "
                    f"no such function; cite it as `{name}` ({fun}) instead")

        for name, fun in REF.findall(text):
            cite(name, fun, is_def=False)
        refs = {(n, f) for n, f in REF.findall(text)}
        for name, fun in DEF.findall(text):
            if (name, fun) in refs:
                continue        # the reference form also matches the dash one
            cite(name, fun, is_def=True)

        # A bare address with no name beside it is a pointer at something
        # Ghidra has not named. Legitimate -- an unread class handler is still
        # worth citing -- but counted, so it does not become the norm.
        for fun in ANY_FUN.findall(text):
            if fun[4:].lower() not in cited and fun[4:].lower() not in named:
                unnamed.add(fun)
    if unnamed:
        notes.append(f"unnamed citations: {len(unnamed)} -- "
                     + ", ".join(sorted(unnamed)))
    return ported


# Every exported function in `game/` should either cite the exe function it
# ports or say that it is scaffolding. 97 do neither today, and tagging all of
# them in one pass would mean asserting 97 things nobody has read -- several of
# them plainly *are* exe functions that were simply never cited
# (`ActorKillAll`, `CountEnemyZombieIn`, `GameUpdate`). So this is a ratchet in
# the sense `verify_layers.py` uses the word: the count may fall and may never
# rise. A new export must declare which kind it is; the backlog gets read down
# by whoever next opens the file with Ghidra beside them.
UNCITED_BASELINE = 96
EXPORT_FN = re.compile(r"^export (?:async )?function ([A-Za-z_][A-Za-z0-9_]*)",
                       re.M)
PORT_ONLY = re.compile(r"\[port-only\]")


def check_uncited_exports() -> None:
    """Rule 1's converse: an export that claims nothing about the exe."""
    uncited: list[str] = []
    for path in game_files():
        text = path.read_text()
        rel = path.relative_to(ROOT)
        defined = {n for n, _ in DEF.findall(text)}
        lines = text.splitlines()
        for i, line in enumerate(lines, 1):
            m = EXPORT_FN.match(line)
            if not m or m.group(1) in defined:
                continue
            # `[port-only]` anywhere in the enclosing comment block, on the
            # same terms as `[diverges]`: this file's scaffolding, no exe
            # function behind it.
            if PORT_ONLY.search(comment_block(lines, i - 1)):
                continue
            uncited.append(f"{rel}:{i} {m.group(1)}")
    n = len(uncited)
    status = "held" if n == UNCITED_BASELINE else (
        "IMPROVED -- lower the baseline" if n < UNCITED_BASELINE else "RISEN")
    notes.append(f"uncited exports: {n} of {UNCITED_BASELINE} baseline "
                 f"({status})")
    if n > UNCITED_BASELINE:
        for u in uncited:
            notes.append(f"  {u}")
        failures.append(
            f"uncited exports rose to {n} from a baseline of "
            f"{UNCITED_BASELINE} -- a new `export function` in game/ must "
            f"either cite the exe function it ports (`Name` -- `FUN_...`) or "
            f"be tagged [port-only]")


def check_globals(named: dict[str, str]) -> int:
    """Rule 1, for the data segment.

    A global renamed in Ghidra and not renamed here is the failure this
    catches: the address still resolves, the name beside it no longer matches,
    and the port quietly documents a symbol that no longer exists.
    """
    seen: set[str] = set()
    for path in cited_files():
        rel = path.relative_to(ROOT)
        for name, addr in GLOBAL_DOC.findall(path.read_text()):
            key = addr.lower().rjust(8, "0")
            real = named.get(key)
            if real is None:
                failures.append(f"{rel}: 0x{key.upper()} is not in globals.tsv")
            elif real != name:
                failures.append(
                    f"{rel}: doc says `{name}` for 0x{key.upper()}, "
                    f"globals.tsv says `{real}`")
            else:
                seen.add(real)
    notes.append(f"globals: {len(seen)} cited, all matching globals.tsv")
    return len(seen)


# The enemy, camera-director, player-damage and thrower code. Taken from where
# the ported functions actually live, so the denominator is the code this port
# is trying to cover rather than the whole binary.
GAMEPLAY_RANGES = [(0x00402800, 0x00403E00),   # the camera director
                   (0x00408C00, 0x0040B000),   # slots, ranking, class table
                   (0x00415200, 0x00415500),   # player damage
                   (0x00449000, 0x00451000),   # class 0x31
                   (0x00452C00, 0x0045E000)]   # class 0x30


def in_gameplay(addr: str) -> bool:
    a = int(addr, 16)
    return any(lo <= a < hi for lo, hi in GAMEPLAY_RANGES)


def check_coverage(named: dict[str, str],
                   ported: dict[str, tuple[str, str]]) -> None:
    """Rule 2: report the coverage over the gameplay address ranges.

    **Both halves of the fraction are filtered by the same ranges.** They were
    not: the denominator was the annotated functions inside the ranges above
    and the numerator was every ported definition anywhere, opcode handlers and
    classes 0x10/0x24/0x25/0x41 included -- all of which live outside them. The
    figure the architecture doc calls "the most honest progress metric this
    project could have" was reading about fifteen points high, in the flattering
    direction, and getting better every time a class outside the ranges was
    ported. The out-of-range ports are real work; they are reported on their own
    line rather than folded into a ratio they are not part of.
    """
    total = sum(1 for addr in named if in_gameplay(addr))
    inside = [a for a in ported if in_gameplay(a)]
    outside = len(ported) - len(inside)
    notes.append(f"coverage: {len(inside)} of {total} annotated gameplay "
                 f"functions have a port "
                 f"({100 * len(inside) // max(1, total)}%)")
    notes.append(f"  and {outside} ported functions outside the gameplay "
                 f"ranges (opcodes, classes 0x10/0x24/0x25/0x41)")


def comment_block(lines: list[str], i: int) -> str:
    """The prose of the comment `lines[i]` sits in, tag and markers stripped.

    Walks out in both directions over contiguous comment lines, so a reason
    written above the tag counts as much as one written after it.
    """
    def is_comment(t: str) -> bool:
        t = t.strip()
        return t.startswith(("*", "//", "/*"))

    lo = i
    while lo > 0 and is_comment(lines[lo - 1]):
        lo -= 1
    hi = i
    while hi + 1 < len(lines) and is_comment(lines[hi + 1]):
        hi += 1
    text = " ".join(lines[lo:hi + 1])
    for junk in ("[diverges]", "/**", "*/", "//", "*"):
        text = text.replace(junk, " ")
    return " ".join(text.split())


def check_divergences() -> None:
    """Rule 4: the places the port is knowingly wrong, in one list."""
    found: list[str] = []
    for path in game_files():
        lines = path.read_text().splitlines()
        for n, line in enumerate(lines, 1):
            if not DIVERGES.search(line):
                continue
            where = f"{path.relative_to(ROOT)}:{n}"
            found.append(where)
            # A tag with no prose around it is a confession with no content:
            # the count goes up and nobody can tell what the port does
            # instead. The reason is looked for in the whole comment block, in
            # both directions, because the convention here is to explain first
            # and tag last -- every existing divergence reads
            # "...and there the engine would simply never answer. [diverges]".
            if len(comment_block(lines, n - 1)) < 60:
                failures.append(
                    f"{where}: [diverges] with no reason around it -- say what "
                    f"the engine does and what this does instead")
    notes.append(f"divergences: {len(found)} declared")
    for f in found:
        notes.append(f"  {f}")


def check_classes() -> None:
    """Which spawn classes have behaviour, which are simply unread."""
    have = {d.name for d in GAME.iterdir()
            if d.is_dir() and d.name.startswith("class")}
    ported = {int(n[5:], 16) for n in have if n[5:].isalnum()}

    # Every class module must have a `SpawnClass` member, so no registry key is
    # ever a bare number. This is the rule that keeps the cat from running the
    # zombie's state machine.
    enum_src = (GAME / "spawn_class.ts").read_text()
    members = {int(v, 16): n for n, v in
               re.findall(r"^\s*([A-Z][A-Za-z0-9]*) = 0x([0-9a-fA-F]{2}),",
                          enum_src, re.M)}
    for c in sorted(ported):
        if c not in members:
            failures.append(f"game/class{c:02x}/ has no SpawnClass member; "
                            f"add one rather than keying the registry on 0x{c:02X}")

    # A row may cover several classes -- the doc groups them where the engine
    # does, `0x16`/`0x17` for the wave field and its sources, `0x27`, `0x28`
    # for the two path riders -- and splitting those to suit this parser would
    # be the tail wagging the dog. The placement count is per row, so a shared
    # row's count is attributed to its first class and the rest score zero;
    # that keeps the total honest, which is what the coverage line reports.
    ROW = re.compile(r"^\| ((?:`0x[0-9A-Fa-f]{2}`[/,] *)*`0x[0-9A-Fa-f]{2}`) "
                     r"\| [^|]+ \| ([\d/]+) \|", re.M)
    table: list[tuple[str, str]] = []
    for ids, counts in ROW.findall(SPAWNS.read_text()):
        found = re.findall(r"0x([0-9A-Fa-f]{2})", ids)
        # "6/8" gives a count per class; a single number covers the whole row.
        each = counts.split("/")
        for i, c in enumerate(found):
            table.append((c, each[i] if len(each) == len(found)
                          else (each[0] if i == 0 else "0")))
    if not table:
        failures.append("spawns.md: could not read the class table")
        return
    known = [(int(c, 16), int(n)) for c, n in table]
    covered = sum(n for c, n in known if c in ported)
    total = sum(n for _, n in known)
    notes.append(f"classes: {len(ported)} of {len(known)} read classes have a "
                 f"module, covering {covered} of {total} placements")
    for c, n in sorted(known, key=lambda x: -x[1])[:6]:
        if c not in ported:
            notes.append(f"  unported: 0x{c:02X}, {n} placements")
    for c in sorted(ported):
        if c not in {k for k, _ in known}:
            failures.append(f"game/class{c:02x}/ has no row in spawns.md")
    for c in sorted(members):
        if c not in {k for k, _ in known}:
            failures.append(f"SpawnClass 0x{c:02X} has no row in spawns.md")


def check_snapshot_rules() -> None:
    """The three ways state escapes a save. Each has one honest spelling."""
    for path in game_files():
        rel = path.relative_to(ROOT)
        text = path.read_text()
        if re.search(r'from\s+"three"', text):
            failures.append(f"{rel}: imports three -- game/ must run headless")
        if "Math.random(" in text:
            failures.append(
                f"{rel}: Math.random() -- draw from the world Rng, or a "
                f"snapshot cannot be replayed")
    globals_ts = GAME / "globals.ts"
    if re.search(r"^export let ", globals_ts.read_text(), re.M):
        failures.append("game/globals.ts: `export let` cannot be enumerated, "
                        "so it cannot be snapshotted -- put it in `G`")


def check_docs_citations(named: dict[str, str]) -> None:
    """`docs/` cites the binary too, and nothing was checking those.

    Only the two forms that assert *this name is this address* are tested --
    ``Name (`FUN_…`)`` and ``Name -- `FUN_…` `` -- because an arrow between a
    name and an address is a **call chain**, not a claim about identity, and
    the docs use arrows that way constantly.

    A disagreement fails: the doc and the TSV cannot both be right about what
    lives at an address, and the one thing worse than an unnamed routine is
    two names for it in two files. An address `docs/` cites that the TSV does
    not name at all is a *work list* rather than a failure -- it is a routine
    somebody read far enough to point at and not far enough to name, which is
    the honest state of a lot of this.
    """
    seen: dict[str, tuple[str, str]] = {}
    cited: set[str] = set()
    for path in sorted(DOCS.rglob("*.md")):
        if path.name in DOCS_SKIP:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(ROOT)
        for m in ANY_FUN.finditer(text):
            cited.add(m.group(1)[4:].lower())
        for pat in (DEF, REF):
            for m in pat.finditer(text):
                name, addr = m.group(1), m.group(2)[4:].lower()
                if addr in named and named[addr] != name:
                    failures.append(
                        f"{rel}: cites `{addr}` as `{name}`; "
                        f"functions.tsv says `{named[addr]}`")
                seen[addr] = (name, str(rel))
    unknown = sorted(a for a in cited if a not in named)
    notes.append(f"docs: {len(seen)} name/address citations checked against "
                 f"functions.tsv")
    if unknown:
        shown = ", ".join("FUN_" + a.upper() for a in unknown[:10])
        notes.append(f"  and {len(unknown)} addresses docs point at that "
                     f"Ghidra has not named: {shown}"
                     + (", ..." if len(unknown) > 10 else ""))


def main() -> int:
    if not GAME.is_dir():
        print(f"no {GAME}", file=sys.stderr)
        return 2
    named = annotations()
    ported = check_names(named)
    check_globals(annotations(GLOBALS))
    check_coverage(named, ported)
    check_uncited_exports()
    check_divergences()
    check_classes()
    check_snapshot_rules()
    check_docs_citations(named)

    for n in notes:
        print(n)
    print()
    if failures:
        for f in failures:
            print(f"FAIL {f}")
        print(f"\n{len(failures)} failed")
        return 1
    print(f"{len(ported)} ported functions check out against functions.tsv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
