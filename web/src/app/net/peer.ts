/**
 * What both ends of a session share: the transport, the handshake, the pings,
 * the once-a-second link report, and the statistics they feed.
 *
 * `host.ts` and `replica.ts` extend it with the half that differs. Nothing
 * here touches the DOM or the player: a peer is driven by its owner calling
 * {@link NetPeer.poll} with a clock, which is what lets the headless test run
 * the real session code on a simulated link and a simulated clock.
 */
import { ByteReader, ByteWriter } from "../../core/net/bytes";
import {
  Msg, PROTOCOL, channelOf, decodeJson, encodeJson, readPing, writePing,
  type Channel, type HelloMsg, type LinkStatsMsg,
} from "../../core/net/protocol";
import { LossCounter, Rate, Rtt, emptyStats, pushLog, type NetStats }
  from "./stats";
import type { Transport } from "./transport";

/** How often each end pings. Four a second keeps the round trip current. */
const PING_MS = 250;
/** How often each end reports what it has seen. */
const REPORT_MS = 1000;

/** What a peer says about itself in the handshake, minus the fixed fields. */
export type Identity = Omit<HelloMsg, "protocol" | "role">;

/**
 * Why two peers cannot play together, or null if they can.
 *
 * Refused outright rather than tolerated: the replica applies deltas to state
 * whose shape is its own build's, and a different build, a different snapshot
 * version or a bundle from a different exporter is a crash that looks like a
 * render bug -- the same argument `snapshotRefusal` makes for a save file.
 */
export function helloRefusal(mine: HelloMsg, theirs: HelloMsg): string | null {
  if (theirs.protocol !== mine.protocol) {
    return `protocol ${theirs.protocol} against this page's ${mine.protocol}`;
  }
  if (theirs.role === mine.role) return `both ends are ${mine.role}s`;
  if (theirs.snapshot !== mine.snapshot) {
    return `snapshot version ${theirs.snapshot} against ${mine.snapshot}: `
      + "the two pages are different builds";
  }
  if (theirs.build !== mine.build) {
    return `build ${theirs.build} against ${mine.build}: reload both pages `
      + "from the same site";
  }
  if (theirs.schema !== mine.schema) {
    return `bundle schema ${theirs.schema.slice(0, 8)} against `
      + `${mine.schema.slice(0, 8)}: rebuild one bundle`;
  }
  if (theirs.bundle !== mine.bundle) {
    return `bundle exporter ${theirs.bundle.slice(0, 8)} against `
      + `${mine.bundle.slice(0, 8)}: both players need the same bundle`;
  }
  return null;
}

export abstract class NetPeer {
  readonly stats: NetStats;
  protected readonly w = new ByteWriter(2048);
  private pingId = 0;
  private lastPing = -Infinity;
  private lastReport = -Infinity;
  protected readonly rtt = new Rtt();
  protected readonly lossIn = new LossCounter();
  private reportedLoss = { received: 0, lost: 0 };
  protected readonly bytesIn = new Rate();
  protected readonly bytesOut = new Rate();
  protected readonly pktIn = new Rate();
  protected readonly pktOut = new Rate();
  /** When the last `tick`-channel packet from the peer arrived. */
  protected lastArrival = -1;
  protected now = 0;
  protected helloSent = false;
  protected peerHello: HelloMsg | null = null;
  protected closed = false;

  constructor(protected readonly transport: Transport,
              protected readonly me: Identity,
              readonly role: "host" | "replica") {
    this.stats = emptyStats(role);
    transport.onMessage = (ch, data) => this.receive(ch, data);
    transport.onOpen = () => this.sendHello();
    transport.onClose = (reason) => this.gone(reason);
  }

  /** The handshake's fixed half, and this peer's. */
  protected hello(): HelloMsg {
    return { protocol: PROTOCOL, role: this.role, ...this.me };
  }

  sendHello(): void {
    if (this.helloSent || this.closed) return;
    this.helloSent = true;
    this.stats.phase = "handshake";
    this.sendCtrl(Msg.Hello, this.hello());
  }

  protected sendCtrl(m: Msg, body: unknown): void {
    this.send("ctrl", encodeJson(m, body));
  }

  protected send(ch: Channel, data: Uint8Array): void {
    if (this.closed) return;
    this.transport.send(ch, data);
    if (ch === "tick") {
      this.bytesOut.add(data.length);
      this.pktOut.add();
    }
  }

