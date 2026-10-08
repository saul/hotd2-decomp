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

import { ActorByAt, G } from "../game/globals";
import { CameraUpdateHook, EvtActionHandler } from "../game/camera/driver";
import { EvtGotoSceneState, EvtQueueAction,
         EvtOpSetActionDrainMode33 } from "../game/camera/actions";
import { CameraReplayFor, CameraReplaySettle, CameraReplayUntil }
  from "../game/camera/actor";
import { SpawnClass } from "../game/spawn_class";
import { ITEM_SELECT_RESUME_STEP } from "../game/class6e/state";
import { ItemSelectPassedBySeek } from "../game/class6e";

/** `wait_enemies_present` -- `EvtOpWaitEnemiesPresent43`. */
const WAIT_ENEMIES_PRESENT_OP = 0x43;
import { g_class_handlers } from "../game/registry";
import type { BlockJson, OpJson, ScriptJson, SpawnJson } from "../bundle";
import type { OpStatus } from "./opstatus";
import { OPS as OPS_TABLE } from "./ops";
import { WAIT_RULES, passedBecause, type WaitContext } from "./waits";
import { CivilianRaisesScriptFlag } from "./waits/flag";
import {
  CivilianEndsRemovable, CivilianHasChildren, CivilianRemoveCue,
  type CivilianLife,
} from "./civilian_life";
import { ApplyLightChannelOp } from "./state/channels";
import { Shutter } from "./state/shutter";
import {
  LightBlockInit, LightBlockSetDirection, makeLightTweens,
} from "../game/light_block";


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
  /**
   * `[port-only]` A class's replay scratch for this record -- see
   * `ClassHandler.followReplayCamera`. Absent until a replay shows the record
   * a camera.
   */
  replay?: Record<string, number>;
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
  /** `g_cam_path_frame`, the frame the camera published last. */
  frame: number;
  flags: number;
  isStatic: boolean;
  /** The shot is the stashed rail's: scene state (2,6) or (2,7) steps it. */
  deferred: boolean;
  file: string | null;
  pathIndex: number | null;
  /** `g_cam_path_frames_left <= 0`: the last frame has been published. */
  done: boolean;
  /**
   * Nothing writes the camera block from this shot any more: the action slot
   * no longer holds `CamAdvancePathFrame`. One frame after {@link done} for a
   * playing shot -- the end frame is published, then the slot is replaced.
   */
  retired: boolean;
  /**
   * **This play publishes one frame past {@link endFrame}**: a stashed range
   * under scene state (2,7), whose `CameraPlayStashedPath` guards with `JG`
   * where (2,6)'s `CameraStepRailTick` has `JGE` (`0x0040C8C0` against
   * `0x0040C7A0`). Stage 2's block 9 times a civilian's cue to that frame.
   */
  pastEnd: boolean;
}

/**
 * What the last `cam_play` queued said about its shot: the description the
 * player's own panels show. `[port-only]` -- the game reads the path words in
 * `G`, never this.
 */
export interface ShotMeta {
  slot: number;
  startFrame: number;
  endFrame: number;
  flags: number;
  isStatic: boolean;
  deferred: boolean;
  file: string | null;
  pathIndex: number | null;
}

export type WaitPolicy =
  | { kind: "frames"; framesLeft: number }
  /** `wait_camera_path_frame`: blocks until the path frame passes `arg`. */
  | { kind: "camera"; arg: number }
  /**
   * The first-visit yield of a wait whose condition this client cannot hold
   * on (`why` says which): it costs the frame the engine's does, and passes
   * on the next visit.
   */
  | { kind: "yield"; why: string }
  /** The real gate: blocks until the player has killed them. */
  | { kind: "enemies" }
  /** `wait_scripted_actors`: blocks until the civilians have left play. */
  | { kind: "civilians" }
  /** `wait_queued_events_done`: blocks while the action ring owes work. */
  | { kind: "queued" }
  /** `wait_script_flag`: blocks until `g_script_flags[index]` is raised. */
  | { kind: "flag"; index: number }
  /** `wait_targets_clear`: blocks while anything is a camera candidate. */
  | { kind: "targets" }
  | { kind: "passed"; why: string };

export interface PendingWait {
  op: OpJson;
  blocksOn: string;
  policy: WaitPolicy;
  /**
   * `g_evt_block_index`, `g_evt_step_index` and `g_evt_ip` when the wait was
   * entered: the instruction the interpreter will run again next frame. Plain
   * numbers, so a snapshot keeps them.
   */
  addr: [number, number, number];
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
   * `[port-only]` debug aid, **off by default**: hold at a route branch for
   * {@link branchCountdown} seconds so a viewer can take the other road.
   *
   * Off is the engine. `EvtAdvanceStepOrRoute` (`FUN_0045F000`) reads
   * `g_script_branch_var` when the step list runs out and goes straight to
   * `next[choice]` on the same frame; there is no window in the game. The
   * sidebar's "Pause at branches" switch sets this.
   */
  branchPause: boolean;
  /**
   * Seconds a paused branch waits before it takes the game's own answer.
   * Hovering the branch bar freezes it, so this is the unattended pace, not a
   * deadline. Only read with {@link branchPause} on.
   */
  branchCountdown: number;
}

