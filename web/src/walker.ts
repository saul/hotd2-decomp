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
  /** Seconds a branch point waits before the seeded RNG picks. */
  branchCountdown: number;
  /** Clear spawn markers when the block changes. */
  clearSpawnsOnBlock: boolean;
  seed: number;
}

export const DEFAULT_OPTIONS: WalkerOptions = {
  secondsPerEnemy: 1,
  simulateCombat: true,
  branchCountdown: 5,
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
}

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
  groundY: number | null = null;
  checkpointBlock = 0;
  readonly flags = new Set<number>();
  readonly loadedSlots = new Set<number>();
  spawns: ActiveSpawn[] = [];
  cam: CamCommand | null = null;
  wait: PendingWait | null = null;
  branch: BranchChoice | null = null;
  finished = false;
  bgmTrack: number | null = null;

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
    // A block is entered at step 1, not step 0: EvtAdvanceBlockOrRoute sets
    // the step index to 1 on every block change, so step 0 is reached only
    // through the checkpoint path. The steps of a block are alternative
    // programs rather than a sequence -- each one ends with `end_block` --
    // which is why entering at the wrong one skips the block's real content.
    this.step = (this.blockAt(this.script.entry_block)?.steps?.length ?? 0) > 1
      ? 1 : 0;
    this.opIndex = 0;
    this.region = -1;
    this.rollEnabled = false;
    this.groundY = null;
    this.checkpointBlock = this.script.entry_block;
    this.flags.clear();
    this.loadedSlots.clear();
    this.spawns = [];
    this.cam = null;
    this.wait = null;
    this.branch = null;
    this.finished = false;
    this.bgmTrack = null;
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
    while (!this.finished && !this.wait && !this.branch && n++ < maxOps) {
      // Stop as soon as there is both something resident and somewhere to
      // look from; running further would silently skip past the opening.
      if (this.cam && this.region >= 0) break;
      if (!this.executeOne(false)) break;
    }
  }

  /**
   * Advance simulated time. `dt` is in seconds; the game runs at 60 Hz and
   * every frame-valued quantity in the data is on that clock.
   */
  tick(dt: number, fps = 60): void {
    if (this.finished || this.branch) return;
    let frames = dt * fps;

    // A camera move runs one frame per tick, exactly as CamAdvancePathFrame
    // does: increment until the frame counter reaches the terminator.
    if (this.cam && !this.cam.done && !this.cam.isStatic) {
      const remaining = this.cam.endFrame - this.cam.frame;
      const used = Math.min(frames, Math.max(0, remaining));
      this.cam.frame += used;
      if (this.cam.frame >= this.cam.endFrame) this.cam.done = true;
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
    while (!this.finished && !this.wait && !this.branch && guard++ < 4096) {
      if (!this.executeOne(false)) break;
    }
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
    if (this.finished || this.branch || this.wait) return false;
    const blk = this.currentBlock;
    if (!blk || blk.hole || !blk.steps || blk.steps.length === 0) {
      return this.leaveBlock(quiet);
    }
    if (this.step >= blk.steps.length) return this.leaveBlock(quiet);
    const step = blk.steps[this.step];
    if (this.opIndex >= step.ops.length) {
      this.step++;
      this.opIndex = 0;
      // A block's step list running out is what hands control to the route
      // table (FUN_0045F000), so only the last step falls through.
      return this.step < blk.steps.length ? true : this.leaveBlock(quiet);
    }

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
    if (this.wait || this.branch || this.finished) return true;
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
      case 0x1a: // set_ground_plane_y
        this.groundY = op.ground_y ?? null;
        return undefined;
      case 0x48: // set_script_flag
        if (op.flag !== undefined) this.flags.add(op.flag);
        return undefined;
      case 0x5f: // bgm_entry_play
        this.bgmTrack = op.track ?? null;
        return undefined;
      case 0x4d: // checkpoint
        this.checkpointBlock = this.block;
        return "checkpoint";
      case 0x4e: // halt
        this.finished = true;
        return "halt";
      case 0x4f: // end_block
        this.leaveBlock(quiet);
        return undefined;
      default:
        break;
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

  private applyQueueEvent(op: OpJson): string | undefined {
    if (op.action === "cam_play") {
      const slot = op.slot ?? -1;
      const start = op.start ?? 0;
      const end = op.end ?? 0;
      // start == -1 resumes from the frame the previous command left at,
      // rather than seeking; start == end holds a static pose.
      const resumeFrom = this.cam && op.resume ? this.cam.frame : start;
      const cmd: CamCommand = {
        slot,
        startFrame: op.resume ? resumeFrom : start,
        endFrame: end,
        frame: op.resume ? resumeFrom : start,
        flags: op.flags ?? 0,
        isStatic: !!op.static,
        deferred: ((op.flags ?? 0) & 2) !== 0,
        file: op.cam?.file ?? null,
        pathIndex: op.cam?.path ?? null,
        done: !!op.static,
      };
      this.cam = cmd;
      this.host.startCamera(cmd);
      if (cmd.deferred) {
        // The game stashes these and a later scene-state transition plays
        // them. The walker plays them now so the shot is visible, and says so.
        return "deferred by flags & 2; played here anyway";
      }
      return cmd.isStatic ? "static pose" : undefined;
    }
    if (op.action === "finish_sequence") {
      this.host.releaseCamera();
      return "camera released";
    }
    return undefined;
  }

  private applyWait(op: OpJson): string | undefined {
    const blocksOn = op.blocks_on ?? "";
    const arg = op.arg ?? 0;
    let policy: WaitPolicy;

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
   * The route table decides what runs next when a block's steps run out.
   * `kind` 0 goes to `next[0]`, 1 branches on the player's choice, 2 ends the
   * scene.
   */
  private leaveBlock(quiet: boolean): boolean {
    const blk = this.currentBlock;
    const route = blk?.route ?? this.script.routes[this.block];
    if (!route) {
      this.finished = true;
      return false;
    }
    if (route.kind === "end") {
      this.finished = true;
      this.host.onBranch(null);
      return false;
    }
    const targets = route.next.filter((n) => n >= 0);
    if (route.kind === "branch" && targets.length > 1 && !quiet) {
      this.branch = {
        block: this.block,
        targets,
        countdown: this.options.branchCountdown,
      };
      this.host.onBranch(this.branch);
      return true;
    }
    const next = route.kind === "branch"
      ? targets[Math.floor(this.rng() * targets.length)] ?? targets[0]
      : targets[0];
    if (next === undefined) {
      this.finished = true;
      return false;
    }
    this.goToBlock(next);
    return true;
  }

  /**
   * Enter a block at **step 1**.
   *
   * `EvtAdvanceBlockOrRoute` sets the step index to 1 on every block change,
   * so step 0 is reached only through the checkpoint path. Step 0 is
   * therefore presented as checkpoint state rather than run inline.
   * *(The block-change behaviour is read from the binary; the checkpoint
   * reading is inference.)*
   */
  goToBlock(index: number, step = 1): void {
    if (this.options.clearSpawnsOnBlock) this.spawns = [];
    this.block = index;
    const blk = this.blockAt(index);
    const n = blk?.steps?.length ?? 0;
    this.step = n > step ? step : 0;
    this.opIndex = 0;
    this.branch = null;
    this.host.onBranch(null);
  }

  /** Resolve a paused branch. Passing nothing lets the seeded RNG pick. */
  takeBranch(target?: number): void {
    const b = this.branch;
    if (!b) return;
    const pick = target !== undefined && b.targets.includes(target)
      ? target
      : b.targets[Math.floor(this.rng() * b.targets.length)] ?? b.targets[0];
    this.goToBlock(pick);
  }

  tickBranchCountdown(dt: number): void {
    if (!this.branch) return;
    this.branch.countdown -= dt;
    if (this.branch.countdown <= 0) this.takeBranch();
    else this.host.onBranch(this.branch);
  }

  get blockCount(): number {
    return this.liveBlocks.length;
  }
}
