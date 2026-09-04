/**
 * What does the Kill button actually leave behind?
 *
 * The symptom: after pressing it the enemies row reads
 * `1 attacking · 0 live · 1 scripted` — a permit still held, no live enemy to
 * hold it, and one actor the row does not count as an enemy. Any of three
 * things produces that, and they need telling apart:
 *
 *  * an actor `ActorKillAll` skipped, because it tests `!obj.visible`;
 *  * an actor killed but never swept, so `ReleaseAttackSlot` never ran;
 *  * a permit whose owner has left `g_object_list` entirely, which no sweep
 *    can reach because the sweep walks that list.
 *
 * This drives the real spawn path and the real `GameUpdate`, then prints the
 * permit array beside the actor it names.
 *
 *     node tools/run_test.mjs tools/killall.mjs [stage] [block] [step] [secs]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { ActorKillAll } from "../src/game/combat/resolve_hit.ts";
import { DescriptorFromPlacement } from "../src/game/descriptor.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ActorIsEnemy } from "../src/game/registry.ts";
import { TryClaimAttackSlot } from "../src/game/combat/permits.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const stage = Number(args[0] ?? 2);
const block = Number(args[1] ?? 3);
const step = Number(args[2] ?? 4);
const secs = Number(args[3] ?? 8);

const dir = join(BUNDLE_ROOT, `stage${stage}`);
const script = JSON.parse(readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

ResetGameGlobals();
SetGameTables(chars, undefined, undefined, undefined, script.coli,
              script.civilians);
G.g_players_in_play = 1;
G.g_player_lives = [2, 2];
const rng = new Rng(1);
const events = new Events();

// A camera to measure against, in the engine's own view convention: **-Z in
// front**, +Y up, `viewPoint` the exact inverse of `viewSpaceOf`. Class 0x30
// state 9 and class 0x31's knockback both build their landing point in the
// camera's own matrix, so with `NULL_HOST` alone every thrown body would fall
// straight down and this tool could not tell that apart from a body that was
// never thrown. `eye` is set below, so this reads it lazily.
const host = {
  ...NULL_HOST,
  aliveEnemies: () => G.g_enemies_alive,
  viewSpaceOf: (at, out) => {
    const a = G.g_object_list.find((o) => o.at === at);
    if (!a) return false;
    // The engine's `obj+0x100` is a *posed bone*, written by the skeleton walk
    // — so headlessly it is (0,0,0) and using it would aim every throw at the
    // world origin. The actor's own origin is the honest stand-in here; the
    // real player answers this from three.js.
    out.x = a.pos.x - eye.x;
    out.y = a.pos.y - eye.y;
    out.z = -(a.pos.z - eye.z);
    return true;
  },
  viewPoint: (x, y, z, out) => {
    out.x = eye.x + x;
    out.y = eye.y + y;
    out.z = eye.z - z;
  },
};

const walker = new Walker(script, {
  enterRegion() {}, loadSlot() {}, unloadSlot() {}, startCamera() {},
  onFeed() {}, onBranch() {}, playSound() { return undefined; },
  aliveEnemies: () => G.g_enemies_alive,
  aliveCivilians: () => G.g_civilians_alive,
  cameraFree: () => true,
  showMessage: () => null,
  endDialogue() {},
}, { seed: 1 });

seekTo(walker, block, step, 1);

// Make every spawn the walker is holding, the way the character layer does.
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

// Park the eye on the first enemy, or nothing ever closes to attack range and
// no permit is ever claimed -- which is the state this is trying to reach.
let eye = vec3(0, 6, 0);
{
  const first = G.g_object_list.find((o) => ActorIsEnemy(o.cls));
  if (first) eye = vec3(first.pos.x, first.pos.y + 6, first.pos.z + 12);
}
const frames = Math.round(secs * 60);
// Kill at the moment a permit is actually held -- that is the user's case,
// and killing at an arbitrary frame does not reproduce it.
let killedAt = -1;
for (let i = 0; i < frames; i++) {
  walker.tick(1 / 60);
  syncSpawns();
  GameUpdate(eye, 1 / 60, host, rng, events);
  if (killedAt < 0 && G.g_attack_permits.some((x) => x !== -1)) killedAt = i;
  if (killedAt >= 0 && i >= killedAt) break;
}
if (killedAt < 0) {
  // Force one. The release path is what is under test, and whether this
  // particular scene reaches an attack is a separate question.
  const e = G.g_object_list.find((o) => ActorIsEnemy(o.cls) && !o.dead);
  if (e && TryClaimAttackSlot(e, host)) {
    console.log(`no permit was held in ${frames} frames;`
      + ` forced one onto 0x${e.at.toString(16)} to test the release`);
  } else {
    console.log(`no permit held and none could be claimed`);
  }
} else {
  console.log(`a permit is held at frame ${killedAt}; killing there`);
}

function permitOwners() {
  return G.g_attack_permits.map((at, i) => {
    if (at === -1) return `  [${i}] free`;
    const o = G.g_object_list.find((x) => x.at === at);
    if (!o) return `  [${i}] at 0x${at.toString(16)} — **NOT IN g_object_list**`;
    return `  [${i}] at 0x${at.toString(16)} cls 0x${o.cls.toString(16)}`
         + ` dead=${o.dead} visible=${o.visible}`
         + ` enemy=${ActorIsEnemy(o.cls)} permit=${o.attackPermit}`;
  }).join("\n");
}

function row() {
  const actors = G.g_object_list.filter((o) => !o.dead && o.visible);
  const live = actors.filter((o) => ActorIsEnemy(o.cls)).length;
  const held = G.g_attack_permits.filter((p) => p !== -1).length;
  return `${held} attacking · ${live} live`
       + (actors.length > live ? ` · ${actors.length - live} scripted` : "");
}

console.log(`stage ${stage} block ${block} step ${step}, ${secs}s in`);
console.log("pool:", G.g_object_list.length, "actors,",
            G.g_object_list.filter((o) => ActorIsEnemy(o.cls)).length, "enemies");
console.log("before:", row(),
  `| alive=${G.g_enemies_alive} present=${G.g_enemies_present}`);
for (const o of G.g_object_list) {
  console.log(`  at 0x${o.at.toString(16)} cls 0x${o.cls.toString(16)}`
    + ` "${o.name}" flags38=0x${(o.flags38 >>> 0).toString(16)}`
    + ` dead=${o.dead} vis=${o.visible} state=${o.state}`);
}
console.log(permitOwners());

const n = ActorKillAll(0, rng);
console.log(`\nActorKillAll -> ${n.enemies} enemies, ${n.civilians} civilians`);

// Both enemy classes die through a **chain of states** and retire the counts
// from inside it, not from the sweep -- so one frame proves nothing. Run the
// chain out, and record every state each actor passes through: a body that
// never reaches its corpse state, and one that reaches it and never leaves,
// look identical in the counters and are different bugs.
const after = 900;
const trail = new Map();   // at -> ["6/0@+1", ...]
const gone = new Map();    // at -> the frame it left g_object_list
const stood = new Map();   // at -> where the body was when the chain began
const thrown = new Map();  // at -> how far it got from there
function trace(frame) {
  for (const o of G.g_object_list) {
    if (!ActorIsEnemy(o.cls)) continue;
    // How far the death chain actually carried the body. Class 0x30 state 9
    // and class 0x31 state 2 throw it; state 6 does not, and the difference
    // between "0.0 units" and "7.2 units" is the whole of what D2 changed.
    if (!stood.has(o.at)) stood.set(o.at, [o.pos.x, o.pos.z]);
    const [sx, sz] = stood.get(o.at);
    const d = Math.hypot(o.pos.x - sx, o.pos.z - sz);
    if (d > (thrown.get(o.at) ?? 0)) thrown.set(o.at, d);
    const seen = trail.get(o.at) ?? [];
    const now = `${o.state}/${o.sub}`;
    if (!seen.length || !seen[seen.length - 1].startsWith(`${now}@`)) {
      seen.push(`${now}@+${frame}f`);
    }
    trail.set(o.at, seen);
  }
  for (const at of trail.keys()) {
    if (gone.has(at)) continue;
    if (!G.g_object_list.some((o) => o.at === at)) gone.set(at, frame);
  }
}
trace(0);
for (let i = 0; i < after; i++) {
  walker.tick(1 / 60);
  GameUpdate(eye, 1 / 60, host, rng, events);
  trace(i + 1);
  if (i === 0 || i === 59 || i === 299 || i === after - 1) {
    console.log(`  +${i + 1}f: ${row()}`
      + ` | alive=${G.g_enemies_alive} present=${G.g_enemies_present}`
      + ` states=[${G.g_object_list.map((o) => `${o.cls.toString(16)}:${o.state}/${o.sub}`).join(" ")}]`);
  }
}

console.log("\nthe death chain, state/sub per enemy:");
for (const [at, seen] of trail) {
  const left = gone.has(at) ? `left the pool at +${gone.get(at)}f`
                            : "**still in the pool**";
  const moved = (thrown.get(at) ?? 0).toFixed(1);
  console.log(`  0x${at.toString(16)}: ${seen.join(" -> ")}`
    + `  (${left}, thrown ${moved} units)`);
}

console.log(`after ${after} frames:`, row());
for (const o of G.g_object_list) {
  console.log(`  at 0x${o.at.toString(16)} cls 0x${o.cls.toString(16)}`
    + ` flags38=0x${(o.flags38 >>> 0).toString(16)}`
    + ` dead=${o.dead} vis=${o.visible}`);
}
console.log(permitOwners());

const stuck = G.g_object_list.filter((o) => !o.dead && o.visible);
if (stuck.length) {
  console.log("\nstill alive and drawn:");
  for (const o of stuck) {
    console.log(`  at 0x${o.at.toString(16)} cls 0x${o.cls.toString(16)}`
      + ` "${o.name}" enemy=${ActorIsEnemy(o.cls)} hp=${o.hp}`
      + ` state=${o.state} permit=${o.attackPermit}`);
  }
}
console.log(`\ncounters: alive=${G.g_enemies_alive} present=${G.g_enemies_present}`
            + ` civ=${G.g_civilians_alive} committed=${G.g_attack_committed}`);
