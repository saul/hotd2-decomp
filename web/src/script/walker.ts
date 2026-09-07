/**
 * Walks a stage's event script: blocks, steps, instructions, and the route
 * table that orders them.
 *
 * **This is not the game's event VM, and does not claim to be.** The real
 * interpreter's blocking opcodes gate on live state -- enemy counters, camera
 * settling, a 256-byte script flag array written by gameplay -- and that
 * gameplay is still being decompiled. Re-implementing it here would mean
 * guessing, and a guess dressed as an interpreter is worse than an honest
 * walker.
 *
 * So: everything the *data* determines is executed faithfully --
 *
 *   - `region_enter` / `region_load`  (0x29 / 0x28)   region visibility
 *   - `asset_load_slot` / `asset_unload_slot` (0x50 / 0x51)  streamed props
 *   - `queue_event` sel 0x40          camera path, start frame to end frame
 *   - `enable_camera_path_roll` (0x35) gates the 7th curve channel
 *   - `wait_frames` (0x42)            an exact frame countdown
 *   - `wait_camera_path_frame` (0x41) an exact camera-frame gate
 *   - the route table                 including every branch point
 *   - spawn descriptors               position, BAMS yaw, class, hit points
 *
 * -- and everything that needs the runtime is **reported, not invented**.
 * Every such opcode appears in the event feed with the condition it would
 * block on, and `WaitPolicy` says what the walker did instead.
 */

import { G } from "../game/globals";
import { SpawnClass } from "../game/spawn_class";
import type { BlockJson, OpJson, ScriptJson, SpawnJson } from "../bundle";
import type { OpStatus } from "./opstatus";
import { OPS as OPS_TABLE } from "./ops";
import { WAIT_RULES, passedBecause, type WaitContext } from "./waits";
import {
  ChannelBlock, type ChannelTween, type FogState, type LightState,
} from "./state/channels";
import { ActionRing } from "./state/queued";
import { Shutter } from "./state/shutter";
import { ACTIONS, UNMODELLED } from "./state/camera_action";

export type { ChannelTween, FogState, LightState };
export {
  CH_AMBIENT, CH_FOG_FAR, CH_FOG_NEAR, CH_FOG_R, CH_LIGHT_R, CHANNEL_COUNT,
} from "./state/channels";


/**
 * One object `spawn_simple` (0x0A) has placed, and where the instruction was.
 *
 * `at` is **the port's own identity**, not the engine's: `EvtOpSpawnSimple0A`
 * allocates a fresh object per operand and has no descriptor address to name
 * it by, while the port's pool is keyed by `at`. The key is derived from the
 * instruction's own byte address — negative, so it can never collide with a
 * real descriptor offset, which is what a positive one could do.
 */
export interface ActiveSimpleSpawn {
  at: number;
  class: number;
  hp: number;
  block: number;
  step: number;
  opIndex: number;
}

export interface ActiveSpawn extends SpawnJson {
  /** Where it came from, so the marker can be traced back to an instruction. */
  block: number;
  step: number;
  opIndex: number;
  opcode: number;
}

/**
 * The scene fog, from the light block that evt opcodes `0x20`-`0x27` drive.
 *
 * Channels 0 and 1 are near and far (floats, reached through a pointer to a
 * constant in the evt file); 2/3/4 are the colour components as 0-255 ints,
 * and channel 5 sets all three at once. It is a linear D3D fog model, which
 * is the same model three.js `Fog` implements.
 */
export interface CamCommand {
  slot: number;
  startFrame: number;
  endFrame: number;
  frame: number;
  flags: number;
  isStatic: boolean;
  /** `flags & 2`: the game stashes these for a later scene state to play. */
  deferred: boolean;
  file: string | null;
  pathIndex: number | null;
  done: boolean;
  /**
   * Whether the camera task has already published a frame for this shot on
   * this tick.
   *
   * `CamStartPathPlayback` (`FUN_00403510`) ends by calling
   * `CamAdvancePathFrame` itself, and `EvtRunQueuedActions` calls the action
   * handler once a frame — so the frame a shot *starts* on is published by the
   * start, and the path does not step again until the next frame. Without
   * this the port's own advance would run over the top of it in the same tick
   * and every shot would be a frame ahead of the engine's.
   */
  started: boolean;
  /**
   * The action handler has been dequeued: nothing writes the camera block
   * from this shot again.
   *
   * **This is one tick later than {@link done}, and the tick between them is
   * the shot's last frame.** `CamAdvancePathFrame` (`FUN_004035E0`) is the
   * handler `EvtRunQueuedActions` calls once a frame while the play is
   * queued, and read off the instruction stream at `0x00403605` it goes:
   *
   * ```
   * MOV  EAX,[ESI + 0x9a6144]      ; cur = g_cam_path_cursor
   * MOV  [ESI + 0x9a6110],EAX      ; g_cam_path_frame = cur
   * CALL 0x004041e0                ; CamEvalPath7 -> block eye and target
   * CALL 0x00403ac0                ; CamBlockSetAnglesFromLookAt
   * MOV  [0x009c6f28],EDX          ; g_cam_path_frames_left = end - cur
   * CMP  ECX,EAX / JL              ; cur >= end ?
   * ...                            ; g_queued_events_pending--   (slot 0)
   * ```
   *
   * The publish, the curve evaluation and the block write all happen **before**
   * the end test, so the block holds the pose of every frame from `start` to
   * `end` **inclusive**; it is the frame *after* the end that is never
   * written. `[proved]`
   *
   * The port used to seat the block on `!done`, which is one tick short: on
   * the frame a shot ended the block kept the previous frame's pose, and the
   * next shot then moved the eye by two frames' travel at once. With the
   * gameplay camera live it also cost the aim its per-frame reseat, so
   * `CameraTrackEnemiesTick`'s ease took one unopposed step towards the enemy
   * and snapped back the frame after -- a one-frame flick of 9.6 degrees at
   * stage 3 block 2 step 4's `cam_play 1430..1660`.
   */
  retired: boolean;
}

export type WaitPolicy =
  | { kind: "frames"; framesLeft: number }
  /** The real gate: blocks until the player has killed them. */
  | { kind: "enemies" }
  /** `wait_scripted_actors`: blocks until the civilians have left play. */
  | { kind: "civilians" }
  /** `wait_queued_events_done`: blocks while the action ring owes work. */
  | { kind: "queued" }
  /** `wait_script_flag`: blocks until `g_script_flags[index]` is raised. */
  | { kind: "flag"; index: number }
  | { kind: "passed"; why: string };

export interface PendingWait {
  op: OpJson;
  blocksOn: string;
  policy: WaitPolicy;
}

export interface BranchChoice {
  block: number;
  targets: number[];
  /**
   * What `g_script_branch_var` said when the step list ran out — the route the
   * game itself is taking, and the one an expired countdown takes.
   *
   * **Latched here rather than read again when the countdown expires.** The
   * engine consults the global at the instant `EvtAdvanceStepOrRoute` runs and
   * there is no pause; the port's override window is a port-only pause during
   * which gameplay keeps running and could still write the global. Reading it
   * late would let 1.5 s of play change a decision the engine had already
   * made.
   */
  choice: number;
  /** Seconds left on the override window before {@link choice} is taken. */
  countdown: number;
  /** The arcade preview shot for each route, when a `store_six` supplied one. */
  preview: NonNullable<OpJson["branch_preview"]> | null;
}

export interface FeedEntry {
  seq: number;
  block: number;
  step: number;
  opIndex: number;
  op: OpJson;
  note?: string;
}

export interface WalkerOptions {
  /**
   * Seconds a branch point waits before the seeded RNG picks. Hovering the
   * branch bar freezes it, so this is the unattended pace, not a deadline.
   */
  branchCountdown: number;
  /** Clear spawn markers when the block changes. */
  clearSpawnsOnBlock: boolean;
}

export const DEFAULT_OPTIONS: WalkerOptions = {
  branchCountdown: 1.5,
  clearSpawnsOnBlock: true,
};

