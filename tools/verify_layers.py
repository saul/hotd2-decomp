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
    # `audio/` sits with `render/`: an output device that reads engine state
    # and owns nothing, which is the same contract. It was in `hud/`, where the
    # architecture doc had already noted it did not belong -- "bgm.ts -- audio,
    # not UI" -- and where it counted against a UI rule it could never satisfy,
    # because a track list is exactly the sort of bundle data an output device
    # has to read.
    "render": "render", "audio": "render",
    "hud": "ui", "ui": "ui",
    "app": "app",
}

#: Who may import whom. The composition root sees everything; nothing sees it.
MAY_IMPORT = {
    "engine": {"engine"},
    "render": {"engine", "render"},
    "ui":     {"ui"},                    # tightened from {"engine","ui"} by step 11
    "app":    {"engine", "render", "ui", "app"},
}

IMPORT_RE = re.compile(r"""(?:from|import)\s+["']([^"']+)["']""")
DOM_RE = re.compile(r"\b(document|window|HTMLElement|localStorage)\b")
#: `G.x = `, `G.x[i] = `, `G.x.y = ` -- an assignment, not a comparison.
G_WRITE_RE = re.compile(r"\bG\.\w+(?:\[[^\]]*\]|\.\w+)*\s*(?:[-+*/|&^]|\+\+|--)?=(?!=)")
#: A value (non-type) import from game/, and the names it brings in.
GAME_VALUE_IMPORT_RE = re.compile(
    r'import\s+(?!type\s)\{([^}]*)\}\s*(?:\n\s*)?from\s+"(\.\./game/[^"]+)"')
