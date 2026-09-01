/**
 * The snapshot oracle.
 *
 * Every other harness here proves that **playing forward** did not change:
 * `port.test.ts` drives the state machines against hand-written tables,
 * `seek.test.ts` compares a replayed address against a played one, and
 * `scope.test.ts` counts what a rebuild left behind. None of them asks the
 * question the save state actually makes: *does a snapshot determine the next
 * frame?*
 *
 * That question is the whole reason `game/` may not import three, may not
 * touch the DOM and may not call `Math.random` — and until this file existed,
 * nothing checked the property those three rules were paid for. The bugs it is
 * aimed at are the ones that pass every other test by construction: a field
 * added to `save` and forgotten in `load`, a counter that lives in a closure,
 * a layer that only resets itself on a seek and not on a load. All of them
 * look like a gameplay bug when they surface, days later, as "the shutter was
 * half open after I restored".
 *
 * So this drives the **real `World`** — the same `ScriptSystem` and
 * `GameSystem` the player registers, in the same tick order — with no browser
 * at all, and asserts three things frame by frame:
 *
 * - **A.** A snapshot, put back, reproduces the run it was taken from.
 * - **B.** A seek and a load are the same rebuild: reaching a state from a
 *   different history reaches the *same* state.
 * - **C.** A load is complete — `save` after `load` is the snapshot again.
 *
 * The camera is the one input that is not state, so the test supplies its
 * own: a yaw-rotating orbit that is a pure function of `ctx.frame`, which is
 * itself restored by a load. Two runs at the same frame therefore see the same
 * camera, and a divergence is the port's rather than the harness's.
 *
 * **What it cannot see yet.** `hud/` is not in the `World`, so the shutter's
 * slide phase and the caption countdown are outside every assertion below —
 * they are script state kept in the layer that draws it, which is exactly why
 * `loadSnapshot` restores neither. Step 19 moves them onto `Walker`, and
 * assertion C covers them the moment it does.
 *
 * Run with `npm run test:state`. Skips cleanly when no bundle is built.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CameraFrame } from "../src/core/camera";
import { Events } from "../src/core/events";
import { Rng } from "../src/core/rng";
import { Scope } from "../src/core/scope";
import type { Context, Tick } from "../src/core/system";
import type { Snapshot } from "../src/core/snapshot";
import { World } from "../src/core/world";
import { GameSystem, ScriptSystem, syncPortGlobals } from "../src/app/systems";
import { ResetPropContainers } from "../src/game/class41/index";
import { ResetGameGlobals } from "../src/game/globals";
import { Walker, type WalkerHost } from "../src/script/walker";
import { seekTo } from "../src/script/seek";
import type { ScriptJson } from "../src/bundle";

const ROOT = join(process.env.HOME ?? "", "hotd2-decomp", "extract", "player");
const STAGES = [1, 2, 3, 4, 5, 6];
const TICK = 1 / 60;
/** Frames played before a snapshot is taken. Long enough to have a fight in. */
const WARM = 900;
/** Frames compared after it. Every one of them is a fingerprint. */
const HORIZON = 300;
/** The history the second world plays before it is made to agree with the first. */
const DETOUR = 1500;

let failures = 0;
let ran = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

/**
 * A host that answers nothing.
 *
 * `aliveEnemies` and friends return null exactly as the player's own host does
 * with shooting off, which puts the room-clear waits back on their timeouts —
 * the deterministic path, and the one a headless run can reproduce.
 */
const mkHost = (): WalkerHost => ({
  enterRegion: () => undefined,
  loadRegion: () => undefined,
  loadSlot: () => undefined,
  unloadSlot: () => undefined,
  startCamera: () => undefined,
  releaseCamera: () => undefined,
  onFeed: () => undefined,
  onBranch: () => undefined,
  playSound: () => undefined,
  aliveEnemies: () => null,
  aliveCivilians: () => null,
  cameraFree: () => null,
  setShutter: () => undefined,
  showMessage: () => undefined,
  endDialogue: () => undefined,
});

const LIVE: Tick = { dt: TICK, frames: 1, wall: TICK, frozen: false };

/**
 * The renderer's stand-in: a camera that yaws as it circles.
 *
 * A fixed camera would leave `viewSpaceOf` answering the same thing every
 * frame and `g_camera_yaw_bams` constant, which is most of what the port asks
 * the camera for. This is the simplest thing that moves both — a rotation
 * about Y and a translation, whose inverse is written out rather than
 * computed, because the harness having its own matrix bug is not a failure
 * anyone would enjoy reading.
 */
