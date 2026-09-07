/**
 * `Walker.seek` reproduces the state it was asked for.
 *
 * This is the check behind reload-and-resume. The player writes its address
 * into the URL as the script plays, and on load `seek` replays the script from
 * the entry block to that address with the waits stepped over. If the replay
 * does not land in the same state the live run was in, a refresh silently
 * moves you somewhere else — a different region streamed in, a different
 * camera, a flag not set — and it looks like a rendering bug rather than a
 * seek bug.
 *
 * So: walk each stage the way playing does, sample addresses along the way,
 * seek back to each one from cold, and compare everything a reload has to
 * reproduce. It runs against the **shipped bundle**, not against hand-written
 * data, which is what makes it able to fail.
 *
 * Run with `npm run test:seek`. Skips cleanly when no bundle is built.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Walker, type WalkerHost } from "../src/script/walker";
import { EvtOpSpawnIfOnePlayer, EvtOpSpawnIfTwoPlayers }
  from "../src/script/ops/spawn";
import { G, ResetGameGlobals, RestoreGameGlobals, type Globals }
  from "../src/game/globals";
import type { OpJson, ScriptJson } from "../src/bundle";
import { seekTo } from "../src/script/seek";
import { BUNDLE_ROOT, finishOrSkip }
  from "../tools/lib/bundle_root";

const ROOT = BUNDLE_ROOT;
const STAGES = [1, 2, 3, 4, 5, 6];
/** Every Nth instruction becomes a sample. Prime, to avoid landing in step. */
const SAMPLE_EVERY = 37;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

/** A host that records nothing: the walker's own state is what is compared. */
const mkHost = (): WalkerHost => ({
  enterRegion: () => undefined,
  loadSlot: () => undefined,
  unloadSlot: () => undefined,
  startCamera: () => undefined,
  onFeed: () => undefined,
  onBranch: () => undefined,
  playSound: () => undefined,
  aliveEnemies: () => null,
  presentEnemies: () => null,
  aliveCivilians: () => null,
  scriptFlagRaised: () => null,
  cameraFree: () => null,
  showMessage: () => null,
  endDialogue: () => undefined,
});

/**
 * Everything a reload has to get right. The address alone is not enough: the
 * region, the streamed slots and the camera are all functions of the whole
 * instruction history, which is exactly why `seek` replays rather than jumps.
 */
function shot(w: Walker): string {
  return JSON.stringify({
    at: [w.block, w.step, w.opIndex],
    region: w.region,
    cam: w.cam && [w.cam.slot, w.cam.startFrame, w.cam.endFrame],
    slots: [...w.loadedSlots].sort((a, b) => a - b),
    // The script flags are `G.g_script_flags` now, not a set on the walker.
    // A seek has to reproduce them exactly, `set_script_flag`'s writes and
    // the postcondition of every `wait_script_flag` it stepped over alike.
    flags: G.g_script_flags
      .map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
    shutter: w.shutterState,
    bgm: w.bgmTrack,
    backdrop: w.backdropPreset,
    fixedEyeY: w.fixedEyeY,
    useFixedEyeY: w.useFixedEyeY,
    rain: w.rain,
    sceneLighting: w.sceneLighting,
    gunLights: w.gunLights,
    checkpoint: w.checkpointBlock,
    // The live actors a reload has to bring back with it. Enemies are here
    // because `wait_enemies_alive` retires them: a seek that carried every
    // enemy the script had ever placed used to arrive with a hundred of them
    // standing behind the camera, and nothing in this snapshot noticed.
    spawns: w.spawns.map((s) => [s.at, s.class]),
  });
}

/** Private members the drive loop needs; the player reaches them through UI. */
type Inner = { executeOne(quiet: boolean): boolean };

/**
 * `saveState` round-trips.
 *
 * Nothing covered this. `test/port.test.ts` checks the **game**'s slice --
 * `G` and the actor pool -- and the walker's own is the other half of a
 * snapshot: the program counter, the flags, the channel tweens, the scene
 * state, the queued-event count. A field added to `saveState` and forgotten in
 * `loadState`'s key list is silent, and so is the reverse.
 *
 * The check is `shot()` plus everything else the two lists carry, because the
 * fingerprint the seek test compares deliberately leaves out the parts a
 * reload does not have to reproduce.
 */
function fullShot(w: Walker): string {
  const s = w.saveState() as Record<string, unknown>;
  // Sets serialise as arrays in `saveState`, and key order follows the
  // literal, so this is stable without sorting.
  return JSON.stringify(s);
}

