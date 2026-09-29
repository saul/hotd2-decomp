/**
 * The replica: player 2's end. It runs no game. It holds the host's state,
 * applied a tick at a time into the live `G`, draws it, plays the host's
 * sounds, and sends the gun.
 *
 * Driven by the player:
 *
 * * {@link NetReplica.step} once per 60 Hz tick of the player's own loop --
 *   the jitter buffer decides which received tick, if any, becomes the state
 *   the frame draws.
 * * {@link NetReplica.flushInput} every frame, and at once on a press.
 * * {@link NetReplica.poll} with the clock, for pings and statistics.
 *
 * **Every applied tick is checked.** The host sends the hash of its state
 * with each tick, and the replica compares its own -- kept as the ops land,
 * not walked (`StateMirror.hash`). A mismatch is a desync: logged, reported,
 * and repaired with a keyframe, against which the replica then compares its
 * own state value by value and tells the host *which* values differed.
 * Nothing about it is silent.
 *
 * **What the kept hash cannot see, the audit does.** A write into the state
 * by this page's own systems, which should only read it, leaves the kept
 * hash as right as the host's ops made it. So each tick the replica also
 * looks at a few sections of the tree against the shares the ops left them
 * (`StateMirror.audit`); a whole pass takes about a second.
 */
import { ByteReader, ByteWriter } from "../../core/net/bytes";
import {
  ApplyError, StateMirror, TreeHasher, diffTrees, sameTree,
} from "../../core/net/codec";
import {
  Msg, decodeJson, readKeyframeChunk, readTickHead, writeInput,
  type Channel, type DesyncMsg, type DesyncReportMsg, type HoldReason, type KeyframeChunk,
  type LoadMsg, type Press, type PressKind, type ReadyMsg, type SessionMsg,
  type TickHead,
} from "../../core/net/protocol";
import { InputMode } from "../../game/input_mode";
import { NetPeer, type Identity } from "./peer";
import { CostMeter, Jitter } from "./stats";
import type { Transport } from "./transport";

/** What the replica needs of the player. */
export interface ReplicaSim {
  /**
   * Load this stage, if it is not the one loaded. Resolves to an error or
   * null. `builder` is the exporter that built the host's copy: a copy built
   * by another is refused.
   */
  load(stage: number, original: boolean, builder?: string): Promise<string | null>;
  /**
   * Make `root` the game's state -- a keyframe, decoded. The player adopts its
   * objects as `G`'s. Returns an error, or null.
   */
  install(root: Record<string, unknown>): string | null;
  /** The live tree deltas apply into: `{ frame, rng, parts: { game: G, ... } }`. */
  root(): Record<string, unknown>;
  /**
   * The state as the page's systems hold it -- `world.save()`'s layout, read
   * back from them -- or absent where there is no page. See `LIVE_EVERY`.
   */
  liveRoot?(): Record<string, unknown>;
  /** A delta was applied; `touched` names the parts it wrote. */
  afterApply(touched: Set<string>): void;
  /** One of the host's events, for the replica's own subscribers. */
  dispatch(name: string, payload: unknown): void;
  /** Something arrived that wants a frame. */
  wake(): void;
}

/** The replica never plays a sound this far behind the tick it arrives with. */
const STALE_EVENT_TICKS = 12;
/** How many ticks behind the newest the buffer may fall before it jumps. */
const JUMP_SLACK = 4;
/** A resync request is repeated no more often than this. */
const RESYNC_MS = 500;
/**
 * While the state is known wrong, the keyframe is asked for again after this
 * long, and twice as long each time after, up to {@link RESYNC_RETRY_MAX_MS}.
 * A request can be lost to the throttle or a keyframe can fail to verify;
 * either way nothing else would ask again.
 */
const RESYNC_RETRY_MS = 1000;
const RESYNC_RETRY_MAX_MS = 8000;
/**
 * No step for this long and the player's loop is not running -- a hidden
 * tab, a long stall. Ticks are then applied as they land, so the state stays
 * current and the host's base keeps moving.
 */
const IDLE_MS = 250;
/**
 * How much of the state the audit looks at a tick, in leaves (and sections).
 * The state is some four thousand leaves in four hundred sections, so a pass
 * over all of it takes about a second of ticks, and a tick's share is a few
 * hundred small hashes -- where walking the whole of it, as each hashed tick
 * used to, cost an iPhone ten milliseconds.
 */
