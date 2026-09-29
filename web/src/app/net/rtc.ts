/**
 * The real transport: one `RTCPeerConnection`, two data channels on it.
 *
 * * `ctrl` -- ordered and reliable: the handshake, keyframes, session state.
 * * `tick` -- unordered, `maxRetransmits: 0`: deltas, input, pings. A
 *   retransmitted tick would arrive after the next one had superseded it.
 *
 * Both are created `negotiated` with fixed ids, so neither side waits for the
 * other to announce them. **The host is always the one that offers**, so
 * there is no glare to resolve: the replica only ever answers.
 *
 * NAT is ICE's job, and ICE is handed what the rendezvous handed out: STUN
 * for the ordinary case, TURN for the rest -- a phone on carrier-grade NAT,
 * a network that blocks UDP. `?relay=1` forces the relay, so the path that
 * only some players need can be tested by anyone. When the connection drops
 * -- a phone walking out of Wi-Fi range -- the host restarts ICE through the
 * rendezvous, which is why that stays open for the whole session.
 */
import type { Channel } from "../../core/net/protocol";
import type { SignalClient } from "./signal";
import type { IcePath, Transport, TransportInfo } from "./transport";

/** What travels through the rendezvous. */
type RtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: RTCIceCandidateInit | null }
  /** The replica asking the host to restart ICE. */
  | { kind: "restart" };

/** How long `disconnected` may last before ICE is restarted. */
const RESTART_AFTER_MS = 2500;
/**
 * Restarts attempted in a row before the link is given up. A restart that
 * reconnects gives the budget back: a phone that changes network twice an
 * hour is not failing.
 */
const MAX_RESTARTS = 4;
/** More than this queued on `tick` and a send is dropped: it would arrive stale. */
const TICK_BACKLOG = 256 * 1024;

export interface RtcOptions {
  /** `iceTransportPolicy: "relay"`: TURN or nothing. */
  relayOnly: boolean;
}

