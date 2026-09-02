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
import { ZombieState } from "../src/game/class30/states.ts";
import { TARGET_STATES } from "../src/game/class30/target.ts";
import { vec3 } from "../src/game/vec.ts";

const root = join(process.env.HOME, "hotd2-decomp/extract/player");
/**
 * The camera, parked five thousand units from anything. That is the whole
 * point: with the eye far away, "closed on the civilian" and "closed on the
 * camera" are opposite answers, and a captor that has fallen through to
 * `AttackRun` gives the second one.
 */
const EYE = vec3(5000, 40, 5000);

/** How far off `obj`'s facing is from a point, in radians. The clips face -Z. */
function facingError(obj, p) {
  const want = Math.atan2(obj.pos.x - p.x, obj.pos.z - p.z);
  const have = obj.yaw * ((Math.PI * 2) / 65536);
  let d = want - have;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
const SECONDS = 30;
let total = 0, moved = 0, rescued = 0, holding = 0, bad = 0;
let captors = 0, towardCiv = 0, towardEye = 0, mauled = 0;
let inCaptorState = 0;
const closing = new Map();

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

  const rng = new Rng(7);
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
        script: (p.target_script || p.attack_script)
          ? { target: p.target_script ?? null,
              attack: p.attack_script ?? null }
          : null,
        targetAt: p.civilian_child ?? -1,
      }, rng);
      k.visible = true;
      k.hp = k.maxHp = kid.hp || 1;
      k.pos = vec3(kid.pos[0], kid.pos[1], kid.pos[2]);
    }
    // The Init draws: op 0x15 picks what the civilian is holding with a
    // weighted `rand()`, and without a generator that whole opcode is skipped.
    const a = ActorSpawn(Number(at), SpawnClass.Civilian, rec.charType,
                         `civ@${at}`, undefined, rng);
    a.visible = true;
    actors.push(a);
  }
  if (!actors.length) continue;

  const events = new Events();
  events.on("civilian.rescued", () => { rescued += 1; });
  const start = actors.map((a) => a.civ?.cursor ?? -1);
  let steps = 0;
  const seen = actors.map(() => new Set());
  for (let i = 0; i < SECONDS * 60; i++) {
    for (let k = 0; k < actors.length; k++) {
      seen[k].add(`${actors[k].civ?.script}:${actors[k].civ?.cursor}`);
    }
    // **Who are the captors facing?** This is the assertion the whole captor
    // family exists for. `ZombieStateWalkToTarget` turns toward the civilian
    // every frame; `AttackRun`, which is where all 47 of them used to fall
    // through to, turns toward the camera. Measuring the *facing* rather than
    // the distance keeps the answer clean whether or not the clip's root
    // motion actually carries the actor anywhere this frame.
    for (const o of G.g_object_list) {
      if (o.cls !== SpawnClass.Zombie || o.targetAt < 0) continue;
      const rec = closing.get(o.at) ?? { captor: false, run: false };
      // The direct statement of the fix: did this captor ever run a state
      // that works on its civilian, or did it go straight to `AttackRun` and
      // the camera? Before the family was ported, every one of the 47 gave
      // the second answer.
      if (TARGET_STATES.has(o.state)) rec.captor = true;
      if (o.state === ZombieState.AttackRun) rec.run = true;
      if (i === (SECONDS * 60) / 2 - 1) {
        const civ = G.g_object_list.find((c) => c.at === o.targetAt);
        if (civ) {
          rec.civ = facingError(o, civ.pos);
          rec.eye = facingError(o, EYE);
        }
      }
      closing.set(o.at, rec);
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
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    steps += 1;
  }
  for (const a of actors) {
    if (a.flags & 0x4000000) mauled += 1;
  }
  let stageMoved = 0;
  for (let i = 0; i < actors.length; i++) {
    total += 1;
    if ((actors[i].civ?.cursor ?? -1) !== start[i]) { moved += 1; stageMoved += 1; }
    // Either arm counts: op 0x15 chooses and op 0x13/0x14 append, and the
    // append is usually many blocks further into the stream than 30s reaches.
    if ((actors[i].civ?.items.length ?? 0) > 0
        || (actors[i].civ?.pickedItem ?? -1) >= 0) holding += 1;
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

for (const r of closing.values()) {
  captors += 1;
  if (r.captor) inCaptorState += 1;
  if (r.civ !== undefined && r.civ <= r.eye) towardCiv += 1;
  else if (r.civ !== undefined) towardEye += 1;
}
console.log(`\n${captors} captors tracked: ${inCaptorState} ran a state that `
            + `works on their civilian; at 15s ${towardCiv} face the civilian `
            + `more squarely than the camera and ${towardEye} the other way`);
console.log(`${mauled} civilians were killed by their captors`);
console.log(`${total} civilians driven, ${moved} advanced, `
            + `${rescued} rescued, ${holding} holding something, `
            + `${bad} runaway`);

/**
 * What a full six-stage bundle gives.
 *
 * The thirteen civilians that do not advance are waiting on camera cues and
 * script flags this harness never raises -- both of stage 6's are -- which is
 * a property of the harness, not of the port.
 *
 * **`inCaptorState` is the one that matters.** 55 of the 57 captors run a
 * state that works on their civilian; the other two start in state 18, which
 * is a genuine non-captor entrance. Before `class30/target.ts` existed the
 * number was **zero** -- every one of them fell through `ZombieEntryState` to
 * `AttackRun` and went for the camera.
 *
 * The totals were 47 and 47 until the evt spawn opcodes 0x01-0x0A were read:
 * those decode player-count-gated spawns the exporter had been dropping, so
 * six more civilians and ten more captors are in the bundle now. The counts
 * here are the corpus, not a target -- when the exporter learns to read
 * something new they move, and that is the check working.
 *
 * `mauled` is the other side of it: ten civilians are killed by their captors
 * inside fifteen seconds, which is ten that can no longer be rescued. That is
 * why `rescued` is lower here than it was before the family was ported.
 *
 * It was **four** until the clip clock was fixed. `obj+0x19C` counts in
 * `g_motion_play_length`, roughly twice the authored frames, and the port was
 * counting authored frames -- so every kill cue past halfway was simply never
 * reached and the maul was an animation with no consequence. 30 of the game's
 * 51 cues are in that range; `tools/verify_maul_cues.py` is the corpus check.
 *
 * **`moved` and `rescued` fell by three and two when the enemy counters
 * stopped being derived.** A civilian script advances *while* enemies are
 * present -- `CivilianStepScript` needs `goal < g_enemies_present` to be true
 * to step -- and this harness kills every captor at the halfway mark by
 * setting `dead` directly. While the counts were recounted from the pool,
 * `g_enemies_present` was `visible && isEnemy` with **no dead test**, so those
 * corpses stayed counted for ever and the scripts kept stepping. They do not
 * now: the port releases both counts on death.
 *
 * Neither number is the engine's. There, a shot zombie keeps its place in
 * `g_enemies_present` for exactly the length of its death clip --
 * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) drops the alive count at
 * death and `ZombieEnterCorpseState` (`FUN_00456740`) drops the present count
 * when the clip ends -- and that window is the entire reason the game has two
 * counters. The port has no class-0x30 death state to hang it on, so the
 * window is zero-length here; the old behaviour was a window of *infinity*,
 * which left all 54 `wait_enemies_present` gates unable to open at all.
 * Closing it properly means porting `ZombieStateDeath6` (`FUN_00454D20`).
 */
const EXPECT = { total: 53, moved: 37, rescued: 21, holding: 4,
                 captors: 57, inCaptorState: 55, mauled: 10 };
const got = { total, moved, rescued, holding, captors, inCaptorState, mauled };
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
console.log("\nclean -- every shipped stream steps, none runs away, 55 of the "
            + "57 captors work on their own civilian rather than on the "
            + "camera, and 10 civilians are mauled before anyone can save "
            + "them");
