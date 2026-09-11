/**
 * Does a class-0x43 dive reach the camera it is aimed at?
 *
 *     node tools/run_test.mjs tools/dives.mjs
 *
 * Every other harness in this tree invents an eye. `tools/animals.mjs` seats
 * one thirty units behind the first owl it finds and leaves it there; the unit
 * tests put it at the origin. That is the right call for "is the state machine
 * transcribed", and it is blind to the failure this one exists for: **the
 * strike is a distance to the camera, and the camera is the stage's.**
 *
 * `OwlStateDiveAtCamera` (`FUN_00446F30`) has no frame counter and no clip
 * cue. Inside five units of `g_camera_block_eye` it takes a life and pulls
 * out; outside, it returns. Nothing clamps the dive's parameter, so an owl
 * that misses by a foot does not come round again — it carries on in a
 * straight line, through the camera and out of the level, for the rest of the
 * stage. The bug that produced this file froze the thirty-frame wing beat
 * during the dive, which turned the run-in's `sin((beat + 8) % 30) * 0.2`
 * height term from a bob into a constant and parked the whole approach five
 * units under the eye — exactly the strike radius. Every invented eye in the
 * tree happened to sit somewhere that still connected.
 *
 * So this plays the real script, seats the real `cam_play` on every frame the
 * way `app/systems.ts` does, and watches all four sub-types make their pass.
 * A sub-type passes when an owl strikes, retreats, and **launches again** —
 * the loop is the behaviour, not the first hit. The closest approach each owl
 * managed is printed either way, because "missed by a foot" and "aimed at the
 * wrong thing entirely" are different bugs.
 */

import { readFileSync } from "node:fs";
import { CameraFrame } from "../src/core/camera.ts";
import { Events } from "../src/core/events.ts";
import { Rng } from "../src/core/rng.ts";
import { Scope } from "../src/core/scope.ts";
import { World } from "../src/core/world.ts";
import { GameSystem, ScriptSystem, syncPortGlobals }
  from "../src/app/systems.ts";
import { ResetPropContainers } from "../src/game/class41/index.ts";
import { CamPaths } from "../src/game/camera/curve.ts";
import { CamSeatPathFrame } from "../src/game/camera/path.ts";
import { SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G } from "../src/game/globals.ts";
import { OwlState } from "../src/game/class43/state.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { hasBundle, skipNoBundle, stageFile } from "./lib/bundle_root.ts";

if (!hasBundle()) skipNoBundle("dives");

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
/** Half a minute, which is four passes at the slowest sub-type's cadence. */
const FRAMES = Number(process.env.DIVE_FRAMES ?? 1800);

