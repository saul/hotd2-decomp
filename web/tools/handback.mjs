/**
 * Does the room wait for the camera, or only for the last zombie?
 *
 *     node tools/run_test.mjs tools/handback.mjs
 *
 * `wait_enemies_alive` (0x44) and its two siblings need `g_camera_free` on top
 * of their counter, and **which rule produces that flag is a property of the
 * shot**: `EvtActionFinishSequence21` installs a driver out of
 * `g_camera_action_starters` by the scene-state minor it enters. Minors 4 and
 * 6 install `CameraDriverSelectMode`, which holds the flag down until
 * `CameraTurnOntoPathTarget` has eased the aim back onto the rail; minor 7
 * installs `CameraDriverFromDeferredPose`, which frees it the moment the slot
 * table empties. 267 of the 278 room-clear gates in the shipped scripts wait
 * under the first.
 *
 * The port had the second rule on every shot, so a room handed over on the
 * frame the last zombie died. Reported as the camera snapping and the pacing
 * running away from the player.
 *
 * Nothing else in the tree could see it. `port.test.ts` drives the mode
 * machine directly and proves the rule; this proves the *pacing*, which needs
 * the stage's own camera path, its own script and its own enemies — so it
 * plays them, kills the room the frame a gate starts waiting, and measures
 * the frames between the counter reaching zero and the gate letting go.
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
import { ActorFlag } from "../src/game/actor.ts";
import { CameraActionDriver } from "../src/game/camera/mode.ts";
import { ReleaseEnemyAliveCount } from "../src/game/combat/counts.ts";
import { ActorIsEnemy } from "../src/game/registry.ts";
import { SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G } from "../src/game/globals.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { hasBundle, skipNoBundle, stageFile } from "./lib/bundle_root.ts";

if (!hasBundle()) skipNoBundle("handback");

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
/** Frames played from the block's first instruction. */
const FRAMES = Number(process.env.HANDBACK_FRAMES ?? 5400);

/**
 * Above this the aim counts as off the rail. The convergence test is on the
 * *square* of the cosine against 0.99999, which is about 0.18 degrees, and the
 * ease crosses the last degree slowly -- a single degree is already twenty
 * frames of turn -- so the threshold sits just above the test's own.
 */
const OFF_RAIL_DEGREES = 0.5;

/**
 * `[name, stage, block, step]`. The step is the block's first *resting*
 * address — a walker stops between steps, not at a block's op 0, so seeking to
 * step 0 fails and runs the stage to its end instead.
 */
