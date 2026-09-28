/**
 * Two tabs of one browser, joined over a `BroadcastChannel`: the session with
 * no network at all. `?net=local-host` in one tab, `?net=local-join` in the
 * other. Add `&netsim=lat:80,jit:20,loss:5` to either to see what a bad link
 * does, without having one.
 *
 * It is the development and test transport, not a mode anyone plays in, and
 * it says so in the overlay's transport line.
 */
import type { Channel } from "../../core/net/protocol";
import type { Transport, TransportInfo } from "./transport";

type LocalMsg =
  | { type: "host-here"; from: string }
  | { type: "join"; from: string; to: string }
  | { type: "welcome"; from: string; to: string }
  | { type: "msg"; from: string; to: string; ch: Channel; data: ArrayBuffer }
  | { type: "bye"; from: string; to: string };

export class LocalTransport implements Transport {
  onMessage: (ch: Channel, data: Uint8Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (reason: string) => void = () => {};
  readonly info: TransportInfo = {
    kind: "local", state: "connecting", ice: "", route: "same browser", rtt: NaN, buffered: 0,
  };
  private readonly bc: BroadcastChannel;
  private readonly id = Math.random().toString(36).slice(2);
  private peer: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(readonly role: "host" | "replica", room = "default") {
    this.bc = new BroadcastChannel(`hotd2-net:${room}`);
    this.bc.onmessage = (e) => this.heard(e.data as LocalMsg);
    if (role === "host") {
      const announce = () => this.post({ type: "host-here", from: this.id });
      announce();
      this.timer = setInterval(() => { if (!this.peer) announce(); }, 400);
    }
  }

  private post(m: LocalMsg): void {
    if (!this.closed) this.bc.postMessage(m);
  }

  private heard(m: LocalMsg): void {
    if (this.closed || m.from === this.id) return;
    if (m.type === "host-here" && this.role === "replica" && !this.peer) {
      this.post({ type: "join", from: this.id, to: m.from });
      return;
    }
    if ("to" in m && m.to !== this.id) return;
    switch (m.type) {
      case "join":
        if (this.role !== "host" || this.peer) return;
        this.peer = m.from;
        this.post({ type: "welcome", from: this.id, to: m.from });
        this.opened();
        return;
      case "welcome":
        if (this.role !== "replica" || this.peer) return;
        this.peer = m.from;
        this.opened();
        return;
      case "msg":
        if (m.from === this.peer) this.onMessage(m.ch, new Uint8Array(m.data));
        return;
      case "bye":
        if (m.from === this.peer) this.close("the other tab left", false);
        return;
    }
  }

  private opened(): void {
    this.info.state = "open";
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onOpen();
  }

  send(ch: Channel, data: Uint8Array): void {
    if (!this.peer) return;
    // A copy the channel can take: the caller's buffer is reused.
    const copy = data.slice().buffer;
    this.post({ type: "msg", from: this.id, to: this.peer, ch, data: copy });
  }

  close(reason = "closed", tell = true): void {
    if (this.closed) return;
    if (tell && this.peer) this.post({ type: "bye", from: this.id, to: this.peer });
    this.closed = true;
    this.info.state = "closed";
    if (this.timer) clearInterval(this.timer);
    this.bc.close();
    this.onClose(reason);
  }
}
