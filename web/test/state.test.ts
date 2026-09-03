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
 * The shutter and the caption used to be outside all three: they were script
 * state kept in `hud/`, the layer that draws them, and `hud/` is not in the
 * `World`. So a save taken three frames into a shutter close came back as a
 * shutter frozen part-way shut. Step 19 moved them onto `Walker`, which is
 * what the last group below checks by name — the general assertions cover them
 * too, but a named check is what says *why* they are there.
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
import { describeShutter } from "../src/app/projection/hud";
import { ResetPropContainers } from "../src/game/class41/index";
import { G, ResetGameGlobals } from "../src/game/globals";
import { GameUpdate } from "../src/game/director";
import type { GameHost } from "../src/game/host";
import { Harness } from "../src/app/harness";
import { Walker, WALKER_RESTORED_BY_HAND, WALKER_RESTORED_KEYS,
  type WalkerHost } from "../src/script/walker";
import { seekTo } from "../src/script/seek";
import type { ScriptJson } from "../src/bundle";
import { BUNDLE_ROOT, skipNoBundle } from "../tools/lib/bundle_root";

const ROOT = BUNDLE_ROOT;
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
  showMessage: () => null,
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
  // The same for the generator, and for the same reason `app/main.ts`'s
  // `seekTo` does it: a seek is a rebuild from the address, and a rebuild that
  // inherits the last run's random state is not one.
  r.ctx.rng.reseed(1);
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

// -- the driven clock ---------------------------------------------------
//
// Two clocks and they disagreed about what a frame is. This oracle has always
// driven the world with `LIVE` -- one **whole** frame per tick -- which is why
// it has always been deterministic; the browser handed the same port
// `frames: wall * 60` off the rAF timestamp, which is fractional and lands
// somewhere different every run. `?drive=1` and `app/harness.ts` are the fix,
// and these are the two properties it turns on. Neither needs a bundle.
console.log("\nA driven frame is a whole frame:\n");
{
  ResetGameGlobals();
  const rng = new Rng(1);
  const host: GameHost = {
    boneWorld: () => false, objectPath: () => null,
    aimPoint: () => undefined, viewPoint: () => undefined,
    viewSpaceOf: () => false, setBoneSlot: () => undefined,
  };
  const eye = { x: 0, y: 0, z: 0 };
  let integral = true;
  for (let i = 1; i <= 600; i++) {
    GameUpdate(eye, TICK, host, rng);
    if (!Number.isInteger(G.g_frame) || G.g_frame !== i) integral = false;
  }
  // `g_cam_path_frame` is `__ftol`'d in the exe and steps by exactly one, so
  // an `== cue` is safe there. It is only unsafe here if the port's clock is
  // ever handed a variable step -- which is `docs/PLAYER_HANGS.md` item 4's
  // open question, and this is the half of it that is now settled.
  check("600 whole ticks put `g_frame` on exactly 600, integral throughout",
        integral, `ended on ${G.g_frame}`);

  ResetGameGlobals();
  // What a browser actually hands it: 60 Hz nominal with the jitter a rAF
  // timestamp has. Nothing exotic -- a frame that took 17.4 ms instead of
  // 16.7 is an ordinary frame.
  const jitter = [0.0161, 0.0174, 0.0159, 0.0182, 0.0166];
  let skipped = 0, last = 0;
  for (let i = 0; i < 600; i++) {
    GameUpdate(eye, jitter[i % jitter.length], host, rng);
    // An integer the cursor stepped straight over is a cue nothing can equal.
    if (Math.floor(G.g_frame) - last > 1) skipped++;
    last = Math.floor(G.g_frame);
  }
  check("...and a wall-derived one does not, so an exact-frame cue is missable",
        !Number.isInteger(G.g_frame) && skipped > 0,
        `ended on ${G.g_frame}, ${skipped} integers stepped over`);
}

