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
  /** WebRTC's search for a path, where there is one. See {@link describePath}. */
  path?: IcePath;
}

/**
 * What ICE had to work with and how it fared: every address each end offered,
 * by type, and the candidate pairs tried. A connection that never opens is
 * almost always explained by these counts, so the page shows them rather
 * than "connecting" for ever.
 */
export interface IcePath {
  /** When the search began (the offer), on the page's clock; NaN before. */
  since: number;
  /** Candidates by type -- host, srflx, prflx, relay -- this end found and the other end sent. */
  local: Record<string, number>;
  remote: Record<string, number>;
  /** Host candidates hidden behind an mDNS `.local` name, each side. */
  localMdns: number;
  remoteMdns: number;
  /** Candidate pairs ICE has formed, and how many of them failed. */
  pairs: number;
  failed: number;
  /** TURN servers the rendezvous handed out, and whether only they may be used. */
  turn: number;
  relayOnly: boolean;
}

/** How long a search runs before the page offers a reason it has not finished. */
export const PATH_HINT_MS = 8000;

/**
 * The search, in a line, and -- once it has run long enough to be stuck --
 * the likeliest reason it has not found a path, in the order the causes
 * would show. Pure, so the headless UI test can hold it to its words.
 */
export function describePath(p: IcePath, ice: string, now: number): { line: string; hint: string | null } {
  const kinds = (m: Record<string, number>, mdns: number): string => {
    const parts = Object.entries(m).filter(([, n]) => n > 0)
      .map(([k, n]) => (k === "host" && mdns ? `${n} host (${mdns} hidden as .local)` : `${n} ${k}`));
    return parts.length ? parts.join(", ") : "nothing yet";
  };
  const secs = Number.isNaN(p.since) ? 0 : Math.max(0, now - p.since) / 1000;
  const line = `ICE ${ice || "new"} for ${secs.toFixed(0)} s · this end offered ${kinds(p.local, p.localMdns)}`
    + ` · the other ${kinds(p.remote, p.remoteMdns)}`
    + ` · ${p.pairs} pair${p.pairs === 1 ? "" : "s"} tried, ${p.failed} failed`;
  if (Number.isNaN(p.since) || now - p.since < PATH_HINT_MS
      || ice === "connected" || ice === "completed") {
    return { line, hint: null };
  }
  const count = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  let hint: string;
  if (count(p.remote) === 0) {
    hint = "Nothing has arrived from the other end. The rendezvous carries each end's "
      + "addresses; if none come through, the two pages are not using the same one "
      + "(compare their ?signal=), or it is not relaying.";
  } else if (p.relayOnly && !p.local.relay) {
    hint = "?relay=1 allows only a TURN relay, and the rendezvous handed out no TURN server.";
  } else if (!p.local.srflx && !p.local.relay) {
    hint = "This end reached no STUN server, so it knows only its own local address: "
      + "a firewall is blocking outgoing UDP.";
  } else {
    hint = "No path between the two ends works. On one network, browsers hide each "
      + "device's address behind a .local name, and resolving it needs multicast -- on "
      + "a Mac, allow the browser in System Settings → Privacy & Security → Local "
      + "Network. Between networks, a strict NAT, or a router that will not route to "
      + `its own address, needs a TURN relay${p.turn ? "" : ", and this rendezvous has none"} `
      + "(web/tools/signal/README.md). Two tabs of one browser pair without WebRTC "
      + "unless ?rtc=1 is set.";
  }
  return { line, hint };
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

/**
 * Several ways to the same peer, tried at once. The first to open is the
 * link and the rest are closed; until one opens, {@link info} is the first
 * way's, which is the one worth watching (WebRTC's ICE state).
 *
 * Before one has opened, any way closing closes them all. A way that gives
 * up is saying something the session must hear -- WebRTC closes when player
 * 2 comes back on a new connection, and the session answers by making a new
 * one -- and a race left running on the other ways would swallow it.
 */
export class FirstOpen implements Transport {
  onMessage: (ch: Channel, data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (reason: string) => void = () => {};
  private winner: Transport | null = null;
  private closed = false;

  constructor(private readonly ways: readonly Transport[]) {
    for (const t of ways) {
      t.onOpen = () => {
        if (this.winner || this.closed) return;
        this.winner = t;
        for (const o of ways) if (o !== t) o.close("another way connected first");
        this.onOpen();
      };
      t.onMessage = (ch, d) => {
        if (t === this.winner) this.onMessage(ch, d);
      };
      t.onClose = (reason) => {
        if (this.closed) return;
        if (this.winner && t !== this.winner) return;
        this.close(reason);
      };
    }
  }

  get info(): TransportInfo {
    return (this.winner ?? this.ways[0]).info;
  }

  poll(): Promise<void> {
    const t = this.winner ?? this.ways[0];
    return t.poll?.() ?? Promise.resolve();
  }

  send(ch: Channel, data: Uint8Array): void {
    this.winner?.send(ch, data);
  }

  close(reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.ways) t.close(reason);
    this.onClose(reason);
  }
}
