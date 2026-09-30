/**
 * Run every check this repo has, and say which ones actually ran.
 *
 *     cd web && npm run verify                                   # what runs without assets
 *     cd web && npm run verify -- --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     cd web && npm run verify -- --quick                        # the inner loop
 *     cd web && npm run verify -- --list                         # the table, run nothing
 *     cd web && npm run verify -- --only exporters --only tsc    # these, by name
 *
 * **This file is the canonical list of checks.** A list that lives in one
 * place and is executable cannot drift from itself, so it is copied nowhere:
 * `--list` prints it, and a document that wants the table points there. Add a
 * row to {@link CHECKS}, with the one sentence saying what only that check can
 * see.
 *
 * Every check runs from `web/`. Exit codes, and why a skip is not a pass:
 *
 * * **0** -- every check that could run, ran and passed.
 * * **1** -- something failed.
 * * **2** -- `--strict` and something was skipped.
 *
 * A check exits **3** when it asserted nothing -- no bundle, or no game
 * directory. Here a skip is counted, named and printed under its own heading;
 * it never disappears into a green line (L14). `--quick` leaves the browser
 * lane and the checks against the installed game out, and they are counted as
 * skipped, never as passed.
 *
 * The checks run in parallel, one per core, except the ones that drive a
 * browser, which take turns in a lane of their own beside the rest (see
 * {@link LANE_BROWSER}); `-j 1` runs them one at a time in table order. A line
 * is printed as each check finishes, the output of every failure after them
 * all, in table order, and the run prints its own wall time.
 */
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { delimiter, join } from "node:path";

import { repoRoot } from "./lib/bundle_root";

/** Where every check runs. */
const WEB = join(repoRoot(), "web");

/** What a check needs before it can assert anything. */
export const NEEDS_NOTHING = "";
/** An exported player bundle (`extract/player`, or `HOTD2_BUNDLE`). */
export const NEEDS_BUNDLE = "bundle";
/** The installed game, for a byte-level comparison. */
export const NEEDS_GAME = "game-dir";
export type Needs = typeof NEEDS_NOTHING | typeof NEEDS_BUNDLE | typeof NEEDS_GAME;

/**
 * Every check that drives a Chrome. **One at a time, always**: with a second
 * headless Chrome open -- any, silent or not -- every media element in an
 * audio check reads a peak of exactly zero (L29), and two vite servers
 * starting together race on the dependency cache every worktree shares
 * (`504 Outdated Optimize Dep`). The lane runs beside the pool, which holds no
 * browser.
 */
export const LANE_BROWSER = "browser";

/**
 * One check, and the single sentence that says why it is not redundant.
 *
 * `sees` is the load-bearing field. A check whose `sees` duplicates another
 * check's is a check to delete, and writing them next to each other is the
 * only way that ever becomes visible.
 */
export interface Check {
  readonly name: string;
  /** argv, run from `web/`; `{game_dir}` is substituted. */
  readonly cmd: readonly string[];
  readonly sees: string;
  readonly needs: Needs;
  /**
   * Checks that share a lane run one at a time, in table order; every check
   * with none runs in the pool beside them. See {@link LANE_BROWSER}.
   */
  readonly lane: string;
}

function check(name: string, cmd: readonly string[], sees: string,
               needs: Needs = NEEDS_NOTHING, lane = ""): Check {
  return { name, cmd, sees, needs, lane };
}

/**
 * A check against the installed game: `web/tools/checks/<name>.ts`, reading
 * the game through `web/src/hod2lib/`.
 */
export function game(name: string, sees: string): Check {
  return check(`game:${name}`,
               ["node", "tools/run_ts.mjs", `tools/checks/${name}.ts`, "--game-dir", "{game_dir}"],
               sees, NEEDS_GAME);
}

/**
 * Ordered cheapest-first, so a broken tree fails in seconds rather than
 * minutes. `tsc` comes before every suite that would fail confusingly without
 * it.
 */
