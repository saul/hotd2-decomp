#!/usr/bin/env python3
"""Check that every `#id` the player looks up exists in web/index.html.

`document.querySelector("#thing") as HTMLElement` is a lie the type system
cannot catch: a missing element is `null`, the cast hides it, and the first
`addEventListener` throws at startup with a clean `tsc` and a clean
`vite build` behind it. That has already happened once here -- a shell `cd`
failed, the markup edit never ran, the TypeScript compiled fine and the page
was dead on load.

So: collect every literal `#id` selector in `web/src`, collect every `id=` in
`web/index.html`, and require the first to be a subset of the second. Also
reports ids in the markup that nothing reads, which is how a renamed control
leaves a stale one behind.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
HTML = ROOT / "web" / "index.html"

#: Only real lookups: `$("#feed")`, `$<HTMLInputElement>("#shoot")`,
#: `document.querySelector("#view")`. Matching any `"#..."` string instead
#: swept up CSS colours -- and `"#feed"` is four hex digits, so excluding
#: colours by shape would have quietly dropped a real one.
#: The type parameter is optional on both forms -- `querySelector<T>("#id")`
#: is how every lookup in `ui/` is written, and rejecting it is why this tool
#: reported `feed`, `tree-filter`, `globals` and `wait-body` as read by nothing.
SELECTOR = re.compile(
    r'(?:\$|querySelector(?:All)?)(?:<[^>()]*>)?\s*\(\s*'
    r'["\']#([A-Za-z][-\w]*)["\']')
#: Selectors built at runtime are out of scope; they are flagged, not resolved.
DYNAMIC = re.compile(r'querySelector(?:All)?\s*\(\s*`[^`]*\$\{')

ID = re.compile(r'\bid="([^"]+)"')


def main() -> int:
    if not HTML.is_file():
        print(f"no {HTML}", file=sys.stderr)
        return 2
    markup = set(ID.findall(HTML.read_text()))

    wanted: dict[str, list[str]] = {}
    dynamic: list[str] = []
    # `.tsx` too: the UI layer is written in it.
    for path in sorted([*SRC.rglob("*.ts"), *SRC.rglob("*.tsx")]):
        text = path.read_text()
        rel = str(path.relative_to(ROOT))
        for name in SELECTOR.findall(text):
            wanted.setdefault(name, []).append(rel)
        if DYNAMIC.search(text):
            dynamic.append(rel)

    missing = {k: v for k, v in wanted.items() if k not in markup}
    unread = sorted(markup - set(wanted))

    print(f"player DOM: {len(wanted)} ids referenced, {len(markup)} in "
          f"index.html")
    if unread:
        # Not a failure: the markup legitimately carries ids for CSS and for
        # anchors. Worth printing so a renamed control does not leave a ghost.
        print(f"  no code reads: {', '.join(unread)}")
    if dynamic:
        print(f"  built at runtime, not checked: {', '.join(sorted(set(dynamic)))}")

    if not missing:
        print("clean: every id the player looks up is in the markup")
        return 0
    for name, files in sorted(missing.items()):
        print(f"FAIL #{name} is looked up in {', '.join(sorted(set(files)))} "
              f"but is not in web/index.html")
    print(f"\n{len(missing)} missing")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