#: Every way there is of putting a node into the document.
#:
#: `document.createElement` is deliberately **not** here. Two calls build a
#: canvas to use as a texture -- `render/overlays.ts`'s `labelTexture` and
#: `render/shooting.ts`'s `splat` -- and neither element ever enters the
#: document, so they are not a second writer of anything. It is the *insertion*
#: that is the violation, not the construction.
DOM_INSERT_RE = re.compile(
    r"\.(?:appendChild|insertBefore|replaceChildren|insertAdjacentElement"
    r"|insertAdjacentHTML|prepend|append)\s*\(")


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
            "the framework every System depends on must not be renderer-bound "
            "-- `RenderContext` lives in render/, and `System` is generic over "
            "which context a layer takes",
            "error"),
        "no-dom-in-engine": Rule(
            "no-dom-in-engine",
            "engine code that touches the DOM cannot be exercised headlessly",
            "error"),
        "no-math-random-in-engine": Rule(
            "no-math-random-in-engine",
            "a draw from the ambient generator is state a snapshot cannot "
            "restore; use the seeded Rng",
            "error"),
        # This used to grep render/ for `FUN_00xxxxxx` and `0x00xxxxxx`. All
        # 32 hits were *citations in doc comments* -- the evidence CLAUDE.md
        # requires wherever a reading of the binary informs the code, several
        # of them saying outright that the routine itself lives in game/.
        # Driving that count to zero would have meant deleting the evidence
        # trail, so the measurement was re-aimed at what the rule always meant:
        # the renderer must not *be* the port.
        "no-engine-writes-in-render": Rule(
            "no-engine-writes-in-render",
            "render may read engine state and must never write it -- a "
            "renderer that changes `G` is gameplay that test:port cannot "
            "reach, which is where the stage-1 car bug lived",
            "error"),
        "render-drives-the-port": Rule(
            "render-drives-the-port",
            "an engine function *called* from render/ is a decision the port "
            "should be making; types, enums and pure maths are fine",
            "ratchet", baseline=13, step=11),
        # The same correction as its render twin, for the same reason: all
        # seven hits were citations in doc comments -- the sound name table's
        # address in bgm.ts, the routine hud.ts draws from. `hud/` never wrote
        # engine state at all, and the *reading* it does wrong is already
        # counted, in full, by `ui-reads-projection-only`.
        "no-engine-writes-in-ui": Rule(
            "no-engine-writes-in-ui",
            "the UI reads a projection and emits commands; a panel that "
            "writes `G` is a fourth way for state to enter the game",
            "error"),
        "ui-reads-projection-only": Rule(
            "ui-reads-projection-only",
            "the UI reads one plain projection and emits commands; an import "
            "from game/, script/ or bundle/ -- type-only included -- makes it "
            "a second reader of engine state with its own idea of when to look",
            "error"),
        "no-dom-insertion": Rule(
            "no-dom-insertion",
            "React renders every element on the page; a layer that inserts one "
            "into the document is a second owner of what is inside an element "
            "React renders, and the paint order it ends up with is an accident "
            "of which mounted first -- the layers are handed the nodes they "
            "write to, through UiHost",
            "error"),
        "layers-are-systems": Rule(
            "layers-are-systems",
            "a layer ticked by hand is outside World, so it is outside "
            "save/load/resync -- which is why a seek could leave a rig held "
            "in a pose play would never produce",
            "ratchet", baseline=1, step=5),
        "one-bams-constant": Rule(
            "one-bams-constant",
            "BAMS_TO_RAD belongs to core/bams.ts and nowhere else -- the nine "
            "per-file copies did not agree to six significant figures",
            "error"),
    }

    # `.tsx` too. The UI layer is written in it, so globbing only
    # `.ts` had `ui-reads-projection-only`, `no-engine-writes-in-ui`
    # and `layer-direction` printing `error 0 ok` without ever having
    # opened the files they exist to police.
    files = sorted([*SRC.rglob("*.ts"), *SRC.rglob("*.tsx")])

    for f in files:
        lay = layer_of(f)
        if lay is None:
            continue
        rel = f.relative_to(ROOT)
        text = f.read_text(encoding="utf-8", errors="replace")
        # strip block and line comments for the token rules, so a rule name in
        # a doc comment is not a violation of itself
        # Both substitutions keep the newlines they swallow, so a hit can quote
        # a line number that matches the file: the block one puts back as many
        # as the comment spanned, and the line one is anchored with `[ \t]*`
        # rather than `\s*` -- `\s` matches a newline, so a `//` comment with a
        # blank line above it used to eat that line and shift everything below
        # it up by one. Nothing else changes: the same comments come out.
        code = re.sub(r"/\*.*?\*/",
                      lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
        code = re.sub(r"^[ \t]*//.*$", "", code, flags=re.M)

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
            for m in G_WRITE_RE.finditer(code):
                rules["no-engine-writes-in-render"].hit(
                    f"{rel}: {m.group(0).strip()}")
            for names, spec in GAME_VALUE_IMPORT_RE.findall(text):
                # `game/vec.ts` is pure maths over plain numbers and holds no
                # state, so calling into it is not driving anything.
                if spec.endswith("/vec"):
                    continue
                for n in (x.strip() for x in names.split(",")):
                    if not n or n.startswith("type "):
                        continue
                    if re.search(r"\b" + re.escape(n) + r"\s*\(", code):
                        rules["render-drives-the-port"].hit(f"{rel}: {n}()")
        if lay == "ui":
            for m in G_WRITE_RE.finditer(code):
                rules["no-engine-writes-in-ui"].hit(
                    f"{rel}: {m.group(0).strip()}")
        # Every layer, `ui/` included: React is the one writer, and a component
        # that built its own children imperatively would be as wrong as a layer
        # that did. It went in at zero, with no exemptions, because step 26
        # left exactly zero -- the two sites it deleted were the whole list.
        for m in DOM_INSERT_RE.finditer(code):
            line = code.count("\n", 0, m.start()) + 1
            rules["no-dom-insertion"].hit(
                f"{rel}:{line}: {m.group(0).strip()}")
        # core/bams.ts is the one definition, so it is not a violation of
        # itself. Everywhere else, importing it is the only option.
        if (re.search(r"\bBAMS_TO_RAD\s*=", code)
                and f.name != "bams.ts"):
            rules["one-bams-constant"].hit(str(rel))

    # Every drawable layer must be in the tick order.
    #
    # This used to look for `drawLayers`, the one method that hand-ticked them
    # all -- which made the rule die the moment that method did. It now asks
    # the question the rule was always about: an exported class in `render/`
    # that has an `update` is a layer, and a layer that `app/` never hands to
    # `world.add` is ticked by hand or not at all.
    layers: dict[str, str] = {}                       # class name -> file
    for f in files:
        if f.parent.name != "render":
            continue
        cls = None
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"export class (\w+)", line)
            if m:
                cls = m.group(1)
            elif re.match(r"  (?:readonly )?update\(", line) and cls:
                layers[cls] = str(f.relative_to(ROOT))
                cls = None

    app = "\n".join(f.read_text(encoding="utf-8", errors="replace")
                    for f in files if f.parent.name == "app")
    # `world.add("render", new CameraDrawSystem(...))` names the class; the
    # commoner `world.add("render", this.rigs)` names a field, so the field's
    # own `= new RigLayer(` is what resolves it.
    fields = dict(re.findall(r"(\w+)(?:\s*:\s*[\w<>\[\]| ]+)?\s*=\s*new (\w+)\(",
                             app))
    registered = set(re.findall(r"world\.add\(\s*\"\w+\"\s*,\s*new (\w+)\(", app))
    for fld in re.findall(r"world\.add\(\s*\"\w+\"\s*,\s*this\.(\w+)\b", app):
        if fld in fields:
            registered.add(fields[fld])

    for cls, where in sorted(layers.items()):
        if cls not in registered:
            rules["layers-are-systems"].hit(f"{where}: {cls} is never world.add()ed")

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