export interface WalkerHost {
  enterRegion(r: number): void;
  loadSlot(slot: number): void;
  unloadSlot(slot: number): void;
  startCamera(cmd: CamCommand): void;
  onFeed(entry: FeedEntry): void;
  onBranch(choice: BranchChoice | null): void;
  /** Any sound id, dispatched by namespace as `PlaySoundId` does. */
  playSound(id: number): string | undefined;
  /**
   * `g_enemies_alive` (`0x009C904A`) — enemies the player can still shoot, or
   * `null` when shooting is off.
   *
   * `wait_enemies_alive` (**0x44**, `EvtOpWaitEnemiesAlive44`) is the game's
   * combat gate and 434 of the 488 enemy gates in the shipped scripts: it
   * blocks until this counter falls to the operand, and the counter only moves
   * because the player kills things. With shooting enabled that is a real
   * condition again, so the walker waits on it instead of on a stopwatch.
   */
  aliveEnemies(): number | null;
  /**
   * `g_enemies_present` (`0x009C7006`), or `null` on the same terms.
   *
   * **The other counter, and not a synonym.** `wait_enemies_present`
   * (**0x43**, `EvtOpWaitEnemiesPresent43`, `FUN_0045FBC0`) reads this one,
   * and it is the looser of the two: an enemy leaves `g_enemies_alive` in
   * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) as its death state opens
   * and leaves this one in `ZombieEnterCorpseState` (`FUN_00456740`) when the
   * death clip ends, so a corpse on stage is present and not alive. The port
   * answered both opcodes with the alive count until B4/B8 were read, which
   * made the two gates the same gate — the one thing the game keeps two
   * counters in order to distinguish.
   */
  presentEnemies(): number | null;
  /**
   * Class-0x10 civilians still in play (`g_civilians_alive`, `0x009CA0E8`),
   * or `null` when the gate is not a condition this client can evaluate.
   *
   * `wait_scripted_actors` (`EvtOpWaitScriptedActors46`, `FUN_0045FCD0`) is
   * structurally the same instruction as `wait_enemies_present` -- the same
   * latch, the same two side conditions -- reading this counter instead. It is
   * gated the same way as `aliveEnemies` for the same reason: the count falls
   * when a civilian is rescued, and rescuing one means killing its captors.
   */
  aliveCivilians(): number | null;
  /**
   * `g_script_flags[index] != 0` (0x009C7200), or `null` when the gate is not
   * a condition this client can evaluate.
   *
   * The fourth question, and the same contract as the three counters above:
   * `null` is "this host has no gameplay", not "the flag is down".
   *
   * It has to be asked rather than read out of `G` directly, because
   * **every one of the forty-odd `wait_script_flag` gates in the six shipped
   * scripts names a flag that script's own `set_script_flag` never sets.**
   * They are raised by actors — the class-0x10 civilians' streams (op 0x1C)
   * and their captors' state 36 — so a host with no object pool cannot
   * satisfy one, ever. `test/seek.ts` and the walker-only harnesses in
   * `web/tools/` are exactly that host.
   */
  scriptFlagRaised(index: number): boolean | null;
  /**
   * `g_camera_free` (0x009C6F2D), or `null` when this client cannot evaluate
   * it.
   *
   * The room-clear waits `0x43`, `0x44` and `0x46` all require it on top of
   * their counter, so the script does not move on the frame the last enemy
   * dies -- it moves once no enemy is claiming the camera *and* the aim has
   * swung back onto the path. Without it every room hands over abruptly.
   */
  cameraFree(): boolean | null;
  /**
   * evt `0x2D`: start a dialogue group's voice, and say how long it runs.
   *
   * The **countdown** is the walker's, because it is script state that has to
   * survive a snapshot; what the host supplies is the duration, which is
   * bundle data, and the feed note, which needs the words.
   */
  showMessage(group: number): { frames: number; note?: string } | null;
  /** Cut a dialogue short, as raising the skip flag does. */
  endDialogue(): void;
}

/**
 * The two enemy counters' gates: `wait_enemies_present` (0x43) and
 * `wait_enemies_alive` (0x44).
 *
 * They are the only waits whose *postcondition* says something about the
 * actors rather than about the clock, which is why they get their own set —
 * see {@link Walker.retireGatedEnemies}.
 */

/**
 * The spawn classes whose handler moves `g_enemies_alive` or
 * `g_enemies_present` — which is to say, the ones an enemy gate is waiting
 * for. From `docs/formats/spawns.md`, which reads it off the handlers.
 *
 * Deliberately **not** `registry.ts`'s `ENEMY_CLASSES`. That set is the
 * classes the *port* counts, and it is narrower on purpose: an unported class
 * in it is an actor that never dies and so a `wait_enemies_alive` that never
 * unblocks. This set is about the script, where a class counts whether or not
 * the port can run it.
 */
const ENEMY_GATE_CLASSES: ReadonlySet<number> = new Set<number>([
  0x11, 0x14, 0x19, 0x32,           // enemies, both counters
  SpawnClass.Zombie,                // 0x30
  SpawnClass.Thrower,               // 0x31
  SpawnClass.HordeSpawner,          // 0x40 — its children count, and it is
                                    //        gone before the gate is reached
  SpawnClass.FlyingEnemy,           // 0x43
  SpawnClass.WaterEnemy,            // 0x51
]);

/**
 * The classes `wait_scripted_actors` (0x46) waits on — `g_civilians_alive`.
 *
 * `CivilianInit` (`FUN_0048A3E0`) is the only thing that raises that counter,
 * so this is class 0x10 and nothing else. Its children are not in the spawn
 * list at all: `CivilianInit` `SpawnFromDescriptor`s them itself, and they go
 * when their parent does.
 */
const CIVILIAN_GATE_CLASSES: ReadonlySet<number> =
  new Set<number>([SpawnClass.Civilian]);

/**
 * One opcode's implementation and how far this client honours it.
 *
 * `run` and `status` travel together on purpose -- see {@link Walker.OPS}.
 */
export interface OpImpl {
  status: OpStatus;
  run?: (w: Walker, op: OpJson, quiet: boolean) => string | undefined;
}

/**
 * The keys {@link Walker.loadState} copies straight back onto the walker.
 *
 * Module-level, and exported, so a test can hold it against what
 * {@link Walker.saveState} actually writes. A key added to the save and
 * forgotten here is dropped in silence -- the walker keeps whatever the
 * running session had, and the snapshot looks like it round-tripped. That is
 * the same failure `SNAPSHOT_VERSION` was supposed to catch and never could,
 * since it sat at 1 through every shape change either side ever made.
 */
export const WALKER_RESTORED_KEYS = [
  "block", "step", "opIndex", "region", "rollEnabled", "useFixedEyeY",
  "fixedEyeY", "groundY", "forcePathAdvance", "backdropPreset",
  "backdropMode", "shutterState", "shutterPrev", "shutterCounter",
  "captionGroup", "captionFrames", "firingGate",
  "skippable", "skipRequested", "rain", "gunLights", "sceneLighting",
  "branchChoice", "parked", "channels", "tweens", "fogSet", "lightDir",
  "lightSet", "checkpointBlock", "branchPreview", "camOverrideValid",
  "stashedCam", "spawns", "simpleSpawns",
  "sceneState", "queuedEventsPending", "camPending",
  "cam", "finished", "bgmTrack", "lastSound", "seq",
] as const;

/**
 * Saved keys `loadState` handles by hand rather than by copy, each for a
 * reason stated where it happens: `wait` must be cleared when absent rather
 * than left standing, and `loadedSlots` is a `Set` where a snapshot is JSON.
 */
export const WALKER_RESTORED_BY_HAND = [
  "wait", "loadedSlots",
] as const;

export class Walker {
  readonly script: ScriptJson;
  readonly host: WalkerHost;
  options: WalkerOptions;

  /**
   * The block cursor, and it is `g_evt_block_index` — 0x009A2BC0 — itself.
   *
   * An accessor over `G` for the same reason {@link step} is one, and with a
   * second reason of its own: **nine of the sixteen writers of
   * `g_script_branch_var` gate on this block index.** A trigger that opens a
   * route in one block is inert in every other, so `game/` has to be able to
   * read it. It used to be a field here that nothing below the script layer
   * could see.
   */
  get block(): number { return G.g_evt_block_index; }
  set block(v: number) { G.g_evt_block_index = v; }
  /**
   * The step cursor, and it is `g_evt_step_index` — 0x009A2BB0 — itself.
   *
   * The engine has exactly one global here, and both halves of the game read
   * it: `EvtAdvanceStepOrRoute` uses it to index the step table, and class
   * 0x41's `PropExpireByStepLifetime` ages a prop every time it *changes*.
   * The port used to keep two things — this cursor, and a separate monotonic
   * `g_evt_step_index` bumped once per block — and the props aged against
   * the wrong one. Blocks average 3.99 steps, so they lived about four times
   * too long.
   *
   * So it is an accessor over `G`, not a field beside it. Two counters that
   * have to agree is the shape the bug had.
   *
   * The consequence is that the cursor is **global**, as it is in the engine:
   * there is one VM and one of these. Two `Walker`s alive at once share it.
   * Nothing does that — the app has one, and the tests build them one at a
   * time — and `seek` opens with `reset`, so a walker takes the cursor back
   * whenever it is driven from cold.
   */
  get step(): number { return G.g_evt_step_index; }
  set step(v: number) { G.g_evt_step_index = v; }
  opIndex = 0;

