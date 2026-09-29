/**
 * The authoritative end: it runs the game, sends the replica what changed, and
 * takes player 2's gun.
 *
 * Driven by the player at three points, and nowhere else:
 *
 * * {@link NetHost.takeInput} at the head of every tick -- player 2's aim,
 *   and every press that has arrived since the last one, for the player to
 *   feed into player index 1's slots, the one place intent enters `G`.
 * * {@link NetHost.endTick} at the end of every tick -- diff the state, send
 *   a delta or a keyframe.
 * * {@link NetHost.discontinuity} whenever the timeline jumps -- a stage load,
 *   a seek, a rewind, a restart. A new epoch, and the replica loads again.
 *
 * The replica's acknowledgements decide each delta's base, and the codec's
 * window property (`core/net/codec.ts`) is what makes a base that is already
 * stale by the time the packet lands still correct.
 */
import { ByteReader, ByteWriter } from "../../core/net/bytes";
import { StateTracker } from "../../core/net/codec";
import {
  KEYFRAME_CHUNK, Msg, PressKind, decodeJson, readInput, writeKeyframeChunk,
  writeTickHead,
  type Channel, type DesyncMsg, type DesyncReportMsg, type HoldReason, type LoadMsg,
  type Press, type ReadyMsg, type ResyncMsg, type SessionMsg,
} from "../../core/net/protocol";
import { NetPeer, type Identity } from "./peer";
import { CostMeter, Rate } from "./stats";
import type { Transport } from "./transport";

/** What the host needs of the player. */
export interface HostSim {
  /**
   * The stage the player is loading or has loaded, in which mode, and whose
   * exporter built it: what a new epoch announces, before the load finishes.
   */
  stage(): { stage: number; original: boolean; builder?: string };
  /** The stage the live state is of: what a keyframe says it is. */
  loaded(): number;
  /** The live state, laid out as `world.save()` lays it out, uncloned. */
  liveRoot(): Record<string, unknown>;
  /** Why the host's clock is not running, or null. */
  hold(): HoldReason;
  /** The route the host is being asked to choose, as a label, or null. */
  branch(): string | null;
  /** `G.g_camera_view_to_world` after this tick: the camera the host drew. */
  view(): readonly number[];
  /** `g_projection_distance_px`: what a crosshair pixel is measured against. */
  readonly projectionDistance: number;
}

/** A press as the host took it, with what the aim check made of it. */
export interface TakenPress extends Press {
  /** Degrees between the replica's segment and the host's camera; NaN if unchecked. */
  aimError: number;
}

/** Player 2's gun, as the host feeds it into the port. */
export interface RemoteInput {
  /** Where player 2 is aiming, or null before the first packet. */
  aim: { x: number; y: number; on: boolean } | null;
  /** Presses that arrived since the last call, oldest first. */
  presses: TakenPress[];
}

/** Ticks of events kept to repeat in later deltas. Older ones would play late. */
const EVENT_WINDOW = 30;
/** Ticks of camera kept for checking player 2's shots against. */
const VIEW_HISTORY = 240;
/** Keyframes are expensive; a replica that keeps asking gets one this often. */
const KEYFRAME_COOLDOWN_MS = 500;
/** A delta bigger than this goes on the reliable channel instead. */
const MAX_UNRELIABLE = 12 * 1024;
/** How long the host holds its clock for a replica that is loading. */
const LOAD_WAIT_MS = 45_000;
/** While the host's clock is held, a tick this often all the same. See `poll`. */
const HELD_TICK_MS = 250;
/**
 * The widest delta sent, in ticks. Past it a keyframe is cheaper: a replica
 * that has not acknowledged in a second and a half is not applying what it
 * is sent, and every delta from its base would carry the whole window again
 * -- sixty a second -- where one keyframe resets the base for all of them.
 */
const MAX_DELTA_SPAN = 90;

export class NetHost extends NetPeer {
  private epoch = 0;
  /** "hello", "loading" (the replica's), "streaming". */
  private phase: "hello" | "loading" | "streaming" = "hello";
  private tracker: StateTracker | null = null;
  private tick = 0;
  /** The replica's newest applied tick in this epoch, or -1. */
  private ack = -1;
  private keyframeAt = -1;
  private keyframeSentAt = -Infinity;
  private needKeyframe = true;
  private seq = 0;
  private loadSentAt = 0;
  private readonly events = new Map<number, [string, unknown][]>();
  private pending: [string, unknown][] = [];
  private readonly views = new Map<number, number[]>();
  private aim: RemoteInput["aim"] = null;
  private presses: TakenPress[] = [];
  private pressHigh = -1;
  private lastSession = "";
  private lastSessionAt = -Infinity;
  private readonly deltaRate = new Rate();
  private readonly deltaCount = new Rate();
  private readonly out = new ByteWriter(16 * 1024);
  private aimErrorAt = -Infinity;
  /** When the last tick went, for the held clock's own ticks. */
  private lastTickAt = -Infinity;
  private readonly cost = new CostMeter();