const AUDIT_BUDGET = 96;
/**
 * Every this many verified ticks, once a second, the slices the page's
 * systems hold are compared with the ones the deltas left. The deltas land in
 * a mirrored tree, and every slice but `G` is then handed to its system's
 * `load`: a `load` that drops or changes what it is handed diverges the game
 * while the mirror -- and so the tick's hash -- stays right. `G` is the
 * mirror's own, which the audit covers.
 */
const LIVE_EVERY = 60;
/**
 * A keyframe that answers a desync waits this long, at most, for the delta of
 * its own tick, which the host sends beside it: applied, it brings this end's
 * state to the keyframe's tick, where the two can be compared value by value.
 */
const EXPLAIN_WAIT_MS = 250;
/** Input goes at most this often, apart from presses, which go at once. */
const INPUT_MS = 15;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

interface Buffered {
  head: TickHead;
  bytes: Uint8Array;
  arrived: number;
}

export class NetReplica extends NetPeer {
  private phase: "hello" | "loading" | "waiting" | "streaming" = "hello";
  private epoch = -1;
  private at = -1;
  private readonly buffer = new Map<number, Buffered>();
  private newest = -1;
  private keyframe: { epoch: number; tick: number; stage: number; hash: number;
                      chunks: Uint8Array[]; got: number } | null = null;
  private readonly mirror = new StateMirror();
  private readonly hasher = new TreeHasher();
  private readonly jitter = new Jitter();
  private depthAvg = 0;
  /** Where the loaded stage is: a Load for the same one needs no load. */
  private loaded: { stage: number; original: boolean } | null = null;
  private loadSeq = 0;
  hold: HoldReason = "loading";
  branch: string | null = null;
  private lastEventTick = -1;
  private resyncAt = -Infinity;
  /** Set on the first mismatch of an episode, cleared by a keyframe that verifies. */
  private desynced = false;
  /** While desynced: when to ask for the keyframe again, and the wait after that. */
  private retryAt = Infinity;
  private retryMs = RESYNC_RETRY_MS;
  /** When the player last stepped: its loop is idle long after. */
  private lastStepAt = -Infinity;
  private liveCount = 0;
  private readonly cost = new CostMeter();
  private liveLoggedAt = -Infinity;
  /**
   * The tick a desync was found at, while the keyframe that answers it is on
   * its way; -1 otherwise. The keyframe is compared with this end's state
   * before it is installed, which is what names the values that differed.
   */
  private explainFrom = -1;
  /**
   * Whether it was the hash that found it -- the one case where this end's
   * kept hash against its walked one says something the reason does not.
   */
  private explainKept = false;
  /** That keyframe, assembled, while it waits for its tick's delta. */
  private held: { tick: number; stage: number; hash: number; bytes: Uint8Array;
                  until: number } | null = null;
  // -- the gun --
  private aim = { x: 0, y: 0, on: false, mode: InputMode.MouseKeyboard as number };
  private readonly unacked: Press[] = [];
  private pressId = 0;
  private inputSeq = 0;
  private lastInput = -Infinity;
  private readonly inW = new ByteWriter(512);
  /** Verify every tick's hash; off only to measure what it costs. */
  verify = true;

  constructor(transport: Transport, me: Identity, private readonly sim: ReplicaSim) {
    super(transport, me, "replica");
    this.stats.phase = "connecting";
  }

  /** Whether the player's clock should run: streaming, and the host's is. */
  get running(): boolean {
    return this.phase === "streaming" && this.hold === null && !this.closed;
  }

  /** The tick on screen. */
  get tick(): number {
    return this.at;
  }

  protected onHello(): void {
    this.stats.phase = "waiting for the host";
  }