export const CHECKS: readonly Check[] = [
  check("tsc", ["npx", "tsc", "--noEmit"],
        "that the whole tree -- `test/` and `tools/` included -- typechecks"),
  check("layers", ["node", "tools/run_ts.mjs", "tools/repo/layers.ts"],
        "the layer boundaries, and any ratchet's current count"),
  check("port", ["node", "tools/run_ts.mjs", "tools/repo/port.ts"],
        "that every exe citation in the port matches `functions.tsv`, under the"
      + " same name"),
  check("player_dom", ["node", "tools/run_ts.mjs", "tools/repo/player_dom.ts"],
        "that the stylesheet and the markup agree, in both directions"),
  check("exporters", ["node", "tools/run_ts.mjs", "tools/repo/exporters.ts"],
        "that no exporter swallows a failure and reports success"),
  check("test:port", ["npm", "run", "--silent", "test:port"],
        "the state machines, driven headless against hand-written tables"),
  check("test:audio", ["npm", "run", "--silent", "test:audio"],
        "`PlaySoundId`'s dispatch -- the loop flag, the three one-shot tracks, "
      + "the three control words -- and the byte stream channel 0xF plays, tail"
      + " and channel swap included, with no browser"),
  check("test:bundle", ["npm", "run", "--silent", "test:bundle"],
        "that the bundle reader refuses what it should refuse"),
  check("test:export", ["npm", "run", "--silent", "test:export"],
        "the pieces of the TypeScript exporter a game directory cannot check "
      + "-- bundle JSON that round-trips through `JSON.parse` and refuses a "
      + "NaN, the case-insensitive path resolve, and an archive something else "
      + "can open"),
  check("test:scope", ["npm", "run", "--silent", "test:scope"],
        "that lifetimes are given back"),
  check("test:projection", ["npm", "run", "--silent", "test:projection"],
        "that unchanged slices keep their identity across a frame"),
  check("test:ui", ["npm", "run", "--silent", "test:ui"],
        "that the page has the shape the stylesheet expects"),
  check("test:net-codec", ["npm", "run", "--silent", "test:net-codec"],
        "that netplay's state codec lands a replica on the host's state exactly"
      + " -- deep-equal and hash-equal on every tick it applies -- over fuzzed "
      + "trees with lost, reordered and late-acked packets; the only check of "
      + "the delta's window property and of pool identity"),
  check("test:matchmaker", ["npm", "run", "--silent", "test:matchmaker"],
        "that the netplay matchmaker keeps its protocol -- a room code, TURN "
      + "credentials, the host's offer and player 2's answer, each behind its "
      + "own token -- over real HTTP in the Node server and in-process in the "
      + "Cloudflare Worker, and reads Cloudflare's TURN credentials in both of "
      + "their shapes"),
  check("test:turn", ["npm", "run", "--silent", "test:turn"],
        "that the TURN relay the dev server runs keeps RFC 8656 over real UDP: "
      + "the credential challenge, the minted credentials accepted and bad ones"
      + " refused, permissions before any traffic, indications and channels "
      + "both ways -- the relay every WebRTC session on a machine without a "
      + "direct path goes through"),
  check("test:pose", ["npm", "run", "--silent", "test:pose"],
        "that a skeleton posed from a motion lands where the exporter says"),
  check("test:render", ["npm", "run", "--silent", "test:render"],
        "that the renderers rebuild from engine state alone"),
  check("test:texfilter", ["npm", "run", "--silent", "test:texfilter"],
        "that the texture filter modes match the D3D7 translation"),
  check("verify:ui", ["npm", "run", "--silent", "verify:ui"],
        "the two UI rules that need an AST rather than a regex"),
  check("test:seek", ["npm", "run", "--silent", "test:seek"],
        "that a seek reaches the address it was asked for",
        NEEDS_BUNDLE),
  check("test:state", ["npm", "run", "--silent", "test:state"],
        "that a save/load and a seek reach the *same world* play did -- the "
      + "only check that compares two histories rather than one",
        NEEDS_BUNDLE),
  check("test:camera", ["npm", "run", "--silent", "test:camera"],
        "that a camera path seats where the exe's own evaluation puts it",
        NEEDS_BUNDLE),
  check("test:net", ["npm", "run", "--silent", "test:net"],
        "that netplay's host and replica sessions keep a replica on the host's "
      + "state through a real stage on a lossy link -- every tick "
      + "hash-verified, a seek's epoch followed, player 2's START and shots "
      + "reaching player index 1 once each -- with no browser",
        NEEDS_BUNDLE),
  check("flag_gates", ["node", "tools/run_ts.mjs", "tools/flag_gates.ts"],
        "that every `wait_script_flag` gate no `set_script_flag` on the *route*"
      + " to it can open has the actor that opens it placed on that same route "
      + "-- the only check that reads a gate per entry block rather than per "
      + "bundle, which is the difference between stage 3's block 2 on the "
      + "entry-0 route and on the entry-7 one -- and the only check that asks "
      + "the same question of an ACTOR, for the one class-0x30 state whose sole"
      + " exit is a script flag a civilian's own stream raises",
        NEEDS_BUNDLE),
  check("net_pair", ["npm", "run", "--silent", "net-pair", "--", "--seconds", "8"],
        "that two-player netplay works in the page: a host and a replica in two"
      + " tabs of a Chrome as users have it, over real WebRTC through the dev "
      + "server's rendezvous -- directly, on a bad link, and through its TURN "
      + "relay alone -- every tick the replica applies hash-equal to the "
      + "host's, player 2 joining and scoring, its aim checked against the "
      + "host's camera, a pause and a stage change survived, and player 2 "
      + "leaving ending it -- the only check of the replica's install into G "
      + "and of the render layers following a state they did not make",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("loops", ["npm", "run", "--silent", "loops"],
        "that the looping sound effects reach an <audio> element, wrap rather "
      + "than running out, and are still there when the stage is reached by a "
      + "deep link -- the only check in the tree that measures the mixer rather"
      + " than the intent",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("test:r2site", ["npm", "run", "--silent", "test:r2site"],
        "the deployed site's Worker, against a bucket in a Map: the 304s, the "
      + "ranges and the stored-compressed bundle with its decoded length that "
      + "the page's service worker and loading bar rely on"),
  check("offline", ["npm", "run", "--silent", "offline-check"],
        "that the service worker never shows a stale copy while the server "
      + "answers -- a bundle file changed on disk is the new one on the next "
      + "reload -- and that with the server stopped a reload still loads the "
      + "stage from the device and draws it",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("bgm_loop", ["npm", "run", "--silent", "bgm-loop"],
        "that the page's music is the engine's stream -- the buffer the "
      + "script's own track reaches Web Audio as is one period of the file from"
      + " its first sample to end of file, looped, sample for sample -- and "
      + "that it is audible",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("keys", ["npm", "run", "--silent", "keys"],
        "that the page's keys do what the `?` list says when pressed -- test:ui"
      + " holds the list to the handlers' source, this reads back what a press "
      + "did -- and that a click on a control over the game hands Space and "
      + "Enter (START) back to the game rather than leaving them with the "
      + "button",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("continue", ["node", "tools/continue_page.mjs", "--headless"],
        "that the last life lost with credits left puts CONTINUE? and its digit"
      + " where the exe draws them, holds the script at its wait, and that "
      + "START -- pressed on the corner button, the one START a phone has -- "
      + "spends a credit and puts the player back in play",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("result_card", ["node", "tools/result_card.mjs", "--headless"],
        "that the end of stages 1, 2 and 4 plays in the real page from their "
      + "own result steps: one figure per rescue, of the rescued type, at the "
      + "scene's places; the scene's own list, dead, with none; the count "
      + "climbing from frame 31; the life bonus on frame 302, capped; figure 0 "
      + "holding the life up from camera frame 260 and freezing on cursor 0x81;"
      + " the score and the accuracy drawn; the flag on frame 420 and the scene"
      + " over after it",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("options", ["node", "tools/options_page.mjs", "--headless"],
        "that the menu's Options reaches the game's options screen in the real "
      + "page, that its title and red highlighted row are on the HUD canvas, "
      + "that the page's arrows and Enter drive the list -- lives and continues"
      + " changed, the hidden rows stepped over, a held arrow running the sound"
      + " test -- and that EXIT saves the profile in the browser and starts a "
      + "game with five lives, four credits and the chosen crosshair on the "
      + "reticle, and that a reload boots what was saved in place of the "
      + "free-play default",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("judgment_reload", ["node", "tools/judgment_reload_page.mjs", "--headless"],
        "that a reload at stage 5's `block=4&step=1&op=0` -- past JUDGMENT's "
      + "return -- lands with no boss in the pool and nothing counted, and that"
      + " block 4's room gate then counts exactly its own zombies and opens "
      + "when they die: the only check that reads the enemy counters in a page "
      + "a seek built, which is the rebuild every reload during development "
      + "goes through (L75)",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("setpiece_shot", ["node", "tools/setpiece_shot_page.mjs", "--headless"],
        "that a body lying on the floor -- stage 1's class-0x24 set-piece under"
      + " the library desk -- survives a driven sweep of live pulls that kills "
      + "the room's zombie around it: the only check that fires real pointer "
      + "events at an actor the engine never files for the shot test, which the"
      + " render pick used to offer and `ResolveHit` then killed",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("humanoid_shot", ["node", "tools/humanoid_shot_page.mjs", "--headless"],
        "that stage 2's jetty zombies -- class-0x25 scripted humanoids, the "
      + "four in the game whose spawn record leaves bit 0x8000 clear -- "
      + "survive live pulls aimed through the page's own camera at their "
      + "bodies while the gun is up: the one check that fires real pointer "
      + "events at the class, which the render pick used to find through a "
      + "wall and `ResolveHit` then killed for ninety points",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("crosshair", ["node", "tools/crosshair_page.mjs", "--headless"],
        "that real pointer events reach HudDrawCrosshair as the exe's devices "
      + "-- a mouse move is input mode 6 and the reticle is the Sight Graphic's"
      + " sprite out of the bundle, sized to the frame and centred on the "
      + "pointer; a touch is the light gun, 0xD, and the game draws no "
      + "crosshair until the mouse moves again; and a phone, with no fine "
      + "pointer, never shows one",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("drop_pitch", ["node", "tools/drop_pitch.mjs", "--headless"],
        "that on stage 2 block 5 step 6's stashed rail the camera's aim moves "
      + "only by `TurnLookAtToward` at the exe's rate, recomputed from its "
      + "definition, and climbs after the two leaping `zsass` -- the only "
      + "check of the enemy-tracking turn on a rail",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("determinism", ["node", "tools/determinism.mjs", "--stage", "1", "--headless"],
        "that the real page driven twice from one seed with frame-scheduled "
      + "input produces identical per-frame game-state traces for 6000 frames "
      + "-- the only check that compares two plays rather than a play against "
      + "a seek or a load",
        NEEDS_BUNDLE, LANE_BROWSER),
  check("bats", ["node", "tools/run_test.mjs", "tools/bats.mjs"],
        "that every shipped bat step, run with the player exactly as "
      + "`ResetGameGlobals` and the first frame leave it, flies its unshot "
      + "bats to the screen, takes a life per arrival outside the "
      + "invulnerability window and gives both counters back -- the only "
      + "check of the bat's strike path, whose gate the port tests set by hand",
        NEEDS_BUNDLE),
  check("animals", ["npm", "run", "--silent", "animals"],
        "that the frog, the owl and the fish are placed from a real bundle and "
      + "leave their opening state -- none of the three is a skinned enemy the "
      + "character layer can build, and two have no character type at all",
        NEEDS_BUNDLE),
  check("horde", ["npm", "run", "--silent", "horde"],
        "that each of the five class-0x40 hordes is built from a real bundle, "
      + "walks in, dives and bites, and that shooting every member gives both "
      + "counters back and lets the walker past the room's wait_enemies_alive "
      + "-- the members are runtime children with no descriptor, so only the "
      + "placer's own spawn can bring them into play",
        NEEDS_BUNDLE),
  check("dives", ["npm", "run", "--silent", "dives"],
        "that a class-0x43 dive reaches the camera it is aimed at, strikes and "
      + "comes round again -- the only check that drives a class against the "
      + "stage's own `cam_play` rather than an eye the harness made up, which "
      + "is what every other owl check does and why none of them could see a "
      + "run-in parked five units under the eye",
        NEEDS_BUNDLE),
  check("boss4_fight", ["npm", "run", "--silent", "boss4_fight"],
        "that the stage-4 boss's fight runs from its entrance to "
      + "`g_script_flags[32]` in both arenas, against the stage's own script "
      + "and camera paths -- the only check that plays a boss's phases, its "
      + "camera cues and the (2,6) rail they move, since the playthrough stops "
      + "on entering the end block the fight is in",
        NEEDS_BUNDLE),
  check("handback", ["npm", "run", "--silent", "handback"],
        "that a room waits for the camera to turn back onto its rail after the "
      + "last enemy dies and not merely for the counter -- the only check that "
      + "measures the *pacing* of a room-clear gate rather than whether it "
      + "opens at all, and the one that separates the two drivers a "
      + "`finish_sequence` can install",
        NEEDS_BUNDLE),
  check("civ_speech", ["npm", "run", "--silent", "civ_speech"],
        "that a rescued civilian holds a camera slot while her script asks, and"
      + " that the room-clear gate therefore waits for her lines and her "
      + "shutter -- the only check that plays a real civilian stream against "
      + "the stage's own gate, and the reason a non-enemy can be a camera "
      + "candidate at all",
        NEEDS_BUNDLE),
  check("civilians", ["npm", "run", "--silent", "civilians"],
        "that every class-0x10 civilian in the six stages runs her shipped "
      + "stream beside her real captors -- none runs away, every captor the "
      + "bundle names is placed, the captors (class 0x30 and the carrier's "
      + "class 0x18) work on her rather than on the camera, and shooting them "
      + "pays the rescue to the player who shot -- the only check over the "
      + "whole corpus of streams rather than one room's, so the one whose "
      + "rescue and maul counts move when a captor class, the motion clock or "
      + "the prune changes under it",
        NEEDS_BUNDLE),
  check("civ_gives", ["npm", "run", "--silent", "civ_gives"],
        "that every civilian whose shipped stream puts an item in her hand "
      + "hands it over -- the life to the player in play with its marker, an "
      + "Original Mode item into `g_original_items_taken` with its banner -- "
      + "and stops holding it, playing each from the evt step that spawns her "
      + "with the stage's own camera; the only check that reaches a give, which"
      + " `civilians` cannot with its camera parked five thousand units away",
        NEEDS_BUNDLE),
  check("props43", ["npm", "run", "--silent", "props43"],
        "where in a real script a class-0x41 prop is actually placed, and that "
      + "it takes a frame of `GameUpdate` to appear -- the only check that "
      + "separates `spawn_placed` putting a *placer* in the pool from the "
      + "constructor that builds the prop, which is the difference between a "
      + "room the player has not cleared and a placement the player dropped. It"
      + " is also the only harness that reports the address the walker reached "
      + "rather than the one it asked for",
        NEEDS_BUNDLE),
  check("bundle:prop_slots", ["node", "tools/run_ts.mjs", "tools/checks/prop_slots.ts"],
        "that every asset slot a placed class-0x41 or class-0x44 prop will pass"
      + " to `AssetDrawSlot` has a model in its own bundle -- the check that "
      + "would have caught stage 3's roller shutter and the stage 5 van's body,"
      + " both of which were placed, updated and invisible because nothing "
      + "carried their geometry, which from the level looks exactly like a "
      + "placement that was never exported",
        NEEDS_BUNDLE),
  check("bundle:death_clips", ["node", "tools/run_ts.mjs", "tools/checks/death_clips.ts"],
        "that every clip `ChooseDeathMotion` can put on a dying class-0x30 "
      + "actor is baked for that spawn's own character type -- the only check "
      + "that reads a death clip out of a real bundle, and the one that says "
      + "whether an actor can leave state 12 at all, since that state's exit is"
      + " an exact `obj+0x19C >= 0x3C` against a play clock that is 0 for a "
      + "clip nothing carried",
        NEEDS_BUNDLE),
  check("bundle:cam_waits", ["node", "tools/run_ts.mjs", "tools/checks/cam_waits.ts"],
        "that every `wait_camera_path_frame <n>` asks for a frame the play in "
      + "force actually publishes -- the only check that holds the three "
      + "routines that publish a camera frame against the scripts that wait on "
      + "them, and the one that says the strict `frame > operand` of "
      + "`EvtOpWaitCameraPathFrame41` is safe to transcribe. Model scene state "
      + "7 as stopping on its range's end rather than one past it and twenty of"
      + " the sites it checks become gates nothing can open",
        NEEDS_BUNDLE),
  game("annotations",
       "that every row of `ghidra/annotations/*.tsv` is an address in a real "
     + "section of the EXE -- functions in `.text` -- with no address or name "
     + "listed twice and none in both files"),
  check("ghidra_db", ["node", "tools/run_ts.mjs", "tools/repo/ghidra_db.ts", "--game-dir", "{game_dir}"],
        "that the Ghidra database every session decompiles from says what "
      + "`ghidra/annotations/` says -- every prototype and no-return flag "
      + "in `prototypes.tsv` applied, no flag it does not declare, and no "
      + "database name one the file has renamed away from, which the next "
      + "`export-annotations` would put back (L90) -- and that no `CALL` "
      + "to a function that returns carries the `CALL_RETURN` override "
      + "that prints as a clean `return;`: the only check that reads the "
      + "database rather than the exe, and so the only thing that can say "
      + "the pseudocode is not missing code (L89). Names and comments still "
      + "on their way in either direction are counted, not failed. "
      + "Asserts nothing without Ghidra or a project",
        NEEDS_GAME),
  game("prop_pose",
       "that every class-0x41 generic prop is posed in the order its own "
     + "update routine poses it -- read out of the EXE per type and matched to"
     + " the field each `MatrixRotate*` is handed -- that both copies of the "
     + "generic slot tables are what the routines and the shipped `+0x11C` "
     + "words say, and that `render/breakables.ts` composes a pose in one "
     + "place, from the table"),
  game("prop_tables",
       "that the tables class 0x41 types 38, 39, 40, 44, 50 and 66 build their"
     + " objects from -- positions, angles, hull corners, slots, counts, "
     + "scales -- and class 0x28's route, length and pose tables are the EXE's"
     + " own words, compared as 32-bit patterns against the values the port "
     + "evaluates; a mistyped row puts a church chair where the engine does "
     + "not, with nothing else to notice"),
  game("flag_strips",
       "that `class12Tail`, the exporter's read of class 0x12's descriptor "
     + "tail, takes each field at the offset and width `ScriptedPropInit12` "
     + "loads it, decoded out of the EXE; that every class-0x12 spawn on the "
     + "disc is placed with exactly those fields; and, with a bundle, that "
     + "every slot its strip can draw is in it"),
  game("rise_to_height",
       "that class 0x44 selector 13 -- stage 5's gate behind JUDGMENT and "
     + "twelve objects in stage 6 -- is `g_class44_subtypes[13]`, that the "
     + "exporter reads its tail at the offsets and widths "
     + "`PropBuildRiseToHeight` loads it and the port's three constants "
     + "are the update's own, that no shipped spawn carries the collision "
     + "blob the port's prop pool cannot shoot, and, with a bundle, that "
     + "every spawn is placed with exactly that tail and its model travels"),
  game("flag_props",
       "that class 0x44 selectors 9 and 12 -- the stage-3 model that rises "
     + "on a flag and the eight stage-6 leaves that slide on one -- and class "
     + "0x41 constructor 47, stage 2's flat disc, are the table entries the port builds, that the exporter reads their "
     + "tails at the offsets and widths the constructors load them and the "
     + "port's constants are the routines' own, that no selector-12 spawn "
     + "names the one slot whose second draw relights the scene, and, with a "
     + "bundle, that every spawn is placed with exactly its tail and its "
     + "model travels -- the stage no longer draws a loaded model on its own, "
     + "so a misread here is an object that is simply missing"),
  game("branches",
       "that every value a branch trigger can write into `g_script_branch_var`"
     + " names a route slot its own block actually fills -- the one check that"
     + " ties the gameplay half of branching to the route tables"),
  game("scene_exits",
       "that a terminal route record's `next[0]` is a live block of the *next*"
     + " scene, and that a hole follows every one of them -- the only check "
     + "that reads the handover from one stage to the next, and so the only "
     + "thing that can say stage 3 and stage 4 have two entry points each"),
  game("looping_se",
       "that `PlaySoundId`'s two loop tables pair index for index -- every "
     + "entry is `X.wav` against `X_OFF.wav` and no `_OFF` file ships, which "
     + "is what says a stop id is a control word rather than a sound -- and "
     + "that class 0x30's play and stop ids are the operands of the EXE's own "
     + "PUSHes"),
  game("bgm_stream",
       "that the music has no loop points to find -- the EXE's own bytes "
     + "stream channel 0xF and seek it back to the first sample at end of "
     + "file, the port's one-shot ids and ring length are the EXE's, and every"
     + " looping track opens under the port's header walk and is long enough "
     + "for its stream model to be exact"),
  game("root_pose",
       "that a clip's root translation either moves the object or offsets the "
     + "pose -- the two arms of one `model+0x64` bit, quoted as bytes -- which"
     + " actors the posing arm can move, measured over every motion block and "
     + "paired with the class-0x10 wait word that governs it, and that "
     + "`ActorModelScale` is `ActorBuildSkinnedModel`'s per-type switch, "
     + "decoded from its jump table"),
  game("combat",
       "that the exporter's shot and damage readings hold together across "
     + "every character type and match the EXE's bytes -- and the only place "
     + "the *exact* set of attacks the engine can never land is asserted, "
     + "which stops the crawlers' condition-4 swing being filtered out as an "
     + "impossible row (L65, L71, L73)"),
  game("split_unreachable",
       "that nothing the shipped game runs reaches `ZombieSplitInTwo` "
     + "(`FUN_0045D9F0`) -- no store of 4 to `g_hit_result`, one writer "
     + "of the split bit and no way into its state, each beside a control "
     + "that must be found -- which is the whole of the case for the port "
     + "not transcribing the split, and the only check that can say when "
     + "that case stops holding"),
  game("horde",
       "that every number the class-0x40 horde is steered by -- its entry "
     + "splines, spline rates, shot delays, wander grid, second skin and the "
     + "emerge prop's corners -- is the EXE's, and that the seven descriptors "
     + "split five hordes to two props on the byte PlaceHorde switches on"),
  game("worm",
       "that every scalar the class-0x42 worm's port names is the `.rdata` "
     + "word or the instruction operand the EXE loads, that its member "
     + "routine's jump table has the seven arms the port's switch has, that "
     + "its sounds and `buyo.bin` slots are the ones the port names, that "
     + "the game's three class-0x42 descriptors are sub-types 1, 0 and 2, "
     + "and, with a bundle, that the shadow the port draws without the "
     + "scene light array is a black no light can change"),
  game("continue_screen",
       "that the continue screen the port draws -- the run's CONTINUE? and "
     + "digit, the two-player small ones, the small GAME OVER and the credit "
     + "line -- is at the EXE's positions, scales and sprite ids, read as "
     + "instruction bytes and `.rdata` rows; that only one credit-line drawer "
     + "can run; and that all eight wait opcodes read the gameplay gate that "
     + "holds the script while nobody is in play"),
  game("options",
       "that the profile reading is right on the user's own save -- the four "
     + "disguised files deciphered with the key taken out of `ProfileCipher`'s"
     + " instructions, and the block's byte sum and version checked -- that "
     + "Blood Color is dead in this build, and that the options screen's "
     + "factory tables, sprite ids, positions and glyph table are the EXE's, "
     + "with the bundle's `options` block when there is one"),
  game("result_card",
       "that every constant the result card's port transcribes is the "
     + "immediate at its instruction; that the `.rdata` span the card reads "
     + "with no bound is the EXE's bytes; that every rescuable civilian's type"
     + " has an attachment list the unbounded lookup can find; and, with a "
     + "bundle, that each stage placing the card carries a figure template and"
     + " every clip for every type it can show"),
  game("water",
       "that class 0x41 type 1, the canal water task, starts from the table "
     + "the EXE indexes -- ten flat water tiles -- and that every slot, flag, "
     + "camera cue and multiplier the port's copy of it tests is the immediate"
     + " at the instruction that holds it; its spawns sit at the origin, so a "
     + "wrong reading draws nothing and looks like nothing"),
  game("draw_order",
       "that the player's two passes and translucent order are the EXE's: the "
     + "blend and depth tables `render/draw_order.ts` copies, the alpha-test "
     + "and blend-enable pushes, and the VIEW matrix and comparator bytes that"
     + " make the sort nearest-first -- plus that no mesh in `pol/` turns its "
     + "depth write off, which is why translucent meshes occlude"),
  game("texture_alpha",
       "that a texture's alpha reaches the bundle as the bank stores it, "
     + "because the EXE's D3D path keeps it: the upload's format table and the"
     + " A1R5G5B5 test, stage 0's alpha args, and TSP bit 19 read only as half"
     + " of the pass selector -- plus the corpus premise that makes a glTF "
     + "alphaMode from the pass right and, on a current bundle, no `_opaque` "
     + "image and the IgnoreTexAlpha images byte-equal to the bank's alpha"),
  game("bats",
       "that the class-0x46 bat's flight paths line up with the descriptors "
     + "that select them, and that the port's spline table, motion pair and "
     + "swarm counts are the EXE's bytes -- the only check on a class whose "
     + "spawns are all at the world origin and take their whole position from "
     + "an EXE table"),
  game("bone_cels",
       "that every cel run `ZombieDrawBonePart` (`FUN_004534A0`) draws is the "
     + "arithmetic in the EXE and is in the bundle -- no table in the image "
     + "names those models, so this is the only thing standing between a "
     + "hand-written run and a character losing a part"),
  game("corpus",
       "that every corpus-wide decode figure the format docs give -- the "
     + "lz and container census, the NL1 parser totals, the asset-slot "
     + "counts, texbank exactness, cam coverage and slot binding, evt "
     + "decode, mot strides, the coli census and evt-to-coli pointers -- "
     + "still holds exactly, read through `hod2lib`"),
  game("mesh_walk",
       "that the exe's three-rule mesh walk lands on every declared mesh end "
     + "over all 9,112 models, with the corpus totals `nl1.md` quotes"),
  game("evt_cam",
       "that the exe's queued-action table has exactly the ten "
     + "`QUEUE_ACTIONS` selectors, the scene-state table's live cells are the "
     + "doc's, every camera play names its own stage's `cp_` path, every "
     + "`0x11`/`0x21` transition lands on a live cell, and every deferred play "
     + "is followed by state 6 or 7"),
  game("objects",
       "that every stage's spawn classes are in the class table at "
     + "`0x00593358` and every spawn is inside its stage's geometry box, that "
     + "the literal route slots are `PUSH slot; CALL CamEvalObjectPath6` into "
     + "the tabulated `op_` path, and that every rig's gates, routes and "
     + "swept-route keys are consistent"),
  game("geometry",
       "that each bundle stage's scenery parts hold exactly the triangles "
     + "`pol/` declares, part by part, and that `script.json`'s `coli` block "
     + "is the parsed collision files blob for blob -- the only check that "
     + "compares an export against the files it was made from"),
  game("parts",
       "that the bundle's vertex-blended part tables are the exe's, and every "
     + "skinned instance has one weight per vertex, proxy joints, no inverse "
     + "binds, and the exe's positions on the exe's bones"),
  game("effects",
       "that all 29 effect trees walk to exactly their `g_effect_bone_counts` "
     + "entry, each bone index once, the root drawing nothing, every kinded "
     + "prop's effect one `komono_*.bin`, and every (effect, motion) pair "
     + "divides exactly by the truncating stride"),
  game("skeletons",
       "that every character skeleton walks to exactly bones 1..count-1 of "
     + "`DAT_004E0724`, and the stage-3 heads whole -- chain, weak bone, jaws, "
     + "slots, offsets, depth 17 and 24"),
  game("attachments",
       "that the attachment records and their split are the exe's "
     + "`CMP AX,0x24` bytes, every spawn's list over every evt, `op 9` and "
     + "`op 16`'s table bytes, and, with a bundle, every face, accessory, "
     + "throwing hand and gore slot a list can name having a model to clone"),
  game("walk_distance",
       "that every walk-in spawn's descriptor tail `+0x04` is an exact integer "
     + "distance in the range the docs state"),
  game("thrower_walls",
       "per stage, how many class-0x31 spawns the port's own wall and ceiling "
     + "probes can climb from, against the stage's `coli/`"),
  game("script_corpus",
       "the civilian streams (count, lengths, overlap, coverage, poses, the "
     + "wait-word bits), the captor scripts and their kill cues on the play "
     + "clock, class 0x25's control flow, class 0x20's clips, and, with a "
     + "bundle, every reachable scripted clip baked with frames"),
  check("baseline", ["node", "tools/run_ts.mjs", "tools/baseline.ts", "--game-dir", "{game_dir}", "--verify"],
        "that the installed assets still hash to `manifest.csv`",
        NEEDS_GAME),
];

export type Outcome = "pass" | "fail" | "skip";

/** A line boundary: every one Unicode names. */
const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]");

/** `cmd`'s executable: itself when it names a path, else the first on `PATH`; or `null`. */
function which(cmd: string): string | null {
  const executable = (p: string): boolean => {
    try {
      accessSync(p, constants.X_OK);
      return statSync(p).isFile();
    } catch {
      return false;       // not-a-loss: not there, or not executable, is the answer
    }
  };
  if (cmd.includes("/")) return executable(cmd) ? cmd : null;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir || ".", cmd);
    if (executable(p)) return p;
  }
  return null;
}

/** Returns `[outcome, output, seconds]`. Exit 3 means it asserted nothing. */
export async function runOne(c: Check, gameDir: string | null, timeout: number,
                             quick = false): Promise<[Outcome, string, number]> {
  if (quick && c.lane === LANE_BROWSER) return ["skip", "--quick leaves the browser lane out", 0];
  if (quick && c.needs === NEEDS_GAME) {
    return ["skip", "--quick leaves the checks against the game out", 0];
  }
  if (c.needs === NEEDS_GAME && !gameDir) return ["skip", "no --game-dir given", 0];
  const cmd = c.cmd.map((a) => a.replaceAll("{game_dir}", gameDir ?? ""));
  if (which(cmd[0]!) === null) return ["skip", `${cmd[0]} not on PATH`, 0];
  const t0 = performance.now();
  const seconds = (): number => (performance.now() - t0) / 1000;
  return new Promise((done) => {
    const p = spawn(cmd[0]!, cmd.slice(1), { cwd: WEB, stdio: ["inherit", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    p.stdout.on("data", (b: Buffer) => stdout.push(b));
    p.stderr.on("data", (b: Buffer) => stderr.push(b));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeout * 1000);
    p.on("error", (err) => {
      clearTimeout(timer);
      done(["fail", String(err), seconds()]);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        done(["fail", `timed out after ${timeout}s`, seconds()]);
        return;
      }
      const out = (Buffer.concat(stdout).toString("utf8") + Buffer.concat(stderr).toString("utf8"))
        .replace(/\r\n?/g, "\n");
      if (code === 0) done(["pass", out, seconds()]);
      else if (code === 3) done(["skip", out.trim() || "asserted nothing (exit 3)", seconds()]);
      else done(["fail", out, seconds()]);
    });
  });
}

/**
 * Run `checks`, the pool in parallel and each lane in order beside it.
 *
 * Every check is its own process with its own temporary files and its own
 * port, so the only ones that cannot share the machine are the ones that
 * share a browser, and those keep their lane.
 *
 * A line is printed as each check finishes, so the order on screen is the
 * order they finished in; the summary and every failure's output below it
 * stay in table order. `jobs` of 1 runs everything in table order.
 */
export async function runAll(checks: readonly Check[], gameDir: string | null, timeout: number,
                             jobs: number, quick = false):
    Promise<[Check, Outcome, string, number][]> {
  const w = Math.max(...checks.map((c) => c.name.length));
  const done = new Map<string, [Outcome, string, number]>();

  const one = async (c: Check): Promise<void> => {
    const r = await runOne(c, gameDir, timeout, quick);
    done.set(c.name, r);
    console.log(`  ${c.name.padEnd(w)}  ... ${r[0].toUpperCase().padEnd(4)} `
                + `${r[2].toFixed(1).padStart(5)}s`);
  };
  const lane = async (members: readonly Check[]): Promise<void> => {
    for (const c of members) await one(c);
  };

  if (jobs <= 1) {
    await lane(checks);
  } else {
    const lanes = new Map<string, Check[]>();
    const pool: Check[] = [];
    for (const c of checks) {
      if (c.lane) lanes.set(c.lane, [...(lanes.get(c.lane) ?? []), c]);
      else pool.push(c);
    }
    // The lanes first: they are the long pole, and a slot taken by a lane is
    // not a slot a pool check waits for.
    const tasks: (() => Promise<void>)[] = [
      ...[...lanes.values()].map((m) => () => lane(m)),
      ...pool.map((c) => () => one(c)),
    ];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tasks.length) await tasks[next++]!();
    };
    await Promise.all(Array.from({ length: Math.min(jobs + lanes.size, tasks.length) }, worker));
  }
  return checks.map((c) => [c, ...done.get(c.name)!]);
}

interface Args {
  gameDir: string | null;
  list: boolean;
  only: string[];
  strict: boolean;
  timeout: number;
  quick: boolean;
  jobs: number;
}

const USAGE = "usage: verify_all.ts [-h] [--game-dir GAME_DIR] [--list] [--only ONLY] [--strict]\n"
  + "                     [--timeout TIMEOUT] [--quick] [--jobs JOBS]";

const HELP = `${USAGE}

Run every check this repo has, and say which ones actually ran.

options:
  -h, --help            show this help message and exit
  --game-dir GAME_DIR   the installed game, for the checks that compare against it
  --list                print the table and run nothing
  --only ONLY           run only these checks, by name (repeatable)
  --strict              exit 2 if any check was skipped
  --timeout TIMEOUT     seconds a check may take before it fails (default: 900)
  --quick               the inner loop: leave out the browser lane and the checks
                        against the installed game, and say so -- they are
                        skipped, never passed
  --jobs, -j JOBS       checks run at once outside the browser lane (default: one
                        per core; 1 runs them in table order)`;

function usageError(msg: string): never {
  console.error(`${USAGE}\nverify_all.ts: error: ${msg}`);
  process.exit(2);
}

/** The command line: `--flag v`, `--flag=v`, `-j4`, and any unique prefix of a flag. */
function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    gameDir: null, list: false, only: [], strict: false, timeout: 900, quick: false,
    jobs: availableParallelism(),
  };
  const valued = ["--game-dir", "--only", "--timeout", "--jobs"];
  const flags = ["--list", "--strict", "--quick", "--help"];
  const int = (flag: string, v: string): number => {
    if (!/^\s*[+-]?\d+\s*$/.test(v)) usageError(`argument ${flag}: invalid int value: '${v}'`);
    return Number.parseInt(v, 10);
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!;
    let inline: string | null = null;
    if (/^-j./.test(arg)) {
      inline = arg.slice(2).replace(/^=/, "");
      arg = "--jobs";
    } else if (arg === "-j") {
      arg = "--jobs";
    } else if (arg === "-h") {
      arg = "--help";
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        inline = arg.slice(eq + 1);
        arg = arg.slice(0, eq);
      }
      if (![...valued, ...flags].includes(arg)) {
        const hits = [...valued, ...flags].filter((o) => o.startsWith(arg));
        if (hits.length === 1) arg = hits[0]!;
        else if (hits.length > 1) {
          usageError(`ambiguous option: ${arg} could match ${hits.join(", ")}`);
        }
      }
    }
    if (valued.includes(arg)) {
      const v = inline ?? argv[++i];
      if (v === undefined) usageError(`argument ${arg}: expected one argument`);
      if (arg === "--game-dir") a.gameDir = v;
      else if (arg === "--only") a.only.push(v);
      else if (arg === "--timeout") a.timeout = int(arg, v);
      else a.jobs = int("--jobs/-j", v);
    } else if (inline !== null) {
      usageError(`argument ${arg}: ignored explicit argument '${inline}'`);
    } else if (arg === "--list") a.list = true;
    else if (arg === "--strict") a.strict = true;
    else if (arg === "--quick") a.quick = true;
    else if (arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else usageError(`unrecognized arguments: ${argv[i]}`);
  }
  return a;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.list) {
    const w = Math.max(...CHECKS.map((c) => c.name.length));
    for (const c of CHECKS) {
      const need = c.needs ? `  [needs ${c.needs}]` : "";
      console.log(`  ${c.name.padEnd(w)}  ${c.sees}${need}`);
    }
    return 0;
  }

  const checks = CHECKS.filter((c) => !args.only.length || args.only.includes(c.name));
  const known = new Set(CHECKS.map((c) => c.name));
  const unknown = [...new Set(args.only)].filter((n) => !known.has(n)).sort();
  if (unknown.length) {
    console.error(`no such check: ${unknown.join(", ")}`);
    return 1;
  }

  const t0 = performance.now();
  const results = await runAll(checks, args.gameDir, args.timeout, args.jobs, args.quick);
  const wall = (performance.now() - t0) / 1000;

  const failed = results.filter(([, r]) => r === "fail");
  const skipped = results.filter(([, r]) => r === "skip");
  const passed = results.filter(([, r]) => r === "pass").length;

  for (const [c, , out] of failed) {
    console.log(`\n--- ${c.name} FAILED ${"-".repeat(Math.max(0, 56 - c.name.length))}`);
    console.log([...out.trimEnd()].slice(-4000).join(""));
  }

  console.log();
  if (skipped.length) {
    console.log(`skipped ${skipped.length}, and a skip asserted nothing:`);
    for (const [c, , why] of skipped) console.log(`  ${c.name}: ${why ? why.split(LINE_BREAK)[0] : ""}`);
    // A check `--quick` left out needs nothing it lacked.
    const kinds = new Set(skipped.filter(([, , why]) => !why.startsWith("--quick"))
      .map(([c]) => c.needs));
    if (kinds.has(NEEDS_BUNDLE)) {
      console.log("  build a bundle with `cd web && npm run export`, or point "
                  + "HOTD2_BUNDLE at one.");
    }
    if (kinds.has(NEEDS_GAME)) {
      console.log("  pass --game-dir for the checks that compare against the "
                  + "installed game.");
    }
  }
  const cpu = results.reduce((s, [, , , dt]) => s + dt, 0);
  console.log(`${passed} passed, ${failed.length} failed, ${skipped.length} skipped `
              + `in ${wall.toFixed(0)}s (${cpu.toFixed(0)}s of checks)`);

  if (failed.length) return 1;
  if (skipped.length && args.strict) return 2;
  return 0;
}

if (/(?:^|[\\/])verify_all\.ts$/.test(process.argv[1] ?? "")) {
  process.exitCode = await main(process.argv.slice(2));
}
