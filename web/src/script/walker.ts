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

import { Rng } from "../core/rng";
import { G } from "../game/globals";
import type { BlockJson, OpJson, ScriptJson, SpawnJson } from "../bundle";
import type { OpStatus } from "./opstatus";
import { OPS as OPS_TABLE } from "./ops";


export interface ActiveSpawn extends SpawnJson {
  /** Where it came from, so the marker can be traced back to an instruction. */
  block: number;
  step: number;
  opIndex: number;
  opcode: number;
  /** Counts down while combat is simulated; null when it is not. */
  secondsLeft: number | null;
}

/**
 * The scene fog, from the light block that evt opcodes `0x20`-`0x27` drive.
 *
 * Channels 0 and 1 are near and far (floats, reached through a pointer to a
 * constant in the evt file); 2/3/4 are the colour components as 0-255 ints,
 * and channel 5 sets all three at once. It is a linear D3D fog model, which
 * is the same model three.js `Fog` implements.
 */
export interface FogState {
  near: number;
  far: number;
  /** 0-255 per component, as stored. */
  rgb: [number, number, number];
}

/**
 * One channel of the scene light block, mid-tween.
 *
 * The game's block is `{enabled, from, to, rate}` per channel, and **both**
 * tween opcodes end up in that shape: `0x21` takes the per-frame `rate`
 * straight from an operand, and `0x23` takes a frame count and pre-divides,
 * `rate = |to - from| / frames`. So one stepper serves both.
 */
export interface ChannelTween {
  to: number;
  /** Per-frame step magnitude, always positive. */
  rate: number;
}

/** Light-block channel indices, as the tween handlers number them. */
export const CH_FOG_NEAR = 0;
export const CH_FOG_FAR = 1;
export const CH_FOG_R = 2;
export const CH_LIGHT_R = 6;
export const CH_AMBIENT = 10;
export const CHANNEL_COUNT = 11;

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
}

export type WaitPolicy =
  | { kind: "frames"; framesLeft: number }
  | { kind: "camera" }
  | { kind: "combat"; secondsLeft: number }
  /** The real gate: blocks until the player has killed them. */
  | { kind: "enemies" }
  | { kind: "passed"; why: string };

export interface PendingWait {
  op: OpJson;
  blocksOn: string;
  policy: WaitPolicy;
}

export interface BranchChoice {
  block: number;
  targets: number[];
  /** Seconds left on the arcade countdown before the RNG picks. */
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
  /** Seconds of simulated combat per live spawn. 0 resolves instantly. */
  secondsPerEnemy: number;
  /** Simulate the enemy-count waits at all, or pass straight through them. */
  simulateCombat: boolean;
  /**
   * Seconds a branch point waits before the seeded RNG picks. Hovering the
   * branch bar freezes it, so this is the unattended pace, not a deadline.
   */
  branchCountdown: number;
  /** Clear spawn markers when the block changes. */
  clearSpawnsOnBlock: boolean;
  seed: number;
}

export const DEFAULT_OPTIONS: WalkerOptions = {
  secondsPerEnemy: 1,
  simulateCombat: true,
  branchCountdown: 1.5,
  clearSpawnsOnBlock: true,
  seed: 1,
};

export interface WalkerHost {
  enterRegion(r: number): void;
  loadRegion(r: number): void;
  loadSlot(slot: number): void;
  unloadSlot(slot: number): void;
  startCamera(cmd: CamCommand): void;
  releaseCamera(): void;
  onFeed(entry: FeedEntry): void;
  onBranch(choice: BranchChoice | null): void;
  /** Any sound id, dispatched by namespace as `PlaySoundId` does. */
  playSound(id: number): string | undefined;
  /**
   * Live enemies the player can still shoot, or `null` when shooting is off.
   *
   * `wait_enemies_present` / `wait_enemies_alive` are the game's combat gate:
   * they block until `g_enemies_present` / `g_enemies_alive` fall to the
   * operand, and those counters only move because the player kills things.
   * With shooting enabled that is a real condition again, so the walker waits
   * on it instead of on a stopwatch.
   */
  aliveEnemies(): number | null;
  /** evt `0x1F`: the HUD shutter state. */
  setShutter(state: number): string | undefined;
  /** evt `0x2D`: play a dialogue group -- voice line plus subtitles. */
  showMessage(group: number): string | undefined;
  /** Cut a dialogue short, as raising the skip flag does. */
  endDialogue(): void;
}

