/**
 * Does the camera frame a scripted entrance waits on ever reach the port?
 *
 * `tools/entrances.mjs` drives the twelve entrance states with a camera it
 * makes up — `g_cam_path_frame += 1` every frame, for ever — so every equality
 * cue in the game is hit exactly once by construction. That is the right
 * harness for "is the state transcribed", and it is blind to the failure this
 * one is for: **the player's camera is the walker's, and the walker did not
 * hand every frame of a path to the port.**
 *
 * `CamAdvancePathFrame` (`FUN_004035E0`) writes the camera block's `+0xD0`
 * *before* it tests the end of the range, and the interpreter task runs before
 * the one that call lives in — so in the engine the last frame of a `cam_play`
 * is published to the object update for a whole frame before anything can
 * supersede it. The port used to advance the camera, retire the action,
 * release `wait_queued_events_done` and run on to the next `cam_play` inside a
 * single `Walker.tick`, with `syncPortGlobals` reading `w.cam.frame` only
 * after all of it. Stage 1's `cam_play 115..179` therefore published 178 and
 * then 180, and the three zombies whose cue is **179** — the range's own end
 * frame, which is how the game times an entrance to the end of a shot — waited
 * for the rest of the stage. So did stage 2's `0xFAF4` on `cam_play 100..229`.
 *
 * So this drives the real `Walker` and the real `GameSystem` together, on the
 * real script, seeking to the instruction that places each spawn and playing
 * from there. A spawn passes when it leaves its entrance state; the cue is
 * reported either way, because "published but still waiting" and "never
 * published" are different bugs.
 *
 *     node tools/run_test.mjs tools/cam_cues.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { CameraFrame } from "../src/core/camera.ts";
import { Events } from "../src/core/events.ts";
import { Rng } from "../src/core/rng.ts";
import { Scope } from "../src/core/scope.ts";
import { World } from "../src/core/world.ts";
import { GameSystem, ScriptSystem, syncPortGlobals } from "../src/app/systems.ts";
import { ResetPropContainers } from "../src/game/class41/index.ts";
import { G } from "../src/game/globals.ts";
import { SpawnScriptedCharacters } from "../src/game/director.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ZombieState } from "../src/game/class30/states.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { BUNDLE_ROOT, hasBundle, skipNoBundle, stageFile }
  from "./lib/bundle_root.ts";

if (!hasBundle()) skipNoBundle("cam_cues");

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
/** Frames played from the spawn instruction. Twenty seconds. */
const FRAMES = Number(process.env.CAM_CUE_FRAMES ?? 1200);

/**
 * The class-0x30 entrance states whose gate is an **equality** against the
 * camera path frame, and which therefore cannot survive a skipped frame.
 * State 13 is deliberately absent: `ZombieStateSurfaceOnCameraCue` uses `>=`.
 */
const CAM_EQUALITY_STATES = new Set([
  ZombieState.WaitCameraFrameThenBranch,
  ZombieState.WaitForCameraFrame,
  ZombieState.ScriptedGrabAndDespawn,
]);

const mkHost = () => ({
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
  cameraFree: () => null,
  showMessage: () => null,
  endDialogue: () => undefined,
});

let bad = 0, seen = 0, unreachable = 0;

for (let stage = 1; stage <= 6; stage++) {
  const file = stageFile(stage, "script");
  if (!existsSync(file)) continue;
  const script = JSON.parse(readFileSync(file, "utf8"));
  const chars = script.characters;
  if (!chars) continue;

  /** at -> what its placement says it waits for. */
  const wanted = new Map();
  for (const p of chars.placements ?? []) {
    if (p.class !== 0x30) continue;
    if (!CAM_EQUALITY_STATES.has(p.initial_state)) continue;
    const cue = p.entry?.cue ?? p.entry?.cue_frame;
    if (cue === undefined || cue === null || cue < 0) continue;
    wanted.set(p.at, { cue, state: p.initial_state });
  }
  if (!wanted.size) continue;

  // Where the script places each of them, and the record it places.
  const site = new Map();
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const sp of op.spawns ?? []) {
          if (!wanted.has(sp.at) || site.has(sp.at)) continue;
          site.set(sp.at, { at: [b.index, st.index, op.i], sp });
        }
      }
    }
  }

  for (const [at, w] of wanted) {
    const where = site.get(at);
    if (!where) continue;
    seen += 1;

    const stageScope = new Scope(`stage:${stage}`);
    const ctx = {
      events: new Events(), rng: new Rng(1), walker: null, scope: stageScope,
      session: stageScope.child("session"), view: new CameraFrame(),
      stage, frame: 0,
    };
    const world = new World();
    const scriptSys = new ScriptSystem();
    world.add("script", scriptSys);
    world.add("game", new GameSystem());
    const walker = new Walker(script, mkHost());
    scriptSys.walker = walker;
    ctx.walker = walker;
    ResetPropContainers();
    world.attach(ctx);
    SetGameTables(chars, script.breakables, script.set_pieces,
                  script.humanoids, script.coli, script.civilians);
    G.g_player_lives = [2, 2];
    G.g_GameMode = script.game_mode;
    if (!seekTo(walker, ...where.at)) {
      unreachable += 1;
      seen -= 1;
      continue;
    }
    world.resync(ctx);

    let published = false, leftAt = -1;
    for (let f = 0; f < FRAMES && leftAt < 0; f++) {
      walker.tick(TICK);
      if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
      syncPortGlobals(walker, false, ctx.view.eye);
      // The character layer's job, minus the renderer: the port only updates
      // an actor something has turned on.
      SpawnScriptedCharacters([{ at, motion: 0,
        pos: { x: where.sp.pos[0], y: where.sp.pos[1], z: where.sp.pos[2] } }],
        ctx.rng);
      if (G.g_cam_path_frame === w.cue) published = true;
      world.update(ctx, LIVE);
      const a = G.g_object_list.find((o) => o.at === at);
      // State 23 ends by removing the actor rather than by setting a state.
      if (!a || a.despawned || a.dead || a.state !== w.state) leftAt = f;
    }

    const ok = leftAt >= 0;
    if (!ok) bad += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} s${stage} 0x${at.toString(16)
      .toUpperCase()} state ${w.state} cue ${w.cue} -- `
      + (ok ? `left after ${leftAt} frames`
            : published ? "cue published, still waiting"
                        : "CUE NEVER PUBLISHED"));
  }
}

console.log(`\n${seen} camera-cue entrances driven, ${bad} never left`
  + (unreachable ? `, ${unreachable} placed at an unreachable address` : ""));
console.log(`bundle: ${BUNDLE_ROOT}`);
if (bad) {
  console.log("FAIL: an entrance whose cue the camera never publishes parks "
    + "its actor for the rest of the stage");
  process.exitCode = 1;
}
