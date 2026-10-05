/**
 * Every class-0x30 spawn whose entrance state reads its descriptor tail
 * carries that tail, decoded, in the bundle.
 *
 * `ZombieStateDelayedLeap` (`FUN_004581A0`, state 26) and
 * `ZombieStateArcScriptedEntrance` (`FUN_00458A70`, state 30) read the tail at
 * `obj+0x1390` with no test, so the port reads `delayedLeap` and `entry` the
 * same way and a spawn without them throws. This is what stands behind that.
 *
 * **Which state reads the tail is not always the one the spawn starts in.**
 * `ZombieStateRideCarrier` (`FUN_00458960`, state 29) reads only byte 3 and
 * hands over to it (`0x00458A48`), so a rider's tail is its attack state's.
 * Stage 2's six boat riders are those spawns. The exporter keyed the decode on
 * the initial state, and all six reached the bundle with nothing: the port's
 * states sent each straight to `AttackRun`, and they walked off their boats
 * through the pillars instead of leaping onto the pavement.
 *
 *     node tools/run_ts.mjs tools/checks/entry_tails.ts [--bundle DIR]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT, EXIT_SKIPPED } from "../lib/bundle_root";
import { Checker, argValue } from "../lib/exe_check";
import { ZombieState } from "../../src/game/class30/states";

type Json = any;

const CLASS_ZOMBIE = 0x30;

/** What each state reads, and the placement key its decode travels under. */
const READERS: ReadonlyArray<readonly [number, string, (p: Json) => boolean]> = [
  [ZombieState.DelayedLeap, "ZombieStateDelayedLeap",
   (p) => Array.isArray(p.delayed_leap?.dest) && typeof p.delayed_leap?.gravity === "number"],
  [ZombieState.ArcScriptedEntrance, "ZombieStateArcScriptedEntrance",
   (p) => Array.isArray(p.entry?.dest) && (p.entry?.frames ?? 0) > 0
     && (p.entry?.step ?? 0) > 0 && typeof p.entry?.delay === "number"],
];

const bundle = argValue("bundle") ?? BUNDLE_ROOT;
const manifest = join(bundle, "manifest.json");
if (!existsSync(manifest)) {
  console.log(`SKIP  entry_tails: no bundle at ${bundle}`);
  console.log("      build one with `cd web && npm run export -- --game-dir ...`,"
              + " or point HOTD2_BUNDLE at one");
  process.exit(EXIT_SKIPPED);
}

const c = new Checker("entry_tails");
c.note("every class-0x30 spawn's tail, decoded for the state that reads it");
let total = 0;
let ridden = 0;

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
    const rides = pl.initial_state === ZombieState.RideCarrier;
    const reader = rides ? pl.attack_state : pl.initial_state;
    for (const [state, routine, has] of READERS) {
      if (reader !== state) continue;
      here++;
      if (rides) ridden++;
      if (!has(pl)) {
        bad.push(`${name}: spawn at 0x${pl.at.toString(16)} ${rides
          ? `rides a carrier into state ${state}` : `starts in state ${state}`}, `
          + `and ${routine}'s tail is not in its placement`);
      }
    }
  }
  total += here;
  if (here && !bad.length) c.ok(true, `${name}: all ${here} tails decoded`);
  for (const line of bad) c.fail(line);
}

c.note(`${total} spawns whose entrance reads its tail, ${ridden} of them carried into it`);
c.finish();
