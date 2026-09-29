#!/usr/bin/env python3
"""Check the browser player's `game/` tree against the Ghidra annotations.

The porting rules in docs/PLAYER.md are only worth having if they
are enforced, and they are cheaply checkable because both sides are text:

  1. every `FUN_` address named in a `game/` doc comment exists in
     ghidra/annotations/functions.tsv, under the same name, and every `0x00…`
     address exists in globals.tsv under the name beside it;
  2. the coverage -- how much of the gameplay code has a port -- is a number;
  3. every `[diverges]` tag in a comment anywhere under `web/src/` is gathered
     into one list, and each must carry its reason;
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
SRC = ROOT / "web" / "src"
GAME = ROOT / "web" / "src" / "game"
FUNCS = ROOT / "ghidra" / "annotations" / "functions.tsv"
GLOBALS = ROOT / "ghidra" / "annotations" / "globals.tsv"
SCRIPT = ROOT / "web" / "src" / "script"
RENDER = ROOT / "web" / "src" / "render"
SPAWNS = ROOT / "docs" / "formats" / "spawns.md"
DOCS = ROOT / "docs"

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
#: The two markers `docs/STATUS.md` counts. See :func:`marker_lines` for what
#: counts as an occurrence, and `docs/PLAYER.md` for the rule
#: that keeps each one a single declaration.
DIVERGES_TAG = "[diverges]"
OPEN_TAG = "[open]"

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


def marker_files() -> list[Path]:
    """Every source file under `web/src/`, in every layer -- where a
    `[diverges]` or an `[open]` counts.

    This was three directories wide for `[diverges]` (`game/`, `script/`,
    `render/`, each added after tags in it had gone uncounted) and one for
    `[open]` (`game/` alone), while both markers were already written in
    `app/`, `ui/` and `hod2lib/` as well. A departure declared in the
    composition root is a departure, and a question the exporter has not
    answered is a question: the rule has to be the directory tree, not a list
    of the directories somebody has noticed. `.tsx` is included for `ui/`.

    Citations are deliberately **not** checked this wide. `render/` and the
    layers above it have different rules, and putting them under the
    one-function-one-name rule would be a separate decision about what that
    rule is for. This says only that a declared marker counts wherever it is
    written.
    """
    return sorted(p for p in SRC.rglob("*")
                  if p.suffix in (".ts", ".tsx") and p.is_file())


def divergence_files() -> list[Path]:
    """Everywhere a `[diverges]` counts: :func:`marker_files`."""
    return marker_files()


#: A `/` opens a regular expression, not a division, after one of these or
#: after one of the keywords below -- the usual heuristic, and enough for a
#: tree whose regex literals are all of that shape. :func:`check_marker_lexer`
#: pins the cases that matter here.
_REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_AFTER_WORDS = {"return", "typeof", "case", "do", "else", "in", "of",
                      "new", "delete", "void", "throw", "yield", "await",
                      "instanceof"}


def comment_spans(text: str) -> tuple[list[tuple[int, int]], bool]:
    """The `(start, end)` of every comment in a TypeScript source, and whether
    the scan ended back in code.

    A small lexer rather than a line test, because the markers are words that
    also occur in code: `ui/panels/Crumbs.tsx` has `}, [open]);` -- a React
    dependency array on a variable called `open` -- and `hod2lib/rigs_data.ts`
    has one inside a string the exporter writes into the bundle. Strings,
    template literals (with `${}` nesting) and regex literals are stepped over
    so that a `//` inside one is not taken for a comment. Quote strings and
    regex literals end at the line's end whatever happens, so a stray
    apostrophe in JSX text costs one line and not the rest of the file; a
    template or block comment that never closes is what the second value
    reports, and :func:`check_divergences` fails a file that leaves the lexer
    lost.
    """
    spans: list[tuple[int, int]] = []
    i, n = 0, len(text)
    templates: list[int] = []   # brace depth at each open `${`
    depth = 0
    prev, word = "", ""         # last significant code character, identifier
    while i < n:
        c = text[i]
        nx = text[i + 1] if i + 1 < n else ""
        if c == "/" and nx == "/":
            j = text.find("\n", i)
            j = n if j < 0 else j
            spans.append((i, j))
            i = j
            continue
        if c == "/" and nx == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            spans.append((i, j))
            i = j
            continue
        if c in "'\"":
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            i, prev, word = j + 1, c, ""
            continue
        if c == "`" or (c == "}" and templates and depth == templates[-1]):
            if c == "}":
                templates.pop()
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "`":
                    j += 1
                    break
                if text[j] == "$" and j + 1 < n and text[j + 1] == "{":
                    templates.append(depth)
                    j += 2
                    break
                j += 1
            else:
                j = n
            i, prev, word = j, "`", ""
            continue
        if c == "/" and (prev == "" or prev in _REGEX_AFTER
                         or word in _REGEX_AFTER_WORDS):
            j, in_class = i + 1, False
            while j < n and text[j] != "\n":
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "[":
                    in_class = True
                elif text[j] == "]":
                    in_class = False
                elif text[j] == "/" and not in_class:
                    break
                j += 1
            i, prev, word = j + 1, "/", ""
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        if c.isalnum() or c in "_$":
            joined = i > 0 and (text[i - 1].isalnum() or text[i - 1] in "_$")
            word = word + c if joined else c
            prev = "a"
        elif not c.isspace():
            prev, word = c, ""
        i += 1
    return spans, not templates


def marker_lines(text: str, token: str) -> tuple[list[int], bool]:
    """The 1-based line of every `token` that sits **in a comment**, one entry
    per occurrence; and whether the lexer ended back in code.

    A marker is a claim written in prose next to the code it is about, so the
    comment is what counts. Code is not a marker, and neither is a string --
    `rigs_data.ts`'s note is bundle data, and its question is already asked
    in `game/globals.ts`'s `g_app_state`.
    """
    spans, closed = comment_spans(text)
    out: list[int] = []
    for a, b in spans:
        k = text.find(token, a, b)
        while k >= 0:
            out.append(text.count("\n", 0, k) + 1)
            k = text.find(token, k + 1, b)
    return out, closed


def marker_counts(token: str) -> dict[str, int]:
    """Occurrences of `token` in comments, by top-level directory of
    `web/src/` -- the unit `verify_layers.LAYER_OF` assigns a layer to."""
    out: dict[str, int] = {}
    for path in marker_files():
        top = path.relative_to(SRC).parts[0]
        lines, _ = marker_lines(path.read_text(), token)
        out[top] = out.get(top, 0) + len(lines)
    return out


#: The lexer's own fixture: every shape above that has a marker in it, with
#: the lines that must count and the lines that must not.
_LEXER_FIXTURE = """\
const s = "a // not a comment [open]";  // [open] counts
const r = /[open]\\//g; // [diverges] counts, with a reason of its own here
const t = `${x /* [open] counts */} [open] template text does not`;
}, [open]);
/** [diverges] a
 * [open] b */