  protected handle(m: Msg, _ch: Channel, data: Uint8Array): void {
    switch (m) {
      case Msg.Load:
        void this.onLoad(decodeJson<LoadMsg>(data));
        return;
      case Msg.Keyframe:
        this.onKeyframeChunk(readKeyframeChunk(new ByteReader(data)));
        return;
      case Msg.Tick: {
        const r = new ByteReader(data);
        const head = readTickHead(r);
        if (head.epoch !== this.epoch) return;
        this.lossIn.record(head.seq);
        this.jitter.add(head.sentAt, this.now);
        if (head.pressAck > this.pressAck) this.pressAck = head.pressAck;
        if (head.tick <= this.at || this.buffer.has(head.tick)) return;
        this.buffer.set(head.tick, { head, bytes: data, arrived: this.now });
        if (head.tick > this.newest) this.newest = head.tick;
        if (this.held && head.tick === this.held.tick) this.release();
        // No step is coming for this -- the host's clock is held, so the
        // player's is; or the player's loop is not running at all, a hidden
        // tab -- so it is applied as it lands, and acknowledged, so the host's
        // deltas stay narrow and a tab brought back shows the game as it is.
        if (this.phase === "streaming"
            && (this.hold !== null || this.now - this.lastStepAt > IDLE_MS)) {
          this.applyNewest();
          this.sendInput(false);
        }
        this.sim.wake();
        return;
      }
      case Msg.Session: {
        const s = decodeJson<SessionMsg>(data);
        if (s.epoch !== this.epoch) return;
        const was = this.hold;
        this.hold = s.hold;
        this.branch = s.branch;
        if (was !== s.hold) this.sim.wake();
        return;
      }
      default:
        this.log("decode", -1, `unexpected message ${Msg[m] ?? m} from the host`);
    }
  }

  /** A new epoch: load its stage if it is not the one loaded, then say so. */
  private async onLoad(l: LoadMsg): Promise<void> {
    this.epoch = l.epoch;
    this.stats.epoch = l.epoch;
    this.phase = "loading";
    this.stats.phase = `loading stage ${l.stage}`;
    this.buffer.clear();
    this.newest = -1;
    this.at = -1;
    this.keyframe = null;
    this.lastEventTick = -1;
    this.lossIn.reset();
    this.jitter.reset();
    // The host counts this epoch's input from zero, as this counts its ticks.
    this.inputSeq = 0;
    this.desynced = false;
    this.explainFrom = -1;
    this.explainKept = false;
    this.held = null;
    this.retryAt = Infinity;
    this.retryMs = RESYNC_RETRY_MS;
    this.hold = "loading";
    // A press made in the old timeline means nothing in the new one.
    this.unacked.length = 0;
    const seq = ++this.loadSeq;
    let error: string | null = null;
    const same = this.loaded && this.loaded.stage === l.stage
      && this.loaded.original === l.original;
    if (!same) {
      this.loaded = null;
      try {
        error = await this.sim.load(l.stage, l.original, l.builder);
      } catch (e) {
        error = (e as Error).message;
      }
      if (seq !== this.loadSeq) return; // a newer epoch overtook this load
      if (!error) this.loaded = { stage: l.stage, original: l.original };
    }
    if (error) {
      this.problem(`could not load stage ${l.stage}: ${error}`);
      this.stats.phase = "load failed";
    } else {
      this.phase = "waiting";
      this.stats.phase = "waiting for a keyframe";
    }
    const ready: ReadyMsg = { epoch: l.epoch, ...(error ? { error } : {}) };
    this.sendCtrl(Msg.Ready, ready);
  }

  private onKeyframeChunk(c: KeyframeChunk): void {
    if (c.epoch !== this.epoch || this.phase === "loading") return;
    if (!this.keyframe || this.keyframe.tick !== c.tick) {
      if (c.tick <= this.at && !this.desynced && this.phase === "streaming") return;
      this.keyframe = { epoch: c.epoch, tick: c.tick, stage: c.stage, hash: c.hash,
                        chunks: new Array(c.count), got: 0 };
    }
    const k = this.keyframe;
    if (c.index >= c.count || k.chunks[c.index]) return;
    k.chunks[c.index] = c.bytes;
    k.got++;
    if (k.got < c.count) return;
    this.keyframe = null;
    let total = 0;
    for (const b of k.chunks) total += b.length;
    const all = new Uint8Array(total);
    let o = 0;
    for (const b of k.chunks) { all.set(b, o); o += b.length; }
    if (this.explainFrom >= 0 && this.at < k.tick && !this.buffer.has(k.tick)) {
      this.held = { tick: k.tick, stage: k.stage, hash: k.hash, bytes: all,
                    until: this.now + EXPLAIN_WAIT_MS };
      return;
    }
    this.installKeyframe(k.tick, k.stage, k.hash, all);
  }