export class RtcTransport implements Transport {
  onMessage: (ch: Channel, data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (reason: string) => void = () => {};
  /** What ICE has to work with, for the lobby's account of a slow connect. */
  private readonly path: IcePath = {
    since: NaN, local: {}, remote: {}, localMdns: 0, remoteMdns: 0, pairs: 0, failed: 0,
    turn: 0, relayOnly: false,
  };
  readonly info: TransportInfo = {
    kind: "webrtc", state: "connecting", ice: "new", route: "", rtt: NaN, buffered: 0,
    path: this.path,
  };
  /** Sends dropped because `tick` was backed up. */
  dropped = 0;
  private readonly pc: RTCPeerConnection;
  private readonly ctrl: RTCDataChannel;
  private readonly tick: RTCDataChannel;
  private open = 0;
  private closed = false;
  /**
   * Candidates for a description not applied yet: before the first, or of
   * the next ICE generation while a restart's offer or answer is in flight.
   */
  private readonly early: RTCIceCandidateInit[] = [];
  /** The ICE username fragment of the remote description applied, or null. */
  private remoteUfrag: string | null = null;
  /**
   * Both directions of the rendezvous, in order. A POST is not awaited by the
   * next, so without the chain a small candidate overtakes the offer it
   * belongs to; and a step handled while the one before it is still awaiting
   * `setRemoteDescription` adds its candidate against the old description.
   */
  private outbox: Promise<void> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();
  private restarts = 0;
  private restartedAt = -Infinity;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** Which of player 2's joins this connection is for; null before the first. */
  private peerN: number | null = null;

  constructor(private readonly signal: SignalClient, opts: RtcOptions) {
    this.path.relayOnly = opts.relayOnly;
    this.path.turn = signal.iceServers.filter((s) =>
      [s.urls].flat().some((u) => /^turns?:/.test(u))).length;
    this.pc = new RTCPeerConnection({
      iceServers: signal.iceServers,
      iceTransportPolicy: opts.relayOnly ? "relay" : "all",
    });
    this.ctrl = this.pc.createDataChannel("ctrl", { negotiated: true, id: 0, ordered: true });
    this.tick = this.pc.createDataChannel("tick", {
      negotiated: true, id: 1, ordered: false, maxRetransmits: 0,
    });
    for (const [ch, dc] of [["ctrl", this.ctrl], ["tick", this.tick]] as const) {
      dc.binaryType = "arraybuffer";
      dc.onopen = () => {
        if (++this.open === 2) {
          this.info.state = "open";
          this.onOpen();
        }
      };
      dc.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.onMessage(ch, new Uint8Array(e.data));
      };
      dc.onclose = () => this.close(`${ch} channel closed`);
    }
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.tally(e.candidate.candidate, "local");
      void this.say({ kind: "candidate", candidate: e.candidate?.toJSON() ?? null });
    };
    this.pc.oniceconnectionstatechange = () => this.iceChanged();
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" && this.restarts >= MAX_RESTARTS) {
        this.close("the connection failed and could not be restored");
      }
    };
    signal.onEvent = (e) => {
      if (e.t === "signal") {
        const s = e.data as RtcSignal;
        this.inbox = this.inbox.then(() => this.heard(s));
      }
      else if (e.t === "peer") this.peerChanged(e.joined, e.n);
      else if (e.t === "closed") this.close(e.reason);
    };
    signal.listen();
    // Made after player 2 came in -- the host's next connection, once the
    // last one dropped -- there is no event coming: offer now.
    if (signal.role === "host" && signal.peer?.joined) {
      this.peerChanged(true, signal.peer.n);
    }
  }

  /**
   * Player 2's presence. `peer` is a state, repeated whenever the host's
   * stream reconnects, so the same join number again says nothing new; a new
   * one is player 2 back on a new connection, which this one is not, so it
   * closes and the session makes the one that is.
   */
  private peerChanged(joined: boolean, n: number): void {
    if (!joined) {
      this.close("player 2 left");
      return;
    }
    if (this.signal.role !== "host") return;
    if (this.peerN === null) {
      this.peerN = n;
      void this.offer(false);
    } else if (n !== this.peerN) {
      this.close("player 2 reconnected");
    }
  }

  private say(s: RtcSignal): Promise<void> {
    this.outbox = this.outbox.then(async () => {
      try {
        await this.signal.send(s);
      } catch (e) {
        // A candidate that could not be sent is one path fewer, not a failure.
        console.warn("netplay: rendezvous send failed", e);
      }
    });
    return this.outbox;
  }

  /** One candidate, counted by type, and whether its address is an mDNS name. */
  private tally(candidate: string, side: "local" | "remote"): void {
    const f = candidate.split(" ");
    const type = f[f.indexOf("typ") + 1] ?? "?";
    const m = this.path[side];
    m[type] = (m[type] ?? 0) + 1;
    if (type === "host" && /\.local$/i.test(f[4] ?? "")) {
      if (side === "local") this.path.localMdns++;
      else this.path.remoteMdns++;
    }
  }

  /** The host's offer: at first, and again with fresh ICE on a restart. */
  private async offer(restart: boolean): Promise<void> {
    if (this.closed) return;
    if (Number.isNaN(this.path.since)) this.path.since = performance.now();
    const offer = await this.pc.createOffer(restart ? { iceRestart: true } : undefined);
    await this.pc.setLocalDescription(offer);
    await this.say({ kind: "offer", sdp: offer.sdp ?? "" });
  }

  private async heard(s: RtcSignal): Promise<void> {
    if (this.closed) return;
    try {
      switch (s.kind) {
        case "offer": {
          if (Number.isNaN(this.path.since)) this.path.since = performance.now();
          await this.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
          await this.flushCandidates(s.sdp);
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          await this.say({ kind: "answer", sdp: answer.sdp ?? "" });
          return;
        }
        case "answer":
          await this.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
          await this.flushCandidates(s.sdp);
          return;
        case "candidate": {
          const c = s.candidate;
          if (!c) return;
          if (c.candidate) this.tally(c.candidate, "remote");
          const theirs = c.usernameFragment ?? null;
          if (this.remoteUfrag === null
              || (theirs !== null && this.remoteUfrag && theirs !== this.remoteUfrag)) {
            this.early.push(c);
            if (this.early.length > 64) this.early.shift();
          } else {
            await this.pc.addIceCandidate(c);
          }
          return;
        }
        case "restart":
          // Both ends usually see the drop together, so the host has often
          // restarted already by the time player 2's request lands. A second
          // offer over the first would leave each end with the other's wrong
          // credentials.
          if (this.signal.role !== "host") return;
          if (this.pc.signalingState !== "stable") return;
          if (performance.now() - this.restartedAt < RESTART_AFTER_MS) return;
          this.restart();
          return;
      }
    } catch (e) {
      console.warn("netplay: signalling step failed", s.kind, e);
    }
  }

  /**
   * A remote description is applied: the candidates held for it go in. Those
   * of another generation stay held -- a later one's, if they overtook it.
   */
  private async flushCandidates(sdp: string): Promise<void> {
    this.remoteUfrag = /^a=ice-ufrag:(\S+)/m.exec(sdp)?.[1] ?? "";
    const held = this.early.splice(0);
    for (const c of held) {
      const theirs = c.usernameFragment ?? null;
      if (theirs !== null && this.remoteUfrag && theirs !== this.remoteUfrag) {
        this.early.push(c);
        continue;
      }
      try { await this.pc.addIceCandidate(c); } catch { /* stale */ }
    }
  }

  private iceChanged(): void {
    const state = this.pc.iceConnectionState;
    this.info.ice = state;
    if (state === "connected" || state === "completed") {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.restarts = 0;
      return;
    }
    if (state === "failed") {
      this.restart();
    } else if (state === "disconnected" && !this.restartTimer) {
      // Often it comes back on its own within a second or two; only then
      // is a restart worth the renegotiation.
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.pc.iceConnectionState === "disconnected") this.restart();
      }, RESTART_AFTER_MS);
    }
  }

  /** The host restarts ICE; the replica asks it to. */
  private restart(): void {
    if (this.closed || this.restarts >= MAX_RESTARTS) return;
    this.restarts++;
    this.restartedAt = performance.now();
    if (this.signal.role === "host") {
      this.pc.restartIce();
      void this.offer(true);
    } else {
      void this.say({ kind: "restart" });
    }
  }

  send(ch: Channel, data: Uint8Array): void {
    const dc = ch === "ctrl" ? this.ctrl : this.tick;
    if (dc.readyState !== "open") return;
    if (ch === "tick" && dc.bufferedAmount > TICK_BACKLOG) {
      this.dropped++;
      return;
    }
    dc.send(data as unknown as ArrayBuffer);
  }

  /** The selected candidate pair: direct or relayed, and its round trip. */
  async poll(): Promise<void> {
    if (this.closed) return;
    this.info.buffered = this.tick.bufferedAmount;
    let stats: RTCStatsReport;
    try {
      stats = await this.pc.getStats();
    } catch {
      return;
    }
    let pairId: string | undefined;
    let pairs = 0, failed = 0;
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
      if (s.type === "candidate-pair") {
        pairs++;
        if ((s as RTCIceCandidatePairStats).state === "failed") failed++;
      }
    });
    this.path.pairs = pairs;
    this.path.failed = failed;
    let pair: RTCIceCandidatePairStats | undefined;
    stats.forEach((s) => {
      if (s.type !== "candidate-pair") return;
      const p = s as RTCIceCandidatePairStats;
      if (pairId ? p.id === pairId : p.nominated && p.state === "succeeded") pair = p;
    });
    if (!pair) return;
    this.info.rtt = pair.currentRoundTripTime !== undefined
      ? pair.currentRoundTripTime * 1000 : NaN;
    const local = stats.get(pair.localCandidateId) as
      { candidateType?: string; protocol?: string; relayProtocol?: string } | undefined;
    const remote = stats.get(pair.remoteCandidateId) as { candidateType?: string } | undefined;
    if (local) {
      const relay = local.candidateType === "relay"
        ? ` via TURN/${local.relayProtocol ?? "?"}` : "";
      this.info.route = `${local.candidateType ?? "?"}→${remote?.candidateType ?? "?"}`
        + ` ${local.protocol ?? ""}${relay}`;
    }
  }

  close(reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    this.info.state = "closed";
    if (this.restartTimer) clearTimeout(this.restartTimer);
    try { this.ctrl.close(); } catch { /* already */ }
    try { this.tick.close(); } catch { /* already */ }
    this.pc.close();
    this.onClose(reason);
  }
}
