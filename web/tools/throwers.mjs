/**
 * Do the seven stationary throwers stand still and throw?
 *
 * `ZombieStateStandAndThrow` (`FUN_00459080`) is the only class-0x30 state
 * that never moves the actor: it stands where the script put it, throws the
 * weapon out of one hand and then the other, and only when both are empty does
 * it walk away or leap out. Stage 1's axe man — character type 0x13, whose
 * asset file is literally `tutorial.bin` — is one of the seven.
 *
 * The port had no state 33, so `ZombieEntryState` folded it into `AttackRun`
 * and every one of them charged the camera. This measures both halves of that:
 * how far each one travels while it is throwing, and how many throws it gets
 * out before it leaves.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/throwers.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { vec3 } from "../src/game/vec.ts";

const root = join(process.env.HOME, "hotd2-decomp/extract/player");
/** Far enough that "stood still" and "charged the camera" cannot be confused. */
const EYE = vec3(0, 10, 0);
const SECONDS = 40;

let total = 0, stood = 0, threw = 0, left = 0;
const rows = [];
for (let stage = 1; stage <= 6; stage++) {
  let script;
  try {
    script = JSON.parse(readFileSync(
      join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
  } catch { continue; }
  const chars = script.characters;
  const spawnPos = new Map();
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const sp of op.spawns ?? []) {
          if (!spawnPos.has(sp.at)) spawnPos.set(sp.at, sp);
        }
      }
    }
  }
  const throwers = (chars.placements ?? [])
    .filter((p) => p.class === 0x30 && p.initial_state === 33);
  if (!throwers.length) continue;

  for (const p of throwers) {
    ResetGameGlobals();
    SetGameTables(chars, undefined, undefined, undefined, script.coli);
    G.g_camera_fixed_eye_y = EYE.y;
    // One at a time: the permit queue is the pacing, and two throwers sharing
    // it would measure the queue rather than the state.
    const rng = new Rng(5);
    const a = ActorSpawn(p.at, p.class, p.char_type,
                         chars.types[String(p.char_type)]?.name ?? "?", {
      initialState: p.initial_state, attackState: p.attack_state ?? 0,
      condition: p.body_condition ?? 0, ringSet: p.ring_set ?? 0,
      standThrow: p.stand_throw, walkDistance: p.walk_distance ?? 0,
      delayedLeap: p.delayed_leap ?? null,
    }, rng);
    a.visible = true;
    a.hp = a.maxHp = p.hp || 100;
    a.motion = p.motion ?? 0;
    a.yaw = p.yaw ?? 0;
    const sp = spawnPos.get(p.at);
    a.pos = vec3(sp?.pos[0] ?? 0, sp?.pos[1] ?? 0, sp?.pos[2] ?? 0);
    const start = { ...a.pos };

    const events = new Events();
    let thrown = 0;
    events.on("enemy.threw", () => { thrown += 1; });
    // **Net** displacement, not peak: the throw clips wind up and step back,
    // so `tutorial.bin`'s swings the actor about four units and returns it.
    // Their net root translation is exactly zero, and that is the invariant --
    // the state itself never writes a position at all.
    let peak = 0;
    let drift = 0;
    let leftBy = null;
    let lastIn = { ...a.pos };
    for (let i = 0; i < SECONDS * 60; i++) {
      GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
      if (process.env.TRACE && String(p.at) === process.env.TRACE && i % 30 === 0) {
        console.log(`   f${i} ${ZombieState[a.state]}/${a.sub} `
          + `pos ${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)} motion=${a.motion} `
          + `clock=${a.clock.toFixed(2)} rootFrame=${a.rootFrame}`);
      }
      if (a.state === ZombieState.StandAndThrow) {
        peak = Math.max(peak, Math.hypot(a.pos.x - start.x, a.pos.z - start.z));
        lastIn = { ...a.pos };
      } else if (leftBy === null) {
        drift = Math.hypot(lastIn.x - start.x, lastIn.z - start.z);
        leftBy = ZombieState[a.state] ?? a.state;
      }
    }
    total += 1;
    // "Stood still" is the whole point: while it is in the state, it must not
    // have moved. Anything above a unit is the clip's root motion carrying it.
    if (leftBy === null) drift = Math.hypot(lastIn.x - start.x, lastIn.z - start.z);
    if (drift < 1) stood += 1;
    if (thrown >= 1) threw += 1;
    if (leftBy !== null) left += 1;
    rows.push(`  stage ${stage} ${p.at} (ct ${p.char_type}, `
      + `${chars.types[String(p.char_type)]?.file}): net `
      + `${drift.toFixed(2)}u (clip swing ${peak.toFixed(2)}u), threw `
      + `${thrown}, left by ${leftBy ?? "—"}`);
  }
}

for (const r of rows) console.log(r);
console.log(`\n${total} stationary throwers: ${stood} never moved, `
          + `${threw} threw at least once, ${left} left when they were done`);
if (!total) {
  console.log("\nFAIL  no state-33 spawn in the bundle -- re-export it");
  process.exit(1);
}
if (stood !== total || threw !== total) {
  console.log("\nFAIL  a stationary thrower must stand still and throw");
  process.exit(1);
}
console.log("\nclean -- every one stands where the script put it and throws");