  constructor(transport: Transport, me: Identity, private readonly sim: HostSim) {
    super(transport, me, "host");
    this.stats.phase = "waiting for player 2";
  }

  /** Whether the host should hold its clock: the replica is loading the stage. */
  get holding(): boolean {
    return this.phase === "loading" && !this.closed
      && this.now - this.loadSentAt < LOAD_WAIT_MS;
  }

  /** Whether player 2's page has answered the handshake, and the link still stands. */
  get connected(): boolean {
    return this.peerHello !== null && !this.closed;
  }

  /** Whether a replica is connected and taking ticks. */
  get streaming(): boolean {
    return this.phase === "streaming" && !this.closed;
  }

  protected onHello(): void {
    this.startEpoch();
  }

  /**
   * The timeline jumped: a load, a seek, a rewind, a restart. The replica is
   * told to load this epoch's stage -- a no-op on its side if it already has
   * it -- and gets a keyframe once it says it is ready.
   */
  discontinuity(): void {
    if (!this.peerHello || this.closed) return;
    this.startEpoch();
  }

  private startEpoch(): void {
    this.epoch++;
    this.phase = "loading";
    this.stats.phase = "replica loading";
    this.tracker = null;
    this.tick = 0;
    this.ack = -1;
    this.keyframeAt = -1;
    this.needKeyframe = true;
    this.seq = 0;
    this.lossIn.reset();
    this.events.clear();
    this.pending = [];
    // A press aimed into the old timeline would fire in the new one.
    this.presses = [];
    this.views.clear();
    this.loadSentAt = this.now;
    const { stage, original, builder } = this.sim.stage();
    const load: LoadMsg = { epoch: this.epoch, stage, original,
                            ...(builder ? { builder } : {}) };
    this.sendCtrl(Msg.Load, load);
    this.stats.epoch = this.epoch;
  }

  /** An event the port raised; it goes out with the tick it happened in. */
  tap(name: string, payload: unknown): void {
    if (this.phase !== "streaming") return;
    this.pending.push([name, structuredClone(payload)]);
  }

  /** Player 2's gun since the last call. See {@link RemoteInput}. */
  takeInput(): RemoteInput {
    const presses = this.presses;
    this.presses = [];
    return { aim: this.aim, presses };
  }

  /**
   * After a tick: diff and send. The diff keeps the state's hash as it goes
   * (`StateTracker.hash`), so every tick carries it. `now` is the page's
   * clock, for the cost and the keyframe cooldown.
   */
  endTick(now: number): void {
    this.now = now;
    if (this.phase !== "streaming" || this.closed) {
      this.pending = [];
      return;
    }
    const cost = this.cost;
    cost.begin();
    this.lastTickAt = now;
    this.tick++;
    const t = this.tick;
    if (!this.tracker) this.tracker = new StateTracker();
    const tracker = this.tracker;
    const live = this.sim.liveRoot();
    cost.lap("state");
    tracker.update(live, t);
    cost.lap("diff");

    // The base is the replica's newest ack -- or the keyframe in flight, which
    // the reliable channel will deliver, so a delta against it waits on the
    // replica's side until it lands rather than being lost.
    const base = Math.max(this.ack, this.keyframeAt);
    const canDelta = base >= 0 && tracker.covers(base);
    const cooled = now - this.keyframeSentAt >= KEYFRAME_COOLDOWN_MS;
    const tooWide = t - base > MAX_DELTA_SPAN;
    const keyframe = (this.needKeyframe || !canDelta || tooWide)
      && (cooled || this.keyframeAt < 0);
    if (this.pending.length) this.events.set(t, this.pending);
    this.pending = [];
    this.events.delete(t - EVENT_WINDOW - 1);
    this.views.set(t, this.sim.view().slice());
    this.views.delete(t - VIEW_HISTORY);
    if (keyframe) {
      // The tick's delta as well, where there is one to send: a replica that
      // asked because its state differs compares the keyframe with its own
      // state at the keyframe's tick, and this is how it gets there.
      if (canDelta && !tooWide) this.sendDelta(base);
      this.sendKeyframe();
    } else if (canDelta) {
      this.sendDelta(base);
    }
    cost.lap("send");
    cost.end(this.stats, now);
    this.stats.tick = t;
    this.stats.lag = this.ack < 0 ? 0 : t - this.ack;
  }

