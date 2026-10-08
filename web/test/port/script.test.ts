import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { CameraUpdateHook } from "../../src/game/camera/driver";
import { G, PlayerState, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { ZombieState } from "../../src/game/class30/states";
import { type Actor } from "../../src/game/actor";
import { UNCOUNTED_INITIAL_STATE } from "../../src/game/combat/counts";
import { SpawnClass } from "../../src/game/spawn_class";
import { vec3, type Vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import { VecToAngles } from "../../src/game/vec";
import { seekTo } from "../../src/script/seek";
import { Boss4BlockNew } from "../../src/game/class19/state";
import { Boss4PlayCameraCue } from "../../src/game/class19/camera";
import { CamPath } from "../../src/game/camera/curve";
import { g_class_handlers } from "../../src/game/registry";
import { check, WalkerCameraFrame, EnterPlay } from "./harness";

/**
 * **B8, the half of it that lives in `game/`.**
 *
 * The report — "the two later zombies that drop from the high ledge don't
 * pause the camera... maybe a race condition?" — has an obvious suspect: a
 * zombie still in the air has not joined the enemy counters yet, so
 * `wait_enemies_alive` sees zero and lets the block go. It is not what
 * happens, and pinning that down is what turned the search towards the script
 * side, where the bug actually was.
 *
 * `EnemyZombieInit` (`FUN_00452DA0`) does its two `INC`s in `Init`, on the
 * straight line after the state is seeded. The only two spawns it declines are
 * character type 9 and initial state 31 — neither of which any entrance state
 * is — so a dropper is in both counters from the frame the spawn instruction
 * runs and stays there for the whole descent.
 */
console.log("\nan entrance state is counted from its first frame:");
{
  const rng = new Rng(31);
  const events = new Events();
  // Stage 1 block 4 step 5's pair, in shape: class 0x30 on the ledge at
  // y = 61 with `ZombieStateDelayedLeap` (26) as the initial state, and the
  // tail that state reads with no test -- a drop to the floor at `0x39DC`'s
  // gravity.
  const drop = (at: number): Actor => ActorSpawn(at, SpawnClass.Zombie, 1,
    "ledge dropper", { initialState: ZombieState.DelayedLeap, hp: 100,
                       maxHp: 100, visible: true, pos: vec3(0, 61, -20),
                       delayedLeap: { delay: 0, dest: [0, 0, -30],
                                      gravity: 0.03674 } }, rng);

  ResetGameGlobals();
  EnterPlay();
  const a = drop(0xb000);
  const b = drop(0xb001);
  check("both droppers join the counters in `Init`, before a frame runs",
        G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);
  check("...and they really are in the entrance state",
        a.state === ZombieState.DelayedLeap
        && b.state === ZombieState.DelayedLeap,
        `${a.state} / ${b.state}`);

  // The whole descent. `UNCOUNTED_INITIAL_STATE` is the one state that is
  // allowed to be uncounted while it waits, and 26 is not it.
  check("state 26 is not the state that counts itself in later",
        (ZombieState.DelayedLeap as number) !== UNCOUNTED_INITIAL_STATE);
  let lowAlive = G.g_enemies_alive;
  for (let i = 0; i < 240; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    lowAlive = Math.min(lowAlive, G.g_enemies_alive);
  }
  check("...and neither leaves the count while it is still falling",
        lowAlive === 2 && G.g_enemies_alive === 2,
        `lowest ${lowAlive}, now ${G.g_enemies_alive}`);
}

/**
 * **The camera hands the port every frame of a path, including the last one.**
 *
 * The engine runs two tasks: `EvtInterpreterLoop` (`FUN_0045ECC0`) and then
 * `EvtRunQueuedActions` (`FUN_00402320`), and `CamAdvancePathFrame`
 * (`FUN_004035E0`) — which lives in the second — publishes the camera block's
 * `+0xD0` *before* it tests the end of the range and retires the action. So the
 * frame a shot ends on is a value `g_cam_path_frame` really holds, for one
 * whole object update, before the shot behind it can start.
 *
 * The port used to run its camera half first and its instructions second, so
 * `wait_queued_events_done` fell through on the same tick the path ended, the
 * `cam_play` behind it took the camera, and the end frame was never published
 * at all. Stage 1's `cam_play 115..179` went 178, 180 — and three class-0x30
 * zombies whose entrance cue is exactly 179 stood in their entrance clip for
 * the rest of the stage, which is how the game writes "come through the door
 * as this shot ends". Stage 2's `0xFAF4` is the same bug on `100..229`.
 *
 * This is that script in miniature, and the assertion is the invariant rather
 * than the symptom: **no integer between the first shot's start and the second
 * shot's end may be missing from what the walker publishes.**
 * `tools/cam_cues.mjs` is the same check against all 44 shipped spawns.
 */
console.log("\nthe camera path publishes every frame, ends included:");
{
  const camOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 0],
    start, end, slot: 7, flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        camOp(0, 0, 10),
        // The gate the shipped scripts put between two shots.
        { i: 1, at: 1, op: 0x40, name: "wait_queued_events_done", cat: "wait",
          blocks_on: "queued events pending == 0" },
        camOp(2, 11, 20),
        { i: 3, at: 3, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
      ] }],
    }],
  } as unknown as ScriptJson;

  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null,
  });
  // No `primeToFirstWait`: it steps *over* waits to get a scene on screen, and
  // the wait between the two shots is the whole point here. The first tick
  // runs the instructions from cold, exactly as the player's does.
  ResetGameGlobals();

  // What `CamAdvancePathFrame` publishes into `g_cam_path_frame`, once a tick.
  const published: number[] = [];
  for (let f = 0; f < 60; f++) {
    WalkerCameraFrame(w);
    published.push(w.cam ? Math.trunc(w.cam.frame) : -1);
  }
  const missing: number[] = [];
  for (let n = 0; n <= 20; n++) if (!published.includes(n)) missing.push(n);
  const head = published.slice(0, 16).join(",");
  check("every frame of both shots reaches the port",
        missing.length === 0, `missing ${missing.join(", ")} of ${head}`);
  check("...including 10, the frame the first shot ends on",
        published.includes(10), head);
  // And it is published for exactly one tick, as `CamAdvancePathFrame` does:
  // one call, one publish, and the shot behind it cannot start until the tick
  // after the interpreter has seen the retirement.
  check("...for exactly one tick, not two",
        published.filter((n) => n === 10).length === 1, head);
  check("...and the shot behind it starts on the tick after",
        published[published.indexOf(10) + 1] === 11, head);
}