  /** The held keyframe, installed: its delta came, or it waited long enough. */
  private release(): void {
    const h = this.held!;
    this.held = null;
    this.installKeyframe(h.tick, h.stage, h.hash, h.bytes);
  }

  private installKeyframe(tick: number, stage: number, hash: number,
                          bytes: Uint8Array): void {
    const t0 = performance.now();
    // The host's state is of the stage it has loaded, which is not always the
    // one it announced; installed into another stage it would hash the same
    // and draw nonsense.
    if (this.loaded && stage !== this.loaded.stage) {
      const why = `the host's state is of stage ${stage}, and this page loaded `
        + `stage ${this.loaded.stage}`;
      this.log("keyframe", tick, `keyframe refused: ${why}`);
      this.problem(why);
      this.stale(`keyframe refused: ${why}`, tick);
      return;
    }
    let root: Record<string, unknown>;
    try {
      root = this.mirror.readKeyframe(new ByteReader(bytes));
    } catch (e) {
      this.log("keyframe", tick, `keyframe did not decode: ${(e as Error).message}`);
      this.stale("keyframe did not decode", tick);
      return;
    }
    if (this.explainFrom >= 0) this.explain(tick, root);
    // Compared before it is installed, so a difference is the codec's...
    const decoded = this.hasher.hash(root);
    if (decoded !== hash) {
      this.log("keyframe", tick, `keyframe decoded to hash ${hex(decoded)}, `
        + `the host's was ${hex(hash)}`);
    }
    const err = this.sim.install(root);
    if (err) {
      this.log("keyframe", tick, `keyframe refused: ${err}`);
      this.problem(`keyframe refused: ${err}`);
      this.stale(`keyframe refused: ${err}`, tick);
      return;
    }
    this.at = tick;
    // A new episode: whatever was wrong before, this is the state now, and
    // the next request for a keyframe, if one is needed, goes at once.
    this.desynced = false;
    this.resyncAt = -Infinity;
    // ...and after, so a difference is the install's: something that runs on
    // a load wrote state it should only have read. The mirror keeps the hash
    // from here.
    const installed = this.mirror.rehash(this.sim.root());
    if (installed !== hash) {
      this.log("keyframe", tick, `installed state hashes ${hex(installed)}, `
        + `the host's was ${hex(hash)}: ${diffTrees(root, this.sim.root(), 4).join("; ")
          || "a difference outside the decoded tree"}`);
      this.stats.mismatches++;
      // Backing off: a keyframe that installs wrong once will install wrong
      // again, and each is forty kilobytes.
      const wait = this.retryMs;
      this.desync(tick, "the installed keyframe differs");
      this.retryAt = this.now + wait;
      this.retryMs = Math.min(RESYNC_RETRY_MAX_MS, wait * 2);
    } else {
      this.retryAt = Infinity;
      this.retryMs = RESYNC_RETRY_MS;
    }
    this.lastEventTick = tick;
    this.phase = "streaming";
    this.stats.phase = "streaming";
    this.stats.keyframes++;
    this.stats.keyframeBytes = bytes.length;
    this.stats.costMax = Math.max(this.stats.costMax, performance.now() - t0);
    for (const t of [...this.buffer.keys()]) if (t <= tick) this.buffer.delete(t);
    this.sendInput(true);
    this.sim.wake();
  }