export const DEFAULT_OPTIONS: WalkerOptions = {
  branchPause: false,
  branchCountdown: 1.5,
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
   * `wait_targets_clear` (0x47)'s condition — `(g_camera_settled ||
   * g_camera_free) && g_camera_candidate_count == 0` — or `null` when this
   * client has no camera or object pool to ask. Optional, so a walker-only
   * host that has neither passes the gate, as `WAIT_NOTES` says.
   */
  cameraTargetsClear?(): boolean | null;
  /**
   * `g_evt_gameplay_live` (`0x007DCCA4`) -- may the script pass a wait this
   * frame -- or `null` when this client has no player to ask.
   *
   * `EvtInterpreterLoop` (`FUN_0045ECC0`) recomputes it before its first
   * instruction: 1 while a player is in play (state 5) with a life, or in a
   * demo run. Every wait opcode, `0x40` to `0x47`, tests it before it lets
   * the script on, so on the continue screen the script stands at whatever
   * wait it had reached while the scene runs on under it. Optional, so the
   * walker-only hosts in `test/` and `web/tools/`, which have no player,
   * leave every gate as it was.
   */
  gameplayLive?(): boolean | null;
  /**
   * evt `0x2D`: `EvtOpPlayDialogue2D` (`FUN_00435B80`), made with the host's
   * events bus for the voice. The subtitle task it allocates is `G`'s
   * (`game/dialogue.ts`); what comes back is the feed note, or null when
   * nothing was said.
   */
  showMessage(group: number): { note?: string } | null;
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
  SpawnClass.Boss3,                 // 0x45 — head 2 (`INC` 0x00420082/89,
                                    //        `DEC` 0x00421623/2A) and the body
                                    //        (0x00420522/29, 0x0042340C/13)
  // The two a replay used to rebuild behind a gate, both counted in their
  // `Init`: `CarriedZombieInit18` (`FUN_0045CD60`) is `EnemyZombieInit` with
  // a carrier, so it is class 0x30's two `INC`s exactly, and
  // `RescueTargetInit` (`FUN_00451720`) does both on its straight line.
  // `registry.ts`'s `ENEMY_CLASSES` has carried 0x18 since stage 3's riders
  // held its first room; this list is the script's and had not. Left out, a
  // reload past stage 3's `1/1/40` rebuilt the rider `0xADC` and held every
  // later gate, and the boat hostage `0x3208` -- whose rescue waits on
  // `g_enemies_present` -- sobbed in front of a captor already dead.
  SpawnClass.CarriedZombie,         // 0x18
  SpawnClass.RankScaledEnemy,       // 0x21 — and its own ways out, which come
                                    //        before any gate: see
                                    //        `ClassHandler.outlivedByReplay`
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
 * `g_scene_state_major_entered`'s `cam/` path row. `EvtOpGotoSceneState31`
 * leaves it for row 1, and that is when `CivilianUpdate`'s off-camera arm
 * (`0x0048B068 CMP [0x009C6F08], 2 / JZ`) can first take a civilian.
 */
const SCENE_MAJOR_PATH_CAMERA = 2;

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
  "block", "step", "opIndex", "region", "groundY", "backdropPreset",
  "backdropMode", "shutterState", "shutterPrev", "shutterCounter",
  "firingGate",
  "skippable", "skipRequested", "rain", "gunLights", "sceneLighting",
  "sceneAmbient",
  "branchChoice", "parked", "fogSet", "checkpointBlock", "branchPreview",
  "spawns", "simpleSpawns", "shot",
  "finished", "nextEntryBlock", "bgmTrack", "lastSound", "loopingSe",
  "seq",
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
  /**
   * The instruction cursor, and it is `g_evt_ip` -- 0x009C7108 -- as the port
   * encodes it, an index into the step's instructions. An accessor over `G`
   * for the reason {@link step} is: the VM is not its only writer.
   * `ItemSelectFinish` (`FUN_004895C0`) points it at step 1 while the script
   * is holding on the trunk's `wait_enemies_present`.
   */
  get opIndex(): number { return G.g_evt_ip; }
  set opIndex(v: number) { G.g_evt_ip = v; }

  region = -1;
  /** `g_cam_roll_enabled` (0x35), which is `G`'s. */
  get rollEnabled(): boolean { return G.g_cam_roll_enabled !== 0; }
  /** `g_camera_use_fixed_y` (0x36) and `g_camera_fixed_eye_y` (0x1A), `G`'s. */
  get useFixedEyeY(): boolean { return G.g_camera_use_fixed_y === 1; }
  get fixedEyeY(): number { return G.g_camera_fixed_eye_y; }
  /** `g_ground_plane_y` -- the same global as `fixedEyeY`, named for its
   *  other job: the height a missed downward ray falls back to. */
  groundY: number | null = null;
  /** 0x37: `g_force_rail_advance`, `G`'s. */
  get forcePathAdvance(): boolean { return G.g_force_rail_advance === 1; }
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
   * `g_nEvtSkippableRegion` (`DAT_009A2D7C`) -- set by `set_skippable_region`
   * (0x2C). Non-zero means the script has opened a region the player is
   * allowed to skip out of. An accessor over `G`, like {@link branchChoice}:
   * the engine has one global, and the skip watcher (class 0x63) reads it.
   */
  get skippable(): boolean { return G.g_nEvtSkippableRegion !== 0; }
  set skippable(v: boolean) { G.g_nEvtSkippableRegion = v ? 1 : 0; }
  /**
   * `g_nEvtSkipFlag` (`DAT_009A2D74`) -- the skip flag every wait opcode tests.
   * An accessor over `G`.
   *
   * The whole chain is live in the retail game, and it is the game's here:
   *
   * 1. `set_skippable_region(1)` opens the window ({@link skippable}).
   * 2. Both player-update routines (`FUN_00414940`, `FUN_00414B90`) poll Start
   *    while that is set and the firing gate is down and raise
   *    `g_nSkipRequested` -- {@link requestSkip}, the port's input seam.
   * 3. The skip watcher, class 0x63, which `spawn_simple` places at the top of
   *    most steps, sees the request in `CheckCutsceneSkipRequest`
   *    (`FUN_00435F40`): it ends the camera move where it stands and raises
   *    this flag and `g_cutscene_skipping` (`game/class63/`).
   * 4. With the flag up, `queue_event` drops its action, `0x0D`, `0x3A` and
   *    `0x3B` suppress, `0x2D` says nothing and a subtitle already on screen
   *    ends (`game/dialogue.ts`), and `0x40`, `0x41` and `0x42` pass straight
   *    through -- so the interpreter races to the end of the region.
   * 5. `set_skippable_region(0)` clears the flag again.
   *
   * The watcher is reached only through function pointers, so a plain xref
   * search on the flag finds only writers that store 0. An earlier revision
   * of this comment concluded from exactly that search that the feature was
   * "one assignment short of working". It is not: it ships working.
   */
  get skipRequested(): boolean { return G.g_nEvtSkipFlag !== 0; }
  set skipRequested(v: boolean) { G.g_nEvtSkipFlag = v ? 1 : 0; }
  /** evt 0x1D: rain. Only stage 1 ever turns it on. */
  rain = false;
  /**
   * evt 0x15: the two players' gun spotlights. Gated by 0x14.
   *
   * Accessors over `G`, like {@link branchChoice}: the engine has one global
   * for each (`g_entity_spotlights_on`, `g_scene_lighting`), the evt writes
   * it and the port's draw-path and light code read it — `CivilianInit`
   * among them, at spawn, which is why a per-frame copy would be too late.
   */
  get gunLights(): boolean { return G.g_entity_spotlights_on === 1; }
  set gunLights(v: boolean) { G.g_entity_spotlights_on = v ? 1 : 0; }
  /** evt 0x14: `g_scene_lighting`, the scene light array, which gates 0x15. */
  get sceneLighting(): boolean { return G.g_scene_lighting !== 0; }
  set sceneLighting(v: boolean) { G.g_scene_lighting = v ? 1 : 0; }
  /** evt 0x16: `g_light_array_ambient` r, g, b. */
  get sceneAmbient(): [number, number, number] {
    return [...G.g_light_array_ambient];
  }
  set sceneAmbient(v: [number, number, number]) {
    G.g_light_array_ambient = [v[0], v[1], v[2]];
  }
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
   * `[port-only]` -- true once the script has set one of light block 0's fog
   * channels (0..5). `render/fog.ts` draws no fog before, whatever the block
   * holds; the block itself -- fog, colour, ambient, direction -- is `G`'s
   * (`g_scene_light_block0`, `game/light_block.ts`).
   */
  fogSet = false;

  /** True while any channel of light block 0 is still animating. */
  get tweening(): boolean {
    return G.g_light_tween_block0.some((t) => t !== null);
  }
  /**
   * `g_scene_state_major` / `g_scene_state_minor` (0x009C6F0C / 0x009C6F14),
   * which are `G`'s: `EvtEnterSceneState` and its unstamped twin write them
   * from the queued actions, the checkpoint and `goto_scene_state`. See
   * `game/camera/hooks.ts`.
   */
  get sceneState(): { major: number; minor: number } {
    return { major: G.g_scene_state_major, minor: G.g_scene_state_minor };
  }

  /**
   * `g_queued_events_pending` -- 0x009A2C8C, `G`'s. What
   * `wait_queued_events_done` (`0x40`) blocks on: `queue_event` adds one per
   * action and each action handler takes one back when it completes --
   * except `EvtActionFinishSequence21`, whose driver `goto_scene_state` and
   * `set_action_drain_mode` retire. See `game/camera/actions.ts`.
   */
  get queuedEventsPending(): number { return G.g_queued_events_pending; }

  /**
   * How many block transitions found the action ring still owing work.
   *
   * The engine carries a residue across a block change (see
   * {@link goToBlock}), and the shipped scripts leave none when nothing is
   * skipped: every block ends on a wait that drains the ring. So this is the
   * one place the port's accounting can be checked against the script's own
   * structure rather than against itself, and on an unskipped run it should
   * be zero.
   */
  ringResidue = 0;

  /**
   * The arcade branch-preview shots, from the most recent `store_six`
   * (`queue_event` sel 0x60): one camera pose per route the next branch can
   * take, indexed by `branch_choice`. The panels' copy; the game's is
   * `G.g_evt_cam_override_pairs`.
   */
  branchPreview: NonNullable<OpJson["branch_preview"]> | null = null;

  /** `g_evt_cam_override_valid` — `0x009C6FD8`, `G`'s. */
  get camOverrideValid(): boolean { return G.g_evt_cam_override_valid !== 0; }
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
  /** The last `cam_play` queued, as the panels describe it. */
  shot: ShotMeta | null = null;

  /**
   * The shot the camera is on, **read out of `G`**: the path, the frame it
   * published, the range the action slot or the stashed rail is playing.
   * `[port-only]` -- a view for the panels, the harnesses and the seek; the
   * game reads the words. The description (file, start) is the last queued
   * `cam_play`'s when it names the same path.
   */
  get cam(): CamCommand | null {
    const slot = G.g_active_cam_path;
    if (slot < 0) return null;
    const hook = G.g_camera_update_hook as CameraUpdateHook;
    const deferred = hook === CameraUpdateHook.DeferredRailInstall
      || hook === CameraUpdateHook.StepRail
      || hook === CameraUpdateHook.PlayStashedPath;
    const m = this.shot && this.shot.slot === slot ? this.shot : null;
    const frame = G.g_cam_path_frame;
    const endFrame = deferred ? G.g_stashed_path_end_frame
      : G.g_evt_action_handler === EvtActionHandler.PathPlay
        ? G.g_cam_path_end_frame : m?.endFrame ?? frame;
    return {
      slot, frame, endFrame,
      startFrame: m?.startFrame ?? frame,
      flags: m?.flags ?? 0,
      isStatic: m?.isStatic ?? false,
      deferred,
      file: m?.file ?? null,
      pathIndex: m?.pathIndex ?? null,
      done: G.g_cam_path_frames_left <= 0,
      retired: G.g_evt_action_handler !== EvtActionHandler.PathPlay,
      pastEnd: hook === CameraUpdateHook.PlayStashedPath,
    };
  }
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

  /**
   * The listed civilians' progress through a replay, by spawn address -- see
   * `script/civilian_life.ts`. Filled only while {@link replaying}, and a
   * seek is one call, so it is not saved; {@link reset} clears it.
   */
  private civilianLives = new Map<number, CivilianLife>();
  /**
   * The route slot a replay left each block by, when the route was a
   * `branch` -- the `g_script_branch_var` it read. What
   * {@link retireOutlivedSpawns} hands a class as `armOut`. Filled only while
   * {@link replaying}; {@link reset} clears it.
   */
  private replayArms = new Map<number, number>();
  wait: PendingWait | null = null;
  branch: BranchChoice | null = null;
  finished = false;
  /**
   * The block the **next** stage opens at, once this one is over.
   *
   * `EvtAdvanceStepOrRoute` (`FUN_0045F000`), on the path where the route
   * table has walked onto a hole, at `0x0045F0DA`:
   *
   * ```c
   * g_evt_block_index =
   *     *(s16 *)(g_scene_routes[scene] + g_evt_block_index * 8 - 6);
   * ```
   *
   * `block * 8 - 6` is route record `block - 1` at `+0x02`, which is `next[0]`
   * of the record the walk just left. A `kind == 2` record ends a scene by
   * doing `block + 1` onto the hole that follows it, so **the terminal
   * record's `next[0]` is where the next scene starts** -- and nothing between
   * there and `FUN_0045EBC0` writes the block index again, so it survives the
   * whole load. **[proved]**
   *
   * Null until the scene is over. `app/` reads it to open the next stage; see
   * {@link ScriptJson.exits}, which is the same fact resolved ahead of time.
   *
   * The port does not model game mode 2, where the engine takes
   * `g_training_lesson` here instead: no stage script is entered in that mode.
   */
  nextEntryBlock: number | null = null;
  /**
   * The BGM id the script has left on channel `0xF`, or null once it has
   * stopped it -- the engine's `g_current_bgm_id` (`0x009C8FB8`), which
   * `PlaySoundId` writes on every track it opens and clears on
   * `0x80000000`.
   *
   * Written by **both** instructions that reach `PlaySoundId`: `se_play`
   * (`0x38`-`0x3B`), which is how five of the six stage scripts start their
   * own track, and `bgm_entry_play` (`0x5F`). It used to be written by `0x5F`
   * alone, so a seek past the `se_play` at block 0 step 2 had no music to put
   * back, and the player started each stage's track at load "by convention"
   * to cover for it.
   *
   * Script state for the reason {@link Walker.loopingSe} is: a seek replays
   * the instructions silently, and this is what `Bgm.syncTrack` puts back.
   */
  bgmTrack: number | null = null;
  /** The most recent `se_play` operand, for the HUD. */
  lastSound: number | null = null;
  /**
   * The looping sound effects the script has started and not stopped.
   *
   * **Script state, not audio state**, and it is here for the reason
   * {@link Walker.bgmTrack} is: a seek replays the instructions silently, so a
   * `se_play` of a looping id is skipped and the loop it should have started
   * is missing for the rest of the scene. The music survived that already
   * because the walker remembered the track; the loops did not, and what a
   * player heard was a stage with no rain, no wind and no machinery whenever
   * they arrived by a deep link rather than from the top.
   *
   * `PlaySoundId`'s stop ids are **stop-all** — `SoundStopAllLoopingSe`
   * (`0x004AC220`) walks the whole mixer list and takes no argument — so a
   * stop id empties this rather than removing one entry.
   */
  loopingSe: number[] = [];

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
    // whatever step the previous one stopped on -- and the instruction
    // cursor, `G.g_evt_ip`, for the same reason: a walker built after another
    // had stopped at instruction 29 opened at 29.
    this.step = 0;
    this.opIndex = 0;
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

  /**
   * Start the scene over, at `entryBlock`.
   *
   * **The entry block is an argument because in the engine it is an input.**
   * `FUN_0045EBC0` -- the scene task's setup, and the only thing that seeds
   * the program counter on a scene load -- reads `g_evt_block_index` as it
   * finds it. Four routines leave a value there for it: `ResetGameOnStart`
   * (`FUN_0045FEF0`) writes 0, or 0x10 in game mode 3; `RunAttractDemo`
   * (`FUN_00426800`) its playlist entry's; `RunPhaseStepToNextScene`
   * (`FUN_004603B0`) game mode 3's `{scene, block}` table; and
   * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) its scene-over path, which is the one that matters
   * here: it writes **the terminal route record's `next[0]`**, and that is how
   * one stage tells the next where to open.
   *
   * So a scene has no single start of its own. `script.entries` is the set the
   * stage before it can hand over, and `script.entry_block` is only the first
   * of them. Stage 3 and stage 4 each have two.
   */
  reset(entryBlock = this.script.entry_block): void {
    this.block = entryBlock;
    // FUN_0045EBC0 picks the first step by game mode: 1 for normal Arcade
    // play, 5 for Original Mode on scene 0, 0 only on the continue and
    // checkpoint paths. The exporter resolves that rule; the walker just
    // honours it -- by index, as `EvtGetStep` does. It used to fall back to
    // step 0 when the block had fewer steps than that, and since the bundle
    // stopped stage 1 block 0 at the `-1` in front of step 5, Original Mode
    // opened on the checkpoint stream and never met the trunk.
    this.step = this.script.entry_step ?? 1;
    this.opIndex = 0;
    this.region = -1;
    this.groundY = null;
    this.backdropPreset = -1;
    this.backdropMode = 0;
    this.shutter.reset();
    this.skippable = false;
    this.skipRequested = false;
    // The skip's other two words, which the scene's own reset does not touch
    // (`ResetSceneOnEnter` stores to none of the four): a seek arrives outside
    // any skip.
    G.g_nSkipRequested = 0;
    G.g_cutscene_skipping = 0;
    this.rain = false;
    this.gunLights = false;
    this.sceneLighting = false;
    this.sceneAmbient = [0.5, 0.5, 0.5];
    this.branchChoice = 0;
    this.parked = false;
    this.branchPreview = null;
    // The port's scene entry: `CameraBlocksReset`'s `LightBlockInit` of both
    // blocks, and the tween blocks `SceneLightTaskCreate` (`FUN_0040AE60`)
    // seeds with every slot off.
    this.fogSet = false;
    LightBlockInit(G.g_scene_light_block0);
    LightBlockInit(G.g_scene_light_block1);
    G.g_light_tween_block0 = makeLightTweens();
    G.g_light_tween_block1 = makeLightTweens();
    // `entryBlock` rather than `this.script.entry_block`: a stage no longer
    // chooses where it starts.
    this.checkpointBlock = entryBlock;
    // `ResetSceneOnEnter` (`FUN_0045EDD0`) zeroes all 0x100 bytes of
    // `g_script_flags` and nothing else in the image clears one. Starting the
    // script over is the port's scene entry, so it clears them here — which is
    // exactly the state `this.flags.clear()` used to clear on this line.
    G.g_script_flags = [];
    this.loadedSlots.clear();
    this.spawns = [];
    this.civilianLives.clear();
    this.replayArms.clear();
    this.simpleSpawns = [];
    this.shot = null;
    this.wait = null;
    this.branch = null;
    this.finished = false;
    this.nextEntryBlock = null;
    this.bgmTrack = null;
    this.lastSound = null;
    this.loopingSe = [];
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
      region: this.region, groundY: this.groundY,
      backdropPreset: this.backdropPreset, backdropMode: this.backdropMode,
      shutterState: this.shutterState, firingGate: this.firingGate,
      shutterPrev: this.shutterPrev, shutterCounter: this.shutterCounter,
      skippable: this.skippable,
      skipRequested: this.skipRequested, rain: this.rain,
      gunLights: this.gunLights, sceneLighting: this.sceneLighting,
      sceneAmbient: this.sceneAmbient,
      branchChoice: this.branchChoice, parked: this.parked,
      // The light blocks are not here: they are `G`'s, and the game slice of
      // the same snapshot carries them.
      fogSet: this.fogSet,
      checkpointBlock: this.checkpointBlock,
      branchPreview: this.branchPreview,
      spawns: this.spawns.map((s) => ({ ...s })),
      simpleSpawns: this.simpleSpawns.map((s) => ({ ...s })),
      shot: this.shot && { ...this.shot },
      // The wait, countdown and all. `web/test/state.test.ts` is what caught
      // this missing: a save taken three seconds into a five-second
      // `wait_frames` used to come back as a fresh five-second one, because
      // dropping it made the next tick re-execute the instruction that armed
      // it. The op is the script's own JSON, so it clones.
      wait: this.wait && { ...this.wait, policy: { ...this.wait.policy } },
      finished: this.finished, nextEntryBlock: this.nextEntryBlock,
      bgmTrack: this.bgmTrack,
      lastSound: this.lastSound, loopingSe: [...this.loopingSe],
      seq: this.seq,
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
    const cam = this.cam;
    if (cam) this.host.startCamera(cam);
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
    // A class that counts for some records and not others answers per
    // record: class 0x41's types 14, 19 and 25 are enemies standing still.
    const enemies = classes === ENEMY_GATE_CLASSES;
    this.spawns = this.spawns.filter((s) => {
      if (classes.has(s.class)) return false;
      if (!enemies) return true;
      if (!g_class_handlers[s.class as SpawnClass]?.countsForEnemyGate?.(s)) {
        return true;
      }
      // Its placer is already in the pool: a class-0x41 spawn enters it when
      // the instruction runs (`script/ops/spawn.ts`), and a replay runs no
      // frame to build the object. The gate is past, so what it counted is
      // gone -- the placer with it, before it can build and count again.
      // By its descriptor: a re-spawn's placer has a pool address of its own.
      const placed = s.at === undefined ? undefined
        : G.g_object_list.find((o) => o.descAt === s.at && !o.dead);
      if (placed) {
        placed.dead = true;
        placed.visible = false;
      }
      return false;
    });
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
    // **The trunk's gate is never passed.** Original Mode's stage 1 spawns
    // the trunk (class 0x6E) and waits on `wait_enemies_present 0`, which the
    // trunk holds with `g_enemies_present = 1` from its first frame; once both
    // players are done, `ItemSelectFinish` (`FUN_004895C0`) points the script
    // at step 1, instruction 0, and the gate, the step's `advance_step` and
    // the `-1` behind it are never run. A replay runs no frames for the trunk
    // to finish in, so stepping over its gate leaves the script where the
    // trunk does -- without this every seek in stage 1's opening ran off the
    // end of block 0. The trunk the replay spawned is closed too, with the
    // items last chosen (`ItemSelectPassedBySeek`): left in the pool it
    // opened over wherever the seek landed and, once its menu was done, sent
    // the script back to step 1.
    const trunk = this.simpleSpawns.findIndex(
      (s) => s.class === SpawnClass.ItemSelect);
    if (trunk >= 0 && this.wait.op.op === WAIT_ENEMIES_PRESENT_OP) {
      const obj = ActorByAt(this.simpleSpawns[trunk].at);
      if (obj && !obj.dead) ItemSelectPassedBySeek(obj);
      this.simpleSpawns.splice(trunk, 1);
      this.wait = null;
      this.step = ITEM_SELECT_RESUME_STEP;
      this.opIndex = 0;
      return;
    }
    // A yield is a wait whose condition already held on its first visit, and
    // stepping over it is the same claim as stepping over any other: the game
    // is past the instruction, with the world it leaves. So it takes the
    // rule's postcondition below like every other kind. It used to be one
    // camera frame and nothing more, which is a different world whenever the
    // host cannot answer the condition -- a replay's room gate with nobody to
    // count passes on its first visit, and one frame left the
    // `finish_sequence` queued in front of it in the ring for the
    // `goto_scene_state` behind it to take back, so its driver was installed
    // afterwards with no count and held the ring shut into the next block.
    const rule = WAIT_RULES.get(this.wait.op.op);
    const retires = rule?.retires;
    if (retires) this.retireGated(retires === "civilians"
      ? CIVILIAN_GATE_CLASSES : ENEMY_GATE_CLASSES);
    if (rule?.clearsRoom) this.civilianRoomsCleared();
    // The camera half of the postcondition. Every wait but `0x40` spends at
    // least the frame it yields on, so the camera actor has run past it.
    const policy = this.wait.policy;
    if (rule?.skipRunsCameraOn) this.runCameraOnPast(this.wait.op);
    else if (rule?.drainsQueuedActions) this.runQueuedActionsOut();
    else if (policy.kind === "frames") CameraReplayFor(policy.framesLeft);
    else CameraReplaySettle();
    // The third postcondition: a `wait_script_flag` is only ever passed in
    // play with the byte already a 1, so a replay that steps over one has to
    // raise it. Without this a seek lands past a gate whose flag is still 0,
    // and the classes that read the same array — 0x24's removal cue, 0x30's
    // states 20 and 31, 0x31's cue conditions, 0x52's despawn — see a world
    // the address does not describe.
    if (rule?.raisesScriptFlag) {
      const flag = this.wait.op.arg ?? 0;
      G.g_script_flags[flag] = 1;
      this.retireFlagRaisers(flag);
    }
    this.wait = null;
    this.opIndex++;
    // The camera has run on and a flag may be up: both are ways out a class
    // tests for itself.
    this.retireOutlivedSpawns();
  }

  /**
   * Retire every listed spawn whose class says the replay has gone past its
   * own way out -- {@link ClassHandler.outlivedByReplay}. Replay only, for the
   * reason {@link retireGated} is: in play the object leaves through its own
   * states, and its marker is what `render/characters.ts` keeps as `spent`.
   *
   * Asked after every instruction the replay runs, every wait it steps over
   * and every block it enters, so a way out is seen the moment the replay
   * makes it true -- the flag the instruction raised, the camera frame the
   * wait ran to, the route the block change read -- and never before the
   * spawn exists to be retired.
   */
  private retireOutlivedSpawns(): void {
    if (!this.replaying) return;
    this.followReplayCamera();
    this.spawns = this.spawns.filter((s) => {
      const outlived = g_class_handlers[s.class as SpawnClass]?.outlivedByReplay;
      return !outlived?.({ ...s, armOut: this.replayArms.get(s.block) });
    });
  }

  /**
   * Show the camera the replay has carried to every listed spawn whose class
   * follows it -- {@link ClassHandler.followReplayCamera}. Replay only; called
   * at the head of {@link retireOutlivedSpawns}, so at every instruction, wait
   * and block change the replay makes.
   */
  private followReplayCamera(): void {
    const cam = this.cam;
    if (!cam) return;
    for (const s of this.spawns) {
      const follow = g_class_handlers[s.class as SpawnClass]
        ?.followReplayCamera;
      if (!follow) continue;
      follow({ ...s, armOut: this.replayArms.get(s.block) },
             { slot: cam.slot, startFrame: cam.startFrame, frame: cam.frame },
             s.replay ??= {});
    }
  }

  /**
   * A `wait_script_flag`'s postcondition, applied to **who raises the flag**.
   *
   * Raising the byte is half of it. In play the byte comes up because a
   * civilian's stream reached op 0x1C (`CivilianRunScript`, `FUN_0048B9E0`),
   * so past the gate she has already run everything in front of that command
   * — and in every shipped stream that includes the rescue block, whose
   * `SetRouteBranch` writes `g_script_branch_var`. A replay that raised the
   * byte and left her spawn marker standing rebuilt her at the landing address
   * with a fresh script: stage 4's block-4 hostage `0x3578` came back at
   * block 12, her captor saw flag 29 already up and died on the first frame,
   * and her stream ran `SetRouteBranch 1` in block 12's last step — so a deep
   * link to that block took `next[1]` whatever the player did there. The
   * engine cannot be in that state: her write was made, and cleared, eleven
   * blocks earlier.
   *
   * So a class-0x10 spawn whose streams raise the flag being stepped over is
   * retired with the gate, the way {@link retireGated} retires the enemies an
   * enemy gate counts. Replay only, for the same reason.
   */
  private retireFlagRaisers(flag: number): void {
    if (!this.replaying) return;
    const civ = this.script.civilians;
    this.spawns = this.spawns.filter((s) => s.class !== SpawnClass.Civilian
      || !CivilianRaisesScriptFlag(civ, s.at, flag));
  }

  /**
   * The rest of a civilian's life, for a replay: the room she was held in has
   * been played, so her captors are dead and her rescue is behind her. Every
   * civilian listed now is marked; the removal arms below read the mark.
   * `script/civilian_life.ts` has the exe's arms and why each is here.
   */
  private civilianRoomsCleared(): void {
    if (!this.replaying) return;
    for (const s of this.spawns) {
      if (s.class !== SpawnClass.Civilian) continue;
      this.civilianLifeOf(s.at).roomCleared = true;
    }
    this.retireCiviliansOnCue();
  }

  /**
   * The cue arm's evidence: the camera the replay runs has played a listed
   * civilian's removal path past its frame. `CivilianUpdate`'s test is
   * `g_active_cam_path == sub+0x26 && g_cam_path_frame == sub+0x28`, and the
   * replay jumps frames where play steps them, so "at or past" is the frame
   * play would have passed through.
   */
  private civilianCuesSeen(): void {
    if (!this.replaying) return;
    const cam = this.cam;
    if (!cam) return;
    const civ = this.script.civilians;
    for (const s of this.spawns) {
      if (s.class !== SpawnClass.Civilian) continue;
      const cue = CivilianRemoveCue(civ, s.at);
      if (cue && cue.path === cam.slot && cam.frame >= cue.frame) {
        this.civilianLifeOf(s.at).cueSeen = true;
      }
    }
    this.retireCiviliansOnCue();
  }

  /**
   * The cue arm: `sub+0x2A` counts `tail+0x06` frames from the cue and the
   * despawn waits for `sub+0x1E`, the child count, to be zero -- restarting
   * the count at 1 while it is not (`0x0048AFCA`). So cue seen and captors
   * dead, in either order, is gone.
   */
  private retireCiviliansOnCue(): void {
    const civ = this.script.civilians;
    this.spawns = this.spawns.filter((s) => {
      if (s.class !== SpawnClass.Civilian) return true;
      const life = this.civilianLives.get(s.at);
      if (!life?.cueSeen) return true;
      return !(life.roomCleared || !CivilianHasChildren(civ, s.at));
    });
  }

  /**
   * The off-camera arm: `g_scene_state_major_entered` has just left 2, which
   * is the one condition of that arm a replay can see. A civilian whose room
   * has been played and every one of whose streams ends on a `0x2000000` word
   * is retired here. `[likely]` -- see `script/civilian_life.ts`.
   */
  private retireCiviliansOffCamera(): void {
    if (!this.replaying) return;
    const civ = this.script.civilians;
    this.spawns = this.spawns.filter((s) => {
      if (s.class !== SpawnClass.Civilian) return true;
      if (!this.civilianLives.get(s.at)?.roomCleared) return true;
      return !CivilianEndsRemovable(civ, s.at);
    });
  }

  private civilianLifeOf(at: number): CivilianLife {
    let life = this.civilianLives.get(at);
    if (!life) {
      life = { roomCleared: false, cueSeen: false };
      this.civilianLives.set(at, life);
    }
    return life;
  }

  /**
   * The camera half of a wait's postcondition — see
   * {@link WaitRule.skipRunsCameraOn}.
   *
   * Put the shot where the script would have been standing when the wait it
   * is stepping over opened: at the end for the operand-0 form, which is
   * `g_cam_path_frames_left < 1`, and one frame past the operand otherwise,
   * which is the strict `operand < g_cam_path_frame` of
   * `EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`). The camera's own tasks do
   * it -- `CameraReplayUntil` runs them with the cursor carried forward -- so
   * the landing is the state those routines leave, rail and all.
   *
   * The frames in between are **not** published, and cannot be: a seek jumps
   * where playback steps, so nothing that reads `g_cam_path_frame` once a
   * frame — a class-0x30 camera cue, a civilian's `CameraCue` wait — sees
   * them. What this buys is the landing state, not the trip.
   */
  private runCameraOnPast(op: OpJson): void {
    const arg = op.arg ?? 0;
    // At least the frame the wait yields on: whatever was pushed in front of
    // it has been dequeued before the condition is ever read.
    CameraReplayUntil(arg === 0
      ? () => G.g_cam_path_frames_left < 1
      : () => G.g_cam_path_frame > arg, arg === 0 ? null : arg + 1, 1);
    this.civilianCuesSeen();
  }

  /**
   * `wait_queued_events_done`'s postcondition: the ring has run dry. The
   * camera's tasks run until it has, a playing shot carried to its end --
   * see {@link WaitRule.drainsQueuedActions}.
   */
  private runQueuedActionsOut(): void {
    CameraReplayUntil(() => G.g_queued_events_pending === 0, null);
    this.civilianCuesSeen();
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
    // A shutter close still sliding is not settled here any more: the slide
    // is the game's task (`game/hud_shutter.ts`), and step mode runs the game
    // underneath, so it finishes on its own frames as the engine's does.
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
   * **This is the interpreter's task and nothing else.** The engine's scene
   * runs `EvtInterpreterLoop` first and the camera actor third (the task
   * list at `0x00460710`; `ActorAlloc` appends and `TaskRunTree` walks from
   * the head), and `queue_event` only *pushes* onto the action ring: the
   * actions run in `CameraActorTick`'s `EvtRunQueuedActions`, which is
   * `game/`'s and runs at the head of `GameUpdate`. So an instruction that
   * waits on the camera reads what the camera published on the frame before,
   * and a shot queued this frame is on screen this frame. A walker-only
   * harness has no camera and has to run `CameraActorTick` and
   * `CameraUpdateTick` itself after this.
   */
  tick(dt: number, fps = 60): void {
    if (this.finished || this.branch || this.parked) return;
    this.runInstructions(dt, fps);
  }

  /**
   * `[port-only]` -- put the camera at `frame` of the shot it is on, for a
   * seek or a restored URL: the playing shot's cursor, or the
   * stashed rail's, and the published frame. The block is reseated from the
   * words by `CameraReseatFromFrame`, which the caller runs.
   */
  setCameraFrame(frame: number): void {
    const f = Math.trunc(frame);
    const cam = this.cam;
    if (!cam) return;
    if (cam.deferred) {
      G.g_stashed_path_frame = f;
      G.g_rail_frame = f;
    } else if (G.g_evt_action_handler === EvtActionHandler.PathPlay) {
      G.g_cam_path_cursor = f;
    }
    G.g_cam_path_frame = f;
    G.g_cam_path_frames_left = cam.endFrame - f;
  }

  /** `EvtInterpreterLoop`'s share of one frame. See {@link tick}. */
  private runInstructions(dt: number, fps: number): void {
    let frames = dt * fps;
    // `EvtInterpreterLoop`'s first act, before any instruction: whether the
    // script may pass a wait this frame. Asked once and kept, as the engine
    // keeps it in a global -- the condition of a wait that short-circuits
    // before this term must not leave last frame's answer standing.
    this.gameplayLiveNow = (this.host.gameplayLive?.() ?? null) !== false;

    // No light step: `PushSceneLightStateToDevice` is the scene list's second
    // task, after this one, and runs in `SceneTaskWalk` -- see
    // `game/light_sets.ts`.

    // No shutter step: `HudDrawShutterState` is a task of the scene's own and
    // runs in `SceneTaskWalk`, after the players -- see `game/hud_shutter.ts`.
    // No caption step either: the subtitle is a task of the scene's, in
    // `game/dialogue.ts`.

    // A wait in this VM is only the instruction at `g_evt_ip`, run again
    // every frame until it passes. If gameplay has moved the cursor since
    // -- the trunk's `ItemSelectFinish` sends it to step 1 while the script
    // waits on `g_enemies_present` -- the instruction that was waiting is not
    // the one the interpreter runs next, and there is no wait to pass. The
    // test is on the address the wait was entered at, not on the op found
    // there now: it compared the op once, and a gate a test hands the walker
    // directly (`applyWait`) was thrown away on its first frame.
    if (this.wait) {
      const [b, st, ip] = this.wait.addr;
      if (b !== this.block || st !== this.step || ip !== this.opIndex) {
        this.wait = null;
      }
    }
    // A skippable wait opcode re-runs its skip test every frame, ahead of its
    // own condition -- `0x40` and `0x41` open with `if (skip == 0)`, `0x42`
    // with `if (skip != 0)` -- so a wait already pending goes on the first
    // frame the flag is up, which is the frame after the skip watcher
    // (`game/class63/`) raised it.
    if (this.wait && this.skipRequested
        && WAIT_RULES.get(this.wait.op.op)?.skippable) {
      this.wait = null;
      this.opIndex++;
    }
    if (this.wait) {
      const w = this.wait.policy;
      if (w.kind === "frames") {
        const used = Math.min(frames, w.framesLeft);
        w.framesLeft -= used;
        frames -= used;
        if (w.framesLeft > 0) return;
        // Both clocks, `0x41` and `0x42`, pass only while the gameplay gate
        // is open. `EvtOpWaitFrames42` (`FUN_0045FB30`) keeps counting down
        // while it is shut and holds at -1; `EvtOpWaitCameraPathFrame41`
        // (`FUN_0045FAC0`) tests nothing while it is shut and the camera,
        // which is not the script's, runs on. Either way the wait goes on the
        // first frame the gate opens.
        if (!this.gameplayLive()) return;
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
   * Press Start: `g_nSkipRequested = 1`, where the player-update routines
   * (`FUN_00414940`, `FUN_00414B90`) raise it, under the same condition
   * ({@link canSkip}). The skip itself is the watcher's, on this frame's walk
   * -- see {@link skipRequested}. Returns false when the game would not have
   * offered one.
   */
  requestSkip(): boolean {
    if (!this.canSkip) return false;
    G.g_nSkipRequested = 1;
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

  /**
   * `g_evt_gameplay_live`, the term every wait opcode tests, as the top of
   * this frame's `runInstructions` found it. A host that cannot evaluate it
   * reports `null` and the term drops out, as `cameraFree`'s does. Public
   * because the wait rules test it.
   */
  gameplayLive(): boolean {
    return this.gameplayLiveNow;
  }

  /**
   * `[port-only]` as a field: the engine keeps the answer in
   * `g_evt_gameplay_live` (`0x007DCCA4`), recomputed before the frame's first
   * instruction, and the host's `gameplayLive` writes it there. Not in a
   * snapshot, because nothing reads it before the next frame computes it
   * again; true until then, so a seek's replay -- which observes no waits --
   * is not held by a gate it never asked about.
   */
  private gameplayLiveNow = true;

  private waitSatisfied(): boolean {
    const w = this.wait;
    if (!w) return true;
    // The yield is spent; the next visit passes.
    if (w.policy.kind === "yield") return true;
    const rule = WAIT_RULES.get(w.op.op);
    return rule?.satisfied?.(w.policy, w.op, this.waitContext) ?? true;
  }

  /**
   * What a wait rule may ask of the machine, and nothing more.
   *
   * The walker *is* one of these — `WaitContext` is a structural view of the
   * members a rule may touch, so this costs nothing and the interface is
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
    this.retireOutlivedSpawns();
    // An instruction that returned without moving the program counter and
    // with the yield latch up runs again next frame (see `holdHere`). It has
    // not happened yet, so the feed does not show it.
    if (this.held) {
      this.held = false;
      return false;
    }
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

  /**
   * `EvtOpSetLight0Direction18` (`FUN_0045F240`) and
   * `EvtOpSetLight1Direction19` (`FUN_0045F270`):
   * `LightBlockSetDirection(block, operand 1, operand 2)`. `0x17`,
   * `EvtOpSlerpLight0Direction17` (`FUN_0045F2A0`), allocates a task that
   * swings block 0's angles there over the operand's frames; the port takes
   * the target at once. The exporter hands the BAMS words over as degrees,
   * `word * 360 / 65536`, which the product below undoes exactly.
   */
  static setLightDir(_w: Walker, op: OpJson): string | undefined {
    const b = op.op === 0x19 ? G.g_scene_light_block1 : G.g_scene_light_block0;
    if (op.pitch_deg !== undefined) {
      LightBlockSetDirection(b, Walker.degBams(op.pitch_deg),
                             op.yaw_deg == null ? b.yaw
                               : Walker.degBams(op.yaw_deg));
    }
    return op.op === 0x17 ? "slerp target taken immediately" : undefined;
  }

  /** `[port-only]` The exporter's degrees back to the BAMS word. */
  private static degBams(deg: number): number {
    return Math.round(deg * 65536 / 360);
  }

  static playSe(w: Walker, op: OpJson, quiet: boolean): string | undefined {
    w.lastSound = op.sound ?? null;
    Walker.trackLoopingSe(w, op.sound ?? 0);
    Walker.trackBgm(w, op.sound ?? 0);
    return quiet || !op.sound ? undefined : w.host.playSound(op.sound);
  }

  /**
   * Keep {@link Walker.bgmTrack} in step with what one `PlaySoundId` does to
   * channel `0xF` -- **whether or not the sound is played**, as
   * {@link trackLoopingSe} does for the loops.
   *
   * `PlaySoundId` (`FUN_0041CFD0`): a namespace-1 id whose table entry is a
   * name opens that track and becomes `g_current_bgm_id`; one whose entry is
   * null breaks out and changes nothing. A namespace-8 id reaches
   * `PlaySoundControl` (`FUN_0041D3E0`), where `0x80000001` is the SE and
   * `0x80000002` the voice and **every other value stops the music**. Only
   * `0x80000000` also zeroes `g_current_bgm_id`; this clears on all of them,
   * because what a seek needs is what is sounding, and the two differ only
   * for control words no shipped script uses.
   */
  static trackBgm(w: Walker, id: number): void {
    const ns = id >>> 28;
    if (ns === 8) {
      if (id !== 0x80000001 && id !== 0x80000002) w.bgmTrack = null;
      return;
    }
    if (ns !== 1) return;
    const idx = id & 0xfff;
    const names = w.script.bgm?.names;
    if (names && !(names.ar[idx] ?? null) && !(names.plain[idx] ?? null)) return;
    w.bgmTrack = id >>> 0;
  }

  /**
   * Keep {@link Walker.loopingSe} in step with what this `se_play` does to the
   * mixer — **whether or not the sound is played**.
   *
   * `PlaySoundId` (`FUN_0041CFD0`) walks `g_looping_se_ids` (`0x005887FC`) and
   * `g_looping_se_stop_ids` (`0x005888B0`) in step and breaks on the first
   * match: an id in the first plays looped, an id in the second calls
   * `SoundStopAllLoopingSe` and stops every loop in the mix. That walk is here
   * as well as in `audio/bgm.ts` because the two answer different questions —
   * the audio layer asks what to do with this id now, and this asks what the
   * script has left sounding, which is the thing a seek has to reconstitute.
   */
  static trackLoopingSe(w: Walker, id: number): void {
    if (!id) return;
    // `PlaySoundId(0x80000001)` releases every SE channel, the loops with
    // them: `PlaySoundControl` (`FUN_0041D3E0`) → `SoundCommand(n, 0x1100A0)`
    // (`FUN_004ABF80`).
    if (id === 0x80000001) {
      w.loopingSe = [];
      return;
    }
    for (const pair of w.script.sound?.looping ?? []) {
      if (pair.play === id) {
        if (!w.loopingSe.includes(id)) w.loopingSe.push(id);
        return;
      }
      if (pair.stop === id) {
        w.loopingSe = [];
        return;
      }
    }
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
    const one = op.light_block === 1;
    const r = ApplyLightChannelOp(
      one ? G.g_scene_light_block1 : G.g_scene_light_block0,
      one ? G.g_light_tween_block1 : G.g_light_tween_block0, op);
    if (r.touched && !one && (op.channel ?? 99) <= 5) this.fogSet = true;
    return r.note;
  }

  /**
   * `goto_scene_state` (0x31) and its players-alive twin (0x32): the camera
   * handed back and the `finish_sequence` driver retired, which is `game/`'s
   * (`EvtGotoSceneState`), and a replay's civilians -- leaving scene state 2
   * is the one condition of `CivilianUpdate`'s off-camera arm a replay can
   * see. See `script/civilian_life.ts`.
   */
  gotoSceneState(minor: number, clearsLatches: boolean): void {
    EvtGotoSceneState(minor, clearsLatches);
    if (G.g_scene_state_major !== SCENE_MAJOR_PATH_CAMERA) {
      this.retireCiviliansOffCamera();
    }
  }

  /**
   * The instruction being run returns without moving the program counter, and
   * the interpreter's frame ends: `g_evt_yield` up and no `pc +=`. It runs
   * again from the top on the next frame, as `EvtInterpreterLoop` re-enters
   * the instruction the pointer still names. Only `0x32`'s gate uses it; the
   * waits keep their state in {@link wait} because the panels show it.
   */
  holdHere(): void {
    this.held = true;
  }
  private held = false;

  /** `set_action_drain_mode` (0x33): `advance = mode; pending += delta`. */
  setActionDrainMode(mode: number, delta: number): void {
    EvtOpSetActionDrainMode33(mode, delta);
  }

  /**
   * `queue_event` (0x30): push one action onto the ring.
   *
   * `EvtOpQueueEvent30` (`FUN_0045F7F0`) runs nothing: it records the
   * instruction, adds one to `g_queued_events_pending` and moves on. The
   * action runs when `EvtRunQueuedActions` reaches it, inside
   * `CameraActorTick` -- this frame if the slot is free, later if a shot or
   * a driver still holds it. See `game/camera/actions.ts`.
   *
   * What is kept here is the panels' description: the shot a `cam_play`
   * names and the branch previews a `store_six` carries.
   */
  applyQueueEvent(op: OpJson): string | undefined {
    const sel = op.sel ?? 0;
    const args = (op.args ?? []).map((v) => v | 0);
    EvtQueueAction(sel, args);
    if (op.action === "cam_play") {
      const start = op.start ?? 0;
      const end = op.end ?? 0;
      const flags = op.flags ?? 0;
      const deferred = start !== end && (flags & 2) !== 0;
      this.shot = {
        slot: op.slot ?? -1,
        // `-1` resumes from the frame the camera is on -- plus one for a
        // stash (`CamStashPathRange`), as it is for a play
        // (`CamStartPathPlayback`). Read here, at the push, which is the
        // frame the action runs on whenever the ring is idle.
        startFrame: start !== -1 ? start
          : G.g_cam_path_frame + (deferred ? 1 : 0),
        endFrame: end,
        flags,
        isStatic: start === end,
        deferred,
        file: op.cam?.file ?? null,
        pathIndex: op.cam?.path ?? null,
      };
      this.host.startCamera({
        ...this.shot, frame: start, done: false, retired: false,
        pastEnd: false,
      });
      return this.shot.deferred
        ? `stashes ${start}..${end} for scene state 6/7`
        : this.shot.isStatic ? "static pose" : undefined;
    }
    if (op.action === "store_six" && op.branch_preview) {
      this.branchPreview = op.branch_preview;
      return `${op.branch_preview.length} branch preview shots`;
    }
    if (op.action === "finish_sequence") {
      return op.camera_state ? `camera state ${op.camera_state}` : undefined;
    }
    return undefined;
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
    if (policy.kind === "passed" || policy.kind === "yield") {
      // **A replay that walks past a gate has to leave the gate's world
      // behind it.** `wait_enemies_alive 0` is only reached in play once the
      // enemies are dead, so a seek that steps over it and keeps their spawns
      // arrives in a state the game cannot be in: the previous scene's actors
      // standing in the next scene's block, counted alive, holding the very
      // gate the script is about to reach open. The wait's own postcondition
      // is the answer -- retire exactly what it counts.
      if (rule?.retires) this.retireGated(rule.retires === "civilians"
        ? CIVILIAN_GATE_CLASSES : ENEMY_GATE_CLASSES);
      if (rule?.clearsRoom) this.civilianRoomsCleared();
      // Not `raisesScriptFlag` here: `0x45` only reaches this arm with the
      // flag *already* raised, so there is nothing to reproduce. The
      // postcondition belongs to `stepOverWait`, which is the path that walks
      // past a gate whose condition is false.
      if (policy.kind === "passed") return `${blocksOn} -- ${policy.why}`;
      // ...and a yield still costs the frame it is reached on.
      this.wait = { op, blocksOn, policy,
                  addr: [this.block, this.step, this.opIndex] };
      return `${blocksOn} -- ${policy.why}`;
    }
    this.wait = { op, blocksOn, policy,
                  addr: [this.block, this.step, this.opIndex] };
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
    // `EvtGetStep(...) == -1` is "the steps ran out": the end of the list, or
    // a `-1` the bundle carries because a later step is entered by index
    // (`StepJson.end`) -- stage 1 block 0's step 4, in front of Original
    // Mode's step 5.
    if (blk?.steps && this.step < blk.steps.length
        && !blk.steps[this.step].end) {
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

    if (route.kind === "branch" && !quiet && this.options.branchPause) {
      const targets = route.next.filter((n) => n >= 0);
      if (targets.length > 1) {
        // `[port-only]` debug aid, and off by default -- see
        // `WalkerOptions.branchPause`. The engine reads `g_script_branch_var`
        // here and goes, which is the fall-through below. With the aid on
        // this holds for `branchCountdown` seconds so a viewer can take the
        // other route, and takes the engine's answer if nobody does. The value
        // is latched now, for the reason on `BranchChoice.choice`.
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

    return this.leaveBlock(route.kind, next);
  }

  /**
   * The block change both route paths end in, and what a replay learns from
   * it: which slot of a `branch` the route read. `[port-only]` bookkeeping --
   * the engine's route read is {@link advanceStepOrRoute}'s and nothing
   * remembers it -- kept because a class whose way out *is* that write asks
   * for it ({@link ClassHandler.outlivedByReplay}).
   */
  private leaveBlock(kind: string, next: number): boolean {
    if (this.replaying && kind === "branch") {
      this.replayArms.set(this.block, this.branchChoice);
    }
    const entered = this.goToBlock(next);
    this.retireOutlivedSpawns();
    return entered;
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
      // `MarkSceneOver` (`FUN_0045ED90`) zeroes `g_accuracy_stats_suppressed`
      // (`0x0045EDA1`) as it ends the scene; its run-phase hand-over and its
      // `SoundStopAll` are the app's stage step (`Player.advanceScene`).
      G.g_accuracy_stats_suppressed = 0;
      // The scene-over path's *other* half, and the one that outlives the
      // scene: `MarkSceneOver` (`FUN_0045ED90`) hands the run phase over, and
      // then `EvtAdvanceStepOrRoute` reads the block the next stage opens at
      // out of the record the walk just left. See {@link nextEntryBlock}.
      //
      // Only for a real hole. A route slot of -1 is not one: the engine would
      // index its block table at -1, which no shipped script does -- every
      // branch write names a live slot, which is what `web/tools/checks/branches.ts`
      // asserts -- so the port stops rather than inventing an answer.
      this.nextEntryBlock = index > 0
        ? this.script.routes[index - 1]?.next[0] ?? null
        : null;
      this.branch = null;
      this.host.onBranch(null);
      return false;
    }
    // **The ring is not touched here.** `EvtAdvanceStepOrRoute`
    // (`FUN_0045F000`) moves the block index and the program pointer and
    // nothing else; `EvtLoadBlockProgram` (`FUN_0045EBC0`), which does zero
    // `g_queued_events_pending` and empty the ring, has two callers, and both
    // are task-list builders (`0x00460710`, `0x0041FAB0`) -- a scene's start,
    // not a block's. `[proved]` So an action still running when a block ends
    // -- a `cam_play` a skip cut short, which retires on its next call --
    // keeps its count into the next block and retires it there. Zeroing the
    // count here took that count back twice: the retire landed on the new
    // block's first `cam_play`, the ring read -1 once that one retired, and
    // stage 6 block 1 step 5's `wait_queued_events_done` held for ever.
    if (this.queuedEventsPending !== 0) this.ringResidue += 1;
    // **The spawn markers do not clear here, and they used to.**
    //
    // `FUN_0045EBC0` is the whole of the engine's block change: it picks the
    // first step by game mode, zeroes `g_script_branch_var`, loads the block's
    // program, clears `g_queued_events_pending` and the two skip words, and
    // calls `FUN_00408D60`, which writes three approach constants. **It
    // touches no object.** An actor built by `SpawnFromDescriptor`
    // (`FUN_00408A20`) leaves through its own state machine and through
    // nothing else. `[proved]`
    //
    // Clearing them retired every live actor on the frame a block changed,
    // because `syncCharacterSpawns` hands `app/` everything the walker has
    // stopped listing. Stage 3's civilian `3008` is the proof that the engine
    // cannot be doing that: `spawn_obj_c` places her in **block 0** step 6,
    // her script's camera cue is `(130, 145)` and her removal cue `(130, 165)`,
    // and camera slot 130 is played only in **blocks 3 and 4**. A civilian
    // retired at the boundary can meet neither, so her stream never reaches
    // the `SetHudShutterState 1` that gives the player the gun back for block
    // 3's four rooms.
    //
    // What still removes an actor: its own class — `ActorDespawn`,
    // `CivilianLeaveField`, `ZombieRetireAndCredit` — and `Walker.reset`,
    // which is the rebuild path a seek and a stage load take. `spent` in
    // `render/characters.ts` is what stops a self-despawned actor being built
    // again while its marker stands, and it says the same thing this comment
    // does.
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
    this.leaveBlock(route?.kind ?? "branch", next);
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
