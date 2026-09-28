/**
 * What the link has been doing, measured where it can be seen: packets and
 * bytes each way, loss by sequence gaps, round trips, the arrival jitter, and
 * how long since anything arrived.
 *
 * Plain numbers throughout, so {@link NetStats} can go into the projection as
 * it is. Every counter is over a sliding second unless its name says total.
 */

/** Counts over the last second, sampled once a second. */
export class Rate {
  private acc = 0;
  private last = 0;
  private since = -1;

  add(n = 1): void {
    this.acc += n;
  }

  /** Roll the window if a second has passed. Returns the last full second's count. */
  sample(now: number): number {
    if (this.since < 0) this.since = now;
    if (now - this.since >= 1000) {
      const secs = (now - this.since) / 1000;
      this.last = this.acc / secs;
      this.acc = 0;
      this.since = now;
    }
    return this.last;
  }
}

/**
 * Loss on an unordered channel, by sequence number.
 *
 * A packet counts as lost once it is `REORDER` packets behind the newest seen
 * and still missing -- a reorder that deep is as good as a loss to a 60 Hz
 * stream anyway. Counts are totals; the caller differences them per second.
 */
export class LossCounter {
  static readonly REORDER = 30;
  private highest = -1;
  private readonly seen = new Set<number>();
  /** Every seq below this has been counted one way or the other. */
  private settled = 0;
  received = 0;
  lost = 0;
  /** Arrivals that were already counted lost, or duplicates. */
  late = 0;

  record(seq: number): void {
    if (seq < this.settled || this.seen.has(seq)) {
      this.late++;
      return;
    }
    this.received++;
    this.seen.add(seq);
    if (seq > this.highest) this.highest = seq;
    const cut = this.highest - LossCounter.REORDER;
    while (this.settled <= cut) {
      if (!this.seen.delete(this.settled)) this.lost++;
      this.settled++;
    }
  }

  /** A new epoch restarts the sequence. */
  reset(): void {
    this.highest = -1;
    this.seen.clear();
    this.settled = 0;
  }
}

/** Round trips, from pings. */
export class Rtt {
  last = NaN;
  smoothed = NaN;
  min = Infinity;
  max = 0;
  private windowMax = 0;
  private windowAt = -1;

  add(ms: number, now: number): void {
    this.last = ms;
    this.smoothed = Number.isNaN(this.smoothed) ? ms : this.smoothed * 0.875 + ms * 0.125;
    if (ms < this.min) this.min = ms;
    if (this.windowAt < 0 || now - this.windowAt > 5000) {
      this.max = this.windowMax;
      this.windowMax = 0;
      this.windowAt = now;
    }
    if (ms > this.windowMax) this.windowMax = ms;
    if (ms > this.max) this.max = ms;
  }
}

/**
 * Arrival jitter: how much later than its best a packet arrives, measured
 * against the sender's own clock so the unknown offset between the two
 * clocks cancels. The spread (p95 minus min over the last two seconds) is
 * what the jitter buffer has to cover.
 */
export class Jitter {
  private readonly samples: { at: number; transit: number }[] = [];

  add(sentAt: number, arrivedAt: number): void {
    this.samples.push({ at: arrivedAt, transit: arrivedAt - sentAt });
    while (this.samples.length && arrivedAt - this.samples[0].at > 2000) {
      this.samples.shift();
    }
  }

  /** Milliseconds between the fastest and the 95th-percentile arrival. */
  spread(): number {
    if (this.samples.length < 4) return 0;
    const ts = this.samples.map((s) => s.transit).sort((a, b) => a - b);
    return ts[Math.floor(ts.length * 0.95)] - ts[0];
  }

  reset(): void {
    this.samples.length = 0;
  }
}

/** One line of the desync log. */
export interface DesyncEntry {
  /** Wall time, for "12 s ago". */
  at: number;
  tick: number;
  kind: "hash" | "apply" | "decode" | "keyframe" | "report" | "aim";
  text: string;
}

/**
 * Everything the overlay shows, as plain data. Both roles fill the fields
 * that mean something for them and leave the rest at their defaults.
 */
export interface NetStats {
  role: "host" | "replica";
  /** Connecting, handshaking, loading, streaming, held, closed. */
  phase: string;
  /** A sentence when something is wrong: a refused handshake, a closed link. */
  problem: string | null;
  transport: string;
  /** `host`, `srflx`, `prflx` or `relay` for the selected pair, when known. */
  route: string;
  /** ICE's view: new, checking, connected, disconnected, failed, closed. */
  ice: string;
  rtt: number;
  rttMin: number;
  rttMax: number;
  /** ICE's own round trip for the selected pair, when the transport has one. */
  iceRtt: number;
  /** Percent lost on `tick`, inbound (seen here) and outbound (reported by the peer). */
  lossIn: number;
  lossOut: number;
  kbIn: number;
  kbOut: number;
  pktIn: number;
  pktOut: number;
  /** Milliseconds since the last packet on `tick` arrived. */
  silence: number;
  /** Whether the peer is expected to be sending right now. */
  expectTicks: boolean;
  epoch: number;
  /** Host: its tick. Replica: the tick it shows. */
  tick: number;
  /** Host: ticks since the replica's newest ack. Replica: ticks it is behind the newest received. */
  lag: number;
  /** Replica: the jitter buffer's depth, and the depth it is aiming for. */
  depth: number;
  target: number;
  jitter: number;
  underruns: number;
  skips: number;
  /** Mean bytes of a delta over the last second, and of the last keyframe. */
  deltaBytes: number;
  keyframeBytes: number;
  keyframes: number;
  /** Replica: ticks verified by hash, total; and those that failed. */
  verified: number;
  mismatches: number;
  applyErrors: number;
  /**
   * Replica: checks, a few a second, that found the page's systems holding
   * a different state from the one applied -- a `load` that does not take
   * what it is handed. The host cannot see these; see `DEEP_EVERY`.
   */
  liveMismatches: number;
  /** Replica: whether its state is known to differ from the host's right now. */
  desynced: boolean;
  /** Host: the per-tick cost of tracking, in ms. Replica: of applying and hashing. */
  costMs: number;
  /** Host: player 2's last shot, checked against the host's own camera: degrees off. */
  aimError: number;
  /** Presses sent (replica) or applied (host), total. */
  presses: number;
  log: DesyncEntry[];
}

export function emptyStats(role: "host" | "replica"): NetStats {
  return {
    role, phase: "idle", problem: null, transport: "", route: "", ice: "",
    rtt: NaN, rttMin: NaN, rttMax: NaN, iceRtt: NaN, lossIn: 0, lossOut: 0,
    kbIn: 0, kbOut: 0, pktIn: 0, pktOut: 0, silence: 0, expectTicks: false,
    epoch: 0, tick: 0, lag: 0, depth: 0, target: 0, jitter: 0, underruns: 0,
    skips: 0, deltaBytes: 0, keyframeBytes: 0, keyframes: 0, verified: 0,
    mismatches: 0, applyErrors: 0, liveMismatches: 0, desynced: false, costMs: 0, aimError: NaN,
    presses: 0, log: [],
  };
}

/** Keep the log short; the newest last. */
export function pushLog(log: DesyncEntry[], e: DesyncEntry, max = 12): void {
  log.push(e);
  if (log.length > max) log.splice(0, log.length - max);
}
