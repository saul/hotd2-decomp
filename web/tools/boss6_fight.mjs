/**
 * Does the stage-6 boss's fight run from its intro to the walker's last gate?
 *
 *     node tools/run_test.mjs tools/boss6_fight.mjs
 *     BOSS6_FRAMES=40000 BOSS6_SHOOT=10 node tools/run_test.mjs tools/boss6_fight.mjs
 *     BOSS6_TRACE=300 node tools/run_test.mjs tools/boss6_fight.mjs
 *
 * `tools/playthrough.mjs` stops on the first poll inside an **end** block, and
 * stage 6's block 12 -- the intro cut, the fight and the death -- is one, so
 * nothing else plays it. This plays the real script from the top of block 12
 * the way `tools/boss4_fight.mjs` plays stage 4's: the walker, the character
 * spawns in the script's order, and `GameUpdate` through the `game` system,
 * with the stage's `cp_` paths behind `GameHost.camPath` and its `op_` paths
 * behind `GameHost.objectPath`, so the intro rise, the round-3 paths and the
 * death ride fly the real curves.
 *
 * **What is not real is the player's aim.** Every `BOSS6_SHOOT` frames player
 * 0's shot is delivered the way `MarkActorShot` (`FUN_00404DB0`) and the pick
 * leave one -- `obj+0x34 |= 0x0A`, the bone in `obj+0x190`, the ray in
 * `Actor.shotRays` -- at the weak point that is open: the boss's bone 1
 * (`Class2DWeakPointInReach` measures the ray itself), a child's bone
 * (kind 0 any, 1 bone 1 through its own weak point, 2 bone 24, 3 bone 2).
 * Everything the shot then means -- the damage, the rank, the flinches, the
 * rounds, the children, the kill, the death -- is the port's. The players
 * cannot be hurt (`g_player_no_damage`), so a strike is counted rather than a
 * game lost.
 *
 * It passes when flag 50 comes up, the fight passes through rounds 1, 2 and
 * 3 into the death, at least one child is made and leaves, the boss and its
 * satellites despawn, and the walker gets past block 12's
 * `wait_enemies_alive 0`.
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
import { MatCopy, MatIdentity, MatrixGetTranslation, MatrixTranslate }
  from "../src/game/matrix.ts";
import { Class2DState } from "../src/game/class2D/state.ts";
import { SetCameraPaths, SetClass2DTables, SetGameTables }
  from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { hasBundle, skipNoBundle, stageFile } from "./lib/bundle_root.ts";

if (!hasBundle()) skipNoBundle("boss6_fight");

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
/** The budget: the intro cut is some 1,800 frames and the fight a few thousand. */
const FRAMES = Number(process.env.BOSS6_FRAMES ?? 40000);
/** One shot every this many frames. */
const SHOOT = Number(process.env.BOSS6_SHOOT ?? 8);
const BLOCK = 12;
const FLAG_INTRO = 50;
/** Block 12's `wait_enemies_alive 0`, op 210 -- the boss's own gate. */
const GATE_OP = 210;
const EMPEROR = 0x2d;

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

const stage = 6;
const script = JSON.parse(readFileSync(stageFile(stage, "script"), "utf8"));
const cam = new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"),
                                                 "utf8")));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

const stageScope = new Scope(`stage:${stage}`);
const ctx = {
  events: new Events(), rng: new Rng(1), walker: null, scope: stageScope,
  session: stageScope.child("session"), view: new CameraFrame(),
  paths: cam, stage, frame: 0,
};
const world = new World();
const scriptSys = new ScriptSystem();
const gameSys = new GameSystem();
world.add("script", scriptSys);
world.add("game", gameSys);
// `CamEvalObjectPath6` over the stage's `op_` paths, as the character layer
// answers it in the page.
const _pos = { x: 0, y: 0, z: 0 };
gameSys.backend = {
  boneWorld: () => false,
  setBoneSlot: () => undefined,
  objectPath: (slot, frame) => {
    const p = cam.objectPath(slot);
    if (!p) return null;
    const v = p.position(frame, _pos);
    return { x: v.x, y: v.y, z: v.z, pitch: p.channel(3, frame),
             yaw: p.channel(4, frame), roll: p.channel(5, frame) };
  },
};
const walker = new Walker(script, mkHost(), { seed: 1 });
scriptSys.walker = walker;
ctx.walker = walker;
ResetPropContainers();
world.attach(ctx);
SetGameTables(chars, script.breakables, script.set_pieces, script.humanoids,
              script.coli, script.civilians);
SetCameraPaths(cam);
SetClass2DTables(script.class2d);
PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
G.g_player_no_damage = [1, 1];
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
// The character layer's `spent`: an object that ran its own `ActorDespawn`
// is not made again while the script still lists it.
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

/** A world point on `bone` of `a`, `local` in the bone's frame. */
function bonePoint(a, bone, local) {
  const W = a.skel?.bones[bone]?.mat;
  if (!W) return null;
  const m = MatCopy(MatIdentity(), W);
  MatrixTranslate(m, local.x, local.y, local.z);
  const p = { x: 0, y: 0, z: 0 };
  MatrixGetTranslation(m, p);
  return p;
}

/** Player 0's pull, as the pick leaves it: bit 3 and 1, the bone, the ray. */
function shoot(a, bone, at) {
  const eye = G.g_camera_block_eye;
  const d = { x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z };
  const n = Math.hypot(d.x, d.y, d.z) || 1;
  a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
  a.shotBones[0] = bone;
  a.shotRays[0] = { origin: { x: eye.x, y: eye.y, z: eye.z },
                    dir: { x: d.x / n, y: d.y / n, z: d.z / n } };
}

