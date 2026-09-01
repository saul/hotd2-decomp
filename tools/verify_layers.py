#!/usr/bin/env python3
"""Enforce the browser player's layer boundaries.

`docs/PLAYER_ARCHITECTURE.md` names three layers and the direction they may
depend in. This is the check that makes that real, because a boundary nobody
measures is a preference.

    engine   core/ bundle/ script/ game/   no three.js, no DOM, deterministic
    render   render/                       three.js. reads engine state
    ui       hud/                          reads a projection, emits commands
    app      app/                          the composition root; sees everything

Two severities, and the difference matters:

* **error** -- must be zero. A new one fails the build.
* **ratchet** -- a violation the architecture has not reached yet. The current
  count is recorded here against the step of the order of work that clears it.
  The build fails if the count **grows**. It never rises, and it is never
  quietly re-based to make a commit pass: lowering a baseline is the point,
  raising one is a decision that belongs in the architecture doc, not here.

That is the whole mechanism. There is no suppression comment and no per-file
opt-out, on purpose -- the escape hatch is to fix the layering or to change the
plan, not to annotate around it.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"

LAYER_OF = {
    "core": "engine", "bundle": "engine", "script": "engine", "game": "engine",
    "render": "render",
    "hud": "ui", "ui": "ui",
    "app": "app",
}

#: Who may import whom. The composition root sees everything; nothing sees it.
MAY_IMPORT = {
    "engine": {"engine"},
    "render": {"engine", "render"},
    "ui":     {"engine", "ui"},          # tightened to {"ui"} by step 11
    "app":    {"engine", "render", "ui", "app"},
}

IMPORT_RE = re.compile(r"""(?:from|import)\s+["']([^"']+)["']""")
EXE_CITE_RE = re.compile(r"FUN_00[0-9a-f]{6}|0x00[0-9A-Fa-f]{6}")
DOM_RE = re.compile(r"\b(document|window|HTMLElement|localStorage)\b")


def layer_of(path: Path) -> str | None:
    try:
        rel = path.relative_to(SRC)
    except ValueError:
        return None
    return LAYER_OF.get(rel.parts[0])


def resolve(importer: Path, spec: str) -> Path | None:
    """A relative import to the file it names, if it is inside src/."""
    if not spec.startswith("."):
        return None
    return (importer.parent / spec).resolve()


class Rule:
    def __init__(self, name, why, severity, baseline=0, step=None):
        self.name, self.why = name, why
        self.severity, self.baseline, self.step = severity, baseline, step
        self.hits: list[str] = []

    def hit(self, where: str) -> None:
        self.hits.append(where)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true",
                    help="print every violation, not just the first few")
    # Accepted and unused: the verifier suite passes it to every tools/verify_*
    ap.add_argument("--game-dir", default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"error: {SRC} not found", file=sys.stderr)
        return 2

    rules = {
        "layer-direction": Rule(
            "layer-direction",
            "a layer may only import from itself and the layers below it",
            "error"),
        "no-three-in-engine": Rule(
            "no-three-in-engine",
            "the port and the machine must run headless; three.js in either "
            "is state the snapshot cannot carry",
            "error"),
        "no-three-in-core": Rule(
            "no-three-in-core",
            "`Context` holds a `Scene` and a `PerspectiveCamera`, so the "
            "framework every System depends on is renderer-bound",
            "ratchet", baseline=1, step=9),
        "no-dom-in-engine": Rule(
            "no-dom-in-engine",
            "engine code that touches the DOM cannot be exercised headlessly",
            "error"),
        "no-math-random-in-engine": Rule(
            "no-math-random-in-engine",
            "a draw from the ambient generator is state a snapshot cannot "
            "restore; use the seeded Rng",
            "error"),
        "no-engine-truth-in-render": Rule(
            "no-engine-truth-in-render",
            "a transcribed exe routine in render/ is unreachable by "
            "test:port and verify_port.py -- that is where the stage-1 car "
            "bug lived",
            "ratchet", baseline=32, step=9),
        "no-engine-truth-in-ui": Rule(
            "no-engine-truth-in-ui",
            "same, for the UI layer",
            "ratchet", baseline=7, step=11),
        "ui-reads-projection-only": Rule(
            "ui-reads-projection-only",
            "the UI must read one plain projection and emit commands, not "
            "reach into the engine",
            "ratchet", baseline=17, step=11),
        "layers-are-systems": Rule(
            "layers-are-systems",
            "a layer ticked by hand from main.ts is outside World, so it is "
            "outside save/load/resync -- which is why a seek can leave a rig "
            "held in a pose play would never produce",
            "ratchet", baseline=14, step=8),
        "one-bams-constant": Rule(
            "one-bams-constant",
            "BAMS_TO_RAD defined per-file drifts; one definition in core/",
            "ratchet", baseline=9, step=12),
    }

    files = sorted(SRC.rglob("*.ts"))

    for f in files:
        lay = layer_of(f)
        if lay is None:
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8", errors="replace")
        # strip block and line comments for the token rules, so a rule name in
        # a doc comment is not a violation of itself
        code = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        code = re.sub(r"^\s*//.*$", "", code, flags=re.M)

        for spec in IMPORT_RE.findall(text):
            if spec == "three" or spec.startswith("three/"):
                if lay == "engine":
                    tgt = ("no-three-in-core" if f.parts[-2] == "core"
                           else "no-three-in-engine")
                    rules[tgt].hit(f"{rel}: imports three")
                continue
            tgt_path = resolve(f, spec)
            if tgt_path is None:
                continue
            tgt_lay = layer_of(tgt_path)
            if tgt_lay is None:
                continue
            if tgt_lay not in MAY_IMPORT[lay]:
                rules["layer-direction"].hit(
                    f"{rel}: {lay} imports {tgt_lay} ({spec})")
            elif lay == "ui" and tgt_lay == "engine":
                rules["ui-reads-projection-only"].hit(f"{rel}: {spec}")

        if lay == "engine":
            for m in DOM_RE.finditer(code):
                rules["no-dom-in-engine"].hit(f"{rel}: {m.group(0)}")
            for _ in re.finditer(r"Math\.random\s*\(", code):
                rules["no-math-random-in-engine"].hit(f"{rel}: Math.random(")
        if lay == "render":
            for m in EXE_CITE_RE.finditer(text):
                rules["no-engine-truth-in-render"].hit(f"{rel}: {m.group(0)}")
        if lay == "ui":
            for m in EXE_CITE_RE.finditer(text):
                rules["no-engine-truth-in-ui"].hit(f"{rel}: {m.group(0)}")
        if re.search(r"\bBAMS_TO_RAD\s*=", code):
            rules["one-bams-constant"].hit(str(rel))

    main_ts = SRC / "app" / "main.ts"
    if main_ts.is_file():
        body = main_ts.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"private drawLayers\(.*?\n  \}", body, flags=re.S)
        if m:
            for call in sorted(set(re.findall(r"this\.(\w+)\.(?:update|set)\b",
                                              m.group(0)))):
                rules["layers-are-systems"].hit(
                    f"web/src/app/main.ts: drawLayers ticks this.{call}")

    print("browser player -- layer boundaries\n")
    print(f"  {'rule':<28}{'sev':<9}{'count':>6}{'baseline':>10}   status")
    failed: list[Rule] = []
    for r in rules.values():
        n = len(r.hits)
        if r.severity == "error":
            ok = n == 0
            base = "0"
        else:
            ok = n <= r.baseline
            base = str(r.baseline)
        mark = "ok" if ok else "FAIL"
        if ok and r.severity == "ratchet" and n < r.baseline:
            mark = f"ok  (baseline can drop to {n})"
        elif ok and r.severity == "ratchet":
            mark = f"held (step {r.step})"
        if not ok:
            failed.append(r)
        print(f"  {r.name:<28}{r.severity:<9}{n:>6}{base:>10}   {mark}")

    shown = args.list
    for r in rules.values():
        if not r.hits:
            continue
        if r.severity == "error" or r in failed or shown:
            print(f"\n{r.name} -- {r.why}")
            for h in (r.hits if shown else r.hits[:8]):
                print(f"    {h}")
            if not shown and len(r.hits) > 8:
                print(f"    ... {len(r.hits) - 8} more (--list)")

    print()
    if failed:
        print(f"{len(failed)} rule(s) failed:")
        for r in failed:
            if r.severity == "ratchet":
                print(f"  {r.name}: {len(r.hits)} > baseline {r.baseline}. "
                      f"Step {r.step} clears it -- do not raise the baseline.")
            else:
                print(f"  {r.name}: must be zero.")
        return 1
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