<p>don't [open]</p>
const u = a / b; // [open] after a division counts
"""


def check_marker_lexer() -> None:
    """Pin :func:`marker_lines` against :data:`_LEXER_FIXTURE`, so a change
    to the lexer that starts counting code -- or stops counting a comment --
    fails here rather than moving `STATUS.md`'s numbers in silence (`L41`)."""
    want = {OPEN_TAG: [1, 3, 6, 8], DIVERGES_TAG: [2, 5]}
    for token, lines in want.items():
        got, closed = marker_lines(_LEXER_FIXTURE, token)
        if got != lines or not closed:
            failures.append(
                f"marker lexer: {token} found on lines {got} of the fixture, "
                f"expected {lines} (closed: {closed})")


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
# ports or say that it is scaffolding. 91 do neither today -- 97 when this was
# written -- and tagging them all in one pass would mean asserting 91 things
# nobody has read; several of them plainly *are* exe functions that were simply
# never cited. Phase 3 read six of them down as a side effect of splitting the
# files they live in, which is the intended way for this number to move: it
# falls when someone opens the file for another reason with Ghidra beside them.
# So this is a ratchet in
# the sense `verify_layers.py` uses the word: the count may fall and may never
# rise. A new export must declare which kind it is; the backlog gets read down
# by whoever next opens the file with Ghidra beside them.
UNCITED_BASELINE = 81
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