function orbit(view: CameraFrame, frame: number): void {
  const a = frame * 0.013;
  const c = Math.cos(a), s = Math.sin(a);
  const tx = c * 600, ty = 150, tz = s * 600;
  // Column-major, as `Matrix4.elements` is: T(t) * Ry(a).
  const world = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, ty, tz, 1];
  // Ry(-a) * T(-t), by hand.
  const inverse = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0,
                   -(c * tx - s * tz), -ty, -(s * tx + c * tz), 1];
  view.take(world, inverse);
  // The camera's own -Z in world space, which is what `getWorldDirection`
  // hands back: minus the third column, already unit length.
  view.place({ x: tx, y: ty, z: tz }, { x: -s, y: 0, z: -c });
}

interface Rig {
  world: World<Context>;
  ctx: Context;
  walker: Walker;
  stageScope: Scope;
}

function build(stage: number, script: ScriptJson): Rig {
  const stageScope = new Scope(`stage:${stage}`);
  const ctx: Context = {
    events: new Events(),
    rng: new Rng(1),
    walker: null,
    scope: stageScope,
    session: stageScope.child("session"),
    view: new CameraFrame(),
    stage,
    frame: 0,
  };
  const world = new World<Context>();
  const scriptSys = new ScriptSystem();
  const game = new GameSystem();
  // The player's own order, minus everything that draws. `ScriptSystem` puts
  // the walker in the snapshot; `GameSystem` is the port's frame.
  world.add("script", scriptSys);
  world.add("game", game);

  const walker = new Walker(script, mkHost());
  scriptSys.walker = walker;
  ctx.walker = walker;
  // `attach` is what calls `ResetGameGlobals`, and the pool is module state:
  // two rigs in one process share it, so building one always clears it.
  ResetPropContainers();
  world.attach(ctx);
  walker.primeToFirstWait();
  return { world, ctx, walker, stageScope };
}

/**
 * One frame, in the order `Player.frame` runs it.
 *
 * A branch is taken the moment it appears, always down the first route. The
 * player lets an arcade countdown pick; the point here is only that the choice
 * is a function of the script and not of the wall clock — and that the drive
 * never *stops* on one, because `Walker.loadState` deliberately drops the
 * branch prompt and a snapshot taken while parked at one therefore cannot
 * round-trip. That divergence is declared where it is made; this harness
 * stays out of its way rather than asserting against it.
 */
function step(r: Rig): void {
  r.walker.tick(TICK);
  if (r.walker.branch) r.walker.takeBranch(r.walker.branch.targets[0]);
  syncPortGlobals(r.walker, false, r.ctx.view.eye);
  // Where `CameraTakeSystem` sits in the real world: after the shot has seated
  // the block and before the port reads it.
  orbit(r.ctx.view, r.ctx.frame);
  r.world.update(r.ctx, LIVE);
}

function advance(r: Rig, frames: number, each?: (r: Rig) => void): void {
  for (let i = 0; i < frames; i++) { step(r); each?.(r); }
}

/**
 * Everything the world holds, as a comparable string.
 *
 * Non-finite numbers are spelled out rather than left to `JSON.stringify`,
 * which writes `null` for all of them: an oracle that cannot tell a NaN from a
 * missing field is an oracle that would have passed the bug that produced it.
 */
function fingerprint(r: Rig): string {
  const s = r.world.save(r.ctx);
  return JSON.stringify({ frame: s.frame, rng: s.rng, parts: s.parts },
    (_k, v) => typeof v === "number" && !Number.isFinite(v) ? String(v) : v);
}

/** `Player.loadSnapshot`, without the layers that draw. */
function loadInto(r: Rig, snap: Snapshot): string | null {
  r.ctx.session.dispose();
  r.ctx.session = r.stageScope.child("session");
  return r.world.load(structuredClone(snap), r.ctx);
}

/** `Player.seekTo`, without the layers that draw. */
function seekInto(r: Rig, at: [number, number, number]): boolean {
  r.ctx.session.dispose();
  r.ctx.session = r.stageScope.child("session");
  ResetPropContainers();
  // Before the replay, so that what the replay writes into `G` survives it.
  ResetGameGlobals();
  // `g_frame` went back to zero with it, and the harness's camera is a
  // function of `ctx.frame`. Left stale, the two seeks would be handed
  // different cameras and diverge on the harness's own account.
  r.ctx.frame = 0;
  const ok = seekTo(r.walker, ...at);
  r.world.resync(r.ctx);
  return ok;
}