  private receive(ch: Channel, data: Uint8Array): void {
    if (this.closed || data.length === 0) return;
    const m = data[0] as Msg;
    if (channelOf(m) !== ch && m !== Msg.Tick) {
      this.problem(`message ${m} arrived on ${ch}`);
      return;
    }
    if (ch === "tick") {
      this.bytesIn.add(data.length);
      this.pktIn.add();
      this.lastArrival = this.now;
    }
    try {
      switch (m) {
        case Msg.Ping: {
          const p = readPing(new ByteReader(data));
          this.w.reset();
          writePing(this.w, Msg.Pong, p);
          this.send("tick", this.w.finish());
          return;
        }
        case Msg.Pong: {
          const p = readPing(new ByteReader(data));
          if (p.id <= this.pingId) this.rtt.add(this.now - p.sentAt, this.now);
          return;
        }
        case Msg.Stats: {
          const s = decodeJson<LinkStatsMsg>(data);
          const sent = s.received + s.lost;
          this.stats.lossOut = sent > 0 ? (100 * s.lost) / sent : 0;
          return;
        }
        case Msg.Hello: {
          const theirs = decodeJson<HelloMsg>(data);
          const why = helloRefusal(this.hello(), theirs);
          if (why) {
            this.problem(`refused: ${why}`);
            this.sendCtrl(Msg.Bye, { reason: why });
            this.close(why);
            return;
          }
          this.peerHello = theirs;
          this.sendHello();
          this.onHello();
          return;
        }
        case Msg.Bye: {
          const b = decodeJson<{ reason: string }>(data);
          this.problem(`the other end left: ${b.reason}`);
          this.close(b.reason, false);
          return;
        }
        default:
          this.handle(m, ch, data);
      }
    } catch (e) {
      this.log("decode", -1, `message ${Msg[m] ?? m}: ${(e as Error).message}`);
    }
  }

  /** The role's own messages. */
  protected abstract handle(m: Msg, ch: Channel, data: Uint8Array): void;
  /** The peer's hello was accepted. */
  protected abstract onHello(): void;

  /**
   * The clock, once a frame and on a timer while the page sleeps: pings, the
   * link report, and the statistics the overlay reads.
   */
  poll(now: number): void {
    this.now = now;
    if (this.closed) return;
    if (now - this.lastPing >= PING_MS) {
      this.lastPing = now;
      this.w.reset();
      writePing(this.w, Msg.Ping, { id: ++this.pingId, sentAt: now });
      this.send("tick", this.w.finish());
    }
    if (now - this.lastReport >= REPORT_MS) {
      this.lastReport = now;
      const received = this.lossIn.received - this.reportedLoss.received;
      const lost = this.lossIn.lost - this.reportedLoss.lost;
      this.reportedLoss = { received: this.lossIn.received, lost: this.lossIn.lost };
      const report: LinkStatsMsg = { received, lost, bytes: Math.round(this.bytesIn.sample(now)) };
      this.sendCtrl(Msg.Stats, report);
      this.stats.lossIn = received + lost > 0 ? (100 * lost) / (received + lost) : 0;
      void this.transport.poll?.();
    }
    const s = this.stats;
    const info = this.transport.info;
    s.transport = info.kind;
    s.route = info.route;
    s.ice = info.ice || info.state;
    s.iceRtt = info.rtt;
    s.rtt = this.rtt.smoothed;
    s.rttMin = this.rtt.min === Infinity ? NaN : this.rtt.min;
    s.rttMax = this.rtt.max;
    s.kbIn = this.bytesIn.sample(now) / 1024;
    s.kbOut = this.bytesOut.sample(now) / 1024;
    s.pktIn = this.pktIn.sample(now);
    s.pktOut = this.pktOut.sample(now);
    s.silence = this.lastArrival < 0 ? 0 : now - this.lastArrival;
  }

  protected problem(text: string): void {
    this.stats.problem = text;
  }

  protected log(kind: NetStats["log"][number]["kind"], tick: number, text: string): void {
    pushLog(this.stats.log, { at: this.now, tick, kind, text });
  }

  private gone(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stats.phase = "closed";
    if (!this.stats.problem) this.problem(`link closed: ${reason}`);
    this.onClosed(reason);
  }

  /** Leave: tell the peer, when there is still a link to tell it on. */
  close(reason = "left", tell = true): void {
    if (this.closed) return;
    if (tell) {
      try { this.sendCtrl(Msg.Bye, { reason }); } catch { /* already gone */ }
    }
    this.closed = true;
    this.stats.phase = "closed";
    this.transport.close(reason);
    this.onClosed(reason);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  protected onClosed(_reason: string): void {}
}
