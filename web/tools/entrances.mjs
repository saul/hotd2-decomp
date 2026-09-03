/**
 * Do the twelve entrance states actually *end*?
 *
 * Every one of them is a wait: for a frame count, a camera path frame, a
 * script flag, an arc to finish. A wait that is transcribed slightly wrong
 * does not crash and does not look wrong in a unit test — it simply never
 * comes true, and the actor stands there for the rest of the stage. That is
 * the failure mode this file exists to catch, and it is the one a synthetic
 * fixture cannot: the cue values are the game's, and so is the camera.
 *
 * For each of the 133 shipped class-0x30 spawns whose initial state is one of
 * the twelve, it drives the real bundle for 60 seconds with the camera on its
 * real path and reports what the actor was doing at the end:
 *
 * * **moved on** — it left the entrance for another state. The pass.
 * * **struck** — it is one of the four scripted attackers, which never leave;
 *   reaching the damage frame at least once is their pass.
 * * **stuck** — it is still in the entrance state and its sub never advanced.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/entrances.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { DescriptorFromPlacement } from "../src/game/descriptor.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { vec3 } from "../src/game/vec.ts";

const root = BUNDLE_ROOT;
const SECONDS = 60;

/** The twelve, and which of them are the scripted attackers that never exit. */
const ENTRANCES = [13, 14, 17, 18, 19, 20, 23, 24, 29, 30, 31, 32];
const NEVER_EXITS = new Set([24, 32]);
/**
 * `ZombieStateScriptedGrabAndDespawn` ends by **removing** the actor, not by
 * setting a state — it is the only one of the twelve that does. Its `state`
 * therefore still reads 23 when it has finished correctly.
 */
const DESPAWNS = new Set([23]);

const rows = [];
let total = 0, moved = 0, struck = 0, stuck = 0;

