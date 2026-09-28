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
import {
  StateTracker, TreeHasher, labelOf, type SectionSink,
} from "../../core/net/codec";
import {
  KEYFRAME_CHUNK, Msg, PressKind, decodeJson, readInput, writeKeyframeChunk,
  writeTickHead,
  type Channel, type DesyncMsg, type HoldReason, type LoadMsg, type Press,
  type ReadyMsg, type ResyncMsg, type SessionMsg,
} from "../../core/net/protocol";
import { NetPeer, type Identity } from "./peer";
import { Rate } from "./stats";
import type { Transport } from "./transport";

/** What the host needs of the player. */
export interface HostSim {
  /** The stage the player has loaded, in which mode, and whose exporter built it. */
  stage(): { stage: number; original: boolean; builder?: string };
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
/** Ticks of section hashes kept for answering a desync report. */
const SECTION_HISTORY = 240;
/** Keyframes are expensive; a replica that keeps asking gets one this often. */
const KEYFRAME_COOLDOWN_MS = 500;
/** A delta bigger than this goes on the reliable channel instead. */
const MAX_UNRELIABLE = 12 * 1024;
/** How long the host holds its clock for a replica that is loading. */
const LOAD_WAIT_MS = 45_000;
/** While the host's clock is held, a tick this often all the same. See `poll`. */
const HELD_TICK_MS = 250;

export class NetHost extends NetPeer {
  private epoch = 0;
  /** "hello", "loading" (the replica's), "streaming". */
  private phase: "hello" | "loading" | "streaming" = "hello";
  private tracker: StateTracker | null = null;
  private readonly hasher = new TreeHasher();
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
  /** Each tick's sections, as ids into {@link sectionNames} and their hashes. */
  private readonly sections = new Map<number, { ids: Int32Array; hashes: Uint32Array }>();
  private readonly sectionIds = new Map<string, number>();
  private readonly sectionNames: string[] = [];
  private readonly sectionScratch = { ids: [] as number[], hashes: [] as number[] };
  private readonly sectionSink: SectionSink = {
    add: (name, hash) => {
      let id = this.sectionIds.get(name);
      if (id === undefined) {
        id = this.sectionNames.length;
        this.sectionIds.set(name, id);
        this.sectionNames.push(name);
      }
      this.sectionScratch.ids.push(id);
      this.sectionScratch.hashes.push(hash);
    },
  };
  /** Section hashes each tick: what answers "which part differed". */
  trackSections = true;
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

  constructor(transport: Transport, me: Identity, private readonly sim: HostSim) {
    super(transport, me, "host");
    this.stats.phase = "waiting for player 2";
  }

  /** Whether the host should hold its clock: the replica is loading the stage. */
  get holding(): boolean {
    return this.phase === "loading" && !this.closed
      && this.now - this.loadSentAt < LOAD_WAIT_MS;
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
    this.views.clear();
    this.sections.clear();
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
   * After a tick: diff, hash, and send. `now` is the page's clock, for the
   * cost and the keyframe cooldown.
   */
  endTick(now: number): void {
    this.now = now;
    if (this.phase !== "streaming" || this.closed) {
      this.pending = [];
      return;
    }
    const t0 = performance.now();
    this.lastTickAt = now;
    this.tick++;
    const t = this.tick;
    if (!this.tracker) this.tracker = new StateTracker();
    const tracker = this.tracker;
    tracker.update(this.sim.liveRoot(), t);
    const scratch = this.sectionScratch;
    scratch.ids.length = 0;
    scratch.hashes.length = 0;
    const hash = this.hasher.hash(tracker.state,
                                  this.trackSections ? this.sectionSink : undefined);
    if (this.trackSections) {
      this.sections.set(t, { ids: Int32Array.from(scratch.ids),
                             hashes: Uint32Array.from(scratch.hashes) });
      this.sections.delete(t - SECTION_HISTORY);
    }
    if (this.pending.length) this.events.set(t, this.pending);
    this.pending = [];
    this.events.delete(t - EVENT_WINDOW - 1);
    this.views.set(t, this.sim.view().slice());
    this.views.delete(t - VIEW_HISTORY);

    // The base is the replica's newest ack -- or the keyframe in flight, which
    // the reliable channel will deliver, so a delta against it waits on the
    // replica's side until it lands rather than being lost.
    const base = Math.max(this.ack, this.keyframeAt);
    const canDelta = base >= 0 && tracker.covers(base);
    const cooled = now - this.keyframeSentAt >= KEYFRAME_COOLDOWN_MS;
    if ((this.needKeyframe || !canDelta) && (cooled || this.keyframeAt < 0)) {
      this.sendKeyframe(hash);
    } else if (canDelta) {
      this.sendDelta(base, hash);
    }
    this.stats.costMs = performance.now() - t0;
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

  private sendDelta(base: number, hash: number): void {
    const w = this.out;
    w.reset();
    writeTickHead(w, {
      epoch: this.epoch, seq: this.seq++, tick: this.tick, base,
      pressAck: this.pressHigh, hash, sentAt: this.now,
    });
    const info = this.tracker!.encodeDelta(base, w, this.writeEvents(base, this.tick));
    if (!info) {
      this.sendKeyframe(hash);
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

  private sendKeyframe(hash: number): void {
    const body = new ByteWriter(64 * 1024);
    // A keyframe carries no events: whatever they announced is in the state.
    this.tracker!.encodeKeyframe(body, (w) => w.uvar(0));
    const bytes = body.finish();
    const count = Math.max(1, Math.ceil(bytes.length / KEYFRAME_CHUNK));
    for (let i = 0; i < count; i++) {
      const w = new ByteWriter(KEYFRAME_CHUNK + 64);
      writeKeyframeChunk(w, {
        epoch: this.epoch, tick: this.tick, index: i, count, hash,
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
        for (const q of p.presses) {
          if (q.id <= this.pressHigh) continue;
          this.pressHigh = q.id;
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
        this.answerDesync(d);
        return;
      }
      default:
        this.log("decode", -1, `unexpected message ${Msg[m] ?? m} from player 2`);
    }
  }

  /** Which sections of the replica's state differed from the host's at that tick. */
  private answerDesync(d: DesyncMsg): void {
    const held = this.sections.get(d.tick);
    let differ: string[] = [];
    let note: string;
    if (!held) {
      note = `tick ${d.tick} is no longer held (${SECTION_HISTORY} are)`;
    } else {
      const mine = new Map<string, number>();
      for (let i = 0; i < held.ids.length; i++) {
        mine.set(this.sectionNames[held.ids[i]], held.hashes[i]);
      }
      const theirs = new Map(d.sections);
      for (const [k, h] of mine) if (theirs.get(k) !== h) differ.push(labelOf(k));
      for (const k of theirs.keys()) if (!mine.has(k)) differ.push(`${labelOf(k)} (replica only)`);
      note = differ.length ? `${differ.length} section(s) differ`
        : "every section agrees: the difference is in how the hash was taken";
    }
    differ = differ.slice(0, 24);
    this.log("report", d.tick, `desync: ${differ.join(", ") || note}`);
    this.sendCtrl(Msg.DesyncReport, { epoch: this.epoch, tick: d.tick, differ, note });
    this.needKeyframe = true;
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