const CASES = [
  ["stage 1 block 1", 1, 1, 2],
  ["stage 2 block 5", 2, 5, 1],
  ["stage 3 block 1", 3, 1, 1],
];

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`
    + (ok || !detail ? "" : ` -- ${detail}`));
}

/** How far the aim is from the rail's own, in degrees, seen from the eye. */
function offRailDegrees() {
  const e = G.g_camera_block_eye;
  const a = G.g_camera_block_target;
  const b = G.g_cam_path_target;
  const ax = a.x - e.x, ay = a.y - e.y, az = a.z - e.z;
  const bx = b.x - e.x, by = b.y - e.y, bz = b.z - e.z;
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (la < 1e-4 || lb < 1e-4) return 0;
  const d = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, d))) * 180 / Math.PI;
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
  cameraFree: () => G.g_camera_free !== 0,
  showMessage: () => null, endDialogue: () => undefined,
});

for (const [name, stage, block, step] of CASES) {
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
  if (!seekTo(walker, block, step, 0)) {
    check(`${name}: seek`, false);
    continue;
  }
  world.resync(ctx);

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

  /** One row per gate: how long it waited after its counter reached zero. */
  const gates = [];
  let waiting = null;
  for (let f = 0; f < FRAMES; f += 1) {
    walker.tick(TICK);
    if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
    syncPortGlobals(walker, false, ctx.view.eye);
    seat();
    spawn();
    world.update(ctx, LIVE);

    const w = walker.wait;
    const onEnemyGate = !!w && w.policy?.kind === "enemies";
    if (process.env.HANDBACK_TRACE && f % 30 === 0) {
      console.log(`   f${f} ${walker.block}/${walker.step}/${walker.op} `
        + `wait=${w ? w.policy?.kind + ":" + w.blocksOn : "-"} `
        + `alive=${G.g_enemies_alive} free=${G.g_camera_free} `
        + `drv=${G.g_camera_action_driver} minor=${walker.sceneState.minor} `
        + `objs=[${G.g_object_list.map((o) => `${o.at.toString(16)}:c${o.cls.toString(16)}`
            + `:hp${o.hp}:d${o.dead ? 1 : 0}:v${o.visible ? 1 : 0}`).join(",")}]`);
    }
    if (onEnemyGate && !waiting) {
      waiting = { at: `${walker.block}/${walker.step}`,
                  since: f, zero: -1,
                  driver: G.g_camera_action_driver };
    }
    if (onEnemyGate && waiting) {
      // Clear the room the way a death does, so the only thing left between
      // here and the gate opening is the camera. These are the exact two
      // things `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) does on the
      // death frame -- drop the alive count and take the actor out of the
      // camera's slots -- and nothing else, because nothing else is what the
      // hand-back is measured against. Firing a real bullet would add the
      // death clip's length to every number here and measure the corpse
      // instead of the camera.
      if (waiting.zero < 0) {
        for (const o of G.g_object_list) {
          if (o.despawned || !ActorIsEnemy(o.cls)) continue;
          o.flags |= ActorFlag.NoCameraTrack;
          G.g_enemy_slots = G.g_enemy_slots.filter((at) => at !== o.at);
          ReleaseEnemyAliveCount(o);
        }
        if (G.g_enemies_alive === 0) {
          waiting.zero = f;
          waiting.offRail = offRailDegrees();
        }
      }
    } else if (waiting) {
      waiting.opened = f;
      gates.push(waiting);
      waiting = null;
    }
  }

  const held = gates.filter((g) => g.zero >= 0);
  const rows = held.map((g) =>
    `${g.at}:${g.offRail.toFixed(0)}deg/${g.opened - g.zero}f`).join(" ");
  console.log(`\n== ${name} -- ${gates.length} enemy gates, `
    + `${held.length} measured: ${rows || "none"}`);
  check(`${name}: the block reaches an enemy gate`, gates.length > 0,
        `${gates.length}`);
  check(`${name}: every gate runs under an installed camera driver`,
        gates.length > 0
        && gates.every((g) => g.driver !== CameraActionDriver.None),
        gates.map((g) => `${g.at}:${g.driver}`).join(" "));
  // **The hold is the turn, so it is only as long as the turn has to be.** A
  // room whose aim never left the rail hands back at once and should; a room
  // an enemy pulled the camera away from holds for the tens of frames the
  // ease takes. Asserting a flat minimum would be asserting something the
  // engine does not do.
  const pulled = held.filter((g) => g.offRail > OFF_RAIL_DEGREES);
  const onRail = held.filter((g) => g.offRail <= OFF_RAIL_DEGREES);
  check(`${name}: a room whose aim an enemy pulled away holds for the turn`,
        pulled.length === 0 || pulled.every((g) => g.opened - g.zero > 10),
        rows);
  check(`${name}: ...and one already on its rail hands back at once`,
        onRail.every((g) => g.opened - g.zero <= 10), rows);
  // The ease is a fixed fraction of the remaining angle, so a wider swing is
  // a longer hold. Only worth asserting where the block measured both.
  const wide = pulled.reduce((a, g) => a && g.offRail > a.offRail ? g : a,
                             pulled[0]);
  const narrow = pulled.reduce((a, g) => a && g.offRail < a.offRail ? g : a,
                               pulled[0]);
  if (pulled.length > 1 && wide.offRail > narrow.offRail * 2) {
    check(`${name}: ...and a wider swing holds longer than a narrow one`,
          wide.opened - wide.zero > narrow.opened - narrow.zero,
          `${narrow.offRail.toFixed(0)}deg/${narrow.opened - narrow.zero}f vs `
          + `${wide.offRail.toFixed(0)}deg/${wide.opened - wide.zero}f`);
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
