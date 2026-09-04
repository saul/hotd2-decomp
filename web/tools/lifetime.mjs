/**
 * How many times does one spawn's class `Init` actually run?
 *
 * **Once.** `SpawnFromDescriptor` (`FUN_00408A20`) builds the object when the
 * spawn opcode executes and calls the class `Init` there and exactly once. An
 * actor that is built a second time restarts its state machine from its
 * descriptor's entry state, which for a scripted entrance means playing the
 * entrance again — a zombie that emerges out of the water over and over, or a
 * leap that starts its arc from the top after it has already landed.
 *
 * Every other harness here spawns the actor by hand and drives `GameUpdate`.
 * That is the state machine, and it is not the **object lifetime**: in the
 * player an actor exists because `Walker.spawns` lists it and
 * `CharacterLayer.syncSpawns` has made it, and it stops existing when it drops
 * off that list. Two bugs got through the other harnesses by living in exactly
 * that gap, so this one drives the real `Walker` and mirrors `syncSpawns`'
 * own bookkeeping — `pending` / `live`, release back to `pending`, remake when
 * it returns — with no renderer attached.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/lifetime.mjs \
 *          [stage] [block] [step] [seconds]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { ActorDespawn } from "../src/game/despawn.ts";
import { DescriptorFromPlacement } from "../src/game/descriptor.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const [stage = "2", block = "9", step = "4", seconds = "30"] = args;
const root = BUNDLE_ROOT;
const script = JSON.parse(readFileSync(
  join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
const chars = script.characters;
const places = new Map(chars.placements.map((p) => [p.at, p]));

// Where the glTF would have put each spawn -- `CharacterLayer` takes the node
// position as `home`, and the script's spawn record is that same point.
const home = new Map();
for (const b of script.blocks ?? []) {
  for (const st of b.steps ?? []) {
    for (const op of st.ops ?? []) {
      for (const sp of op.spawns ?? []) {
        if (!home.has(sp.at)) home.set(sp.at, sp);
      }
    }
  }
}

ResetGameGlobals();
SetGameTables(chars, undefined, undefined, undefined, script.coli,
              script.civilians);
G.g_players_in_play = 1;
G.g_player_lives = [2, 2];

const NOOP = () => undefined;
const walker = new Walker(script, {
  enterRegion: NOOP, loadSlot: NOOP, unloadSlot: NOOP,
  startCamera: NOOP, onFeed: NOOP, onBranch: NOOP,
  playSound: NOOP, aliveEnemies: () => liveEnemies(),
  presentEnemies: () => G.g_enemies_present, aliveCivilians: () => null,
  cameraFree: () => null, setShutter: NOOP, showMessage: NOOP,
  endDialogue: NOOP,
});

const rng = new Rng(7);
const events = new Events();

/** `CharacterLayer`'s `pending` / `live`, without the nodes. */
const live = new Map();          // at -> Actor
const inits = new Map();         // at -> how many times it has been built
const released = new Map();      // at -> how many times it has been unmade
/** `CharacterLayer.spent`: it removed itself, so its opcode must run again. */
const spent = new Set();
/**
 * How many times each actor has **re-entered** its own entrance state.
 *
 * An entrance runs once. A second entry means something put the state back --
 * a second `Init`, a state that routes to itself, or a fallthrough -- and on
 * screen it reads as a zombie that emerges out of the water over and over.
 */
const entries = new Map();       // at -> re-entries
const wasIn = new Map();         // at -> was it in its entrance state last frame

function liveEnemies() {
  return [...live.values()].filter((a) => !a.dead && a.visible).length;
}

/** `CharacterLayer.syncSpawns`, transcribed. */
function syncSpawns(spawns) {
  const want = new Set();
  for (const s of spawns) {
    if (places.has(s.at) && home.has(s.at)) want.add(s.at);
  }
  for (const at of want) {
    if (live.has(at) || spent.has(at)) continue;
    const p = places.get(at);
    const sp = home.get(at);
    const a = ActorSpawn(at, sp.class, p.char_type,
                         chars.types[String(p.char_type)]?.name ?? "?",
                         { ...DescriptorFromPlacement(p),
                           motion: p.motion ?? 0,
                           hp: p.hp || 100, maxHp: p.hp || 100,
                           yaw: p.yaw ?? 0,
                           pos: { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] },
                           visible: true },
                         rng);
    live.set(at, a);
    inits.set(at, (inits.get(at) ?? 0) + 1);
    entries.set(at, 0);
    wasIn.set(at, true);          // it starts in its entrance state
  }
  for (const [at, a] of [...live.entries()]) {
    if (want.has(at) && !a.despawned) continue;
    if (a.despawned) spent.add(at);
    a.visible = false;
    if (!a.despawned) ActorDespawn(a);
    live.delete(at);
    released.set(at, (released.get(at) ?? 0) + 1);
  }
  for (const at of spent) if (!want.has(at)) spent.delete(at);
}

const op = Number(process.env.OP ?? 0);
if (!seekTo(walker, Number(block), Number(step), op)) {
  console.log(`could not seek to block ${block} step ${step}`);
  process.exit(1);
}
console.log(`stage ${stage}, seeked to block ${block} step ${step}\n`);