function checkSnapshotRoundTrip(script: ScriptJson, at: [number, number, number]):
    { ok: boolean; detail: string } {
  // **Both halves.** A snapshot is the walker's state *and* the port's data
  // segment -- `World.load` restores the two together, and the ops write to
  // `G` as they run, so comparing the walker alone would be comparing half a
  // machine. The first draft of this test did exactly that and reported six
  // stages diverging; every one was `G` carried over from the previous run.
  ResetGameGlobals();
  const a = new Walker(script, mkHost());
  if (!seekTo(a, ...at)) return { ok: true, detail: "unreachable" };
  const before = fullShot(a);
  const gBefore = structuredClone(G) as Globals;

  // Into a *fresh* walker, which is the case the player actually runs: a
  // snapshot taken in one session and applied to a stage just loaded.
  ResetGameGlobals();
  const b = new Walker(script, mkHost());
  b.reset();
  b.loadState(JSON.parse(before) as unknown);
  RestoreGameGlobals(structuredClone(gBefore));
  const after = fullShot(b);
  if (before !== after) {
    // Name the first key that differs -- the whole object is unreadable.
    const x = JSON.parse(before) as Record<string, unknown>;
    const y = JSON.parse(after) as Record<string, unknown>;
    const bad = Object.keys(x).find(
      (k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
    return { ok: false, detail: bad
      ? `key "${bad}": ${JSON.stringify(x[bad])} -> ${JSON.stringify(y[bad])}`
      : "differs, but every key matches -- key order?" };
  }

  // And the restored walker must *run* the same, not merely look the same.
  const stepBoth = (w: Walker) => {
    for (let i = 0; i < 500 && !w.finished && !w.parked; i++) {
      if (w.wait) { w.stepOverWait(); continue; }
      if (w.branch) { w.takeBranch(); continue; }
      if (!(w as unknown as Inner).executeOne(true)) break;
    }
    return shot(w);
  };
  // Each run starts from the same data segment, or the second is running
  // against whatever the first left behind.
  RestoreGameGlobals(structuredClone(gBefore));
  const ranA = stepBoth(a);
  RestoreGameGlobals(structuredClone(gBefore));
  const ranB = stepBoth(b);
  return ranA === ranB
    ? { ok: true, detail: "" }
    : { ok: false, detail: `diverged after 500 ops\n      ${ranA}\n      ${ranB}` };
}

console.log("Walker.seek round-trips, against the shipped bundle:\n");

let ran = 0;
for (const stage of STAGES) {
  const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
  if (!existsSync(file)) continue;
  ran++;
  const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;

  // Drive the stage the way playing does, sampling as it goes.
  const live = new Walker(script, mkHost());
  live.reset();
  // This loop is a replay standing in for playback -- it steps over waits
  // instead of satisfying them -- so it has to leave the same state behind as
  // `seek`, and that includes retiring the enemies an enemy gate was waiting
  // on. Playback proper never sets this; see `Walker.replaying`.
  live.replaying = true;
  const samples: { b: number; s: number; o: number; state: string }[] = [];
  for (let i = 0; i < 200_000 && !live.finished && !live.parked; i++) {
    // The same release `seek` uses, so the two paths cannot drift: a wait
    // stepped over has to leave the same state either way.
    if (live.wait) { live.stepOverWait(); continue; }
    if (live.branch) { live.takeBranch(); continue; }
    if (i % SAMPLE_EVERY === 0) {
      samples.push({ b: live.block, s: live.step, o: live.opIndex,
                     state: shot(live) });
    }
    if (!(live as unknown as Inner).executeOne(true)) break;
  }

  let exact = 0, differ = 0, missed = 0;
  let firstDiff = "";
  for (const smp of samples) {
    const w = new Walker(script, mkHost());
    if (!seekTo(w, smp.b, smp.s, smp.o)) { missed++; continue; }
    const got = shot(w);
    if (got === smp.state) { exact++; continue; }
    differ++;
    if (!firstDiff) {
      firstDiff = `at ${smp.b}/${smp.s}/${smp.o}\n      want ${smp.state}` +
                  `\n      got  ${got}`;
    }
  }
  check(`stage ${stage}: all ${samples.length} sampled addresses replay exactly`,
        differ === 0 && missed === 0 && samples.length > 0,
        differ || missed
          ? `${differ} differ, ${missed} unreachable\n      ${firstDiff}`
          : "no samples");
}

// -- no instruction is skipped ----------------------------------------------

/**
 * Every step the walker enters runs its op 0.
 *
 * `advance_step` (0x4F) moves the program counter itself, exactly as
 * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) does — it assigns
 * `DAT_009C7108 = FUN_0045EB90(scene, block, step)`, the address of the new
 * step's *first* instruction. The port used to add an unconditional
 * `opIndex++` after every handler, so that first instruction was stepped over.
 *
 * 460 of the 479 steps in stages 1-6 open with a real instruction, and what
 * went missing was 118 checkpoints, 63 asset loads, 21 `queue_event`s, 12
 * `region_load`s and 8 `region_enter`s. Stage 2 block 17 is where it showed:
 * step 6's `region_enter 32` never ran, so the outdoor geometry arrived a step
 * late, and step 7's `cam_play 231..365` never ran, so the camera clock stuck
 * at frame 230 until the deferred play threw it to 366 — the camera's position
 * jumping 41 units in the doorway.
 *
 * This walks every stage and records, per step entered, the lowest `opIndex`
 * actually executed. Anything but 0 is an instruction the game runs and the
 * player does not.
 */
console.log("\nno step loses its first instruction:");
for (const stage of STAGES) {
  const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
  if (!existsSync(file)) continue;
  const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
  const w = new Walker(script, mkHost());
  w.reset();
  w.replaying = true;
  const lowest = new Map<string, number>();
  for (let i = 0; i < 200_000 && !w.finished && !w.parked; i++) {
    if (w.wait) { w.stepOverWait(); continue; }
    if (w.branch) { w.takeBranch(); continue; }
    const key = `${w.block}/${w.step}`;
    const prev = lowest.get(key);
    if (prev === undefined || w.opIndex < prev) lowest.set(key, w.opIndex);
    if (!(w as unknown as Inner).executeOne(true)) break;
  }
  const skipped = [...lowest].filter(([, o]) => o !== 0);
  check(`stage ${stage}: all ${lowest.size} steps entered run their op 0`,
        skipped.length === 0,
        `${skipped.length} start at a later op, e.g. `
        + skipped.slice(0, 4).map(([k, o]) => `${k} at op ${o}`).join(", "));
}

// -- a deferred resume resumes ----------------------------------------------

/**
 * No `cam_play` ever leaves the camera clock before frame 0.
 *
 * `EvtActionCamPlay40`'s `flags & 2` branch is `FUN_00403490`, and it is not a
 * plain copy of the operands:
 *
 * ```c
 * g_stashed_path_frame = operands[0];
 * if (g_stashed_path_frame == -1)
 *     g_stashed_path_frame = g_cam_path_frame + 1;
 * ```
 *
 * So `start == -1` means "resume" in the deferred branch as well as in
 * `CamStartPathPlayback`. The port stashed the literal -1 and the
 * `finish_sequence 6|7` that followed set the camera to frame -1, off the
 * front of the curve — stage 1 block 8 step 4 op 23 asks to resume at frame
 * 678 of a 685-frame shot and instead replayed all 686 from before the start,
 * once, before carrying on.
 *
 * Four plays in the game name -1 and all four are deferred: stage 1 blocks 3
 * and 8, in the Arcade and Original bundles alike.
 */
console.log("\nno camera play starts before frame 0:");
for (const stage of STAGES) {
  const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
  if (!existsSync(file)) continue;
  const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
  const w = new Walker(script, mkHost());
  w.reset();
  w.replaying = true;
  const bad: string[] = [];
  for (let i = 0; i < 200_000 && !w.finished && !w.parked; i++) {
    if (w.wait) { w.stepOverWait(); continue; }
    if (w.branch) { w.takeBranch(); continue; }
    const at = `${w.block}/${w.step}/${w.opIndex}`;
    if (!(w as unknown as Inner).executeOne(true)) break;
    if (w.cam && (w.cam.startFrame < 0 || w.cam.frame < 0)) {
      bad.push(`${at} -> ${w.cam.startFrame}..${w.cam.endFrame}`);
    }
  }
  check(`stage ${stage}: every play starts inside its path`, bad.length === 0,
        `${bad.length} start before frame 0, e.g. ${bad.slice(0, 3).join(", ")}`);
}

// The site the report came from, named: stage 1's block 8 step 4 op 23 is a
// deferred play that says -1, and op 24 hands it to the rail hook.
{
  const file = join(ROOT, "stage1", "stage1.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    const w = new Walker(script, mkHost());
    const arrived = seekTo(w, 8, 4, 25);
    check("a deferred `start == -1` resumes forward, it does not rewind",
          arrived && !!w.cam && w.cam.slot === 44 && w.cam.startFrame > 500
            && w.cam.endFrame === 685,
          `cam ${w.cam?.slot} ${w.cam?.startFrame}..${w.cam?.endFrame}`);
  }
}

// An address the script cannot reach must be reported, not silently swapped
// for wherever the replay happened to stop.
{
  const file = join(ROOT, "stage2", "stage2.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    const w = new Walker(script, mkHost());
    // A block that does not exist. Note this has to be a *made-up* block now:
    // the seek steers branches toward its goal, so almost every real block is
    // reachable — including the ones behind the fork the script does not take
    // by default, which is where stage 2 keeps the falling containers.
    check("an unreachable address returns false rather than pretending",
          seekTo(w, 9999, 1, 0) === false);
    const w2 = new Walker(script, mkHost());
    check("a reachable address returns true", seekTo(w2, 11, 8, 2) === true);
    // The point of the steering, stated as a check: block 18 is behind block
    // 14's second fork and `branchChoice` defaults to the first.
    const w3 = new Walker(script, mkHost());
    check("an address behind the branch the script does not take by default",
          seekTo(w3, 18, 4, 7) === true);
  }
}

// The branch itself: who decides it, and how long the decision survives.
//
// `g_script_branch_var` is cleared on **every step advance**, not on every
// block change -- the store is on `EvtAdvanceStepOrRoute`'s normal return
// path, after `pc = EvtGetStep(...)`. This walker used to clear it only on a
// block change, which is why a value written by gameplay could sit there for
// a whole block and steer a route it was never meant to reach.
{
  const file = join(ROOT, "stage2", "stage2.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;

    // Find a block with more than one step, so a step advance can be watched
    // that is not also a block change.
    const w = new Walker(script, mkHost());
    seekTo(w, 11, 1, 0);
    const steps = w.currentBlock?.steps?.length ?? 0;
    check("stage 2 block 11 has steps to advance through", steps > 2,
          `${steps} steps`);
    w.branchChoice = 2;
    w.advanceStepOrRoute(true);
    check("a step advance inside a block clears the branch variable",
          w.block === 11 && G.g_script_branch_var === 0,
          `block ${w.block}, var ${G.g_script_branch_var}`);

    // ...and the walker's field and the data segment are one thing, as they
    // are in the engine. A second copy is how the two could ever disagree.
    w.branchChoice = 1;
    check("`Walker.branchChoice` is `G.g_script_branch_var`",
          G.g_script_branch_var === 1 && w.branchChoice === 1,
          `${w.branchChoice} vs ${G.g_script_branch_var}`);
  }
}

// An unanswered branch takes the route the *game* took. This used to be
// `Math.min(...targets)` -- the lowest block number -- a stand-in from before
// anything had read the engine's selector.
{
  const file = join(ROOT, "stage1", "stage1.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    // Block 1 branches to 10 or 9. The lowest block number is 9 and
    // `next[0]` is 10, so the old rule and the engine's disagree here --
    // which is what makes this able to fail.
    const route = script.routes[1];
    check("stage 1 block 1 is the branch where the two rules disagree",
          route?.kind === "branch" && route.next[0] === 10
            && route.next[1] === 9,
          JSON.stringify(route));

    const w = new Walker(script, mkHost());
    seekTo(w, 1, 1, 0);
    G.g_script_branch_var = 0;
    w.branch = { block: 1, targets: [10, 9], choice: 0, countdown: 1.5,
                 preview: null };
    w.takeBranch();
    check("nobody rescued: the branch takes next[0], not the lowest block",
          w.block === 10, `landed in block ${w.block}`);

    // The whole point of the port: a civilian's `SetRouteBranch 1` is what
    // sends the stage the other way.
    const w2 = new Walker(script, mkHost());
    seekTo(w2, 1, 1, 0);
    G.g_script_branch_var = 1;
    w2.branch = { block: 1, targets: [10, 9], choice: G.g_script_branch_var,
                  countdown: 1.5, preview: null };
    w2.takeBranch();
    check("a rescue at 1 sends it down the other route", w2.block === 9,
          `landed in block ${w2.block}`);

    // And the override still wins, which is what the 1.5 s window is for.
    const w3 = new Walker(script, mkHost());
    seekTo(w3, 1, 1, 0);
    G.g_script_branch_var = 1;
    w3.branch = { block: 1, targets: [10, 9], choice: 1, countdown: 1.5,
                  preview: null };
    w3.takeBranch(10);
    check("a viewer's override beats the game's own choice", w3.block === 10,
          `landed in block ${w3.block}`);
  }
}

// The enemy gate's postcondition, as a check that can fail: past a
// `wait_enemies_alive` every enemy placed before it is dead, so a seek into
// the back half of a stage must not arrive with the front half's enemies
// still standing. Stage 2 places 104 zombies and 20 throwers across 42
// blocks. Spawn markers are already dropped on a block change, so what this
// catches is the accumulation *within* one block: stage 2's block 17 spawns
// zombies in step 3 and again in steps 5 and 7, with a gate between each, and
// a seek to step 8 used to arrive with all three waves standing.
{
  const file = join(ROOT, "stage2", "stage2.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    /** The classes that move an enemy counter, from `docs/formats/spawns.md`. */
    const ENEMY = new Set([0x11, 0x14, 0x19, 0x30, 0x31, 0x32, 0x40, 0x43,
                           0x51]);
    const w = new Walker(script, mkHost());
    const arrived = seekTo(w, 17, 8, 29);
    const live = w.spawns.filter((s) => ENEMY.has(s.class));
    const stale = live.filter((s) => s.step < 8);
    check("a seek past an enemy gate leaves no enemy from before it",
          arrived && stale.length === 0,
          `${live.length} enemy spawns live, ${stale.length} from earlier ` +
          `steps: ${[...new Set(stale.map((s) => s.step))].join(", ")}`);
    // ...and it must not throw away what the gate says nothing about.
    const props = w.spawns.filter((s) => s.class === 0x41 || s.class === 0x44);
    check("the gate retires enemies only, not the props placed with them",
          props.length > 0, `${props.length} container placers survived`);
  }
}

// ...and the other half of that rule: **playback must not do it.** The gate
// opens in play because the player killed them, and the death clips are still
// running -- `FUN_00454D20` plays one out before handing the body on. Sweeping
// the list there made every corpse vanish the instant the last enemy died.
{
  const file = join(ROOT, "stage2", "stage2.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    const gate = { i: 0, at: 0, op: 0x43, name: "wait_enemies_present",
                   cat: "wait", arg: 0 } as unknown as OpJson;
    const spawn = { at: 1, class: 0x30, flags: 0, pos: [0, 0, 0] as
                    [number, number, number], orient: [0, 0, 0] as
                    [number, number, number], hp: 1, yaw_deg: 0,
                    desc_flags: 0,
                    block: 0, step: 0, opIndex: 0, opcode: 9 };

    // **The gate blocks first, whatever the count says.** Every wait opcode
    // but `0x40` opens `if (g_evt_yield == 0) { g_evt_yield = 1; return; }`,
    // so `applyWait` is the engine's first visit and never reads the
    // condition; the release is a *later* frame, which for a replay is
    // `stepOverWait`. Handing `applyWait` a dead room and expecting it to walk
    // straight through was the shape of B4/B8.
    const play = new Walker(script, { ...mkHost(), presentEnemies: () => 0 });
    play.spawns = [{ ...spawn }];
    play.applyWait(gate);
    check("the enemy gate blocks on the frame it is reached, dead room or not",
          play.wait?.policy.kind === "enemies",
          `policy ${play.wait?.policy.kind ?? "none"}`);

    // Playback: the gate opens and the corpses stay. The same release call as
    // the replay below, because the guard being tested is `replaying` itself —
    // `retireGated` returns at once without it. (`tick` is the real playback
    // release and does not retire at all; it also runs on into the next
    // instructions, which is why it is not what this asserts against.)
    play.stepOverWait();
    check("playback keeps the bodies when the gate opens",
          play.spawns.length === 1, `${play.spawns.length} left`);

    // The same release during a replay, where nothing killed anything.
    const replay = new Walker(script, { ...mkHost(), presentEnemies: () => 0 });
    replay.replaying = true;
    replay.spawns = [{ ...spawn }];
    replay.applyWait(gate);
    replay.stepOverWait();
    check("a replay retires them, because nothing else will",
          replay.spawns.length === 0, `${replay.spawns.length} left`);

    // **And the civilian gate does the same for what *it* counts.** It did
    // not, because which waits retire was a second hard-coded set of opcode
    // numbers next to the rule table rather than a field on the rule. So a
    // seek that stepped over `wait_scripted_actors` carried the previous
    // scene's hostages into the block it landed in, where they were spawned,
    // counted in `g_civilians_alive`, and held the *next* one of these open.
    const civGate = { i: 0, at: 0, op: 0x46, name: "wait_scripted_actors",
                      cat: "wait", arg: 0 } as unknown as OpJson;
    const civ = { at: 0x4AE4, class: 0x10, pos: [0, 0, 0] as [number, number, number] };
    const civReplay = new Walker(script, { ...mkHost(), aliveCivilians: () => 0 });
    civReplay.replaying = true;
    civReplay.spawns = [{ ...civ } as never, { ...spawn }];
    civReplay.applyWait(civGate);
    civReplay.stepOverWait();
    check("a replay retires the civilians the civilian gate counts",
          civReplay.spawns.length === 1
          && civReplay.spawns[0]?.class === spawn.class,
          `${civReplay.spawns.length} left`);

    // ...and only those. An enemy standing next to a rescued hostage is not
    // what this gate is about.
    const civPlay = new Walker(script, { ...mkHost(), aliveCivilians: () => 0 });
    civPlay.spawns = [{ ...civ } as never];
    civPlay.applyWait(civGate);
    civPlay.stepOverWait();
    check("playback keeps them, as the enemy gate does",
          civPlay.spawns.length === 1, `${civPlay.spawns.length} left`);
  }
}

// The room-clear gates need the camera back, not just the count at zero.
// `EvtOpWaitEnemiesPresent43` / `44` / `46` all test `g_camera_free`
// (0x009C6F2D) as well as their counter, so the script holds through the swing
// back onto the rail after the last enemy dies. Without it every room hands
// over on the death frame.
{
  const file = join(ROOT, "stage2", "stage2.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    for (const [op, name] of [[0x43, "wait_enemies_present"],
                              [0x44, "wait_enemies_alive"],
                              [0x46, "wait_scripted_actors"]] as [number, string][]) {
      const gate = { i: 0, at: 0, op, name, cat: "wait", arg: 0 } as unknown as OpJson;
      const host = { ...mkHost(), aliveEnemies: () => 0, presentEnemies: () => 0,
                     aliveCivilians: () => 0 };

      const swinging = new Walker(script, { ...host, cameraFree: () => false });
      swinging.applyWait(gate);
      swinging.tick(1 / 60);
      check(`0x${op.toString(16)} holds while the camera is still claimed`,
            swinging.wait !== null,
            "passed on the death frame");

      // ...and the frame it is *reached* is never the frame it passes: the
      // condition is not read until the visit after the yield. `0x44` costs a
      // second one on top, for `g_evt_wait_alive_hysteresis`.
      const back = new Walker(script, { ...host, cameraFree: () => true });
      back.applyWait(gate);
      check(`0x${op.toString(16)} yields the frame it is reached`,
            back.wait !== null, "passed on its own frame");
      back.tick(1 / 60);
      // `0x44` costs one more: `g_evt_wait_alive_hysteresis` is 0 on the first
      // evaluation, so that one only increments it.
      if (op === 0x44) back.tick(1 / 60);
      // Releasing does not leave the walker idle — it runs on to the *next*
      // wait in the same frame, exactly as the interpreter's
      // `do { } while (g_evt_yield == 0)` does. So the check is that this gate
      // is gone, not that nothing is pending.
      check(`0x${op.toString(16)} passes once the camera is back on its rail`,
            back.wait?.op.op !== op,
            `still on 0x${back.wait?.op.op.toString(16) ?? "-"}`);
    }

    // And it releases a gate already held, the frame the camera comes back.
    const gate = { i: 0, at: 0, op: 0x43, name: "wait_enemies_present",
                   cat: "wait", arg: 0 } as unknown as OpJson;
    let free = false;
    const w = new Walker(script, { ...mkHost(), aliveEnemies: () => 0,
                                   presentEnemies: () => 0,
                                   aliveCivilians: () => 0,
                                   scriptFlagRaised: () => null,
                                   cameraFree: () => free });
    w.applyWait(gate);
    w.tick(1 / 60);
    const held = w.wait?.policy.kind === "enemies";
    const heldAt = `${w.block}/${w.step}/${w.opIndex}`;
    free = true;
    w.tick(1 / 60);
    const movedTo = `${w.block}/${w.step}/${w.opIndex}`;
    check("a gate held by the camera releases when the swing finishes",
          held && w.wait?.policy.kind !== "enemies" && movedTo !== heldAt,
          `held at ${heldAt}, now ${w.wait?.policy.kind ?? "idle"} at ${movedTo}`);
  }
}

