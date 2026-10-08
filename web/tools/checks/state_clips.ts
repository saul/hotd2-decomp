/**
 * Every clip a class-0x30 state names as an immediate is baked for each
 * spawn that can be in that state.
 *
 * A state's script names some of its clips, and the exporter bakes those off
 * the script. The rest are `PUSH` immediates in the state's routine, which no
 * script carries, so each one is baked only because a list in the exporter
 * says so. When the list is missing, nothing complains: `ActorSetMotionBlended`
 * finds no clip, the clip the actor already had stays on, and the actor plays
 * the state in the wrong pose. Stage 4's `0x35B4` did exactly that in state 43
 * -- `ZombieStateDragTarget` (`FUN_0045C080`) and its `0x1A4` -- and stood
 * upright inside the civilian it is meant to hang on to.
 *
 * Which states a spawn can be in is read off the bundle: its initial and
 * attack states, and the states its target and attack scripts were decoded
 * for. The last is where a captor parked in state 39 shows the state its
 * civilian's op 0x1A orders it into: the exporter decodes its script under
 * that state's shape.
 *
 *     node tools/run_ts.mjs tools/checks/state_clips.ts [--bundle DIR]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT, EXIT_SKIPPED } from "../lib/bundle_root";
import { Checker, argValue } from "../lib/exe_check";
import { DRAG_TARGET_CLIPS } from "../../src/game/class30/drag_clips";
import { ZombieState } from "../../src/game/class30/states";

type Json = any;

const CLASS_ZOMBIE = 0x30;

/**
 * The clips each state names as immediates, from the module the port's state
 * reads them out of, so the two cannot drift. One row per state whose
 * immediates the exporter has a list for.
 */
const STATE_CLIPS: ReadonlyArray<readonly [number, string, readonly number[]]> = [
  [ZombieState.DragTarget, "ZombieStateDragTarget", DRAG_TARGET_CLIPS],
];

const HEX3 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(3, "0")}`;

const bundle = argValue("bundle") ?? BUNDLE_ROOT;
const manifest = join(bundle, "manifest.json");
if (!existsSync(manifest)) {
  console.log(`SKIP  state_clips: no bundle at ${bundle}`);
  console.log("      build one with `cd web && npm run export -- --game-dir ...`,"
              + " or point HOTD2_BUNDLE at one");
  process.exit(EXIT_SKIPPED);
}

const c = new Checker("state_clips");
c.note("every clip a class-0x30 state names as an immediate, baked for the spawns in it");
let pairs = 0;

for (const entry of JSON.parse(readFileSync(manifest, "utf8")).stages) {
  const name: string = entry.name;
  const script = join(bundle, name, entry.script);
  if (!existsSync(script)) {
    c.fail(`${name}: the manifest names a script that is not there`);
    continue;
  }
  const chars = JSON.parse(readFileSync(script, "utf8")).characters;
  const bad: string[] = [];
  let here = 0;
  for (const pl of chars.placements as Json[]) {
    if (pl.class !== CLASS_ZOMBIE || pl.synthetic) continue;
    const states = new Set<number>([
      pl.initial_state, pl.attack_state,
      pl.target_script?.state, pl.attack_script?.state,
    ].filter((s): s is number => typeof s === "number"));
    const row = chars.types[String(pl.char_type)];
    const have = new Set(Object.keys(row?.motions ?? {}).map(Number));
    for (const [state, routine, clips] of STATE_CLIPS) {
      if (!states.has(state)) continue;
      for (const mid of clips) {
        here++;
        if (!have.has(mid)) {
          bad.push(`${name}: spawn at ${pl.at} (0x${pl.at.toString(16)}) can be in state `
                   + `${state}, and ${routine}'s clip ${mid} (${HEX3(mid)}) is not baked `
                   + `for its character type ${pl.char_type}`);
        }
      }
    }
  }
  pairs += here;
  if (here && !bad.length) {
    c.ok(true, `${name}: all ${here} (spawn, state clip) pairs baked`);
  }
  for (const line of bad) c.fail(line);
}

// A bundle with no spawn in a listed state -- one stage exported alone --
// asserted nothing, and `finish` says so with exit 3 rather than a pass.
c.note(`${pairs} (spawn, state clip) pairs over the bundle`);
c.finish();
