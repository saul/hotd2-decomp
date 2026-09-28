/**
 * The bat (class 0x46) through a real bundle: every step that places one, run
 * to the end of its flights with nobody shooting.
 *
 *     node tools/run_test.mjs tools/bats.mjs
 *
 * NEW-BUGS 19 was "the bats don't damage the player when they hit the
 * screen". The strike's only gate is `g_player_state == 5` for either player
 * (`BatDiveUpdate` 0x0042E88A, `BatSwarmUpdate` 0x0042F1B5), and the page left
 * it at 0 -- while `port.test.ts` and `horde.mjs` set 5 by hand and passed.
 * So this harness **does not touch the player at all**: the state is whatever
 * `ResetGameGlobals` and the first frame's player task make it, which is what
 * the page runs on.
 *
 * The player is whatever the reset and the first frame make of it -- three
 * lives, in play, through `game/player_shell.ts` -- and the harness counts
 * `player.damaged` events from bats. The 90-frame
 * invulnerability window means a flight of bats twenty frames apart does not
 * take a life each; what is asserted is that the strike *path* runs -- one
 * damage per arrival outside the window -- and that the counters come back.
 *
 * The harness plays the camera's part, which is only the eye the flights home
 * on: fixed, thirty units behind the first member it sees.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT, hasBundle, skipNoBundle }
  from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { GameUpdate, SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G, PlayerState, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

/** `[name, stage, block, step, entry block]`. */
const CASES = [
  ["stage 3 block 4 (dive, group 1)", 3, 4, 5],
  ["stage 4 block 0 (dive, group 0)", 4, 0, 6],
  ["stage 4 block 2 (dive, group 2)", 4, 2, 6],
  ["stage 4 block 10 (dive, group 3)", 4, 10, 1],
  // Block 7 is off the route a seek from block 0 takes, so it is entered
  // directly: the walker opens there, as a deep link to it does.
  ["stage 4 block 7 (swarm)", 4, 7, 3, 7],
  ["stage 3 block 2 (scatter + swarm)", 3, 2, 4],
];

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
}

if (!hasBundle()) skipNoBundle("bats");

const isBody = (o) => o.cls === 0x46 && o.bat && !o.bat.isWing;

for (const [name, stage, block, step, entry] of CASES) {
  const dir = join(BUNDLE_ROOT, `stage${stage}`);
  const script = JSON.parse(
    readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
  const placementAt = new Map(
    script.characters.placements.map((p) => [p.at, p]));
  ResetGameGlobals();
  SetGameTables(script.characters, undefined, undefined, undefined,
                script.coli, script.civilians);
  G.g_nFiringGate = 1;
  const rng = new Rng(1);
  const events = new Events();
  const hits = [];
  events.on("player.damaged", (e) => hits.push(e));
  let eye = vec3(0, 6, 30);
  const walker = new Walker(script, {
    enterRegion() {}, loadSlot() {}, unloadSlot() {}, startCamera() {},
    onFeed() {}, onBranch() {}, playSound() { return undefined; },
    aliveEnemies: () => G.g_enemies_alive,
    presentEnemies: () => G.g_enemies_present,
    aliveCivilians: () => G.g_civilians_alive,
    scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => true, showMessage: () => null, endDialogue() {},
  }, { seed: 1 });
  if (!seekTo(walker, block, step, 0, 500000, entry)) {
    check(`${name}: seek`, false, `${walker.block}/${walker.step}`);
    continue;
  }
  G.g_scene_index = script.scene ?? 0;
  const here = () => walker.spawns.filter((s) => s.block === block
    && s.step === step);
  const seen = new Set();
  const built = new Set();
  /** The player states after the first frame, which is where play begins. */
  let state0 = null;
  const bySub = new Map();
  let seated = false;
  let arrived = 0;
  let peak = 0;
  const live = new Map();
  for (let f = 0; f < 60 * 60; f += 1) {
    walker.tick(1 / 60);
    G.g_scene_state_major_entered = walker.sceneState.major;
    // Each descriptor is built once. The placer kills itself and a bat
    // despawns on arrival, so "not in the pool" is not "not yet built".
    const fresh = here().filter((sp) => !built.has(sp.at));
    for (const sp of fresh) built.add(sp.at);
    const reqs = [];
    for (const sp of fresh) {
      const pl = placementAt.get(sp.at);
      if (!pl || pl.motion == null || pl.synthetic) continue;
      const pos = sp.pos ?? [0, 0, 0];
      reqs.push({ at: sp.at, motion: pl.motion,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    SpawnScriptedCharacters(reqs, rng);
    SpawnSlotActors(fresh, rng);
    const bs = G.g_object_list.filter((o) => isBody(o) && !o.despawned);
    if (!seated && bs.length) {
      const a = bs[0];
      eye = vec3(a.pos.x, a.pos.y + 6, a.pos.z + 30);
      seated = true;
    }
    G.g_camera_block_eye = vec3(eye.x, eye.y, eye.z);
    for (const o of bs) {
      if (!seen.has(o.at)) {
        seen.add(o.at);
        bySub.set(o.bat.subtype, (bySub.get(o.bat.subtype) ?? 0) + 1);
      }
      live.set(o.at, o);
    }
    peak = Math.max(peak, bs.length);
    G.g_camera_eye = { x: eye.x, y: eye.y, z: eye.z };
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (state0 === null) state0 = [...G.g_player_state];
    for (const [at, o] of live) {
      if (!o.despawned) continue;
      live.delete(at);
      // Unshot, so a despawn in the flying state is an arrival.
      if (o.bat.subtype !== 1 && o.bat.state === 1) arrived += 1;
    }
    if (seen.size && !live.size && f > 60) break;
  }
  const batHits = hits.filter((h) => h.who === "bat" || /bat/.test(h.who));
  console.log(`\n== ${name}: state ${state0}; bodies ${seen.size} `
    + `(${[...bySub].map(([s, n]) => `sub${s}:${n}`).join(" ")}); `
    + `arrived ${arrived}; damage events ${hits.length} `
    + `(${[...new Set(hits.map((h) => h.who))].join(",")}); `
    + `lives ${G.g_start_lives} -> ${G.g_player_lives[0]}; `
    + `alive=${G.g_enemies_alive} present=${G.g_enemies_present}`);
  check(`${name}: the first frame puts player 0 in play`,
        state0?.[0] === PlayerState.InPlay, `${state0}`);
  check(`${name}: bats are placed`, seen.size > 0, `${seen.size}`);
  const strikers = (bySub.get(0) ?? 0) + (bySub.get(2) ?? 0);
  if (strikers) {
    check(`${name}: every unshot diving/swarm bat arrives`,
          arrived === strikers, `${arrived} of ${strikers}`);
    check(`${name}: an arrival takes a life`,
          batHits.length > 0 && G.g_player_lives[0] < G.g_start_lives,
          `${batHits.length} events, lives ${G.g_player_lives[0]}`);
    check(`${name}: ...and gives both counters back`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