  private writeEvents(from: number, to: number) {
    return (w: ByteWriter, value: (v: unknown) => void): void => {
      const lo = Math.max(from + 1, to - EVENT_WINDOW);
      let n = 0;
      for (let k = lo; k <= to; k++) n += this.events.get(k)?.length ?? 0;
      w.uvar(n);
      for (let k = lo; k <= to; k++) {
        for (const [name, payload] of this.events.get(k) ?? []) {
          w.uvar(k);
          value(name);
          value(payload);
        }
      }
    };
  }

  private sendDelta(base: number): void {
    const w = this.out;
    w.reset();
    writeTickHead(w, {
      epoch: this.epoch, seq: this.seq++, tick: this.tick, base,
      pressAck: this.pressHigh, hash: this.tracker!.hash, sentAt: this.now,
    });
    const info = this.tracker!.encodeDelta(base, w, this.writeEvents(base, this.tick));
    this.cost.lap("encode");
    if (!info) {
      this.sendKeyframe();
      return;
    }
    const bytes = w.finish();
    // Too big to trust to one unreliable message: a lost fragment loses it
    // all, and the next one is as big. The reliable channel carries it once.
    this.send(bytes.length > MAX_UNRELIABLE ? "ctrl" : "tick", bytes);
    this.deltaRate.add(bytes.length);
    this.deltaCount.add();
    const n = this.deltaCount.sample(this.now);
    this.stats.deltaBytes = n > 0 ? this.deltaRate.sample(this.now) / n : 0;
  }

  private sendKeyframe(): void {
    const hash = this.tracker!.hash;
    const body = new ByteWriter(64 * 1024);
    // A keyframe carries no events: whatever they announced is in the state.
    this.tracker!.encodeKeyframe(body, (w) => w.uvar(0));
    const bytes = body.finish();
    const count = Math.max(1, Math.ceil(bytes.length / KEYFRAME_CHUNK));
    for (let i = 0; i < count; i++) {
      const w = new ByteWriter(KEYFRAME_CHUNK + 64);
      writeKeyframeChunk(w, {
        epoch: this.epoch, tick: this.tick, stage: this.sim.loaded(),
        index: i, count, hash,
        bytes: bytes.subarray(i * KEYFRAME_CHUNK, (i + 1) * KEYFRAME_CHUNK),
      });
      this.send("ctrl", w.finish());
    }
    this.keyframeAt = this.tick;
    this.keyframeSentAt = this.now;
    this.needKeyframe = false;
    this.stats.keyframes++;
    this.stats.keyframeBytes = bytes.length;
  }

  protected handle(m: Msg, _ch: Channel, data: Uint8Array): void {
    switch (m) {
      case Msg.Input: {
        const p = readInput(new ByteReader(data));
        if (p.epoch !== this.epoch) return;
        this.lossIn.record(p.seq);
        if (p.ack > this.ack && p.ack <= this.tick) this.ack = p.ack;
        this.aim = p.aim;
        // A pull made while the host's game is stopped goes nowhere, as
        // player 1's does (`gunInput` drops it); START is latched for the
        // next tick for either player. Taken all the same -- acknowledged --
        // so the replica stops sending it.
        const stopped = this.sim.hold() !== null;
        for (const q of p.presses) {
          if (q.id <= this.pressHigh) continue;
          this.pressHigh = q.id;
          if (stopped && q.kind !== PressKind.Start) continue;
          const aimError = q.kind === PressKind.Pull ? this.checkAim(q) : NaN;
          this.presses.push({ ...q, aimError });
          this.stats.presses++;
        }
        return;
      }
      case Msg.Ready: {
        const r = decodeJson<ReadyMsg>(data);
        if (r.epoch !== this.epoch) return;
        if (r.error) {
          this.problem(`player 2 could not load the stage: ${r.error}`);
          this.log("report", -1, `load failed: ${r.error}`);
          return;
        }
        this.phase = "streaming";
        this.stats.phase = "streaming";
        this.needKeyframe = true;
        return;
      }
      case Msg.Resync: {
        const r = decodeJson<ResyncMsg>(data);
        if (r.epoch !== this.epoch) return;
        this.needKeyframe = true;
        this.log("report", r.tick, `player 2 asked for a keyframe: ${r.reason}`);
        return;
      }
      case Msg.Desync: {
        const d = decodeJson<DesyncMsg>(data);
        if (d.epoch !== this.epoch) return;
        this.needKeyframe = true;
        // One walk, on a desync only: that the hash this end sent was its
        // state's. Player 2 answers the rest -- which values -- once the
        // keyframe lands, where it can compare them.
        const kept = this.tracker?.checkHash() ?? true;
        this.log("report", d.tick, `player 2's state differs: ${d.reason}`
          + (kept ? "" : "; and this end's kept hash had drifted from its state"));
        return;
      }
      case Msg.DesyncReport: {
        const d = decodeJson<DesyncReportMsg>(data);
        if (d.epoch !== this.epoch) return;
        this.log("report", d.tick, `player 2 compared the keyframe: `
          + (d.differ.length ? d.differ.join(", ") : d.note));
        return;
      }
      default:
        this.log("decode", -1, `unexpected message ${Msg[m] ?? m} from player 2`);
    }
  }

