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
 * The frog is the one case that needs a nudge: it waits on a camera path the
 * harness does not play, so the loop forces `g_active_cam_path` to the path
 * its descriptors name.
 *
 * A row may name a **kill frame**: on it every live actor of the class is
 * marked shot as `MarkActorShot` marks one (`obj+0x34` bits 3 and 1), and
 * the run then asserts each of them died, left a ground ring and left the
 * pool. That is the frog's death on the real clips: its corpse waits for the
 * death clip's play length after freezing it one short, and the port once
 * read the cursor a tick early and froze it for good -- stage 1's frog room
 * stood on two corpses in `Die/1` holding `g_enemies_present`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT, hasBundle, skipNoBundle, stageFile }
  from "./lib/bundle_root.ts";
import { CamPaths } from "../src/game/camera/curve.ts";
import { Rng } from "../src/core/rng.ts";
import { PlayerTasksRun } from "../src/game/player_shell.ts";
import { Events } from "../src/core/events.ts";
import { GameUpdate, SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { SeatHarnessEye } from "./lib/harness_eye.ts";
import { ActorFlag } from "../src/game/actor.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetCameraPaths, SetGameTables } from "../src/game/tables.ts";
import { g_class_handlers } from "../src/game/registry.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

/**
 * `[name, stage, block, step, class, states it must reach, entry, min travel,
 * kill frame]`.
 */
const CASES = [
  ["frog", 1, 3, 1, 0x11, ["HopToHeading", "IdleAndCroak"]],
  ["frog death", 1, 3, 1, 0x11, ["Die"], undefined, undefined, 60 * 12],
  ["owl st2", 2, 5, 1, 0x43, ["FlyToCircle", "Circle", "Approach", "Dive",
                              "OrbitAway"]],
  // The sub-type-0 pair, which is placed already diving and so never touches
  // the spline. Its whole behaviour is the strike and the retreat, and an owl
  // that misses its strike leaves the state machine for good -- nothing
  // clamps the dive's parameter, so it flies on in a straight line.
  ["owl st2 b5s4", 2, 5, 4, 0x43, ["Dive", "OrbitAway"]],
  // Stage 3 has two entries and block 7 is reachable only from the
  // second, so the seek is told which -- see `seekTo`.
  ["owl st3", 3, 7, 6, 0x43, ["Approach"], 7],
  ["fish st3 b1", 3, 1, 3, 0x51, ["Rise", "Bob", "Lunge", "FallBack"]],
  ["fish st3 b4", 3, 4, 1, 0x51, ["Rise", "Bob", "Lunge"]],
  ["fish st2 b16", 2, 16, 8, 0x51, ["Rise", "Bob", "Lunge"]],
  // The bats. Sub-type 0 is the only one with a placement per member, so it is
  // the only one this harness can watch through the character layer -- and it
  // is 24 of the 27 shipped descriptors. Its whole path is in the EXE, so
  // reaching `Fly` at all is the check that the flight group and the member
  // index came off the descriptor the right way round.
  ["bat st4 b0", 4, 0, 6, 0x46, ["Wait", "Fly"]],
  ["bat st4 b2", 4, 2, 6, 0x46, ["Wait", "Fly"]],
  ["bat st3 b4", 3, 4, 5, 0x46, ["Wait", "Fly"]],
  // The cat that plays its list (class 0x53 sub-type 1, set 5): its summary
  // leads with the clip, so these are the three entries of the row. The last
  // one, 0x2FD, is the run -- and it is only reachable if the bundle baked the
  // whole row, which is the half of the block-11 report the port could not
  // fix on its own: with entry 0 alone the cat stood on 0x305 for ever.
  ["cat st2 b11", 2, 11, 7, 0x53, ["0x305", "0x2fc", "0x2fd"], undefined, 100],
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

for (const [name, stage, block, step, cls, wanted, entry, minTravel,
            killAt] of CASES) {
  const dir = join(BUNDLE_ROOT, `stage${stage}`);
  const script = JSON.parse(
    readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));
  ResetGameGlobals();
  SetGameTables(chars, undefined, undefined, undefined, script.coli,
                script.civilians);
  // The stage's camera paths. The classes read the camera the engine's own
  // tasks write -- `g_camera_eye` from the scene state's hook, a camera block
  // from the driver -- and with no paths those tasks write zeros over the
  // eye this harness seats, so an owl dived at the world origin. With them
  // the camera is the stage's, as `tools/dives.mjs` has it.
  SetCameraPaths(new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"),
                                                      "utf8"))));
  // In play through the ported routines, not by hand (L49): the reset
  // started the game from the title, and this is the first player turn.
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
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
  // Where each actor was first seen, and the furthest it has been from there.
  const home = new Map();
  let travel = 0;
  if (!seekTo(walker, block, step, 0, 500000, entry)) {
    check(`${name}: seek to ${stage}/${block}/${step}`, false);
    continue;
  }
  // An actor that despawned under its own state machine is not built again
  // while the script still lists it -- the character layer's `spent` set
  // (`render/characters.ts`), because `SpawnFromDescriptor` builds an object
  // once. Without it a frog that died here came straight back.
  const spent = new Set();
  const sync = () => {
    const reqs = [];
    const listed = new Set(walker.spawns.map((s) => s.at));
    for (const at of spent) if (!listed.has(at)) spent.delete(at);
    for (const s of walker.spawns) {
      if (spent.has(s.at)) continue;
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
  // The kill: who was marked, who has gone since, and the rings made after.
  const killed = new Set();
  const gone = new Set();
  const rings = new Set();
  let ringSeq = Infinity;
  for (let f = 0; f < 60 * 40; f += 1) {
    walker.tick(1 / 60);
    sync();
    if (!seated) {
      const a = G.g_object_list.find((o) => o.cls === cls && !o.despawned);
      if (a) { eye = vec3(a.pos.x, a.pos.y + 4, a.pos.z + 30); seated = true; }
    }
    if (cls === 0x11) { G.g_active_cam_path = 41; G.g_cam_path_frame = f; }
    if (f === killAt) {
      ringSeq = G.g_creature_effect_seq;
      for (const o of G.g_object_list) {
        if (o.cls !== cls || o.despawned) continue;
        o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
        killed.add(o.at);
      }
    }
    SeatHarnessEye(eye);
    GameUpdate(1 / 60, host, rng, events);
    for (const r of G.g_ring_effects) if (r.id >= ringSeq) rings.add(r.id);
    for (const o of G.g_object_list) {
      if (o.cls === cls && o.despawned) { gone.add(o.at); spent.add(o.at); }
      else if (o.despawned) spent.add(o.at);
    }
    for (const o of G.g_object_list) {
      if (o.cls !== cls) continue;
      found = Math.max(found, 1);
      const h = home.get(o.at);
      if (!h) home.set(o.at, { x: o.pos.x, z: o.pos.z });
      else travel = Math.max(travel, Math.hypot(o.pos.x - h.x, o.pos.z - h.z));
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
  // A state name can be reached by a clip id that has no frames behind it:
  // the cat's playlist steps onto 0x2FD whether or not the bundle baked it,
  // and an unbaked clip carries nobody anywhere. Where the behaviour *is* the
  // travel, the travel is what is asserted.
  if (minTravel !== undefined) {
    check(`${name}: it travels at least ${minTravel} units`,
          travel >= minTravel, travel.toFixed(1));
  }
  if (killAt !== undefined) {
    check(`${name}: the kill found someone to kill`, killed.size > 0,
          `${killed.size}`);
    check(`${name}: every one of them left the pool`,
          [...killed].every((at) => gone.has(at)),
          [...killed].filter((at) => !gone.has(at))
            .map((at) => at.toString(16)).join(","));
    check(`${name}: ...each leaving a ground ring as it settled`,
          rings.size === killed.size, `${rings.size} rings, ${killed.size} killed`);
    const left = G.g_object_list.filter((o) => o.cls === cls).length;
    check(`${name}: ...and nothing of the class is left standing`,
          left === 0, `${left}`);
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
