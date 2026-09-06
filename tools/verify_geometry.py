#!/usr/bin/env python3
"""Check that a stage bundle draws every triangle the game's models declare.

Nothing else in this repo compares an export against the files it came from.
`compare_bundles.py` compares two exports with each other, which says the two
writers agree and nothing at all about whether either one is complete; the
tests compare the bundle against itself. So a filter in the writer could --
and did -- delete 3-5% of every stage for eighteen months while every check in
the tree stayed green.

What it does is the whole invariant: parse each stage's `pol/` set with
`hod2lib` -- the same resolution the exporter uses, the union of every
region's asset slots plus every slot opcode 0x50 loads -- add up the
triangles, and require the glTF to hold at least that many under the matching
part names.

**Per part, not per stage.** A stage total can hide a part that lost half its
faces behind another that gained a rig, and the part name is what a person can
then go and look at.

**At least, not exactly.** `buildStage` legitimately appends geometry the
region tables do not name -- the rain particle model is a part of its own --
and the glTF also carries rigs, characters, props and breakables that are not
scenery at all. Those are extra nodes under their own names; a *scenery* part
that comes out short is the failure this exists to catch, and a part that
comes out long is a name collision worth failing on too.

    python3 tools/verify_geometry.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
    python3 tools/verify_geometry.py --game-dir ... --bundle extract/player

Exit 0 when it compared something, 1 on a mismatch, 3 when there is no bundle
to compare against -- a skip is not a pass.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import stage as stagelib  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

#: `<part>_model_<nnn>`, the name `gltf.export_level` gives a model's mesh.
MESH_NAME = re.compile(r"^(?P<part>.+)_model_(?P<index>\d{3})$")


def read_glb_json(path: Path) -> dict:
    """A GLB's JSON chunk, parsed. The BIN chunk is not read."""
    data = path.read_bytes()
    magic, version, _total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB")
    if version != 2:
        raise ValueError(f"{path}: GLB version {version}")
    pos = 12
    while pos + 8 <= len(data):
        n, kind = struct.unpack_from("<II", data, pos)
        if kind == 0x4E4F534A:
            return json.loads(data[pos + 8:pos + 8 + n].decode("utf-8"))
        pos += 8 + n + (-n % 4)
    raise ValueError(f"{path}: no JSON chunk")


def bundle_triangles(glb: Path) -> dict[str, int]:
    """Triangles per part name, from the glTF's own mesh names."""
    doc = read_glb_json(glb)
    per: dict[str, int] = defaultdict(int)
    for mesh in doc.get("meshes", []):
        m = MESH_NAME.match(mesh.get("name", ""))
        if m is None:
            continue
        n = 0
        for prim in mesh["primitives"]:
            # mode 4 is TRIANGLES; the camera rails are LINE_STRIP.
            if prim.get("mode", 4) != 4:
                continue
            n += doc["accessors"][prim["indices"]]["count"] // 3
        per[m.group("part")] += n
    return dict(per)


def source_triangles(game_dir: str, stage: int, original: bool) -> dict[str, int]:
    """Triangles per part name, straight out of `pol/`."""
    st = stagelib.Stage(game_dir, stage=stage, original=original)
    parts, _regions, _ = st.geometry()
    return {name: sum(m.triangle_count for m in models)
            for name, models, _bank in parts}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True)
    ap.add_argument("--bundle", type=Path,
                    default=ROOT / "extract" / "player")
    args = ap.parse_args()

    manifest = args.bundle / "manifest.json"
    if not manifest.exists():
        print(f"SKIP  verify_geometry: no bundle at {args.bundle}")
        print("      build one with `cd web && npm run export -- "
              "--game-dir ...`")
        return 3

    entries = json.loads(manifest.read_text())["stages"]
    bad: list[str] = []
    compared = 0
    for entry in entries:
        name = entry["name"]
        glb = args.bundle / name / entry["geometry"]
        if not glb.exists():
            bad.append(f"{name}: manifest names {entry['geometry']}, "
                       "which is not there")
            continue
        want = source_triangles(args.game_dir, entry["stage"],
                                entry["game_mode"] == 1)
        got = bundle_triangles(glb)
        short = 0
        for part, n in sorted(want.items()):
            have = got.get(part)
            compared += 1
            if have is None:
                bad.append(f"{name}: part {part} is not in the glTF at all "
                           f"({n} triangles)")
            elif have != n:
                short += n - have
                bad.append(f"{name}: part {part} has {have} triangles, "
                           f"{n} in pol/{part}.bin "
                           f"({n - have:+d})")
        total = sum(want.values())
        flag = "" if short == 0 else f"   SHORT {short} ({100 * short / total:.1f}%)"
        print(f"  {name:<18} {len(want):>3} parts  {total:>7,} triangles{flag}")

    if bad:
        print(f"\n{len(bad)} problems:")
        for line in bad[:40]:
            print(f"  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        return 1
    if compared == 0:
        print("SKIP  verify_geometry: the manifest lists no stages")
        return 3
    print(f"\nall {compared} scenery parts hold every triangle their models "
          "declare")
    return 0


if __name__ == "__main__":
    sys.exit(main())
