/**
 * Every `wait_camera_path_frame <n>` asks for a frame its own play publishes.
 *
 *     cd web && node tools/run_ts.mjs tools/checks/cam_waits.ts
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/cam_waits.ts
 *
 * `EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`) advances the instruction
 * pointer only when the frame is **past** the operand:
 *
 *     0045fae7  CMP dword ptr [0x009a6110],EAX     ; g_cam_path_frame, operand
 *     0045faed  JLE 0045fb29                       ; frame <= operand: keep waiting
 *
 * so the wait needs frame `operand + 1` to be published. Which frames a play
 * publishes depends on *how* it is played, and the three ways differ at both
 * ends -- this is the arithmetic the port transcribes, and the only thing that
 * can say the shipped scripts agree with it:
 *
 * | routine                                      | installed by          | publishes      |
 * |----------------------------------------------|-----------------------|----------------|
 * | `CamAdvancePathFrame` (`FUN_004035E0`)       | `cam_play`            | start..end     |
 * | `CameraStepRailTick` (`FUN_0040C790`)        | scene state `(2,6)`   | start+1..end   |
 * | `CameraPlayStashedPath` (`FUN_0040C8A0`)     | scene state `(2,7)`   | start+1..end+1 |
 *
 * Both stashed routines increment before they publish, which is why they step
 * past their start frame; they differ by one byte of guard -- `JGE` at
 * `0x0040C7A0` against `JG` at `0x0040C8C0` -- which is why state 7 carries
 * one frame beyond the range's end. `[proved]`
 *
 * **Why this is a check and not a comment.** A strict wait that asks for a
 * frame nothing publishes is a hang, and the port is strict because the
 * shipped data has been counted. That count is this file. It is also the
 * guard on the other direction: drop `CamCommand.pastEnd` and a stashed
 * state-7 play stops one frame short, which holds stage 2's block 9 for ever
 * -- a civilian's killed stream waits on camera path 66 frame **385** while
 * the step stashes `351..384`. The 0-operand form is a different test in the
 * engine (`g_cam_path_frames_left > 0`) and is not counted here.
 *
 * **What it cannot see**: a wait whose play was started in an earlier step,
 * and the deferred plays a `finish_sequence` in another step takes over. Those
 * are skipped rather than guessed at, and the number skipped is printed,
 * because a check that silently drops the cases it cannot model is how a count
 * comes to mean nothing.
 *
 * One assertion per bundle when every wait it checks can be satisfied, and one
 * failure per wait that cannot. Exit 3 without a bundle.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT, EXIT_SKIPPED } from "../lib/bundle_root";
import { Checker, argValue } from "../lib/exe_check";

type Json = any;

/**
 * How many frames past its range's end each player of a stashed range
 * publishes. The guard byte, as a number.
 */
const STASH_PAST_END: ReadonlyMap<unknown, number> = new Map([[6, 0], [7, 1]]);

/** `obj[key]`, or `fallback` when the key is absent. */
function get(obj: Json, key: string, fallback: Json): Json {
  return Object.hasOwn(obj, key) ? obj[key] : fallback;
}

const bundle = argValue("bundle") ?? BUNDLE_ROOT;
const manifest = join(bundle, "manifest.json");
if (!existsSync(manifest)) {
  console.log(`SKIP  cam_waits: no bundle at ${bundle}`);
  console.log("      build one with `cd web && npm run export -- --game-dir ...`,"
              + " or point HOTD2_BUNDLE at one");
  process.exit(EXIT_SKIPPED);
}

const c = new Checker("cam_waits");
let checked = 0;
let skipped = 0;
let stashedPlays = 0;
let bundles = 0;

for (const e of get(JSON.parse(readFileSync(manifest, "utf8")), "stages", [])) {
  const name = get(e, "name", null);
  const script = get(e, "script", null);
  if (!name || !script) continue;
  const path = join(bundle, name, script);
  if (!existsSync(path)) continue;
  bundles++;
  const d = JSON.parse(readFileSync(path, "utf8"));
  const bad: string[] = [];
  let here = 0;
  for (const b of get(d, "blocks", [])) {
    for (const st of get(b, "steps", null) || []) {
      // The play in force, as `[last frame published, how]`. Reset per step:
      // a play that began in an earlier step is one of the cases this check
      // does not model.
      let play: [number, string] | null = null;
      let stash: [number, number] | null = null;
      for (const op of get(st, "ops", [])) {
        const nm = get(op, "name", null);
        const action = get(op, "action", null);
        if (nm === "queue_event" && action === "cam_play") {
          const start = get(op, "start", 0);
          const end = get(op, "end", 0);
          if (start !== end && (get(op, "flags", 0) & 2)) stash = [start, end];
          else play = [end, `cam_play ${start}..${end}`];
        } else if (nm === "queue_event" && action === "finish_sequence") {
          const minor = (get(op, "args", null) || [null])[0];
          if (STASH_PAST_END.has(minor) && stash) {
            const [s, en] = stash;
            stashedPlays++;
            play = [en + STASH_PAST_END.get(minor)!, `state ${minor} on a stashed ${s}..${en}`];
            stash = null;
          }
        } else if (nm === "wait_camera_path_frame") {
          const arg = get(op, "arg", 0);
          if (arg === 0) continue;
          if (play === null) {
            skipped++;
            continue;
          }
          here++;
          if (arg + 1 > play[0]) {
            bad.push(`${name}: block ${b.index} step ${st.index} op ${op.i} waits for frame `
                     + `${arg}, so it needs ${arg + 1}, but ${play[1]} publishes no further `
                     + `than ${play[0]}`);
          }
        }
      }
    }
  }
  checked += here;
  if (!bad.length) {
    c.ok(true, `${name}: all ${here} camera-frame waits ask for a frame their own play publishes`);
  }
  for (const line of bad) c.fail(line);
}

if (!bundles) {
  console.log("SKIP  cam_waits: the manifest names no stages");
  c.finish();
}
c.note(`${bundles} bundles: ${checked} camera-frame waits checked against the play in force `
       + `(${stashedPlays} of those plays are stashed ranges), ${skipped} skipped with no play `
       + "in the same step");
c.finish();
