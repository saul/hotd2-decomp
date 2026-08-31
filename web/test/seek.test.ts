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

if (ran === 0) {
  console.log("  no bundle under extract/player -- run tools/export_player.py");
  process.exit(0);
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
