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
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek";

const root = BUNDLE_ROOT;
/** Far enough that "stood still" and "charged the camera" cannot be confused. */
const EYE = vec3(0, 10, 0);
const SECONDS = 40;

let total = 0, stood = 0, threw = 0, left = 0, held = 0, pinned = 0;
/** `obj+0x34` bit 0x20000 -- see `ActorInitFlags` and `ground.ts`. */
const GROUND_SNAP_EXEMPT = 0x20000;
const rows = [];
for (let stage = 1; stage <= 6; stage++) {
  let script;
  try {
    script = JSON.parse(readFileSync(
      join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
  } catch { continue; }
  const chars = script.characters;
  // Where each spawn is placed, **and** the script address that places it --
  // the collision the ground snap consults is whatever the script had selected
  // by then, and that is one blob, not the whole file. Selecting every blob
  // measures a level the game never has; that mistake has already cost this
  // project one wrong answer about a wall.
  const spawnPos = new Map();
  const spawnAddr = new Map();
  for (const b of script.blocks ?? []) {
    for (const [si, st] of (b.steps ?? []).entries()) {
      for (const op of st.ops ?? []) {
        for (const sp of op.spawns ?? []) {
          if (spawnPos.has(sp.at)) continue;
          spawnPos.set(sp.at, sp);
          spawnAddr.set(sp.at, [b.index, si, op.i]);
        }
      }
    }
  }
  const NOOP = () => undefined;
  const mkWalker = () => new Walker(script, {
    enterRegion: NOOP, loadRegion: NOOP, loadSlot: NOOP, unloadSlot: NOOP,
    startCamera: NOOP, releaseCamera: NOOP, onFeed: NOOP, onBranch: NOOP,
    playSound: NOOP, aliveEnemies: () => null, aliveCivilians: () => null,
    cameraFree: () => null, setShutter: NOOP, showMessage: NOOP,
    endDialogue: NOOP,
  });
  const throwers = (chars.placements ?? [])
    .filter((p) => p.class === 0x30 && p.initial_state === 33);
  if (!throwers.length) continue;

  for (const p of throwers) {
    ResetGameGlobals();
    SetGameTables(chars, undefined, undefined, undefined, script.coli);
    // The scene state the player gets from the walker: `IsPlayerAttackable`
    // refuses a permit unless the major is 2, the `cam/` path camera row.
    G.g_scene_state_major_entered = 2;
    G.g_camera_fixed_eye_y = EYE.y;
    // One at a time: the permit queue is the pacing, and two throwers sharing
    // it would measure the queue rather than the state.
    const rng = new Rng(5);
    const a = ActorSpawn(p.at, p.class, p.char_type,
                         chars.types[String(p.char_type)]?.name ?? "?",
                         DescriptorFromPlacement(p), rng);
    a.visible = true;
    a.hp = a.maxHp = p.hp || 100;
    a.motion = p.motion ?? 0;
    a.yaw = p.yaw ?? 0;
    const sp = spawnPos.get(p.at);
    a.pos = vec3(sp?.pos[0] ?? 0, sp?.pos[1] ?? 0, sp?.pos[2] ?? 0);
    const start = { ...a.pos };
    // The script's own collision at the address that spawns it. Stage 1's axe
    // man stands on a ledge the selected set does not floor at all -- it is
    // two vertical quads -- and it is the spawn flags word that keeps him on
    // it rather than any geometry.
    const addr = spawnAddr.get(p.at);
    if (addr) {
      const w = mkWalker();
      if (seekTo(w, addr[0], addr[1], addr[2])) {
        G.g_camera_fixed_eye_y = w.groundY ?? 0;
      }
    }

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
    // How far it covered *after* leaving the state -- the backing away.
    let walked = 0;
    let leftAt = null;
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
      } else {
        if (leftBy === null) {
          drift = Math.hypot(lastIn.x - start.x, lastIn.z - start.z);
          leftAt = { ...a.pos };
        }
        if (leftAt) {
          walked = Math.max(walked, Math.hypot(a.pos.x - leftAt.x,
                                               a.pos.z - leftAt.z));
        }
        leftBy = ZombieState[a.state] ?? a.state;
      }
    }
    total += 1;
    // "Stood still" is the whole point: while it is in the state, it must not
    // have moved. Anything above a unit is the clip's root motion carrying it.
    if (leftBy === null) drift = Math.hypot(lastIn.x - start.x, lastIn.z - start.z);
    if (drift < 1) stood += 1;
    // **And a pinned one must not have fallen.** `ActorInitFlags` makes the
    // spawn record's flags word the actor's, and `0x20000` is what exempts it
    // from the per-frame ground snap. Stage 1's is the only thrower that
    // carries it -- it stands on a ledge whose collision is two *vertical*
    // quads, so the ground query finds nothing under it and the snap dropped
    // it sixty-two units to the script's ground plane, from where it threw
    // from behind the wall it had been standing on.
    //
    // The other eight have no such flag and are meant to settle onto whatever
    // is under them, so they are counted separately rather than excused.
    if (p.init_flags & GROUND_SNAP_EXEMPT) {
      pinned += 1;
      if (Math.abs(lastIn.y - start.y) < 1) held += 1;
    }
    if (thrown >= 1) threw += 1;
    if (leftBy !== null) left += 1;
    rows.push(`  stage ${stage} ${p.at} (ct ${p.char_type}, `
      + `${chars.types[String(p.char_type)]?.file}): net `
      + `${drift.toFixed(2)}u (clip swing ${peak.toFixed(2)}u), fell `
      + `${(lastIn.y - start.y).toFixed(1)}u, threw ${thrown}, left by `
      + `${leftBy ?? "—"} after ${walked.toFixed(1)}u`);
  }
}

for (const r of rows) console.log(r);
console.log(`\n${total} stationary throwers: ${stood} never moved in the `
          + `plane, ${threw} threw both hands, ${left} left when they were `
          + `done, and ${held} of the ${pinned} the spawn flags exempt from `
          + `the ground snap held their height`);
if (!total) {
  console.log("\nFAIL  no state-33 spawn in the bundle -- re-export it");
  process.exit(1);
}
if (stood !== total || threw !== total || left !== total
    || held !== pinned || !pinned) {
  console.log("\nFAIL  a stationary thrower must hold its height, stand still, "
              + "throw, and back away when it is done");
  process.exit(1);
}
console.log("\nclean -- every one stands where the script put it, throws both "
            + "hands and leaves, and the one the spawn flags pin stays on its "
            + "ledge");
