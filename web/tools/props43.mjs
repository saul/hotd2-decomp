/**
 * Where does stage 3 place its class-0x41 type-43 props, and can they be shot?
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/props43.mjs \
 *          [stage] [block] [step] [op] [seconds]
 *
 * Drives the real `Walker` over the real bundle with `script.breakables`
 * wired, which is what `app/main.ts` does — and what `tools/lifetime.mjs`
 * does **not**: that harness passes `undefined` for the breakables table, so
 * no prop of any family can appear in it and its silence about them says
 * nothing.
 *
 * The shot is applied the way `ProcessPlayerShots` applies one — the two hit
 * bits on `obj+0x34`, and the pool's own frame resolves them — because that is
 * the seam the routine reads. Nothing here calls into `PropUpdateType43`.
 *
 * ## What this file got wrong, and why the check below is shaped like this
 *
 * It was written to answer a report that the browser said
 * `breakables: none placed` for stage 3, and it answered the wrong question
 * twice over. **The browser was right.**
 *
 * * Its seek was `seekTo(walker, { block, step }, rng)` against a positional
 *   `seekTo(w, block, step, opIndex, maxOps, entryBlock)`. `arrived()`
 *   compares `w.block === block`, an object equals nothing, `maxOps` fell back
 *   to 500,000 — so the "seek" replayed the **whole of stage 3** to its end at
 *   block 11, and the line it printed, `seeked to block 0 step 3`, was its own
 *   `argv` rather than anywhere the walker had been. `seekTo` refuses a
 *   non-integer target now, so that exact mistake throws.
 * * Even seeked correctly, a walker-only harness cannot see the gate the props
 *   sit behind. Block 0 step 3 places them with `spawn_placed` at **op 10**,
 *   after `wait_enemies_alive <= 0` at op 8 — the two class-0x30 zombies
 *   spawned at op 2 have to die first. But `spawn_obj` only pushes
 *   descriptors: `SpawnScriptedCharacters` is called from
 *   `app/systems.ts`'s `syncCharacterSpawns`, i.e. by the character layer, so
 *   with no renderer no enemy ever enters the pool, `g_enemies_alive` stays 0
 *   and that gate opens on the first frame. The walker then runs straight past
 *   the fight and into the props, which is how "2 props at block 0 step 3"
 *   came out of a harness measuring a room the player had not cleared.
 *
 * `L44` is the general form of both halves.
 *
 * So the check is in two halves, and the first one is the one that failed:
 *
 *  1. **Before the placer** — a seek to op 0 of that step arrives with an
 *     empty `g_breakable_props`, and the step's own op list says why: every
 *     `spawn_placed` in it is behind its `wait_enemies_alive`. That is the
 *     browser's `none placed`, and it is the script's doing.
 *  2. **After the placer** — a seek to op 12, past both of the step's
 *     `spawn_placed` instructions, arrives with all three of its class-0x41
 *     placers in the pool; one frame of `GameUpdate` turns them into the three
 *     props, and the two type-43 ones break when shot.
 *
 * Half 1 asserts only what is true on the frame the seek lands, never after a
 * tick: once this harness starts ticking, the open enemy gate above makes
 * every later frame a frame of a script the game does not run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT, hasStage, skipNoBundle } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { GameUpdate } from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { vec3 } from "../src/game/vec.ts";
import { BreakableFlag, PropFamily } from "../src/game/class41/prop_state.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const [stage = "3", block = "0", step = "3", op = "12", seconds = "4"] = args;
// **A missing export is a skip, not a failure** -- `L14`, and `skipNoBundle`
// exits 3 so that `verify_all` counts it apart from a pass. Nothing above this
// line asserts anything, so there is no failure to lose by leaving early.
if (!hasStage(Number(stage))) skipNoBundle(`props43 (stage ${stage})`);
const script = JSON.parse(readFileSync(
  join(BUNDLE_ROOT, `stage${stage}`, `stage${stage}.script.json`), "utf8"));

const NOOP = () => undefined;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** A stage's tables in `G`, and a walker over its script. Fresh each time. */
function reset() {
  ResetGameGlobals();
  SetGameTables(script.characters, script.breakables, script.set_pieces,
                script.humanoids, script.coli, script.civilians);
  G.g_players_in_play = 1;
  G.g_player_lives = [2, 2];
  // The browser sets this from the bundle, and class 0x41 branches on it:
  // `PlaceGenericProp`'s types 70-72 and 77 despawn on their first frame
  // unless the mode is Original. Leaving it at the default made this harness
  // a different configuration from the page it was being compared with.
  G.g_GameMode = script.game_mode;
  return new Walker(script, {
    enterRegion: NOOP, loadSlot: NOOP, unloadSlot: NOOP,
    startCamera: NOOP, onFeed: NOOP, onBranch: NOOP,
    playSound: NOOP, aliveEnemies: () => G.g_enemies_alive,
    presentEnemies: () => G.g_enemies_present, aliveCivilians: () => null,
    scriptFlagRaised: () => null,
    cameraFree: () => null, setShutter: NOOP, showMessage: NOOP,
    endDialogue: NOOP,
  });
}

