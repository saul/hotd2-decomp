/**
 * Does an enemy cross a wall? Drive one script address with the real script,
 * the real collision selection and the real camera path.
 *
 * `node --experimental-strip-types tools/run_test.mjs tools/wall.mjs 2 16 3 13 350`
 *
 * The point of this over `replay.mjs` is that it does **not** invent either of
 * the two things a wall question turns on: it `seek`s the walker to the
 * address so the script's own `set_collision_set_full` has run, and it reads
 * the camera off the path the step is playing rather than putting it a
 * plausible distance away.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { DescriptorFromPlacement } from "../src/game/descriptor.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ColiTraceSegmentAllSets } from "../src/game/coli.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { Walker } from "../src/script/walker.ts";
import { dist2d } from "../src/game/vec.ts";
import { seekTo } from "../src/script/seek";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const [stage = "2", block = "16", step = "3", op = "13", camFrame = "350",
       seconds = "8"] = args;
const root = join(BUNDLE_ROOT, `stage${stage}`);
const script = JSON.parse(readFileSync(join(root, `stage${stage}.script.json`), "utf8"));
const cams = JSON.parse(readFileSync(join(root, `stage${stage}.cam.json`), "utf8"));

const chars = script.characters;
ResetGameGlobals();
SetGameTables(chars, script.breakables, script.set_pieces, script.humanoids,
              script.coli, script.civilians);

// -- the script, walked for real ------------------------------------------
const NOOP = () => undefined;
const w = new Walker(script, {
  enterRegion: NOOP, loadSlot: NOOP, unloadSlot: NOOP,
  startCamera: NOOP, onFeed: NOOP, onBranch: NOOP,
  playSound: NOOP, aliveEnemies: () => null, presentEnemies: () => null,
  aliveCivilians: () => null, cameraFree: () => null, setShutter: NOOP,
  scriptFlagRaised: () => null,
  showMessage: NOOP, endDialogue: NOOP,
});
if (!seekTo(w, Number(block), Number(step), Number(op))) {
  throw new Error(`seek to ${block}/${step}/${op} failed`);
}
console.log(`at ${w.block}/${w.step}/${w.opIndex}  region ${w.region}`);
console.log(`full set: ${G.g_coli_full_set.length ? G.g_coli_full_set.join(", ") : "(empty)"}`);
console.log(`ray set : ${G.g_coli_ray_set.length ? G.g_coli_ray_set.join(", ") : "(empty)"}`);
for (const k of G.g_coli_full_set) {
  const b = script.coli?.blobs?.[k];
  if (b) console.log(`   ${k}: ${b.n} quads  min ${b.min.map((v) => v.toFixed(1))}`
                   + `  max ${b.max.map((v) => v.toFixed(1))}`);
}

// -- the camera, off the path the step is playing --------------------------
function hermite(keys, t) {
  if (!keys?.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0, , o0] = keys[i];
    const [t1, v1, i1] = keys[i + 1];
    if (t < t0 || t > t1) continue;
    const h = t1 - t0;
    if (h === 0) return v0;
    const s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * o0
         + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * i1;
  }
  return keys[keys.length - 1][1];
}
const slot = w.cam?.slot;
const path = slot === undefined ? null : cams.paths[String(slot)];
if (!path) throw new Error(`no camera path for slot ${slot}`);
const f = Number(camFrame);
const eye = { x: hermite(path.channels.eye_x, f), y: hermite(path.channels.eye_y, f),
              z: hermite(path.channels.eye_z, f) };
const aim = { x: hermite(path.channels.target_x, f), y: hermite(path.channels.target_y, f),
              z: hermite(path.channels.target_z, f) };
if (w.useFixedEyeY) { eye.y = w.fixedEyeY; aim.y = w.fixedEyeY; }
G.g_camera_fixed_eye_y = w.groundY ?? eye.y;
G.g_camera_yaw_bams = Math.round(Math.atan2(aim.x - eye.x, aim.z - eye.z)
                                 * 65536 / (Math.PI * 2)) & 0xffff;
console.log(`camera slot ${slot} frame ${f}: eye `
  + `${[eye.x, eye.y, eye.z].map((v) => v.toFixed(1)).join(", ")} -> aim `
  + `${[aim.x, aim.y, aim.z].map((v) => v.toFixed(1)).join(", ")}`);

// -- the spawns the walker has live ----------------------------------------
const placements = new Map(chars.placements.map((p) => [p.at, p]));
const rng = new Rng(1);
const actors = [];
for (const s of w.spawns) {
  const p = placements.get(s.at);
  if (!p || p.motion === null || p.motion === undefined) continue;
  const a = ActorSpawn(s.at, s.class, p.char_type,
                       chars.types[String(p.char_type)]?.name ?? "?",
                       DescriptorFromPlacement(p), rng);
  a.motion = p.motion;
  a.hp = p.hp || 100;
  a.yaw = p.yaw ?? 0;
  a.pos = { x: s.pos[0], y: s.pos[1], z: s.pos[2] };
  a.visible = true;
  actors.push({ a, at: s.at });
}
console.log(`${actors.length} actors live\n`);

// Crossing test: the *selected* set is what the engine consults; the whole
// level is here only to say whether a wall exists there at all.
const selected = [...G.g_coli_full_set];
const everything = Object.keys(script.coli?.blobs ?? {});
function crossed(a, b, set) {
  const save = G.g_coli_full_set;
  G.g_coli_full_set = set;
  const hit = ColiTraceSegmentAllSets(a.x, a.y + 4, a.z, b.x, b.y + 4, b.z)
           || ColiTraceSegmentAllSets(b.x, b.y + 4, b.z, a.x, a.y + 4, a.z);
  G.g_coli_full_set = save;
  return hit;
}

const events = new Events();
const host = {
  ...NULL_HOST,
  viewPoint: (x, y, z, out) => { out.x = eye.x + x; out.y = eye.y + y; out.z = eye.z + z; },
  aimPoint: (ahead, out) => {
    const dx = aim.x - eye.x, dz = aim.z - eye.z;
    const len = Math.hypot(dx, dz) || 1;
    out.x = eye.x + dx / len * ahead; out.y = eye.y; out.z = eye.z + dz / len * ahead;
  },
};

const prev = actors.map(({ a }) => ({ ...a.pos }));
const trace = actors.map(({ a }) => [[a.pos.x, a.pos.y, a.pos.z]]);
const crossings = { selected: 0, level: 0 };
const total = Number(seconds) * 60;
for (let n = 0; n <= total; n++) {
  GameUpdate(eye, 1 / 60, host, rng, events);
  actors.forEach(({ a, at }, i) => {
    if (crossed(prev[i], a.pos, selected)) {
      crossings.selected++;
      console.log(`  f${n} ${at}: crossed a SELECTED quad`);
    } else if (crossed(prev[i], a.pos, everything)) {
      crossings.level++;
      console.log(`  f${n} ${at}: crossed a quad that exists in the level but `
                + `is NOT in the selected set`);
    }
    prev[i] = { ...a.pos };
    trace[i].push([a.pos.x, a.pos.y, a.pos.z]);
  });
  if (n % 60 === 0) {
    for (const { a, at } of actors) {
      console.log(`t=${(n / 60).toFixed(1)}s ${at} `
        + `${ZombieState[a.state] ?? a.state}/${a.sub} `
        + `pos ${[a.pos.x, a.pos.y, a.pos.z].map((v) => v.toFixed(1)).join(", ")} `
        + `d=${dist2d(a.pos, eye).toFixed(1)} yaw=${a.yaw}`);
    }
  }
}
if (process.env.WALL_TRACE) {
  writeFileSync(process.env.WALL_TRACE, JSON.stringify(trace[0] ?? []));
  console.log(`trace -> ${process.env.WALL_TRACE}`);
}
console.log(`\n${crossings.selected} crossings of the selected collision, `
          + `${crossings.level} of walls the level has but the script has not selected`);
