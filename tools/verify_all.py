#!/usr/bin/env python3
"""Run every check this repo has, and say which ones actually ran.

**This file is the canonical list of checks.** It used to be a shell block
copied into `CLAUDE.md`, `.claude/skills/decomp/SKILL.md`,
`.claude/skills/gameplay-port/SKILL.md` and twice into
`.claude/skills/hang-investigation/SKILL.md` -- five copies, four of them
stale, three of them missing suites that had existed for weeks. A list that
lives in one place and is executable cannot drift from itself.

`tools/status.py` imports `CHECKS` from here to render the same table into
`docs/STATUS.md`, so the documentation of what is checked is one authored
source with two renderings.

Exit codes, and why a skip is not a pass:

* **0** -- every check that could run, ran and passed.
* **1** -- something failed.
* **2** -- `--strict` and something was skipped.

A check exits **3** when it asserted nothing. That is the convention the
bundle-gated suites use, and the reason it exists is that four regression
tests silently asserted nothing on any machine without game assets while the
record described them as passing. Here a skip is counted, named and printed
under its own heading; it never disappears into a green line.

    python3 tools/verify_all.py                       # what runs without assets
    python3 tools/verify_all.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
    python3 tools/verify_all.py --list                # the table, run nothing
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: What a check needs before it can assert anything.
NEEDS_NOTHING = ""
NEEDS_BUNDLE = "bundle"      # an exported player bundle (extract/player)
NEEDS_GAME = "game-dir"      # the installed game, for a byte-level comparison


@dataclass(frozen=True)
class Check:
    """One check, and the single sentence that says why it is not redundant.

    `sees` is the load-bearing field. A check whose `sees` duplicates another
    check's is a check to delete, and writing them next to each other is the
    only way that ever becomes visible.
    """

    name: str
    cwd: str              # "." or "web"
    cmd: list[str]        # argv; `{game_dir}` is substituted
    sees: str
    needs: str = NEEDS_NOTHING


#: Ordered cheapest-first, so a broken tree fails in seconds rather than
#: minutes. `tsc` comes before every suite that would fail confusingly
#: without it.
CHECKS: list[Check] = [
    Check("tsc", "web", ["npx", "tsc", "--noEmit"],
          "that the whole tree -- `test/` and `tools/` included -- typechecks"),
    Check("verify_layers", ".", ["python3", "tools/verify_layers.py"],
          "the layer boundaries, and any ratchet's current count"),
    Check("verify_port", ".", ["python3", "tools/verify_port.py"],
          "that every exe citation in the port matches `functions.tsv`, "
          "under the same name"),
    Check("verify_player_ops", ".", ["python3", "tools/verify_player_ops.py"],
          "that the opcode table and the implementations agree"),
    Check("verify_player_dom", ".", ["python3", "tools/verify_player_dom.py"],
          "that the stylesheet and the markup agree, in both directions"),
    Check("verify_exporters", ".", ["python3", "tools/verify_exporters.py"],
          "that no exporter swallows a failure and reports success"),
    Check("status", ".", ["python3", "tools/status.py", "--check"],
          "that `docs/STATUS.md` still matches the tree it describes"),
    Check("test:port", "web", ["npm", "run", "--silent", "test:port"],
          "the state machines, driven headless against hand-written tables"),
    Check("test:bundle", "web", ["npm", "run", "--silent", "test:bundle"],
          "that the bundle reader refuses what it should refuse"),
    Check("test:export", "web", ["npm", "run", "--silent", "test:export"],
          "the three pieces of the TypeScript exporter that comparing two "
          "bundles cannot check -- `json.dumps`'s separators, the "
          "case-insensitive path resolve, and an archive something else can "
          "open"),
    Check("test:scope", "web", ["npm", "run", "--silent", "test:scope"],
          "that lifetimes are given back"),
    Check("test:projection", "web", ["npm", "run", "--silent", "test:projection"],
          "that unchanged slices keep their identity across a frame"),
    Check("test:ui", "web", ["npm", "run", "--silent", "test:ui"],
          "that the page has the shape the stylesheet expects"),
    Check("test:pose", "web", ["npm", "run", "--silent", "test:pose"],
          "that a skeleton posed from a motion lands where the exporter says"),
    Check("test:render", "web", ["npm", "run", "--silent", "test:render"],
          "that the renderers rebuild from engine state alone"),
    Check("test:texfilter", "web", ["npm", "run", "--silent", "test:texfilter"],
          "that the texture filter modes match the D3D7 translation"),
    Check("verify:ui", "web", ["npm", "run", "--silent", "verify:ui"],
          "the two UI rules that need an AST rather than a regex"),
    Check("test:seek", "web", ["npm", "run", "--silent", "test:seek"],
          "that a seek reaches the address it was asked for",
          NEEDS_BUNDLE),
    Check("test:state", "web", ["npm", "run", "--silent", "test:state"],
          "that a save/load and a seek reach the *same world* play did -- "
          "the only check that compares two histories rather than one",
          NEEDS_BUNDLE),
    Check("test:camera", "web", ["npm", "run", "--silent", "test:camera"],
          "that a camera path seats where the exe's own evaluation puts it",
          NEEDS_BUNDLE),
    Check("flag_gates", "web",
          ["node", "tools/run_ts.mjs", "tools/flag_gates.ts"],
          "that every `wait_script_flag` gate no `set_script_flag` on the "
          "*route* to it can open has the actor that opens it placed on that "
          "same route -- the only check that reads a gate per entry block "
          "rather than per bundle, which is the difference between stage 3's "
          "block 2 on the entry-0 route and on the entry-7 one -- and the "
          "only check that asks the same question of an ACTOR, for the one "
          "class-0x30 state whose sole exit is a script flag a civilian's own "
          "stream raises",
          NEEDS_BUNDLE),
    Check("loops", "web", ["npm", "run", "--silent", "loops"],
          "that the looping sound effects reach an <audio> element, wrap "
          "rather than running out, and are still there when the stage is "
          "reached by a deep link -- the only check in the tree that measures "
          "the mixer rather than the intent",
          NEEDS_BUNDLE),
    Check("animals", "web", ["npm", "run", "--silent", "animals"],
          "that the frog, the owl and the fish are placed from a real bundle "
          "and leave their opening state -- none of the three is a skinned "
          "enemy the character layer can build, and two have no character "
          "type at all",
          NEEDS_BUNDLE),
    Check("dives", "web", ["npm", "run", "--silent", "dives"],
          "that a class-0x43 dive reaches the camera it is aimed at, strikes "
          "and comes round again -- the only check that drives a class "
          "against the stage's own `cam_play` rather than an eye the harness "
          "made up, which is what every other owl check does and why none of "
          "them could see a run-in parked five units under the eye",
          NEEDS_BUNDLE),
    Check("handback", "web", ["npm", "run", "--silent", "handback"],
          "that a room waits for the camera to turn back onto its rail after "
          "the last enemy dies and not merely for the counter -- the only "
          "check that measures the *pacing* of a room-clear gate rather than "
          "whether it opens at all, and the one that separates the two "
          "drivers a `finish_sequence` can install",
          NEEDS_BUNDLE),
    Check("props43", "web", ["npm", "run", "--silent", "props43"],
          "where in a real script a class-0x41 prop is actually placed, and "
          "that it takes a frame of `GameUpdate` to appear -- the only check "
          "that separates `spawn_placed` putting a *placer* in the pool from "
          "the constructor that builds the prop, which is the difference "
          "between a room the player has not cleared and a placement the "
          "player dropped. It is also the only harness that reports the "
          "address the walker reached rather than the one it asked for",
          NEEDS_BUNDLE),
    Check("verify_prop_slots", ".",
          ["python3", "tools/verify_prop_slots.py"],
          "that every asset slot a placed class-0x41 or class-0x44 prop will "
          "pass to `AssetDrawSlot` has a model in its own bundle -- the check "
          "that would have caught stage 3's roller shutter and the stage 5 "
          "van's body, both of which were placed, updated and invisible "
          "because nothing carried their geometry, which from the level looks "
          "exactly like a placement that was never exported",
          NEEDS_BUNDLE),
    Check("verify_death_clips", ".",
          ["python3", "tools/verify_death_clips.py"],
          "that every clip `ChooseDeathMotion` can put on a dying class-0x30 "
          "actor is baked for that spawn's own character type -- the only "
          "check that reads a death clip out of a real bundle, and the one "
          "that says whether an actor can leave state 12 at all, since that "
          "state's exit is an exact `obj+0x19C >= 0x3C` against a play clock "
          "that is 0 for a clip nothing carried",
          NEEDS_BUNDLE),
    Check("verify_cam_waits", ".",
          ["python3", "tools/verify_cam_waits.py"],
          "that every `wait_camera_path_frame <n>` asks for a frame the play "
          "in force actually publishes -- the only check that holds the three "
          "routines that publish a camera frame against the scripts that wait "
          "on them, and the one that says the strict `frame > operand` of "
          "`EvtOpWaitCameraPathFrame41` is safe to transcribe. Model scene "
          "state 7 as stopping on its range's end rather than one past it and "
          "twenty of the sites it checks become gates nothing can open",
          NEEDS_BUNDLE),
    Check("verify_prop_pose", ".",
          ["python3", "tools/verify_prop_pose.py", "--game-dir", "{game_dir}"],
          "that every class-0x41 generic prop is posed in the order its own "
          "update routine poses it -- read out of the EXE per type, matched to "
          "the field each `MatrixRotate*` is handed. `render/breakables.ts` "
          "composed one order for all fifty, and it was type 51's alone: "
          "twenty shipped spawns came out somewhere else, four of them by more "
          "than a degree and the worst by 19.65",
          NEEDS_GAME),
    Check("verify_annotations", ".",
          ["python3", "tools/verify_annotations.py", "--game-dir", "{game_dir}"],
          "that every annotated address is a real function in the EXE",
          NEEDS_GAME),
    Check("verify_branches", ".",
          ["python3", "tools/verify_branches.py", "--game-dir", "{game_dir}"],
          "that every value a branch trigger can write into "
          "`g_script_branch_var` names a route slot its own block actually "
          "fills -- the one check that ties the gameplay half of branching to "
          "the route tables",
          NEEDS_GAME),
    Check("verify_scene_exits", ".",
          ["python3", "tools/verify_scene_exits.py", "--game-dir",
           "{game_dir}"],
          "that a terminal route record's `next[0]` is a live block of the "
          "*next* scene, and that a hole follows every one of them -- the only "
          "check that reads the handover from one stage to the next, and so "
          "the only thing that can say stage 3 and stage 4 have two entry "
          "points each",
          NEEDS_GAME),
    Check("verify_looping_se", ".",
          ["python3", "tools/verify_looping_se.py", "--game-dir",
           "{game_dir}"],
          "that `PlaySoundId`'s two loop tables really do pair index for "
          "index -- every entry is `X.wav` against `X_OFF.wav` and no `_OFF` "
          "file ships, which is the only thing that says a stop id is a "
          "control word rather than a sound, and so the only thing that makes "
          "the chainsaw a loop rather than a one-shot",
          NEEDS_GAME),
    Check("verify_root_pose", ".",
          ["python3", "tools/verify_root_pose.py", "--game-dir",
           "{game_dir}"],
          "that a clip's root translation still either moves the object or "
          "offsets the pose -- the two arms of one `model+0x64` bit, quoted "
          "as bytes because Ghidra shows neither of them whole -- and the "
          "only place the set of actors the second arm can move is "
          "enumerated: every motion block in the game measured for an "
          "absolute horizontal root, paired with the class-0x10 wait word "
          "that governs it",
          NEEDS_GAME),
    Check("verify_combat", ".",
          ["python3", "tools/verify_combat.py", "--game-dir", "{game_dir}"],
          "that the shot and damage tables hold together across every "
          "character type -- and the only place the *exact* set of attacks "
          "the engine can never land is asserted, which is what stops the "
          "crawlers' condition-4 swing being filtered out again as an "
          "impossible row",
          NEEDS_GAME),
    Check("verify_effects", ".",
          ["python3", "tools/verify_effects.py", "--game-dir", "{game_dir}"],
          "that each of the 29 effect trees walks to exactly the node count "
          "`g_effect_bone_counts` declares, and that every motion the effect "
          "system plays divides by the stride that count implies -- the only "
          "check that reads a motion at the effect stride rather than a "
          "character's",
          NEEDS_GAME),
    Check("verify_attachments", ".",
          ["python3", "tools/verify_attachments.py",
           "--game-dir", "{game_dir}"],
          "that every face and accessory a spawn's attachment list names has "
          "a model in the stage's glTF -- the check that would have caught "
          "the civilians having no hair, because a civilian's own head model "
          "is a shell open at the back and every count was right without it",
          NEEDS_GAME),
    Check("verify_bone_cels", ".",
          ["python3", "tools/verify_bone_cels.py", "--game-dir",
           "{game_dir}"],
          "that every cel run `ZombieDrawBonePart` (`FUN_004534A0`) draws is "
          "still the arithmetic in the EXE and is still in the bundle -- no "
          "table in the image names those models, so this is the only thing "
          "standing between a hand-written run and `char_adv02` losing its "
          "midriff again",
          NEEDS_GAME),
    Check("verify_parts", ".",
          ["python3", "tools/verify_parts.py", "--game-dir", "{game_dir}"],
          "that every vertex-blended part in a bundle is skinned the way the "
          "exe deforms it -- one bone per vertex, weight 1, the exe's source "
          "geometry and no inverse binds -- which is the only check that can "
          "see the waist riding the hips instead of stretching to the chest",
          NEEDS_GAME),
    Check("verify_geometry", ".",
          ["python3", "tools/verify_geometry.py", "--game-dir", "{game_dir}"],
          "that every scenery part in a stage bundle holds every triangle its "
          "`pol/` models declare -- the only check that compares an export "
          "against the files it was made from rather than against another "
          "export",
          NEEDS_GAME),
    Check("baseline", ".",
          ["python3", "tools/baseline.py", "--game-dir", "{game_dir}",
           "--verify"],
          "that the installed assets still hash to `manifest.csv`",
          NEEDS_GAME),
]

PASS, FAIL, SKIP = "pass", "fail", "skip"


def run_one(c: Check, game_dir: str | None, timeout: int) -> tuple[str, str, float]:
    """Returns (outcome, output, seconds). Exit 3 means it asserted nothing."""
    if c.needs == NEEDS_GAME and not game_dir:
        return SKIP, "no --game-dir given", 0.0
    cmd = [a.replace("{game_dir}", game_dir or "") for a in c.cmd]
    if shutil.which(cmd[0]) is None:
        return SKIP, f"{cmd[0]} not on PATH", 0.0
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=ROOT / c.cwd, capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return FAIL, f"timed out after {timeout}s", time.time() - t0
    out = (p.stdout or "") + (p.stderr or "")
    dt = time.time() - t0
    if p.returncode == 0:
        return PASS, out, dt
    if p.returncode == 3:
        return SKIP, out.strip() or "asserted nothing (exit 3)", dt
    return FAIL, out, dt


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", help="the installed game, for the two "
                                       "checks that compare against it")
    ap.add_argument("--list", action="store_true",
                    help="print the table and run nothing")
    ap.add_argument("--only", action="append", default=[],
                    help="run only these checks, by name (repeatable)")
    ap.add_argument("--strict", action="store_true",
                    help="exit 2 if any check was skipped")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    if args.list:
        w = max(len(c.name) for c in CHECKS)
        for c in CHECKS:
            need = f"  [needs {c.needs}]" if c.needs else ""
            print(f"  {c.name:<{w}}  {c.sees}{need}")
        return 0

    checks = [c for c in CHECKS if not args.only or c.name in args.only]
    unknown = set(args.only) - {c.name for c in CHECKS}
    if unknown:
        print(f"no such check: {', '.join(sorted(unknown))}", file=sys.stderr)
        return 1

    results: list[tuple[Check, str, str, float]] = []
    w = max(len(c.name) for c in checks)
    for c in checks:
        print(f"  {c.name:<{w}}  ... ", end="", flush=True)
        outcome, out, dt = run_one(c, args.game_dir, args.timeout)
        print(f"{outcome.upper():<4} {dt:5.1f}s")
        results.append((c, outcome, out, dt))

    failed = [(c, o) for c, r, o, _ in results if r == FAIL for o in [o]]
    skipped = [(c, o) for c, r, o, _ in results if r == SKIP for o in [o]]
    passed = sum(1 for _, r, _, _ in results if r == PASS)

    for c, out in failed:
        print(f"\n--- {c.name} FAILED " + "-" * (56 - len(c.name)))
        print(out.rstrip()[-4000:])

    print()
    if skipped:
        print(f"skipped {len(skipped)}, and a skip asserted nothing:")
        for c, why in skipped:
            print(f"  {c.name}: {why.splitlines()[0] if why else ''}")
        kinds = {c.needs for c, _ in skipped}
        if NEEDS_BUNDLE in kinds:
            print("  build a bundle with `cd web && npm run export`, or point "
                  "HOTD2_BUNDLE at one.")
        if NEEDS_GAME in kinds:
            print("  pass --game-dir for the checks that compare against the "
                  "installed game.")
    print(f"{passed} passed, {len(failed)} failed, {len(skipped)} skipped")

    if failed:
        return 1
    if skipped and args.strict:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
