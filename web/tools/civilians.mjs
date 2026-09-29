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
 *  * a rescue that pays the wrong number of times, or the wrong player;
 *  * a captor the bundle names and does not place.
 *
 *     npm run civilians [-- --verbose]      # --verbose: one line per civilian
 *
 * A `verify_all.py` row since 2026-09-29. For the four weeks before that it
 * was run by hand, and it rotted twice without anyone noticing: 919bcae4 (the
 * motion clock counting whole frames) let one more maul cue land inside
 * fifteen seconds and nobody re-pinned, and a41baa08 (the prune testing the
 * dead bit alone) left its `dead = true` kill invisible, so it reported
 * `0 rescued` for eleven days while rescues worked in the page.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT, hasBundle, skipNoBundle } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { ActorFlag } from "../src/game/actor.ts";
import { DispatchHit, HEAD_BONE } from "../src/game/combat/resolve_hit.ts";
import { ActorSpawn, GameUpdate } from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { SeatHarnessEye } from "./lib/harness_eye.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { MotionPlayLength, SetGameTables } from "../src/game/tables.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { TARGET_STATES } from "../src/game/class30/target.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
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
/** The frame the harness starts shooting the captors. */
const HALF = (SECONDS * 60) / 2;
/** The player every shot here is fired as. */
const SHOOTER = 0;
const VERBOSE = process.argv.includes("--verbose");
let total = 0, moved = 0, rescued = 0, holding = 0, bad = 0;
let captors = 0, towardCiv = 0, towardEye = 0, mauled = 0;
let inCaptorState = 0, unplaced = 0, misPaid = 0;
let clipChanges = 0, snapWrong = 0;
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
  // The path camera, which the walker says in the player and nothing here
  // does. `CivilianUpdate` (`FUN_0048A920`) takes neither a shot nor the
  // killed bit off any other scene state (`0x0048AAC9`), so left at the
  // reset's 0 -- a cutscene -- no captor here could kill a civilian.
  G.g_scene_state_major_entered = 2;
  G.g_scene_state_major = 2;

  const rng = new Rng(7);
  const places = new Map(
    (script.characters?.placements ?? []).map((p) => [p.at, p]));
  const actors = [];
  // Every captor this stage's civilians spawn, whatever its class. Most are
  // class 0x30; three are class 0x18, whose update `CarriedZombieUpdate18`
  // (`FUN_0045CD90`) calls `EnemyZombieUpdate` (`CALL 0x004533f0` at
  // `0x0045CDDD`), so they run the same captor states and maul the same way.
  const captorList = [];
  for (const [at, rec] of Object.entries(civ.spawns)) {
    for (const kid of rec.children) {
      const p = places.get(kid.at);
      // **A captor the bundle does not place is a failure, not a skip.** This
      // line used to `continue`, and when class 0x18 had no character-type
      // rule its three captors had no placement: nothing was spawned for them,
      // and the prune of the day dropped a child missing from the pool -- so
      // three civilians counted as rescued with nobody shot.
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
  // `player` is `sub+0x6C`, read off the last captor's `obj+0x131C` by
  // `CivilianPruneDeadChildren`. Every captor here is killed by `SHOOTER`, so
  // a rescue naming anyone else -- `-1` pays both players -- is the killer's
  // byte not written.
  const saved = new Set();
  events.on("civilian.rescued", (d) => {
    rescued += 1;
    saved.add(d.at);
    if (d.player !== SHOOTER) misPaid += 1;
  });
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
    // Half way through, shoot every captor dead. That is the one thing this
    // harness *can* do that the shipped waits are actually waiting for --
    // most of the rest are camera cues and script flags a lone director never
    // raises -- and it is what drives the rescue path over real streams.
    //
    // **Through `DispatchHit`, never `dead = true`** (L49). The civilian sees
    // a captor die through `CivilianPruneDeadChildren` (`FUN_0048CA60`),
    // whose only test is `TEST dword ptr [EAX + 0x34], 0x4000000` at
    // `0x0048CA75` -- `ActorFlag.Dead`, which `ResolveHit` raises on the
    // killing shot and a bare `dead` does not. This harness set `dead` alone
    // until a41baa08 made the prune the engine's, and from then on no captor
    // ever left a list: `rescued` read 0 and `moved` 17, a stale harness and
    // not a broken rescue. `DispatchHit` (`FUN_004092F0`) is the shot's own
    // gate -- a shot-immune captor (`obj+0x34 & 0x100`) takes nothing -- so
    // one refused this frame is tried again the next, as a player would.
    if (i >= HALF) {
      for (const o of captorList) {
        if (o.despawned || (o.flags & ActorFlag.Dead)) continue;
        for (let s = 0; s < 60 && !(o.flags & ActorFlag.Dead); s++) {
          if (!DispatchHit(o, HEAD_BONE, NULL_HOST, rng, SHOOTER)) break;
        }
      }
    }
    // **Where each clip change fades from.** `CivilianApplyMotionPose`
    // (`FUN_0048C310`) blends out of the draw records -- the pose the
    // outgoing clip was drawn in -- so the snapshot is that clip's cursor as
    // this frame left it: one tick on from the last, or where the loop arm
    // held it. `CivilianReapplyWaitCommand` (`FUN_0048B760`) runs first and
    // stores 0 into the cursor word, not the clock; while the port wrote the
    // clock, 22 of the 32 changes here faded from their clip's first frame
    // and stage 1's fountain man turned 145 degrees. A change made inside a
    // running fade keeps that fade's snapshot and is not counted.
    const pre = actors.map((a) => ({ motion: a.motion, ticks: a.playTicks,
                                     fading: a.fadeFrom !== null }));
    SeatHarnessEye(EYE);
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    steps += 1;
    for (let k = 0; k < actors.length; k++) {
      const a = actors[k];
      const b = pre[k];
      if (a.despawned || a.motion === b.motion || !a.fadeFrom || b.fading) {
        continue;
      }
      clipChanges += 1;
      // As cursors, `counter % (play + 1)`: the loop arm's hold pins the
      // port's counter at the play length, which is the same cursor.
      const len = MotionPlayLength(a, b.motion) + 1;
      const t = a.fadeFrom.ticks % len;
      if (t !== b.ticks % len && t !== (b.ticks + 1) % len) {
        snapWrong += 1;
        console.log(`  FAIL ${a.name}: ${b.motion} -> ${a.motion} faded from `
                    + `cursor ${t}, drawn at ${b.ticks % len}..`
                    + `${(b.ticks + 1) % len}`);
      }
    }
  }
  for (const a of actors) {
    if (a.flags & 0x4000000) mauled += 1;
    // `--verbose`: one line per civilian, so a moved count can be bisected
    // to the civilian that moved it rather than argued about as a total.
    if (VERBOSE) {
      const kids = captorList.filter((k) => k.targetAt === a.at
                                     || civ.spawns[a.at]?.children
                                       .some((c) => c.at === k.at));
      console.log(`    0x${a.at.toString(16)}: `
                  + `${saved.has(a.at) ? "rescued" : (a.flags & 0x4000000)
                    ? "mauled" : "held"} -- captors `
                  + kids.map((k) => `0x${k.at.toString(16)}/c${k.cls.toString(16)}`)
                    .join(" "));
    }
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
console.log(`${clipChanges} clip changes faded, ${snapWrong} from a pose `
            + `other than the one drawn`);
console.log(`${total} civilians driven, ${moved} advanced, `
            + `${rescued} rescued (${misPaid} paid to anyone but the `
            + `shooter), ${holding} holding something, ${bad} runaway, `
            + `${unplaced} captors with no placement`);

/**
 * What a full six-stage bundle gives. `--verbose` prints the civilian behind
 * every count; the ones named here are from that list.
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
 * The counts are the corpus, not a target -- when the exporter learns to read
 * something new they move, and that is the check working. They moved when the
 * evt spawn opcodes 0x01-0x0A were read (six more civilians, ten more
 * captors), and when class 0x18 got a character-type rule (902de88a): its
 * three captors, stage 2's `0xA174` and stage 3's `0xC00` and `0x71D0`, are
 * placed now, so `captors` and `inCaptorState` each rose by three.
 *
 * `mauled` is the other side of it: a civilian killed by her captors inside
 * fifteen seconds is one nobody can rescue. It was **four** until the clip
 * clock counted `g_motion_play_length`.
 *
 * **Twenty-one rescues was three too many.** Before 902de88a the class-0x18
 * captors had no placement, this harness spawned nothing for them, and until
 * a41baa08 `CivilianPruneDeadChildren` dropped a child missing from the pool
 * as though it had died -- so `0xA134`, `0xBC0` and `0x7190` counted as
 * rescued with nobody shot. Placed and shot now, `0xA134` is rescued by a
 * real kill of `0xA174`, and `0xBC0` and `0x7190` are mauled before the
 * halfway mark by their class-0x18 captors, which run `EnemyZombieUpdate`'s
 * captor states and carry no carrier cue to hold them. Those two are the
 * whole of 21 -> 19 and 10 -> 12: every other civilian ends as it did on the
 * pinned build (b885f3fe, the last commit this passed on unchanged).
 *
 * `misPaid` is `obj+0x131C`. Every rescue here follows a kill by player 0,
 * so it must name player 0; before `ResolveHit` wrote the byte all nineteen
 * named -1 and paid both players.
 */
const EXPECT = { total: 53, moved: 37, rescued: 19, holding: 4,
                 captors: 60, inCaptorState: 58, mauled: 12 };
const got = { total, moved, rescued, holding, captors, inCaptorState, mauled };
const missing = Object.keys(EXPECT).filter((k) => EXPECT[k] !== got[k]);
if (bad || unplaced || misPaid || snapWrong || total === 0
    || missing.length) {
  console.log("\nFAIL");
  for (const k of missing) {
    console.log(`  ${k}: expected ${EXPECT[k]}, got ${got[k]}`);
  }
  if (misPaid) {
    console.log(`  ${misPaid} rescues paid someone other than the shooter`);
  }
  if (snapWrong) {
    console.log(`  ${snapWrong} clip changes faded from a pose not drawn`);
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
            + `by shooting their captors, each paid to the shooter`);