/**
 * A block change leaves the action ring alone.
 *
 * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) moves the block and the program
 * pointer and nothing else; `EvtLoadBlockProgram` (`FUN_0045EBC0`), which
 * zeroes `g_queued_events_pending`, is called only by the two task-list
 * builders. A `cam_play` a skip cut short retires on its next call -- after
 * the interpreter has raced into the next block -- so its count has to still
 * be there. The port zeroed it at the block change, the retire took the next
 * block's count, and stage 6 block 1 parked on a -1.
 */
console.log("\na block change carries the action ring's count:");
{
  const camOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 0],
    start, end, slot: 7, flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const waitRing = (i: number) => ({ i, at: i, op: 0x40,
    name: "wait_queued_events_done", cat: "wait",
    blocks_on: "queued events pending == 0" });
  const region = (i: number, open: boolean) => ({ i, at: i, op: 0x2c,
    name: "set_skippable_region", cat: "flow", open });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 1, routes: [], regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "goto", next: [1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [] }, { index: 1, at: 0, ops: [
        region(0, true), camOp(1, 0, 100), waitRing(2), region(3, false),
      ] }],
    }, {
      index: 1, at: 100, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 100, ops: [] }, { index: 1, at: 100, ops: [
        camOp(0, 0, 10), waitRing(1),
        { i: 2, at: 102, op: 0x42, name: "wait_frames", cat: "wait", arg: 100,
          blocks_on: "arg frames elapsed" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null,
  });
  ResetGameGlobals();
  // The skip is the watcher's, class 0x63, as `spawn_simple` places it at the
  // top of a step: the press only raises `g_nSkipRequested`.
  const watcher = ActorSpawn(-1, SpawnClass.CutsceneSkipWatcher, -1, "watcher");
  watcher.visible = true;
  let lowest = 0, skipped = false, passedAt = -1, releasedAt = -1;
  for (let f = 0; f < 60; f++) {
    if (f === 5) skipped = w.requestSkip();
    WalkerCameraFrame(w);
    if (releasedAt < 0 && (w.block > 0 || w.opIndex > 2)) releasedAt = f;
    if (!watcher.dead) {
      g_class_handlers[SpawnClass.CutsceneSkipWatcher]?.update(watcher,
        { dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });
    }
    lowest = Math.min(lowest, G.g_queued_events_pending);
    if (passedAt < 0 && w.block === 1 && w.opIndex === 2) {
      passedAt = G.g_cam_path_frame;
    }
  }
  check("the skip is taken inside the region", skipped);
  // Pressed on frame 5: the walker runs first and the watcher takes the
  // request after it, so the flag is up from frame 5's walk -- and the wait
  // the interpreter is parked on re-runs its skip test on frame 6.
  check("...and the wait pending at the press goes on the next frame",
        releasedAt === 6, `released on frame ${releasedAt}`);
  check("the count never goes below zero", lowest >= 0, `${lowest}`);
  check("...and the next block's wait holds until its own shot has ended",
        passedAt === 10, `passed with the camera on ${passedAt}`);
}