  /**
   * One tick of the player's clock: apply the tick the jitter buffer says is
   * due, if there is one. Returns whether the state moved.
   */
  step(now: number): boolean {
    this.now = now;
    this.lastStepAt = now;
    if (this.phase !== "streaming" || this.closed) return false;
    for (const t of this.buffer.keys()) if (t <= this.at) this.buffer.delete(t);
    const target = this.targetDepth();
    this.stats.target = target;
    if (this.buffer.size === 0) {
      if (this.hold === null) this.stats.underruns++;
      this.stats.depth = 0;
      return false;
    }
    const depth = this.newest - this.at;
    this.stats.depth = depth;
    this.depthAvg = this.depthAvg * 0.95 + depth * 0.05;
    let pick: Buffered | null = null;
    if (depth > target + JUMP_SLACK) {
      // Far behind -- a stall, a hidden tab: go straight to where the buffer
      // should be. Every tick skipped is counted.
      const want = this.newest - target;
      for (const [t, b] of this.buffer) {
        if (t <= want && b.head.base <= this.at && (!pick || t > pick.head.tick)) pick = b;
      }
    }
    if (!pick) {
      // The next tick in order; if the next was lost, the first one after it
      // that applies from here -- its window covers the gap.
      for (const [t, b] of this.buffer) {
        if (b.head.base <= this.at && (!pick || t < pick.head.tick)) pick = b;
      }
      // Drift: the two clocks are different crystals. Sitting persistently
      // deep, take one extra tick now and then rather than a jump later.
      if (pick && this.depthAvg > target + 1.5) {
        const next = this.buffer.get(pick.head.tick + 1);
        if (next && next.head.base <= this.at) {
          pick = next;
          this.depthAvg -= 1;
        }
      }
    }
    if (!pick) {
      // Everything waiting is against a base this replica does not hold yet:
      // a keyframe is in flight.
      if (this.hold === null) this.stats.underruns++;
      return false;
    }
    const skipped = pick.head.tick - this.at - 1;
    if (skipped > 0) this.stats.skips += skipped;
    this.apply(pick);
    return true;
  }

  /** The newest tick that applies from here, now, and nothing older. */
  private applyNewest(): void {
    let pick: Buffered | null = null;
    for (const [t, b] of this.buffer) {
      if (t > this.at && b.head.base <= this.at && (!pick || t > pick.head.tick)) pick = b;
    }
    if (!pick) return;
    const skipped = pick.head.tick - this.at - 1;
    if (skipped > 0) this.stats.skips += skipped;
    this.apply(pick);
    for (const t of [...this.buffer.keys()]) if (t <= this.at) this.buffer.delete(t);
  }

  /** The depth the jitter says the buffer needs, in ticks. */
  private targetDepth(): number {
    return Math.max(1, Math.min(8, Math.ceil(this.jitter.spread() / (1000 / 60)) + 1));
  }

  private apply(b: Buffered): void {
    const cost = this.cost;
    cost.begin();
    const head = b.head;
    this.buffer.delete(head.tick);
    const r = new ByteReader(b.bytes);
    readTickHead(r);
    const touched = new Set<string>();
    const events: [number, string, unknown][] = [];
    try {
      this.mirror.readDefs(r);
      this.mirror.applyOps(r, this.sim.root(), touched);
      const n = r.uvar();
      for (let i = 0; i < n; i++) {
        const k = r.uvar();
        const name = this.mirror.readValue(r) as string;
        const payload = this.mirror.readValue(r);
        events.push([k, name, payload]);
      }
    } catch (e) {
      // The state may be half-written. It is shown as it is until the
      // keyframe lands, and the overlay says so. Logged once an episode:
      // every tick until the repair fails the same way, and a dozen copies
      // of it would push out of the log the report that says why.
      this.stats.applyErrors++;
      const kind = e instanceof ApplyError ? "apply" : "decode";
      if (!this.desynced) this.log(kind, head.tick, (e as Error).message);
      this.at = head.tick;
      this.sim.afterApply(touched);
      this.desync(head.tick, `${kind}: ${(e as Error).message}`);
      return;
    }
    cost.lap("apply");
    const from = this.at;
    this.at = head.tick;
    this.sim.afterApply(touched);
    cost.lap("load");
    if (this.verify) {
      const mine = this.mirror.hash;
      this.stats.verified++;
      if (mine !== head.hash) {
        this.mismatch(head, mine, head.hash);
      } else if (!this.desynced) {
        // Known wrong already, there is nothing to learn from either.
        const wrote = this.mirror.audit(this.sim.root(), AUDIT_BUDGET);
        cost.lap("audit");
        if (wrote !== null) {
          this.stats.pageWrites++;
          this.log("hash", head.tick, `this page wrote ${wrote}: the state holds `
            + "what the host never sent");
          this.desync(head.tick, `this page wrote ${wrote}`);
        } else if (++this.liveCount >= LIVE_EVERY) {
          this.liveCount = 0;
          this.checkLive(head.tick);
          cost.lap("live");
        }
      }
    }
    // The host's events for every tick this apply moved over, oldest first,
    // and none too old to be worth hearing.
    const stale = head.tick - STALE_EVENT_TICKS;
    for (const [k, name, payload] of events) {
      if (k <= this.lastEventTick || k <= from || k < stale) continue;
      this.sim.dispatch(name, payload);
    }
    this.lastEventTick = head.tick;
    this.stats.tick = head.tick;
    this.stats.lag = this.newest - head.tick;
    cost.lap("apply");
    cost.end(this.stats, this.now);
    this.stats.desynced = this.desynced;
  }