def coverage_counts(named: dict[str, str],
                    ported: dict[str, tuple[str, str]]) -> tuple[int, int, int]:
    """(ported in range, annotated in range, ported outside the ranges).

    Split out of `check_coverage` so `tools/status.py` renders the same
    numbers from the same measurement rather than parsing this file's prose.
    A number quoted in a document and computed in a checker is two sources for
    one fact, and that is how the architecture doc came to claim a coverage
    figure fifteen points from the one the checker printed.
    """
    total = sum(1 for addr in named if in_gameplay(addr))
    inside = [a for a in ported if in_gameplay(a)]
    return len(inside), total, len(ported) - len(inside)


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
    n_inside, total, outside = coverage_counts(named, ported)
    notes.append(f"coverage: {n_inside} of {total} annotated gameplay "
                 f"functions have a port "
                 f"({100 * n_inside // max(1, total)}%)")
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
    """Rule 4: the places the port is knowingly wrong, in one list.

    Over :func:`cited_files`, not :func:`game_files`: ``web/src/script/`` is
    the same engine layer and it ports the event VM, so a divergence declared
    there is a divergence in the transcription exactly as one under ``game/``
    is. It walked ``game/`` alone until 2026-09-07, and the ten tags in
    ``script/`` -- including the whole of ``wait_script_flag``'s coverage
    escape, which is the largest single one in the port -- were declared and
    never counted. STATUS's number is "how finished the transcription is"; a
    number that cannot see a third of the engine is not that.

    Widened again on 2026-09-11, to :func:`divergence_files`, for the same
    reason one layer over: fifteen tags across eight files under ``render/``
    were declared and counted by nothing. ``render/`` is exactly where ported
    behaviour goes when it will not fit the engine layer, so it is the *last*
    place a departure should be invisible. And again to the whole of
    ``web/src/`` (:func:`marker_files`), when ``app/main.ts`` turned out to
    hold one more.

    An occurrence is one in a **comment** (:func:`marker_lines`), one per
    occurrence rather than one per line, which is also what ``STATUS.md``
    counts -- the two numbers used to be a line count here and a token count
    there, equal only while no line held two.
    """
    found: list[str] = []
    for path in divergence_files():
        text = path.read_text()
        lines = text.splitlines()
        tagged, closed = marker_lines(text, DIVERGES_TAG)
        if not closed:
            failures.append(
                f"{path.relative_to(ROOT)}: the marker lexer ended inside a "
                f"template literal or comment -- fix `comment_spans` before "
                f"believing any count from this file")
        for n in tagged:
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


def class_counts() -> tuple[int, int, int, int]:
    """(classes with a module, read classes, covered placements, placements).

    The measurement behind `check_classes`' report line, split out for
    `tools/status.py` on the same argument as `coverage_counts`. Returns
    zeroes if `spawns.md`'s table cannot be read; `check_classes` is the one
    that turns that into a failure.
    """
    ported, _members, known = read_class_table()
    if not known:
        return 0, 0, 0, 0
    covered = sum(n for c, n in known if c in ported)
    return len(ported), len(known), covered, sum(n for _, n in known)