// `wait_scripted_actors` (0x46) is `EvtOpWaitScriptedActors46`
// (`FUN_0045FCD0`): the `wait_enemies_present` handler with
// `g_civilians_alive` in place of `g_enemies_present`. It has to behave like
// the enemy gate -- block on a live count, pass on a dead one -- and not like
// the pass-through it used to be, or a stage that waits for its hostages to be
// rescued runs straight past them.
{
  const file = join(ROOT, "stage2", "stage2.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    // Every one of the 68 sites in the shipped scripts passes operand 0.
    const gate = { i: 0, at: 0, op: 0x46, name: "wait_scripted_actors",
                   cat: "wait", arg: 0 } as unknown as OpJson;

    const held = new Walker(script, { ...mkHost(), aliveCivilians: () => 2 });
    held.applyWait(gate);
    check("the civilian gate holds while civilians are in play",
          held.wait !== null && held.wait.policy.kind === "civilians",
          `policy ${held.wait?.policy.kind ?? "none"}`);

    const open = new Walker(script, { ...mkHost(), aliveCivilians: () => 0 });
    open.applyWait(gate);
    check("the civilian gate yields the frame it is reached, empty or not",
          open.wait?.policy.kind === "civilians",
          `policy ${open.wait?.policy.kind ?? "none"}`);
    open.tick(1 / 60);
    check("the civilian gate opens when the last one has left",
          open.wait?.op.op !== 0x46,
          `still on 0x${open.wait?.op.op.toString(16) ?? "-"}`);

    // The count falling is what releases a gate already held -- the walker
    // re-tests every frame, exactly as the interpreter re-runs the handler.
    let alive = 2;
    const falling = new Walker(script, { ...mkHost(), aliveCivilians: () => alive });
    falling.applyWait(gate);
    falling.tick(1 / 60);
    const stillHeld = falling.wait?.policy.kind === "civilians";
    const heldAt = `${falling.block}/${falling.step}/${falling.opIndex}`;
    alive = 0;
    falling.tick(1 / 60);
    const movedTo = `${falling.block}/${falling.step}/${falling.opIndex}`;
    // Releasing does not leave the walker idle: it runs straight on into the
    // instructions after the gate and stops at the *next* wait, which is what
    // the interpreter does too -- a satisfied wait clears the yield flag and
    // the `do { } while (yield == 0)` loop keeps dispatching in the same
    // frame. So the check is that the civilian gate is gone, not that no wait
    // is pending.
    // Progress is the address changing, not the op index rising: the walker
    // runs on to whatever comes next, and that can be a new step or a branch
    // prompt, both of which sit at op 0.
    check("a held civilian gate releases when the count reaches zero",
          stillHeld && falling.wait?.policy.kind !== "civilians"
          && movedTo !== heldAt,
          `held at ${heldAt}, now ${falling.wait?.policy.kind ?? "idle"} `
          + `at ${movedTo}`);

    // Shoot off: nothing can rescue a civilian, so the gate is not a condition
    // this client can evaluate and it passes rather than deadlocking.
    const noSim = new Walker(script, { ...mkHost(), aliveCivilians: () => null });
    noSim.applyWait(gate);
    check("with no simulation the civilian gate passes instead of hanging",
          noSim.wait === null);
  }
}

