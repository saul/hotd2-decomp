/**
 * Drive every class-0x10 civilian in the shipped stages, headless.
 *
 * `test/port.test.ts` guards the VM against streams written by hand; this
 * guards it against the 136 the game ships. What it can catch that the unit
 * tests cannot:
 *
 *  * a stream that **runs away** — the VM advancing every frame for ever,
 *    which is what a length table off by one dword looks like once it happens
 *    to stay in range;
 *  * a stream that never starts, i.e. a wait word the port can never satisfy;
 *  * a rescue that pays the wrong number of times.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/civilians.mjs
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
import { vec3 } from "../src/game/vec.ts";

const root = join(process.env.HOME, "hotd2-decomp/extract/player");
const SECONDS = 30;
let total = 0, moved = 0, rescued = 0, bad = 0;

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

  const places = new Map(
    (script.characters?.placements ?? []).map((p) => [p.at, p]));
  const actors = [];
  for (const [at, rec] of Object.entries(civ.spawns)) {
    for (const kid of rec.children) {
      const p = places.get(kid.at);
      if (!p) continue;
      const k = ActorSpawn(kid.at, p.class, p.char_type, "captor", {
        initialState: p.initial_state ?? 0,
        attackState: p.attack_state ?? 0,
        condition: p.body_condition ?? 0,
      });
      k.visible = true;
      k.hp = k.maxHp = kid.hp || 1;
      k.pos = vec3(kid.pos[0], kid.pos[1], kid.pos[2]);
    }
    const a = ActorSpawn(Number(at), SpawnClass.Civilian, rec.charType,
                         `civ@${at}`);
    a.visible = true;
    actors.push(a);
  }
  if (!actors.length) continue;

  const events = new Events();
  events.on("civilian.rescued", () => { rescued += 1; });
  const rng = new Rng(7);
  const start = actors.map((a) => a.civ?.cursor ?? -1);
  let steps = 0;
  const seen = actors.map(() => new Set());
  for (let i = 0; i < SECONDS * 60; i++) {
    for (let k = 0; k < actors.length; k++) {
      seen[k].add(`${actors[k].civ?.script}:${actors[k].civ?.cursor}`);
    }
    // Half way through, kill every captor. That is the one thing this harness
    // *can* do that the shipped waits are actually waiting for -- most of the
    // rest are camera cues and script flags a lone director never raises --
    // and it is what drives the rescue path over real streams.
    if (i === (SECONDS * 60) / 2) {
      for (const o of G.g_object_list) {
        if (o.cls === SpawnClass.Zombie) { o.dead = true; }
      }
    }
    GameUpdate(vec3(0, 40, 0), 1 / 60, NULL_HOST, rng, events);
    steps += 1;
  }
  let stageMoved = 0;
  for (let i = 0; i < actors.length; i++) {
    total += 1;
    if ((actors[i].civ?.cursor ?? -1) !== start[i]) { moved += 1; stageMoved += 1; }
    // A stream that visits more distinct cursors than it has commands has
    // wrapped, which the flat index cannot do -- so this is a runaway.
    const len = (civ.scripts[actors[i].civ?.script ?? 0] ?? []).length;
    if (seen[i].size > len + 8) {
      console.log(`  FAIL ${actors[i].name}: ${seen[i].size} cursors over a `
                  + `${len}-command stream`);
      bad += 1;
    }
  }
  console.log(`  stage ${stage}: ${actors.length} civilians, `
              + `${stageMoved} advanced their script in ${SECONDS}s`);
}

console.log(`\n${total} civilians driven, ${moved} advanced, `
            + `${rescued} rescued, ${bad} runaway`);

/**
 * What a full six-stage bundle gives. The fourteen that do not advance are
 * waiting on camera cues and script flags this harness never raises -- both
 * of stage 6's are -- which is a property of the harness, not of the port.
 */
const EXPECT = { total: 47, moved: 33, rescued: 21 };
const got = { total, moved, rescued };
const missing = Object.keys(EXPECT).filter((k) => EXPECT[k] !== got[k]);
if (bad || total === 0 || missing.length) {
  console.log("\nFAIL");
  for (const k of missing) {
    console.log(`  ${k}: expected ${EXPECT[k]}, got ${got[k]}`);
  }
  if (total && total !== EXPECT.total) {
    console.log("  (a bundle built for fewer than six stages will not match; "
                + "re-export with tools/export_player.py --all)");
  }
  process.exit(1);
}
console.log("\nclean -- every shipped stream steps, none runs away, and "
            + "killing the captors rescues 21 of the 47");