/**
 * Seek, and say where the walker actually is.
 *
 * The address comes off the walker rather than out of `argv`, which is the
 * whole of the bug this file was: a harness that prints what it asked for
 * cannot report that it did not get it.
 */
function seek(b, s, o) {
  const w = reset();
  const arrived = seekTo(w, b, s, o, 500000,
                         script.entries?.[0] ?? script.entry_block);
  const at = `${w.block}/${w.step}/${w.opIndex}`;
  check(`seek to ${b}/${s}/${o} arrives`, arrived && at === `${b}/${s}/${o}`,
        `walker is at ${at}${w.finished ? ", script finished" : ""}`);
  return { w, arrived, at };
}

const type43 = () => G.g_breakable_props
  .filter((p) => p.family === PropFamily.Type43);
const describe = (ps) => ps
  .map((p) => `${p.at.toString(16)} kind ${p.kind}`).join(", ") || "none";

const B = Number(block), S = Number(step), O = Number(op);

// -- half 1: the props are behind the room, and the bundle says so ----------

console.log(`\nstage ${stage} block ${B} step ${S}, before the placer:\n`);

const stepOps = script.blocks.find((x) => x.index === B)?.steps?.[S]?.ops ?? [];
const gate = stepOps.findIndex((x) => x.name === "wait_enemies_alive");
const placers = stepOps
  .filter((x) => x.name === "spawn_placed")
  .map((x) => x.i);
check("the step has an enemy gate and a placer after it",
      gate >= 0 && placers.length > 0 && placers.every((i) => i > gate),
      `wait_enemies_alive at op ${gate}, spawn_placed at op `
      + `${placers.join(",") || "(none)"}`);

seek(B, S, 0);
check("...so a seek to op 0 of that step has placed nothing",
      G.g_breakable_props.length === 0,
      `${G.g_breakable_props.length} props, `
      + `${type43().length} of them type 43`);
console.log("  note  a walker-only harness runs past `wait_enemies_alive`:"
  + " `SpawnScriptedCharacters` is the character layer's call, so"
  + " `g_enemies_alive` never leaves 0 here. Nothing below ticks from op 0.");

// -- half 2: past the placer, the props are real and they break -------------

console.log(`\nstage ${stage} block ${B} step ${S} op ${O}, `
  + `after the placer:\n`);

const { w } = seek(B, S, O);
const rng = new Rng(7);
const events = new Events();
const eye = vec3(0, 0, 0);

// **The seek places the placers, not the props.** `spawn_placed` runs
// `SpawnPropContainers`, which puts a class-0x41 *placer* in the object pool;
// `PropContainerPlacerUpdate` is what calls the constructor and then
// `ActorKill`s itself, and that is a class handler, so it needs a frame of
// `GameUpdate`. A paused player therefore sits on a seek that has arrived with
// every placer in the pool and `g_breakable_props` still empty — which is the
// other half of why `breakables: none placed` was read as a dropped
// placement. One frame is the whole of the difference.
const waiting = G.g_object_list.filter((o) => !o.despawned && !o.dead
  && (o.cls === SpawnClass.PropContainerPlacer
      || o.cls === SpawnClass.PropPlacer)).length;
check("the seek leaves the step's placers in the pool, not its props",
      waiting === 3 && G.g_breakable_props.length === 0,
      `${waiting} placers waiting, ${G.g_breakable_props.length} props built`);

GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
const placed = G.g_breakable_props.length;
check("...and one frame of `GameUpdate` builds all three",
      placed === 3, `${placed} of 3`);

const seen = new Map();
const record = () => { for (const p of type43()) seen.set(p.at, p); };
record();
for (let i = 0; i < Number(seconds) * 60; i += 1) {
  w.tick(1 / 60);
  GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
  record();
}

console.log(`  ${seen.size} type-43 seen over ${seconds}s: `
  + `${describe([...seen.values()])}`);
check("...two of them are type 43", seen.size === 2, `${seen.size}`);

const live = type43();
if (live.length) {
  const p = live[0];
  const slot0 = p.slot;
  const score0 = G.g_player_score[0];
  let shots = 0;
  for (let i = 0; i < 8 && !p.dead && p.effectFrames === 0; i += 1) {
    p.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
    w.tick(1 / 60);
    GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
    shots += 1;
  }
  console.log(`  kind ${p.kind}: ${shots} shot(s), slot `
    + `${slot0.toString(16)} -> ${p.slot.toString(16)}, `
    + `+${G.g_player_score[0] - score0} points`);
  check("a type-43 prop in the real bundle breaks when it is shot",
        p.effectFrames > 0, `effectFrames ${p.effectFrames}`);
  check("...and paid for the shot that destroyed it",
        G.g_player_score[0] > score0, `+${G.g_player_score[0] - score0}`);
  check("...one shot for a kind 2 and two for a kind 3",
        p.kind === 3 ? shots === 2 : shots === 1,
        `${shots} for kind ${p.kind}`);
} else {
  check("a type-43 prop is alive to shoot", false);
}

console.log(failures ? `\n${failures} failed` : "\nclean");
process.exit(failures ? 1 : 0);
