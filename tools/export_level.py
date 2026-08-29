#!/usr/bin/env python3
"""
Export a HOTD2 level (or any pol/ asset) to glTF 2.0 with textures.

    python3 tools/export_level.py --game-dir "..." --name st2_01
    python3 tools/export_level.py --game-dir "..." --stage 2      # whole stage
    python3 tools/export_level.py --game-dir "..." --list

Output goes to extract/<name>/<name>.gltf plus <name>.bin and textures/*.png.
Open the .gltf directly in Blender.

The "what is a stage" resolution -- regions, geometry set, draw modes, cam
files -- lives in `hod2lib.stage`, shared with the browser player's bundle
builder so the two cannot disagree about what a stage contains.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import (coli as colilib, gltf, rigs as rigslib,
                     script as scriptlib, stage as stagelib)  # noqa: E402

STAGE_TO_SCENE = stagelib.STAGE_TO_SCENE


def _resolve_rigs(game: Path, st, bbox=None) -> list[dict]:
    """Load the models a transcribed rig draws, for every route this stage has.

    A rig's parts name **asset slots**, which resolve through the EXE's slot
    table to a pol file and an entry index -- and those files are deliberately
    *not* in the stage geometry set, because they are spawnable actors rather
    than placed scenery. So they are loaded here on demand.
    """
    cp = st.campaths()
    if cp is None:
        return []
    slots = st.tables.asset_slots()
    have = {r.slot for r in cp.by_slot.values() if r.is_object_path}
    # The cp_ slots this stage owns. Routines dispatch on `g_active_cam_path`
    # to pick a route, and those ids live in the same 418-slot space as the
    # object paths -- verified: all 28 gate ids seen so far resolve to cp_
    # files and all 21 route ids to op_ files. So a rig belongs to a stage iff
    # the stage owns the camera path that selects it.
    have_cam = {r.slot for r in cp.by_slot.values() if not r.is_object_path}

    cache: dict[str, tuple] = {}

    def asset(file_stem: str):
        if file_stem not in cache:
            try:
                cache[file_stem] = stagelib.load_asset(game, file_stem)
            except Exception:
                cache[file_stem] = ([], None)
        return cache[file_stem]

    # Spawn descriptors, grouped by class, so a rig that is a class handler can
    # be placed at every instance the event script puts in the stage.
    placements: dict[int, list[dict]] = {}
    wanted = {r.spawn_class for r in rigslib.RIGS if r.spawn_class is not None}
    if wanted:
        try:
            prog = scriptlib.load(st)
        except Exception:
            prog = None
        if prog is not None:
            for blk in prog.blocks:
                for step in blk.steps:
                    for op in step.ops:
                        for sp in op.detail.get("spawns", []) or []:
                            if sp["class"] in wanted:
                                placements.setdefault(sp["class"], []).append(sp)

    out: list[dict] = []
    blocked: list = []
    for rig in rigslib.RIGS:
        anchors: dict[int, str] = {}
        biases: dict[str, tuple] = {}

        def bind(slot, cam_paths, bias=(0.0, 0.0, 0.0)):
            """Bind one route to its anchor node, if this stage has both."""
            if slot not in have:
                return
            if cam_paths and not (set(cam_paths) & have_cam):
                return
            ref = cp.by_slot[slot]
            base = f"{ref.file}_{ref.index:02d}"
            nm = f"{base}_obj"
            if tuple(bias) != (0.0, 0.0, 0.0):
                nm = f"{base}_obj_b{gltf._bias_tag(bias)}"
                biases[base] = tuple(bias)
            anchors[slot] = nm

        for slot in rig.path_slots:          # flat spelling, no cam gate
            bind(slot, ())
        for route in rig.routes:
            bind(route.slot, route.cam_paths, route.bias)

        # Poses the routine hardcodes, gated the same way.
        fixed = [{"kind": "fixed", "translation": list(fp.translation),
                  "rotation_bams": list(fp.rotation_bams),
                  "cam_paths": list(fp.cam_paths), "note": fp.note}
                 for fp in rig.fixed_poses
                 if not fp.cam_paths or (set(fp.cam_paths) & have_cam)]

        # A world-space rig has no root to place: its part translations are
        # already absolute. The spawn class is the wrong gate for it -- class
        # 0x25 is a generic scripted-actor interpreter present in every stage,
        # while the props themselves sit at one fixed set of coordinates. So
        # the gate is geometric: the parts have to land inside this stage.
        # A world-space rig has no root to place: its part translations are
        # already absolute, so it needs a gate saying which stage holds it.
        # The stage bounding box is not that gate -- levels span thousands of
        # units and would accept the props everywhere. Without a confirmed
        # gate the rig is transcribed but not placed.
        world = bool(rig.world_space and bbox is not None
                     and not rig.placement_blocked)

        if rig.placement_blocked:
            blocked.append(rig)
            continue
        if not anchors and not fixed and not world \
                and not placements.get(rig.spawn_class):
            continue

        parts = []
        for part in rigslib.ordered_parts(rig):
            models = []
            for sid in part.slots:
                rec = slots.get(sid)
                if not rec:
                    continue
                stem = rec[0][:-4] if rec[0].endswith(".bin") else rec[0]
                ms, bank = asset(stem)
                if rec[1] < len(ms):
                    models.append((ms[rec[1]], bank, stem))
            if models:
                parts.append((part, models))
        if parts:
            out.append({"rig": rig, "anchors": anchors, "parts": parts,
                        "blocked": rig.placement_blocked,
                        "biases": biases, "fixed": fixed, "world": world,
                        "placements": (placements.get(rig.spawn_class, [])
                                       if not rig.world_space else [])})
    _resolve_rigs.blocked = blocked
    return out


def _objects_json(st) -> dict:
    """The stage's objects: what the event script spawns, and the routes.

    Two independent things, both from the game's own data:

    * ``spawns`` -- every spawn descriptor the event script reaches, with its
      class, world position, BAMS yaw and hit points. This is the authoritative
      list of what is in the stage: it comes from the event tables, not from a
      guess about which models look like enemies. `+0x14`/`+0x1C` are carried
      raw as ``orient`` because they are *not* confirmed to be Euler angles.

    * ``object_paths`` -- every `op_` path the stage's cam file holds, with the
      **global** path slot the code addresses it by. A path-following object is
      bound to its route by a slot constant in its draw routine, e.g.
      `FUN_0048E600` passes 0xFD/0xFE/0xFF, which are op_st1 local 0/1/2.

    The glTF carries the same routes as animated nodes, so this sidecar is for
    cross-referencing rather than for geometry.
    """
    prog = None
    try:
        prog = scriptlib.load(st)
    except Exception:
        pass

    spawns: list[dict] = []
    if prog is not None:
        for blk in prog.blocks:
            for step in blk.steps:
                for op in step.ops:
                    for sp in op.detail.get("spawns", []) or []:
                        spawns.append(dict(sp, block=blk.index, step=step.index,
                                           opcode=op.opcode, op=op.name))

    paths: list[dict] = []
    cp = st.campaths()
    for ref in cp.by_slot.values() if cp else []:
        if not ref.is_object_path:
            continue
        paths.append({
            "slot": ref.slot, "file": ref.file, "index": ref.index,
            # The curve's key extent, and separately how many frames the game
            # actually plays it for -- object draw routines clamp with the
            # second. They differ on 95 of the 418 slots.
            "duration_frames": ref.duration,
            "play_frames": st.tables.cam_path_length(ref.slot),
            "start_frame": ref.start_frame,
            "node": f"{ref.file}_{ref.index:02d}_obj",
        })
    paths.sort(key=lambda d: d["slot"])

    by_class: dict[str, int] = {}
    for sp in spawns:
        by_class[str(sp["class"])] = by_class.get(str(sp["class"]), 0) + 1

    return {
        "scene": st.scene,
        "note": "Objects in the stage. `spawns` is what the event script "
                "places (class id -> handler via the table at 0x00593358); "
                "`object_paths` is every op_ route, addressed by the global "
                "cam path slot the code uses. Rotation on the animated nodes "
                "is Rz*Ry*Rx from the op_ BAMS Euler triple -- see "
                "docs/formats/cam.md.",
        "spawn_count": len(spawns),
        "spawns_by_class": dict(sorted(by_class.items(), key=lambda kv: -kv[1])),
        "spawns": spawns,
        "object_paths": paths,
    }


def _coli_json(st, sets) -> dict:
    """The stage's collision meshes, as a sidecar.

    Both files the scene loads are emitted whole, with every quad's plane,
    vertices and surface id, so a consumer can build a debug mesh and lay it
    over the exported geometry -- the coordinate space is the same.

    `activated` lists the blobs the event script actually switches on with
    opcodes 0x10/0x11, because a file holds more blobs than any one run uses
    and the script is what selects them.
    """

    files = {}
    for f in sets:
        files[f.name] = [
            {
                "offset": b.offset,
                "aabb_min": list(g.aabb_min),
                "aabb_max": list(g.aabb_max),
                "quads": [
                    {"plane": list(q.normal) + [q.plane_d],
                     "axis": q.axis,
                     "verts": [list(v) for v in q.verts],
                     "surface": q.surface}
                    for q in g.quads
                ],
            }
            for b in f.blobs for g in b.groups
        ]

    activated: list[dict] = []
    try:
        prog = scriptlib.load(st)
    except Exception:                      # no evt for this scene
        prog = None
    if prog is not None:
        for blk in prog.blocks:
            for step in blk.steps:
                for op in step.ops:
                    if op.opcode in scriptlib.COLLISION_SET_OPCODES:
                        for m in op.detail.get("meshes", []):
                            if "file" in m:
                                activated.append({
                                    "block": blk.index, "offset": op.offset,
                                    "set": op.detail.get("set"),
                                    "file": m["file"], "blob": m["offset"],
                                    "quads": m.get("quads"),
                                    "surfaces": m.get("surfaces", []),
                                })

    return {
        "scene": st.scene,
        "note": "coli/ collision meshes. ColiLoadForScene loads coli0.bin for "
                "every scene plus coli<scene+1>.bin. Quads are 4 coplanar "
                "verts with a stored plane and a surface id; ids 5 and 55 are "
                "wet. Coordinates match the exported geometry. See "
                "docs/formats/coli.md.",
        "wet_surfaces": list(colilib.WET_SURFACES),
        "files": files,
        "activated": activated,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--name", help="asset base name, e.g. st2_01")
    ap.add_argument("--stage", type=int, help="export every st<N>_* segment")
    ap.add_argument("--list", action="store_true", help="list level assets")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent / "extract")
    ap.add_argument("--no-textures", action="store_true")
    ap.add_argument("--keep-collapsed-uv", action="store_true",
                    help="keep triangles whose UV area is zero (they render as "
                         "hard directional streaks; dropped by default)")
    ap.add_argument("--original", action="store_true",
                    help="export Original Mode geometry (game mode 1) instead "
                         "of Arcade. Same regions, but a few slots resolve to "
                         "the st_org* models Arcade never draws")
    ap.add_argument("--glob-geometry", action="store_true",
                    help="use the old st<N>_* glob instead of the exe's region "
                         "tables. Wrong in both directions; kept for comparison")
    ap.add_argument("--no-objects", action="store_true",
                    help="skip the objects/spawns sidecar")
    ap.add_argument("--no-coli", action="store_true",
                    help="skip the coli/ collision sidecar")
    ap.add_argument("--no-cameras", action="store_true",
                    help="skip cam/ camera and object paths")
    ap.add_argument("--cam-step", type=float, default=2.0,
                    help="frames between baked camera keys (default 2, i.e. 30 Hz)")
    ap.add_argument("--fold-mirror-uv", action="store_true",
                    help="apply the CPU UV fold the game uses on devices "
                         "without D3DTADDRESS_MIRROR. Off by default because "
                         "it destroys texturing on targets that mirror properly")
    ap.add_argument("--unlit", action="store_true",
                    help="mark materials KHR_materials_unlit. The game bakes "
                         "all lighting into its textures and ships no lights, "
                         "so this is the faithful model - and it stops "
                         "Blender's Rendered view from being black")
    ap.add_argument("--uv-check", action="store_true",
                    help="replace every texture with a UV checkerboard, so "
                         "stretched or rotated faces are visually obvious")
    ap.add_argument("--glb", action="store_true",
                    help="write a single self-contained .glb instead of "
                         ".gltf + .bin + a directory of PNGs")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()

    if args.list:
        names = sorted(p.stem for p in (game / "pol").glob("st*.bin")
                       if not p.stem.startswith("pol_"))
        for n in names:
            print(n)
        return 0

    if args.stage is not None:
        # A stage is split across many pol/ files. Merge them into one glTF,
        # each segment its own parent node, so the whole level opens at once.
        scene = STAGE_TO_SCENE.get(args.stage)
        model_regions, regions = {}, []
        st = None
        if args.glob_geometry or scene is None:
            targets = sorted(
                p.stem for p in (game / "pol").glob(f"st{args.stage}_*.bin")
                if not p.stem.startswith("pol_"))
            if not targets:
                raise SystemExit(f"no assets for stage {args.stage}")
            parts = []
            for n in targets:
                models, bank = stagelib.load_asset(game, n)
                parts.append((n, models, bank))
        else:
            st = stagelib.Stage(game, stage=args.stage, scene=scene,
                                original=args.original)
            parts, model_regions, regions = st.geometry()
        for n, models, _b in parts:
            print(f"  + {n}: {len(models)} models, "
                  f"{sum(m.vertex_count for m in models):,} verts, "
                  f"{sum(m.triangle_count for m in models):,} tris")

        if args.no_cameras:
            cam_files = []
        elif st is not None:
            cam_files = st.cam_files()
        else:
            cam_files = stagelib.load_cam_paths(game, args.stage, None)
        name = (f"stage{args.stage}"
                + ("_original" if args.original and not args.glob_geometry else "")
                + ("_uvcheck" if args.uv_check else ""))
        out_dir = args.out / name
        # The stage's world bounds, used to gate world-space rigs.
        bbox = None
        pts = [v.pos for _, models, _ in parts for m in models
               for mesh in m.meshes for v in mesh.vertices]
        if pts:
            bbox = (tuple(min(q[i] for q in pts) for i in range(3)),
                    tuple(max(q[i] for q in pts) for i in range(3)))
        rig_data = _resolve_rigs(game, st, bbox) if st is not None else []
        info = gltf.export_level(name, parts, out_dir, rigs=rig_data,
                                 write_textures=not args.no_textures,
                                 uv_check=args.uv_check,
                                 keep_collapsed_uv=args.keep_collapsed_uv,
                                 cam_files=cam_files, cam_step=args.cam_step,
                                 unlit=args.unlit, model_regions=model_regions,
                                 fold_mirror_uv=args.fold_mirror_uv,
                                 glb=args.glb)
        if regions:
            side = out_dir / f"{name}_regions.json"
            side.write_text(json.dumps({
                "scene": scene,
                "game_mode": 1 if args.original else 0,
                "note": "region id -> asset slots resident and drawn. Set by evt "
                        "opcode 0x29; consecutive regions overlap, which is why "
                        "a whole-stage export shows interpenetrating geometry "
                        "the game never displays.",
                "regions": st.region_json(),
            }, indent=1))
            print(f"  {len(regions)} regions -> {side.name}")

        if st is not None and not args.no_objects:
            side = out_dir / f"{name}_objects.json"
            objs = _objects_json(st)
            side.write_text(json.dumps(objs, indent=1))
            print(f"  objects: {objs['spawn_count']} spawns, "
                  f"{len(objs['object_paths'])} object paths -> {side.name}")

        if st is not None and not args.no_coli:
            sets = st.colisets()
            if sets:
                side = out_dir / f"{name}_coli.json"
                side.write_text(json.dumps(_coli_json(st, sets), indent=1))
                nq = sum(len(f.quads) for f in sets)
                print(f"  collision: {sets[0].name} + {sets[1].name}, "
                      f"{nq} quads -> {side.name}")
        vert = sum(m.vertex_count for _, ms, _ in parts for m in ms)
        tri = sum(m.triangle_count for _, ms, _ in parts for m in ms)
        print(f"\n{name}: {len(parts)} segments, {vert:,} verts, "
              f"{tri - info['dropped_collapsed_uv']:,} tris, "
              f"{info['materials']} materials, {info['textures']} textures")
        if info['dropped_collapsed_uv']:
            print(f"  dropped {info['dropped_collapsed_uv']:,} collapsed-UV "
                  f"triangles ({100 * info['dropped_collapsed_uv'] / max(tri, 1):.1f}%)")
        if info['folded_mirror_uv']:
            print(f"  folded {info['folded_mirror_uv']:,} out-of-range UVs on "
                  f"mirrored axes")
        if info.get('rigs'):
            names = ", ".join(f"{k} x{v}" for k, v in
                              sorted(info.get('rig_counts', {}).items()))
            print(f"  {info['rigs']} object rig instances ({names})")
        for rig in getattr(_resolve_rigs, "blocked", []):
            if rig.placement_blocked:
                print(f"  rig {rig.name} transcribed but NOT placed: "
                      f"{rig.placement_blocked.split(':')[0]}")
        if info['paths']:
            print(f"  {info['paths']} cam/ paths -> {info['cameras']} animated "
                  f"cameras + rails ({', '.join(c.name for c in cam_files)})")
        print(f"  -> {info['gltf']}")
        return 0

    if not args.name:
        raise SystemExit("give --name, --stage or --list")

    name = args.name
    try:
        models, bank = stagelib.load_asset(game, name)
    except (FileNotFoundError, ValueError) as exc:
        raise SystemExit(str(exc))
    out_dir = args.out / name
    cam_files = [] if args.no_cameras else stagelib.load_cam_paths(game, None, name)
    info = gltf.export_level(name, [(name, models, bank)], out_dir,
                             write_textures=not args.no_textures,
                             uv_check=args.uv_check,
                             cam_files=cam_files, cam_step=args.cam_step,
                             unlit=args.unlit, fold_mirror_uv=args.fold_mirror_uv,
                             glb=args.glb)
    tri = sum(m.triangle_count for m in models)
    vert = sum(m.vertex_count for m in models)
    bank_note = f"  bank: {len(bank.offsets)} textures" if bank else ""
    print(f"{name}: {len(models)} models, {vert:,} verts, {tri:,} tris, "
          f"{info['materials']} materials, {info['textures']} textures{bank_note}")
    if info['paths']:
        print(f"  {info['paths']} cam/ paths -> {info['cameras']} animated "
              f"cameras + rails ({', '.join(c.name for c in cam_files)})")
    print(f"  -> {info['gltf']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