def read_class_table() -> tuple[set[int], dict[int, str], list[tuple[int, int]]]:
    """The three things every class check reads: what the port has, what the
    `SpawnClass` enum names, and what `spawns.md` records."""
    have = {d.name for d in GAME.iterdir()
            if d.is_dir() and d.name.startswith("class")}
    ported = {int(n[5:], 16) for n in have if n[5:].isalnum()}

    enum_src = (GAME / "spawn_class.ts").read_text()
    members = {int(v, 16): n for n, v in
               re.findall(r"^\s*([A-Z][A-Za-z0-9]*) = 0x([0-9a-fA-F]{2}),",
                          enum_src, re.M)}

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
    known = [(int(c, 16), int(n)) for c, n in table]
    return ported, members, known


def check_classes() -> None:
    """Which spawn classes have behaviour, which are simply unread."""
    ported, members, known = read_class_table()
    if not known:
        failures.append("spawns.md: could not read the class table")
        return

    # Every class module must have a `SpawnClass` member, so no registry key is
    # ever a bare number. This is the rule that keeps the cat from running the
    # zombie's state machine.
    for c in sorted(ported):
        if c not in members:
            failures.append(f"game/class{c:02x}/ has no SpawnClass member; "
                            f"add one rather than keying the registry on 0x{c:02X}")

    n_ported, n_known, covered, total = class_counts()
    notes.append(f"classes: {n_ported} of {n_known} read classes have a "
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


#: `dt` is seconds of game time; a tick count derived from it by a bare
#: multiplication is a float. `core/play_cursor.ts` owns the conversion.
FRAME_MATH = re.compile(r"\bdt\s*\*\s*60\b")
TICK_SCOPE = ("game", "render")


def check_frame_math() -> None:
    """No hand-rolled seconds-to-ticks conversion.

    `dt * 60` looks exact and is not: `dt` is `frames * (1 / 60)`, and for 9 of
    the 241 tick counts a frame can carry -- 31, 62, 111, 123, 124, 125, 207,
    222 and 240 -- multiplying back gives 30.999999999999996 rather than 31.
    A counter decremented by that drifts off any exact comparison, and the port
    is full of them because the engine's own counters step by exactly one.

    It was exact *by accident*: every caller happens to hand over a whole
    number of frames' worth of time, which is a property of `Loop.advance`
    rather than of the arithmetic. `ticksOfSeconds` rounds, and its own
    docstring already named this hazard -- there were simply 20 sites that
    never adopted it, 19 in `game/` and one in `render/`.

    `core/play_cursor.ts` is where the conversion lives, so that `render/` can
    pose from the same cursor `game/` counts in without a value import across
    the layer line -- the same placement and the same argument as
    `BAMS_TO_RAD`. `game/` reaches it through `SecondsToTicks` in `tables.ts`.
    """
    bad: list[str] = []
    for name in TICK_SCOPE:
        for path in sorted((ROOT / "web" / "src" / name).rglob("*.ts")):
            for i, line in enumerate(path.read_text().splitlines(), 1):
                if line.lstrip().startswith(("*", "//")):
                    continue          # prose about the hazard is not the hazard
                if FRAME_MATH.search(line):
                    bad.append(f"{path.relative_to(ROOT)}:{i}: {line.strip()}")
    if bad:
        for b in bad:
            failures.append(f"hand-rolled tick conversion -- {b}")
        failures.append(
            "use `SecondsToTicks` (game/tables.ts) or `ticksOfSeconds` "
            "(core/play_cursor.ts); `dt * 60` is a float and the counters it "
            "feeds are compared exactly")
    else:
        notes.append(f"frame math: no hand-rolled `dt * 60` under "
                     f"{'/, '.join(TICK_SCOPE)}/")


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


def check_class31_literal_clips() -> None:
    """Every clip a class-0x31 state names as a literal must be baked.

    Class 0x31's motion ids mostly arrive through `g_class31_motion_sets` and
    the attack tables, and the exporter collects those from the data. A handful
    of states name a clip **inline** instead, and nothing collects those -- so
    `CLASS31_LITERAL_MOTIONS` in `web/src/hod2lib/class31.ts` is a hand-kept
    list, which is exactly the shape that goes stale. The port names the same
    ids in its own `const`s, and a clip missing from the list breaks a state
    silently:

    * `REARM_CLIP` (5), `ThrowerStateRearm` (`FUN_0044F7A0`). Without the clip
      the state ran with no motion, so its **midpoint** -- where the hands are
      re-armed -- never arrived. `ThrowerHasBareHand` (`FUN_0044F720`) stayed
      true for ever, `ThrowerStateStandAndDecide`'s
      `ThrowerTryEnterState(0x1D)` accepted every frame, and that **pre-empts**
      `ThrowerPickNextState` -- the only route to state 8. A `zsass` that had
      thrown once walked into the camera and never attacked again.
    * `GET_UP_CLIP` (0x11B), `ThrowerStateFallAndLand` (`FUN_0044A450`).

    So this is the producer and the consumer checked against each other, which
    is the only thing that could have caught either: a missing clip is not an
    error anywhere -- `MotionOf` simply returns nothing and the state falls
    through.
    """
    src = (ROOT / "web" / "src" / "hod2lib" / "class31.ts").read_text()
    m = re.search(r"export const CLASS31_LITERAL_MOTIONS = new Set\(\[(.*?)\]\)",
                  src, re.S)
    if not m:
        failures.append("web/src/hod2lib/class31.ts declares no "
                        "CLASS31_LITERAL_MOTIONS set")
        return
    body = re.sub(r"//[^\n]*", "", m.group(1))
    baked = {int(v, 0) for v in re.findall(r"\b(0x[0-9a-fA-F]+|\d+)\b", body)}
    if not baked:
        failures.append("CLASS31_LITERAL_MOTIONS in web/src/hod2lib/class31.ts "
                        "is empty or could not be read")
        return
    lit = re.compile(r"^const\s+([A-Z][A-Z0-9_]*(?:CLIP|MOTION))\s*"
                     r"(?::\s*number\s*)?=\s*(0x[0-9a-fA-F]+|\d+)\s*;", re.M)
    found = 0
    named_lits: set[tuple[str, int]] = set()
    for path in sorted((GAME / "class31").glob("*.ts")):
        for name, value in lit.findall(path.read_text()):
            found += 1
            n = int(value, 0)
            named_lits.add((name, n))
            if n in baked:
                continue
            failures.append(
                f"web/src/game/class31/{path.name}: {name} = {value} is not in "
                f"CLASS31_LITERAL_MOTIONS, so the exporter never bakes it and "
                f"the state it belongs to plays no clip at all")
    # ...and the same question of the bundle, when there is one. The list
    # being right is not the same as the clip surviving `bake`, which refuses a
    # motion whose implied bone count is not the character's.
    #
    # The claim is deliberately weak — **some** class-0x31 character carries
    # each id — because which types may reach which clip is a per-state rule
    # (state 29 is character 0x16's alone, state 2's get-up is every type but
    # 0x17) and asserting one this file has not read would be a guess. Baked
    # for nobody is the failure that actually happened.
    stages = sorted((ROOT / "extract" / "player").glob("stage*/stage*.script.json"))
    if not stages:
        notes.append(f"{found} class-0x31 literal clip ids check out against "
                     f"the exporter's bake list (no bundle to check them in)")
        return
    import json
    carried: set[int] = set()
    types31: set[int] = set()
    for path in stages:
        doc = json.loads(path.read_text())
        chars = doc.get("characters") or {}
        for p31 in chars.get("placements") or []:
            if p31.get("class") == 0x31:
                types31.add(p31["char_type"])
        for key, t in (chars.get("types") or {}).items():
            if int(key) not in types31:
                continue
            carried |= {int(m) for m in (t.get("motions") or {})}
    for name, n in sorted(named_lits):
        if n not in carried:
            failures.append(
                f"class-0x31 clip {name} = 0x{n:X} is baked for no character "
                f"type in extract/player -- the state that names it plays no "
                f"clip at all, and nothing else will say so")
    notes.append(f"{found} class-0x31 literal clip ids check out against the "
                 f"exporter's bake list and {len(stages)} exported stages")


def check_class33_selectors() -> None:
    """Class 0x33's decoded sub-handlers, producer against consumer.

    `ScriptedSceneryDispatch33` (`FUN_00432FF0`) switches ``obj+0x11C`` into
    eleven objects that read the same descriptor bytes eleven ways, and the
    port has three of them: selector 1 through the ``class33`` block,
    selector 4 through ``class33_push`` and selector 5 through
    ``class33_cue``. The port **takes which block arrived as the selector** --
    `director.ts` spawns on any being present and `ScriptedSceneryUpdate33`
    picks the routine off ``obj.hp`` -- so two things have to hold in the
    bundle and nothing else was checking either:

    1. **exactly one block per placement.** Two would be `L3` written into
       the bundle: selector 1's ``tail+0x0C`` is an ``op_`` path slot and
       selector 4's is a script flag index, and ``tail+0x00`` is a draw slot
       in both and selector 5's camera frame, so a spawn carrying two would
       have one handler's names over the other's bytes.
    2. **the draw slot travels.** Selector 4's model is named by the
       *descriptor*, not by the class, so it reaches the glTF only through
       `sceneryDrawSlots`. Without that the placement exists, the actor is
       made, the push works and the client has nothing to clone -- class
       0x52's old bug from the other side, and invisible from the port alone.

    This is the second half of what the stage-1 chair report needed. The first
    half is `port.test.ts`'s selector-4 block, which drives the routines; this
    is the half that says the numbers they drive on are in the file.
    """
    stages = sorted((ROOT / "extract" / "player").glob("stage*/stage*.script.json"))
    if not stages:
        notes.append("class 0x33's three tail blocks unchecked (no bundle)")
        return
    import json
    from struct import unpack_from
    n_carrier = n_push = n_cue = 0
    for path in stages:
        doc = json.loads(path.read_text())
        places = (doc.get("characters") or {}).get("placements") or []
        # **The script's own spawn records are the producer's input**, and they
        # are in the same file -- so the count comes from the data rather than
        # from a number written here, and narrowing `slot_drawn_spawn` back
        # fails this rather than quietly reporting a smaller total. `hp` is the
        # selector; 1, 4 and 5 are the three the port runs.
        want: dict[int, int] = {}
        for blk in doc.get("blocks") or []:
            for step in blk.get("steps") or []:
                for op in step.get("ops") or []:
                    for sp in op.get("spawns") or []:
                        if (sp.get("class") == 0x33
                                and sp.get("hp") in (1, 4, 5)):
                            want[sp["at"]] = sp["hp"]
        have = {p["at"] for p in places if p.get("class") == 0x33}
        for at, hp in sorted(want.items()):
            if at not in have:
                failures.append(
                    f"{path.parent.name} spawn {at:#06x}: selector {hp} is "
                    f"spawned by the script and has no placement, so "
                    f"`SpawnSlotActors` can never make it -- widen "
                    f"`slotDrawnSpawn` and `slot_drawn_spawn` together")
        push_slots: set[int] = set()
        cue_here = False
        for p in places:
            if p.get("class") != 0x33:
                continue
            carrier, push = p.get("class33"), p.get("class33_push")
            cue = p.get("class33_cue")
            at, hp = p.get("at", 0), p.get("hp")
            blocks = [k for k, v in (("class33", carrier),
                                     ("class33_push", push),
                                     ("class33_cue", cue)) if v]
            if len(blocks) > 1:
                failures.append(
                    f"{path.parent.name} spawn {at:#06x}: carries "
                    f"{' and '.join(f'`{k}`' for k in blocks)} -- sub-handlers' "
                    f"readings of the same bytes, which is `L3` in the bundle")
            if not blocks:
                failures.append(
                    f"{path.parent.name} spawn {at:#06x}: selector {hp} has a "
                    f"placement and no tail block, so `SpawnSlotActors` will "
                    f"refuse it and the placement is dead weight")
            if carrier:
                n_carrier += 1
                if hp != 1:
                    failures.append(
                        f"{path.parent.name} spawn {at:#06x}: `class33` on "
                        f"selector {hp}, but only selector 1 reads those bytes")
            if push:
                n_push += 1
                if hp != 4:
                    failures.append(
                        f"{path.parent.name} spawn {at:#06x}: `class33_push` "
                        f"on selector {hp}, but only selector 4 reads those "
                        f"bytes")
                slot = push.get("slot")
                if isinstance(slot, int) and slot > 0:
                    push_slots.add(slot)
                else:
                    failures.append(
                        f"{path.parent.name} spawn {at:#06x}: selector 4 with "
                        f"no draw slot -- nothing can be cloned for it")
            if cue:
                n_cue += 1
                cue_here = True
                if hp != 5:
                    failures.append(
                        f"{path.parent.name} spawn {at:#06x}: `class33_cue` "
                        f"on selector {hp}, but only selector 5 reads that "
                        f"word")
                # `ScriptedEffectAtCameraCue33` reads `tail+0x00` and nothing
                # else, as an integer camera frame. A block that grew a second
                # key has read past the one-word tail into the next record.
                if sorted(cue) != ["cue"] or not isinstance(cue.get("cue"), int):
                    failures.append(
                        f"{path.parent.name} spawn {at:#06x}: `class33_cue` is "
                        f"{cue!r}, not the one integer word selector 5 reads")
        if not push_slots and not cue_here:
            continue
        # ...and the model itself, out of the glb's own node names. The hidden
        # `slots_actor` rig is where `render/slotmodels.ts` finds a template,
        # and a missing part there is an actor that pushes and is not drawn.
        # Selector 5 draws nothing of its own; what it throws is a kind-0x44
        # sprite, whose cels `render/effects.ts` clones from `slots_effect` --
        # so a missing one there is an effect that fires and is not seen.
        glb = path.parent / f"{path.parent.name}.glb"
        if not glb.exists():
            continue
        raw = glb.read_bytes()
        off, names = 12, []
        while off + 8 <= len(raw):
            ln, typ = unpack_from("<I4s", raw, off)
            if typ == b"JSON":
                names = [n.get("name", "")
                         for n in json.loads(raw[off + 8:off + 8 + ln])["nodes"]]
                break
            off += 8 + ln
        for slot in sorted(push_slots):
            want = f"slots_actor_fixed000_slot_{slot:04x}"
            if want not in names:
                failures.append(
                    f"{path.parent.name}: selector-4 draw slot {slot:#06x} is "
                    f"in a placement but has no `{want}` part in the glTF -- "
                    f"the object is pushable and invisible")
        if cue_here:
            # `SpawnSpriteEffectFromParams`' `case 0x44:`, first and last slot.
            for slot in range(0xFD4, 0x1031 + 1):
                want = f"slots_effect_fixed000_slot_{slot:04x}"
                if want not in names:
                    failures.append(
                        f"{path.parent.name}: a selector-5 placement throws "
                        f"sprite kind 0x44, and its cel {slot:#06x} has no "
                        f"`{want}` part in the glTF -- the effect fires and "
                        f"draws nothing")
                    break
    notes.append(f"class 0x33: {n_carrier} selector-1, {n_push} selector-4 "
                 f"and {n_cue} selector-5 tails across {len(stages)} bundles, "
                 f"each with exactly one block, and a model to draw where it "
                 f"draws one")


#: The crawler's undamaged attack, as the EXE holds it at `0x00566E70`:
#: body condition 4's entry 2, ``{997, 1051, 26.0f, 40, 9, 1}``. Character type
#: 0xC is the only one the shipped data gives condition 4
#: (`web/tools/checks/split_unreachable.ts` holds that), so it is the only one
#: this asks about.
CRAWLER_TYPE = 0x0C
CRAWLER_CONDITION = 4
CRAWLER_INDEX = 2
CRAWLER_LUNGE = 1051
#: `g_class30_leap_strike_arc_script` (`0x00593180`) as the bundle names it.
CRAWLER_ARC_SCRIPT = "leap_strike"


def check_crawler_leap() -> None:
    """What a crawler attacks with has to be **in** the bundle.

    `ZombieStateHoldAtRange` sends body condition 4 to `ZombieStateLeapStrike`
    (`FUN_0045E330`) and never to `ZombieStateStrike` (``0x0045585E``), so a
    `znkager` reads its drawn entry for the lunge (``+0x02``), the distance it
    closes to (``+0x04``) and, through `ActorStrikeConnect` on landing, the
    overlay kind and cancel mask -- and **not** the strike clip or the hit
    frame, which is why the entry's hit frame of 40 on a 20-frame clip is not a
    whiff. It then flies `g_class30_leap_strike_arc_script`.

    This used to hold the opposite: that the entry's swing stays unreachable,
    because the crawler was believed to run `ZombieStateStrike` (`L92`). What
    can still go wrong is the bundle -- the entry dropped, the lunge not
    baked, or the arc script or its clips missing, any of which leaves the leap
    with nothing to play. Asked of every exported stage that places a type-0xC
    class-0x30 actor; with no bundle this is a note, as
    {@func:`check_class31_literal_clips`} does it.
    """
    stages = sorted((ROOT / "extract" / "player").glob("stage*/stage*.script.json"))
    if not stages:
        notes.append("the crawler's leap is unchecked (no bundle to look in)")
        return
    import json
    seen = 0
    for path in stages:
        doc = json.loads(path.read_text())
        chars = doc.get("characters") or {}
        placed = {p.get("char_type") for p in (chars.get("placements") or [])
                  if p.get("class") == 0x30}
        t = (chars.get("types") or {}).get(str(CRAWLER_TYPE))
        if CRAWLER_TYPE not in placed or t is None:
            continue
        rel = f"{path.parent.name}/{path.name}"
        motions = t.get("motions") or {}
        row = (t.get("attacks") or {}).get(str(CRAWLER_CONDITION)) or {}
        entry = row.get(str(CRAWLER_INDEX))
        if entry is None:
            failures.append(
                f"{rel}: body condition {CRAWLER_CONDITION} carries no attack "
                f"{CRAWLER_INDEX}, so an undamaged crawler's leap has no lunge, "
                f"no distance and no hit")
            continue
        if entry.get("lunge") != CRAWLER_LUNGE \
                or str(CRAWLER_LUNGE) not in motions:
            failures.append(
                f"{rel}: attack {CRAWLER_INDEX}'s lunge is "
                f"{entry.get('lunge')}, baked "
                f"{str(entry.get('lunge')) in motions} -- the crawler would "
                f"close on no clip")
            continue
        script = ((chars.get("combat") or {}).get("arc_scripts") or {}) \
            .get(CRAWLER_ARC_SCRIPT)
        if not script or len(script) != 3:
            failures.append(f"{rel}: no three-stage {CRAWLER_ARC_SCRIPT} arc "
                            f"script, so the leap flies with no clip")
            continue
        missing = [st["motion"] for st in script
                   if str(st["motion"]) not in motions]
        if missing:
            failures.append(f"{rel}: the leap's clips {missing} are not baked "
                            f"for character type 0xC")
            continue
        seen += 1
    if not seen:
        failures.append("no exported stage places a crawler, so nothing was "
                        "checked")
        return
    notes.append(f"the crawler's leap -- its entry, lunge and arc clips -- "
                 f"checks out in {seen} exported stages")



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
    check_marker_lexer()
    check_divergences()
    check_classes()
    check_snapshot_rules()
    check_frame_math()
    check_class31_literal_clips()
    check_class33_selectors()
    check_crawler_leap()
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