const seen = { flag50: -1, states: new Map(), shots: 0, kids: new Map(),
               kidsGone: 0, despawn: -1, satsGone: -1, pastGate: -1,
               minHp: Infinity, boss: null, strikes: 0 };
ctx.events.on("player.damaged", () => { seen.strikes += 1; });
const log = [];
let lastState = -1;
seat();
for (let f = 0; f < FRAMES; f += 1) {
  walker.tick(TICK);
  if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
  syncPortGlobals(walker, false, ctx.view.eye);
  seat();
  syncCharacterSpawns(pool, walker.spawns);
  const all = G.g_object_list.filter((o) => o.cls === EMPEROR && !o.despawned);
  const boss = all.find((o) => o.class2d?.boss && o.class2d.boss.subtype === 1);
  if (boss) seen.boss = boss;
  const kids = all.filter((o) => o.class2d?.child);
  for (const k of kids) {
    if (!seen.kids.has(k)) seen.kids.set(k, f);
  }
  if (f % SHOOT === 0 && boss) {
    // The weak point, while it is open to a shot.
    if (boss.state >= Class2DState.Round1 && boss.state <= Class2DState.Round3
        && boss.sub > 0 && !(boss.flags & ActorFlag.ShotImmune)) {
      const p = bonePoint(boss, 1, { x: 2.3121, y: 0.1097, z: 0 });
      if (p) { shoot(boss, 1, p); seen.shots += 1; }
    }
    for (const k of kids) {
      const c = k.class2d.child;
      const target = c.kind === 0 ? [1, { x: 0, y: 0, z: 0 }]
        : c.kind === 1 ? [1, { x: 0, y: 4, z: 1 }]
          : c.kind === 2 ? [24, { x: 0, y: 0, z: 0 }]
            : [2, { x: 0, y: 0, z: 0 }];
      const p = bonePoint(k, target[0], target[1]);
      if (p && k.sub >= 2) { shoot(k, target[0], p); seen.shots += 1; }
    }
  }
  world.update(ctx, LIVE);
  if (boss) {
    seen.minHp = Math.min(seen.minHp, boss.hp);
    if (boss.state !== lastState) {
      seen.states.set(boss.state, f);
      log.push(`  f${String(f).padStart(6)}  state ${Class2DState[boss.state]}`
        + `  hp ${boss.hp}  cam ${G.g_active_cam_path}/${G.g_cam_path_frame}`);
      lastState = boss.state;
    }
  }
  if (process.env.BOSS6_TRACE && f % Number(process.env.BOSS6_TRACE) === 0) {
    const b = boss?.class2d.boss;
    console.log(`  t${f} b${walker.block}/s${walker.step}/o${walker.opIndex}`
      + ` cam ${G.g_active_cam_path}:${G.g_cam_path_frame}`
      + ` e${G.g_enemies_alive}/${G.g_enemies_present}`
      + (boss ? ` st ${Class2DState[boss.state]}/${boss.sub} ph ${b.phase}`
        + ` cue ${b.cue} hp ${boss.hp} rank ${b.rank} next ${b.next}`
        + ` clip ${boss.skel?.motion.toString(16)}:${boss.skel?.cursor}`
        + ` kids ${kids.map((k) => `${k.class2d.child.kind}/${k.sub}`).join(",")}`
        : ""));
  }
  for (const [k] of seen.kids) {
    if (k.despawned && !k.counted) { k.counted = true; seen.kidsGone += 1; }
  }
  if (seen.flag50 < 0 && G.g_script_flags[FLAG_INTRO]) seen.flag50 = f;
  if (seen.despawn < 0 && seen.boss?.despawned) {
    seen.despawn = f;
    spent.add(seen.boss.at);
  }
  if (seen.despawn >= 0 && seen.satsGone < 0
      && !G.g_object_list.some((o) => o.cls === EMPEROR && o.class2d?.sat
                               && !o.despawned)) {
    seen.satsGone = f;
  }
  if (seen.despawn >= 0 && seen.pastGate < 0
      && (walker.block !== BLOCK || walker.opIndex > GATE_OP)) {
    seen.pastGate = f;
  }
  if (seen.pastGate >= 0 && f > seen.pastGate + 120) break;
}
for (const l of log) console.log(l);
console.log(`  shots ${seen.shots}; the player struck ${seen.strikes} times; `
  + `lowest hp ${seen.minHp}; children made ${seen.kids.size}, gone `
  + `${seen.kidsGone} (${[...seen.kids.keys()].map((k) =>
    k.class2d.child.kind).join(",")})`);
console.log(`  flag 50 at f${seen.flag50}, despawn at f${seen.despawn}, `
  + `satellites gone at f${seen.satsGone}, walker past the gate at `
  + `f${seen.pastGate} (block ${walker.block} op ${walker.opIndex})`);
check("the boss is placed from block 12", seen.boss !== null);
check("the intro ends in flag 50", seen.flag50 >= 0);
for (const s of [Class2DState.Join, Class2DState.Round1, Class2DState.Round2,
                 Class2DState.Round3, Class2DState.Death]) {
  check(`the fight reaches state ${s} (${Class2DState[s]})`,
        seen.states.has(s));
}
check("round 2 makes a child, and it leaves",
      seen.kids.size > 0 && seen.kidsGone > 0);
check("the death despawns the boss", seen.despawn >= 0);
check("...and its satellites", seen.satsGone >= 0);
check("the walker gets past block 12's wait_enemies_alive 0",
      seen.pastGate >= 0, `block ${walker.block} op ${walker.opIndex}`);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