/** Where two runs first stopped agreeing, or the empty string. */
function firstDiff(a: string[], b: string[]): string {
  if (a.length !== b.length) return `${a.length} frames vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    // The whole fingerprint is a data segment; printing it is useless. The
    // frame it parted company on is the thing worth having.
    return `diverged at frame ${i} of ${a.length}`;
  }
  return "";
}

const script = (stage: number): ScriptJson | null => {
  const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")) as ScriptJson : null;
};

// -- A. a snapshot, put back, reproduces the run it came from ---------------

console.log("\nA snapshot determines the next frame:\n");

for (const stage of STAGES) {
  const s = script(stage);
  if (!s) continue;
  ran++;

  const r = build(stage, s);
  advance(r, WARM);
  const snap = r.world.save(r.ctx);

  const live: string[] = [];
  advance(r, HORIZON, (x) => live.push(fingerprint(x)));

  const err = loadInto(r, snap);
  const again: string[] = [];
  if (!err) advance(r, HORIZON, (x) => again.push(fingerprint(x)));

  check(`stage ${stage}: ${HORIZON} frames replay identically after a load`,
        !err && !firstDiff(live, again), err ?? firstDiff(live, again));

  // C, here rather than in a pass of its own: the snapshot is taken again the
  // instant it is put back, with nothing run in between. Anything `save`
  // writes that `load` does not read shows up as a difference of one field,
  // which is the failure this catches and the replay above does not -- a
  // dropped field that nothing reads yet replays perfectly.
  const back = loadInto(r, snap);
  const round = r.world.save(r.ctx);
  check(`stage ${stage}: and save after load is the snapshot again`,
        !back && JSON.stringify(round.parts) === JSON.stringify(snap.parts),
        back ?? "a slice did not survive the round trip");
}

// -- B. a seek and a load are the same rebuild ------------------------------

console.log("\nReaching a state from a different history reaches the same "
            + "state:\n");

for (const stage of STAGES) {
  const s = script(stage);
  if (!s) continue;

  // Run one: warm up, snapshot, and record the future.
  const a = build(stage, s);
  advance(a, WARM);
  const snap = a.world.save(a.ctx);
  const at: [number, number, number] =
    [a.walker.block, a.walker.step, a.walker.opIndex];
  const future: string[] = [];
  advance(a, HORIZON, (x) => future.push(fingerprint(x)));

  // Run two: a *different* history, then the same snapshot. Anything that
  // survived the load because nobody reset it is in this world and not in the
  // first one, and the two futures part company where it matters.
  const b = build(stage, s);
  advance(b, DETOUR);
  const err = loadInto(b, snap);
  const loaded: string[] = [];
  if (!err) advance(b, HORIZON, (x) => loaded.push(fingerprint(x)));
  check(`stage ${stage}: a load after ${DETOUR} other frames plays the same`,
        !err && !firstDiff(future, loaded), err ?? firstDiff(future, loaded));

  // And the same claim for the other rebuild path. A seek replays the script
  // rather than restoring it, so it does not land on the snapshot's actors --
  // what is asserted is that *the seek* is a function of the address alone.
  const c = build(stage, s);
  const cold = seekInto(c, at);
  const coldRun: string[] = [];
  if (cold) advance(c, HORIZON, (x) => coldRun.push(fingerprint(x)));

  const d = build(stage, s);
  advance(d, DETOUR);
  const warm = seekInto(d, at);
  const warmRun: string[] = [];
  if (warm) advance(d, HORIZON, (x) => warmRun.push(fingerprint(x)));

  if (!cold || !warm) {
    check(`stage ${stage}: a seek to ${at.join("/")} is reachable`, false,
          "seek refused the address the live run was standing on");
  } else {
    check(`stage ${stage}: a seek from cold and a seek from ${DETOUR} frames `
          + `in agree`, !firstDiff(coldRun, warmRun),
          firstDiff(coldRun, warmRun));
  }
}

if (ran === 0) {
  console.log("  no bundle under extract/player -- run tools/export_player.py");
  process.exit(0);
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