/** Fog off (a range past the 8000 far plane) and a neutral white light. */
function defaultChannels(): number[] {
  const c = new Array(CHANNEL_COUNT).fill(0);
  c[CH_FOG_NEAR] = 65000;
  c[CH_FOG_FAR] = 65001;
  c[CH_LIGHT_R] = c[CH_LIGHT_R + 1] = c[CH_LIGHT_R + 2] = 1;
  c[CH_AMBIENT] = 0.5;
  return c;
}

/**
 * The waits that test the skip flag: `wait_queued_events_done` (0x40),
 * `wait_camera_path_frame` (0x41) and `wait_frames` (0x42). The enemy-count
 * and flag waits above 0x42 do not test it.
 */
const SKIPPABLE_WAITS = new Set([0x40, 0x41, 0x42]);

/** How far a wait opcode can be honoured from the bundle alone. */
const WAIT_NOTES: Record<number, string> = {
  0x40: "approximated: resolves when the current camera move ends",
  0x43: "the live-enemy gate: real while Shoot is on, otherwise paced by the "
      + "combat setting",
  0x44: "the second enemy counter, gated with 0x43",
  0x45: "passed: the script flag array is written by gameplay",
  0x46: "passed: the scripted-actor counter is a runtime value",
  0x47: "passed: 'camera settled and no live target' needs the runtime",
};

/**
 * One opcode's implementation and how far this client honours it.
 *
 * `run` and `status` travel together on purpose -- see {@link Walker.OPS}.
 */
export interface OpImpl {
  status: OpStatus;
  run?: (w: Walker, op: OpJson, quiet: boolean) => string | undefined;
}

export class Walker {
  readonly script: ScriptJson;
  readonly host: WalkerHost;
  options: WalkerOptions;

  block = 0;
  step = 0;
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
  /** evt 0x1F: the HUD shutter state, 0..8. */
  shutterState = 2;
  /**
   * `DAT_009C8E00` -- the firing gate, set by the shutter machine
   * (`FUN_00413970`): 1 in states 0, 1 and 6, and 0 in state 5 and when a
   * state-3 close completes. It is not simply "the shutter is open": states 0
   * and 5 both draw a closed shutter and set it to 1 and 0 respectively, so a
   * boss intro can be letterboxed and still let you shoot.
   */
  firingGate = false;
  /**
   * Frames left of a state-3 close, after which the gate drops.
   *
   * Real time only. Stepping has no clock, so `stepOnce` finishes a pending
   * close outright rather than leaving the gate stuck up forever.
   */
  gateCloseLeft = 0;
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
   *    while that is set and the firing gate `DAT_009C8E00` is down:
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
   * `branch_choice` (`DAT_009C88A4`). Every writer in the binary is gameplay
   * code, and it is reset to 0 on every block change -- so with no gameplay a
   * branch always takes `next[0]` until the UI sets it.
   */
  branchChoice = 0;
  /** `halt` (0x4E) parks the interpreter; it does not end the scene. */
  parked = false;
  /**
   * Scene fog. Starts effectively off -- the far plane is 8000, so a range
   * beyond it draws nothing, which is what the scripts themselves use
   * (65000/65001) to disable fog.
   */
  /**
   * The scene light block, as 11 channels -- the same numbering the tween
   * handlers use. Keeping the raw channels (rather than separate fog and
   * light structs) is what lets one stepper animate all of them, which is
   * how the game does it.
   *
   *   0 fog near   1 fog far   2,3,4 fog RGB (0-255)   5 = 2,3,4 together
   *   6,7,8 light RGB (0..1)   9 = 6,7,8 together      10 ambient
   */
  channels: number[] = defaultChannels();
  tweens: (ChannelTween | null)[] = new Array(CHANNEL_COUNT).fill(null);
  /** True once the script has actually set a fog channel. */
  fogSet = false;
  /**
   * The scene light: colour from tween channels 6/7/8, ambient from 10, and
   * the direction from opcodes 0x18/0x19 (and 0x17's slerp target, taken
   * immediately). Fed to `SetLightingDefaultSingle`'s single directional
   * light in the game.
   */
  lightDir = { pitchDeg: 0, yawDeg: 0 };
  lightSet = false;

