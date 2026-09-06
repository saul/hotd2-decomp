#!/usr/bin/env python3
"""The vertex-blended parts in a bundle, against the exe and the pol they came
from.

`g_pCharacterExtraParts` (`0x0052ED08`) gives a character up to two parts that
its skeleton does not name -- the waist, which stretches between the chest and
the pelvis, and the skirt, which stretches between the pelvis and both thighs.
`DeformCharacterPartGroup` (`FUN_00419980`) re-transforms them every frame,
one bone per vertex and no weights, and the exporter says that in glTF as a
skinned primitive with `JOINTS_0`, `WEIGHTS_0` and a `skin`.

**This compares the export against the files it was made from.** Comparing two
exports cannot see any of it: the port hung these parts off the pelvis as rigid
children for months, every count was right, and the only thing wrong was that a
walking character's waist rode its hips instead of stretching to its chest.

Six assertions, each a different way it goes wrong:

1. the bundle's part table is the exe's -- slot, draw bone, group bones and the
   deformed set, row for row;
2. every part with a table has a **skinned node** in the glTF, with all four of
   `POSITION`, `NORMAL`, `JOINTS_0` and `WEIGHTS_0`;
3. every weight is exactly 1 in slot 0 and 0 in the other three -- the engine
   has no weights, and a normalised blend would be a different thing;
4. every joint index is inside the skin, and every joint node is a `rig_joint`
   proxy under the right bone. A skin naming a *bone* node directly would make
   `GLTFLoader` turn it into a `Bone` and re-parent its mesh, which is what the
   gore swap and the severed head classify on;
5. the skin has **no** `inverseBindMatrices`, because the exe's source vertices
   are already in their bone's local space;
6. and the positions are the exe's, not the model's: for every vertex in a
   group the drawer deforms, the exported position is that group's source
   vertex, and for every vertex in a group it does not, it is the pol model's.

    python3 tools/verify_parts.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import container as C, nl1  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

#: Positions are floats through a glTF accessor and through the exe's own
#: .rdata, so they compare exactly -- except for the low mantissa bit
#: `WriteCharacterPartVertexPos` (`FUN_0041A480`) ORs into x to keep the
#: PowerVR2 vertex control word set. That is what this tolerance is.
EPS = 2e-3


def glb_json(path: Path) -> tuple[dict, bytes]:
    b = path.read_bytes()
    off, js, binc = 12, None, b""
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        chunk = b[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(chunk)
        elif ty == 0x004E4942:
            binc = chunk
        off += 8 + ln
    if js is None:
        raise SystemExit(f"{path}: no JSON chunk")
    return js, binc


def accessor(js: dict, binc: bytes, i: int) -> list[tuple]:
    a = js["accessors"][i]
    v = js["bufferViews"][a["bufferView"]]
    base = v.get("byteOffset", 0)
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    fmt = {5126: "f", 5123: "H", 5125: "I", 5121: "B"}[a["componentType"]]
    size = {"f": 4, "H": 2, "I": 4, "B": 1}[fmt]
    out = []
    for k in range(a["count"]):
        o = base + k * n * size
        out.append(struct.unpack_from(f"<{n}{fmt}", binc, o))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--bundle", type=Path,
                    default=Path(os.environ.get("HOTD2_BUNDLE")
                                 or ROOT / "extract" / "player"))
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    exe = next((p for p in game.iterdir() if p.suffix.lower() == ".exe"), None)
    if exe is None:
        raise SystemExit(f"no .exe under {game}")
    tables = ExeTables(exe)
    slots = tables.asset_slots()
    models: dict[str, list] = {}

    manifest = args.bundle / "manifest.json"
    if not manifest.exists():
        print(f"SKIP  verify_parts: no bundle at {args.bundle}")
        print("      build one with `cd web && npm run export -- "
              "--game-dir ...`")
        return 3

    bad: list[str] = []
    stages = types_seen = parts_seen = verts = 0
    for entry in json.loads(manifest.read_text())["stages"]:
        name = entry["name"]
        script = args.bundle / name / entry["script"]
        glb = args.bundle / name / entry["geometry"]
        if not script.exists() or not glb.exists():
            bad.append(f"{name}: the manifest names files that are not there")
            continue
        stages += 1
        chars = json.loads(script.read_text())["characters"]
        js, binc = glb_json(glb)
        nodes = js["nodes"]

        # **Every** skinned node, not one per rig: the exporter writes a
        # separate copy of the hierarchy and a separate skin for each spawn,
        # so a bug that only reaches one instance is a bug this has to see.
        # Keying by (rig, part) and keeping the last is how a first draft of
        # this check passed a deliberately corrupted joint index.
        skinned: dict[tuple[str, str], list[dict]] = {}
        for nd in nodes:
            if "skin" not in nd:
                continue
            ex = nd.get("extras") or {}
            key = (ex.get("hod2_rig") or "", ex.get("hod2_part") or "")
            skinned.setdefault(key, []).append(nd)

        for key, ct in sorted(chars["types"].items()):
            want = tables.character_parts(int(key))
            got = ct.get("parts")
            if got is None:
                bad.append(f"{name}: type 0x{int(key):02X} carries no part "
                           "table")
                continue
            types_seen += 1
            if len(got) != len(want):
                bad.append(f"{name}: type 0x{int(key):02X} has {len(got)} "
                           f"parts, the exe has {len(want)}")
                continue
            for i, (g, w) in enumerate(zip(got, want)):
                if (g is None) != (w is None):
                    bad.append(f"{name}: type 0x{int(key):02X} part {i} is "
                               f"{'null' if g is None else 'set'} in the "
                               f"bundle and the other way in the exe")
                    continue
                if g is None or w is None:
                    continue
                parts_seen += 1
                if (g["slot"] != w["slot"] or g["draw_bone"] != w["draw_bone"]
                        or g["deformed"] != w["deformed"]
                        or g["bones"] != [None if x is None else x["bone"]
                                          for x in w["groups"]]):
                    bad.append(f"{name}: type 0x{int(key):02X} part {i} is "
                               f"{g} in the bundle, the exe says slot "
                               f"0x{w['slot']:04X} draw_bone {w['draw_bone']} "
                               f"deformed {w['deformed']}")
                    continue

                if g.get("supported") != w["supported"]:
                    bad.append(f"{name}: type 0x{int(key):02X} part {i} says "
                               f"supported={g.get('supported')}, the exe's "
                               f"drawer 0x{w['drawer']:08X} says "
                               f"{w['supported']}")
                    continue
                # A part whose drawer the port has not read is described and
                # not drawn -- its table slot is not what the engine draws.
                if not w["supported"]:
                    continue

                # -- the geometry -------------------------------------------
                pn = f"part{i}_{w['slot']:04x}"
                insts = skinned.get((f"chr_{ct['name']}", pn))
                if not insts:
                    # A type the stage poses but whose model this bundle does
                    # not carry has no node; only complain when the rig is here.
                    if any((x.get("extras") or {}).get("hod2_rig")
                           == f"chr_{ct['name']}" for x in nodes):
                        bad.append(f"{name}: type 0x{int(key):02X} part {i} "
                                   f"({pn}) has a table but no skinned node")
                    continue
                for nd in insts:
                    skin = js["skins"][nd["skin"]]
                    if "inverseBindMatrices" in skin:
                        bad.append(f"{name}: {pn} carries inverse bind matrices; "
                                   "the source vertices are already bone-local")
                    jbones = []
                    ok_joints = True
                    for jn in skin["joints"]:
                        jex = (nodes[jn].get("extras") or {})
                        if jex.get("hod2_kind") != "rig_joint":
                            bad.append(f"{name}: {pn} names node {jn} as a joint "
                                       "and it is not a rig_joint proxy")
                            ok_joints = False
                        jbones.append(jex.get("hod2_bone"))
                    if not ok_joints:
                        continue

                    pf, mi = slots.get(w["slot"], (None, -1))
                    if pf is None:
                        continue
                    if pf not in models:
                        models[pf] = nl1.parse_container(
                            C.load((game / "pol" / pf).read_bytes()))
                    model = models[pf][mi]
                    row_of = {}
                    for r, offs in enumerate(w["rows"]):
                        for o in offs:
                            row_of[o] = r

                    mesh = js["meshes"][nd["mesh"]]
                    src_meshes = [m for m in model.meshes
                                  if m.triangles and m.vertices]
                    if len(mesh["primitives"]) != len(src_meshes):
                        bad.append(f"{name}: {pn} has "
                                   f"{len(mesh['primitives'])} primitives against "
                                   f"{len(src_meshes)} model meshes")
                        continue
                    for prim in mesh["primitives"]:
                        # `orderedPrims` puts the opaque pass first, so a
                        # primitive's position in the mesh is NOT its position in
                        # the model's chain. `hod2_chain_index` is, and it is the
                        # index among the primitives that were emitted at all.
                        pi = (prim.get("extras") or {}).get("hod2_chain_index")
                        if pi is None or pi >= len(src_meshes):
                            bad.append(f"{name}: {pn} has a primitive with chain "
                                       f"index {pi} against {len(src_meshes)} "
                                       "model meshes")
                            continue
                        at = prim["attributes"]
                        for need in ("POSITION", "NORMAL", "JOINTS_0",
                                     "WEIGHTS_0"):
                            if need not in at:
                                bad.append(f"{name}: {pn} primitive {pi} has no "
                                           f"{need}")
                        if not all(k in at for k in
                                   ("POSITION", "JOINTS_0", "WEIGHTS_0")):
                            continue
                        pos = accessor(js, binc, at["POSITION"])
                        jt = accessor(js, binc, at["JOINTS_0"])
                        wt = accessor(js, binc, at["WEIGHTS_0"])
                        sm = src_meshes[pi]
                        if len(pos) != len(sm.vertices):
                            bad.append(f"{name}: {pn} primitive {pi} has "
                                       f"{len(pos)} vertices against "
                                       f"{len(sm.vertices)} in pol/{pf}")
                            continue
                        for k in range(len(pos)):
                            verts += 1
                            if wt[k] != (1.0, 0.0, 0.0, 0.0):
                                bad.append(f"{name}: {pn} vertex {k} has weights "
                                           f"{wt[k]}, and the engine has none")
                                break
                            j = jt[k][0]
                            if j >= len(jbones) or jt[k][1:] != (0, 0, 0):
                                bad.append(f"{name}: {pn} vertex {k} joints "
                                           f"{jt[k]} against {len(jbones)} joints")
                                break
                            # Which group owns this vertex, from the exe.
                            row = row_of.get(sm.offsets[k])
                            want_pos = sm.vertices[k].pos
                            want_bone = w["draw_bone"]
                            if row is not None:
                                # **The break belongs to the claim, not to the
                                # group.** A group the drawer deforms may still
                                # not claim this row -- part 1's group 0 is the
                                # pelvis and claims only a third of them -- so
                                # walking on is the whole point of the loop.
                                for gi in w["deformed"]:
                                    grp = w["groups"][gi]
                                    if grp is None:
                                        continue
                                    a = grp["assign"][row]
                                    if 0 <= a < len(grp["verts"]):
                                        want_pos = grp["verts"][a]["pos"]
                                        want_bone = grp["bone"]
                                        break
                            if jbones[j] != want_bone:
                                bad.append(f"{name}: {pn} vertex {k} is on bone "
                                           f"{jbones[j]}, the exe puts it on "
                                           f"{want_bone}")
                                break
                            if max(abs(pos[k][c] - want_pos[c])
                                   for c in range(3)) > EPS:
                                bad.append(f"{name}: {pn} vertex {k} is at "
                                           f"{pos[k]}, the exe says {want_pos}")
                                break

    print(f"{stages} stage bundles, {types_seen} character types, "
          f"{parts_seen} vertex-blended parts, {verts} skinned vertices "
          f"checked against the exe and pol/")
    if bad:
        print()
        for line in bad[:40]:
            print(f"  {line}")
        if len(bad) > 40:
            print(f"  ... and {len(bad) - 40} more")
        print(f"\nFAIL {len(bad)} problem(s)")
        return 1
    if not stages:
        print("SKIP  verify_parts: no stage bundle to compare")
        return 3
    print("\nOK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
