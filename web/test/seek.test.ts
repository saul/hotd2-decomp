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
import { G } from "../src/game/globals";
import type { OpJson, ScriptJson } from "../src/bundle";

const ROOT = join(process.env.HOME ?? "", "hotd2-decomp", "extract", "player");
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
  setShutter: () => undefined,
  showMessage: () => undefined,
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
    flags: [...w.flags].sort((a, b) => a - b),
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
    if (!w.seek(smp.b, smp.s, smp.o)) { missed++; continue; }
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
    const arrived = w.seek(8, 4, 25);
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
          w.seek(9999, 1, 0) === false);
    const w2 = new Walker(script, mkHost());
    check("a reachable address returns true", w2.seek(11, 8, 2) === true);
    // The point of the steering, stated as a check: block 18 is behind block
    // 14's second fork and `branchChoice` defaults to the first.
    const w3 = new Walker(script, mkHost());
    check("an address behind the branch the script does not take by default",
          w3.seek(18, 4, 7) === true);
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
    const arrived = w.seek(17, 8, 29);
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
                    block: 0, step: 0, opIndex: 0, opcode: 9 };

    // Playback, with the last enemy just killed: the gate opens and the
    // corpses stay.
    const play = new Walker(script, { ...mkHost(), aliveEnemies: () => 0 });
    play.spawns = [{ ...spawn }];
    play.applyWait(gate);
    check("playback keeps the bodies when the gate opens",
          play.spawns.length === 1, `${play.spawns.length} left`);

    // The same call during a replay, where nothing killed anything.
    const replay = new Walker(script, { ...mkHost(), aliveEnemies: () => 0 });
    replay.replaying = true;
    replay.spawns = [{ ...spawn }];
    replay.applyWait(gate);
    check("a replay retires them, because nothing else will",
          replay.spawns.length === 0, `${replay.spawns.length} left`);
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
    check("the civilian gate opens when the last one has left",
          open.wait === null);

    // The count falling is what releases a gate already held -- the walker
    // re-tests every frame, exactly as the interpreter re-runs the handler.
    let alive = 2;
    const falling = new Walker(script, { ...mkHost(), aliveCivilians: () => alive });
    falling.applyWait(gate);
    falling.tick(1 / 60);
    const stillHeld = falling.wait?.policy.kind === "civilians";
    alive = 0;
    falling.tick(1 / 60);
    // Releasing does not leave the walker idle: it runs straight on into the
    // instructions after the gate and stops at the *next* wait, which is what
    // the interpreter does too -- a satisfied wait clears the yield flag and
    // the `do { } while (yield == 0)` loop keeps dispatching in the same
    // frame. So the check is that the civilian gate is gone, not that no wait
    // is pending.
    check("a held civilian gate releases when the count reaches zero",
          stillHeld && falling.wait?.policy.kind !== "civilians"
          && falling.opIndex > 0,
          `now ${falling.wait?.policy.kind ?? "idle"} at op ${falling.opIndex}`);

    // Shoot off: nothing can rescue a civilian, so the gate is not a condition
    // this client can evaluate and it passes rather than deadlocking.
    const noSim = new Walker(script, { ...mkHost(), aliveCivilians: () => null });
    noSim.applyWait(gate);
    check("with no simulation the civilian gate passes instead of hanging",
          noSim.wait === null);
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

if (ran === 0) {
  console.log("  no bundle under extract/player -- run tools/export_player.py");
  process.exit(0);
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
