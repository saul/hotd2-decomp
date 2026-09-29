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
    python3 tools/verify_all.py --quick               # the inner loop, ~20 s
    python3 tools/verify_all.py --list                # the table, run nothing

The checks run in parallel, one per core, except the ones that drive a
browser, which take turns in a lane of their own beside the rest (see
`LANE_BROWSER`); `-j 1` is the old serial run. The whole list against the
game is about a minute and a half, nearly all of it that lane.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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
    #: Checks that share a lane run one at a time, in table order; every
    #: check with none runs in the pool beside them. See `LANE_BROWSER`.
    lane: str = ""


#: Every check that drives a Chrome. **One at a time, always**: with a second
#: headless Chrome open -- any, silent or not -- every media element in an
#: audio check reads a peak of exactly zero (L29), and two vite servers
#: starting together race on the dependency cache every worktree shares
#: (`504 Outdated Optimize Dep`). The lane runs beside the pool, which holds
#: no browser.
LANE_BROWSER = "browser"


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
    Check("test:audio", "web", ["npm", "run", "--silent", "test:audio"],
          "`PlaySoundId`'s dispatch -- the loop flag, the three one-shot "
          "tracks, the three control words -- and the byte stream channel 0xF "
          "plays, tail and channel swap included, with no browser"),
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
    Check("test:net-codec", "web", ["npm", "run", "--silent", "test:net-codec"],
          "that netplay's state codec lands a replica on the host's state "
          "exactly -- deep-equal and hash-equal on every tick it applies -- "
          "over fuzzed trees with lost, reordered and late-acked packets; the "
          "only check of the delta's window property and of pool identity"),
    Check("test:matchmaker", "web", ["npm", "run", "--silent", "test:matchmaker"],
          "that the netplay matchmaker keeps its protocol -- a room code, TURN "
          "credentials, the host's offer and player 2's answer, each behind its "
          "own token -- over real HTTP in the Node server and in-process in the "
          "Cloudflare Worker, and reads Cloudflare's TURN credentials in both "
          "of their shapes"),
    Check("test:turn", "web", ["npm", "run", "--silent", "test:turn"],
          "that the TURN relay the dev server runs keeps RFC 8656 over real "
          "UDP: the credential challenge, the minted credentials accepted and "
          "bad ones refused, permissions before any traffic, indications and "
          "channels both ways -- the relay every WebRTC session on a machine "
          "without a direct path goes through"),
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
    Check("test:net", "web", ["npm", "run", "--silent", "test:net"],
          "that netplay's host and replica sessions keep a replica on the "
          "host's state through a real stage on a lossy link -- every tick "
          "hash-verified, a seek's epoch followed, player 2's START and "
          "shots reaching player index 1 once each -- with no browser",
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
    Check("net_pair", "web", ["npm", "run", "--silent", "net-pair", "--",
                              "--seconds", "8"],
          "that two-player netplay works in the page: a host and a replica "
          "in two tabs of a Chrome as users have it, over real WebRTC through "
          "the dev server's rendezvous -- directly, on a bad link, and "
          "through its TURN relay alone -- every tick the replica applies "
          "hash-equal to the host's, player 2 joining and scoring, its aim "
          "checked against the host's camera, a pause and a stage change "
          "survived, and player 2 leaving ending it -- the only check of the "
          "replica's install "
          "into G and of the render layers following a state they did not "
          "make",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("loops", "web", ["npm", "run", "--silent", "loops"],
          "that the looping sound effects reach an <audio> element, wrap "
          "rather than running out, and are still there when the stage is "
          "reached by a deep link -- the only check in the tree that measures "
          "the mixer rather than the intent",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("offline", "web", ["npm", "run", "--silent", "offline-check"],
          "that the service worker never shows a stale copy while the server "
          "answers -- a bundle file changed on disk is the new one on the next "
          "reload -- and that with the server stopped a reload still loads "
          "the stage from the device and draws it",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("bgm_loop", "web", ["npm", "run", "--silent", "bgm-loop"],
          "that the page's music is the engine's stream -- the buffer the "
          "script's own track reaches Web Audio as is one period of the file "
          "from its first sample to end of file, looped, sample for sample -- "
          "and that it is audible",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("keys", "web", ["npm", "run", "--silent", "keys"],
          "that the page's keys do what the `?` list says when pressed -- "
          "test:ui holds the list to the handlers' source, this reads back "
          "what a press did -- and that a click on a control over the game "
          "hands Space and Enter (START) back to the game rather than "
          "leaving them with the button",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("continue", "web",
          ["node", "tools/continue_page.mjs", "--headless"],
          "that the last life lost with credits left puts CONTINUE? and its "
          "digit where the exe draws them, holds the script at its wait, and "
          "that START -- pressed on the corner button, the one START a phone "
          "has -- spends a credit and puts the player back in play",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("options", "web",
          ["node", "tools/options_page.mjs", "--headless"],
          "that the menu's Options reaches the game's options screen in the "
          "real page, that its title and red highlighted row are on the HUD "
          "canvas, that the page's arrows and Enter drive the list -- lives "
          "and continues changed, the hidden rows stepped over, a held arrow "
          "running the sound test -- and that EXIT saves the profile in the "
          "browser and starts a game with five lives, four credits and the "
          "chosen crosshair on the reticle, and that a reload boots what "
          "was saved in place of the free-play default",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("crosshair", "web",
          ["node", "tools/crosshair_page.mjs", "--headless"],
          "that real pointer events reach HudDrawCrosshair as the exe's "
          "devices -- a mouse move is input mode 6 and the reticle is the "
          "Sight Graphic's sprite out of the bundle, sized to the frame and "
          "centred on the pointer; a touch is the light gun, 0xD, and the "
          "game draws no crosshair until the mouse moves again; and a phone, "
          "with no fine pointer, never shows one",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("story_switch", "web",
          ["node", "tools/story_switch_page.mjs", "--headless"],
          "that in the real page a story-mode switch opens its branch when "
          "it is shot through its mesh: stage 2 in Original Mode, a pull at "
          "the gateway door's own blob throws it, and the walker leaves "
          "block 1 for block 29, where the same address with no pull goes to "
          "block 2 -- the route five of the game's branch records hang on, "
          "which no shot could reach while the prop pool was outside the "
          "shot-test list",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("animals", "web", ["npm", "run", "--silent", "animals"],
          "that the frog, the owl and the fish are placed from a real bundle "
          "and leave their opening state -- none of the three is a skinned "
          "enemy the character layer can build, and two have no character "
          "type at all",
          NEEDS_BUNDLE),
    Check("horde", "web", ["npm", "run", "--silent", "horde"],
          "that each of the five class-0x40 hordes is built from a real bundle, "
          "walks in, dives and bites, and that shooting every member gives "
          "both counters back and lets the walker past the room's "
          "wait_enemies_alive -- the members are runtime children with no "
          "descriptor, so only the placer's own spawn can bring them into play",
          NEEDS_BUNDLE),
    Check("dives", "web", ["npm", "run", "--silent", "dives"],
          "that a class-0x43 dive reaches the camera it is aimed at, strikes "
          "and comes round again -- the only check that drives a class "
          "against the stage's own `cam_play` rather than an eye the harness "
          "made up, which is what every other owl check does and why none of "
          "them could see a run-in parked five units under the eye",
          NEEDS_BUNDLE),
    Check("boss4_fight", "web", ["npm", "run", "--silent", "boss4_fight"],
          "that the stage-4 boss's fight runs from its entrance to "
          "`g_script_flags[32]` in both arenas, against the stage's own script "
          "and camera paths -- the only check that plays a boss's phases, its "
          "camera cues and the (2,6) rail they move, since the playthrough "
          "stops on entering the end block the fight is in",
          NEEDS_BUNDLE),
    Check("handback", "web", ["npm", "run", "--silent", "handback"],
          "that a room waits for the camera to turn back onto its rail after "
          "the last enemy dies and not merely for the counter -- the only "
          "check that measures the *pacing* of a room-clear gate rather than "
          "whether it opens at all, and the one that separates the two "
          "drivers a `finish_sequence` can install",
          NEEDS_BUNDLE),
    Check("civ_speech", "web", ["npm", "run", "--silent", "civ_speech"],
          "that a rescued civilian holds a camera slot while her script asks, "
          "and that the room-clear gate therefore waits for her lines and her "
          "shutter -- the only check that plays a real civilian stream against "
          "the stage's own gate, and the reason a non-enemy can be a camera "
          "candidate at all",
          NEEDS_BUNDLE),
    Check("civilians", "web", ["npm", "run", "--silent", "civilians"],
          "that every class-0x10 civilian in the six stages runs her shipped "
          "stream beside her real captors -- none runs away, every captor "
          "the bundle names is placed, the captors (class 0x30 and the "
          "carrier's class 0x18) work on her rather than on the camera, and "
          "shooting them pays the rescue to the player who shot -- the only "
          "check over the whole corpus of streams rather than one room's, so "
          "the one whose rescue and maul counts move when a captor class, the "
          "motion clock or the prune changes under it",
          NEEDS_BUNDLE),
    Check("civ_gives", "web", ["npm", "run", "--silent", "civ_gives"],
          "that every civilian whose shipped stream puts an item in her hand "
          "hands it over -- the life to the player in play with its marker, "
          "an Original Mode item into `g_original_items_taken` with its "
          "banner -- and stops holding it, playing each from the evt step "
          "that spawns her with the stage's own camera; the only check that "
          "reaches a give, which `civilians` cannot with its camera parked "
          "five thousand units away",
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
    Check("verify_prop_tables", ".",
          ["python3", "tools/verify_prop_tables.py", "--game-dir", "{game_dir}"],
          "that the tables class 0x41 types 38, 39, 40, 44, 50 and 66 build their "
          "objects from -- positions, angles, hull corners, slots, counts, "
          "scales -- are the EXE's own words, and class 0x28's route, "
          "length and pose tables with them: the port carries them as "
          "literals, and a mistyped row would put a church chair somewhere "
          "the engine does not, with nothing else to notice",
          NEEDS_GAME),
    Check("verify_flag_strips", ".",
          ["python3", "tools/verify_flag_strips.py", "--game-dir", "{game_dir}"],
          "that the exporter reads class 0x12's descriptor tail at the "
          "offsets and widths `ScriptedPropInit12` reads it, quoted out of "
          "the EXE, that every class-0x12 spawn on the disc is placed with "
          "exactly those fields, and that every slot its strip can draw is in "
          "its bundle -- the check for stage 1's door, the wood the bin "
          "captor bursts out of, which the port built nothing for until the "
          "class had a module",
          NEEDS_GAME),
    Check("verify_prop_meshes", ".",
          ["python3", "tools/verify_prop_meshes.py", "--game-dir", "{game_dir}"],
          "that the story-mode switch and stage 1's window are still, in the "
          "EXE, shot through the blob at `obj+0x14C` and the matrix their "
          "draw stores at `obj+0x150`, that the exporter reads their tails "
          "where the builders do, and that every one on the disc is placed "
          "with its blob resolved and in its stage's `coli.blobs` -- the "
          "check for the five route branches a switch answers, none of which "
          "the port could shoot while the bundle carried a raw pointer",
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
    Check("verify_bgm_stream", ".",
          ["python3", "tools/verify_bgm_stream.py", "--game-dir",
           "{game_dir}"],
          "that the music has no loop points to find -- the exe's own bytes "
          "stream channel 0xF and seek it back to the first sample at end of "
          "file, the port's one-shot ids are the exe's three, and every "
          "looping track in both tables is long enough for that model to be "
          "exact",
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
          "that governs it -- and the size both arms are drawn at: "
          "`ActorBuildSkinnedModel`'s per-type switch decoded from its jump "
          "table against the port's `ActorModelScale`, and the characters "
          "that pose those clips found in the six stages' spawns",
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
    Check("verify_horde", ".",
          ["python3", "tools/verify_horde.py", "--game-dir", "{game_dir}"],
          "that every number the class-0x40 horde is steered by -- its entry "
          "splines, spline rates, shot delays, wander grid, second skin and "
          "the emerge prop's corners -- is the EXE's, and that the seven "
          "descriptors split five hordes to two props on the byte PlaceHorde "
          "switches on",
          NEEDS_GAME),
    Check("verify_continue", ".",
          ["python3", "tools/verify_continue.py", "--game-dir", "{game_dir}"],
          "that the continue screen the port draws -- the run's CONTINUE? "
          "and digit, the two-player small ones, the small GAME OVER and the "
          "credit line -- is at the EXE's positions, scales and sprite ids, "
          "read as instruction bytes and `.rdata` rows; that only one "
          "credit-line drawer can run, because the credit costs are stored "
          "once, as 1; and that all eight wait opcodes read the gameplay gate "
          "that holds the script while nobody is in play. Nothing else looks "
          "at a picture that, when wrong, is simply not there",
          NEEDS_GAME),
    Check("verify_options", ".",
          ["python3", "tools/verify_options.py", "--game-dir", "{game_dir}"],
          "that the profile reading is right on the user's own save -- the "
          "four disguised files deciphered with the key taken out of "
          "`ProfileCipher`'s instructions, and the block's byte sum and "
          "version checked -- that Blood Color is dead in this build (one "
          "store of its gate, no reader of its byte), and that the options "
          "screen's factory tables, sprite ids, positions and glyph table are "
          "the EXE's, with the bundle's `options` block when there is one",
          NEEDS_GAME),
    Check("verify_water", ".",
          ["python3", "tools/verify_water.py", "--game-dir", "{game_dir}"],
          "that class 0x41 type 1, the canal water task, starts from the table "
          "the EXE indexes -- ten flat water tiles -- and that every slot, "
          "flag, camera cue and multiplier the port's copy of it tests is the "
          "immediate at the instruction that holds it; its fifteen spawns sit "
          "at the origin, so a wrong reading draws nothing and looks like "
          "nothing",
          NEEDS_GAME),
    Check("verify_draw_order", ".",
          ["python3", "tools/verify_draw_order.py", "--game-dir",
           "{game_dir}"],
          "that the player's two passes and translucent order are the EXE's: "
          "the blend and depth tables `render/draw_order.ts` copies, the "
          "alpha-test and blend-enable pushes, and the VIEW matrix and "
          "comparator bytes that make the sort nearest-first rather than the "
          "painter's order this repo's docs had -- plus that no mesh in `pol/` "
          "turns its depth write off, which is why translucent meshes occlude",
          NEEDS_GAME),
    Check("verify_texture_alpha", ".",
          ["python3", "tools/verify_texture_alpha.py", "--game-dir",
           "{game_dir}"],
          "that a texture's alpha reaches the bundle as the bank stores it, "
          "because the EXE's D3D path keeps it: the upload's format table and "
          "the A1R5G5B5 test, stage 0's alpha args, and a disassembly of the "
          "D3D module finding TSP bit 19 read only as half of the pass "
          "selector -- plus the corpus premise that makes a glTF alphaMode "
          "from the pass right, and, on a current bundle, no `_opaque` image "
          "and the IgnoreTexAlpha ARGB images byte-equal to the bank's alpha",
          NEEDS_GAME),
    Check("verify_bats", ".",
          ["python3", "tools/verify_bats.py", "--game-dir", "{game_dir}"],
          "that the class-0x46 bat's flight paths still line up with the "
          "descriptors that select them -- the only check on a class whose "
          "spawns are all at the world origin and take their whole position "
          "from an EXE table, so nothing about a wrong reading of them looks "
          "wrong in the data",
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
    Check("verify_skeletons", ".",
          ["python3", "tools/verify_skeletons.py", "--game-dir",
           "{game_dir}"],
          "that every character skeleton is walked whole -- one node per bone "
          "of the EXE's own motion-frame count -- which no rig, bake or render "
          "check notices when a walk comes up short: the stage-3 boss's heads "
          "lost thirteen nodes, their jaws and their weak bones to a depth cap",
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


def run_one(c: Check, game_dir: str | None, timeout: int,
            quick: bool = False) -> tuple[str, str, float]:
    """Returns (outcome, output, seconds). Exit 3 means it asserted nothing."""
    if quick and c.lane == LANE_BROWSER:
        return SKIP, "--quick leaves the browser lane out", 0.0
    if quick and c.needs == NEEDS_GAME:
        return SKIP, "--quick leaves the checks against the game out", 0.0
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


def run_all(checks: list[Check], game_dir: str | None, timeout: int,
            jobs: int, quick: bool = False) -> list[tuple[Check, str, str, float]]:
    """Run `checks`, the pool in parallel and each lane in order beside it.

    **Parallel because the list outgrew serial.** Fifty-odd checks one after
    another were three and a half minutes with nothing dominating -- a long
    tail of five-to-thirty-second suites, each waiting on the last. Every
    check is its own process with its own temporary files and its own
    port, so the only ones that cannot share the machine are the ones that
    share a browser, and those keep their lane.

    A line is printed as each check finishes, so the order on screen is the
    order they finished in; the summary and every failure's output below it
    stay in table order. `jobs` of 1 is the old serial run, lanes included.
    """
    w = max(len(c.name) for c in checks)
    lock = threading.Lock()
    done: dict[str, tuple[str, str, float]] = {}

    def one(c: Check) -> None:
        outcome, out, dt = run_one(c, game_dir, timeout, quick)
        with lock:
            done[c.name] = (outcome, out, dt)
            print(f"  {c.name:<{w}}  ... {outcome.upper():<4} {dt:5.1f}s",
                  flush=True)

    def lane(members: list[Check]) -> None:
        for c in members:
            one(c)

    if jobs <= 1:
        lane(checks)
    else:
        lanes: dict[str, list[Check]] = {}
        pool: list[Check] = []
        for c in checks:
            (lanes.setdefault(c.lane, []) if c.lane else pool).append(c)
        with ThreadPoolExecutor(max_workers=jobs + len(lanes)) as ex:
            # The lanes first: they are the long pole, and a slot taken by
            # a lane is not a slot a pool check waits for.
            futures = [ex.submit(lane, m) for m in lanes.values()]
            futures += [ex.submit(one, c) for c in pool]
            for f in futures:
                f.result()
    return [(c, *done[c.name]) for c in checks]


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
    ap.add_argument("--quick", action="store_true",
                    help="the inner loop: leave out the browser lane and the "
                         "checks against the installed game, and say so -- "
                         "they are skipped, never passed")
    ap.add_argument("--jobs", "-j", type=int, default=os.cpu_count() or 4,
                    help="checks run at once outside the browser lane "
                         "(default: one per core; 1 runs them in table order)")
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

    t0 = time.time()
    results = run_all(checks, args.game_dir, args.timeout, args.jobs, args.quick)
    wall = time.time() - t0

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
        # A check `--quick` left out needs nothing it lacked.
        kinds = {c.needs for c, why in skipped
                 if not why.startswith("--quick")}
        if NEEDS_BUNDLE in kinds:
            print("  build a bundle with `cd web && npm run export`, or point "
                  "HOTD2_BUNDLE at one.")
        if NEEDS_GAME in kinds:
            print("  pass --game-dir for the checks that compare against the "
                  "installed game.")
    cpu = sum(dt for _, _, _, dt in results)
    print(f"{passed} passed, {len(failed)} failed, {len(skipped)} skipped "
          f"in {wall:.0f}s ({cpu:.0f}s of checks)")

    if failed:
        return 1
    if skipped and args.strict:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
