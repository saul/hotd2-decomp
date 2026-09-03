#!/usr/bin/env python3
"""Regenerate `web/src/bundle/schema_hash.ts` from the declarations beside it.

`tools/export_player.py` does this on every run, so you only need this when you
have changed a declaration in `web/src/bundle/` and do not want to build a
bundle to make `tools/verify_exporters.py` green again.

Prints what it did. Exit 0 either way -- being already current is the normal
outcome, not a failure; `verify_exporters.py` is the thing that fails.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import schema  # noqa: E402


def main() -> int:
    path, changed = schema.write_client_hash()
    root = Path(__file__).resolve().parent.parent
    rel = path.relative_to(root)
    print(f"{rel}: {'regenerated' if changed else 'already current'} "
          f"({schema.schema_hash()[:16]}...)")
    if changed:
        print("commit it in the same commit as the declaration change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