const eye = vec3(0, 0, 0);
let minAlive = 0, minPresent = 0, maxAlive = 0;
const total = Number(seconds) * 60;
/**
 * `KILL=<seconds>` shoots the room clean at that moment.
 *
 * This is the invariant the counters exist for: a block parked on
 * `wait_enemies_alive` -- 434 of the 488 enemy gates -- may only advance once
 * the count reaches zero. If a release is missing the count never falls and
 * the script sits there for ever; that is invisible while the counts are
 * derived from the pool, and it is the whole risk of stepping them instead.
 */
const killAt = process.env.KILL ? Number(process.env.KILL) * 60 : -1;
const startedAt = { block: walker.block, step: walker.step };
let clearedAt = -1;
for (let f = 0; f < total; f++) {
  if (f === killAt) {
    // Not `despawned`: the engine's own kill is hit points reaching zero, and
    // the release paths hang off that.
    for (const a of live.values()) { a.hp = 0; a.dead = true; }
  }
  walker.tick(1 / 60);
  // What `syncPortGlobals` pushes and the combat code reads: without it
  // `IsPlayerAttackable` refuses and the scripted attackers never strike.
  G.g_scene_state_major_entered = walker.sceneState.major;
  syncSpawns(walker.spawns);
  eye.y = walker.groundY ?? 0;
  G.g_camera_fixed_eye_y = eye.y;
  GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
  // **The counters are the gates.** They are stepped now, not derived, so a
  // missing release parks the script on a `wait_enemies_alive` for ever and a
  // double release takes the count negative and opens one early. Both show up
  // here and nowhere else.
  minAlive = Math.min(minAlive, G.g_enemies_alive);
  minPresent = Math.min(minPresent, G.g_enemies_present);
  maxAlive = Math.max(maxAlive, G.g_enemies_alive);
  if (clearedAt < 0 && killAt >= 0 && f > killAt && G.g_enemies_alive === 0) {
    clearedAt = f;
  }
  for (const [at, a] of live) {
    const init = places.get(at)?.initial_state;
    const inIt = a.state === init;
    if (inIt && !wasIn.get(at)) entries.set(at, (entries.get(at) ?? 0) + 1);
    wasIn.set(at, inIt);
  }
  if (process.env.TRACE) {
    const a = live.get(parseInt(process.env.TRACE, 16));
    if (a && f % 5 === 0) {
      console.log(`   f${String(f).padStart(4)} `
        + `${ZombieState[a.state] ?? a.state}/${a.sub} motion=${a.motion} `
        + `ticks=${a.playTicks} y=${a.pos.y.toFixed(2)} `
        + `hp=${a.hp} frozen=${a.frozen} vis=${a.visible}`);
    }
  }
}

const rows = [...inits.entries()]
  .map(([at, n]) => ({ at, n, out: released.get(at) ?? 0,
                       back: entries.get(at) ?? 0, p: places.get(at) }))
  .sort((a, b) => b.n - a.n || a.at - b.at);

console.log(`${rows.length} spawns were built over ${seconds}s\n`);
let rebuilt = 0;
for (const r of rows) {
  const again = r.n > 1 || r.back > 0;
  if (again) rebuilt += 1;
  if (!again && !process.env.ALL) continue;
  console.log(`  ${again ? "FAIL" : "ok  "} 0x${r.at.toString(16).toUpperCase()}`
    + ` class ${r.p?.class ?? "?"} state `
    + `${ZombieState[r.p?.initial_state] ?? r.p?.initial_state}`
    + `  built ${r.n}x, unmade ${r.out}x, re-entered ${r.back}x`);
}

console.log(`\n${rows.length - rebuilt} of ${rows.length} were built once and `
          + `entered their entrance once`);
console.log(`enemies alive: peak ${maxAlive}, floor ${minAlive}; `
          + `present floor ${minPresent}; `
          + `final ${G.g_enemies_alive} alive / ${G.g_enemies_present} present`);
if (killAt >= 0) {
  const moved = walker.block !== startedAt.block || walker.step !== startedAt.step;
  console.log(`killed at ${killAt / 60}s: alive reached 0 `
    + `${clearedAt < 0 ? "NEVER" : `after ${((clearedAt - killAt) / 60).toFixed(2)}s`}`
    + `, walker ${moved ? `advanced to ${walker.block}/${walker.step}`
                        : `still parked at ${startedAt.block}/${startedAt.step}`}`);
  if (clearedAt < 0) {
    console.log("FAIL: every enemy is dead and the alive count did not reach "
              + "zero -- a release is missing and the gate can never open");
    process.exitCode = 1;
  }
}
if (minAlive < 0 || minPresent < 0) {
  console.log("FAIL: a counter went negative -- something released twice "
            + "without its latch, and an enemy gate will open early");
  process.exitCode = 1;
}
if (rebuilt) {
  console.log("FAIL: an actor built twice runs its class `Init` twice, and an "
            + "entrance state entered twice replays its entrance -- see "
            + "`SpawnFromDescriptor`");
  process.exitCode = 1;
} else {
  console.log("clean -- every spawn's Init ran once, as the engine's does");
}