  region = -1;
  rollEnabled = false;
  /** `g_camera_use_fixed_y` (0x36) and `g_camera_fixed_eye_y` (0x1A). */
  useFixedEyeY = false;
  fixedEyeY = 0;
  /** `g_ground_plane_y` -- the same global as `fixedEyeY`, named for its
   *  other job: the height a missed downward ray falls back to. */
  groundY: number | null = null;
  /** 0x37: advance the camera path every frame, bypassing the room gate. */
  forcePathAdvance = false;
  /** The backdrop dome: 0x1B picks the preset, 0x1C the mode. */
  backdropPreset = -1;
  backdropMode = 0;
  /**
   * The HUD shutter and its firing gate. See `script/state/shutter.ts`.
   *
   * The four fields below are accessors onto it rather than storage, on the
   * same reasoning as `lightBlock`: the save slice, `hud/hud.ts` and the HUD
   * strip already speak in `shutterState`, `shutterPrev`, `shutterCounter` and
   * `firingGate`, and renaming them all would be churn the round-trip test
   * could not tell from a mistake.
   */
  readonly shutter = new Shutter();

  get shutterState(): number { return this.shutter.state; }
  set shutterState(v: number) { this.shutter.state = v; }
  get shutterPrev(): number { return this.shutter.prev; }
  set shutterPrev(v: number) { this.shutter.prev = v; }
  get shutterCounter(): number { return this.shutter.counter; }
  set shutterCounter(v: number) { this.shutter.counter = v; }
  get firingGate(): boolean { return this.shutter.firingGate; }
  set firingGate(v: boolean) { this.shutter.firingGate = v; }
  /**
   * evt 0x2D: the subtitle task's own fields.
   *
   * `DrawDialogueSubtitleTask` (`FUN_00435AA0`) holds the variant at `+0x34`,
   * the frames remaining at `+0x36` and the line index at `+0x38`. The first
   * two are here; the line index is **derived**, because it is a function of
   * the countdown — the task steps it when `frames` drops below the current
   * line's `end_frame`, and those are fixed data, so counting the lines whose
   * `end_frame` still exceeds the countdown gives the same answer without
   * putting the dialogue table in the save state.
   */
  captionGroup = -1;
  captionFrames = 0;
  /**
   * `DAT_009A2D7C` -- set by `set_skippable_region` (0x2C). Non-zero means the
   * script has opened a region the player is allowed to skip out of.
   */
  skippable = false;
  /**
   * `DAT_009A2D74` -- the skip flag every wait opcode tests.
   *
   * The whole chain is live in the retail game:
   *
   * 1. `set_skippable_region(1)` opens the window (`DAT_009A2D7C`).
   * 2. Both player-update routines (`FUN_00414940`, `FUN_00414B90`) poll Start
   *    while that is set and the firing gate `g_nFiringGate` is down:
   *    `if (mask[player] & _DAT_009C9028) DAT_009A1A18 = 1;`
   * 3. A standing task, `SkipWatchTask` at `0x00435F40`, sees the request and
   *    raises this flag:
   *
   * ```c
   * if (g_skippable_region == 0) { task_end(); return; }
   * if (g_skip_requested) {
   *     if (cam_end != cam_frame) cam_end = cam_frame;   // finish the move
   *     g_skip_requested = 0;
   *     g_skip_flag = 1;
   *     DAT_009A2230 = 1;
   *     AssetDrainAllJobs();                             // force the streaming
   *     *task = SkipEndTask;                             // clears 2230, ends
   * }
   * ```
   *
   * 4. With the flag up, `queue_event` drops its action, `0x0D`, `0x3A` and
   *    `0x3B` suppress, `0x2D` says nothing and any subtitle already on screen
   *    ends, and `0x40`, `0x41` and `0x42` pass straight through -- so the
   *    interpreter races to the end of the region.
   * 5. `set_skippable_region(0)` clears the flag again.
   *
   * That task is reached only through a function pointer in the table at
   * `0x005934E4`, so nothing calls it directly and a plain xref search on the
   * flag finds only writers that store 0. An earlier revision of this comment
   * concluded from exactly that search that the feature was "one assignment
   * short of working". It is not: it ships working, and this is a
   * transcription of it rather than a repair.
   */
  skipRequested = false;
  /** evt 0x1D: rain. Only stage 1 ever turns it on. */
  rain = false;
  /** evt 0x15: the two players' gun spotlights. Gated by 0x14. */
  gunLights = false;
  /** evt 0x14: the scene light array, which gates 0x15 and 0x16. */
  sceneLighting = false;
  /**
   * `g_script_branch_var` — `0x009C88A4`. Which route a branch takes.
   *
   * An accessor over `G`, for the same reason {@link step} is one: the engine
   * has a single global here and both halves of the game touch it. The event
   * VM reads it; **every writer in the binary is gameplay code**, and the one
   * the port reaches is `CivilianOp.SetRouteBranch` — the command eleven of
   * the shipped civilian scripts run once the civilian is safe.
   *
   * It used to be a field on the walker that only the branch UI ever wrote,
   * which made the choice a thing the player invented rather than a thing the
   * game decided.
   */
  get branchChoice(): number { return G.g_script_branch_var; }
  set branchChoice(v: number) { G.g_script_branch_var = v; }
  /** `halt` (0x4E) parks the interpreter; it does not end the scene. */
  parked = false;
  /**
   * Scene fog. Starts effectively off -- the far plane is 8000, so a range
   * beyond it draws nothing, which is what the scripts themselves use
   * (65000/65001) to disable fog.
   */
  /**
   * The light block. See `script/state/channels.ts`.
   *
   * The five fields below are accessors onto it rather than storage: forty
   * call sites and a snapshot key list already speak in `channels`, `tweens`,
   * `fogSet`, `lightSet` and `lightDir`, and renaming them all would be churn
   * that the round-trip test could not tell from a mistake.
   */
  readonly lightBlock = new ChannelBlock();

  get channels(): number[] { return this.lightBlock.channels; }
  set channels(v: number[]) { this.lightBlock.channels = v; }
  get tweens(): (ChannelTween | null)[] { return this.lightBlock.tweens; }
  set tweens(v: (ChannelTween | null)[]) { this.lightBlock.tweens = v; }
  get fogSet(): boolean { return this.lightBlock.fogSet; }
  set fogSet(v: boolean) { this.lightBlock.fogSet = v; }
  get lightSet(): boolean { return this.lightBlock.lightSet; }
  set lightSet(v: boolean) { this.lightBlock.lightSet = v; }
  get lightDir(): { pitchDeg: number; yawDeg: number } {
    return this.lightBlock.lightDir;
  }
  set lightDir(v: { pitchDeg: number; yawDeg: number }) {
    this.lightBlock.lightDir = v;
  }

  /** Fog, derived from channels 0-4. */
  get fog(): FogState { return this.lightBlock.fog; }

  /** The directional light, derived from channels 6-8 and 10 plus `0x18`. */
  get light(): LightState { return this.lightBlock.light; }

  /**
   * The scene light block, as 11 channels -- the same numbering the tween
   * handlers use. Keeping the raw channels (rather than separate fog and
   * light structs) is what lets one stepper animate all of them, which is
   * how the game does it.
   *
   *   0 fog near   1 fog far   2,3,4 fog RGB (0-255)   5 = 2,3,4 together
   *   6,7,8 light RGB (0..1)   9 = 6,7,8 together      10 ambient
   */
  /**
   * The scene light: colour from tween channels 6/7/8, ambient from 10, and
   * the direction from opcodes 0x18/0x19 (and 0x17's slerp target, taken
   * immediately). Fed to `SetLightingDefaultSingle`'s single directional
   * light in the game.
   */

  /** True while any channel is still animating. */
  get tweening(): boolean {
    return this.tweens.some((t) => t !== null);
  }
  /** A `cam_play` with `flags & 2` stashes its range for a later 0x21. */
  stashedCam: { slot: number; start: number; end: number } | null = null;

  /**
   * `g_scene_state_major` / `g_scene_state_minor` (0x009C6F0C / 0x009C6F14).
   *
   * `EvtEnterSceneState` (`FUN_00403BD0`) records the pair and jumps to
   * `g_scene_state_table[major * 9 + minor]`, which *installs* that phase's
   * camera hook rather than doing any work itself. Three instructions reach
   * it: `queue_event` selector `0x21` with major 2 (the `cam/` path cameras),
   * selector `0x11` with the current major, and `goto_scene_state` with major
   * fixed at 1. The port tracked only the first, so the state was never a
   * state -- it is one now.
   */
  sceneState = { major: 0, minor: 0 };

  /**
   * `g_queued_events_pending` -- 0x009A2C8C. What `wait_queued_events_done`
   * (`0x40`) blocks on.
   *
   * `queue_event` adds one per action and each action handler takes one back
   * when it completes -- *except* `EvtActionFinishSequence21`, which installs
   * a persistent camera driver and never retires itself. `goto_scene_state`
   * and `set_action_drain_mode` are its script-side retirement, which is why
   * they trail almost every room: measured over the shipped scripts, all 316
   * `goto_scene_state` sites have exactly one outstanding `queue_event 0x21`
   * at that point.
   */
  /** The action ring. See `script/state/queued.ts`. */
  readonly ring = new ActionRing();

  get queuedEventsPending(): number { return this.ring.pending; }
  set queuedEventsPending(v: number) { this.ring.pending = v; }

