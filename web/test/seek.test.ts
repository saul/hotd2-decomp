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
import type { ScriptJson } from "../src/bundle";

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
  });
}

/** Private members the drive loop needs; the player reaches them through UI. */
type Inner = { opIndex: number; executeOne(quiet: boolean): boolean };

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
  const samples: { b: number; s: number; o: number; state: string }[] = [];
  for (let i = 0; i < 200_000 && !live.finished && !live.parked; i++) {
    if (live.wait) {
      live.wait = null;
      (live as unknown as Inner).opIndex++;
      continue;
    }
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
    // Stage 2's route runs 0 -> 11 -> ... ; block 3 is never entered, and a
    // block is always entered at step 1, so step 0 is unreachable too.
    check("an unreachable address returns false rather than pretending",
          w.seek(3, 1, 0) === false);
    const w2 = new Walker(script, mkHost());
    check("a reachable address returns true", w2.seek(11, 8, 2) === true);
  }
}

if (ran === 0) {
  console.log("  no bundle under extract/player -- run tools/export_player.py");
  process.exit(0);
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