// **B4 and B8, end to end, against the shipped script.**
//
// "Camera doesn't seem to wait for zombies to die before advancing", and "the
// two later zombies that drop from the high ledge don't pause the camera --
// the game advances while the two are dropping".
//
// Stage 1 block 4 step 5 is the shape both reports found: `spawn_placed`,
// `set_script_flag`, `spawn_obj` (two class-0x30 on the ledge at y = 61),
// `queue_event`, `wait_enemies_alive 0`. There is nothing between the spawn
// and the gate, and the port makes the actors in `syncCharacterSpawns` --
// *between* `walker.tick()` and `GameUpdate()` -- so on the tick that runs the
// spawn instruction the counter is still zero. `EvtOpWaitEnemiesAlive44`
// (`FUN_0045FC10`) cannot answer on that frame: `g_evt_yield` is clear, so it
// sets the flag and returns without reading the count.
//
// The host below is that race, made explicit: it answers zero for the whole of
// the first tick, exactly as a host asked before the character layer has run
// would. Everything after block 4 step 5 in stage 1 hangs on this.
{
  const file = join(ROOT, "stage1", "stage1.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    // The counter the character layer will raise once the tick is over.
    let alive = 0;
    const w = new Walker(script, { ...mkHost(),
                                   aliveEnemies: () => alive,
                                   presentEnemies: () => alive,
                                   cameraFree: () => true });
    const ok = seekTo(w, 4, 5, 0);
    // One tick: the spawns are pushed and the gate is reached, both inside it.
    w.tick(1 / 60);
    check("the ledge-drop gate does not pass on the frame the spawn ran",
          ok && w.wait?.op.op === 0x44 && w.step === 5,
          `wait 0x${w.wait?.op.op.toString(16) ?? "-"}`
          + ` at ${w.block}/${w.step}/${w.opIndex}`);
    check("...and the two ledge zombies are the spawns it is holding for",
          w.spawns.filter((s) => s.class === 0x30
                          && (s.pos?.[1] ?? 0) > 50).length === 2,
          `${w.spawns.filter((s) => s.class === 0x30).length} class-0x30 spawns`);

    // Now the character layer has run and they are counted: the gate holds.
    alive = 2;
    for (let i = 0; i < 120; i++) w.tick(1 / 60);
    check("...and goes on holding for the whole descent",
          w.wait?.op.op === 0x44 && w.step === 5,
          `wait 0x${w.wait?.op.op.toString(16) ?? "-"}`
          + ` at ${w.block}/${w.step}/${w.opIndex}`);

    // Killing them opens it, which is the other half: a gate that can never
    // pass is the same bug facing the other way.
    alive = 0;
    w.tick(1 / 60);
    w.tick(1 / 60);
    check("...and opens once they are dead",
          w.step !== 5 || w.wait?.op.op !== 0x44,
          `still at ${w.block}/${w.step}/${w.opIndex}`);
  }
}

