#!/usr/bin/env python3
"""
Build the static bundle the browser stage player loads.

    python3 tools/export_player.py --game-dir "..." --all       # both modes
    python3 tools/export_player.py --game-dir "..." --stage 2   # both modes
    python3 tools/export_player.py --game-dir "..." --stage 2 --original
    python3 tools/export_player.py --game-dir "..." --stage 2 --arcade

**Both game modes unless you ask for one.** Original Mode is half the game, not
a variant of the export, and a default that built only Arcade left six of the
twelve stage bundles carried forward from whenever they were last built.

Output lands in ``extract/player/``. Serve that directory (or point the dev
server at it) and open the player; see ``web/README.md``.

Every format is parsed here, in Python, exactly once. The client re-implements
none of them -- it loads glTF, evaluates Hermite curves and walks the resolved
event script. See docs/PLAYER_PLAN.md for why that split was chosen.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import bundle, schema, stage as stagelib  # noqa: E402


def _report(out: Path, entries: list[dict]) -> None:
    """What this export could not read, printed at the end where it is read.

    The decoders' warnings already travelled -- `evt`'s in the stage JSON since
    the beginning, `cam`'s since format 4 -- and the player surfaces both. But
    the person who runs the export is the person who can act on them, and they
    were only visible by opening the JSON afterwards. Scrolling back through a
    few hundred lines of per-stage progress is not "visible".

    So: one block at the end, after the size line, always printed -- including
    the "nothing" case, because "no warnings" and "I forgot to look" are the
    two readings of an absent summary and only one of them is good news.
    """
    rows: list[tuple[str, str, list[str]]] = []
    for e in entries:
        d = out / e["name"]
        for kind, fname in (("script", e.get("script")), ("cam", e.get("cam"))):
            f = d / fname if fname else None
            if not f or not f.is_file():
                continue
            try:
                w = json.loads(f.read_text()).get("warnings") or []
            except (OSError, ValueError):
                # not-a-loss: the file was just written and indexed; a read
                # failure here is about this summary, not about the bundle,
                # and the export itself has already reported its own errors.
                continue
            if w:
                rows.append((e["name"], kind, w))

    if not rows:
        print("\ndecoder warnings: none -- every cam/ and evt/ block in every "
              "stage parsed whole")
        return
    # One stream, because two of them interleave: the header went to stdout and
    # the detail to stderr, and a terminal showed the warnings above the line
    # introducing them. All of it is a warning, so all of it is stderr.
    n = sum(len(w) for _, _, w in rows)
    sys.stdout.flush()
    print(f"\ndecoder warnings: {n} across {len(rows)} block(s). "
          f"The player shows these in the feed too.", file=sys.stderr)
    for name, kind, w in rows:
        print(f"  {name} ({kind}): {len(w)}", file=sys.stderr)
        for line in w[:8]:
            print(f"      {line}", file=sys.stderr)
        if len(w) > 8:
            print(f"      ... and {len(w) - 8} more", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True, type=Path)
    ap.add_argument("--stage", type=int, action="append",
                    help="stage number; repeatable")
    ap.add_argument("--all", action="store_true", help="every stage, 1-6")
    ap.add_argument("--arcade", action="store_true",
                    help="Arcade Mode only; the default is both modes")
    ap.add_argument("--original", action="store_true",
                    help="also build the Original Mode (game mode 1) variant")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent
                    / "extract" / "player")
    ap.add_argument("--gltf", action="store_true",
                    help="write .gltf + .bin + loose PNGs instead of one .glb. "
                         "Easier to inspect; ~1300 files and a fetch storm")
    ap.add_argument("--no-textures", action="store_true")
    ap.add_argument("--lit", action="store_true",
                    help="do not mark materials KHR_materials_unlit. The game "
                         "bakes its illumination into textures and the "
                         "per-mesh base colour, so unlit is the faithful "
                         "default")
    args = ap.parse_args()

    game = args.game_dir.expanduser().resolve()
    if not (game / "Hod2.exe").exists():
        raise SystemExit(f"no Hod2.exe under {game}")

    wanted = sorted(set(args.stage or ())) or ([1, 2, 3, 4, 5, 6]
                                               if args.all else [])
    if not wanted:
        raise SystemExit("give --stage N (repeatable) or --all")

    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    # **The client's half of the schema check, regenerated here.**
    #
    # `manifest.json` carries a digest of `web/src/bundle/*.ts`; the browser
    # compares it against `web/src/bundle/schema_hash.ts`, which is generated
    # and committed. Writing it on every export means the two halves cannot
    # disagree in a bundle this tool produced -- and if the file changes, it
    # changes in the working tree where `git status` will show it, rather than
    # in a build directory nobody reads. `tools/verify_exporters.py` fails
    # when the committed copy is stale, which is what stops it drifting for
    # anyone who edits a declaration without exporting.
    hash_path, rewrote = schema.write_client_hash()
    if rewrote:
        print(f"regenerated {hash_path.name} -- commit it with the "
              f"declaration change that moved it")

    # **Both modes by default.** `--original` used to *add* Original Mode to a
    # run that was otherwise Arcade-only, so the plain `--all` everyone runs
    # built six of the twelve stage bundles and left the other six carried
    # forward from whenever they were last built. A format bump then left those
    # six stale, on disk, indexed by a fresh manifest, and refused by the
    # client -- which is the failure the per-stage `format` exists to catch,
    # arrived at by a default nobody chose.
    #
    # Original Mode is not a variant of the export, it is half of the game:
    # same regions, a handful of slots resolving to `st_org*` models the
    # Arcade tables never name. So both, unless the caller asks for one.
    modes = [False, True]
    if args.arcade and not args.original:
        modes = [False]
    elif args.original and not args.arcade:
        modes = [True]

    entries = []
    for n in wanted:
        for original in modes:
            try:
                st = stagelib.Stage(game, stage=n, original=original)
            except (ValueError, FileNotFoundError) as exc:
                print(f"stage {n}: {exc}", file=sys.stderr)
                continue
            print(f"stage {n}{' (Original Mode)' if original else ''}")
            entries.append(bundle.build_stage(
                st, out,
                glb=not args.gltf,
                write_textures=not args.no_textures,
                unlit=not args.lit,
                progress=print))
            c = entries[-1]["counts"]
            print(f"  -> {c['models']} models, {c['triangles']:,} tris, "
                  f"{c['textures']} textures, {c['regions']} regions, "
                  f"{c['blocks']} blocks ({c['branch_points']} branch points), "
                  f"{c['cam_paths']} cam paths, {c['spawns']} spawns")
            if c.get("degraded"):
                print(f"  -> {c['degraded']} DEGRADED: this bundle is missing "
                      f"parts of the game (see the warnings above, and "
                      f"`degraded` in the manifest entry)", file=sys.stderr)

    if not entries:
        raise SystemExit("nothing was built")

    # **The manifest is the whole bundle's index, and a partial export used to
    # replace it.** `--stage 2` after a `--all` left a manifest naming stage 2
    # alone, and the player simply had no other stages -- silently, because
    # every other stage's files were still sitting on disk beside it. So carry
    # forward any entry this run did not rebuild whose files are still there,
    # and say which, rather than dropping it.
    #
    # A carried entry names its own files, so `--gltf` and `--glb` bundles can
    # sit side by side; the top-level `notes` cannot say that, and describes
    # this run. Rebuild everything if that matters.
    built = {e["name"] for e in entries}
    kept = []
    old_path = out / "manifest.json"
    if old_path.exists():
        try:
            previous = json.loads(old_path.read_text()).get("stages", [])
        except (OSError, ValueError) as exc:                   # noqa: PERF203
            print(f"manifest.json unreadable, starting fresh ({exc})",
                  file=sys.stderr)
            previous = []
        for e in previous:
            if e.get("name") in built:
                continue
            files = [e.get(k) for k in ("geometry", "cam", "script")]
            if not all(f and (out / e["name"] / f).exists() for f in files):
                continue
            entries.append(e)
            kept.append(e["name"])
    if kept:
        print(f"carried forward from the previous manifest: {', '.join(kept)}")
    # A carried entry was written by whatever tool built it, which is not
    # necessarily this one. Its files are on disk and index fine; the client
    # refuses that stage on its own `format` and says so. Say it here too --
    # the person who ran a partial export is the one who can fix it.
    stale = sorted(e["name"] for e in entries
                   if e.get("format") != bundle.BUNDLE_FORMAT)
    if stale:
        print(f"stale stage format, the client will refuse these: "
              f"{', '.join(stale)} -- rebuild them (--all)", file=sys.stderr)
    entries.sort(key=lambda e: (e.get("stage", 0), e.get("name", "")))

    path = bundle.write_manifest(
        out, entries, game_dir=game,
        notes={
            "unlit": not args.lit,
            "geometry": "gltf" if args.gltf else "glb",
            "cameras": "raw Hermite curves in <stage>.cam.json; the client "
                       "evaluates and draws the rails itself",
        })
    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"\n{len(entries)} stage bundles, {total / 1e6:.1f} MB -> {path}")
    _report(out, entries)

    # **A degraded export fails. There is no flag for this.**
    #
    # It was tempting to put it behind `--strict` and leave the default
    # permissive, and that would have reproduced F16 one level up: a switch
    # nobody passes is a check that never fires, which is the whole finding.
    # If anything under `hod2lib` answered a failure with an empty result then
    # this bundle is missing part of the game, and a tool that prints a
    # warning and exits 0 is telling the next person it went fine.
    #
    # The files are still written. That is deliberate -- an incomplete bundle
    # is often exactly what you want to *look at* while finding out why -- but
    # the exit code says what it is.
    short = {e["name"]: e["counts"]["degraded"] for e in entries
             if e.get("counts", {}).get("degraded")}
    if short:
        where = ", ".join(f"{n} ({k})" for n, k in sorted(short.items()))
        print(f"degraded: {where}", file=sys.stderr)
        print("the bundle is written but incomplete; this is a failure",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
