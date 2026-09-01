#!/usr/bin/env python3
"""Check that every id the player styles or looks up is one something renders.

`document.querySelector("#thing") as HTMLElement` is a lie the type system
cannot catch: a missing element is `null`, the cast hides it, and the first
`addEventListener` throws at startup with a clean `tsc` and a clean
`vite build` behind it. That has already happened once here -- a shell `cd`
failed, the markup edit never ran, the TypeScript compiled fine and the page
was dead on load.

This tool used to ask "is every id the player looks up present in
`web/index.html`?". Steps 15-16 moved the whole of the chrome into React, and
that question went vacuous the moment `index.html` became a nine-line mount
point: the check reported `1 ids referenced, 1 in index.html` and passed while
seven rules in `web/src/style.css` styled ids that nothing rendered any more.
`#frame-label`'s `min-width` was gone, so the frame slider reflowed on every
frame of playback; `#skip-go:disabled` was gone, so a skip you cannot take
looked identical to one you can; `#bgm-label.blocked` was gone, so the one
audio state that needs a click to clear had no way to say so.

So it asks the two questions that are load-bearing now, both of them errors
that must be zero:

* **styled-ids-are-rendered** -- every `#id` selector in the stylesheet is
  produced by something in `web/`. A CSS rule is silent when it matches
  nothing; nothing else in the build will ever tell you.
* **looked-up-ids-are-rendered** -- every id the code looks up is produced by
  something. This is what the old check protected, re-aimed at where the
  markup went.

"Produced by something" means a literal `id="foo"` in `web/index.html` or in
any `.tsx` under `web/src`, or an imperative `el.id = "foo"` in any `.ts`
there. An id built from an expression -- `<details id={id}>` in `Panel.tsx` --
is resolved at its call sites, which write the literal.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
HTML = ROOT / "web" / "index.html"
CSS = SRC / "style.css"

#: Only real lookups: `$("#feed")`, `$<HTMLInputElement>("#shoot")`,
#: `document.querySelector("#view")`, `getElementById("app")`. Matching any
#: `"#..."` string instead swept up CSS colours -- and `"#feed"` is four hex
#: digits, so excluding colours by shape would have quietly dropped a real one.
#: The type parameter is optional on both forms -- `querySelector<T>("#id")`
#: is how every lookup in `ui/` is written, and rejecting it is why this tool
#: reported `feed`, `tree-filter`, `globals` and `wait-body` as read by nothing.
SELECTOR = re.compile(
    r'(?:\$|querySelector(?:All)?)(?:<[^>()]*>)?\s*\(\s*'
    r'["\']#([A-Za-z][-\w]*)["\']'
    r'|getElementById\s*\(\s*["\']([A-Za-z][-\w]*)["\']')
#: Selectors built at runtime are out of scope; they are flagged, not resolved.
DYNAMIC = re.compile(r'querySelector(?:All)?\s*\(\s*`[^`]*\$\{')

ATTR_ID = re.compile(r'\bid="([A-Za-z][-\w]*)"')
#: `el.id = "crosshair"` -- the imperative way to put an id on the page.
PROP_ID = re.compile(r'\.id\s*=\s*["\']([A-Za-z][-\w]*)["\']')
#: An id in a selector, which is the only place in CSS an id can appear.
CSS_ID = re.compile(r'#([A-Za-z][-\w]*)')


def strip_ts_comments(text: str) -> str:
    """Comments out, the way `verify_layers.py` does it and for the same reason.

    A doc comment *describing* a lookup -- "this used to read
    `$("#hl-wait").checked` once a frame" -- is neither a lookup nor a
    definition, and counting one makes the history unwritable. There are
    several such comments in `ui/commands.ts` and `app/projection/player.ts`
    naming selectors that deliberately no longer happen. Whole-line `//` only,
    so a `https://` inside a string survives.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def css_selector_ids(sheet: str) -> set[str]:
    """The ids the stylesheet selects on, and nothing that merely looks like one.

    `#a33`, `#d7dee6`, `#ff8c1a` and eight more hex colours live in this sheet,
    and a bare `#[A-Za-z][-\\w]*` sweep reports every one of them as an id. A
    colour only ever appears inside a declaration block, so: drop the comments,
    cut the sheet at each `}`, and inside each chunk read ids from everything
    but the run after its last `{`, which is the declarations. Everything
    before is a selector list or an at-rule prelude -- taking only the text
    before the *first* `{` instead loses `#skipbar` and `#branchbar`, which
    this sheet also selects from inside a `@media (prefers-reduced-motion)`.
    """
    sheet = re.sub(r"/\*.*?\*/", "", sheet, flags=re.S)
    ids: set[str] = set()
    for chunk in sheet.split("}"):
        for part in chunk.split("{")[:-1]:
            ids.update(CSS_ID.findall(part))
    return ids


