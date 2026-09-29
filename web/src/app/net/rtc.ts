/**
 * The real transport: one `RTCPeerConnection`, two data channels on it.
 *
 * * `ctrl` -- ordered and reliable: the handshake, keyframes, session state.
 * * `tick` -- unordered, `maxRetransmits: 0`: deltas, input, pings. A
 *   retransmitted tick would arrive after the next one had superseded it.
 *
 * Both are created `negotiated` with fixed ids, so neither side waits for the
 * other to announce them.
 *
 * **Connecting is one message each way, through the matchmaker**
 * (`matchmaker.ts`): the host gathers every candidate it has -- its LAN
 * address (an mDNS name, in Chrome), its public address as STUN saw it, its
 * relay address on the TURN server -- and posts them in its offer; player 2
 * does the same in its answer. ICE then tries the pairs and takes the first
 * that works, the relay at worst. `?relay=1` allows only the relay, so the
 * path some players need can be tried by anyone.
 *
 * No reconnecting: a link that fails is closed, and the session with it.
 */
import type { Channel } from "../../core/net/protocol";
import type { MatchClient } from "./matchmaker";
import type { IcePath, Transport, TransportInfo } from "./transport";

/** The longest gathering is waited for; what it has found by then goes. */
const GATHER_MS = 5000;
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
  private readonly pc: RTCPeerConnection;
  private readonly ctrl: RTCDataChannel;
  private readonly tick: RTCDataChannel;
  private open = 0;
  private closed = false;

  constructor(private readonly match: MatchClient, opts: RtcOptions) {
    this.path.relayOnly = opts.relayOnly;
    this.path.turn = match.iceServers.filter((s) =>
      [s.urls].flat().some((u) => /^turns?:/.test(u))).length;
    this.pc = new RTCPeerConnection({
      iceServers: match.iceServers,
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
    };
    this.pc.oniceconnectionstatechange = () => {
      this.info.ice = this.pc.iceConnectionState;
      if (this.pc.iceConnectionState === "failed") {
        this.close("no path between the two ends worked");
      }
    };
    void (match.role === "host" ? this.offer() : this.answer())
      .catch((e: Error) => this.close(`could not connect: ${e.message}`));
  }

  /** The host: its offer to the matchmaker, then player 2's answer back, whenever player 2 comes. */
  private async offer(): Promise<void> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.match.postOffer(await this.gathered());
    const answer = await this.match.waitAnswer();
    if (this.closed) return;
    this.remote(answer);
    await this.pc.setRemoteDescription({ type: "answer", sdp: answer });
  }

  /** Player 2: the host's offer, and its answer back. */
  private async answer(): Promise<void> {
    const offer = await this.match.waitOffer();
    if (this.closed) return;
    this.remote(offer);
    await this.pc.setRemoteDescription({ type: "offer", sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.match.postAnswer(await this.gathered());
  }

  /** The local description once gathering is done -- or has run {@link GATHER_MS}. */
  private async gathered(): Promise<string> {
    if (this.pc.iceGatheringState !== "complete") {
      await new Promise<void>((resolve) => {
        const done = () => {
          if (this.pc.iceGatheringState !== "complete") return;
          clearTimeout(timer);
          this.pc.removeEventListener("icegatheringstatechange", done);
          resolve();
        };
        const timer = setTimeout(() => {
          this.pc.removeEventListener("icegatheringstatechange", done);
          resolve();
        }, GATHER_MS);
        this.pc.addEventListener("icegatheringstatechange", done);
      });
    }
    return this.pc.localDescription?.sdp ?? "";
  }

  /** The other end's description arrived: the search begins, and its candidates are counted. */
  private remote(sdp: string): void {
    this.path.since = performance.now();
    for (const line of sdp.split(/\r?\n/)) {
      if (line.startsWith("a=candidate:")) this.tally(line.slice(2), "remote");
    }
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

  send(ch: Channel, data: Uint8Array): void {
    const dc = ch === "ctrl" ? this.ctrl : this.tick;
    if (dc.readyState !== "open") return;
    if (ch === "tick" && dc.bufferedAmount > TICK_BACKLOG) return;
    dc.send(data as unknown as ArrayBuffer);
  }

  /** The candidate pair in use -- direct or relayed -- its round trip, and how the pairs fared. */
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
    try { this.ctrl.close(); } catch { /* already */ }
    try { this.tick.close(); } catch { /* already */ }
    this.pc.close();
    this.onClose(reason);
  }
}