  private mismatch(head: TickHead, mine: number, theirs: number): void {
    this.stats.mismatches++;
    if (this.desynced) return; // already reported; a keyframe is on its way
    this.log("hash", head.tick, `state hash ${hex(mine)}, the host's ${hex(theirs)}`);
    this.explainKept = true;
    this.desync(head.tick, "state hash differs");
  }

  /**
   * The state is known wrong. Said once an episode: the host answers with a
   * keyframe, which `explain` compares with this end's state to say which
   * values differ. If that keyframe does not come, or does not fix it, `poll`
   * asks again.
   */
  private desync(tick: number, reason: string): void {
    if (this.desynced) return;
    this.desynced = true;
    this.stats.desynced = true;
    this.retryAt = this.now + this.retryMs;
    this.explainFrom = tick;
    const msg: DesyncMsg = { epoch: this.epoch, tick, reason };
    this.sendCtrl(Msg.Desync, msg);
    this.resyncAt = this.now;
    this.log("report", tick, `asked the host for a keyframe: ${reason}`);
  }

  /**
   * The keyframe that answers a desync, against this end's own state at the
   * same tick: the values that differ, named, here and to the host. The
   * stream is usually a tick or two short of the keyframe's tick, and the
   * delta that closes the gap is in the buffer; applied, the two are of one
   * tick and every difference is real. One walk of each, on a desync only.
   */
  private explain(tick: number, want: Record<string, unknown>): void {
    this.explainFrom = -1;
    // Up to the keyframe's tick, by the newest delta that applies from here.
    while (this.at < tick) {
      let pick: Buffered | null = null;
      for (const [t, b] of this.buffer) {
        if (t > this.at && t <= tick && b.head.base <= this.at
            && (!pick || t > pick.head.tick)) pick = b;
      }
      if (!pick) break;
      this.apply(pick);
    }
    let differ: string[] = [];
    let note: string;
    if (this.at !== tick) {
      note = `not compared: this end was at tick ${this.at}, the keyframe is of ${tick}`;
    } else {
      const mine = this.sim.root();
      differ = diffTrees(want, mine, 12);
      note = differ.length ? "" : "every value agrees";
      // A hash that differed: from the ops, or from a write the audit had
      // not reached yet? The kept hash is what the ops left; the walked one
      // is what the state is.
      const walked = this.explainKept ? this.hasher.hash(mine) : this.mirror.hash;
      if (walked !== this.mirror.hash) {
        note += `${note ? "; " : ""}this end's state hashes ${hex(walked)} and its ops `
          + `left ${hex(this.mirror.hash)}: something besides the host's ops wrote it`;
      }
    }
    this.explainKept = false;
    const report: DesyncReportMsg = { epoch: this.epoch, tick, differ, note };
    this.sendCtrl(Msg.DesyncReport, report);
    this.log("report", tick, `against the keyframe (host's vs this end's): `
      + [...differ, ...(note ? [note] : [])].join(", "));
  }

  /** The state is behind rather than wrong: a keyframe was lost or refused. */
  private stale(reason: string, tick: number): void {
    this.desynced = true;
    if (this.retryAt === Infinity) this.retryAt = this.now + this.retryMs;
    this.requestResync(reason, tick);
  }