  /** Fog, derived from channels 0-4. */
  get fog(): FogState {
    const c = this.channels;
    return {
      near: c[CH_FOG_NEAR],
      far: c[CH_FOG_FAR],
      rgb: [c[CH_FOG_R], c[CH_FOG_R + 1], c[CH_FOG_R + 2]],
    };
  }

  /** The directional light, derived from channels 6-8 and 10 plus 0x18. */
  get light(): { rgb: [number, number, number]; ambient: number;
                 pitchDeg: number; yawDeg: number } {
    const c = this.channels;
    return {
      rgb: [c[CH_LIGHT_R], c[CH_LIGHT_R + 1], c[CH_LIGHT_R + 2]],
      ambient: c[CH_AMBIENT],
      pitchDeg: this.lightDir.pitchDeg,
      yawDeg: this.lightDir.yawDeg,
    };
  }

  /** True while any channel is still animating. */
  get tweening(): boolean {
    return this.tweens.some((t) => t !== null);
  }
  /** A `cam_play` with `flags & 2` stashes its range for a later 0x21. */
  stashedCam: { slot: number; start: number; end: number } | null = null;
  /**
   * The arcade branch-preview shots, from the most recent `store_six`
   * (`queue_event` sel 0x60): one camera pose per route the next branch can
   * take, indexed by `branch_choice`.
   */
  branchPreview: NonNullable<OpJson["branch_preview"]> | null = null;
  checkpointBlock = 0;
  readonly flags = new Set<number>();
  readonly loadedSlots = new Set<number>();
  spawns: ActiveSpawn[] = [];
  cam: CamCommand | null = null;
  wait: PendingWait | null = null;
  branch: BranchChoice | null = null;
  finished = false;
  bgmTrack: number | null = null;
  /** The most recent `se_play` operand, for the HUD. */
  lastSound: number | null = null;

  private rng: Rng;
  private seq = 0;
  private readonly liveBlocks: BlockJson[];

  constructor(script: ScriptJson, host: WalkerHost,
              options: Partial<WalkerOptions> = {}) {
    this.script = script;
    this.host = host;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rng = new Rng(this.options.seed);
    this.liveBlocks = script.blocks.filter((b) => !b.hole);
    this.block = script.entry_block;
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

  get liveEnemies(): number {
    return this.spawns.filter((s) => s.secondsLeft === null || s.secondsLeft > 0)
      .length;
  }

  // -- control -----------------------------------------------------------

  reset(seed = this.options.seed): void {
    this.rng.reseed(seed);
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
    this.shutterState = 2;
    // BSS, so the gate starts down: FUN_0045EBC0 does not touch DAT_009C8E00,
    // and nothing raises it until the shutter machine's first state 0, 1 or 6.
    this.firingGate = false;
    this.gateCloseLeft = 0;
    this.skippable = false;
    this.skipRequested = false;
    this.rain = false;
    this.gunLights = false;
    this.sceneLighting = false;
    this.branchChoice = 0;
    this.parked = false;
    this.stashedCam = null;
    this.branchPreview = null;
    this.channels = defaultChannels();
    this.tweens = new Array(CHANNEL_COUNT).fill(null);
    this.fogSet = false;
    this.lightDir = { pitchDeg: 0, yawDeg: 0 };
    this.lightSet = false;
    this.checkpointBlock = this.script.entry_block;
    // `g_evt_block_counter` is the engine's, not the walker's -- it lives in
    // `G` because the port reads it, and the walker advances it because the
    // script is what advances it.
    G.g_evt_block_counter = 0;
    this.flags.clear();
    this.loadedSlots.clear();
    this.spawns = [];
    this.cam = null;
    this.wait = null;
    this.branch = null;
    this.finished = false;
    this.bgmTrack = null;
    this.lastSound = null;
    this.seq = 0;
    this.host.onBranch(null);
    this.host.releaseCamera();
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
      gateCloseLeft: this.gateCloseLeft, skippable: this.skippable,
      skipRequested: this.skipRequested, rain: this.rain,
      gunLights: this.gunLights, sceneLighting: this.sceneLighting,
      branchChoice: this.branchChoice, parked: this.parked,
      channels: [...this.channels], tweens: this.tweens.map((t) => t && {...t}),
      fogSet: this.fogSet, lightDir: { ...this.lightDir },
      lightSet: this.lightSet, checkpointBlock: this.checkpointBlock,
      branchPreview: this.branchPreview, stashedCam: this.stashedCam,
      spawns: this.spawns.map((s) => ({ ...s })),
      cam: this.cam && { ...this.cam },
      finished: this.finished, bgmTrack: this.bgmTrack,
      lastSound: this.lastSound, seq: this.seq,
      // Sets are not JSON; the snapshot is a file the user can keep.
      flags: [...this.flags], loadedSlots: [...this.loadedSlots],
      rng: this.rng.state,
    };
  }

