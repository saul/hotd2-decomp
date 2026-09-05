#!/usr/bin/env python3
"""Generate `web/src/hod2lib/rigs_data.ts` from `tools/hod2lib/rigs.py`.

**The rig table is transcribed once, in Python, and mirrored here.**

`hod2lib/rigs.py` is 690 lines of hand-read draw routines: a translation is a
`PUSH imm32` somebody disassembled, and the `note` beside it is why it is that
number. Re-typing all of it into TypeScript would be re-doing that work with no
second reading to catch a slip -- the failure mode is a wheel four units to the
left, which nothing measures.

So the values are emitted from the objects themselves. Everything a rig carries
that is evidence is a `note=` or `animated=` string, which is *data* and comes
across intact; what stays behind is the `#:` prose between declarations, and
that prose is about the Python source a reader of the generated file is pointed
at.

`tools/verify_exporters.py` re-derives the file and fails if the committed copy
is stale, the same mechanism `schema_hash.ts` uses. Run this after editing
`rigs.py`, and commit the result with it.

    python3 tools/gen_rig_data.py            # write, if it changed
    python3 tools/gen_rig_data.py --check    # exit 1 if stale
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import fields, is_dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from hod2lib import rigs as rigslib  # noqa: E402

OUT = ROOT / "web" / "src" / "hod2lib" / "rigs_data.ts"

#: dataclass field -> TypeScript property. The TS side is camelCase for the
#: names the code reads and snake_case for the ones that reach JSON unchanged;
#: `rigs.ts` declares both, so the mapping lives here rather than being guessed
#: by a rule.
RENAMES = {
    "rotation_bams": "rotation_bams",
    "cam_paths": "camPaths",
    "hold_frame": "holdFrame",
    "stop_frame": "stopFrame",
    "offset_bams": "offsetBams",
    "frame_offset": "frameOffset",
    "frame_lo": "frameLo",
    "frame_hi": "frameHi",
    "frame_default": "frameDefault",
    "draw_layer": "drawLayer",
    "hidden_unless": "hiddenUnless",
    "path_rotation": "pathRotation",
    "path_slots": "pathSlots",
    "fixed_poses": "fixedPoses",
    "world_space": "worldSpace",
    "variant_param": "variantParam",
    "route_param": "routeParam",
    "main_asset_param": "mainAssetParam",
    "placement_blocked": "placementBlocked",
    "spawn_class": "spawnClass",
}


def ts_name(field_name: str) -> str:
    return RENAMES.get(field_name, field_name)


def ts_number(v: float | int) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    # A float that is a whole number keeps its `.0` in Python and loses it in
    # JavaScript; both parse to the same double, and the TS type is `number`.
    return repr(v)


def ts_string(s: str) -> str:
    body = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{body}"'


def ts_value(v, indent: int) -> str:
    pad = " " * indent
    if v is None:
        return "null"
    if isinstance(v, str):
        return ts_string(v)
    if isinstance(v, (bool, int, float)):
        return ts_number(v)
    if isinstance(v, (tuple, list)):
        if not v:
            return "[]"
        if all(isinstance(x, (int, float)) and not isinstance(x, bool)
               for x in v):
            return "[" + ", ".join(ts_number(x) for x in v) + "]"
        inner = ",\n".join(pad + "  " + ts_value(x, indent + 2) for x in v)
        return "[\n" + inner + ",\n" + pad + "]"
    if is_dataclass(v):
        rows = []
        for f in fields(v):
            got = getattr(v, f.name)
            if got == _default(f):
                continue
            rows.append(f"{pad}  {ts_name(f.name)}: "
                        f"{ts_value(got, indent + 2)}")
        if not rows:
            return "{}"
        return "{\n" + ",\n".join(rows) + ",\n" + pad + "}"
    raise TypeError(f"cannot emit {v!r}")


def _default(f):
    if f.default is not _MISSING:
        return f.default
    if f.default_factory is not _MISSING:      # type: ignore[misc]
        return f.default_factory()             # type: ignore[misc]
    return _NO_DEFAULT


class _NoDefault:
    def __eq__(self, other):
        return False


_NO_DEFAULT = _NoDefault()
from dataclasses import MISSING as _MISSING  # noqa: E402


HEADER = '''/**
 * The transcribed object rigs. **Generated file.**
 *
 * Written by `tools/gen_rig_data.py` from `tools/hod2lib/rigs.py`, which is
 * where these came from and where the evidence for each one is. A rig is a
 * draw routine read by hand -- there is no rig data in the asset files at all,
 * only 168 `AssetDrawSlot` call sites with their transforms as `PUSH imm32` in
 * the instruction stream -- so every number here was disassembled once, and
 * re-typing them would be doing that work again with nothing to catch a slip.
 *
 * The evidence travels: `note`, `animated` and `condition` are fields, not
 * comments, so they are in this file too. What is only in `rigs.py` is the
 * prose between declarations.
 *
 * `tools/verify_exporters.py` fails when this file is stale. Re-run the
 * generator after editing `rigs.py` and commit the two together.
 */

import type { Rig } from "./rigs";

export const RIGS: readonly Rig[] = [
'''


def render() -> str:
    rows = ",\n".join("  " + ts_value(r, 2) for r in rigslib.RIGS)
    return HEADER + rows + ",\n];\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed file is stale")
    args = ap.parse_args()

    want = render()
    have = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if args.check:
        if have == want:
            print(f"{OUT.relative_to(ROOT)} is current "
                  f"({len(rigslib.RIGS)} rigs)")
            return 0
        print(f"{OUT.relative_to(ROOT)} is stale -- run "
              f"`python3 tools/gen_rig_data.py`", file=sys.stderr)
        return 1
    if have == want:
        print(f"{OUT.relative_to(ROOT)} unchanged")
        return 0
    OUT.write_text(want, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(rigslib.RIGS)} rigs, "
          f"{want.count(chr(10))} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
