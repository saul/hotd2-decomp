#!/usr/bin/env python3
"""Generate `docs/STATUS.md` -- every number this repo states about itself.

The problem this solves, stated plainly: a number written into prose is a
second source for a fact a checker already computes, and the second source
rots. `PLAYER_ARCHITECTURE.md` claimed 38,999 lines against a tree with
44,715, "82 declared `[diverges]`" against 99, and a port coverage figure
fifteen points from the one `verify_port.py` printed on the same commit.
`PLAN.md` claimed 202 named functions against 614. None of that was
carelessness; it is what hand-maintained numbers do.

So: **no prose document in this repo quotes a countable fact.** They link
here, and this file is generated. Everything in it is measured from the tree
on every run; nothing in it is typed by hand.

What stays in prose, deliberately: anything that is a *judgement* -- what a
directory is for, why a check is not redundant, what is worth doing next.
Those belong in `PLAYER_ARCHITECTURE.md`, `verify_all.py` and `PLAN.md`
respectively, in exactly one place each.

    python3 tools/status.py            # rewrite docs/STATUS.md
    python3 tools/status.py --check    # fail if it is out of date

`--check` is one of the checks in `verify_all.py`, which means a commit that
changes the tree and not this document fails. That friction is the point and
it costs one command; the alternative is what the two reviews found.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import verify_all
import verify_layers
import verify_port

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
OUT = ROOT / "docs" / "STATUS.md"

#: Directory -> layer. The layers themselves are argued in
#: `docs/PLAYER_ARCHITECTURE.md`; this is only which bucket a folder is in.
LAYER_OF = {
    "game": "engine", "script": "engine", "bundle": "engine", "core": "engine",
    "render": "render",
    "ui": "ui", "hud": "ui", "audio": "ui",
    "app": "app",
}


def src_files(d: Path) -> list[Path]:
    return sorted(p for p in d.rglob("*")
                  if p.suffix in (".ts", ".tsx") and p.is_file())


def tree_rows() -> list[tuple[str, int, int, str]]:
    rows = []
    for name, layer in LAYER_OF.items():
        d = SRC / name
        if not d.is_dir():
            continue
        files = src_files(d)
        lines = sum(len(p.read_text().splitlines()) for p in files)
        rows.append((name, lines, len(files), layer))
    return sorted(rows, key=lambda r: -r[1])


def largest(n: int) -> list[tuple[str, int]]:
    out = [(str(p.relative_to(SRC)), len(p.read_text().splitlines()))
           for p in src_files(SRC)]
    return sorted(out, key=lambda x: -x[1])[:n]


def interface_members(path: Path, name: str) -> int:
    """How many members an `export interface` declares.

    `PlayerCommands` against `PlayerView` is the player's standing measurement
    of how much of itself a click can reach, and the architecture doc argued
    from it with numbers that were three and eight out of date.
    """
    src = path.read_text()
    m = re.search(r"export interface %s\b[^{]*\{" % re.escape(name), src)
    if not m:
        return 0
    i, depth, n = m.end(), 1, 0
    while depth and i < len(src):
        j = src.find("\n", i)
        if j < 0:
            break
        line, i = src[i:j], j + 1
        depth += line.count("{") - line.count("}")
        if depth >= 1 and re.match(
                r"\s*(?:readonly\s+)?[A-Za-z_][A-Za-z0-9_]*\s*[?(:]", line):
            n += 1
    return n


def tsv_rows(path: Path) -> int:
    return sum(1 for line in path.read_text().splitlines()
               if line and not line.startswith("#"))


def count_diverges() -> int:
    return sum(len(verify_port.DIVERGES.findall(p.read_text()))
               for p in verify_port.game_files())


def count_open() -> int:
    """`[open]` markers in the port: questions it is honest about not having
    answered. Together with the divergences, the two numbers that say how
    finished the transcription is."""
    return sum(p.read_text().count("[open]") for p in verify_port.game_files())


def count_uncited() -> int:
    """The uncited-export count, measured the way `verify_port` measures it."""
    n = 0
    for path in verify_port.game_files():
        text = path.read_text()
        defined = {d for d, _ in verify_port.DEF.findall(text)}
        lines = text.splitlines()
        for i, line in enumerate(lines, 1):
            m = verify_port.EXPORT_FN.match(line)
            if not m or m.group(1) in defined:
                continue
            if verify_port.PORT_ONLY.search(
                    verify_port.comment_block(lines, i - 1)):
                continue
            n += 1
    return n


def render() -> str:
    named = verify_port.annotations()
    ported = verify_port.check_names(named)
    n_in, n_range, n_out = verify_port.coverage_counts(named, ported)
    n_cls, n_known, cov_pl, all_pl = verify_port.class_counts()
    rules = verify_layers.build_rules()
    ratchets = [r for r in rules.values() if r.severity == "ratchet"]
    rows = tree_rows()
    total_lines = sum(r[1] for r in rows)
    total_files = sum(r[2] for r in rows)
    uncited = count_uncited()

    L: list[str] = []
    add = L.append

    add("<!-- GENERATED by tools/status.py. Do not edit; run the tool. -->")
    add("# Status")
    add("")
    add("Every countable fact this repo states about itself, measured from the")
    add("tree. **Generated by `tools/status.py`; do not edit by hand.** No")
    add("other document quotes these numbers -- they link here, because a")
    add("number written twice is a number that will disagree with itself.")
    add("")
    add("`python3 tools/verify_all.py` checks that this file still matches the")
    add("tree, so a change that moves a number and does not regenerate fails.")
    add("")
    add("What is *not* here, on purpose: anything that is a judgement rather")
    add("than a measurement. What each directory is for is in")
    add("[`PLAYER_ARCHITECTURE.md`](PLAYER_ARCHITECTURE.md); what is worth")
    add("doing next is in [`PLAN.md`](PLAN.md); what each check uniquely sees")
    add("is in `tools/verify_all.py`, beside the command that runs it.")
    add("")

    add("## The browser player, by directory")
    add("")
    add("| Directory | Lines | Files | Layer |")
    add("|---|---:|---:|---|")
    for name, lines, files, layer in rows:
        add(f"| `{name}/` | {lines} | {files} | {layer} |")
    add(f"| **total** | **{total_lines}** | **{total_files}** | |")
    add("")
    add("The largest files, which is where the pressure to split next is:")
    add("")
    for rel, n in largest(5):
        add(f"* `{rel}` — {n}")
    add("")

    add("## The port")
    add("")
    add("| | |")
    add("|---|---|")
    add(f"| Gameplay coverage | **{n_in} of {n_range}** annotated functions in "
        f"the gameplay address ranges have a port "
        f"({100 * n_in // max(1, n_range)}%) |")
    add(f"| Ported outside those ranges | {n_out} (opcodes, and the classes "
        f"whose handlers sit elsewhere) |")
    add(f"| Citations checked | {len(ported)} ported functions match "
        f"`functions.tsv` under the same name |")
    add(f"| Spawn classes | **{n_cls} of {n_known}** read classes have a "
        f"module, covering {cov_pl} of {all_pl} placements |")
    add(f"| Declared `[diverges]` | **{count_diverges()}** — where the port "
        f"knowingly departs from the exe, each with its reason on the spot |")
    add(f"| `[open]` markers in `game/` | **{count_open()}** — questions the "
        f"port is honest about not having answered |")
    add("")
    n_cmd = interface_members(SRC / "app" / "commands.ts", "PlayerCommands")
    n_view = interface_members(SRC / "app" / "projection" / "player.ts",
                               "PlayerView")
    add(f"The two declared seams between the UI and the player: "
        f"**`PlayerCommands` has {n_cmd} members against `PlayerView`'s "
        f"{n_view}** — how much of the player a click can move, against how "
        f"much of it the page can see. Neither can grow without a line "
        f"appearing in the open.")
    add("")

    add("## The decomp")
    add("")
    add("| | |")
    add("|---|---|")
    add(f"| Named functions | {tsv_rows(ROOT / 'ghidra/annotations/functions.tsv')} "
        f"in `ghidra/annotations/functions.tsv` |")
    add(f"| Named globals | {tsv_rows(ROOT / 'ghidra/annotations/globals.tsv')} "
        f"in `ghidra/annotations/globals.tsv` |")
    verifiers = [p for p in (ROOT / "tools").glob("verify_*.py")
                 if p.name != "verify_all.py"]
    add(f"| Verifier scripts | {len(verifiers)} under `tools/`, run together "
        f"by `verify_all.py` |")
    add("")
    add("Phase and format status is a judgement about what counts as solved,")
    add("and lives in [`PROGRESS.md`](PROGRESS.md).")
    add("")

    add("## Ratchets")
    add("")
    add("A ratchet is a violation the architecture has not reached yet: a count")
    add("that may fall and may never rise, tied to the step of")
    add("[`PLAYER_ARCHITECTURE.md`](PLAYER_ARCHITECTURE.md#order-of-work) that")
    add("clears it. **Raising one is a change to that document, not a line edit")
    add("in a checker**, and there is deliberately no suppression comment.")
    add("")
    add("| Ratchet | Where | Now | Baseline |")
    add("|---|---|---:|---:|")
    add(f"| `uncited-exports` | `tools/verify_port.py` | {uncited} | "
        f"{verify_port.UNCITED_BASELINE} |")
    for r in ratchets:
        add(f"| `{r.name}` | `tools/verify_layers.py` | {len(r.hits)} | "
            f"{r.baseline} |")
    add("")
    if not ratchets:
        add(f"All {len(rules)} rules in `verify_layers.py` are `error` at zero;")
        add("a new violation of any of them fails the build rather than moving")
        add("a number. `uncited-exports` above is the only ratchet in the repo:")
        add("every exported function in `game/` should cite the exe function it")
        add("ports or declare itself `[port-only]`.")
        add("")

    add("## The checks")
    add("")
    add("Authored in `tools/verify_all.py` and rendered here, so there is one")
    add("list and not five. `python3 tools/verify_all.py` runs them all and")
    add("reports pass, fail and **skip** separately -- a check that asserted")
    add("nothing exits 3 and is never counted as green.")
    add("")
    add("| Check | What only it can see | Needs |")
    add("|---|---|---|")
    for c in verify_all.CHECKS:
        need = c.needs or "—"
        add(f"| `{c.name}` | {c.sees} | {need} |")
    add("")
    add("Two of them need the installed game and three need an exported")
    add("bundle. **That is a known hole, not a design:** a machine with")
    add("neither cannot run the checks that compare two histories, and a")
    add("bundle-free fixture is the open work that closes it.")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="fail if docs/STATUS.md is out of date")
    args = ap.parse_args()

    text = render()
    if not args.check:
        OUT.write_text(text)
        print(f"wrote {OUT.relative_to(ROOT)}")
        return 0

    if not OUT.exists():
        print(f"{OUT.relative_to(ROOT)} does not exist; "
              f"run `python3 tools/status.py`", file=sys.stderr)
        return 1
    if OUT.read_text() != text:
        import difflib
        old = OUT.read_text().splitlines()
        diff = list(difflib.unified_diff(old, text.splitlines(),
                                         "on disk", "measured", lineterm=""))
        print("\n".join(diff[:60]))
        print(f"\ndocs/STATUS.md is out of date -- "
              f"run `python3 tools/status.py`", file=sys.stderr)
        return 1
    print("docs/STATUS.md matches the tree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