class Rule:
    def __init__(self, name, why, severity, baseline=0):
        self.name, self.why, self.severity = name, why, severity
        self.baseline = baseline
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

    for needed in (HTML, CSS):
        if not needed.is_file():
            print(f"no {needed}", file=sys.stderr)
            return 2

    # -- what the page produces ------------------------------------------
    rendered: dict[str, list[str]] = {}

    def produce(name: str, where: str) -> None:
        rendered.setdefault(name, []).append(where)

    # `index.html` is a mount point now, but `#app` still lives here and it is
    # the one id `app/ui_root.ts` cannot do without.
    markup = re.sub(r"<!--.*?-->", "", HTML.read_text(), flags=re.S)
    for name in ATTR_ID.findall(markup):
        produce(name, "web/index.html")

    # All of `web/src`, not just `ui/`: the renderer and the HUD put ids on
    # elements they create too, and an id is an id wherever it is written.
    wanted: dict[str, list[str]] = {}
    dynamic: list[str] = []
    for path in sorted([*SRC.rglob("*.ts"), *SRC.rglob("*.tsx")]):
        rel = str(path.relative_to(ROOT))
        code = strip_ts_comments(path.read_text())
        for name in ATTR_ID.findall(code):
            produce(name, rel)
        for name in PROP_ID.findall(code):
            produce(name, rel)
        for attr, byid in SELECTOR.findall(code):
            wanted.setdefault(attr or byid, []).append(rel)
        if DYNAMIC.search(code):
            dynamic.append(rel)

    styled = css_selector_ids(CSS.read_text())

    rules = {
        "styled-ids-are-rendered": Rule(
            "styled-ids-are-rendered",
            "a rule whose id nothing renders is a rule that does nothing, and "
            "CSS never says so -- this is how the frame slider lost the "
            "`min-width` that stops it reflowing on every frame",
            "error"),
        "looked-up-ids-are-rendered": Rule(
            "looked-up-ids-are-rendered",
            "a lookup that finds nothing is `null` behind a cast, and it "
            "throws at startup with a clean tsc behind it",
            "error"),
    }

    for name in sorted(styled):
        if name not in rendered:
            rules["styled-ids-are-rendered"].hit(
                f"web/src/style.css: #{name} is styled but nothing renders it")
    for name, files in sorted(wanted.items()):
        if name not in rendered:
            rules["looked-up-ids-are-rendered"].hit(
                f"#{name} is looked up in {', '.join(sorted(set(files)))} "
                f"but nothing renders it")

    print("browser player -- the ids the page styles and looks up\n")
    print(f"  {len(styled)} ids styled, {len(wanted)} looked up, "
          f"{len(rendered)} rendered\n")
    print(f"  {'rule':<28}{'sev':<9}{'count':>6}{'baseline':>10}   status")
    failed: list[Rule] = []
    for r in rules.values():
        n = len(r.hits)
        ok = n <= r.baseline
        if not ok:
            failed.append(r)
        print(f"  {r.name:<28}{r.severity:<9}{n:>6}{r.baseline:>10}   "
              f"{'ok' if ok else 'FAIL'}")

    if dynamic:
        print(f"\n  built at runtime, not checked: "
              f"{', '.join(sorted(set(dynamic)))}")

    for r in rules.values():
        if not r.hits:
            continue
        print(f"\n{r.name} -- {r.why}")
        for h in (r.hits if args.list else r.hits[:8]):
            print(f"    {h}")
        if not args.list and len(r.hits) > 8:
            print(f"    ... {len(r.hits) - 8} more (--list)")

    print()
    if failed:
        print(f"{len(failed)} rule(s) failed:")
        for r in failed:
            print(f"  {r.name}: must be zero.")
        return 1
    print("clean: every id the sheet styles and the code looks up is rendered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
