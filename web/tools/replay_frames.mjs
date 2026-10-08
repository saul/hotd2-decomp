/**
 * Does a seek leave a step-counting prop where play would have?
 *
 *     node tools/run_test.mjs tools/replay_frames.mjs
 *
 * Class 0x41 type 75, `PropUpdateType75` (`FUN_004710C0`), is the only writer
 * of `g_script_flags[20]`, and in Original Mode it raises it on the **second**
 * change of `g_evt_step_index` it sees. Stage 4 places it at block 2 step 5;
 * step 7 opens with `wait_script_flag 20`. Played from step 5 the gate passes
 * on step 7's first frame. A seek runs no frames, and its placer builds the
 * prop at the landing, so a seek to step 6 or 7 built it with no change
 * counted: the gate never came down and the stage parked on 2/7 for good,
 * and a seek to step 8 put back a prop play had already despawned.
 * `ClassHandler.followReplayFrame` is the fix; see `class41/flag_prop.ts`.
 *
 * For every type-75 placement in the twelve bundles this plays the stage from
 * the prop's own spawn step -- the baseline, with nothing seeked past the
 * spawn -- and then seeks to each later step up to the one after the gate,
 * and asserts the seek lands in play's world: the prop present or gone as in
 * play when it entered that step, with the same `+0x196`, `+0x197` and
 * `+0x2A4`, and the gate passed the same number of frames after the landing
 * as play passed it after entering that step.
 *
 * Every enemy is shot as player 0 each frame, as `civ_gives.mjs` does, so a
 * room gate in front of the flag gate comes down the same way in both runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CameraFrame } from "../src/core/camera.ts";
import { Events } from "../src/core/events.ts";
import { Rng } from "../src/core/rng.ts";
import { Scope } from "../src/core/scope.ts";
import { World } from "../src/core/world.ts";
import { GameSystem, ScriptSystem, syncPortGlobals }
  from "../src/app/systems.ts";
import {
  PROP75_SCRIPT_FLAG, PROP75_TYPE, ResetPropContainers,
} from "../src/game/class41/index.ts";
import { CamPaths } from "../src/game/camera/curve.ts";
import { ActorFlag } from "../src/game/actor.ts";
import { DispatchHit, HEAD_BONE } from "../src/game/combat/resolve_hit.ts";
import { SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { ActorIsEnemy, g_class_handlers } from "../src/game/registry.ts";
import { SetCameraPaths, SetGameTables } from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { BUNDLE_ROOT, skipNoBundle } from "./lib/bundle_root.ts";

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
/** Frames to play; the baseline passes stage 4's gate by frame 400. */
const FRAMES = 2400;
const SHOOTER = 0;
const WAIT_SCRIPT_FLAG = 0x45;

const file = (b, ext) => join(BUNDLE_ROOT, b, `${b}.${ext}.json`);
const BUNDLES = [1, 2, 3, 4, 5, 6].flatMap((n) => [`stage${n}`,
                                                  `stage${n}_original`]);
if (!BUNDLES.some((b) => existsSync(file(b, "script")))) {
  skipNoBundle("replay_frames");
}