  /**
   * Restore it. The wait and the branch are deliberately dropped: both are
   * mid-instruction bookkeeping that the next tick rebuilds, and a restored
   * branch prompt with no countdown would park the script for good.
   */
  loadState(v: unknown): void {
    const s = v as Record<string, never>;
    const keys = [
      "block", "step", "opIndex", "region", "rollEnabled", "useFixedEyeY",
      "fixedEyeY", "groundY", "forcePathAdvance", "backdropPreset",
      "backdropMode", "shutterState", "firingGate", "gateCloseLeft",
      "skippable", "skipRequested", "rain", "gunLights", "sceneLighting",
      "branchChoice", "parked", "channels", "tweens", "fogSet", "lightDir",
      "lightSet", "checkpointBlock", "branchPreview", "stashedCam", "spawns",
      "cam", "finished", "bgmTrack", "lastSound", "seq",
    ] as const;
    const self = this as unknown as Record<string, unknown>;
    for (const k of keys) if (s[k] !== undefined) self[k] = s[k];
    this.flags.clear();
    for (const f of (s["flags"] as unknown as number[]) ?? []) this.flags.add(f);
    this.loadedSlots.clear();
    for (const n of (s["loadedSlots"] as unknown as number[]) ?? []) {
      this.loadedSlots.add(n);
    }
    this.rng.state = ((s["rng"] as unknown as number) ?? 1) >>> 0;
    this.wait = null;
    this.branch = null;
    this.host.onBranch(null);
    // The loaded slots and the region are state; telling the host about them
    // is how the scene comes back with the right rooms streamed in.
    this.host.enterRegion(this.region);
    for (const slot of this.loadedSlots) this.host.loadSlot(slot);
    if (this.cam) this.host.startCamera(this.cam);
  }

  /**
   * Jump to an exact address and replay everything before it.
   *
   * Replaying rather than jumping is the only way the region, the streamed
   * slots and the camera are right when you land: `region_enter` is an
   * instruction, so the region at op 14 of block 3 is a function of every
   * instruction that ran first. Feed output is suppressed during the replay.
   *
   * **The replay observes no waits.** A wait is a thing the *player* watches;
   * a seek is asked for an address, so every one is stepped over the way
   * `primeToFirstWait` steps over the early ones. Without that the loop stops
   * at the first blocking instruction and every seek in the stage lands in the
   * same place -- stage 2 put all of them on block 0 step 1 op 29.
   *
   * Returns whether it actually arrived, so a caller that asked for an
   * unreachable address can say so instead of silently showing another one.
   */
  seek(block: number, step = 0, opIndex = 0, maxOps = 500000): boolean {
    this.reset();
    let executed = 0;
    const arrived = () =>
      this.block === block && this.step === step && this.opIndex >= opIndex;
    while (executed++ < maxOps) {
      if (arrived() || this.finished) break;
      if (this.wait) {
        // Exactly what `executeOne` left undone when the wait was raised: the
        // waiting instruction has run, so move past it.
        this.wait = null;
        this.opIndex++;
        continue;
      }
      // `halt` (0x4E) parks the interpreter and nothing in the script un-parks
      // it, so anything past one is unreachable in play too. Stop rather than
      // run script the game never would.
      if (this.parked) break;
      if (this.branch) { this.takeBranchToward(block); continue; }
      if (!this.executeOne(true)) break;
    }
    this.wait = null;
    this.branch = null;
    this.host.onBranch(null);
    return arrived();
  }

  /**
   * Resolve a branch met during a seek by taking the route the goal is
   * actually behind.
   *
   * Falling back to `next[0]` -- which is what `branch_choice` defaults to --
   * would make a seek past a branch point land wherever the first route goes,
   * so an address recorded on the other fork could never be returned to.
   */
  private takeBranchToward(goal: number): void {
    const b = this.branch;
    if (!b) return;
    this.takeBranch(b.targets.find((t) => this.reaches(t, goal)) ?? b.targets[0]);
  }

