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
UNCITED_BASELINE = 91
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
    """
    found: list[str] = []
    for path in cited_files():
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
    `hod2lib.class31.CLASS31_LITERAL_MOTIONS` is a hand-kept list, which is
    exactly the shape that goes stale. The port names the same ids in its own
    `const`s, and the two halves had drifted twice:

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
    sys.path.insert(0, str(ROOT / "tools"))
    try:
        from hod2lib.class31 import CLASS31_LITERAL_MOTIONS as baked
    except ImportError as exc:                       # pragma: no cover
        failures.append(f"cannot read CLASS31_LITERAL_MOTIONS: {exc}")
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
    """Class 0x33's two decoded sub-handlers, producer against consumer.

    `ScriptedSceneryDispatch33` (`FUN_00432FF0`) switches ``obj+0x11C`` into
    eleven objects that read the same descriptor bytes eleven ways, and the
    port has two of them: selector 1 through the ``class33`` block and
    selector 4 through ``class33_push``. The port **takes which block arrived
    as the selector** -- `director.ts` spawns on either being present and
    `ScriptedSceneryUpdate33` picks the routine off ``obj.hp`` -- so two things
    have to hold in the bundle and nothing else was checking either:

    1. **exactly one block per placement.** Both would be `L3` written into
       the bundle: selector 1's ``tail+0x0C`` is an ``op_`` path slot and
       selector 4's is a script flag index, so a spawn carrying both would
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
        notes.append("class 0x33's two tail blocks unchecked (no bundle)")
        return
    import json
    from struct import unpack_from
    n_carrier = n_push = 0
    for path in stages:
        doc = json.loads(path.read_text())
        places = (doc.get("characters") or {}).get("placements") or []
        # **The script's own spawn records are the producer's input**, and they
        # are in the same file -- so the count comes from the data rather than
        # from a number written here, and narrowing `slot_drawn_spawn` back
        # fails this rather than quietly reporting a smaller total. `hp` is the
        # selector; 1 and 4 are the two the port runs.
        want: dict[int, int] = {}
        for blk in doc.get("blocks") or []:
            for step in blk.get("steps") or []:
                for op in step.get("ops") or []:
                    for sp in op.get("spawns") or []:
                        if sp.get("class") == 0x33 and sp.get("hp") in (1, 4):
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
        for p in places:
            if p.get("class") != 0x33:
                continue
            carrier, push = p.get("class33"), p.get("class33_push")
            at, hp = p.get("at", 0), p.get("hp")
            if carrier and push:
                failures.append(
                    f"{path.parent.name} spawn {at:#06x}: carries both "
                    f"`class33` and `class33_push` -- two sub-handlers' "
                    f"readings of the same bytes, which is `L3` in the bundle")
            if not carrier and not push:
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
        if not push_slots:
            continue
        # ...and the model itself, out of the glb's own node names. The hidden
        # `slots_actor` rig is where `render/slotmodels.ts` finds a template,
        # and a missing part there is an actor that pushes and is not drawn.
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
    notes.append(f"class 0x33: {n_carrier} selector-1 and {n_push} selector-4 "
                 f"tails across {len(stages)} bundles, each with exactly one "
                 f"block and a model to draw")


#: The crawlers' undamaged attack, as the EXE holds it at `0x00566E70`:
#: ``(character types, body condition, index, strike clip, hit frame)``.
#: Types 0x07, 0x0B and 0x0C share the row; `hod2lib.combat.attack_hit_lands`
#: is the long form and `tools/verify_combat.py` checks the numbers against
#: the EXE. Here they are only the join key into the bundle.
CRAWLER_TYPES = (0x07, 0x0B, 0x0C)
CRAWLER_CONDITION = 4
CRAWLER_INDEX = 2
CRAWLER_CLIP = 997
CRAWLER_HIT_FRAME = 40