/**
 * A camera cue that aims by look-at has to write the block's angles.
 *
 * The view is built from the camera block's angles (`UpdateSceneViewAndLight`,
 * `FUN_00401F40`), so a routine that moves the eye and the target and stops
 * there moves the camera without turning it. `Boss4PlayCameraCue` calls
 * `CamBlockSetAnglesFromLookAt` at `0x00493277`; the port left it out while
 * its view was built from the look-at, and under the angle-built view
 * Strength's cues would have slid the camera along the path facing the way
 * it faced before.
 */
console.log("\nStrength's camera cue turns the camera it moves:");
{
  ResetGameGlobals();
  const path = {
    pose: (t: number, _roll: boolean,
           out: { eye: Vec3; target: Vec3; roll: number }) => {
      out.eye.x = 100 + t; out.eye.y = 5; out.eye.z = 0;
      out.target.x = 0; out.target.y = 0; out.target.z = 0;
      out.roll = 0;
      return out;
    },
  };
  const host: GameHost = {
    ...NULL_HOST,
    camPath: () => path as unknown as CamPath,
  };
  const b = Boss4BlockNew();
  b.cueStep = 1; b.cueFrame = 0; b.cueEnd = 50; b.cuePath = 7; b.cueQueued = -1;
  G.g_camera_block_yaw_bams = 0x1234;
  G.g_camera_block_pitch_bams = 0;
  // Nobody is registered, so the aim turns toward the deferred pose's
  // target, which is the origin.
  G.g_cam_path_target = vec3(0, 0, 0);
  G.g_camera_block_target = vec3(0, 0, -100);
  for (let i = 0; i < 40; i++) Boss4PlayCameraCue(b, host);
  const e = G.g_camera_block_eye, t = G.g_camera_block_target;
  const want = VecToAngles(e.x - t.x, e.y - t.y, e.z - t.z);
  const s16 = (v: number): number => (Math.trunc(v) << 16) >> 16;
  check("the block's yaw and pitch are the look-at's, set on every frame",
        G.g_camera_block_yaw_bams === s16(want.yaw)
        && G.g_camera_block_pitch_bams === s16(want.pitch)
        && G.g_camera_block_yaw_bams !== 0x1234,
        `${G.g_camera_block_yaw_bams},${G.g_camera_block_pitch_bams} vs `
        + `${s16(want.yaw)},${s16(want.pitch)}`);
}

/**
 * `goto_scene_state_when_alive` (0x32) waits for the players.
 *
 * `EvtOpGotoSceneStateWhenPlayersAlive32` (`FUN_0045F900`) returns with the
 * pointer where it was while either player sits in a state whose
 * `g_player_state_handlers` row has `+0x10 == 0` (4, 5 and 6) with no lives
 * left, and runs again next frame. The port let it through always.
 */
console.log("\ngoto_scene_state_when_alive holds while a player is out of lives:");
{
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        { i: 0, at: 0, op: 0x32, name: "goto_scene_state_when_alive",
          cat: "flow", scene_state_minor: 3 },
        { i: 1, at: 1, op: 0x42, name: "wait_frames", cat: "wait", arg: 100,
          blocks_on: "arg frames elapsed" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null,
  });
  ResetGameGlobals();
  G.g_scene_state_major = 2;
  G.g_scene_state_minor = 4;
  // Player 0 dead on the continue countdown; player 1 never started.
  G.g_player_state[0] = PlayerState.Continue;
  G.g_player_lives[0] = 0;
  G.g_player_state[1] = PlayerState.Out;
  G.g_player_lives[1] = 0;
  w.tick(1 / 60);
  w.tick(1 / 60);
  check("a player at 4 with no lives holds it",
        w.opIndex === 0 && G.g_scene_state_major === 2,
        `op ${w.opIndex}, state ${G.g_scene_state_major}/${G.g_scene_state_minor}`);
  G.g_player_state[0] = PlayerState.InPlay;
  check("...in play with no lives still holds it",
        (w.tick(1 / 60), w.opIndex === 0 && G.g_scene_state_major === 2));
  G.g_player_lives[0] = 3;
  w.tick(1 / 60);
  check("...and with lives it enters (1, 3) and moves on",
        w.opIndex === 1 && G.g_scene_state_major === 1
        && G.g_scene_state_minor === 3,
        `op ${w.opIndex}, state ${G.g_scene_state_major}/${G.g_scene_state_minor}`);
}