/** `[name, stage, block, step, sub-type, entry]`, one per placed flock. */
const CASES = [
  ["st2 b5 s4", 2, 5, 4, 0],
  ["st2 b5 s1", 2, 5, 1, 1],
  ["st2 b14 s6", 2, 14, 6, 2],
  // Stage 3's block 7 is reachable only from the second entry — see `seekTo`.
  ["st3 b7 s6", 3, 7, 6, 3, 7],
];

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`
    + (ok || !detail ? "" : ` -- ${detail}`));
}

const mkHost = () => ({
  enterRegion: () => undefined, loadSlot: () => undefined,
  unloadSlot: () => undefined, startCamera: () => undefined,
  onFeed: () => undefined, onBranch: () => undefined,
  playSound: () => undefined,
  aliveEnemies: () => G.g_enemies_alive,
  presentEnemies: () => G.g_enemies_present,
  aliveCivilians: () => G.g_civilians_alive,
  scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
  cameraFree: () => true, showMessage: () => null,
  endDialogue: () => undefined,
});

for (const [name, stage, block, step, subtype, entry] of CASES) {
  const script = JSON.parse(readFileSync(stageFile(stage, "script"), "utf8"));
  const cam = new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"),
                                                   "utf8")));
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

  const stageScope = new Scope(`stage:${stage}`);
  const ctx = {
    events: new Events(), rng: new Rng(1), walker: null, scope: stageScope,
    session: stageScope.child("session"), view: new CameraFrame(),
    stage, frame: 0,
  };
  const world = new World();
  const scriptSys = new ScriptSystem();
  world.add("script", scriptSys);
  world.add("game", new GameSystem());
  const walker = new Walker(script, mkHost(), { seed: 1 });
  scriptSys.walker = walker;
  ctx.walker = walker;
  ResetPropContainers();
  world.attach(ctx);
  SetGameTables(chars, script.breakables, script.set_pieces, script.humanoids,
                script.coli, script.civilians);
  G.g_players_in_play = 1;
  G.g_player_lives = [9999, 9999];
  G.g_GameMode = script.game_mode;
  if (!seekTo(walker, block, step, 0, 500000, entry)) {
    check(`${name}: seek to ${stage}/${block}/${step}`, false);
    continue;
  }
  world.resync(ctx);

  // What `seatCamera` does, minus the rig: the block's eye is the engine's,
  // and it is what the dive measures against.
  const seat = () => {
    const c = walker.cam;
    const p = c && cam.paths.get(c.slot);
    if (!p) return;
    CamSeatPathFrame(p, c.frame, walker.rollEnabled, !c.retired);
    ctx.view.eye.x = G.g_camera_block_eye.x;
    ctx.view.eye.y = G.g_camera_block_eye.y;
    ctx.view.eye.z = G.g_camera_block_eye.z;
  };
  const spawn = () => {
    const reqs = [];
    for (const s of walker.spawns) {
      if (G.g_object_list.some((o) => o.at === s.at)) continue;
      const pl = placementAt.get(s.at);
      if (!pl) continue;
      const pos = s.pos ?? pl.pos ?? [0, 0, 0];
      reqs.push({ at: s.at, motion: pl.motion ?? 0,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    SpawnScriptedCharacters(reqs, ctx.rng);
    SpawnSlotActors(walker.spawns, ctx.rng);
  };
  seat();

  /** at -> `{ closest, dives, strikes }`. */
  const owls = new Map();
  for (let f = 0; f < FRAMES; f += 1) {
    walker.tick(TICK);
    if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
    syncPortGlobals(walker, false, ctx.view.eye);
    seat();
    spawn();
    world.update(ctx, LIVE);
    for (const o of G.g_object_list) {
      if (o.cls !== 0x43 || o.despawned) continue;
      const s = o.owl;
      if (!s) continue;
      let r = owls.get(o.at);
      if (!r) owls.set(o.at, r = { closest: Infinity, dives: 0, strikes: 0,
                                   was: -1 });
      if (s.state === OwlState.Dive) {
        r.closest = Math.min(r.closest,
          Math.hypot(o.pos.x - ctx.view.eye.x, o.pos.y - ctx.view.eye.y,
                     o.pos.z - ctx.view.eye.z));
        if (r.was !== OwlState.Dive) r.dives += 1;
      }
      if (s.state === OwlState.OrbitAway && r.was === OwlState.Dive) {
        r.strikes += 1;
      }
      r.was = s.state;
    }
  }

  const rows = [...owls.entries()];
  const detail = rows.map(([at, r]) =>
    `0x${at.toString(16)} ${r.dives}d/${r.strikes}s d=${r.closest.toFixed(1)}`)
    .join(" ");
  console.log(`\n== sub-type ${subtype}: stage ${stage} block ${block} step `
    + `${step} -- ${rows.length} owls, ${detail}`);
  check(`${name}: the step places an owl`, rows.length > 0, `${rows.length}`);
  check(`${name}: every owl's dive reaches the camera and strikes`,
        rows.length > 0 && rows.every((r) => r[1].strikes > 0), detail);
  check(`${name}: ...and comes round for another pass`,
        rows.length > 0 && rows.every((r) => r[1].dives > 1), detail);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
