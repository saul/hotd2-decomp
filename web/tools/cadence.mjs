/**
 * How often does a zombie actually attack? The number, not the impression.
 *
 * "They attack too fast, with no pause" is a report about *timing*, and timing
 * is the one thing a state machine will happily get wrong while every unit
 * test passes. This drives real spawns from a real bundle and prints the
 * cycle, so a change to the attack loop shows up as a number moving.
 *
 * What the engine's pacing actually is, having read it
 * (`ZombieStateHoldAtRange` `FUN_00455720`, `ZombieStateStrike` `FUN_00455A40`,
 * `ZombieStateBackOff` `FUN_00455C30`, `TryClaimAttackSlot` `FUN_00455DE0`):
 *
 *  * **There is no per-swing cooldown for an ordinary zombie.** `obj+0x133C`
 *    is forced to zero unless `obj+0x1368` bit 0 is set, and the only thing in
 *    all of class 0x30 that sets it is `ZombieStateWaitForCameraFrame`
 *    (`FUN_00457620`), state 19 — four spawns in the whole game.
 *  * **The pause is the queue.** Only `g_max_attackers` enemies hold a permit,
 *    and only those inside `obj+0x1358` of the distance rank may claim one. A
 *    lone zombie has rank 0 and claims immediately: it really does swing,
 *    retreat and swing again with no idle in between. With a crowd the same
 *    zombie waits its turn, and the idle appears.
 *  * **Difficulty does not enter into it.** `ResetSceneCombatState`
 *    (`FUN_0045EEC0`) copies the approach rings from one table with no
 *    difficulty index, and `ResetDamageRank` (`FUN_00460770`) only seeds
 *    `g_damage_rank`, which scales damage.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/cadence.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { vec3 } from "../src/game/vec.ts";

const root = join(BUNDLE_ROOT, "stage2");
const script = JSON.parse(readFileSync(join(root, "stage2.script.json"),
                                       "utf8"));
/** A host that says every actor is on screen, so the permit is never refused. */
const HOST = { ...NULL_HOST,
               viewSpaceOf: (_at, out) => {
                 out.x = 0; out.y = 0; out.z = 30; return true;
               } };
const EYE = vec3(0, 40, 0);
const SECONDS = 30;

/** Drive `n` zombies in a ring around the camera and report what they do. */
function run(n) {
  ResetGameGlobals();
  SetGameTables(script.characters, undefined, undefined, undefined,
                script.coli, script.civilians);
  G.g_coli_full_set = Object.keys(script.coli?.blobs ?? {});
  // The player must stay alive: `PlayerTakeDamage` is real here and a corpse
  // changes what the queue does.
  G.g_player_lives = [99, 99];

  const places = script.characters.placements
    .filter((x) => x.class === 0x30 && x.motion);
  const zs = [];
  for (let k = 0; k < n; k++) {
    const p = places[k];
    const z = ActorSpawn(p.at, 0x30, p.char_type, `z${k}`, {
      initialState: p.initial_state, attackState: p.attack_state,
      condition: p.body_condition, ringSet: p.ring_set,
    }, new Rng(1 + k));
    z.visible = true;
    z.hp = z.maxHp = 1000;
    const a = (k / n) * Math.PI * 2;
    z.pos = vec3(Math.sin(a) * 40, 40, Math.cos(a) * 40);
    zs.push(z);
  }

  const rng = new Rng(3);
  const events = new Events();
  const strikes = zs.map(() => []);
  const wasStriking = zs.map(() => false);
  let maxAtOnce = 0;
  let idleFrames = 0;
  for (let i = 0; i < SECONDS * 60; i++) {
    G.g_player_lives = [99, 99];
    GameUpdate(EYE, 1 / 60, HOST, rng, events);
    let atOnce = 0;
    for (let k = 0; k < n; k++) {
      const striking = zs[k].state === ZombieState.Strike;
      if (striking) atOnce += 1;
      if (striking && !wasStriking[k]) strikes[k].push(i);
      wasStriking[k] = striking;
      if (zs[k].state === ZombieState.HoldAtRange) idleFrames += 1;
    }
    maxAtOnce = Math.max(maxAtOnce, atOnce);
  }
  const gaps = strikes.flatMap((s) => s.slice(1).map((v, k) => (v - s[k]) / 60));
  const mean = gaps.length
    ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  return {
    n, total: strikes.reduce((a, s) => a + s.length, 0),
    gap: Number(mean.toFixed(2)), maxAtOnce,
    idle: Number((idleFrames / 60 / n).toFixed(1)),
  };
}

const one = run(1);
const many = run(6);
console.log(`one zombie:  ${one.total} strikes in ${SECONDS}s, `
  + `${one.gap}s apart, ${one.idle}s of it standing in the hub`);
console.log(`six zombies: ${many.total} strikes in ${SECONDS}s, `
  + `${many.gap}s apart each, at most ${many.maxAtOnce} swinging at once, `
  + `${many.idle}s each standing in the hub`);

/**
 * What the port gives today.
 *
 * The lone zombie's 3.2s is the strike clip (1.63s) plus the retreat (1.58s)
 * and **no idle at all** — which is the engine's own answer, not a bug: with
 * nothing competing for the permit it re-claims on the frame the retreat ends.
 * With six, `g_max_attackers` is 1, the other five are ranked out, and the
 * idle they were missing appears.
 */
const EXPECT = { oneGap: 3.2, oneIdle: 0.0, oneAtOnce: 1,
                 manyGap: 6.0, manyAtOnce: 1 };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const bad = [];
if (!near(one.gap, EXPECT.oneGap, 0.3)) bad.push(`one gap ${one.gap}`);
if (!near(one.idle, EXPECT.oneIdle, 0.4)) bad.push(`one idle ${one.idle}`);
if (one.total < 6) bad.push(`one total ${one.total}`);
if (many.maxAtOnce !== EXPECT.manyAtOnce) {
  bad.push(`${many.maxAtOnce} swinging at once, expected `
           + `${EXPECT.manyAtOnce} — the permit queue is not throttling`);
}
if (!near(many.gap, EXPECT.manyGap, 1.5)) bad.push(`six gap ${many.gap}`);
if (many.idle < 1) {
  bad.push(`six idle ${many.idle}s — a queued zombie must stand and wait`);
}
if (bad.length) {
  console.log("\nFAIL");
  for (const b of bad) console.log(`  ${b}`);
  process.exit(1);
}
console.log("\nclean -- a lone zombie swings every ~3.2s with no idle, which "
            + "is the engine's own pacing; a queued one waits its turn");
