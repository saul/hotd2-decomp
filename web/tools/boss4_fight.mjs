/**
 * Does the stage-4 boss's fight run to `g_script_flags[32]`?
 *
 *     node tools/run_test.mjs tools/boss4_fight.mjs
 *     BOSS4_FRAMES=30000 BOSS4_SHOOT=12 node tools/run_test.mjs tools/boss4_fight.mjs
 *
 * `tools/playthrough.mjs` cannot answer it: it stops on the first poll inside
 * an **end** block, and stage 4's boss blocks -- 23, 25, 27, 29 -- are its end
 * blocks, so the fight's two gates have never run under it.
 * This plays the real script from the top of
 * each routed boss block, the way `tools/dives.mjs` plays a flock: the walker,
 * the camera seat, the character and slot spawns in the script's order (the
 * transport before the boss, so `Boss4Init` latches it), and `GameUpdate`
 * through the `game` system, with the stage's camera paths behind
 * `GameHost.camPath` so `Boss4PlayCameraCue` flies the real curves.
 *
 * **What is not real is the player's aim.** Headless there is no posed
 * skeleton, so there is no shot test to pass; instead, every `BOSS4_SHOOT`
 * frames once flag 31 is up, player 0's head shot is delivered the way
 * `MarkActorShot` (`FUN_00404DB0`) leaves one -- `obj+0x34 |= 0x0A`,
 * `obj+0x190 = 2` -- and `Boss4ResolveShot` does the rest. That is input, not a
 * change to the port: everything the shot then means -- the damage, the floor,
 * the reactions, the phase, the arena, the cues, the death -- is the port's.
 * The players cannot be hurt (`g_player_no_damage`), so a strike is counted
 * rather than a game lost.
 *
 * A block passes when flag 31 is raised, the fight passes through every phase
 * of its arena, flag 32 is raised, and the walker gets past its
 * `wait_script_flag 32`.
 *
 * **Where it stops.** The same step spawns eight bats (class 0x46) with the
 * boss, and nothing here shoots them: they are what hits the player (and
 * keeps the player's invulnerability up, so the boss's own strikes are mostly
 * refused), and after the death the script's `wait_enemies_present 0` (op 70)
 * waits on them. So the outro camera -- path 182 or 190, whose frame 0 is the
 * pair in the boss's tail that despawns him -- is not reached here; the
 * despawn is `web/test/port.test.ts`'s to assert.
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
import { Boss4State } from "../src/game/class19/state.ts";
import { SetBoss4Tables, SetCameraPaths, SetGameTables }
  from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { hasBundle, skipNoBundle, stageFile } from "./lib/bundle_root.ts";

if (!hasBundle()) skipNoBundle("boss4_fight");

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
/** The budget per block. The fight is some three to four thousand frames. */
const FRAMES = Number(process.env.BOSS4_FRAMES ?? 20000);
/** One head shot every this many frames -- five a second. */
const SHOOT = Number(process.env.BOSS4_SHOOT ?? 12);
/** `[name, block, the arena's last phase]` -- the two blocks a route reaches. */
const CASES = [
  ["block 23, entrance 0, arena 1", 23, 8],
  ["block 25, entrance 1, arena 2", 25, 17],
];
const FLAG_READY = 31;
const FLAG_DEAD = 32;

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

const stage = 4;
const script = JSON.parse(readFileSync(stageFile(stage, "script"), "utf8"));
const cam = new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"),
                                                 "utf8")));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