// The player-count gate on the spawn opcodes: `EvtOpSpawnIfOnePlayer`
// (`FUN_00408820`) and `EvtOpSpawnIfTwoPlayers` (`FUN_00408860`). Stage 1's
// opening encounter is placed by `0x07` over three class-0x30 descriptors and
// then `0x03` over the last two of that same three, so exactly two zombies
// arrive in a one-player game and three in a two-player one. Both opcodes were
// unimplemented, and the two of them are the *only* thing that places those
// zombies -- which is why nothing at all came round that corner.
{
  const file = join(ROOT, "stage1", "stage1.script.json");
  if (existsSync(file)) {
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    const block = script.blocks.find((b) => b.index === 0);
    const step = block?.steps?.find((st) => st.index === 2);
    const gated = (step?.ops ?? []).filter((o) => o.op === 0x03 || o.op === 0x07);

    check("stage 1's opening encounter is behind the player-count gate",
          gated.length === 2 && gated[0].op === 0x07 && gated[1].op === 0x03,
          gated.map((o) => o.name).join(", ") || "none found");

    // The bundle has to carry the descriptors, or the gate has nothing to
    // let through: `evt.SPAWN_OPCODES` stopped at the ungated four until the
    // forward table said these were the same descriptors.
    check("...and the bundle resolves their descriptors",
          gated.length === 2
          && gated[0].spawns?.length === 3 && gated[1].spawns?.length === 2,
          `${gated[0]?.spawns?.length} then ${gated[1]?.spawns?.length}`);
    check("...as class-0x30 zombies",
          (gated[0]?.spawns ?? []).every((s) => s.class === 0x30));

    const run = (players: number): number => {
      const w = new Walker(script, mkHost());
      const was = G.g_max_attackers;
      G.g_max_attackers = players;
      try {
        for (const op of gated) {
          if (op.op === 0x07) EvtOpSpawnIfTwoPlayers(w, op);
          else EvtOpSpawnIfOnePlayer(w, op);
        }
      } finally { G.g_max_attackers = was; }
      return w.spawns.filter((s) => s.class === 0x30).length;
    };

    check("one player gets the two zombies 0x03 lists", run(1) === 2,
          `${run(1)} spawned`);
    // Not 3 + 2: the second player adds one, it does not double the set.
    check("two players get the three 0x07 lists, and no more", run(2) === 3,
          `${run(2)} spawned`);
  }
}

