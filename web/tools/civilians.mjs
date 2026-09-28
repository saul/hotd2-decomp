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
import { BUNDLE_ROOT, hasBundle, skipNoBundle } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { CharacterTypeOf, SetGameTables } from "../src/game/tables.ts";
import { ActorFlag } from "../src/game/actor.ts";
import { ResolveHit } from "../src/game/combat/resolve_hit.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { TARGET_STATES } from "../src/game/class30/target.ts";
import { vec3 } from "../src/game/vec.ts";

if (!hasBundle()) skipNoBundle("civilians");

const root = BUNDLE_ROOT;
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
let inCaptorState = 0, unplaced = 0;
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
  // Every captor this stage's civilians spawn, whatever its class: class 0x30,
  // and class 0x18 for three of them -- `CarriedZombieUpdate18`
  // (`FUN_0045CD90`) is `EnemyZombieUpdate` inside the carrier's matrix, so
  // they run the same captor states and maul the same way.
  const captorList = [];
  for (const [at, rec] of Object.entries(civ.spawns)) {
    for (const kid of rec.children) {
      const p = places.get(kid.at);
      // **A child the bundle does not place is a failure, not a skip.** Until
      // class 0x18 had a character-type rule its three captors had no
      // placement, this line skipped them, and the prune of the day dropped a
      // child missing from the pool -- so their three civilians were counted
      // as rescued with nobody having been shot. That was 3 of the 21 this
      // harness was pinned at.
      if (!p) {
        console.log(`  FAIL civilian 0x${Number(at).toString(16)}: captor `
                    + `0x${kid.at.toString(16)} has no placement`);
        unplaced += 1;
        continue;
      }
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
      captorList.push(k);
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
    for (const o of captorList) {
      if (o.despawned || o.targetAt < 0) continue;
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
    //
    // **Kill them with a shot, not with `dead = true`.** The civilian sees a
    // captor die through `CivilianPruneDeadChildren` (`FUN_0048CA60`), whose
    // whole test is `TEST dword ptr [child+0x34], 0x4000000` at `0x0048CA75`
    // -- `ActorFlag.Dead`, which `ResolveHit` raises on a killing shot and a
    // bare `dead` does not. This harness set `dead` alone for as long as the
    // port also dropped a child on `dead`; once the prune was made the
    // engine's (a41baa08) every captor here was still holding its civilian at
    // the end, and `rescued` read 0. The class-0x18 captors are captors too,
    // and a kill that took only class 0x30 left their civilians held.
    if (i === (SECONDS * 60) / 2) {
      for (const o of captorList) {
        if (o.despawned) continue;
        const head = CharacterTypeOf(o)?.head_bone ?? 2;
        for (let s = 0; s < 60 && !(o.flags & ActorFlag.Dead); s++) {
          ResolveHit(o, head, NULL_HOST, rng, 0);
        }
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
            + `${bad} runaway, ${unplaced} captors with no placement`);

/**
 * What a full six-stage bundle gives.
 *
 * The civilians that do not advance are waiting on camera cues and script
 * flags this harness never raises -- both of stage 6's are -- which is a
 * property of the harness, not of the port.
 *
 * **`inCaptorState` is the one that matters.** All but two captors run a
 * state that works on their civilian; the other two start in state 18, which
 * is a genuine non-captor entrance. Before `class30/target.ts` existed the
 * number was **zero** -- every one of them fell through `ZombieEntryState` to
 * `AttackRun` and went for the camera.
 *
 * The counts here are the corpus, not a target -- when the exporter learns to
 * read something new they move, and that is the check working. They moved
 * when the evt spawn opcodes 0x01-0x0A were read (player-count-gated spawns
 * the exporter had been dropping: six more civilians, ten more captors), and
 * again when class 0x18 got a character-type rule (902de88a): its three
 * captors are placed now, so `captors` and `inCaptorState` each rose by three.
 *
 * `mauled` is the other side of it: a civilian killed by her captors inside
 * fifteen seconds is one that can no longer be rescued. It was **four** until
 * the clip clock was fixed -- `obj+0x19C` counts in `g_motion_play_length`,
 * roughly twice the authored frames, so every kill cue past halfway was never
 * reached; `tools/verify_maul_cues.py` is the corpus check -- and it rose by
 * two when class 0x18 was ported: stage 3's `0xC00` and `0x71D0` maul
 * `0xBC0` and `0x7190`. Those two carry no carrier cue (`tail+0x0C` is -1),
 * so `CarriedZombieUpdate18`'s hold in state 0x2E never applies to them, and
 * the maul is the class-0x30 captor states running as the exe runs them.
 *
 * **`rescued` was pinned at 21 and three of those were never earned.** Until
 * 902de88a the class-0x18 captors had no placement, and until a41baa08
 * `CivilianPruneDeadChildren` dropped a child missing from the pool as though
 * it had died -- so this harness spawned nothing for them and their three
 * civilians were "rescued" with nobody shot. Pin-era code on a current bundle
 * with the class-0x18 placements filtered out gives exactly 21, and exactly
 * those three civilians. Of the three, two are now mauled first and one,
 * stage 2's `0xA134`, is rescued by a real kill of `0xA174`.
 *
 * The same a41baa08 made the prune the engine's test and nothing else -- the
 * dead bit, `0x0048CA75` -- which is why the kill above is a shot. With this
 * harness still setting `dead` alone, no captor ever left a list, `moved`
 * read 17 and `rescued` 0: a stale harness, not a regression.
 */
const EXPECT = { total: 53, moved: 37, rescued: 19, holding: 4,
                 captors: 60, inCaptorState: 58, mauled: 12 };
const got = { total, moved, rescued, holding, captors, inCaptorState, mauled };
const missing = Object.keys(EXPECT).filter((k) => EXPECT[k] !== got[k]);
if (bad || unplaced || total === 0 || missing.length) {
  console.log("\nFAIL");
  for (const k of missing) {
    console.log(`  ${k}: expected ${EXPECT[k]}, got ${got[k]}`);
  }
  if (total && total !== EXPECT.total) {
    console.log("  (a bundle built for fewer than six stages will not match; "
                + "re-export with `npm run export -- --all`)");
  }
  process.exit(1);
}
console.log(`\nclean -- every shipped stream steps, none runs away, `
            + `${inCaptorState} of the ${captors} captors work on their own `
            + `civilian rather than on the camera, ${mauled} civilians are `
            + `mauled before anyone can save them, and ${rescued} are rescued `
            + `by shooting their captors`);
