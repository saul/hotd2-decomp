/**
 * Does the stage-5 boss's fight run to `g_script_flags[30]`, and the script
 * on to the stage's end?
 *
 *     npm run boss5_fight
 *     BOSS5_FRAMES=40000 BOSS5_SHOOT=8 npm run boss5_fight
 *     BOSS5_TRACE=60 npm run boss5_fight      # a line every 60 frames
 *
 * Plays the real script from block 7 (the route's end block, which
 * `tools/playthrough.mjs` stops on) the way `tools/boss4_fight.mjs` plays
 * stage 4's: the walker, the character spawns in the script's order, and
 * `GameUpdate` through the `game` system, with the stage's camera and object
 * paths behind `T.camPaths` so the boss rides `0x180` and `0x181` and the
 * camera block is the one the actions build.
 *
 * **What is not real is the player's aim.** Headless there is no pick, so
 * the shots are delivered the way `MarkActorShot` (`FUN_00404DB0`) leaves
 * them: `obj+0x34 |= 0x0A` and `obj+0x190 = bone`. Player 0 fires at one of
 * the boss's four damaging bones every `BOSS5_SHOOT` frames once flag 23 is
 * up, and at every projectile that has launched every fourth frame, which
 * lets some through to the player. That is input, not a change to the port:
 * what a shot then means -- the charge, the reactions, the phase ladder, the
 * projectiles' bursts, the death -- is the port's. The players cannot be
 * hurt (`g_player_no_damage`), so a strike is counted rather than a game
 * lost; `BOSS5_HURT=1` turns that off.
 *
 * A run passes when the boss is placed, rides in, takes damage through all
 * five phase rows, throws projectiles, lunges, dies, gives the counters back,
 * raises flag 30 and despawns, and the walker gets past its
 * `wait_script_flag 30` and reaches the block's last step.
 */

import { readFileSync } from "node:fs";
import { CameraFrame } from "../src/core/camera.ts";
import { Events } from "../src/core/events.ts";
import { Rng } from "../src/core/rng.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { PlayerTasksRun } from "../src/game/player_shell.ts";
import { Scope } from "../src/core/scope.ts";
import { World } from "../src/core/world.ts";
import { GameSystem, ScriptSystem, syncCharacterSpawns, syncPortGlobals }
  from "../src/app/systems.ts";
import { ResetPropContainers } from "../src/game/class41/index.ts";
import { CamPaths } from "../src/game/camera/curve.ts";
import { G } from "../src/game/globals.ts";
import { ActorFlag } from "../src/game/actor.ts";
import { Class32State } from "../src/game/class32/state.ts";
import { SetCameraPaths, SetGameTables } from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { hasBundle, skipNoBundle, stageFile } from "./lib/bundle_root.ts";

if (!hasBundle()) skipNoBundle("boss5_fight");

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
const FRAMES = Number(process.env.BOSS5_FRAMES ?? 30000);
const SHOOT = Number(process.env.BOSS5_SHOOT ?? 10);
const HURT = process.env.BOSS5_HURT === "1";
/** The four bones `Class32ChargeShotBone` charges. */
const DAMAGE_BONES = [4, 6, 11, 13];
const FLAG_FIGHT = 23;
const FLAG_DEAD = 30;
const BLOCK = 7;

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
});

const stage = 5;
const script = JSON.parse(readFileSync(stageFile(stage, "script"), "utf8"));
const cam = new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"),
                                                 "utf8")));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