// The action ring, driven for real. `wait_queued_events_done` (0x40) is
// `g_queued_events_pending == 0`, and the walker now keeps that count rather
// than resolving on "the camera move ended" -- so a miscounted action handler
// is a script that parks for ever instead of one that runs a little early.
// This drives every stage on the clock, the way playing does, and the thing it
// is really checking is that none of them deadlock.
{
  for (const stage of STAGES) {
    const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
    if (!existsSync(file)) continue;
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    // Everything already dead, so the combat gates never hold: what is left
    // holding the script is the camera and the ring.
    const w = new Walker(script, { ...mkHost(), aliveEnemies: () => 0,
                                   aliveCivilians: () => 0 });
    const CAP = 60 * 60 * 20;            // twenty simulated minutes
    const STALL = 60 * 60 * 5;           // five on one instruction is a park
    let frames = 0, stalls = 0, at = "";
    let negative = false;
    while (!w.finished && frames < CAP) {
      if (w.branch) w.takeBranch(0);
      w.tick(1 / 60);
      frames++;
      if (w.queuedEventsPending < 0) negative = true;
      const now = `${w.block}/${w.step}/${w.opIndex}`;
      if (now === at) { if (++stalls > STALL) break; } else { stalls = 0; at = now; }
    }
    check(`stage ${stage}: the script runs to the end on the clock`,
          w.finished, stalls > STALL
            ? `parked at ${at} on ${w.wait ? `wait 0x${w.wait.op.op.toString(16)}`
               + ` (${w.wait.policy.kind}), pending ${w.queuedEventsPending}` : "no wait"}`
            : `only reached ${at} in ${frames} frames`);
    // The check above is the sharp one: dropping `goto_scene_state`'s
    // retirement parks all six stages on a `wait_queued_events_done` within
    // the first few blocks, because the count never falls back to zero.
    //
    // This one is the structural complement. `FUN_0045EBC0` zeroes the count
    // when it loads a block, so the engine absorbs a residue silently; if the
    // port retires every action from the right instruction, that reset is a
    // no-op and the ring is *already* empty at each transition. It is, in all
    // six stages -- which is a statement about the script's shape, not about
    // the port agreeing with itself.
    check(`stage ${stage}: the action ring balances`,
          !negative && w.ringResidue === 0 && w.queuedEventsPending === 0,
          `${w.ringResidue} block(s) ended owing an action, ended on `
          + `${w.queuedEventsPending}${negative ? ", went negative" : ""}`);
  }
}

