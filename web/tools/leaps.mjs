/**
 * Do the burst-out leaps land where the descriptor said, or through the floor?
 *
 * `ZombieStateDelayedLeap` (`FUN_004581A0`) rides a ballistic arc to a point
 * the spawn record names, and **the arc is the only thing that may move the
 * actor**: the engine raises `obj+0x34` bit 0x4000 for the whole flight so the
 * jump clip's own root translation is suppressed, and drops it only for the
 * last 0x15 frames. The port had no freeze, so 0x3BB's root motion was applied
 * on top of the parabola every frame and the actor sank past its destination —
 * reported as "they fall through the ground" at stage 3 block 4 step 6.
 *
 * For every spawn that starts in state 26 this measures the gap between where
 * the arc was told to end and where the actor actually stopped, and checks it
 * does not play the limp clip 0x3F7, which belongs to a corpse.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/leaps.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { DescriptorFromPlacement } from "../src/game/descriptor.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { vec3 } from "../src/game/vec.ts";

const root = join(process.env.HOME, "hotd2-decomp/extract/player");
/** The clip a corpse takes on the way down. A live actor must never play it. */
const LIMP_MOTION = 0x3f7;
/** How far past its named point a landing may be and still be a landing. */
const TOLERANCE = 1.0;
/**
 * `obj+0x34` bit 0x1000000 selects the **wind-up** jump, clip 0x399, and that
 * arm does not land on its named point by construction.
 *
 * `ActorArcBeginFalling` solves the parabola from where the actor stands, but
 * sub 2 then holds 0x399 in place to play-frame 0x1A -- coasting at the launch
 * velocity, since `EnemyZombieUpdate` integrates every frame regardless --
 * accelerates from 0x1A to 0x23, and only *then* starts sub 3's n-frame
 * countdown. So the fall runs about 0x23 frames longer than the solution, and
 * the actor ends well below the point. That is the engine's own arithmetic --
 * `obj+0x1330` is never decremented in sub 2 -- so these three stage-1 spawns
 * are checked for landing at all rather than for landing on the point.
 */
const WINDUP_JUMP_FLAG = 0x1000000;

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

  for (const p of chars.placements) {
    const sp = spawnPos.get(p.at);
    if (!sp || sp.class !== 0x30) continue;
    if (p.initial_state !== ZombieState.DelayedLeap) continue;
    if (!p.delayed_leap || p.motion === null) continue;

    ResetGameGlobals();
    SetGameTables(chars, undefined, undefined, undefined, script.coli,
                  script.civilians);
    G.g_players_in_play = 1;
    G.g_player_lives = [2, 2];

    const a = ActorSpawn(sp.at, sp.class, p.char_type,
                         chars.types[String(p.char_type)]?.name ?? "?",
                         DescriptorFromPlacement(p));
    a.pos = { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] };
    a.hp = a.maxHp = p.hp || 100;
    a.motion = p.motion;
    a.visible = true;

    const dest = p.delayed_leap.dest;
    const eye = vec3(dest[0], dest[1] + 5, dest[2] + 40);
    const rng = new Rng(1);
    const events = new Events();

    // **Only while the arc owns the actor**, which ends the frame the flight
    // does. Past that the ground snap owns the position, and a collision floor
    // below the named point is the level's business rather than this state's:
    // stage 4's pair land correctly at 4.98 against a dest of 5.4 and are then
    // snapped to the floor at 0, which the engine does too. Sampling past the
    // landing blamed the leap for that, and sampling on `sub <= 3` was no
    // better -- sub 4 can hand over to `AttackRun` at sub 0 on the same frame.
    let lowest = a.pos.y, playedLimp = false, landedAt = -1, yLanded = a.pos.y;
    for (let f = 0; f < 900; f++) {
      GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
      if (a.motion === LIMP_MOTION) playedLimp = true;
      const flying = landedAt < 0 && a.sub >= 1 && a.sub <= 3
                  && a.state === ZombieState.DelayedLeap;
      if (flying) { lowest = Math.min(lowest, a.pos.y); yLanded = a.pos.y; }
      else if (landedAt < 0) landedAt = f;
      if (a.state !== ZombieState.DelayedLeap) break;
    }
    // How far *below* the named point the flight got. The integration order --
    // `vel += acc` then `pos += vel` -- lands a fraction short rather than
    // long, so anything past the point is root motion the freeze should have
    // suppressed.
    const sank = dest[1] - lowest;
    void yLanded;
    rows.push({ stage, at: sp.at, dest, lowest, sank, playedLimp, landedAt,
                windup: ((p.init_flags ?? 0) & WINDUP_JUMP_FLAG) !== 0,
                left: a.state !== ZombieState.DelayedLeap, state: a.state });
  }
}

console.log(`${rows.length} spawns start in state 26, the burst-out leap\n`);
let bad = 0;
for (const r of rows) {
  const problems = [];
  // The wind-up arm overshoots by construction -- see `WINDUP_JUMP_FLAG`.
  if (!r.windup && r.sank > TOLERANCE) {
    problems.push(`sank ${r.sank.toFixed(1)} below`);
  }
  if (r.playedLimp) problems.push("played the corpse's limp clip");
  if (!r.left) problems.push("never left the state");
  if (r.landedAt < 0) problems.push("never landed");
  if (problems.length) bad += 1;
  console.log(`  ${problems.length ? "FAIL" : "ok  "} `
    + `s${r.stage} 0x${r.at.toString(16).toUpperCase()} `
    + `dest y=${r.dest[1].toFixed(1)} lowest y=${r.lowest.toFixed(1)} `
    + `landed f=${r.landedAt}${r.windup ? "  (wind-up jump)" : ""}`
    + (problems.length ? `  -- ${problems.join(", ")}` : ""));
}

const windups = rows.filter((r) => r.windup).length;
console.log(`\n${rows.length - bad} of ${rows.length} land without the `
          + `corpse clip, ${windups} of them on the wind-up arm that `
          + `overshoots by design`);
if (bad) {
  console.log("FAIL: a leap that overshoots its own destination is the jump "
            + "clip's root motion running under the arc");
  process.exitCode = 1;
} else {
  console.log("clean -- the arc alone moves the actor, and 0x3F7 stays with "
            + "the dead");
}