/**
 * `wait_camera_path_frame <n>` releases on `n + 1`, not on `n`.
 *
 * `EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`) advances the instruction
 * pointer only when `g_cam_path_frame > operand`:
 *
 * ```
 * 0045fae7  CMP dword ptr [0x009a6110],EAX
 * 0045faed  JLE 0045fb29            ; frame <= operand: keep waiting
 * ```
 *
 * The port counted down to the operand itself, so every instruction behind
 * such a wait ran one frame early — and `runCameraOnPast`, the seek's half of
 * the same rule, already used `arg + 1`, so the live walker and the seek
 * disagreed about where the camera was. Stage 2's block 9 is the one where it
 * mattered: `wait_camera_path_frame 384` let the `finish_sequence 4` behind it
 * freeze the camera on 384, and frame 385 — the last frame of a stashed play,
 * and a civilian's cue — was never published.
 */
console.log("\na camera-frame wait releases one frame past its operand:");
{
  const camOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 0],
    start, end, slot: 7, flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        camOp(0, 0, 10),
        { i: 1, at: 1, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 5, blocks_on: "camera path frame past arg" },
        // The instruction behind the wait, and the frame it ran on is the
        // measurement.
        { i: 2, at: 2, op: 0x48, name: "set_script_flag", cat: "flow",
          flag: 9 },
        { i: 3, at: 3, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null,
  });
  ResetGameGlobals();
  G.g_script_flags[9] = 0;
  let ranOn = -1;
  const seen: number[] = [];
  for (let f = 0; f < 30; f++) {
    // What the interpreter reads: the frame the camera published on the tick
    // before, since its task runs first.
    const read = G.g_cam_path_frame;
    WalkerCameraFrame(w);
    seen.push(w.cam ? Math.trunc(w.cam.frame) : -1);
    if (ranOn < 0 && G.g_script_flags[9]) ranOn = read;
  }
  check("the instruction behind `wait_camera_path_frame 5` runs on frame 6",
        ranOn === 6, `ran on ${ranOn} of ${seen.slice(0, 12).join(",")}`);
}

/**
 * The **other** way the engine plays a path, and it is not this one.
 *
 * `queue_event cam_play` with `flags & 2` does not play: `FUN_00403490`
 * stashes the range, and the `finish_sequence 6|7` behind it installs a rail
 * hook that plays it. Both hooks — `CameraStepRailTick` (`FUN_0040C790`) for
 * state (2,6) and `CameraPlayStashedPath` (`FUN_0040C8A0`) for (2,7) —
 * **increment the frame before they evaluate it**, where `CamAdvancePathFrame`
 * publishes the cursor and then increments. So a stashed `0..10` draws
 * `1..10` under state (2,6): the start frame is stepped past, and the end
 * frame is reached.
 *
 * **And (2,7) draws `1..11`.** The two hooks differ in one byte of guard —
 * `JGE` at `0x0040C7A0` against `JG` at `0x0040C8C0` — so state 7 lets the
 * last comparison through and the increment carries it one frame past the
 * range's end. See `CamCommand.pastEnd`: the port gave (2,6)'s answer to
 * both, and stage 2's block 9 is what that cost.
 *
 * The port had `started: true` on both, copied from the non-deferred branch
 * where it is right, and the deferred shot lost its last frame. Stage 2 block
 * 16 step 6 stashes `581..660` on path 75, and both cues that shot exists to
 * fire are timed to its tail: `0xA030`'s captor cue is 660 and its civilian's
 * killed script waits on 650. Neither could be reached from 659, so the captor
 * never turned on the player, the two `znebi2` were never called up out of the
 * water and `wait_enemies_alive 0` held block 16 for ever.
 */