console.log(`\n== stage 5 block ${BLOCK}`);
const stageScope = new Scope(`stage:${stage}`);
const ctx = {
  events: new Events(), rng: new Rng(1), walker: null, scope: stageScope,
  session: stageScope.child("session"), view: new CameraFrame(),
  paths: cam, stage, frame: 0,
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
SetCameraPaths(cam);
PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
if (!HURT) G.g_player_no_damage = [1, 1];
G.g_GameMode = script.game_mode;
if (!seekTo(walker, BLOCK, 1, 0)) {
  check(`seek to block ${BLOCK}`, false);
  process.exit(1);
}
world.resync(ctx);

const seat = () => {
  ctx.view.eye.x = G.g_camera_block_eye.x;
  ctx.view.eye.y = G.g_camera_block_eye.y;
  ctx.view.eye.z = G.g_camera_block_eye.z;
};
// A spawn whose actor despawned itself is not built again while the script
// still lists it -- `render/characters.ts`'s `spent`, which this pool stands
// in for.
const spent = new Set();
const pool = {
  rng: ctx.rng,
  bindToPool() {},
  readySpawns: (spawns) => spawns
    .filter((s) => placementAt.has(s.at) && !placementAt.get(s.at).synthetic
      && !spent.has(s.at))
    .map((s) => {
      const pl = placementAt.get(s.at);
      const pos = s.pos ?? pl.pos ?? [0, 0, 0];
      return { at: s.at, motion: pl.motion ?? 0,
               pos: { x: pos[0], y: pos[1], z: pos[2] } };
    }),
  syncSpawns: () => [],
};

const seen = {
  boss: null, fight: -1, flag30: -1, despawn: -1, pastGate: -1, end: -1,
  states: new Map(), phases: new Map(), shots: 0, projectileShots: 0,
  projectiles: 0, maxLive: 0, tasks: new Map(), minHp: Infinity,
  countersBack: -1, rode: false, lunges: 0,
};
const hurt = { strike: 0, other: 0 };
ctx.events.on("player.damaged", (e) => {
  if (seen.boss && e.at === seen.boss.at) hurt.strike += 1;
  else hurt.other += 1;
});
const projectileAts = new Set();
let lastState = -1;
let lastPhase = -1;
let rounds = 0;
let lastRoundState = -1;
const log = [];
seat();
for (let f = 0; f < FRAMES; f += 1) {
  walker.tick(TICK);
  if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
  syncPortGlobals(walker, false, ctx.view.eye);
  seat();
  syncCharacterSpawns(pool, walker.spawns);
  const boss = G.g_object_list.find((o) => o.cls === 0x32 && !o.despawned
    && o.boss5.routine === 0);
  if (boss) seen.boss = boss;
  // Every other attack round is let through unshot: a hit in a cast or a
  // lunge sends the boss to its reaction, which bursts every projectile and
  // ends the lunge, so a harness that never held its fire would never see
  // either reach the player.
  if (boss && (boss.state === Class32State.CastProjectiles
               || boss.state === Class32State.LungeAtCamera)
      && boss.state !== lastRoundState) {
    rounds += 1;
    lastRoundState = boss.state;
  } else if (boss && boss.state !== Class32State.CastProjectiles
             && boss.state !== Class32State.LungeAtCamera) {
    lastRoundState = -1;
  }
  const holdFire = boss && rounds % 2 === 1
    && (boss.state === Class32State.CastProjectiles
        || boss.state === Class32State.LungeAtCamera
        || boss.boss5.liveProjectiles > 0);
  if (boss && G.g_script_flags[FLAG_FIGHT] && boss.hp > 0 && !holdFire
      && f % SHOOT === 0) {
    boss.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    boss.shotBones[0] = DAMAGE_BONES[(f / SHOOT) % DAMAGE_BONES.length | 0];
    seen.shots += 1;
  }
  if (f % 4 === 0) {
    for (const o of G.g_object_list) {
      if (o.cls !== 0x32 || o.despawned || o.boss5.routine !== 1) continue;
      if (o.flags & ActorFlag.NoShotTest) continue;
      if ((o.at & 3) !== 0) continue;
      o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      seen.projectileShots += 1;
    }
  }
  world.update(ctx, LIVE);
  for (const o of G.g_object_list) {
    if (o.cls === 0x32 && o.boss5.routine === 1) projectileAts.add(o.at);
  }
  seen.maxLive = Math.max(seen.maxLive, boss?.boss5.liveProjectiles ?? 0);
  for (const t of G.g_class32_tasks) {
    seen.tasks.set(t.routine, (seen.tasks.get(t.routine) ?? 0) + (t.draw ? 1 : 0));
  }
  if (boss) {
    seen.minHp = Math.min(seen.minHp, boss.hp);
    if (boss.state === Class32State.WaitCamAndFlags && boss.pos.y > 100) {
      seen.rode = true;
    }
    if (boss.state !== lastState) {
      seen.states.set(boss.state, (seen.states.get(boss.state) ?? 0) + 1);
      if (boss.state === Class32State.LungeAtCamera) seen.lunges += 1;
      log.push(`  f${String(f).padStart(6)}  ${Class32State[boss.state]}`
        + ` hp ${boss.hp} phase ${boss.boss5.phase} rank ${boss.boss5.rank}`
        + ` cam ${G.g_active_cam_path}/${G.g_cam_path_frame}`
        + ` e${G.g_enemies_alive}/${G.g_enemies_present}`
        + ` pos ${boss.pos.x.toFixed(0)},${boss.pos.y.toFixed(0)},${boss.pos.z.toFixed(0)}`);
      lastState = boss.state;
    }
    if (boss.boss5.phase !== lastPhase) {
      seen.phases.set(boss.boss5.phase, f);
      lastPhase = boss.boss5.phase;
    }
  }
  if (seen.fight < 0 && G.g_script_flags[FLAG_FIGHT]) seen.fight = f;
  if (seen.countersBack < 0 && seen.boss && seen.boss.state >= 3
      && seen.boss.state <= 4 && G.g_enemies_alive === 0) {
    seen.countersBack = f;
  }
  if (seen.flag30 < 0 && G.g_script_flags[FLAG_DEAD]) seen.flag30 = f;
  if (seen.despawn < 0 && seen.boss?.despawned) {
    seen.despawn = f;
    spent.add(seen.boss.at);
  }
  if (seen.flag30 >= 0 && seen.pastGate < 0
      && (walker.block !== BLOCK || walker.step > 4)) {
    seen.pastGate = f;
  }
  if (seen.pastGate >= 0 && seen.end < 0 && walker.block === BLOCK
      && walker.step === 5 && walker.opIndex >= 40) {
    seen.end = f;
  }
  if (process.env.BOSS5_TRACE && f % Number(process.env.BOSS5_TRACE) === 0) {
    console.log(`  t${f} b${walker.block}/s${walker.step}/o${walker.opIndex}`
      + ` cam ${G.g_active_cam_path}/${G.g_cam_path_frame}`
      + ` e${G.g_enemies_alive}/${G.g_enemies_present}`
      + (boss ? ` ${Class32State[boss.state]}/${boss.sub} hp ${boss.hp}`
        + ` live ${boss.boss5.liveProjectiles}` : ""));
  }
  if (seen.end >= 0) break;
}
for (const l of log.slice(0, 80)) console.log(l);
seen.projectiles = projectileAts.size;
const states = [...seen.states.entries()]
  .map(([s, n]) => `${Class32State[s] ?? s}x${n}`).join(" ");
console.log(`  states: ${states}`);
console.log(`  shots at the boss ${seen.shots}, at projectiles`
  + ` ${seen.projectileShots}; projectiles made ${seen.projectiles},`
  + ` most alive ${seen.maxLive}; lowest hp ${seen.minHp}`);
console.log(`  tasks drawn: ${[...seen.tasks.entries()].map(([r, n]) =>
  `${r}:${n}`).join(" ")}; the player struck by the boss ${hurt.strike},`
  + ` by its projectiles ${hurt.other}`);
console.log(`  fight at f${seen.fight}, counters back f${seen.countersBack},`
  + ` flag 30 at f${seen.flag30}, despawn f${seen.despawn},`
  + ` past the gate f${seen.pastGate}, block end f${seen.end}`);
check("the boss is placed", seen.boss !== null);
check("it rides object path 0x180 in", seen.rode);
check("flag 23 starts the fight", seen.fight >= 0);
const phases = [...seen.phases.keys()];
check("the fight walks all five phase rows", [0, 1, 2, 3, 4]
  .every((p) => phases.includes(p)), phases.join(","));
check("it casts, circles, lunges and barrages", [7, 8, 9, 10]
  .every((s) => seen.states.has(s)), states);
check("it throws projectiles", seen.projectiles > 0);
check("its projectiles strike the player", hurt.other > 0);
check("it dies (states 2, 3, 4)", [2, 3, 4].every((s) => seen.states.has(s)));
check("state 3 gives both counters back", seen.countersBack >= 0);
check("state 4 raises flag 30", seen.flag30 >= 0);
check("...and despawns", seen.despawn >= 0);
check("the walker gets past wait_script_flag 30", seen.pastGate >= 0,
      `block ${walker.block} step ${walker.step} op ${walker.opIndex}`);
check("...and reaches the block's end", seen.end >= 0,
      `block ${walker.block} step ${walker.step} op ${walker.opIndex}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