  /**
   * Player 2's shot against the host's own record of the camera at the tick
   * they were looking at. The replica built its segment through its own
   * three.js camera, placed from the replicated `G`; if replication is right
   * the two agree to rounding, and the overlay says by how much they do not.
   */
  private checkAim(q: Press): number {
    const v = this.views.get(q.view);
    if (!v || !q.ray) return NaN;
    const d = this.sim.projectionDistance;
    // View space looks down -Z; a crosshair pixel is (x, y) at depth d.
    const lx = q.x, ly = q.y, lz = -d;
    const wx = v[0] * lx + v[4] * ly + v[8] * lz;
    const wy = v[1] * lx + v[5] * ly + v[9] * lz;
    const wz = v[2] * lx + v[6] * ly + v[10] * lz;
    const n = Math.hypot(wx, wy, wz) || 1;
    const r = q.ray.dir;
    const m = Math.hypot(r.x, r.y, r.z) || 1;
    const cos = Math.min(1, Math.max(-1, (wx * r.x + wy * r.y + wz * r.z) / (n * m)));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    const off = Math.hypot(q.ray.origin.x - v[12], q.ray.origin.y - v[13],
                           q.ray.origin.z - v[14]);
    this.stats.aimError = deg;
    if ((deg > 0.05 || off > 0.5) && this.now - this.aimErrorAt > 1000) {
      this.aimErrorAt = this.now;
      this.log("aim", q.view, `player 2's shot is ${deg.toFixed(3)}° and `
        + `${off.toFixed(2)} units off the host's camera at that tick`);
    }
    return off > 0.5 ? Math.max(deg, 90) : deg;
  }

  /**
   * The session state, sent when it changes and once a second regardless --
   * and, while the host's clock is held, a tick of its own now and then.
   *
   * **A held clock still owes player 2 the state.** A keyframe that is due
   * -- player 2 has just loaded the stage the host moved to, or asked for one
   * -- goes at once rather than when the host next unpauses; and what changes
   * while it is paused (a debug kill, a rewind's landing) reaches player 2
   * within a quarter of a second. Such a tick is a sequence number and a
   * diff, like any other: nothing simulated, so nothing it carries is new
   * game time.
   */
  override poll(now: number): void {
    super.poll(now);
    if (this.closed || !this.peerHello) return;
    const simHold = this.sim.hold();
    if (this.phase === "streaming" && simHold !== null && simHold !== "loading"
        && (this.needKeyframe || now - this.lastTickAt >= HELD_TICK_MS)) {
      this.endTick(now);
    }
    const hold: HoldReason = this.phase === "loading" ? "loading" : simHold;
    const msg: SessionMsg = { epoch: this.epoch, hold, branch: this.sim.branch() };
    const key = JSON.stringify(msg);
    if (key !== this.lastSession || now - this.lastSessionAt >= 1000) {
      this.lastSession = key;
      this.lastSessionAt = now;
      this.sendCtrl(Msg.Session, msg);
    }
    this.stats.expectTicks = false;
    if (this.phase === "streaming") {
      this.stats.phase = hold ? `streaming (held: ${hold})` : "streaming";
      // The host expects the replica's input packets whenever it is connected.
      this.stats.expectTicks = true;
    }
  }
}