console.log("\nThe drive seam is a metronome and nothing else:\n");
{
  const rng = new Rng(1);
  let stepped = 0;
  let woken = 0;
  const h = new Harness({
    stepOneFrame: () => { stepped++; },
    wake: () => { woken++; },
    get walker() { return null; },
    rng,
  });
  check("nothing is asked for, so nothing is owed", h.take() === 0);
  check("...and the loop has not been woken for nothing", woken === 0);
  let settled = -1;
  const p = h.advance(10).then((n) => { settled = n; });
  check("ten frames asked for, ten frames owed", h.take() === 10);
  // The loop sleeps when nothing wants a frame. Booking frames is the thing
  // that has to wake it, or a driver would wait for a frame nobody asked for.
  check("...and booking them woke the loop", woken === 1);
  check("...and the harness now says it wants a frame", h.wants);
  check("and none run until the frame loop runs them", settled === -1);
  check("...and nothing has been stepped", stepped === 0);
  // What `Player.frame` does under the flag, and the whole of it.
  check("one pump runs exactly what was owed", h.pump() === 10);
  await p;
  check("the promise settles on the count, once the loop has run them",
        settled === 10 && h.driven === 10 && stepped === 10,
        `settled ${settled}, stepped ${stepped}`);
  // The cap is what stands between a driver that asks for a thousand frames
  // and a browser that stops answering; the remainder is simply owed.
  void h.advance(200);
  check("one rAF never runs more than the cap", h.take() === 64,
        `take() said ${h.take()}`);
}

console.log("\nStepping past a wait steps past it:\n");
for (const stage of STAGES) {
  const sc = script(stage);
  if (!sc) continue;
  // **`Walker.stepOnce` re-armed the wait it was trying to step past.** It
  // cleared `this.wait` and called `executeOne`, but `executeOne` does not
  // advance `opIndex` when it raises a wait -- the cursor stays on the
  // blocking instruction, which is exactly what makes a wait re-arm itself
  // every tick until it is satisfied. So the same instruction ran again, the
  // same wait came back with a fresh countdown, and the cursor did not move:
  // the ArrowRight key did nothing on any blocking instruction, for ever.
  //
  // The seek and test loops never saw it because they call `stepOverWait()`
  // first. This path is the interactive one, and it had no test at all.
  const r = build(stage, sc);
  r.walker.primeToFirstWait();
  // Run frames until something actually blocks, so the assertion is about a
  // real wait rather than a hand-made one.
  for (let i = 0; i < 3000 && !r.walker.wait; i++) advance(r, 1);
  if (!r.walker.wait) continue;
  const at = [r.walker.block, r.walker.step, r.walker.opIndex].join("/");
  r.walker.stepOnce();
  const now = [r.walker.block, r.walker.step, r.walker.opIndex].join("/");
  check(`stage ${stage}: one step past a wait leaves the instruction it was on`,
        now !== at, `still at ${at}`);
  r.ctx.session.dispose();
  break;
}

console.log("\nWhat a save writes is what a load reads:\n");
{
  // **The version constants could not catch a dropped key, so this does.**
  // `SNAPSHOT_VERSION` and `BUNDLE_FORMAT` both sat at 1 from the day they
  // were introduced, through 28 commits to `globals.ts`, every `saveState`
  // shape change there has been, and 23 commits to `bundle.py` that added
  // `coli`, `civilians`, `humanoids` and `set_pieces`. Both checks existed the
  // whole time and neither could ever fire.
  //
  // The shape that actually bites is a key added to `Walker.saveState` and
  // forgotten in `loadState`: the walker keeps whatever the running session
  // had, the snapshot looks like it round-tripped, and the divergence surfaces
  // later as a gameplay bug. `wait` was exactly this once -- a save taken three
  // seconds into a five-second `wait_frames` came back as a fresh five-second
  // one.
  const empty: ScriptJson = { stage: 1, blocks: [] } as unknown as ScriptJson;
  const w = new Walker(empty, mkHost());
  const saved = Object.keys(w.saveState() as Record<string, unknown>).sort();
  const restored = [...WALKER_RESTORED_KEYS, ...WALKER_RESTORED_BY_HAND].sort();
  const dropped = saved.filter((k) => !restored.includes(k as never));
  const phantom = restored.filter((k) => !saved.includes(k));
  check("every key `saveState` writes is one `loadState` reads",
        dropped.length === 0,
        `dropped on load: ${dropped.join(", ")}`);
  check("...and every key `loadState` reads is one `saveState` writes",
        phantom.length === 0,
        `restored but never saved: ${phantom.join(", ")}`);

  // **A slice that is missing is a refusal, not a shrug.** `World.load`'s own
  // docstring has promised to refuse outright since the day it was written --
  // "a half-applied snapshot is indistinguishable from a gameplay bug" -- and
  // the loop underneath it `continue`d past exactly that case, leaving the
  // system with whatever the running game had. With `SNAPSHOT_VERSION` frozen
  // at 1 the version check could not catch it either, so a snapshot that lost
  // a whole system loaded clean.
  const w2 = new World();
  let restoredWith: unknown = "never called";
  w2.add("game", {
    id: "probe",
    save: () => ({ v: 1 }),
    load: (slice: unknown) => { restoredWith = slice; },
  });
  const ctx2 = { stage: 1, frame: 0, rng: new Rng(1) } as unknown as Context;
  const good = w2.save(ctx2);
  check("a whole snapshot loads",
        w2.load(good, ctx2) === null && restoredWith !== "never called");
  restoredWith = "never called";
  const gutted = { ...good, parts: {} };
  const why = w2.load(gutted, ctx2);
  check("one with no slice for a saving system is refused, by name",
        why !== null && why.includes("probe"), String(why));
  check("...and nothing was applied before the refusal",
        restoredWith === "never called", String(restoredWith));
}

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
  // **The world RNG is part of "the same address".** A seek resets `G`, the
  // containers, the session scope and the walker, and for a long time left
  // this alone -- so two seeks to one address from different histories
  // replayed the script identically and then diverged on the first
  // `rng.int()`. Some thirty-five draw sites in the port consume it: which
  // idle a zombie picks, which attack, the start phase of every clip.
  //
  // The cold/warm comparison below could not catch that on its own, and it is
  // worth saying why rather than trusting it: nothing in `DETOUR` frames of
  // these fixtures happens to draw, so both runs reached the seek with the
  // generator still on its seed. Perturbing it first is what makes the
  // assertion real.
  for (let i = 0; i < 7; i++) d.ctx.rng.int(1000);
  const warm = seekInto(d, at);
  check(`stage ${stage}: a seek reseeds the world RNG`,
        d.ctx.rng.state === c.ctx.rng.state,
        `cold ${c.ctx.rng.state}, warm ${d.ctx.rng.state}`);
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

