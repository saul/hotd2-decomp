/**
 * The two channels a session runs over, whatever carries them.
 *
 * A {@link Transport} is a pair of message channels to one peer: `ctrl`,
 * reliable and ordered, and `tick`, which may drop and reorder. WebRTC is the
 * real one (`rtc.ts`); `local.ts` pairs two tabs of one browser, and
 * {@link MemoryLink} pairs two objects in one process for the tests. The
 * session code above them cannot tell which it has, which is the point: the
 * headless test exercises exactly the code the page runs.
 *
 * {@link SimLink} wraps any of them to add latency, jitter and loss on the way
 * out -- `?netsim=lat:80,jit:20,loss:5` -- so what the session does on a bad
 * link can be seen on a good one.
 */
import type { Channel } from "../../core/net/protocol";

export interface TransportInfo {
  /** What kind of link: `webrtc`, `local`, `memory`. */
  kind: string;
  /** `connecting`, `open`, `closed`. */
  state: string;
  /** ICE's connection state, where there is ICE. */
  ice: string;
  /** The selected candidate pair's local type: host, srflx, prflx, relay. */
  route: string;
  /** Round trip ICE measured on the selected pair, ms, or NaN. */
  rtt: number;
  /** Bytes queued on `tick` and not yet sent. */
  buffered: number;
}

export interface Transport {
  send(ch: Channel, data: Uint8Array): void;
  /** Set by the session; called for every message that arrives. */
  onMessage: (ch: Channel, data: Uint8Array) => void;
  /** Called once when both channels are open. */
  onOpen: () => void;
  /** Called once when the link is gone for good. */
  onClose: (reason: string) => void;
  readonly info: TransportInfo;
  /** Refresh {@link info} from the platform's statistics, where it has any. */
  poll?(): Promise<void>;
  close(reason?: string): void;
}

/**
 * Two transports joined back to back in one process, for the tests.
 *
 * Nothing is delivered until {@link deliver} is called with a clock, so a test
 * decides exactly what has arrived when; `tick` messages can be dropped and
 * held back at random, `ctrl` ones never.
 */
export class MemoryLink {
  readonly a: MemoryEnd;
  readonly b: MemoryEnd;
  private readonly queue: { to: MemoryEnd; ch: Channel; data: Uint8Array; at: number; seq: number }[] = [];
  private seq = 0;
  /** Loss and delay on `tick`, and delay on `ctrl`, both ways. */
  loss = 0;
  latency = 0;
  jitter = 0;
  private random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.a = new MemoryEnd(this, "a");
    this.b = new MemoryEnd(this, "b");
  }

  /** Called by an end: schedule `data` for the other end. */
  enqueue(from: MemoryEnd, ch: Channel, data: Uint8Array, now: number): void {
    const to = from === this.a ? this.b : this.a;
    if (to.closed) return;
    if (ch === "tick" && this.random() < this.loss) return;
    const delay = this.latency + (ch === "tick" ? this.random() * this.jitter : 0);
    this.queue.push({ to, ch, data: data.slice(), at: now + delay, seq: this.seq++ });
  }

  /** Hand over everything due by `now`. `ctrl` keeps its order; `tick` need not. */
  deliver(now: number): void {
    this.queue.sort((x, y) => x.at - y.at || x.seq - y.seq);
    // `ctrl` is ordered: nothing on it may overtake an earlier ctrl message.
    let ctrlFloor = -Infinity;
    const due: typeof this.queue = [];
    const keep: typeof this.queue = [];
    for (const m of this.queue) {
      if (m.ch === "ctrl") {
        const at = Math.max(m.at, ctrlFloor);
        ctrlFloor = at;
        (at <= now ? due : keep).push(m);
      } else {
        (m.at <= now ? due : keep).push(m);
      }
    }
    this.queue.length = 0;
    this.queue.push(...keep);
    for (const m of due) if (!m.to.closed) m.to.onMessage(m.ch, m.data);
  }

  open(): void {
    this.a.onOpen();
    this.b.onOpen();
  }
}

export class MemoryEnd implements Transport {
  onMessage: (ch: Channel, data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (reason: string) => void = () => {};
  closed = false;
  /** The test's clock, which it sets before a session acts. */
  now = 0;
  readonly info: TransportInfo = {
    kind: "memory", state: "open", ice: "", route: "", rtt: NaN, buffered: 0,
  };

  constructor(private readonly link: MemoryLink, readonly name: string) {}

  send(ch: Channel, data: Uint8Array): void {
    if (!this.closed) this.link.enqueue(this, ch, data, this.now);
  }

  close(reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    this.info.state = "closed";
    const other = this === this.link.a ? this.link.b : this.link.a;
    if (!other.closed) {
      other.closed = true;
      other.info.state = "closed";
      other.onClose(`peer: ${reason}`);
    }
    this.onClose(reason);
  }
}

/** `?netsim=lat:80,jit:20,loss:5` -- milliseconds, milliseconds, percent. */
export interface SimSettings {
  latency: number;
  jitter: number;
  loss: number;
}

export function parseSim(s: string | null): SimSettings | null {
  if (!s) return null;
  const out: SimSettings = { latency: 0, jitter: 0, loss: 0 };
  for (const part of s.split(",")) {
    const [k, v] = part.split(":");
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    if (k === "lat" || k === "latency") out.latency = n;
    else if (k === "jit" || k === "jitter") out.jitter = n;
    else if (k === "loss") out.loss = Math.min(100, n);
  }
  return out;
}

/**
 * A worse link than the one underneath, on the way out: every message is held
 * for the latency (and `tick` ones for a random share of the jitter on top,
 * which reorders them), and `tick` messages are dropped at the loss rate.
 * `ctrl` is delayed in order and never dropped, because the real `ctrl` is
 * reliable and a test of the session should not be a test of that.
 */
export class SimLink implements Transport {
  onMessage: (ch: Channel, data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (reason: string) => void = () => {};
  private ctrlAt = 0;

  constructor(private readonly inner: Transport, public sim: SimSettings) {
    inner.onMessage = (ch, d) => this.onMessage(ch, d);
    inner.onOpen = () => this.onOpen();
    inner.onClose = (r) => this.onClose(r);
  }

  get info(): TransportInfo {
    const i = this.inner.info;
    return { ...i, kind: `${i.kind}+sim(${this.sim.latency}±${this.sim.jitter}ms `
      + `${this.sim.loss}%)` };
  }

  poll(): Promise<void> {
    return this.inner.poll?.() ?? Promise.resolve();
  }

  send(ch: Channel, data: Uint8Array): void {
    const { latency, jitter, loss } = this.sim;
    if (ch === "tick" && Math.random() * 100 < loss) return;
    const now = performance.now();
    let at = now + latency + (ch === "tick" ? Math.random() * jitter : 0);
    if (ch === "ctrl") {
      at = Math.max(at, this.ctrlAt);
      this.ctrlAt = at;
    }
    const copy = data.slice();
    setTimeout(() => this.inner.send(ch, copy), Math.max(0, at - now));
  }

  close(reason?: string): void {
    this.inner.close(reason);
  }
}