  /**
   * How many block transitions found the action ring still owing work.
   *
   * `FUN_0045EBC0` zeroes `g_queued_events_pending` when it loads a block, so
   * a residue is silently absorbed by the engine too -- which makes it the one
   * place the port's accounting can be checked against the script's own
   * structure rather than against itself. It should be zero.
   */
  ringResidue = 0;

  /**
   * Whether the `cam_play` now running still owes its retirement.
   *
   * `CamAdvancePathFrame` retires the action when the path reaches its end; a
   * held pose (`CamEvalStaticPose`) and a deferred stash (`FUN_00403490`)
   * retire at once, so only a real playback is outstanding. The camera a
   * scene state 6/7 starts is *not* one: its `cam_play` was retired when it
   * was stashed.
   */
  private get camPending(): boolean { return this.ring.camPending; }
  private set camPending(v: boolean) { this.ring.camPending = v; }
  /**
   * The arcade branch-preview shots, from the most recent `store_six`
   * (`queue_event` sel 0x60): one camera pose per route the next branch can
   * take, indexed by `branch_choice`.
   */
  branchPreview: NonNullable<OpJson["branch_preview"]> | null = null;

  /**
   * `g_evt_cam_override_valid` — `0x009C6FD8`.
   *
   * Selector 0x60 (`store_six`) stores three `(frame, path)` pairs *and* sets
   * this, and the row-5 camera hooks `FUN_00402890` / `FUN_00402740` open with
   *
   *     if (g_cam_path_frames_left < 0 && g_evt_cam_override_valid)
   *         FUN_00403DB0(&g_camera_block);
   *
   * which re-seats `g_active_cam_path` and the path frame from the pair
   * `g_script_branch_var` selects. So a shot that has run out does not sit at
   * its own last frame — it moves to where the *next* shot will pick up, and
   * stays there until it does.
   *
   * The port had the pairs (as `branchPreview`) and neither the flag nor the
   * re-seat, so the camera held the old shot's final frame through the whole
   * fight and then cut. Stage 1 block 3 step 3 is the shape: the stashed shot
   * ends at path frame 525, the `store_six` names 555, and step 4 opens at
   * 556 — so the engine spends the fight at 555 and continues, and this port
   * spent it at 525 and jerked **27 degrees** on the frame the fight ended,
   * against a median frame-to-frame turn of 0.09.
   */
  camOverrideValid = false;
  checkpointBlock = 0;
  /**
   * There is no `flags` set here any more.
   *
   * The script flags are `G.g_script_flags` (0x009C7200) and always were one
   * array: `EvtOpSetScriptFlag48` (`FUN_0045FD70`) writes it and six actor
   * routines write it too. The walker kept a `Set` of the ones *it* had set,
   * `app/systems.ts` rebuilt `G.g_script_flags` from that set once a frame —
   * so every flag an actor raised was wiped on the next tick — and
   * `wait_script_flag` read the set rather than the array. One store, in
   * `game/globals.ts`, is the whole of the fix.
   */
  readonly loadedSlots = new Set<number>();
  spawns: ActiveSpawn[] = [];
  /**
   * What `spawn_simple` (0x0A) has placed — see {@link ActiveSimpleSpawn}.
   *
   * A second list rather than a second kind of entry in {@link spawns},
   * because the two carry different things: a placement descriptor has a
   * position, an `at` and a tail, and `EvtOpSpawnSimple0A`'s record has a
   * class and a hit-point word and nothing else. Everything that walks
   * `spawns` — the character layer, `SpawnPropContainers`, the spawn markers —
   * would have to test for the difference otherwise.
   */
  simpleSpawns: ActiveSimpleSpawn[] = [];
  cam: CamCommand | null = null;
  /**
   * True while a **replay** is walking the script rather than playback.
   *
   * A replay has to apply a wait's *postcondition* itself, because nothing
   * else will: `seek` steps over the enemy gates without shooting anything,
   * so the enemies the gate was waiting on have to be retired by hand — see
   * {@link retireGatedEnemies}.
   *
   * In **playback** none of that may happen. The gate opens there because the
   * player actually killed them, and `FUN_00454D20` plays the death clip out
   * before handing the body on — so sweeping the list the moment the last one
   * dies takes the corpses with it and the bodies vanish mid-fall.
   *
   * `seek` owns this. The drive loop in `test/seek.test.ts` sets it too,
   * because that loop is a replay standing in for playback and has to leave
   * the same state behind.
   */
  replaying = false;
  wait: PendingWait | null = null;
  branch: BranchChoice | null = null;
  finished = false;
  bgmTrack: number | null = null;
  /** The most recent `se_play` operand, for the HUD. */
  lastSound: number | null = null;

  private seq = 0;
  private readonly liveBlocks: BlockJson[];

  constructor(script: ScriptJson, host: WalkerHost,
              options: Partial<WalkerOptions> = {}) {
    this.script = script;
    this.host = host;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.liveBlocks = script.blocks.filter((b) => !b.hole);
    this.block = script.entry_block;
    // The step cursor is `G.g_evt_step_index`, so it outlives the object that
    // was driving it. Claim it here, or a freshly built walker starts at
    // whatever step the previous one stopped on.
    this.step = 0;
  }

  // -- addressing --------------------------------------------------------

  blockAt(index: number): BlockJson | undefined {
    return this.script.blocks.find((b) => b.index === index);
  }

  get currentBlock(): BlockJson | undefined {
    return this.blockAt(this.block);
  }

  get currentOp(): OpJson | undefined {
    const steps = this.currentBlock?.steps;
    return steps?.[this.step]?.ops?.[this.opIndex];
  }

  /**
   * How many of the live spawns are the classes an enemy gate waits on.
   *
   * The game's own count is `g_enemies_alive`, which knows what has been
   * shot; this is the script's view, and it is what the status panel reports
   * alongside the placement count.
   */
  get liveEnemies(): number {
    return this.spawns.filter((s) => ENEMY_GATE_CLASSES.has(s.class)).length;
  }

  // -- control -----------------------------------------------------------

  reset(): void {
    this.block = this.script.entry_block;
    // FUN_0045EBC0 picks the first step by game mode: 1 for normal Arcade
    // play, 5 for Original Mode on scene 0, 0 only on the continue and
    // checkpoint paths. The exporter resolves that rule; the walker just
    // honours it.
    const entry = this.script.entry_step ?? 1;
    const n = this.blockAt(this.script.entry_block)?.steps?.length ?? 0;
    this.step = n > entry ? entry : 0;
    this.opIndex = 0;
    this.region = -1;
    this.rollEnabled = false;
    this.useFixedEyeY = false;
    this.fixedEyeY = 0;
    this.groundY = null;
    this.forcePathAdvance = false;
    this.backdropPreset = -1;
    this.backdropMode = 0;
    this.shutter.reset();
    this.captionGroup = -1;
    this.captionFrames = 0;
    this.skippable = false;
    this.skipRequested = false;
    this.rain = false;
    this.gunLights = false;
    this.sceneLighting = false;
    this.branchChoice = 0;
    this.parked = false;
    this.stashedCam = null;
    this.sceneState = { major: 0, minor: 0 };
    this.ring.reset();
    this.branchPreview = null;
    this.camOverrideValid = false;
    this.lightBlock.reset();
    this.checkpointBlock = this.script.entry_block;
    // `ResetSceneOnEnter` (`FUN_0045EDD0`) zeroes all 0x100 bytes of
    // `g_script_flags` and nothing else in the image clears one. Starting the
    // script over is the port's scene entry, so it clears them here — which is
    // exactly the state `this.flags.clear()` used to clear on this line.
    G.g_script_flags = [];
    this.loadedSlots.clear();
    this.spawns = [];
    this.simpleSpawns = [];
    this.cam = null;
    this.wait = null;
    this.branch = null;
    this.finished = false;
    this.bgmTrack = null;
    this.lastSound = null;
    this.seq = 0;
    this.host.onBranch(null);
  }