for (let stage = 1; stage <= 6; stage++) {
  let script;
  try {
    script = JSON.parse(readFileSync(
      join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
  } catch { continue; }
  const chars = script.characters;
  const placements = new Map(chars.placements.map((p) => [p.at, p]));

  // Where each spawn is placed, and which camera path was playing when the
  // step that places it ran -- an entrance waiting on a camera frame is
  // waiting on *that* path, and driving the wrong one proves nothing.
  const spawnPos = new Map();
  const spawnPath = new Map();
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      let path = -1;
      for (const op of st.ops ?? []) {
        if (op.cam_path !== undefined && op.cam_path >= 0) path = op.cam_path;
        for (const sp of op.spawns ?? []) {
          if (spawnPos.has(sp.at)) continue;
          spawnPos.set(sp.at, sp);
          spawnPath.set(sp.at, path);
        }
      }
    }
  }

  for (const p of chars.placements) {
    const sp = spawnPos.get(p.at);
    if (!sp || p.motion === null) continue;
    // **Class 0x30 only.** Class 0x31 numbers its own states, and its state 23
    // is `ThrowerStateDelayedPounce` -- nothing to do with the scripted grab.
    // Filtering on the state alone pulled in two stage-2 throwers and called
    // them stuck when they were fighting perfectly well.
    if (sp.class !== 0x30) continue;
    if (!ENTRANCES.includes(p.initial_state)) continue;
    total += 1;

    ResetGameGlobals();
    SetGameTables(chars, undefined, undefined, undefined, script.coli,
                  script.civilians);
    G.g_active_cam_path = spawnPath.get(p.at) ?? -1;
    G.g_cam_path_frame = 0;
    // A single player, in play. `g_players_in_play` is a **count**; leaving it
    // at 0 is the attract screen, and states 24 and 32 refuse to strike there.
    G.g_players_in_play = 1;
    // ...and the scene state the player gets from the walker through
    // `syncPortGlobals`. `IsPlayerAttackable` (`FUN_00409DC0`) refuses unless
    // the major is 2 -- the `cam/` path camera row -- so a harness that leaves
    // it at 0 is testing a scripted cutscene, where nothing may attack.
    G.g_scene_state_major_entered = 2;
    G.g_player_lives = [2, 2];

    const a = ActorSpawn(sp.at, sp.class, p.char_type,
                         chars.types[String(p.char_type)]?.name ?? "?",
                         DescriptorFromPlacement(p));
    a.pos = { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] };
    a.hp = p.hp || 100;
    a.motion = p.motion;
    // `GameUpdate` skips an actor the renderer has not turned on, and this
    // harness has no renderer. `replay.mjs` does the same thing a frame later.
    a.visible = true;

    const eye = vec3(a.pos.x, a.pos.y + 5, a.pos.z + 40);
    const rng = new Rng(1);
    const events = new Events();
    let hits = 0;
    events.on("player.damaged", () => { hits += 1; });

    const startSub = a.sub;
    let leftAt = -1, maxSub = a.sub;
    for (let f = 0; f < SECONDS * 60; f++) {
      // The camera runs its path, which is what every camera cue waits on.
      G.g_cam_path_frame_prev = G.g_cam_path_frame;
      G.g_cam_path_frame += 1;
      // ...and the script raises its flags. Two states wait on one; nothing
      // else in this harness would ever set them.
      if (f === 120) for (let i = 0; i < 256; i++) G.g_script_flags[i] = 1;
      GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
      maxSub = Math.max(maxSub, a.sub);
      const left = DESPAWNS.has(p.initial_state)
        ? (a.despawned || a.dead) : a.state !== p.initial_state;
      if (leftAt < 0 && left) leftAt = f;
      if (leftAt >= 0 && !NEVER_EXITS.has(p.initial_state)) break;
    }

    let verdict;
    if (NEVER_EXITS.has(p.initial_state)) {
      // These two loop for ever by design; landing a hit is the pass.
      verdict = hits > 0 ? "struck" : "stuck";
    } else if (leftAt >= 0) {
      verdict = "moved on";
    } else {
      verdict = maxSub > startSub ? "advanced but never left" : "stuck";
    }
    if (verdict === "moved on") moved += 1;
    else if (verdict === "struck") struck += 1;
    else stuck += 1;

    rows.push({
      stage, at: sp.at, state: p.initial_state, exit: p.attack_state,
      verdict, leftAt, hits,
      to: leftAt >= 0 ? (ZombieState[a.state] ?? a.state) : "",
    });
  }
}

const byState = new Map();
for (const r of rows) {
  const e = byState.get(r.state) ?? { n: 0, ok: 0, bad: [] };
  e.n += 1;
  if (r.verdict === "moved on" || r.verdict === "struck") e.ok += 1;
  else e.bad.push(r);
  byState.set(r.state, e);
}

console.log(`${total} shipped spawns start in one of the twelve `
          + `entrance states\n`);
for (const st of ENTRANCES) {
  const e = byState.get(st);
  if (!e) { console.log(`  state ${String(st).padStart(2)}:  no spawns`); continue; }
  const mark = e.ok === e.n ? "ok  " : "FAIL";
  console.log(`  ${mark} state ${String(st).padStart(2)}: `
            + `${e.ok}/${e.n} progressed`);
  for (const r of e.bad.slice(0, 4)) {
    console.log(`         s${r.stage} 0x${r.at.toString(16).toUpperCase()}`
              + ` exit=${r.exit} -- ${r.verdict}`);
  }
}

const sample = rows.filter((r) => r.verdict === "moved on").slice(0, 8);
console.log("\nwhere the first few hand over, and how long they took:");
for (const r of sample) {
  console.log(`  s${r.stage} 0x${r.at.toString(16).toUpperCase()} `
            + `state ${String(r.state).padStart(2)} -> ${r.to} `
            + `after ${(r.leftAt / 60).toFixed(2)}s`);
}

console.log(`\n${moved} moved on, ${struck} struck, ${stuck} stuck`);
if (stuck) {
  console.log("FAIL: an entrance that never ends parks its actor for the "
            + "rest of the stage");
  process.exitCode = 1;
}