def check_crawler_whiff() -> None:
    """The attack that is meant to miss has to be **in** the bundle to miss.

    `ZombieStateStrike` (`FUN_00455A40`) fires its hit on
    ``obj+0x19C == entry+0x08`` exactly (``00455bdf``) and leaves the state at
    ``g_motion_play_length[obj+0x1B4] - 1`` (``00455c0b``), so the shipped
    condition-4 entry of clip 997 at hit frame 40 -- against a play length of
    20 -- can never land. That is the engine's undamaged crawler, and it swings
    and misses every time.

    The exporter used to drop the entry as an impossible row, which left the
    port drawing an index the bundle had no attack for; the substitute behind
    that draw then handed the actor entry 3, a different clip at hit frame 3
    that connects, and **the crawlers hurt the player where the engine's do
    not**. There is nothing in `game/` left to check -- `ZombiePickAttack`
    indexes blind now, the same as the engine -- so the only thing that can go
    wrong again is the *bundle*, in either of two ways: the entry dropped
    again, or the entry kept and clip 997 not baked, which is
    `MotionPlayLength` 0 and a strike that ends on its first frame.

    Both are asked of every exported stage that places one of these character
    types. With no bundle this is a note, exactly as
    {@func:`check_class31_literal_clips`} does it -- a check that cannot run
    must not read as one that passed.
    """
    stages = sorted((ROOT / "extract" / "player").glob("stage*/stage*.script.json"))
    if not stages:
        notes.append("the crawler's unreachable hit frame is unchecked "
                     "(no bundle to look in)")
        return
    import json
    seen = 0
    for path in stages:
        doc = json.loads(path.read_text())
        chars = doc.get("characters") or {}
        placed = {p.get("char_type") for p in (chars.get("placements") or [])
                  if p.get("class") == 0x30}
        for key, t in (chars.get("types") or {}).items():
            ct = int(key)
            if ct not in CRAWLER_TYPES or ct not in placed:
                continue
            rel = f"{path.parent.name}/{path.name} type {ct:#04x}"
            row = (t.get("attacks") or {}).get(str(CRAWLER_CONDITION)) or {}
            entry = row.get(str(CRAWLER_INDEX))
            if entry is None:
                failures.append(
                    f"{rel}: body condition {CRAWLER_CONDITION} carries no "
                    f"attack {CRAWLER_INDEX}, so an undamaged crawler draws an "
                    f"index the bundle cannot satisfy -- the engine's own swing "
                    f"is missing and whatever the port does instead is not it")
                continue
            seen += 1
            if entry.get("strike") != CRAWLER_CLIP \
                    or entry.get("hit_frame") != CRAWLER_HIT_FRAME:
                failures.append(
                    f"{rel}: attack {CRAWLER_INDEX} is clip "
                    f"{entry.get('strike')} at hit frame "
                    f"{entry.get('hit_frame')}, not {CRAWLER_CLIP} at "
                    f"{CRAWLER_HIT_FRAME}")
                continue
            clip = (t.get("motions") or {}).get(str(CRAWLER_CLIP))
            if not clip:
                failures.append(
                    f"{rel}: attack {CRAWLER_INDEX} names clip "
                    f"{CRAWLER_CLIP} and the bundle does not bake it, so the "
                    f"swing has no length and ends on its first frame")
                continue
            play = clip.get("play") or 0
            if play <= 0 or entry["hit_frame"] < play:
                failures.append(
                    f"{rel}: clip {CRAWLER_CLIP} has play length {play}, "
                    f"which puts hit frame {entry['hit_frame']} back inside "
                    f"the clip -- the swing would connect")
    if not seen:
        failures.append("no exported stage places a crawler with its "
                        "condition-4 attack, so nothing was checked")
        return
    notes.append(f"the crawler's unreachable hit frame checks out in {seen} "
                 f"exported (stage, character type) pairs")


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
    check_frame_math()
    check_class31_literal_clips()
    check_class33_selectors()
    check_crawler_whiff()
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