  /**
   * The script's slice of a save state.
   *
   * Listed by name rather than cloned wholesale, because the walker also holds
   * the decoded script — `liveBlocks` alone is every block in the stage — and
   * a snapshot has no business carrying the bundle back with it.
   */
  saveState(): unknown {
    return {
      block: this.block, step: this.step, opIndex: this.opIndex,
      region: this.region, rollEnabled: this.rollEnabled,
      useFixedEyeY: this.useFixedEyeY, fixedEyeY: this.fixedEyeY,
      groundY: this.groundY, forcePathAdvance: this.forcePathAdvance,
      backdropPreset: this.backdropPreset, backdropMode: this.backdropMode,
      shutterState: this.shutterState, firingGate: this.firingGate,
      shutterPrev: this.shutterPrev, shutterCounter: this.shutterCounter,
      captionGroup: this.captionGroup, captionFrames: this.captionFrames,
      skippable: this.skippable,
      skipRequested: this.skipRequested, rain: this.rain,
      gunLights: this.gunLights, sceneLighting: this.sceneLighting,
      branchChoice: this.branchChoice, parked: this.parked,
      sceneState: { ...this.sceneState },
      queuedEventsPending: this.queuedEventsPending,
      camPending: this.camPending,
      channels: [...this.channels], tweens: this.tweens.map((t) => t && {...t}),
      fogSet: this.fogSet, lightDir: { ...this.lightDir },
      lightSet: this.lightSet, checkpointBlock: this.checkpointBlock,
      branchPreview: this.branchPreview,
      camOverrideValid: this.camOverrideValid, stashedCam: this.stashedCam,
      spawns: this.spawns.map((s) => ({ ...s })),
      simpleSpawns: this.simpleSpawns.map((s) => ({ ...s })),
      cam: this.cam && { ...this.cam },
      // The wait, countdown and all. `web/test/state.test.ts` is what caught
      // this missing: a save taken three seconds into a five-second
      // `wait_frames` used to come back as a fresh five-second one, because
      // dropping it made the next tick re-execute the instruction that armed
      // it. The op is the script's own JSON, so it clones.
      wait: this.wait && { ...this.wait, policy: { ...this.wait.policy } },
      finished: this.finished, bgmTrack: this.bgmTrack,
      lastSound: this.lastSound, seq: this.seq,
      // Sets are not JSON; the snapshot is a file the user can keep. The
      // script flags are not here: they live in `G.g_script_flags`, which the
      // game slice of the same snapshot carries.
      loadedSlots: [...this.loadedSlots],
    };
  }

  /**
   * Restore it.
   *
   * The **branch** is deliberately dropped: it is a prompt rather than a
   * state, and a restored one with no countdown behind it would park the
   * script for good. The **wait** is not, any more. It was, on the reasoning
   * that the next tick rebuilds it — which is true and is the bug, because
   * what the next tick rebuilds is a *fresh* wait. Every timed gate in a
   * restored save started again from the top, and re-emitted its feed row on
   * the way past.
   */
  loadState(v: unknown): void {
    const s = v as Record<string, never>;
    const self = this as unknown as Record<string, unknown>;
    for (const k of WALKER_RESTORED_KEYS) {
      if (s[k] !== undefined) self[k] = s[k];
    }
    // Not in the key list above: a slice written before the wait was saved
    // has no `wait` key at all, and leaving the live one standing would be
    // worse than clearing it.
    this.wait = (s["wait"] as unknown as PendingWait | null) ?? null;
    this.loadedSlots.clear();
    for (const n of (s["loadedSlots"] as unknown as number[]) ?? []) {
      this.loadedSlots.add(n);
    }
    this.branch = null;
    this.host.onBranch(null);
    // The loaded slots and the region are state; telling the host about them
    // is how the scene comes back with the right rooms streamed in.
    this.host.enterRegion(this.region);
    for (const slot of this.loadedSlots) this.host.loadSlot(slot);
    if (this.cam) this.host.startCamera(this.cam);
  }

  /**
   * Retire the enemies an enemy gate was waiting on.
   *
   * `wait_enemies_alive` (0x43) and `wait_enemies_present` (0x44) block until
   * `g_enemies_alive` / `g_enemies_present` fall to the operand, and those
   * counters only fall when the actors *die* — each class's handler
   * decrements its own on the kill path. So on the far side of one of these
   * gates every enemy placed before it is dead, by construction and not by
   * policy. The engine never has to sweep them up because the script cannot
   * get past the gate until the player has.
   *
   * The replay shoots nothing, so without this nothing retires them: a seek
   * to late in a stage arrived with every zombie the script had ever placed
   * still standing, most of them behind the camera.
   *
   * **Only ever during a replay.** In playback the gate opens because the
   * player killed them, and the bodies are still falling — doing this there
   * made every corpse disappear the instant the last enemy died.
   *
   * Only the classes `ActorIsEnemy` counts are retired. A prop, a civilian, a
   * set-piece and a scripted humanoid are all outlived by the gate — none of
   * them moves either counter, so the gate says nothing about them, and they
   * have their own lifetimes (`g_evt_step_index` for the props, a camera
   * cue for the set-pieces).
   *
   * [diverges] The engine's counters are the truth and the actor list follows
   * them; here the actor list *is* the truth and the counters are derived, so
   * this drops the actors rather than zeroing a counter.
   *
   * The operand is not consulted, and it does not need to be: **all 488
   * enemy gates in the six shipped scripts wait for zero** — 54 of `0x43`
   * and 434 of `0x44`, every one with `arg == 0`. A gate that waited for
   * "two left" would leave two specific enemies alive that the replay has no
   * way to choose between; no such gate exists.
   */
  private retireGated(classes: ReadonlySet<number>): void {
    if (!this.replaying) return;
    this.spawns = this.spawns.filter((s) => !classes.has(s.class));
  }

  /**
   * Step past the wait the interpreter is sitting on, as if its condition had
   * just been met.
   *
   * This is exactly what `executeOne` left undone when it raised the wait —
   * the waiting instruction has already run, so only the cursor has to move.
   * Every path that releases a wait without the condition actually being
   * tested goes through here (`seek`, `primeToFirstWait`, the drive loop in
   * `test/seek.test.ts`), so that the wait's **postcondition** is applied in
   * one place: see {@link retireGated}.
   *
   * Which waits have one is the rule table's answer, not a second list of
   * opcode numbers here. It used to be `{0x43, 0x44}` written out, which is
   * why `wait_scripted_actors` was never retired: adding a gate meant
   * remembering to add it in two places, and nobody did.
   */
  stepOverWait(): void {
    if (!this.wait) return;
    const rule = WAIT_RULES.get(this.wait.op.op);
    const retires = rule?.retires;
    if (retires) this.retireGated(retires === "civilians"
      ? CIVILIAN_GATE_CLASSES : ENEMY_GATE_CLASSES);
    if (rule?.skipRunsCameraOn) this.runCameraOnPast(this.wait.op);
    // The third postcondition: a `wait_script_flag` is only ever passed in
    // play with the byte already a 1, so a replay that steps over one has to
    // raise it. Without this a seek lands past a gate whose flag is still 0,
    // and the classes that read the same array — 0x24's removal cue, 0x30's
    // states 20 and 31, 0x31's cue conditions, 0x52's despawn — see a world
    // the address does not describe.
    if (rule?.raisesScriptFlag) G.g_script_flags[this.wait.op.arg ?? 0] = 1;
    this.wait = null;
    this.opIndex++;
  }

  /**
   * The camera half of a wait's postcondition — see
   * {@link WaitRule.skipRunsCameraOn}.
   *
   * Put the shot where the script would have been standing when the wait it
   * is stepping over opened: at `endFrame` for the operand-0 form, which is
   * "to the end of the path", and one frame past the operand otherwise, which
   * is the strict `operand < g_cam_path_frame` of
   * `EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`).
   *
   * The frames in between are **not** published, and cannot be: a seek jumps
   * where playback steps, so nothing that reads `g_cam_path_frame` once a
   * frame — a class-0x30 camera cue, a civilian's `CameraCue` wait — sees
   * them. What this buys is the landing state, not the trip: the shot is over
   * where the address says it is over, and the cues timed to its end are
   * satisfiable rather than one frame out of reach for ever.
   */
  private runCameraOnPast(op: OpJson): void {
    const cam = this.cam;
    if (!cam || cam.isStatic) return;
    const arg = op.arg ?? 0;
    const to = arg === 0 ? cam.endFrame : Math.min(arg + 1, cam.endFrame);
    if (to <= cam.frame) return;
    cam.frame = to;
    cam.started = false;
    if (cam.frame >= cam.endFrame) cam.done = true;
    this.settleCameraAction();
    this.host.startCamera(cam);
  }

  /**
   * Take one instruction, ignoring any wait. Returns false when stuck.
   *
   * **`stepOverWait`, not `this.wait = null`.** `executeOne` does not advance
   * `opIndex` when it raises a wait -- the cursor stays on the blocking
   * instruction, which is what makes the wait re-arm itself every tick until
   * it is satisfied. Clearing the field and calling `executeOne` therefore ran
   * *the same instruction again*, raised the same wait with a fresh
   * `framesLeft`, and left the cursor exactly where it started: the
   * ArrowRight key did nothing at all on any blocking instruction, for ever.
   *
   * The seek and test loops never saw it because they call `stepOverWait()`
   * first; this path is the interactive one, and it had no test.
   *
   * Stepping past a gate retires what the gate was waiting on, for the same
   * reason a seek does -- otherwise the next instruction runs against a world
   * the script never expected, with the enemies still standing.
   */
  stepOnce(): boolean {
    this.stepOverWait();
    // Stepping advances instructions, not frames, so a shutter close that is
    // still counting down would never finish and would hold the firing gate up
    // for the rest of the session.
    if (this.shutterState === 3) this.shutter.settle();
    return this.executeOne(false);
  }

