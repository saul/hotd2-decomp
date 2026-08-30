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

import type { BlockJson, OpJson, ScriptJson, SpawnJson } from "./bundle";

/** Deterministic PRNG, so a branch sequence is reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  /** evt `0x1F`: the HUD shutter state. */
  setShutter(state: number): string | undefined;
  /** evt `0x2D`: show a message group. */
  showMessage(group: number): string | undefined;
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
  0x43: "simulated: the live-enemy gate, paced by the combat setting",
  0x44: "simulated: the second enemy counter, paced with 0x43",
  0x45: "passed: the script flag array is written by gameplay",
  0x46: "passed: the scripted-actor counter is a runtime value",
  0x47: "passed: 'camera settled and no live target' needs the runtime",
};

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
   * In the retail build this is never raised. The machinery is all there:
   * both player-update routines (`FUN_00414940`, `FUN_00414B90`) end with
   *
   * ```c
   * if (DAT_009c8e00 == 0 && DAT_009a2d7c != 0) {   // cutscene, skippable
   *     mask[0] = 0x2; mask[1] = 0x20000;           // Start, player 1 / 2
   *     if (mask[player] & _DAT_009c9028) DAT_009a1a18 = 1;
   * }
   * ```
   *
   * -- but `DAT_009a1a18` has **two writers and no readers anywhere in the
   * binary**, and the only two writers of `DAT_009A2D74` itself
   * (`EvtOpSetSkippableRegion2C` and the scene reset `FUN_0045EBC0`) both
   * store 0. One assignment is missing and the whole feature is inert.
   *
   * Everything downstream of the flag is intact and is transcribed exactly,
   * so the player supplies that one assignment from the UI: {@link requestSkip}
   * is the line the retail build does not have. Nothing else here is invented.
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

  private rng: () => number;
  private seq = 0;
  private readonly liveBlocks: BlockJson[];

  constructor(script: ScriptJson, host: WalkerHost,
              options: Partial<WalkerOptions> = {}) {
    this.script = script;
    this.host = host;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rng = mulberry32(this.options.seed);
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
    this.rng = mulberry32(seed);
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
   * Jump to an exact address and replay everything before it.
   *
   * Replaying rather than jumping is the only way the region, the streamed
   * slots and the camera are right when you land: `region_enter` is an
   * instruction, so the region at op 14 of block 3 is a function of every
   * instruction that ran first. Feed output is suppressed during the replay.
   */
  seek(block: number, step = 0, opIndex = 0, maxOps = 500000): void {
    this.reset();
    const quiet = { ...this.host };
    let executed = 0;
    const stop = () =>
      this.block === block && this.step === step && this.opIndex >= opIndex;
    while (!this.finished && executed++ < maxOps) {
      if (stop()) break;
      if (!this.executeOne(true)) break;
    }
    void quiet;
    this.wait = null;
    this.branch = null;
    this.host.onBranch(null);
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
  private applyFiringGate(state: number): void {
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
   * Raise the skip flag -- the one assignment the retail build is missing.
   *
   * Pressing Start is what reaches this point in the game; see the note on
   * {@link skipRequested}. Everything the flag then does is the game's own
   * code. Returns false when the game would not have offered a skip.
   */
  requestSkip(): boolean {
    if (!this.canSkip) return false;
    this.skipRequested = true;
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

  /** Apply one instruction. Returns a note for the feed, if there is one. */
  private apply(op: OpJson, quiet: boolean): string | undefined {
    switch (op.op) {
      case 0x29: // region_enter
        this.region = op.region ?? -1;
        this.host.enterRegion(this.region);
        return undefined;
      case 0x28: // region_load -- preloads, does not switch
        if (op.region !== undefined) this.host.loadRegion(op.region);
        return "preload";
      case 0x50: // asset_load_slot
        if (op.slot !== undefined) {
          this.loadedSlots.add(op.slot);
          this.host.loadSlot(op.slot);
        }
        return undefined;
      case 0x51: // asset_unload_slot
        if (op.slot !== undefined) {
          this.loadedSlots.delete(op.slot);
          this.host.unloadSlot(op.slot);
        }
        return undefined;
      case 0x30:
        return this.applyQueueEvent(op);
      case 0x35: // enable_camera_path_roll
        this.rollEnabled = !!op.roll_enabled;
        return this.rollEnabled ? "roll channel on" : "roll channel off";
      case 0x1a: // set_ground_plane_y / g_camera_fixed_eye_y
        this.groundY = op.ground_y ?? null;
        this.fixedEyeY = op.camera_fixed_eye_y ?? op.ground_y ?? 0;
        return undefined;
      case 0x36: // pin_view_to_ground_plane
        this.useFixedEyeY = !!op.use_fixed_eye_y;
        return this.useFixedEyeY
          ? `camera eye Y pinned to ${this.fixedEyeY}`
          : "camera eye Y back to path.y - 15";
      case 0x37: // force_camera_path_advance
        this.forcePathAdvance = !!op.force_path_advance;
        return undefined;
      case 0x18: // set_light0_direction -- block 0 is the one that renders
      case 0x17: // slerp_light0_direction: taken as an immediate set
        if (op.pitch_deg !== undefined) {
          this.lightDir = {
            pitchDeg: op.pitch_deg,
            yawDeg: op.yaw_deg ?? this.lightDir.yawDeg,
          };
          this.lightSet = true;
        }
        return op.op === 0x17 ? "slerp target taken immediately" : undefined;
      case 0x19: // set_light1_direction -- block 1 never reaches the device
        return undefined;
      case 0x14: // set_scene_lighting -- gates 0x15 and 0x16
        this.sceneLighting = !!op.enabled;
        return undefined;
      case 0x1f: // set_hud_shutter_state
        this.shutterState = op.value ?? 0;
        this.applyFiringGate(this.shutterState);
        return quiet ? undefined : this.host.setShutter(this.shutterState);
      case 0x2c: // set_skippable_region
        // EvtOpSetSkippableRegion2C:
        //   arg != 0 -> DAT_009a2230 = 0; DAT_009a2d7c = 1
        //   arg == 0 -> DAT_009a2d7c = 0; skip flag = 0
        // Closing the region always clears the flag, so a skip never carries
        // past the region it was asked for.
        this.skippable = (op.raw?.length
          ? Number.parseInt(op.raw[0], 16) : (op.value ?? 0)) !== 0;
        if (!this.skippable) this.skipRequested = false;
        return this.skippable ? "skippable region open" : "skippable region closed";
      case 0x2e: // resume_bgm_if_skipped
        // `if (skip) PlaySoundId(0x80000002)` -- restart the BGM a skipped
        // cutscene interrupted. Inert unless a skip actually happened.
        if (this.skipRequested && !quiet) {
          this.host.playSound(0x80000002);
          return "BGM resumed after a skip";
        }
        return undefined;
      case 0x2d: // show_screen_message
        return quiet || op.message_group === undefined
          ? undefined
          : this.host.showMessage(op.message_group);
      case 0x15: // enable_entity_spotlights -- the two players' gun lights
        // Decoded as a raw operand: 0x15's handler only writes a global, so
        // `script.py` leaves it in `raw` rather than naming a field.
        this.gunLights = (op.raw?.length
          ? Number.parseInt(op.raw[0], 16) : (op.value ?? 0)) !== 0;
        return this.gunLights ? "gun lights on" : "gun lights off";
      case 0x1d: // enable_rain
        this.rain = !!op.value;
        return this.rain ? "rain on" : "rain off";
      case 0x1b: // set_backdrop_preset
        this.backdropPreset = op.value ?? -1;
        return `dome preset ${this.backdropPreset}`;
      case 0x1c: // set_backdrop_mode: 0 off, 2 frozen, else animating
        this.backdropMode = op.value ?? 0;
        return this.backdropMode === 0 ? "dome off"
          : this.backdropMode === 2 ? "dome frozen" : undefined;
      case 0x20:  // light0_set / tweens -- block 0 is the one the renderer
      case 0x21:  // is pushed every frame, so it is the one that shows.
      case 0x23:
        return this.applyLightChannel(op);
      case 0x24:  // block 1 is pushed only at scene init; tracked, not drawn.
      case 0x25:
      case 0x27:
        return undefined;
      case 0x48: // set_script_flag
        if (op.flag !== undefined) this.flags.add(op.flag);
        return undefined;
      case 0x5f: // bgm_entry_play
        this.bgmTrack = op.track ?? null;
        // The handler is a stop followed by a play, and only the third
        // operand is used. `quiet` is a replay, where re-triggering audio for
        // every instruction skipped over would be wrong.
        return quiet || op.track === undefined || op.track === null
          ? undefined
          : this.host.playSound(op.track);
      case 0x4d: // checkpoint
        this.checkpointBlock = this.block;
        return "checkpoint";
      case 0x4e: // halt
        // The handler does not advance pc, so the VM sits here re-running it
        // forever. That is a park, not the end of the scene.
        this.parked = true;
        return "halt — the script parks here";
      case 0x4f: // end_block
        this.advanceStepOrRoute(quiet);
        return undefined;
      default:
        break;
    }

    // 0x38/0x3A se_play, 0x39/0x3B se_play_3d. The "unless skip" variants are
    // gated on a flag nothing in the binary ever sets, so all four always run.
    if (op.op >= 0x38 && op.op <= 0x3b) {
      this.lastSound = op.sound ?? null;
      return quiet || !op.sound ? undefined : this.host.playSound(op.sound);
    }

    if (op.spawns && op.spawns.length) {
      for (const s of op.spawns) {
        this.spawns.push({
          ...s,
          block: this.block,
          step: this.step,
          opIndex: this.opIndex,
          opcode: op.op,
          secondsLeft: this.options.simulateCombat
            ? this.options.secondsPerEnemy
            : null,
        });
      }
      return `${op.spawns.length} spawn${op.spawns.length === 1 ? "" : "s"}`;
    }

    if (op.op >= 0x40 && op.op <= 0x47) return this.applyWait(op);
    return undefined;
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
  private applyLightChannel(op: OpJson): string | undefined {
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

  private applyQueueEvent(op: OpJson): string | undefined {
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

  private applyWait(op: OpJson): string | undefined {
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
    } else if ((op.op === 0x43 || op.op === 0x44) &&
               this.options.simulateCombat) {
      const over = Math.max(0, this.liveEnemies - arg);
      policy = { kind: "combat",
                 secondsLeft: over * this.options.secondsPerEnemy };
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
  private advanceStepOrRoute(quiet: boolean): boolean {
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
      const pick = b.targets[Math.floor(this.rng() * b.targets.length)];
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
