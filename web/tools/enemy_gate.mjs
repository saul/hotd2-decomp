/**
 * Does the room-clear gate actually hold?
 *
 * `wait_enemies_present` (0x43) and `wait_enemies_alive` (0x44) are the
 * script's only way of saying "nobody moves until these are dead", and two bug
 * reports say they do not hold: the camera advances while the zombies are
 * still dropping in.
 *
 * This drives the real `Walker` and the real `GameUpdate` in the order
 * `app/main.ts` runs them -- `walker.tick()`, then the character layer's spawn
 * sync, then `GameUpdate()` -- and prints, on every frame the line changes:
 *
 *     block/step/op   the opcode   both counters   every enemy's state/sub
 *
 * so the frame the gate releases can be read against the actors that were
 * supposed to be holding it.
 *
 * `KILL=<frame>` shoots the room clean at that frame, which is the other half
 * of the question: a gate that holds and never opens is the same bug pointing
 * the other way.
 *
 *     node tools/run_test.mjs tools/enemy_gate.mjs [stage] [block] [step] [op] [frames]
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
import { ActorIsEnemy } from "../src/game/registry.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const stage = Number(args[0] ?? 1);
const block = Number(args[1] ?? 4);
const step = Number(args[2] ?? 5);
const opIndex = Number(args[3] ?? 0);
const frames = Number(args[4] ?? 240);

const dir = join(BUNDLE_ROOT, `stage${stage}`);
const script = JSON.parse(
  readFileSync(join(dir, `stage${stage}.script.json`), "utf8"));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

ResetGameGlobals();
SetGameTables(chars, undefined, undefined, undefined, script.coli,
              script.civilians);
G.g_players_in_play = 1;
G.g_player_lives = [2, 2];
const rng = new Rng(1);
const events = new Events();
const eye = vec3(0, 6, 0);
const host = { ...NULL_HOST, aliveEnemies: () => G.g_enemies_alive };

const walker = new Walker(script, {
  enterRegion() {}, loadSlot() {}, unloadSlot() {}, startCamera() {},
  onFeed() {}, onBranch() {}, playSound() { return undefined; },
  aliveEnemies: () => G.g_enemies_alive,
  presentEnemies: () => G.g_enemies_present,
  aliveCivilians: () => G.g_civilians_alive,
  scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
  cameraFree: () => true,
  showMessage: () => null,
  endDialogue() {},
}, { seed: 1 });

seekTo(walker, block, step, opIndex);

// The character layer, headless: `app/main.ts` calls `syncCharacterSpawns`
// between `walker.tick()` and `GameUpdate()`, so this sits in the same place.
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

function opName() {
  const op = walker.currentOp;
  return op ? `0x${op.op.toString(16)} ${op.name ?? ""}` : "-";
}
function actors() {
  return G.g_object_list
    .filter((o) => ActorIsEnemy(o.cls))
    .map((o) => `0x${o.at.toString(16)}:c${o.cls.toString(16)}`
      + `:${o.state}/${o.sub}${o.dead ? "!" : ""}`
      + `@y${o.pos.y.toFixed(0)}`)
    .join(" ");
}

console.log(`stage ${stage} block ${block} step ${step} op ${opIndex}`);
const killAt = process.env.KILL ? Number(process.env.KILL) : -1;
let prev = "";
for (let i = 0; i <= frames; i++) {
  if (i === killAt) {
    // Hit points to zero, not `despawned`: the engine's kill is hp reaching
    // zero and every release hangs off that.
    for (const o of G.g_object_list) {
      if (!ActorIsEnemy(o.cls)) continue;
      o.hp = 0;
      o.dead = true;
    }
    console.log(`  +${String(i).padStart(4)}f -- killed every enemy`);
  }
  const line = `b${walker.block}/s${walker.step}/o${walker.opIndex}`.padEnd(12)
    + ` ${opName().padEnd(26)}`
    + ` alive=${G.g_enemies_alive} present=${G.g_enemies_present}`
    + ` wait=${walker.wait ? `0x${walker.wait.op.op.toString(16)}` : "-"}`
    + `  [${actors()}]`;
  if (line !== prev) console.log(`  +${String(i).padStart(4)}f ${line}`);
  prev = line;
  walker.tick(1 / 60);
  syncSpawns();
  GameUpdate(eye, 1 / 60, host, rng, events);
}