  /**
   * Run from a standing start to the first instruction that blocks.
   *
   * Without this the opening state is "block 0, nothing executed", which
   * means no `region_enter` has run and no `cam_play` has been issued -- so
   * no region is resident and the camera has no pose. That is a truthful
   * representation of instruction 0 and a black screen, which is not a useful
   * place to open. Priming to the first wait puts the player where the stage
   * actually starts.
   */
  primeToFirstWait(maxOps = 4096): void {
    let n = 0;
    while (!this.finished && !this.parked && !this.branch && n++ < maxOps) {
      if (this.wait) {
        // Stop at a wait only once the scene is actually set up. The first
        // wait in a stage comes very early -- stage 1 blocks on
        // `wait_queued_events_done` at instruction 9 -- and everything that
        // makes the opening frame look right runs after it: the region, the
        // scene light, the ground plane, the backdrop preset, the rain. The
        // game reaches those a second or two later, once the camera move it
        // is waiting on finishes; opening there would just show a black
        // screen with no sky.
        if (this.cam && this.region >= 0) break;
        this.stepOverWait();
      }
      if (!this.executeOne(false)) break;
    }
  }

  /**
   * Advance simulated time. `dt` is in seconds; the game runs at 60 Hz and
   * every frame-valued quantity in the data is on that clock.
   *
   * **The camera moves after the instructions, and that is not cosmetic.**
   * The engine runs two tasks here, not one: `EvtInterpreterLoop` and
   * `EvtRunQueuedActions` (`FUN_00402320`), created in that order — first and
   * third — by the scene's task list at `0x00460710`. That *is* the execution
   * order: `ActorAlloc` (`FUN_004A6FA0`) appends a task at its parent's tail
   * (`+0x2C`) and `TaskRunTree` (`FUN_004A71A0`) walks the `+0x28` list from
   * the head through `+0x1C`. `CamAdvancePathFrame` (`FUN_004035E0`) lives in
   * the second task and does three things in one call, in this order:
   *
   * ```c
   * g_cam_path_frame = cur;          // publish -- BEFORE the end test
   * DAT_009C6F28 = end - cur;        // what wait_camera_path_frame 0 reads
   * if (end <= cur) { cur++; g_evt_action_advance = 1;
   *                   g_queued_events_pending--; return; }
   * cur++;
   * ```
   *
   * so on the frame a path reaches its end the engine **publishes that last
   * frame** and only then retires the action — and the interpreter, which ran
   * earlier in the same frame, cannot act on either the retirement or the
   * `end - cur` it just wrote until the next one. Every object update in
   * between sees the path's final frame.
   *
   * The port collapses both tasks into this method, and it used to run the
   * camera half first. So the frame a shot ended on was advanced past,
   * `wait_queued_events_done` and `wait_camera_path_frame 0` both fell through
   * in the *same* tick, and the `cam_play` behind them moved the camera on
   * before `syncPortGlobals` ever read it: stage 1's `cam_play 115..179`
   * published 178 and then 180. Frame 179 — which is what three class-0x30
   * zombies wait on with an exact `==`, because the game times an entrance to
   * the end of a shot by writing the shot's own end frame as the cue — was
   * never a value the port held, and those zombies stood in their entrance
   * clip for the rest of the stage. `tools/cam_cues.mjs` is the harness for it.
   */
  tick(dt: number, fps = 60): void {
    if (this.finished || this.branch || this.parked) return;
    this.runInstructions(dt, fps);
    this.advanceCameraPath(dt * fps);
  }

  /**
   * `EvtRunQueuedActions`' share of one frame: step the path, then retire the
   * action if the path has ended. See {@link tick} for why it is last.
   */
  private advanceCameraPath(frames: number): void {
    const cam = this.cam;
    if (cam && !cam.isStatic) {
      if (cam.done) {
        // The handler published the shot's last frame on the tick `done` was
        // set and was dequeued in the same call, so this is the first tick on
        // which nothing writes the camera block. See {@link CamCommand.retired}.
        cam.retired = true;
      } else if (cam.started) {
        // A shot that started during this tick's instructions has already
        // published its first frame — `CamStartPathPlayback` calls
        // `CamAdvancePathFrame` itself and the ring calls the handler once.
        cam.started = false;
      } else {
        const remaining = cam.endFrame - cam.frame;
        const used = Math.min(frames, Math.max(0, remaining));
        cam.frame += used;
        if (cam.frame >= cam.endFrame) cam.done = true;
      }
    }
    // `CamAdvancePathFrame` retires its action on the frame the path ends.
    this.settleCameraAction();
  }

  /** `EvtInterpreterLoop`'s share of one frame. See {@link tick}. */
  private runInstructions(dt: number, fps: number): void {
    let frames = dt * fps;

    // Light and fog animate on the same 60 Hz clock as everything else.
    this.lightBlock.step(dt * fps);

    this.shutter.step(dt * fps);
    // The caption is a countdown in script frames, not in wall time: stepping
    // onto a `play_dialogue` and having the line expire two seconds later
    // while nothing is playing makes it unreadable.
    if (this.captionFrames > 0) {
      this.captionFrames = Math.max(0, this.captionFrames - dt * fps);
      if (this.captionFrames === 0) this.captionGroup = -1;
    }

    if (this.wait) {
      const w = this.wait.policy;
      if (w.kind === "frames") {
        const used = Math.min(frames, w.framesLeft);
        w.framesLeft -= used;
        frames -= used;
        if (w.framesLeft > 0) return;
      } else if (!this.waitSatisfied()) {
        return;
      }
      // Deliberately no retirement here: this is the *playback* path, where
      // the gate opened because the enemies really are dead and their death
      // clips are still running.
      this.wait = null;
      this.opIndex++;
    }

    let guard = 0;
    while (!this.finished && !this.parked && !this.wait && !this.branch &&
           guard++ < 4096) {
      if (!this.executeOne(false)) break;
    }
  }

  /** evt `0x1F`. The whole transition is `script/state/shutter.ts`. */
  setShutter(state: number): void {
    this.shutter.set(state);
  }

  /**
   * True when the game would be offering a skip: inside a skippable region
   * (`DAT_009A2D7C`) with the firing gate down (`g_nFiringGate == 0`).
   */
  get canSkip(): boolean {
    return this.skippable && !this.firingGate && !this.finished;
  }

  /**
   * Press Start, and let `SkipWatchTask` do what it does.
   *
   * Everything here is transcribed from `0x00435F40`; see {@link skipRequested}
   * for the chain. Returns false when the game would not have offered a skip.
   */
  requestSkip(): boolean {
    if (!this.canSkip) return false;
    this.skipRequested = true;

    // `if (cam_end != cam_frame) cam_end = cam_frame`. Note what this is *not*:
    // the camera does not fast-forward to the end of its path. The move is
    // ended where it stands, which retires the queued event and lets
    // `wait_queued_events_done` fall through on the next frame.
    if (this.cam && !this.cam.done) {
      this.cam.endFrame = this.cam.frame;
      this.cam.done = true;
      this.settleCameraAction();
      this.host.startCamera(this.cam);
    }

    // DrawDialogueSubtitleTask tests the flag every frame and ends the task,
    // so a line already on screen goes at once rather than playing out.
    this.captionGroup = -1;
    this.captionFrames = 0;
    this.host.endDialogue();

    // The waits are re-run every frame, so one already pending is released
    // the same way a new one is passed straight through.
    if (this.wait && WAIT_RULES.get(this.wait.op.op)?.skippable) {
      this.wait = null;
      this.opIndex++;
    }
    return true;
  }

  /**
   * `g_camera_free`, the second half of every room-clear gate.
   *
   * A host that cannot evaluate it -- no simulation running -- reports `null`,
   * and the term drops out rather than parking the script on a condition
   * nothing can ever satisfy. That is the same rule the counters use.
   */
  /** Public because the enemy gates test it. See `script/waits/`. */
  cameraHasHandedBack(): boolean {
    return this.host.cameraFree() !== false;
  }

  private waitSatisfied(): boolean {
    const w = this.wait;
    if (!w) return true;
    const rule = WAIT_RULES.get(w.op.op);
    return rule?.satisfied?.(w.policy, w.op, this.waitContext) ?? true;
  }

  /**
   * What a wait rule may ask of the machine, and nothing more.
   *
   * The walker *is* one of these — `WaitContext` is a structural view of the
   * six members a rule may touch, so this costs nothing and the interface is
   * the whole of the surface. A rule that needs something not on it is a rule
   * reaching into the interpreter rather than being driven by it, and it will
   * not compile.
   */
  private get waitContext(): WaitContext {
    return this;
  }

  // -- execution ---------------------------------------------------------

