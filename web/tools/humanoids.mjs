/**
 * Where does a scripted actor stop, and why?
 *
 * The symptom B13 reports is a class-0x25 actor standing on one frame of one
 * clip for ever. Three different things produce that and they are different
 * bugs: a program that never starts, a program that ends on a `WaitThenHold`
 * (which is the engine holding a pose on purpose), and a live program whose
 * motion clock nothing advances.
 *
 * This drives the real `Walker` and the real `GameUpdate` with no renderer and
 * prints, per class-0x25 actor and per frame, the command cursor, the freeze
 * flag and the authored frame of the clip — so the three can be told apart.
 *
 * It prints class 0x20 beside it, because the two classes share a removal cue
 * and a stage: a class-0x20 target that vanishes when the camera moves on and
 * one that was never spawned look the same from the outside.
 *
 *     node tools/run_test.mjs tools/humanoids.mjs [stage] [block] [step] [secs]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { authoredFrameOfTicks } from "../src/core/play_cursor.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { DescriptorFromPlacement } from "../src/game/descriptor.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables, T } from "../src/game/tables.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { OneHitTargetState } from "../src/game/class20/state.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const stage = Number(args[0] ?? 2);
const block = Number(args[1] ?? 9);
const step = Number(args[2] ?? 5);
const secs = Number(args[3] ?? 30);

const dir = join(BUNDLE_ROOT, `stage${stage}`);
const script = JSON.parse(readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

ResetGameGlobals();
SetGameTables(chars, script.breakables, script.set_pieces,
              script.humanoids, script.coli, script.civilians);
G.g_players_in_play = 1;
G.g_player_lives = [2, 2];
const rng = new Rng(1);
const events = new Events();
let eye = vec3(0, 6, 0);
const host = { ...NULL_HOST, aliveEnemies: () => G.g_enemies_alive };

const walker = new Walker(script, {
  enterRegion() {}, loadSlot() {}, unloadSlot() {}, startCamera() {},
  onFeed() {}, onBranch() {}, playSound() { return undefined; },
  aliveEnemies: () => G.g_enemies_alive,
  aliveCivilians: () => G.g_civilians_alive,
  cameraFree: () => true,
  showMessage: () => null,
  endDialogue() {},
}, { seed: 1 });

seekTo(walker, block, step, 0);

const made = new Map();
function syncSpawns() {
  for (const s of walker.spawns) {
    if (made.has(s.at)) continue;
    const pl = placementAt.get(s.at);
    if (!pl) continue;
    const d = DescriptorFromPlacement(pl);
    const name = chars.types[String(pl.char_type)]?.name ?? `spawn ${s.at}`;
    const a = ActorSpawn(s.at, s.class ?? pl.class ?? SpawnClass.Zombie,
                         pl.char_type, name, d);
    const pos = s.pos ?? pl.pos ?? [0, 0, 0];
    a.pos = vec3(pos[0], pos[1], pos[2]);
    a.hp = a.maxHp = pl.hp || 100;
    if (pl.motion != null) a.motion = pl.motion;
    a.visible = true;
    made.set(s.at, a);
  }
}

/** The two globals `app/systems.ts` derives from the walker's camera block. */
function syncCam() {
  G.g_active_cam_path = walker.cam ? walker.cam.slot : -1;
  G.g_cam_path_frame = walker.cam ? Math.trunc(walker.cam.frame) : 0;
  G.g_script_flags = [];
  for (const flag of walker.flags) G.g_script_flags[flag] = 1;
}

function clip(a) {
  const m = T.types[String(a.charType)]?.motions[String(a.motion)];
  if (!m) return `motion ${a.motion} NOT BAKED`;
  return `motion ${a.motion} f=${authoredFrameOfTicks(a.playTicks, m.fps, m.frames)}`
       + `/${m.frames} ticks=${a.playTicks}`;
}

function line(a) {
  const p = script.humanoids?.[String(a.at)];
  const cmd = p && a.hum.pc >= 0 ? p.cmds[a.hum.pc] : null;
  return `0x${a.at.toString(16)} ${a.name} pc=${a.hum.pc}`
       + (cmd ? ` op=${cmd.op}/${cmd.mode} a=${cmd.a} b=${cmd.b}` : " (idle)")
       + ` frozen=${a.frozen} stall=${a.hum.stallFrames} ${clip(a)}`
       + ` pos=(${a.pos.x.toFixed(1)},${a.pos.y.toFixed(1)},${a.pos.z.toFixed(1)})`
       + ` dead=${a.dead} vis=${a.visible}`;
}

/** Class 0x20, in its own vocabulary. */
function targetLine(a) {
  const d = a.oneHitTarget;
  return `0x${a.at.toString(16)} ${a.name} class20`
       + ` ${OneHitTargetState[a.tgt.state]} sub=${d?.subtype}`
       + ` ${clip(a)} sink=${a.arcFrames}`
       + ` pos=(${a.pos.x.toFixed(1)},${a.pos.y.toFixed(1)},${a.pos.z.toFixed(1)})`
       + ` yaw=0x${(a.yaw & 0xffff).toString(16)}`
       + ` dead=${a.dead} vis=${a.visible}`;
}

const frames = Math.round(secs * 60);
const last = new Map();
console.log(`stage ${stage} block ${block} step ${step}, ${secs}s\n`);
for (let i = 0; i <= frames; i++) {
  if (i > 0) {
    walker.tick(1 / 60);
    syncSpawns();
    syncCam();
    GameUpdate(eye, 1 / 60, host, rng, events);
  } else {
    syncSpawns();
    syncCam();
  }
  for (const a of G.g_object_list) {
    if (a.cls !== SpawnClass.ScriptedHumanoid
        && a.cls !== SpawnClass.OneHitTarget) continue;
    const now = a.cls === SpawnClass.OneHitTarget ? targetLine(a) : line(a);
    if (last.get(a.at) !== now) {
      console.log(`+${String(i).padStart(5)}f  cam=${G.g_active_cam_path}`
        + `@${G.g_cam_path_frame}  ${now}`);
      last.set(a.at, now);
    }
  }
}
console.log(`\nafter ${frames} frames, walker at `
  + `${walker.block}/${walker.step}/${walker.opIndex}`);
