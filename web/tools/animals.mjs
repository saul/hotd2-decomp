/**
 * Trace the three animals -- the frog (class 0x11), the owl (0x43) and the
 * fish (0x51) -- through a real bundle, frame by frame.
 *
 *     node tools/run_test.mjs tools/animals.mjs
 *
 * Prints every distinct state each actor passes through in forty seconds from
 * the top of the block that spawns it. None of the three is a skinned enemy
 * the character layer can build on its own -- the owl and the fish have no
 * character type at all -- so this is also the check that `SpawnSlotActors`
 * reaches them.
 *
 * It found two things the unit tests could not. A class-0x51 **group header**
 * is an actor that exists only to set the water level and die, and the dead
 * sweep was giving back two enemy counts it never took; and `SpawnSlotActors`
 * rebuilt any actor that had despawned under its own state machine, because
 * the pool is pruned at the end of every frame. Between them the scene's
 * enemy count reached -2387.
 *
 * The frog is the one case that needs a nudge: it waits on a camera path and
 * this harness has no camera, so the loop forces `g_active_cam_path` to the
 * path its descriptors name.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT, hasBundle, skipNoBundle }
  from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { GameUpdate, SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { g_class_handlers } from "../src/game/registry.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

/** `[name, stage, block, step, class, states it must reach]`. */
const CASES = [
  ["frog", 1, 3, 1, 0x11, ["HopToHeading", "IdleAndCroak"]],
  ["owl st2", 2, 5, 1, 0x43, ["FlyToCircle", "Circle", "Approach", "Dive",
                              "OrbitAway"]],
  // Stage 3 has two entries and block 7 is reachable only from the
  // second, so the seek is told which -- see `seekTo`.
  ["owl st3", 3, 7, 6, 0x43, ["Approach"], 7],
  ["fish st3 b1", 3, 1, 3, 0x51, ["Rise", "Bob", "Lunge", "FallBack"]],
  ["fish st3 b4", 3, 4, 1, 0x51, ["Rise", "Bob", "Lunge"]],
  ["fish st2 b16", 2, 16, 8, 0x51, ["Rise", "Bob", "Lunge"]],
];

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
}

// **A missing export is a skip, not a failure** -- `L14`. Without this the
// `readFileSync` below throws ENOENT, and an uncaught throw is exit 1: a fresh
// worktree reports this as a check that found something wrong when in fact it
// asserted nothing. `verify_all.py` counts a 3 separately and names it.
if (!hasBundle()) skipNoBundle("animals");

for (const [name, stage, block, step, cls, wanted, entry] of CASES) {
  const dir = join(BUNDLE_ROOT, `stage${stage}`);
  const script = JSON.parse(
    readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));
  ResetGameGlobals();
  SetGameTables(chars, undefined, undefined, undefined, script.coli,
                script.civilians);
  G.g_players_in_play = 1;
  G.g_player_lives = [2, 2];
  const rng = new Rng(1);
  const events = new Events();
  let eye = vec3(0, 6, 0);
  const host = {
    ...NULL_HOST,
    viewSpaceOf: (at, out) => {
      const a = G.g_object_list.find((o) => o.at === at);
      if (!a) return false;
      out.x = a.pos.x - eye.x; out.y = a.pos.y - eye.y;
      out.z = -(a.pos.z - eye.z);
      return true;
    },
    viewPoint: (x, y, z, out) => {
      out.x = eye.x + x; out.y = eye.y + y; out.z = eye.z - z;
    },
  };
  const walker = new Walker(script, {
    enterRegion() {}, loadSlot() {}, unloadSlot() {}, startCamera() {},
    onFeed() {}, onBranch() {}, playSound() { return undefined; },
    aliveEnemies: () => G.g_enemies_alive,
    presentEnemies: () => G.g_enemies_present,
    aliveCivilians: () => G.g_civilians_alive,
    scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => true, showMessage: () => null, endDialogue() {},
  }, { seed: 1 });
  // Walk the whole block rather than seeking to one op: the spawns we want
  // may be anywhere in it.
  let found = 0;
  const seen = new Map();
  if (!seekTo(walker, block, step, 0, 500000, entry)) {
    check(`${name}: seek to ${stage}/${block}/${step}`, false);
    continue;
  }
  const sync = () => {
    const reqs = [];
    for (const s of walker.spawns) {
      if (G.g_object_list.some((o) => o.at === s.at)) continue;
      const pl = placementAt.get(s.at);
      if (!pl) continue;
      const pos = s.pos ?? pl.pos ?? [0, 0, 0];
      reqs.push({ at: s.at, motion: pl.motion ?? 0,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    SpawnScriptedCharacters(reqs, rng);
    SpawnSlotActors(walker.spawns, rng);
  };
  let seated = false;
  for (let f = 0; f < 60 * 40; f += 1) {
    walker.tick(1 / 60);
    sync();
    if (!seated) {
      const a = G.g_object_list.find((o) => o.cls === cls && !o.despawned);
      if (a) { eye = vec3(a.pos.x, a.pos.y + 4, a.pos.z + 30); seated = true; }
    }
    if (cls === 0x11) { G.g_active_cam_path = 41; G.g_cam_path_frame = f; }
    GameUpdate(eye, 1 / 60, host, rng, events);
    for (const o of G.g_object_list) {
      if (o.cls !== cls) continue;
      found = Math.max(found, 1);
      const d = g_class_handlers[cls]?.debug?.(o);
      if (d) {
        const k = `${o.at.toString(16)} ${d.summary}`;
        if (!seen.has(k)) seen.set(k, `${d.detail?.[0] ?? ""}`);
      }
    }
  }
  const n = new Set([...seen.keys()].map((k) => k.split(" ")[0])).size;
  const states = new Set([...seen.keys()].map((k) => k.split(" ")[1].split("/")[0]));
  console.log(`\n== ${name}: stage ${stage} block ${block} -- ${n} actors, `
    + `${[...states].join(", ")}, alive=${G.g_enemies_alive} `
    + `present=${G.g_enemies_present}`);
  if (process.env.HOTD2_ANIMALS_VERBOSE) {
    for (const [k, v] of seen) console.log(`   ${k.padEnd(34)} ${v}`);
  }
  check(`${name}: the block places at least one`, n > 0, `${n}`);
  check(`${name}: it leaves the state its Init put it in`, states.size > 1,
        [...states].join(","));
  for (const want of wanted) {
    check(`${name}: it reaches ${want}`, states.has(want),
          [...states].join(","));
  }
  // The counters are the reason these three were worth porting: a class that
  // joins them and never gives them back is a gate that never opens, and one
  // that gives back what it never took takes the whole scene negative.
  check(`${name}: the enemy counters stay sane`,
        G.g_enemies_alive >= 0 && G.g_enemies_present >= 0
        && G.g_enemies_alive <= 16 && G.g_enemies_present <= 16,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