let failures = 0;
let asserted = 0;
function check(name, ok, detail = "") {
  asserted += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`
    + (ok || !detail ? "" : ` -- ${detail}`));
}

/** `(block, step)` of the evt op that spawns `at`, or null. */
function spawnStep(script, at) {
  for (const [bi, b] of (script.blocks ?? []).entries()) {
    for (const [si, st] of (b?.steps ?? []).entries()) {
      for (const op of st?.ops ?? []) {
        if ((op.spawns ?? []).some((s) => s.at === at)) return [bi, si];
      }
    }
  }
  return null;
}

/**
 * `[step, opIndex]` of the first `wait_script_flag flag` in `block` at or
 * after step `from`, or null.
 */
function gateAt(script, block, from, flag) {
  const steps = script.blocks[block]?.steps ?? [];
  for (let s = from; s < steps.length; s++) {
    const i = (steps[s]?.ops ?? []).findIndex(
      (op) => op.op === WAIT_SCRIPT_FLAG && (op.arg ?? 0) === flag);
    if (i >= 0) return [s, i];
  }
  return null;
}

/** The step-counting words of the placement's prop, or null if none stands. */
function propWords(at) {
  const p = G.g_breakable_props.find((q) => q.at === at
                                      && q.kind === PROP75_TYPE);
  return p ? `+0x196 ${p.lastStepIndex} +0x197 ${p.stepsElapsed} `
             + `+0x2A4 ${p.removeFlag}` : null;
}

/**
 * Play `bundle` from `block`/`step`, recording for each step of `block` the
 * frame it was entered and the prop's words on that frame, and the frame the
 * walker went past the gate at `[gate, gateOp]`.
 */
function play(bundle, block, step, at, [gate, gateOp]) {
  ResetGameGlobals();
  const script = JSON.parse(readFileSync(file(bundle, "script"), "utf8"));
  const cam = new CamPaths(JSON.parse(readFileSync(file(bundle, "cam"), "utf8")));
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));
  const scope = new Scope("stage");
  const events = new Events();
  const rng = new Rng(1);
  const ctx = { events, rng, walker: null, scope,
                session: scope.child("session"), view: new CameraFrame(),
                stage: 0, frame: 0 };
  const world = new World();
  const scriptSys = new ScriptSystem();
  world.add("script", scriptSys);
  world.add("game", new GameSystem());
  const walker = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined,
    aliveEnemies: () => G.g_enemies_alive,
    presentEnemies: () => G.g_enemies_present,
    aliveCivilians: () => G.g_civilians_alive,
    scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => G.g_camera_free !== 0,
    showMessage: () => null,
  }, { seed: 1 });
  scriptSys.walker = walker;
  ctx.walker = walker;
  ResetPropContainers();
  world.attach(ctx);
  SetGameTables(chars, script.breakables, script.set_pieces, script.humanoids,
                script.coli, script.civilians);
  SetCameraPaths(cam);
  G.g_players_in_play = 1;
  G.g_GameMode = script.game_mode;
  if (!seekTo(walker, block, step, 0)) {
    scope.dispose();
    return { error: `seek ${block}/${step}` };
  }
  world.resync(ctx);

  const seat = () => {
    ctx.view.eye.x = G.g_camera_block_eye.x;
    ctx.view.eye.y = G.g_camera_block_eye.y;
    ctx.view.eye.z = G.g_camera_block_eye.z;
  };
  const made = new Set();
  const spawn = () => {
    const reqs = [];
    for (const s of walker.spawns) {
      if (made.has(s.at)) continue;
      const pl = placementAt.get(s.at);
      if (!pl) continue;
      made.add(s.at);
      const pos = s.pos ?? pl.pos ?? [0, 0, 0];
      reqs.push({ at: s.at, motion: pl.motion ?? 0,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    const listed = new Set(walker.spawns.map((s) => s.at));
    for (const pl of chars.placements) {
      const parent = pl.civilian_child ?? pl.parent_at;
      if (parent == null || !listed.has(parent) || made.has(pl.at)) continue;
      made.add(pl.at);
      const pos = pl.pos ?? [0, 0, 0];
      reqs.push({ at: pl.at, motion: pl.motion ?? 0, parentAt: parent,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    SpawnScriptedCharacters(reqs);
    SpawnSlotActors(walker.spawns);
  };

  /** step -> { frame, words } on the first frame the walker sat on it. */
  const entered = new Map();
  let passed = -1;
  seat();
  for (let f = 0; f < FRAMES; f += 1) {
    walker.tick(TICK);
    if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
    syncPortGlobals(walker, false, ctx.view.eye);
    seat();
    spawn();
    for (const o of G.g_object_list) {
      if (o.despawned || (o.flags & ActorFlag.Dead)) continue;
      if (!o.visible || !ActorIsEnemy(o.cls)) continue;
      if (g_class_handlers[o.cls]?.invulnerable?.(o)) continue;
      for (let s = 0; s < 60 && !(o.flags & ActorFlag.Dead); s++) {
        if (!DispatchHit(o, HEAD_BONE, NULL_HOST, rng, SHOOTER)) break;
      }
    }
    world.update(ctx, LIVE);
    const key = walker.block === block ? walker.step : -1;
    if (key >= 0 && !entered.has(key)) {
      entered.set(key, { frame: f, words: propWords(at) });
    }
    if (passed < 0 && (walker.block !== block || walker.step > gate
        || (walker.step === gate && walker.opIndex > gateOp))) passed = f;
    if (walker.block !== block || walker.step > gate) break;
  }
  scope.dispose();
  return { entered, passed };
}

let found = 0;
for (const bundle of BUNDLES) {
  if (!existsSync(file(bundle, "script"))) continue;
  const script = JSON.parse(readFileSync(file(bundle, "script"), "utf8"));
  const props = (script.breakables?.placements ?? []).filter(
    (p) => p.container === "generic" && p.type === PROP75_TYPE);
  for (const pl of props) {
    found += 1;
    const where = spawnStep(script, pl.at);
    const name = `${bundle} type-75 prop 0x${pl.at.toString(16)}`;
    if (!where) {
      check(`${name}: has a spawn step`, false);
      continue;
    }
    const [block, step] = where;
    const at = gateAt(script, block, step + 1, PROP75_SCRIPT_FLAG);
    check(`${name}: block ${block} waits on flag ${PROP75_SCRIPT_FLAG} at a `
          + `step after its spawn step ${step}`, at !== null);
    if (!at) continue;
    const [gate] = at;
    const base = play(bundle, block, step, pl.at, at);
    if (base.error) {
      check(`${name}: plays from ${block}/${step}`, false, base.error);
      continue;
    }
    console.log(`\n== ${name}: spawned ${block}/${step}, gate at step ${gate}`);
    for (const [s, e] of [...base.entered].sort((a, b) => a[0] - b[0])) {
      console.log(`  play enters ${block}/${s} at f${e.frame}: `
                  + `${e.words ?? "no prop"}`);
    }
    check(`${name}: played from its spawn step, the gate at step ${gate} `
          + `passes`, base.passed >= 0, `parked for ${FRAMES} frames`);
    if (base.passed < 0) continue;
    console.log(`  play passes the gate at f${base.passed}`);
    // Through the step after the gate: a seek there steps over the wait
    // itself, so only the prop is compared, and play has despawned it there
    // when its lifetime has run out.
    const last = base.entered.has(gate + 1) ? gate + 1 : gate;
    for (let s = step + 1; s <= last; s++) {
      const want = base.entered.get(s);
      const got = play(bundle, block, s, pl.at, at);
      if (got.error) {
        check(`${name}: seeks to ${block}/${s}`, false, got.error);
        continue;
      }
      const land = got.entered.get(s);
      check(`seek to ${block}/${s}: the prop as play left it`,
            land?.words === want.words,
            `seek ${land?.words ?? "no prop"}, play ${want.words ?? "no prop"}`);
      if (s > gate) continue;
      const wantFrames = base.passed - want.frame;
      check(`seek to ${block}/${s}: the gate passes ${wantFrames} frames `
            + `after landing, as in play`,
            got.passed >= 0 && got.passed - land.frame === wantFrames,
            got.passed < 0 ? `parked on ${block}/${gate} for ${FRAMES} `
              + "frames" : `after ${got.passed - land.frame}`);
    }
  }
}

if (found === 0) {
  console.log("\nSKIP  replay_frames: no bundle places a type-75 prop");
  process.exit(3);
}
console.log(failures ? `\n${failures} of ${asserted} failed`
                     : `\nall ${asserted} passed`);
process.exit(failures ? 1 : 0);