// Reload, then play on. This is the shape the action-ring count actually
// broke in: `seek` and `stepOnce` run instructions with **no clock**, so a
// block's worth of `cam_play`s all queued without any of them ever reaching
// the end of a path. The retirement was tracked in a single boolean, so all
// but the last were lost and the count never fell back to zero -- a reload
// into most of the game then parked for ever on the next
// `wait_queued_events_done`. 138 of these 308 addresses were stuck.
//
// Driving the whole script from cold cannot see it, because ticking retires
// each camera as it goes. Only replaying without a clock and *then* playing
// does, which is exactly what the player does on load.
{
  for (const stage of STAGES) {
    const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
    if (!existsSync(file)) continue;
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;

    // Every block/step a reload can land on -- the address the player puts in
    // the URL is a block and a step.
    const addrs: [number, number][] = [];
    for (const blk of script.blocks ?? []) {
      if (blk.hole || !blk.steps) continue;
      for (let s = 1; s < blk.steps.length; s++) addrs.push([blk.index, s]);
    }

    let stuck = 0, seeks = 0, worst = "";
    for (const [b, s] of addrs) {
      const v = new Walker(script, { ...mkHost(), aliveEnemies: () => 0,
                                     aliveCivilians: () => 0 });
      if (!seekTo(v, b, s, 0)) continue;
      seeks++;
      let at = "", stalls = 0;
      for (let i = 0; i < 60 * 60 * 8 && !v.finished; i++) {
        if (v.branch) v.takeBranch(0);
        v.tick(1 / 60);
        const p = `${v.block}/${v.step}/${v.opIndex}`;
        if (p === at) { if (++stalls > 60 * 90) break; } else { stalls = 0; at = p; }
      }
      if (!v.finished) {
        stuck++;
        if (!worst) {
          worst = `${b}/${s} parked at ${v.block}/${v.step}/${v.opIndex} on `
            + `${v.wait ? `0x${v.wait.op.op.toString(16)} (${v.wait.policy.kind})`
                        : "no wait"}, pending ${v.queuedEventsPending}`;
        }
      }
    }
    check(`stage ${stage}: every reload point still plays to the end`,
          stuck === 0, `${stuck} of ${seeks} stuck -- ${worst}`);
  }
}