console.log("\na stashed path is played by a hook that steps first:");
{
  const stashOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 2],
    start, end, slot: 7, flags: 2, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        stashOp(0, 0, 10),
        { i: 1, at: 1, op: 0x30, name: "queue_event", cat: "camera",
          sel: 0x21, action: "finish_sequence", args: [7],
          scene_state: { major: 2, minor: 7 },
          camera_state: "play_stashed_path_exclusive" },
        { i: 2, at: 2, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
        // Somewhere for the seek below to land *past* the wait: `seekTo`
        // stops the moment `opIndex` reaches its goal, so asking for the wait
        // itself arrives without ever executing it.
        { i: 3, at: 3, op: 0x48, name: "set_script_flag", cat: "flow",
          flag: 1 },
      ] }],
    }],
  } as unknown as ScriptJson;

  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null,
  };

  const w = new Walker(script, host);
  // A player in play: the rail's gate holds it while nobody is.
  ResetGameGlobals();
  EnterPlay();
  // The frames the (2,7) hook draws into the deferred pose, `g_rail_frame`,
  // and the frame the minor-7 driver publishes from it a task earlier in the
  // next frame, `g_cam_path_frame`.
  const published: number[] = [];
  const cue: number[] = [];
  for (let f = 0; f < 40; f++) {
    WalkerCameraFrame(w);
    if (G.g_camera_update_hook === CameraUpdateHook.PlayStashedPath) {
      published.push(G.g_rail_frame);
      cue.push(G.g_cam_path_frame);
    }
  }
  const head = published.slice(0, 14).join(",");
  check("the stashed shot reaches its end frame",
        published.includes(10), head);
  check("...and steps past its start frame, which the hook never draws",
        !published.includes(0), head);
  check("...so its first drawn frame is 1",
        published[0] === 1, head);
  check("...and every frame between is published",
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => published.includes(n)),
        head);
  // `JG` at `0x0040C8C0`, and the increment before the publish: state 7's
  // last comparison passes at `cur == end` and carries the frame one past it.
  // Stage 2's block 9 stashes `351..384` and its civilian's cue is **385**.
  check("...and state 7 publishes one frame PAST the end",
        published.includes(11), head);
  check("...and not two",
        !published.includes(12), head);
  // The frame order: `CameraDriverFromDeferredPose` stores
  // `g_cam_path_frame = __ftol(g_rail_frame)` inside `CameraActorTick`, which
  // runs **before** `CameraUpdateTick` steps the rail -- so every cue the
  // game reads is one frame behind the pose the rail has just drawn.
  const steady = cue.slice(3, 9).map((c, i) => published[i + 3] - c);
  check("the published frame trails the rail by exactly one, every frame",
        steady.length === 6 && steady.every((d) => d === 1),
        `${cue.slice(0, 12).join(",")} against ${head}`);
}

