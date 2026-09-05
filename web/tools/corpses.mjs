/**
 * Does a civilian killed in a set piece rest on its dying clip?
 *
 * `CivilianUpdate` (`FUN_0048A920`) advances the play cursor only while the
 * loop count allows it:
 *
 * ```
 * if      (loops <  0)  model[0]++;                     // for ever
 * else if (loops >  0) {
 *   if (model[2] < g_motion_play_length[model[8]]) model[0]++;
 *   else if (--loops != 0)                        model[0]++;
 * }                                                     // ...and otherwise
 * ```                                                   // nothing at all
 *
 * When the count runs out **nothing touches the cursor again**, so the clip
 * sits on its last frame for as long as the actor lives. The port's clock is
 * advanced unconditionally by `ActorAdvanceMotion` and wrapped by the
 * renderer, so a corpse played its dying animation over and over.
 *
 * This drives every civilian in the game *with its captors*, which is the only
 * thing that reaches a death script without a player, lets the mauls finish,
 * and then watches the last five seconds: a resting corpse shows one frame of
 * one clip and never moves off it.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/corpses.mjs
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
import { SpawnClass } from "../src/game/spawn_class.ts";
import { vec3 } from "../src/game/vec.ts";

const root = BUNDLE_ROOT;
/** Parked far away, so nothing in the set piece is reacting to a camera. */
const EYE = vec3(5000, 40, 5000);
/** Long enough for the walk-in, the grab and the maul to play out. */
const SETTLE = 1800;
/** ...and then this many frames in which a corpse must not move. */
const WATCH = 300;

let moved = 0, held = 0, total = 0;
for (let stage = 1; stage <= 6; stage++) {
  let script;
  try {
    script = JSON.parse(readFileSync(
      join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
  } catch { continue; }
  const civ = script.civilians;
  if (!civ?.spawns) continue;

  ResetGameGlobals();
  SetGameTables(script.characters, undefined, undefined, undefined,
                script.coli, civ);
  G.g_coli_full_set = Object.keys(script.coli?.blobs ?? {});
  const rng = new Rng(3);
  const places = new Map(
    (script.characters?.placements ?? []).map((p) => [p.at, p]));
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

  const actors = [];
  for (const [at, rec] of Object.entries(civ.spawns)) {
    const sp = spawnPos.get(Number(at));
    const a = ActorSpawn(Number(at), SpawnClass.Civilian, rec.charType,
                         `civ@${at}`, undefined, rng);
    a.visible = true;
    if (sp) a.pos = vec3(sp.pos[0], sp.pos[1], sp.pos[2]);
    actors.push(a);
    // The captors are the point: without them nothing reaches a death script,
    // because a lone civilian's on-shot handler is never even installed.
    for (const kid of rec.children) {
      const p = places.get(kid.at);
      if (!p) continue;
      const k = ActorSpawn(kid.at, p.class, p.char_type, "captor", {
        initialState: p.initial_state ?? 0,
        attackState: p.attack_state ?? 0,
        condition: p.body_condition ?? 0,
        script: (p.target_script || p.attack_script)
          ? { target: p.target_script ?? null,
              attack: p.attack_script ?? null } : null,
        targetAt: p.civilian_child ?? -1,
      }, rng);
      k.visible = true;
      k.hp = k.maxHp = kid.hp || 1;
      k.pos = vec3(kid.pos[0], kid.pos[1], kid.pos[2]);
      k.yaw = kid.yaw ?? 0;
      k.motion = p.motion ?? 0;
    }
  }

  const events = new Events();
  for (let i = 0; i < SETTLE; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);

  // A **negative** loop count is the engine's own "play for ever", and one
  // death script in the game asks for it: stage 4's `4484` ends on
  // `{op 0, motion 606, loops -1}`. That corpse is meant to keep moving, so
  // it is not evidence of anything and is excluded rather than tolerated.
  const dead = actors.filter((a) => a.dead && (a.civ?.loops ?? 0) >= 0);
  const looping = actors.filter((a) => a.dead && (a.civ?.loops ?? 0) < 0);
  const last = new Map();
  const restless = new Set();
  for (let i = 0; i < WATCH; i++) {
    for (const a of dead) {
      const m = script.characters.types[String(a.charType)]
        ?.motions[String(a.motion)];
      if (!m) continue;
      // What the renderer actually shows: the clip and the frame within it.
      const key = `${a.motion}:${Math.floor(a.playTicks * m.fps / 60)
                                 % Math.max(1, m.frames)}`;
      const prev = last.get(a.at);
      if (prev !== undefined && prev !== key) restless.add(a.at);
      last.set(a.at, key);
    }
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  }
  total += dead.length;
  moved += restless.size;
  held += dead.length - restless.size;
  console.log(`  stage ${stage}: ${dead.length + looping.length} of `
            + `${actors.length} civilians mauled, ${restless.size} still `
            + `animating`
            + (looping.length ? ` (${looping.length} asked to loop for ever)`
                              : ""));
  for (const a of dead) {
    if (!restless.has(a.at)) continue;
    console.log(`      ${a.at}: motion ${a.motion} loops ${a.civ?.loops} `
              + `frame limit ${a.civ?.frameLimit}`);
  }
}

console.log(`\n${total} civilians mauled across the game, ${held} rest on a `
          + `single frame, ${moved} keep animating`);
if (!total) {
  console.log("\nFAIL  nothing was mauled -- build the bundle with "
              + "`npm run export -- --all`");
  process.exit(1);
}
if (moved) {
  console.log("\nFAIL  a corpse whose loop count is spent must hold its last "
              + "frame; the play cursor stops in `CivilianUpdate`");
  process.exit(1);
}
console.log("\nclean -- every mauled civilian rests on its dying clip");