// `g_evt_step_index` (0x009A2BB0) is the event VM's step cursor, and a prop's
// lifetime is counted in *changes* to it -- see `PropExpireByStepLifetime`.
// The port used to keep a separate monotonic counter here, bumped once per
// block, so props aged about four times too slowly. These drive the shipped
// scripts and check the counter has the shape the engine gives it.
{
  for (const stage of STAGES) {
    const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
    if (!existsSync(file)) continue;
    const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
    const w = new Walker(script, { ...mkHost(), aliveEnemies: () => 0,
                                   aliveCivilians: () => 0 });
    w.reset();
    w.replaying = true;

    let prevIdx = G.g_evt_step_index, prevBlock = w.block;
    let idxChanges = 0, blockChanges = 0, resetsToOne = 0, monotonic = true;
    let cursorAgrees = true;
    for (let i = 0; i < 200_000 && !w.finished && !w.parked; i++) {
      if (w.wait) { w.stepOverWait(); continue; }
      if (w.branch) { w.takeBranch(); continue; }
      if (!(w as unknown as Inner).executeOne(true)) break;
      // The cursor and the global are one field; if that ever stops being
      // true, the bug this replaced is back.
      if (w.step !== G.g_evt_step_index) cursorAgrees = false;
      if (G.g_evt_step_index !== prevIdx) {
        idxChanges++;
        if (G.g_evt_step_index < prevIdx) monotonic = false;
        if (w.block !== prevBlock && G.g_evt_step_index === 1) resetsToOne++;
        prevIdx = G.g_evt_step_index;
      }
      if (w.block !== prevBlock) { blockChanges++; prevBlock = w.block; }
    }

    check(`stage ${stage}: the step cursor and g_evt_step_index are one field`,
          cursorAgrees);
    // The whole point: it moves far more often than the block does. If these
    // were equal the port would be back to counting blocks.
    check(`stage ${stage}: the step index moves oftener than the block does`,
          idxChanges > blockChanges,
          `${idxChanges} index changes vs ${blockChanges} block changes`);
    // `EvtAdvanceStepOrRoute` assigns 1 in the route branch, so it is a
    // cursor and not a tally -- a monotonic run means the reset was lost.
    check(`stage ${stage}: it drops back to 1 on a block change, not upward`,
          !monotonic && resetsToOne > 0,
          `${resetsToOne} resets to 1 over ${blockChanges} block changes`);
    console.log(`        stage ${stage}: ${idxChanges} step-index changes over `
                + `${blockChanges} block changes `
                + `(${(idxChanges / Math.max(1, blockChanges)).toFixed(2)}x)`);
  }
}

// -- the walker's own snapshot ---------------------------------------------

console.log("\nWalker.saveState round-trips, and the restored walker runs the "
            + "same:\n");

for (const stage of STAGES) {
  const file = join(ROOT, `stage${stage}`, `stage${stage}.script.json`);
  if (!existsSync(file)) continue;
  const script = JSON.parse(readFileSync(file, "utf8")) as ScriptJson;
  // Three depths: the entry, something early enough to be reachable in every
  // stage, and something deep enough to have channel tweens and a scene state.
  const spots: [number, number, number][] = [[0, 1, 0], [4, 1, 0], [11, 2, 0]];
  let bad = "";
  let done = 0;
  for (const at of spots) {
    const r = checkSnapshotRoundTrip(script, at);
    if (r.detail === "unreachable") continue;
    done++;
    if (!r.ok && !bad) bad = `${at.join("/")}: ${r.detail}`;
  }
  check(`stage ${stage}: ${done} snapshots round-trip and replay identically`,
        !bad, bad);
}

finishOrSkip("seek", failures, ran);