  /**
   * Take one instruction.
   *
   * Public because `script/seek.ts` drives it: a seek is a planner over the
   * machine's own surface, not a mode inside it.
   */
  executeOne(quiet: boolean): boolean {
    if (this.finished || this.parked || this.branch || this.wait) return false;
    const blk = this.currentBlock;
    if (!blk || blk.hole || !blk.steps || blk.steps.length === 0) {
      return this.advanceStepOrRoute(quiet);
    }
    if (this.step >= blk.steps.length) return this.advanceStepOrRoute(quiet);
    const step = blk.steps[this.step];
    // Falling off the end of a step's instructions is the same thing
    // `advance_step` does explicitly: move to the next step.
    if (this.opIndex >= step.ops.length) return this.advanceStepOrRoute(quiet);

    const op = step.ops[this.opIndex];
    // Where the program counter was before the handler ran. `advance_step`
    // (0x4F) moves it itself -- and so does anything else that calls
    // `advanceStepOrRoute` or `goToBlock` -- so the increment below has to be
    // conditional or the new step's **first instruction is skipped**.
    //
    // `EvtAdvanceStepOrRoute` (`FUN_0045F000`) is unambiguous about this:
    // it ends by assigning the instruction pointer outright,
    //
    //     DAT_009C7108 = FUN_0045EB90(scene, block, step);
    //
    // which is the address of the new step's first instruction. This VM has
    // no shared post-increment at all -- every handler advances the pointer
    // for itself (`EvtOpGotoSceneState31` does `DAT_009C7108 += 8`), so
    // landing on an instruction means executing it.
    //
    // The port had an unconditional `opIndex++` here, so op 0 of every step
    // entered through an `advance_step` never ran. 460 of the 479 steps in
    // stages 1-6 open with a real instruction, and what was being dropped was
    // 118 checkpoints, 63 asset loads, 21 `queue_event`s, 12 `region_load`s
    // and 8 `region_enter`s. Two visible consequences, both reported:
    // stage 2 block 17 step 6's `region_enter 32` never ran, so the outdoor
    // geometry appeared a step late; and step 7's `cam_play 231..365` never
    // ran, so the camera clock sat at frame 230 until the deferred play at
    // op 13 threw it to 366 -- a 41-unit jump in the camera's position, in
    // the doorway, which is the "snaps from inside to outside" this fixes.
    const pcBlock = this.block;
    const pcStep = this.step;
    const pcOp = this.opIndex;
    const note = this.apply(op, quiet);
    if (!quiet) {
      this.host.onFeed({
        seq: this.seq++,
        block: pcBlock,
        step: pcStep,
        opIndex: pcOp,
        op,
        note,
      });
    }
    if (this.wait || this.branch || this.finished || this.parked) return true;
    if (this.block === pcBlock && this.step === pcStep
        && this.opIndex === pcOp) {
      this.opIndex++;
    }
    return true;
  }

  /**
   * Every opcode this client knows about: what it does, and how far that goes.
   *
   * The two used to live apart -- the behaviour in a `switch` here, the
   * status in `opstatus.ts` -- and they drifted, which is the only thing a
   * parallel table reliably does. `enable_rain` was implemented for weeks
   * while the script tree struck it through as unimplemented. So they are one
   * declaration now: an opcode's `status` sits on the same object as the `run`
   * that justifies it, and adding a handler without saying what it achieves is
   * not expressible.
   *
   * `run` absent means the client deliberately does nothing: either the opcode
   * is a proved no-op in the game (`none`), or it is decoded and listed but
   * not acted on (`shown`). An opcode absent from the table entirely is
   * treated as `shown`.
   */
  private static readonly OPS: Record<number, OpImpl> = OPS_TABLE;

  /** 0x17 and 0x18 differ only in that one of them is a slerp. */
  static setLightDir(w: Walker, op: OpJson): string | undefined {
    if (op.pitch_deg !== undefined) {
      w.lightDir = {
        pitchDeg: op.pitch_deg,
        yawDeg: op.yaw_deg ?? w.lightDir.yawDeg,
      };
      w.lightSet = true;
    }
    return op.op === 0x17 ? "slerp target taken immediately" : undefined;
  }

  static playSe(w: Walker, op: OpJson, quiet: boolean): string | undefined {
    w.lastSound = op.sound ?? null;
    return quiet || !op.sound ? undefined : w.host.playSound(op.sound);
  }

  /**
   * `EvtOpSpawnSimple0A`'s operand list, onto {@link simpleSpawns}.
   *
   * The engine allocates one object per operand and **does not** collapse
   * duplicates, so neither does this: stage 3's block 11 lists the same record
   * twice on purpose.
   */
  static pushSimpleSpawns(w: Walker, op: OpJson): string | undefined {
    if (!op.simple?.length) return undefined;
    op.simple.forEach((s, i) => {
      w.simpleSpawns.push({
        // `-(instruction address * 8 + slot) - 1` — negative so it can never
        // be read as a descriptor offset, and per-operand so two records on
        // one instruction are two objects. See {@link ActiveSimpleSpawn}.
        at: -(op.at * 8 + i) - 1,
        class: s.class,
        hp: s.hp,
        block: w.block, step: w.step, opIndex: w.opIndex,
      });
    });
    const n = op.simple.length;
    return `${n} simple spawn${n === 1 ? "" : "s"}`;
  }

  static pushSpawns(w: Walker, op: OpJson): string | undefined {
    if (!op.spawns?.length) return undefined;
    for (const s of op.spawns) {
      w.spawns.push({
        ...s,
        block: w.block,
        step: w.step,
        opIndex: w.opIndex,
        opcode: op.op,
      });
    }
    return `${op.spawns.length} spawn${op.spawns.length === 1 ? "" : "s"}`;
  }

  /** How far this client honours *op*. See {@link Walker.OPS}. */
  static statusOf(op: number): OpStatus {
    return Walker.OPS[op]?.status ?? "shown";
  }

  /** Apply one instruction. Returns a note for the feed, if there is one. */
  private apply(op: OpJson, quiet: boolean): string | undefined {
    return Walker.OPS[op.op]?.run?.(this, op, quiet);
  }

  /**
   * A fog / scene-light channel write on block 0.
   *
   * `0x20` sets immediately. `0x21` and `0x23` start a tween, and the game
   * *animates* those over frames -- a hard swap is visibly wrong, most
   * obviously on fog, which stage 2 alone ramps 247 times. Both opcodes end
   * up as `{to, per-frame rate}`, so one stepper serves both:
   *
   *   0x21 tween_rate  rate comes straight from the operand
   *   0x23 tween_time  the handler pre-divides, rate = |to - from| / frames
   *
   * Channel 5 is "all three fog components at once" and 9 the same for the
   * light colour, which is why they fan out to three channels here.
   */
  /** One of the light-block opcodes. See `script/state/channels.ts`. */
  applyLightChannel(op: OpJson): string | undefined {
    return this.lightBlock.apply(op);
  }

  /**
   * `EvtEnterSceneState` -- `FUN_00403BD0`.
   *
   * The table cell is a hook *installer*, and the only hook this client draws
   * from is the `cam/` path, so what the port keeps is the state itself. It
   * matters because the row decides who owns the camera: row 2 is the path
   * cameras, row 1 hands the camera to the player's own view angles, and
   * leaving row 2 is what ends a scripted shot.
   */
  enterSceneState(major: number, minor: number): void {
    this.sceneState = { major, minor };
  }

  /**
   * `goto_scene_state`'s retirement of the outstanding `queue_event 0x21`.
   *
   * Also drops the camera the `finish_sequence` was driving: opcode 0x31
   * parks the ring's handler slot on a bare `RET`, which is what stops the
   * per-minor camera driver running. In this client that means the deferred
   * play stops advancing -- it is already at its end in every shipped case,
   * because a `wait_camera_path_frame 0` precedes the `goto_scene_state`.
   */
  retireSceneSequence(): void {
    this.settleCameraAction();
    this.ring.retire();
  }

  /** `set_action_drain_mode`'s signed `pending += delta`. */
  addQueuedEvents(delta: number): void {
    this.ring.add(delta);
  }

  /** Public because `wait_queued_events_done` settles it. See `waits/`. */
  settleCameraAction(): void {
    this.ring.settle(this.cam);
  }

  /**
   * `queue_event` (0x30): queue one action and run it.
   *
   * The action is a table lookup — `script/state/camera_action.ts` — and not a
   * chain of `if (op.action === "...")` here. It was 140 lines of that, which
   * is the shape `ops/` exists to remove: which branch retires the ring was a
   * fact spread over the whole method, and the ring and camera accounting bugs
   * lived in exactly that spread.
   *
   * `EvtOpQueueEvent30` adds one to `g_queued_events_pending` for every action
   * it queues; each handler says for itself whether it takes that one back.
   */
  applyQueueEvent(op: OpJson): string | undefined {
    this.ring.queued();
    const action = (op.action ? ACTIONS[op.action] : undefined) ?? UNMODELLED;
    return action(this, op);
  }