  /**
   * The state as the systems hold it, against the mirror. Local, so a
   * difference is named exactly: the mirror is what the host sent, and the
   * live tree is what the page made of it. A slice the two share -- `G` --
   * is the mirror's, and the audit's to check.
   */
  private checkLive(tick: number): void {
    const live = this.sim.liveRoot?.();
    if (!live) return;
    const mine = this.sim.root();
    const d: string[] = [];
    for (const k of new Set([...Object.keys(mine), ...Object.keys(live)])) {
      const a = mine[k], b = live[k];
      if (k !== "parts" || !isObject(a) || !isObject(b)) {
        if (!sameTree(a, b)) d.push(...diffTrees(a, b, 4, [k]));
        continue;
      }
      const pa = a as Record<string, unknown>, pb = b as Record<string, unknown>;
      for (const id of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        if (!sameTree(pa[id], pb[id])) d.push(...diffTrees(pa[id], pb[id], 4, ["parts", id]));
      }
    }
    if (!d.length) return;
    this.stats.liveMismatches++;
    if (this.now - this.liveLoggedAt < 5000) return;
    this.liveLoggedAt = this.now;
    this.log("hash", tick, "the page's systems hold a different state from "
      + `the one applied: ${d.slice(0, 4).join("; ")}`);
  }

  private requestResync(reason: string, tick: number): void {
    if (this.now - this.resyncAt < RESYNC_MS) return;
    this.resyncAt = this.now;
    this.sendCtrl(Msg.Resync, { epoch: this.epoch, reason, tick });
  }

  /** Ask the host for a keyframe by hand: the overlay's button. */
  resync(): void {
    this.resyncAt = -Infinity;
    this.requestResync("asked for by hand", this.at);
  }

  // -- the gun ----------------------------------------------------------

  /** Where player 2 is aiming: the exe's pixels from the frame's centre, +y up. */
  setAim(x: number, y: number, on: boolean): void {
    this.aim.x = x;
    this.aim.y = y;
    this.aim.on = on;
  }

  /**
   * The device player 2 is aiming with: their PC input mode, which goes out
   * beside the aim in every input packet -- the byte the exe's own network
   * game sends at `+0x14` (`NetBuildInputPacket`, `FUN_004A02F0`).
   */
  setInputMode(mode: number): void {
    this.aim.mode = mode;
  }

  /**
   * A trigger pull, a reload or START. Goes out at once, and in every input
   * packet after until the host acknowledges it. Returns its id, or -1 when
   * there is no stream for it to go into.
   */
  press(kind: PressKind, ray?: Press["ray"]): number {
    if (this.phase !== "streaming" || this.closed) return -1;
    const id = ++this.pressId;
    this.unacked.push({
      id, kind, view: this.at, x: this.aim.x, y: this.aim.y,
      ...(ray ? { ray } : {}),
    });
    this.stats.presses++;
    this.sendInput(true);
    return id;
  }

  /** Once a frame: the aim, what has been applied, and what is unacknowledged. */
  flushInput(now: number): void {
    this.now = now;
    this.sendInput(false);
  }

  private sendInput(force: boolean): void {
    if (this.closed || this.epoch < 0) return;
    if (!force && this.now - this.lastInput < INPUT_MS) return;
    this.lastInput = this.now;
    // What the host has taken is gone from the queue: the ack rides on every
    // tick packet, and the highest seen is the one that counts.
    while (this.unacked.length && this.unacked[0].id <= this.pressAck) {
      this.unacked.shift();
    }
    this.inW.reset();
    writeInput(this.inW, {
      epoch: this.epoch, seq: this.inputSeq++, ack: this.at, view: this.at,
      aim: this.aim, presses: this.unacked.slice(0, 32),
    });
    this.send("tick", this.inW.finish());
  }

  /** The highest press id any tick packet has acknowledged. */
  private pressAck = -1;

  override poll(now: number): void {
    super.poll(now);
    if (this.closed) return;
    if (this.held && now >= this.held.until) this.release();
    if (this.desynced && (this.phase === "streaming" || this.phase === "waiting")
        && now >= this.retryAt) {
      this.retryAt = now + this.retryMs;
      this.retryMs = Math.min(RESYNC_RETRY_MAX_MS, this.retryMs * 2);
      this.resyncAt = -Infinity;
      this.requestResync("the state is still wrong", this.at);
    }
    // A loop that does not step does not flush either: what was applied as it
    // landed is acknowledged from here too.
    if (this.phase === "streaming" && now - this.lastStepAt > IDLE_MS) {
      this.sendInput(false);
    }
    const s = this.stats;
    s.expectTicks = this.phase === "streaming" && this.hold === null;
    s.jitter = this.jitter.spread();
    s.desynced = this.desynced;
    if (this.phase === "streaming") {
      s.phase = this.hold ? `held by the host: ${this.hold}` : "streaming";
    }
  }
}

function hex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}