/** The same stash under state **(2,6)**, whose guard stops on the end frame. */
{
  const stashOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 2],
    start, end, slot: 7, flags: 2, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        stashOp(0, 0, 10),
        { i: 1, at: 1, op: 0x30, name: "queue_event", cat: "camera",
          sel: 0x21, action: "finish_sequence", args: [6],
          scene_state: { major: 2, minor: 6 },
          camera_state: "play_stashed_path" },
        { i: 2, at: 2, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null,
  };
  const w = new Walker(script, host);
  ResetGameGlobals();
  EnterPlay();
  const published: number[] = [];
  for (let f = 0; f < 40; f++) {
    WalkerCameraFrame(w);
    const h = G.g_camera_update_hook;
    if (h === CameraUpdateHook.StepRail) published.push(G.g_rail_frame);
  }
  const head = published.slice(0, 14).join(",");
  check("state 6 reaches the end frame", published.includes(10), head);
  check("...and stops on it", !published.includes(11), head);

  // **Stage 4's boss blocks install (2,6) over no stash at all.** Blocks 23,
  // 25, 27 and 29 play `cam_play 185 0..0` -- a static pose, which is what
  // leaves `g_active_cam_path` on the fight's path -- and then
  // `finish_sequence 6`; the rail then runs over whatever the stash words
  // hold, and the boss's own camera cues move them. The port refused the
  // install for want of a stash, so the fight's `g_cam_path_frame` sat at 0.
  {
    ResetGameGlobals();
    const bossScript = {
      ...script,
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [
          { i: 0, at: 0, op: 0x30, name: "queue_event", cat: "camera",
            sel: 0x40, action: "cam_play", args: [0, 0, 185, 0],
            start: 0, end: 0, slot: 185, flags: 0, static: true,
            resume: false, cam: { file: "cp_test", path: 0, duration: 1 } },
          { i: 1, at: 1, op: 0x30, name: "queue_event", cat: "camera",
            sel: 0x21, action: "finish_sequence", args: [6],
            scene_state: { major: 2, minor: 6 },
            camera_state: "play_stashed_path" },
          // The fight: a wait long enough for the rail to be watched. (The
          // block's own is `wait_script_flag 32`, which a bundle with no
          // class-0x19 spawn could never open.)
          { i: 2, at: 2, op: 0x42, name: "wait_frames", cat: "wait",
            arg: 1000, blocks_on: "arg frames elapsed" },
        ] }],
      }],
    } as unknown as ScriptJson;
    EnterPlay();
    const wb = new Walker(bossScript, host);
    for (let f = 0; f < 5; f++) WalkerCameraFrame(wb);
    check("finish_sequence 6 after a static pose rides the pose's path on "
          + "the rail",
          wb.cam?.slot === 185 && wb.cam.deferred === true,
          `slot ${wb.cam?.slot} deferred ${wb.cam?.deferred}`);
    // What `Boss4PlayCameraCue` writes when a cue starts.
    G.g_stashed_path_frame = 20;
    G.g_stashed_path_end_frame = 30;
    const drawn: number[] = [];
    const cue: number[] = [];
    for (let f = 0; f < 15; f++) {
      WalkerCameraFrame(wb);
      drawn.push(G.g_rail_frame);
      cue.push(G.g_cam_path_frame);
    }
    check("...and a range moved on under it is drawn frame by frame",
          drawn.slice(0, 10).join() === "21,22,23,24,25,26,27,28,29,30"
          && drawn[14] === 30, drawn.join(","));
    // `CameraDriverSelectMode` publishes `__ftol(g_rail_frame)` in the camera
    // actor, a task before the hook steps the rail.
    check("...and published a frame behind, by the driver ahead of the hook",
          cue.slice(1, 11).every((c, i) => c === drawn[i]),
          `${cue.join(",")} against ${drawn.join(",")}`);
  }

  // And the seek's half: `seekTo` observes no waits, so an address behind
  // `wait_camera_path_frame` is reached with the shot still in the middle of
  // itself unless the wait's postcondition is applied by hand. It used to be
  // reached with the camera on frame 0 of a shot the script only ever leaves
  // at 10 — and the `finish_sequence` behind it then froze it there.
  const w2 = new Walker(script, host);
  ResetGameGlobals();
  EnterPlay();
  seekTo(w2, 0, 0, 3);
  check("a seek over the wait lands with the shot at its end",
        G.g_rail_frame === 10 && G.g_cam_path_frames_left === 0,
        `rail ${G.g_rail_frame} left ${G.g_cam_path_frames_left}`);
  check("...and with the action ring drained",
        G.g_evt_action_ring.length === 0,
        `${G.g_evt_action_ring.length} queued`);

  // A target that is not a whole number has to throw, because the silent
  // failure is total rather than partial: `arrived()` compares
  // `w.block === block`, so an object equals nothing, `maxOps` falls back to
  // 500,000, and the "seek" replays the **entire script** and returns false.
  // `tools/props43.mjs` was `seekTo(walker, { block, step }, rng)` for exactly
  // that reason — the `.mjs` harnesses are outside `tsc`, so nothing but this
  // stands between a mis-shaped call and a harness that reports the address it
  // asked for as the address it reached. The messages name the argument.
  const refuses = (label: string, call: () => unknown): void => {
    let msg = "did not throw";
    try {
      call();
    } catch (e) {
      msg = e instanceof TypeError ? e.message : `threw ${String(e)}`;
    }
    check(`seekTo refuses ${label}`, msg.startsWith("seekTo: "), msg);
  };
  const w3 = new Walker(script, host);
  // The exact call `props43.mjs` made: an options object where the block goes.
  refuses("an options object for `block`",
          () => seekTo(w3, { block: 0, step: 0 } as unknown as number, 0));
  refuses("a string for `step`",
          () => seekTo(w3, 0, "0" as unknown as number));
  refuses("a fractional `opIndex`", () => seekTo(w3, 0, 0, 1.5));
  refuses("a NaN `block`", () => seekTo(w3, Number.NaN, 0));
  refuses("an infinite `maxOps`",
          () => seekTo(w3, 0, 0, 0, Number.POSITIVE_INFINITY));
  refuses("a fractional `entryBlock`",
          () => seekTo(w3, 0, 0, 0, 500000, 0.5));
  check("...and still takes the call it is meant to take",
        seekTo(w3, 0, 0, 3) === true, `${w3.block}/${w3.step}/${w3.opIndex}`);
}
