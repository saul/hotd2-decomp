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
import type { Transport, TransportInfo } from "./transport";

/** What travels through the rendezvous. */
type RtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: RTCIceCandidateInit | null }
  /** The replica asking the host to restart ICE. */
  | { kind: "restart" };

/** How long `disconnected` may last before ICE is restarted. */
const RESTART_AFTER_MS = 2500;
/** Restarts attempted before the link is given up. */
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
  readonly info: TransportInfo = {
    kind: "webrtc", state: "connecting", ice: "new", route: "", rtt: NaN, buffered: 0,
  };
  /** Sends dropped because `tick` was backed up. */
  dropped = 0;
  private readonly pc: RTCPeerConnection;
  private readonly ctrl: RTCDataChannel;
  private readonly tick: RTCDataChannel;
  private open = 0;
  private closed = false;
  private remoteSet = false;
  private readonly early: RTCIceCandidateInit[] = [];
  private restarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** The host's first offer has gone. */
  private offered = false;

  constructor(private readonly signal: SignalClient, opts: RtcOptions) {
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
      void this.say({ kind: "candidate", candidate: e.candidate?.toJSON() ?? null });
    };
    this.pc.oniceconnectionstatechange = () => this.iceChanged();
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" && this.restarts >= MAX_RESTARTS) {
        this.close("the connection failed and could not be restored");
      }
    };
    signal.onEvent = (e) => {
      if (e.t === "signal") void this.heard(e.data as RtcSignal);
      // `peer` is a state, repeated on every reconnect of the host's stream:
      // the first says offer, the rest say nothing new.
      else if (e.t === "peer" && e.joined && signal.role === "host" && !this.offered) {
        this.offered = true;
        void this.offer(false);
      } else if (e.t === "peer" && !e.joined) this.close("player 2 left");
      else if (e.t === "closed") this.close(e.reason);
    };
    signal.listen();
  }

  private async say(s: RtcSignal): Promise<void> {
    try {
      await this.signal.send(s);
    } catch (e) {
      // A candidate that could not be sent is one path fewer, not a failure.
      console.warn("netplay: rendezvous send failed", e);
    }
  }

  /** The host's offer: at first, and again with fresh ICE on a restart. */
  private async offer(restart: boolean): Promise<void> {
    if (this.closed) return;
    const offer = await this.pc.createOffer(restart ? { iceRestart: true } : undefined);
    await this.pc.setLocalDescription(offer);
    await this.say({ kind: "offer", sdp: offer.sdp ?? "" });
  }

  private async heard(s: RtcSignal): Promise<void> {
    if (this.closed) return;
    try {
      switch (s.kind) {
        case "offer": {
          await this.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
          this.remoteSet = true;
          await this.flushCandidates();
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          await this.say({ kind: "answer", sdp: answer.sdp ?? "" });
          return;
        }
        case "answer":
          await this.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
          this.remoteSet = true;
          await this.flushCandidates();
          return;
        case "candidate":
          if (!s.candidate) return;
          if (!this.remoteSet) this.early.push(s.candidate);
          else await this.pc.addIceCandidate(s.candidate);
          return;
        case "restart":
          if (this.signal.role === "host") this.restart();
          return;
      }
    } catch (e) {
      console.warn("netplay: signalling step failed", s.kind, e);
    }
  }

  private async flushCandidates(): Promise<void> {
    for (const c of this.early.splice(0)) {
      try { await this.pc.addIceCandidate(c); } catch { /* stale */ }
    }
  }

  private iceChanged(): void {
    const state = this.pc.iceConnectionState;
    this.info.ice = state;
    if (state === "connected" || state === "completed") {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
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
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
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