  /** Whether `goal` is reachable from `from` by following block routes. */
  private reaches(from: number, goal: number, limit = 1024): boolean {
    const seen = new Set<number>();
    const queue = [from];
    while (queue.length > 0 && seen.size < limit) {
      const n = queue.shift() as number;
      if (n === goal) return true;
      if (n < 0 || seen.has(n)) continue;
      seen.add(n);
      const blk = this.blockAt(n);
      if (!blk || blk.hole) continue;
      const r = blk.route ?? this.script.routes[n];
      if (!r) continue;
      if (r.kind === "goto") queue.push(r.next[0]);
      else if (r.kind === "branch") queue.push(...r.next);
      else queue.push(n + 1);          // kind 2, as advanceStepOrRoute reads it
    }
    return false;
  }

  /** Take one instruction, ignoring any wait. Returns false when stuck. */
  stepOnce(): boolean {
    this.wait = null;
    // Stepping advances instructions, not frames, so a shutter close that is
    // still counting down would never finish and would hold the firing gate up
    // for the rest of the session.
    if (this.gateCloseLeft > 0) {
      this.gateCloseLeft = 0;
      this.firingGate = false;
    }
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
        this.wait = null;
        this.opIndex++;
      }
      if (!this.executeOne(false)) break;
    }
  }

  /**
   * Advance simulated time. `dt` is in seconds; the game runs at 60 Hz and
   * every frame-valued quantity in the data is on that clock.
   */
  tick(dt: number, fps = 60): void {
    if (this.finished || this.branch || this.parked) return;
    let frames = dt * fps;

    // A camera move runs one frame per tick, exactly as CamAdvancePathFrame
    // does: increment until the frame counter reaches the terminator.
    if (this.cam && !this.cam.done && !this.cam.isStatic) {
      const remaining = this.cam.endFrame - this.cam.frame;
      const used = Math.min(frames, Math.max(0, remaining));
      this.cam.frame += used;
      if (this.cam.frame >= this.cam.endFrame) this.cam.done = true;
    }

    // Light and fog animate on the same 60 Hz clock as everything else.
    this.stepTweens(dt * fps);

    // The shutter's 40-frame close, after which the firing gate drops and the
    // game starts offering a skip.
    if (this.gateCloseLeft > 0) {
      this.gateCloseLeft -= dt * fps;
      if (this.gateCloseLeft <= 0) {
        this.gateCloseLeft = 0;
        this.firingGate = false;
      }
    }

    if (this.options.simulateCombat) {
      for (const s of this.spawns) {
        if (s.secondsLeft !== null && s.secondsLeft > 0) {
          s.secondsLeft = Math.max(0, s.secondsLeft - dt);
        }
      }
    }

    if (this.wait) {
      const w = this.wait.policy;
      if (w.kind === "frames") {
        const used = Math.min(frames, w.framesLeft);
        w.framesLeft -= used;
        frames -= used;
        if (w.framesLeft > 0) return;
      } else if (w.kind === "combat") {
        w.secondsLeft = Math.max(0, w.secondsLeft - dt);
        if (!this.waitSatisfied()) return;
      } else if (!this.waitSatisfied()) {
        return;
      }
      this.wait = null;
      this.opIndex++;
    }

    let guard = 0;
    while (!this.finished && !this.parked && !this.wait && !this.branch &&
           guard++ < 4096) {
      if (!this.executeOne(false)) break;
    }
  }

  /**
   * The firing gate, exactly as `FUN_00413970` drives it.
   *
   * States 0, 1 and 6 raise it; state 5 drops it at once; state 3 drops it
   * only when the 40-frame close completes, which is why the countdown is
   * kept rather than the gate simply following the state.
   */
  applyFiringGate(state: number): void {
    this.gateCloseLeft = 0;
    if (state === 0 || state === 1 || state === 6) this.firingGate = true;
    else if (state === 5) this.firingGate = false;
    else if (state === 3) this.gateCloseLeft = 40;
  }

  /**
   * True when the game would be offering a skip: inside a skippable region
   * (`DAT_009A2D7C`) with the firing gate down (`DAT_009C8E00 == 0`).
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
      this.host.startCamera(this.cam);
    }

    // DrawDialogueSubtitleTask tests the flag every frame and ends the task,
    // so a line already on screen goes at once rather than playing out.
    this.host.endDialogue();

    // The waits are re-run every frame, so one already pending is released
    // the same way a new one is passed straight through.
    if (this.wait && SKIPPABLE_WAITS.has(this.wait.op.op)) {
      this.wait = null;
      this.opIndex++;
    }
    return true;
  }

  private waitSatisfied(): boolean {
    const w = this.wait;
    if (!w) return true;
    switch (w.policy.kind) {
      case "frames":
        return w.policy.framesLeft <= 0;
      case "camera":
        return !this.cam || this.cam.done || this.cam.isStatic;
      case "combat":
        return this.liveEnemies <= (w.op.arg ?? 0) || w.policy.secondsLeft <= 0;
      case "enemies":
        return (this.host.aliveEnemies() ?? 0) <= (w.op.arg ?? 0);
      default:
        return true;
    }
  }

  // -- execution ---------------------------------------------------------

  private executeOne(quiet: boolean): boolean {
    if (this.finished || this.parked || this.branch || this.wait) return false;
    const blk = this.currentBlock;
    if (!blk || blk.hole || !blk.steps || blk.steps.length === 0) {
      return this.advanceStepOrRoute(quiet);
    }
    if (this.step >= blk.steps.length) return this.advanceStepOrRoute(quiet);
    const step = blk.steps[this.step];
    // Falling off the end of a step's instructions is the same thing
    // `end_block` does explicitly: move to the next step.
    if (this.opIndex >= step.ops.length) return this.advanceStepOrRoute(quiet);

    const op = step.ops[this.opIndex];
    const note = this.apply(op, quiet);
    if (!quiet) {
      this.host.onFeed({
        seq: this.seq++,
        block: this.block,
        step: this.step,
        opIndex: this.opIndex,
        op,
        note,
      });
    }
    if (this.wait || this.branch || this.finished || this.parked) return true;
    this.opIndex++;
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

  static pushSpawns(w: Walker, op: OpJson): string | undefined {
    if (!op.spawns?.length) return undefined;
    for (const s of op.spawns) {
      w.spawns.push({
        ...s,
        block: w.block,
        step: w.step,
        opIndex: w.opIndex,
        opcode: op.op,
        secondsLeft: w.options.simulateCombat
          ? w.options.secondsPerEnemy
          : null,
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
  applyLightChannel(op: OpJson): string | undefined {
    const ch = op.channel;
    if (ch === undefined || ch < 0 || ch > 10) return undefined;

    const targets: number[] =
      ch === 5 ? [CH_FOG_R, CH_FOG_R + 1, CH_FOG_R + 2]
      : ch === 9 ? [CH_LIGHT_R, CH_LIGHT_R + 1, CH_LIGHT_R + 2]
      : [ch];

    // Channel 5/9 with an explicit per-component triple (the `set` form)
    // carries `components`; otherwise one value covers every target.
    const values: (number | null)[] =
      op.components && op.components.length === 3 && ch === 5
        ? op.components
        : targets.map(() => (op.value ?? null));

    let touched = false;
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      const to = values[i];
      if (to === null || to === undefined || !Number.isFinite(to)) continue;
      touched = true;

      if (op.tween === "rate" && op.rate) {
        this.tweens[c] = { to, rate: Math.abs(op.rate) };
      } else if (op.tween === "time" && op.frames) {
        const rate = Math.abs(to - this.channels[c]) / op.frames;
        // The handler falls through to an immediate set when frames is 0.
        this.tweens[c] = rate > 0 ? { to, rate } : null;
        if (rate <= 0) this.channels[c] = to;
      } else {
        this.tweens[c] = null;
        this.channels[c] = to;
      }
    }
    if (!touched) return undefined;

    if (ch <= 5) this.fogSet = true;
    else this.lightSet = true;

    if (op.tween === "time" && op.frames) {
      return `${op.channel_name} -> ${op.value} over ${op.frames} frames`;
    }
    if (op.tween === "rate") return `${op.channel_name} -> ${op.value}`;
    return undefined;
  }

  /**
   * Advance every running channel tween by `frames`.
   *
   * Steps toward the target and stops exactly on it, which is what clearing
   * the block's `enabled` word amounts to.
   */
  private stepTweens(frames: number): void {
    if (frames <= 0) return;
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      const t = this.tweens[c];
      if (!t) continue;
      const cur = this.channels[c];
      const delta = t.to - cur;
      const step = t.rate * frames;
      if (Math.abs(delta) <= step) {
        this.channels[c] = t.to;
        this.tweens[c] = null;
      } else {
        this.channels[c] = cur + Math.sign(delta) * step;
      }
    }
  }

  applyQueueEvent(op: OpJson): string | undefined {
    if (op.action === "cam_play") {
      const slot = op.slot ?? -1;
      const start = op.start ?? 0;
      const end = op.end ?? 0;

      // `flags & 2` does NOT play. EvtActionCamPlay40 stashes the range in
      // g_stashed_path_frame / _end_frame and returns; a later
      // `queue_event 0x21, 6|7` enters the scene state whose camera hook
      // steps it. All 208 deferred plays in the game are followed within
      // three queued actions by exactly that, so the idiom is reliable.
      if (((op.flags ?? 0) & 2) !== 0) {
        this.stashedCam = { slot, start, end };
        return "stashed for a later scene state 6/7";
      }

      // start == -1 resumes from the frame the previous command left at,
      // rather than seeking; start == end holds a static pose.
      const from = op.resume && this.cam ? this.cam.frame : start;
      this.cam = {
        slot,
        startFrame: from,
        endFrame: end,
        frame: from,
        flags: op.flags ?? 0,
        isStatic: !!op.static,
        deferred: false,
        file: op.cam?.file ?? null,
        pathIndex: op.cam?.path ?? null,
        done: !!op.static,
      };
      this.host.startCamera(this.cam);
      return this.cam.isStatic ? "static pose" : undefined;
    }

    if (op.action === "store_six" && op.branch_preview) {
      // FUN_00403DB0 reads these back indexed by branch_choice, so they are
      // the shot the arcade shows for each route the branch can take.
      this.branchPreview = op.branch_preview;
      return `${op.branch_preview.length} branch preview shots`;
    }

    if (op.action === "finish_sequence") {
      // Selector 0x21 is EvtEnterSceneState(2, minor) -- it picks a *camera
      // routine*, it does not hand control back from a path. Row 2's live
      // cells are 4, 6 and 7, and those are the only operands that occur.
      const minor = op.args?.[0];
      if (minor === 6 || minor === 7) {
        const st = this.stashedCam;
        if (!st) return "state 6/7 with nothing stashed";
        this.cam = {
          slot: st.slot,
          startFrame: st.start,
          endFrame: st.end,
          frame: st.start,
          flags: 0,
          // State 7 uses `<` rather than `<=` on the end frame; one frame.
          isStatic: st.start === st.end,
          deferred: true,
          file: op.cam?.file ?? null,
          pathIndex: op.cam?.path ?? null,
          done: st.start === st.end,
        };
        this.stashedCam = null;
        this.host.startCamera(this.cam);
        return `plays the stashed range ${st.start}..${st.end}`;
      }
      if (minor === 4 && this.cam) {
        // CameraSnapToPathEye: hold where the path is now.
        this.cam.done = true;
        this.cam.isStatic = true;
        this.host.startCamera(this.cam);
        return "snap to path eye";
      }
      return op.camera_state ? `camera state ${op.camera_state}` : undefined;
    }
    return undefined;
  }

  applyWait(op: OpJson): string | undefined {
    const blocksOn = op.blocks_on ?? "";
    const arg = op.arg ?? 0;
    let policy: WaitPolicy;

    // Every one of these opcodes opens with the same test -- 0x40 and 0x41
    // with `if (skip == 0) { ...block... }`, 0x42 with `if (skip != 0)
    // { clear and advance }` -- so a raised flag walks straight past them.
    // The flag is not cleared here: it stays up until `set_skippable_region`
    // closes the region, which is what makes one press skip a whole cutscene
    // rather than a single wait.
    if (this.skipRequested && SKIPPABLE_WAITS.has(op.op)) {
      return `${blocksOn} -- skipped`;
    }

    if (op.op === 0x42) {
      policy = { kind: "frames", framesLeft: arg };
    } else if (op.op === 0x41) {
      // Operand 0 means "to the end of the path"; otherwise wait until the
      // path frame passes the operand.
      const target = arg === 0 ? this.cam?.endFrame ?? 0 : arg;
      const left = this.cam ? Math.max(0, target - this.cam.frame) : 0;
      policy = { kind: "frames", framesLeft: left };
    } else if (op.op === 0x40) {
      policy = { kind: "camera" };
    } else if (op.op === 0x43 || op.op === 0x44) {
      // With shooting on, the gate is the gate: it opens when they are dead.
      const alive = this.host.aliveEnemies();
      if (alive !== null) {
        policy = alive <= arg
          ? { kind: "passed", why: "no live enemies" }
          : { kind: "enemies" };
      } else if (this.options.simulateCombat) {
        const over = Math.max(0, this.liveEnemies - arg);
        policy = { kind: "combat",
                   secondsLeft: over * this.options.secondsPerEnemy };
      } else {
        policy = { kind: "passed",
                   why: WAIT_NOTES[op.op] ?? "needs the runtime" };
      }
    } else if (op.op === 0x45 && this.flags.has(arg)) {
      policy = { kind: "passed", why: "flag already set by the script" };
    } else {
      policy = { kind: "passed", why: WAIT_NOTES[op.op] ?? "needs the runtime" };
    }

    if (policy.kind === "passed") return `${blocksOn} -- ${policy.why}`;
    this.wait = { op, blocksOn, policy };
    return blocksOn;
  }

  // -- routing -----------------------------------------------------------

  /**
   * `end_block` (0x4F), transcribed from `EvtAdvanceBlockOrRoute` (0x0045F000):
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
   * 1. **A block's steps run in sequence.** `end_block` advances to the next
   *    *step*, not out of the block. Only when the step table is exhausted
   *    does the route table get consulted. Treating every `end_block` as a
   *    block exit skips most of a stage -- including the `region_enter` and
   *    `cam_play` instructions that live in the later steps.
   * 2. **`kind == 2` is not "the scene ends".** It falls through to
   *    `block + 1`. The scene ends when the block it lands on is a hole.
   * 3. **A branch takes `next[branch_choice]`**, and `branch_choice` is reset
   *    to 0 at the end of every block change. Nothing in the script sets it:
   *    every writer is in gameplay code (shooting a door, taking a route),
   *    so with no gameplay a branch always takes `next[0]`. That is what the
   *    branch UI is for -- it sets the choice the player would have made.
   */
  advanceStepOrRoute(quiet: boolean): boolean {
    this.step += 1;
    this.opIndex = 0;
    const blk = this.currentBlock;
    if (blk?.steps && this.step < blk.steps.length) return true;

    const route = blk?.route ?? this.script.routes[this.block];
    if (!route) {
      this.finished = true;
      return false;
    }

    if (route.kind === "branch" && !quiet) {
      const targets = route.next.filter((n) => n >= 0);
      if (targets.length > 1) {
        // Pause and ask. Resolved by takeBranch(), which is what actually
        // performs the transition.
        this.branch = {
          block: this.block,
          targets,
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
    // `EvtAdvanceBlockOrRoute` advances `g_evt_block_counter` on every block
    // transition. Class 0x41's props measure their lifetime in these rather
    // than in frames, so it has to be a real counter and not a frame clock.
    G.g_evt_block_counter++;
    if (this.options.clearSpawnsOnBlock) this.spawns = [];
    // The preview shots belong to the branch in the block that stored them --
    // every `store_six` in the game sits in a branch block. Carrying one
    // across a block change offers an unrelated shot for the next branch,
    // which is exactly as wrong as it sounds.
    this.branchPreview = null;
    this.block = index;
    this.step = (blk.steps?.length ?? 0) > step ? step : 0;
    this.opIndex = 0;
    this.branch = null;
    // Reset last, matching the tail of EvtAdvanceBlockOrRoute: a choice
    // applies to exactly one transition and never carries forward.
    this.branchChoice = 0;
    this.host.onBranch(null);
    return true;
  }

  /**
   * Resolve a paused branch by setting `branch_choice` and taking the
   * transition. Passing nothing lets the seeded RNG pick, which is what the
   * arcade countdown does.
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
      const pick = b.targets[Math.floor(this.rng.next() * b.targets.length)];
      choice = route ? Math.max(0, route.next.indexOf(pick)) : 0;
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
