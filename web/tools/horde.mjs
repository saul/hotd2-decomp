/**
 * The horde (class 0x40) through a real bundle, from each block that places
 * one to the `wait_enemies_alive` behind it.
 *
 *     node tools/run_test.mjs tools/horde.mjs
 *
 * For each of the five horde spawns: seek to the step, run the walker and the
 * port with no renderer, and watch. The members must come up, walk in, wander,
 * wind up and dive, and a dive must take a life. Then the harness shoots every
 * member that is up -- **an override, and printed as one** (`L45`): it raises
 * the hit bits `MarkActorShot` would, because there is no pick without a
 * renderer -- and the room has to clear: both counters back to zero and the
 * walker past the gate it was parked on.
 *
 * The harness plays the camera's part too, which is only the eye the dive
 * homes on: it sits the eye thirty units behind the placer.
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

/** `[name, stage, block, step]` -- the five selector-1 descriptors. */
const CASES = [
  ["stage 1 block 3", 1, 3, 3],
  ["stage 1 block 8", 1, 8, 3],
  ["stage 2 block 14", 2, 14, 4],
  ["stage 2 block 18", 2, 18, 4],
  // Block 0x19's horde is placed in step 1 and kept out of the counters until
  // `g_script_flags[94]`, which step 2 raises -- behind a cut scene and a
  // civilian a headless run cannot play out, and a seek past step 1's
  // `wait_enemies_alive` retires the spawn. So the harness raises flag 94
  // itself once the members are up (**an override, printed**) and asks only
  // that the room clears; the walker's gate is in a step it never reaches.
  ["stage 2 block 25", 2, 25, 1, 94],
];

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
}

if (!hasBundle()) skipNoBundle("horde");

const isMember = (o) => o.cls === 0x40 && o.horde
  && (o.horde.kind === 1 || o.horde.kind === 2 || o.horde.kind === 3);

for (const [name, stage, block, step, forceFlag] of CASES) {
  const dir = join(BUNDLE_ROOT, `stage${stage}`);
  const script = JSON.parse(
    readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));
  ResetGameGlobals();
  SetGameTables(chars, undefined, undefined, undefined, script.coli,
                script.civilians);
  // The player is not set by hand: the reset starts a game from the title
  // and the first frame's player task puts player 0 in play with the factory
  // three lives (`game/player_shell.ts`). It used to write `[5, 0]` here,
  // which is how the horde's bite passed while the page's never landed (L49).
  G.g_nFiringGate = 1;
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
    viewSpaceOfPoint: (p, out) => {
      out.x = p.x - eye.x; out.y = p.y - eye.y; out.z = -Math.abs(p.z - eye.z) - 1;
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
  if (!seekTo(walker, block, step, 0, 500000)) {
    check(`${name}: seek`, false, `${walker.block}/${walker.step}`);
    continue;
  }
  G.g_scene_index = script.scene ?? 0;
  // Only this block's spawns. The seek replays the stage from its entry and
  // lists everything it passed; built here they would be actors from rooms
  // the player has left, and stage 2's block-0 rescue target holds a count
  // for as long as it lives (see `L45`).
  const here = () => walker.spawns.filter((s) => s.block === block);
  const sync = () => {
    const reqs = [];
    for (const s of here()) {
      if (G.g_object_list.some((o) => o.at === s.at)) continue;
      const pl = placementAt.get(s.at);
      if (!pl || pl.motion == null || pl.synthetic) continue;
      const pos = s.pos ?? [0, 0, 0];
      reqs.push({ at: s.at, motion: pl.motion,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    SpawnScriptedCharacters(reqs, rng);
    SpawnSlotActors(here(), rng);
  };
  const states = new Set();
  let seated = false;
  let members = 0;
  let bitten = false;
  let shooting = false;
  let shot = 0;
  let cleared = -1;
  let gateBlock = -1;
  let gateStep = -1;
  // What the first frame's `PlayerEnterPlay` will give.
  const lives0 = G.g_start_lives;
  for (let f = 0; f < 60 * 120; f += 1) {
    walker.tick(1 / 60);
    G.g_scene_state_major_entered = walker.sceneState.major;
    // The script's flags as the walker keeps them; `ResetSceneOnEnter`
    // zeroed the array and `set_script_flag` fills it.
    sync();
    const ms = G.g_object_list.filter((o) => isMember(o) && !o.despawned);
    if (!seated && ms.length) {
      const a = ms[0];
      eye = vec3(a.horde.baseX, a.pos.y + 6, a.horde.baseZ + 30);
      G.g_camera_block_eye = vec3(eye.x, eye.y, eye.z);
      seated = true;
    }
    members = Math.max(members, ms.length);
    if (forceFlag !== undefined && ms.length && f > 60
        && !G.g_script_flags[forceFlag]) {
      console.log(`   override: g_script_flags[${forceFlag}] = 1 at frame ${f}`);
      G.g_script_flags[forceFlag] = 1;
    }
    GameUpdate(eye, 1 / 60, host, rng, events);
    G.g_frame_counter; // stepped by GameUpdate
    for (const o of ms) {
      const d = g_class_handlers[0x40]?.debug?.(o);
      if (d) states.add(d.summary.split("/")[0]);
    }
    if (G.g_player_lives[0] < lives0) bitten = true;
    // Once a bite has landed, start shooting -- the override.
    if (bitten && !shooting) {
      shooting = true;
      gateBlock = walker.block;
      gateStep = walker.step;
    }
    if (shooting) {
      for (const o of ms) {
        const t = o.horde;
        if (t.kind === 2 && t.state !== 0) {
          o.flags |= 0x8 | 0x2;
          shot += 1;
        }
      }
    }
    if (shooting && cleared < 0 && G.g_enemies_alive === 0
        && ms.every((o) => o.horde.kind !== 2)) {
      cleared = f;
    }
    if (cleared >= 0 && (forceFlag !== undefined
        || walker.block !== gateBlock || walker.step !== gateStep)) {
      break;
    }
  }
  const others = G.g_object_list.filter((o) => !o.despawned && !isMember(o)
    && o.cls !== 0x40).map((o) => `${o.name}(0x${o.cls.toString(16)})`
      + `${o.dead ? "+dead" : ""}`);
  console.log(`   others: ${others.join(" ")}; wait ${walker.wait?.blocksOn ?? "-"}`);
  console.log(`\n== ${name}: ${members} members, states `
    + `${[...states].join(", ")}; bite ${bitten}; shots (override) ${shot}; `
    + `alive=${G.g_enemies_alive} present=${G.g_enemies_present}; `
    + `walker ${gateBlock}/${gateStep} -> ${walker.block}/${walker.step}`);
  check(`${name}: the placer builds members`, members > 0, `${members}`);
  for (const want of ["Enter", "WindUp", "Dive", "PullOut"]) {
    check(`${name}: a member reaches ${want}`, states.has(want),
          [...states].join(","));
  }
  check(`${name}: a dive takes a life`, bitten);
  check(`${name}: shooting them all clears both counters`,
        cleared >= 0 && G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  if (forceFlag === undefined) check(`${name}: ...and the walker moves on past the gate`,
        walker.block !== gateBlock || walker.step !== gateStep,
        `${walker.block}/${walker.step}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
