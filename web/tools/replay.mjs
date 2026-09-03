/**
 * Drive the port over a real stage bundle, headless.
 *
 * `npm run replay -- 2 3 1` runs stage 2 block 3 step 1's spawns through
 * `GameUpdate` and prints what each actor is doing, using the same
 * `block/step/n` labels the debug boxes show — so a report like "3/1/2 is
 * stuck in WaitTurn" can be reproduced here in a second instead of guessed at.
 *
 * The synthetic test in `test/port.test.ts` guards the state machine against
 * data written by hand. This guards it against the data the game ships.
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
import { SpawnClass } from "../src/game/spawn_class.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { ThrowerState } from "../src/game/class31/states.ts";
import { dist2d } from "../src/game/vec.ts";

// Run through `tools/run_test.mjs`, which bundles with esbuild -- node's own
// type stripping cannot do enums. That leaves this script's own path in argv,
// so take the arguments that are not paths.
const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const [stage = "2", block = "3", step = "1", seconds = "10",
       every = "120"] = args;
const root = join(BUNDLE_ROOT, `stage${stage}`);
const script = JSON.parse(readFileSync(join(root, `stage${stage}.script.json`), "utf8"));

const chars = script.characters;
ResetGameGlobals();
SetGameTables(chars, undefined, undefined, undefined, script.coli,
              script.civilians);
// The script's own opcode 0x10 / 0x11 selections are what make a set active.
// Replaying one step in isolation never runs them, so every blob the whole
// stage ever selects goes into the full set: the level as the collision sees
// it, which is what the wall search wants to ask about.
{
  const keys = new Set();
  for (const b of script.blocks ?? []) {
    for (const s of b.steps ?? []) {
      for (const op of s.ops ?? []) {
        for (const m of op.meshes ?? []) {
          if (m.file !== undefined) keys.add(`${m.file}:${m.offset}`);
        }
      }
    }
  }
  G.g_coli_full_set = [...keys];
}
const placements = new Map(chars.placements.map((p) => [p.at, p]));

// The spawns of one step, in the order the debug labels number them.
// `step` may be a number, or "all" for every spawn in the block -- which is
// what the real player has live once a few steps have run, and rank pressure
// from those is the thing a single step cannot reproduce.
const b = script.blocks.find((x) => x.index === Number(block));
const spawns = [];
const steps = step === "all"
  ? b.steps.map((_, i) => i) : [Number(step)];
for (const si of steps) {
  for (const op of b.steps[si].ops) {
    for (const s of op.spawns ?? []) spawns.push({ ...s, step: si });
  }
}

const eye = { x: 0, y: 0, z: 0 };
const actors = [];
spawns.forEach((s, n) => {
  const p = placements.get(s.at);
  if (!p || p.motion === null) return;
  const a = ActorSpawn(s.at, s.class, p.char_type,
                       chars.types[String(p.char_type)]?.name ?? "?",
                       DescriptorFromPlacement(p));
  a.pos = { x: s.pos[0], y: s.pos[1], z: s.pos[2] };
  a.hp = p.hp || 100;
  a.motion = p.motion;
  a.visible = false;                    // the renderer turns it on next frame
  actors.push({ a, id: `${block}/${s.step ?? step}/${n}` });
});

// The camera. The bundle has no camera state here, so put it a sensible way
// off along the spawns' own average heading -- enough to exercise the approach.
const cx = actors.reduce((t, x) => t + x.a.pos.x, 0) / actors.length;
const cz = actors.reduce((t, x) => t + x.a.pos.z, 0) / actors.length;
eye.x = cx;
eye.y = actors[0]?.a.pos.y ?? 0;
eye.z = cz + 90;

const name = (a) => a.cls === SpawnClass.Zombie
  ? `${ZombieState[a.state] ?? a.state}/${a.sub}`
  : a.cls === SpawnClass.Thrower
    ? `${ThrowerState[a.state] ?? a.state}/${a.sub}`
    : `state ${a.state}`;

// A camera that looks straight down -Z from `eye`, which is where this
// harness puts it. The leap states unproject through the host, so with
// `NULL_HOST` they have nowhere to aim; this is the smallest host that makes
// them answerable. It reports no collision, which is the engine's own
// "there is no wall there" and leaves the surface leaps refused.
const host = {
  ...NULL_HOST,
  viewPoint: (x, y, z, out) => {
    out.x = eye.x + x; out.y = eye.y + y; out.z = eye.z + z;
  },
  aimPoint: (ahead, out) => {
    out.x = eye.x; out.y = eye.y; out.z = eye.z - ahead;
  },
};
// ...and the yaw that matches it: looking down -Z is 0x8000 in BAMS.
G.g_camera_yaw_bams = 0x8000;
G.g_camera_fixed_eye_y = eye.y;

const rng = new Rng(1);
const events = new Events();
let hits = 0;
events.on("player.damaged", () => hits++);

console.log(`stage ${stage} block ${block} step ${step}: ${actors.length} actors, `
          + `camera ${Math.round(eye.z - cz)} units out\n`);
const total = Number(seconds) * 60;
for (let f = 0; f <= total; f++) {
  if (f % Number(every) === 0) {
    console.log(`t=${(f / 60).toFixed(1)}s`);
    for (const { a, id } of actors) {
      console.log(`  ${id} 0x${a.at.toString(16).toUpperCase()} `
        + `${(SpawnClass[a.cls] ?? a.cls).toString().padEnd(8)} `
        + `${name(a).padEnd(18)} d=${dist2d(a.pos, eye).toFixed(1).padStart(6)} `
        + `rank=${String(a.rank).padStart(3)} allow=${a.allowance} `
        + `permit=${a.attackPermit} motion=${a.motion}`);
    }
  }
  GameUpdate(eye, 1 / 60, host, rng, events);
  for (const { a } of actors) a.visible = !a.dead;   // what the renderer does
}
console.log(`\n${hits} hits on the player over ${seconds}s`);