  /**
   * Raise a wait, or record why it did not block.
   *
   * The rule for the opcode decides both halves — see `script/waits/`. This
   * used to be a seventy-line `else if` chain here and a `switch` over the
   * policies it produced two hundred lines away, two places that had to agree
   * with nothing checking that they did.
   */
  applyWait(op: OpJson): string | undefined {
    const blocksOn = op.blocks_on ?? "";
    const rule = WAIT_RULES.get(op.op);

    // Every skippable opcode opens with the same test -- 0x40 and 0x41 with
    // `if (skip == 0) { ...block... }`, 0x42 with `if (skip != 0) { clear and
    // advance }` -- so a raised flag walks straight past them. The flag is not
    // cleared here: it stays up until `set_skippable_region` closes the
    // region, which is what makes one press skip a whole cutscene rather than
    // a single wait.
    if (this.skipRequested && rule?.skippable) {
      return `${blocksOn} -- skipped`;
    }

    const policy = rule
      ? rule.enter(op, this.waitContext)
      : passedBecause(op);
    if (policy.kind === "passed") {
      // **A replay that walks past a gate has to leave the gate's world
      // behind it.** `wait_enemies_alive 0` is only reached in play once the
      // enemies are dead, so a seek that steps over it and keeps their spawns
      // arrives in a state the game cannot be in: the previous scene's actors
      // standing in the next scene's block, counted alive, holding the very
      // gate the script is about to reach open. The wait's own postcondition
      // is the answer -- retire exactly what it counts.
      if (rule?.retires) this.retireGated(rule.retires === "civilians"
        ? CIVILIAN_GATE_CLASSES : ENEMY_GATE_CLASSES);
      // Not `raisesScriptFlag` here: `0x45` only reaches this arm with the
      // flag *already* raised, so there is nothing to reproduce. The
      // postcondition belongs to `stepOverWait`, which is the path that walks
      // past a gate whose condition is false.
      return `${blocksOn} -- ${policy.why}`;
    }
    this.wait = { op, blocksOn, policy };
    return blocksOn;
  }

  // -- routing -----------------------------------------------------------

  /**
   * `advance_step` (0x4F), transcribed from `EvtAdvanceStepOrRoute` (0x0045F000):
   *
   * ```c
   * step += 1;
   * if (EvtGetStep(scene, block, step) == -1) {      // step table exhausted
   *     kind = route[block].kind;
   *     if      (kind == 0) block = route[block].next[0];
   *     else if (kind == 1) block = route[block].next[branch_choice];
   *     else if (kind == 2) block = block + 1;
   *     step = 1;
   * }
   * if (EvtGetBlock(scene, block) == -1) { ...scene over... }
   * pc = EvtGetStep(scene, block, step);
   * branch_choice = 0;
   * ```
   *
   * Three things in there are easy to get wrong, and this walker had all
   * three wrong before it was read properly:
   *
   * 1. **A block's steps run in sequence.** `advance_step` advances to the next
   *    *step*, not out of the block. Only when the step table is exhausted
   *    does the route table get consulted. Treating every `advance_step` as a
   *    block exit skips most of a stage -- including the `region_enter` and
   *    `cam_play` instructions that live in the later steps.
   * 2. **`kind == 2` is not "the scene ends".** It falls through to
   *    `block + 1`. The scene ends when the block it lands on is a hole.
   * 3. **A branch takes `next[branch_choice]`**, and `branch_choice` is reset
   *    to 0 **on every step advance** -- the store is on the normal return
   *    path, after `pc = EvtGetStep(...)`, so it fires whether or not the step
   *    list ran out. This walker used to clear it only on a block change,
   *    which is the weaker claim three of this project's documents also made.
   *    The stronger one is what makes the shipped scripts legible: almost
   *    every branch block spawns the actor that decides its branch in the
   *    block's **last** step, because a write made any earlier would be wiped
   *    by the next step boundary. The scene-over path returns before the
   *    store, so a scene ends with the last value standing.
   *
   * Nothing in the *script* ever sets it -- every writer is gameplay code, and
   * the one the port reaches is a rescued civilian's `SetRouteBranch`. With no
   * gameplay a branch takes `next[0]`, which is the game's answer and not a
   * fallback.
   */
  advanceStepOrRoute(quiet: boolean): boolean {
    this.step += 1;
    this.opIndex = 0;
    const blk = this.currentBlock;
    if (blk?.steps && this.step < blk.steps.length) {
      // The tail of `EvtAdvanceStepOrRoute`, on the path where the step list
      // had another step in it. See point 3 above.
      this.branchChoice = 0;
      return true;
    }

    const route = blk?.route ?? this.script.routes[this.block];
    if (!route) {
      this.finished = true;
      return false;
    }

    if (route.kind === "branch" && !quiet) {
      const targets = route.next.filter((n) => n >= 0);
      if (targets.length > 1) {
        // [diverges] **The pause is the port's, the choice is the game's.**
        // The engine reads `g_script_branch_var` here and goes; this holds
        // for `branchCountdown` seconds so a viewer can take the other route,
        // and takes the engine's answer if nobody does. The value is latched
        // now, for the reason on `BranchChoice.choice`.
        this.branch = {
          block: this.block,
          targets,
          choice: this.branchChoice,
          countdown: this.options.branchCountdown,
          preview: this.branchPreview,
        };
        this.host.onBranch(this.branch);
        return true;
      }
    }

    let next: number;
    if (route.kind === "goto") next = route.next[0];
    else if (route.kind === "branch") next = route.next[this.branchChoice] ?? -1;
    else next = this.block + 1;              // kind 2: fall through

    return this.goToBlock(next);
  }

  /**
   * Enter a block at **step 1**, as every route transition does.
   *
   * Step 0 is reached only at scene entry (and then only in some game modes)
   * or through the checkpoint path, which is why the tree presents it as
   * checkpoint state rather than running it inline.
   *
   * Returns false when the scene is over -- the block does not exist, or is a
   * hole, which is exactly the `EvtGetBlock() == -1` test.
   */
  goToBlock(index: number, step = 1): boolean {
    const blk = this.blockAt(index);
    if (index < 0 || !blk || blk.hole) {
      this.finished = true;
      this.branch = null;
      this.host.onBranch(null);
      return false;
    }
    // `FUN_0045EBC0` loads a block's program and zeroes `g_queued_events_pending`
    // with it, so the ring's accounting cannot drift across a block boundary.
    // That is a real bound, not a tidy-up: it is why a miscounted action costs
    // at most one block rather than deadlocking the stage.
    if (this.queuedEventsPending !== 0) this.ringResidue += 1;
    this.ring.reset();
    if (this.options.clearSpawnsOnBlock) {
      this.spawns = [];
      this.simpleSpawns = [];
    }
    // The preview shots belong to the branch in the block that stored them --
    // every `store_six` in the game sits in a branch block. Carrying one
    // across a block change offers an unrelated shot for the next branch,
    // which is exactly as wrong as it sounds.
    this.branchPreview = null;
    this.block = index;
    this.step = (blk.steps?.length ?? 0) > step ? step : 0;
    this.opIndex = 0;
    this.branch = null;
    // Reset last, matching the tail of EvtAdvanceStepOrRoute: a choice
    // applies to exactly one transition and never carries forward.
    this.branchChoice = 0;
    this.host.onBranch(null);
    return true;
  }

  /**
   * Resolve a paused branch by setting `g_script_branch_var` and taking the
   * transition.
   *
   * **Passing nothing takes the route the game took**, which is the value
   * `advanceStepOrRoute` latched when the step list ran out. That used to be
   * `Math.min(...targets)` — the lowest block number — a stand-in written
   * while nothing had read the engine's selector; the selector is read now,
   * and the stand-in is gone. A stage with no gameplay in it still routes the
   * same way every run, because 0 is the value the engine leaves behind when
   * nobody has been rescued.
   */
  takeBranch(target?: number): void {
    const b = this.branch;
    if (!b) return;
    const route = this.currentBlock?.route ?? this.script.routes[this.block];
    let choice: number;
    if (target !== undefined && route) {
      choice = route.next.indexOf(target);
      if (choice < 0) choice = 0;
    } else {
      choice = b.choice;
    }
    this.branchChoice = choice;
    this.branch = null;
    const next = route?.next[choice] ?? -1;
    this.goToBlock(next);
  }

  tickBranchCountdown(dt: number): void {
    if (!this.branch) return;
    this.branch.countdown -= dt;
    // Deliberately does NOT re-notify the host. Re-announcing an unchanged
    // branch every frame made the UI rebuild its route buttons 60 times a
    // second, so a button was always destroyed between pointerdown and
    // pointerup and no click ever landed. The countdown is readable from
    // `branch.countdown`; only a *change* of branch is an event.
    if (this.branch.countdown <= 0) this.takeBranch();
  }

  get blockCount(): number {
    return this.liveBlocks.length;
  }
}

/**
 * How far this client honours an opcode, and whether it does anything at all.
 *
 * Both read the same table the interpreter dispatches through, so a striking
 * through in the script tree cannot disagree with what the walker does.
 */
export function opStatus(op: number): OpStatus {
  return Walker.statusOf(op);
}
