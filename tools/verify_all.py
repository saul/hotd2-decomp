#!/usr/bin/env python3
"""Run every check this repo has, and say which ones actually ran.

**This file is the canonical list of checks.** A list that lives in one place
and is executable cannot drift from itself, so it is copied nowhere.

`tools/status.py` imports `CHECKS` from here to render the same table into
`docs/STATUS.md`, so the documentation of what is checked is one authored
source with two renderings.

Exit codes, and why a skip is not a pass:

* **0** -- every check that could run, ran and passed.
* **1** -- something failed.
* **2** -- `--strict` and something was skipped.

A check exits **3** when it asserted nothing -- no bundle, or no game
directory. Here a skip is counted, named and printed under its own heading;
it never disappears into a green line (L14).

    python3 tools/verify_all.py                       # what runs without assets
    python3 tools/verify_all.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
    python3 tools/verify_all.py --quick               # the inner loop, ~20 s
    python3 tools/verify_all.py --list                # the table, run nothing

The checks run in parallel, one per core, except the ones that drive a
browser, which take turns in a lane of their own beside the rest (see
`LANE_BROWSER`); `-j 1` runs them one at a time in table order. The run
prints its own wall time.
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


def game(name: str, sees: str) -> Check:
    """A check against the installed game: `web/tools/checks/<name>.ts`,
    reading the game through `web/src/hod2lib/`."""
    return Check(f"game:{name}", "web",
                 ["node", "tools/run_ts.mjs", f"tools/checks/{name}.ts",
                  "--game-dir", "{game_dir}"],
                 sees, NEEDS_GAME)


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
    Check("test:r2site", "web", ["npm", "run", "--silent", "test:r2site"],
          "the deployed site's Worker, against a bucket in a Map: the 304s, "
          "the ranges and the stored-compressed bundle with its decoded "
          "length that the page's service worker and loading bar rely on"),
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
    Check("result_card", "web",
          ["node", "tools/result_card.mjs", "--headless"],
          "that the end of stages 1, 2 and 4 plays in the real page from "
          "their own result steps: one figure per rescue, of the rescued "
          "type, at the scene's places; the scene's own list, dead, with "
          "none; the count climbing from frame 31; the life bonus on frame "
          "302, capped; figure 0 holding the life up from camera frame 260 "
          "and freezing on cursor 0x81; the score and the accuracy drawn; "
          "the flag on frame 420 and the scene over after it",
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
    Check("judgment_reload", "web",
          ["node", "tools/judgment_reload_page.mjs", "--headless"],
          "that a reload at stage 5's `block=4&step=1&op=0` -- past "
          "JUDGMENT's return -- lands with no boss in the pool and nothing "
          "counted, and that block 4's room gate then counts exactly its own "
          "zombies and opens when they die: the only check that reads the "
          "enemy counters in a page a seek built, which is the rebuild every "
          "reload during development goes through (L75)",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("setpiece_shot", "web",
          ["node", "tools/setpiece_shot_page.mjs", "--headless"],
          "that a body lying on the floor -- stage 1's class-0x24 set-piece "
          "under the library desk -- survives a driven sweep of live pulls "
          "that kills the room's zombie around it: the only check that fires "
          "real pointer events at an actor the engine never files for the "
          "shot test, which the render pick used to offer and `ResolveHit` "
          "then killed",
          NEEDS_BUNDLE, LANE_BROWSER),
    Check("humanoid_shot", "web",
          ["node", "tools/humanoid_shot_page.mjs", "--headless"],
          "that stage 2's jetty zombies -- class-0x25 scripted humanoids, the "
          "four in the game whose spawn record leaves bit 0x8000 clear -- "
          "survive live pulls aimed through the page's own camera at their "
          "bodies while the gun is up: the one check that fires real pointer "
          "events at the class, which the render pick used to find through a "
          "wall and `ResolveHit` then killed for ninety points",
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
    game("annotations",
         "that every row of `ghidra/annotations/*.tsv` is an address in a real "
         "section of the EXE -- functions in `.text` -- with no address or "
         "name listed twice and none in both files"),
    Check("verify_ghidra_db", ".",
          ["python3", "tools/verify_ghidra_db.py", "--game-dir", "{game_dir}"],
          "that the Ghidra database every session decompiles from says what "
          "`ghidra/annotations/` says -- every prototype and no-return flag "
          "in `prototypes.tsv` applied, no flag it does not declare, and no "
          "database name one the file has renamed away from, which the next "
          "`export-annotations` would put back (L90) -- and that no `CALL` "
          "to a function that returns carries the `CALL_RETURN` override "
          "that prints as a clean `return;`: the only check that reads the "
          "database rather than the exe, and so the only thing that can say "
          "the pseudocode is not missing code (L89). Names and comments still "
          "on their way in either direction are counted, not failed. "
          "Asserts nothing without Ghidra or a project",
          NEEDS_GAME),
    game("prop_pose",
         "that every class-0x41 generic prop is posed in the order its own "
         "update routine poses it -- read out of the EXE per type and matched "
         "to the field each `MatrixRotate*` is handed -- that both copies of "
         "the generic slot tables are what the routines and the shipped "
         "`+0x11C` words say, and that `render/breakables.ts` composes a pose "
         "in one place, from the table"),
    game("prop_tables",
         "that the tables class 0x41 types 38, 39, 40, 44, 50 and 66 build "
         "their objects from -- positions, angles, hull corners, slots, "
         "counts, scales -- and class 0x28's route, length and pose tables "
         "are the EXE's own words, compared as 32-bit patterns against the "
         "values the port evaluates; a mistyped row puts a church chair where "
         "the engine does not, with nothing else to notice"),
    game("flag_strips",
         "that `class12Tail`, the exporter's read of class 0x12's descriptor "
         "tail, takes each field at the offset and width `ScriptedPropInit12` "
         "loads it, decoded out of the EXE; that every class-0x12 spawn on the "
         "disc is placed with exactly those fields; and, with a bundle, that "
         "every slot its strip can draw is in it"),
    game("branches",
         "that every value a branch trigger can write into "
         "`g_script_branch_var` names a route slot its own block actually "
         "fills -- the one check that ties the gameplay half of branching to "
         "the route tables"),
    game("scene_exits",
         "that a terminal route record's `next[0]` is a live block of the "
         "*next* scene, and that a hole follows every one of them -- the only "
         "check that reads the handover from one stage to the next, and so "
         "the only thing that can say stage 3 and stage 4 have two entry "
         "points each"),
    game("looping_se",
         "that `PlaySoundId`'s two loop tables pair index for index -- every "
         "entry is `X.wav` against `X_OFF.wav` and no `_OFF` file ships, "
         "which is what says a stop id is a control word rather than a sound "
         "-- and that class 0x30's play and stop ids are the operands of the "
         "EXE's own PUSHes"),
    game("bgm_stream",
         "that the music has no loop points to find -- the EXE's own bytes "
         "stream channel 0xF and seek it back to the first sample at end of "
         "file, the port's one-shot ids and ring length are the EXE's, and "
         "every looping track opens under the port's header walk and is long "
         "enough for its stream model to be exact"),
    game("root_pose",
         "that a clip's root translation either moves the object or offsets "
         "the pose -- the two arms of one `model+0x64` bit, quoted as bytes -- "
         "which actors the posing arm can move, measured over every motion "
         "block and paired with the class-0x10 wait word that governs it, and "
         "that `ActorModelScale` is `ActorBuildSkinnedModel`'s per-type switch, "
         "decoded from its jump table"),
    game("combat",
         "that the exporter's shot and damage readings hold together across "
         "every character type and match the EXE's bytes -- and the only place "
         "the *exact* set of attacks the engine can never land is asserted, "
         "which stops the crawlers' condition-4 swing being filtered out as "
         "an impossible row (L65, L71, L73)"),
    game("split_unreachable",
         "that nothing the shipped game runs reaches `ZombieSplitInTwo` "
         "(`FUN_0045D9F0`) -- no store of 4 to `g_hit_result`, one writer "
         "of the split bit and no way into its state, each beside a control "
         "that must be found -- which is the whole of the case for the port "
         "not transcribing the split, and the only check that can say when "
         "that case stops holding"),
    game("horde",
         "that every number the class-0x40 horde is steered by -- its entry "
         "splines, spline rates, shot delays, wander grid, second skin and "
         "the emerge prop's corners -- is the EXE's, and that the seven "
         "descriptors split five hordes to two props on the byte PlaceHorde "
         "switches on"),
    game("worm",
         "that every scalar the class-0x42 worm's port names is the `.rdata` "
         "word or the instruction operand the EXE loads, that its member "
         "routine's jump table has the seven arms the port's switch has, that "
         "its sounds and `buyo.bin` slots are the ones the port names, that "
         "the game's three class-0x42 descriptors are sub-types 1, 0 and 2, "
         "and, with a bundle, that the shadow the port draws without the "
         "scene light array is a black no light can change"),
    game("continue_screen",
         "that the continue screen the port draws -- the run's CONTINUE? and "
         "digit, the two-player small ones, the small GAME OVER and the credit "
         "line -- is at the EXE's positions, scales and sprite ids, read as "
         "instruction bytes and `.rdata` rows; that only one credit-line "
         "drawer can run; and that all eight wait opcodes read the gameplay "
         "gate that holds the script while nobody is in play"),
    game("options",
         "that the profile reading is right on the user's own save -- the "
         "four disguised files deciphered with the key taken out of "
         "`ProfileCipher`'s instructions, and the block's byte sum and version "
         "checked -- that Blood Color is dead in this build, and that the "
         "options screen's factory tables, sprite ids, positions and glyph "
         "table are the EXE's, with the bundle's `options` block when there is "
         "one"),
    game("result_card",
         "that every constant the result card's port transcribes is the "
         "immediate at its instruction; that the `.rdata` span the card reads "
         "with no bound is the EXE's bytes; that every rescuable civilian's "
         "type has an attachment list the unbounded lookup can find; and, "
         "with a bundle, that each stage placing the card carries a figure "
         "template and every clip for every type it can show"),
    game("water",
         "that class 0x41 type 1, the canal water task, starts from the table "
         "the EXE indexes -- ten flat water tiles -- and that every slot, flag, "
         "camera cue and multiplier the port's copy of it tests is the "
         "immediate at the instruction that holds it; its spawns sit at the "
         "origin, so a wrong reading draws nothing and looks like nothing"),
    game("draw_order",
         "that the player's two passes and translucent order are the EXE's: "
         "the blend and depth tables `render/draw_order.ts` copies, the "
         "alpha-test and blend-enable pushes, and the VIEW matrix and "
         "comparator bytes that make the sort nearest-first -- plus that no "
         "mesh in `pol/` turns its depth write off, which is why translucent "
         "meshes occlude"),
    game("texture_alpha",
         "that a texture's alpha reaches the bundle as the bank stores it, "
         "because the EXE's D3D path keeps it: the upload's format table and "
         "the A1R5G5B5 test, stage 0's alpha args, and TSP bit 19 read only as "
         "half of the pass selector -- plus the corpus premise that makes a "
         "glTF alphaMode from the pass right and, on a current bundle, no "
         "`_opaque` image and the IgnoreTexAlpha images byte-equal to the "
         "bank's alpha"),
    game("bats",
         "that the class-0x46 bat's flight paths line up with the descriptors "
         "that select them, and that the port's spline table, motion pair and "
         "swarm counts are the EXE's bytes -- the only check on a class whose "
         "spawns are all at the world origin and take their whole position "
         "from an EXE table"),
    game("bone_cels",
         "that every cel run `ZombieDrawBonePart` (`FUN_004534A0`) draws is "
         "the arithmetic in the EXE and is in the bundle -- no table in the "
         "image names those models, so this is the only thing standing "
         "between a hand-written run and a character losing a part"),
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

    Every check is its own process with its own temporary files and its own
    port, so the only ones that cannot share the machine are the ones that
    share a browser, and those keep their lane.

    A line is printed as each check finishes, so the order on screen is the
    order they finished in; the summary and every failure's output below it
    stay in table order. `jobs` of 1 runs everything in table order.
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