// -- what step 19 put in reach --------------------------------------------

console.log("\nThe shutter and the caption are script state:\n");

{
  const s = script(1);
  if (s) {
    const r = build(1, s);
    // Drive a close by hand: `set_hud_shutter_state 3` is what the script does
    // before a cutscene, and the slide is forty frames.
    r.walker.setShutter(3);
    advance(r, 10);
    const mid = r.world.save(r.ctx);
    const slice = mid.parts.script as Record<string, unknown>;
    check("a shutter mid-close is in the slice",
          slice.shutterState === 3
          && typeof slice.shutterCounter === "number"
          && (slice.shutterCounter as number) > 0
          && (slice.shutterCounter as number) < 40,
          `state ${String(slice.shutterState)}, `
          + `counter ${String(slice.shutterCounter)}`);

    // Run the close out, then put the snapshot back. The old failure was that
    // the state came back and the phase did not, so the bars stopped where
    // they were with nothing driving them.
    advance(r, 60);
    const settled = r.walker.shutterCounter;
    loadInto(r, mid);
    check("and a load restores the phase, not just the state",
          r.walker.shutterState === 3 && r.walker.shutterCounter !== settled
          && r.walker.shutterCounter === (slice.shutterCounter as number),
          `counter came back as ${r.walker.shutterCounter}`);

    // The firing gate is the reason it matters: it drops when the close
    // completes, and the skip offer follows it.
    advance(r, 60);
    check("and the close still completes from there",
          r.walker.shutterState === 4 && !r.walker.firingGate,
          `state ${r.walker.shutterState}, gate ${r.walker.firingGate}`);

    check("the caption countdown is in the slice too",
          "captionGroup" in slice && "captionFrames" in slice);

    // Step 28 moved the HUD strip's shutter row out of `hud/`, where it had
    // its own copy of the label table, and into `app/projection/hud.ts`, where
    // it reads the one in `script/ops/hud.ts` that the feed prints from. The
    // labels themselves are pinned in `test:projection` against a plain
    // object; what this adds is that a **real `Walker`** satisfies what the
    // row reads, and that the word it produces is the word for the state the
    // walker is actually in.
    r.walker.setShutter(3);
    advance(r, 10);
    check("and the strip's shutter row says what the walker is doing",
          describeShutter(r.walker, true) === "closing",
          `read back "${describeShutter(r.walker, true)}"`);
  }
}

if (ran === 0) skipNoBundle("state");
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