for (const [name, block, lastPhase] of CASES) {
  console.log(`\n== ${name}`);
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
  SetBoss4Tables(script.boss4, script.carrier_door_yaw);
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
  G.g_player_no_damage = [1, 1];
  G.g_GameMode = script.game_mode;
  if (!seekTo(walker, block, 1, 0)) {
    check(`${name}: seek to block ${block}`, false);
    continue;
  }
  world.resync(ctx);

  // The eye the next tick's frame is handed, as the app's `CameraTakeSystem`
  // hands it: the camera the last tick drew. The camera block itself is the
  // port's -- the action ring and the drivers seat it inside `GameUpdate`.
  const seat = () => {
    ctx.view.eye.x = G.g_camera_block_eye.x;
    ctx.view.eye.y = G.g_camera_block_eye.y;
    ctx.view.eye.z = G.g_camera_block_eye.z;
  };
  // The character layer, headless -- `syncCharacterSpawns`'s own pool
  // interface, answered from the placements the way the renderer answers it.
  const pool = {
    rng: ctx.rng,
    bindToPool() {},
    readySpawns: (spawns) => spawns
      .filter((s) => placementAt.has(s.at) && !placementAt.get(s.at).synthetic)
      .map((s) => {
        const pl = placementAt.get(s.at);
        const pos = s.pos ?? pl.pos ?? [0, 0, 0];
        return { at: s.at, motion: pl.motion ?? 0,
                 pos: { x: pos[0], y: pos[1], z: pos[2] } };
      }),
    syncSpawns: () => [],
  };
  const seen = { flag31: -1, flag32: -1, despawn: -1, pastGate: -1,
                 phases: new Map(), states: new Map(), shots: 0, props: 0,
                 minHp: Infinity, boss: null };
  // Who hurt the player: the boss's strikes and charge name him, his thrown
  // prop is `source: "thrown"`, anything else is the block's other enemies.
  const hurt = { boss: 0, thrown: 0, other: 0 };
  ctx.events.on("player.damaged", (e) => {
    if (e.source === "thrown") hurt.thrown += 1;
    else if (seen.boss && e.at === seen.boss.at) hurt.boss += 1;
    else { hurt.other += 1; if (process.env.BOSS4_WHO) console.log("  hurt by", e.who, e.at, e.source); }
  });

  const log = [];
  let lastPhase_ = -2, lastState = -1;
  seat();
  for (let f = 0; f < FRAMES; f += 1) {
    walker.tick(TICK);
    if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
    syncPortGlobals(walker, false, ctx.view.eye);
    seat();
    syncCharacterSpawns(pool, walker.spawns, ctx.events);
    const boss = G.g_object_list.find((o) => o.cls === 0x19 && !o.despawned);
    if (boss) seen.boss = boss;
    // Player 0's head shot, as `MarkActorShot` leaves it.
    if (boss && boss.boss4 && G.g_script_flags[FLAG_READY]
        && !(boss.flags & ActorFlag.Dead) && f % SHOOT === 0
        && !(boss.flags & ActorFlag.NoShotTest)) {
      boss.flags |= ActorFlag.Hit | 2;
      boss.shotBones[0] = 2;
      seen.shots += 1;
    }
    world.update(ctx, LIVE);
    const b = boss?.boss4;
    if (process.env.BOSS4_TRACE && f % Number(process.env.BOSS4_TRACE) === 0) {
      const c = walker.cam;
      console.log(`  t${f} b${walker.block}/s${walker.step}/o${walker.opIndex}`
        + ` cam ${c ? `${c.slot}:${c.frame.toFixed(1)}${c.deferred ? "d" : ""}`
          + `${c.done ? "D" : ""}${c.retired ? "R" : ""}` : "-"}`
        + ` stash ${G.g_stashed_path_frame}/${G.g_stashed_path_end_frame}`
        + ` rail ${G.g_rail_frame.toFixed(1)} held ${G.g_camera_driver_held}`
        + ` cpf ${G.g_cam_path_frame} e${G.g_enemies_alive}`
        + ` p${G.g_enemies_present} [${G.g_object_list.filter((o) =>
          !o.despawned && !o.dead && o.cls !== 0x19 && o.cls !== 0x13)
          .map((o) => `${o.name}:${o.cls.toString(16)}`).join(",")}]`
        + (b ? ` st ${Boss4State[b.state]}/${b.sub} ph ${b.phase}`
          + ` cue ${b.cueFrame.toFixed(1)}/${b.cueEnd} step ${b.cueStep}`
          + ` q ${b.cueQueued} fl ${b.flags.toString(16)} hp ${boss.hp}`
          + ` pos ${boss.pos.x.toFixed(0)},${boss.pos.z.toFixed(0)}` : ""));
    }
    if (b) {
      seen.minHp = Math.min(seen.minHp, boss.hp);
      if (b.phase !== lastPhase_) {
        seen.phases.set(b.phase, f);
        log.push(`  f${String(f).padStart(6)}  phase ${b.phase}`
          + `  hp ${boss.hp}  floor ${b.phaseHpFloor.toFixed(1)}`
          + `  cam ${G.g_active_cam_path}/${G.g_cam_path_frame}`
          + `  state ${Boss4State[b.state] ?? b.state}`);
        lastPhase_ = b.phase;
      }
      if (b.state !== lastState) {
        seen.states.set(b.state, (seen.states.get(b.state) ?? 0) + 1);
        lastState = b.state;
      }
    }
    seen.props = Math.max(seen.props, G.g_carried_props.length);
    if (seen.flag31 < 0 && G.g_script_flags[FLAG_READY]) seen.flag31 = f;
    if (seen.flag32 < 0 && G.g_script_flags[FLAG_DEAD]) seen.flag32 = f;
    if (seen.despawn < 0 && seen.boss?.despawned) seen.despawn = f;
    if (seen.flag32 >= 0 && seen.pastGate < 0
        && (walker.block !== block || !walker.wait
            || walker.wait.op.op !== 0x45)) {
      seen.pastGate = f;
    }
    if (seen.pastGate >= 0 && seen.despawn >= 0) break;
    if (seen.pastGate >= 0 && f > seen.pastGate + 600) break;
  }
  for (const l of log) console.log(l);
  const states = [...seen.states.entries()]
    .map(([s, n]) => `${Boss4State[s] ?? s}x${n}`).join(" ");
  console.log(`  states: ${states}`);
  console.log(`  shots ${seen.shots}; the player hit by the boss ${hurt.boss}, `
    + `by his props ${hurt.thrown}, by others ${hurt.other}; props alive at `
    + `once ${seen.props}; lowest hp ${seen.minHp}`);
  console.log(`  flag 31 at f${seen.flag31}, flag 32 at f${seen.flag32}, `
    + `walker past the gate at f${seen.pastGate}, despawn at f${seen.despawn}`);
  check(`${name}: the boss is placed`, seen.boss !== null);
  check(`${name}: the entrance raises flag 31`, seen.flag31 >= 0);
  const phases = [...seen.phases.keys()].filter((p) => p !== 0xff);
  const first = lastPhase - 8;
  const every = Array.from({ length: 9 }, (_, i) => first + i)
    .every((p) => phases.includes(p));
  check(`${name}: the fight passes through phases ${first}..${lastPhase}`,
        every, phases.join(","));
  check(`${name}: the death raises flag 32`, seen.flag32 >= 0);
  check(`${name}: ...and the walker gets past its wait_script_flag 32`,
        seen.pastGate >= 0,
        `block ${walker.block} step ${walker.step} op ${walker.opIndex}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
