/**
 * Two tabs of one browser, joined over a `BroadcastChannel`: the session with
 * no network at all. `?net=local-host` in one tab, `?net=local-join` in the
 * other. Add `&netsim=lat:80,jit:20,loss:5` to either to see what a bad link
 * does, without having one.
 *
 * **An online room takes this path too when both players are in one
 * browser** (`session.ts`): the host listens here beside WebRTC, and a join
 * looks here first ({@link LocalTransport.find}). Two tabs on one machine are
 * the case WebRTC is worst at -- Chrome hides each end's address behind an
 * mDNS name, which a Mac without Local Network access for the browser cannot
 * resolve, and a home router seldom routes its own public address back in --
 * and the one case with nothing to traverse. The overlay's transport line
 * says which path a session took.
 */
import type { Channel } from "../../core/net/protocol";
import type { Transport, TransportInfo } from "./transport";

type LocalMsg =
  | { type: "host-here"; from: string }
  /** A replica asking whether a host is here, so it need not wait for the next announcement. */
  | { type: "seek"; from: string }
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
  /** The host a replica sent its join to, before any welcome. */
  private asked: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(readonly role: "host" | "replica", room = "default") {
    this.bc = new BroadcastChannel(`hotd2-net:${room}`);
    this.bc.onmessage = (e) => this.heard(e.data as LocalMsg);
    if (role === "host") {
      const announce = () => this.post({ type: "host-here", from: this.id });
      announce();
      this.timer = setInterval(() => { if (!this.peer) announce(); }, 400);
    } else {
      this.post({ type: "seek", from: this.id });
    }
  }

  /**
   * A host for `room` in this browser, joined -- or null if none answers in
   * `ms`. Resolves on the message that opens the link, so a caller that
   * attaches its peer straight after the `await` has it listening before the
   * host's first message, which is a later task.
   */
  static find(room: string, ms = 400): Promise<LocalTransport | null> {
    if (typeof BroadcastChannel === "undefined") return Promise.resolve(null);
    const t = new LocalTransport("replica", room);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        t.onOpen = () => {};
        // Told, in case the host took the join and the welcome is still on
        // its way: it would otherwise be paired with a tab that gave up.
        t.close("no host in this browser");
        resolve(null);
      }, ms);
      t.onOpen = () => {
        clearTimeout(timer);
        t.onOpen = () => {};
        resolve(t);
      };
    });
  }

  private post(m: LocalMsg): void {
    if (!this.closed) this.bc.postMessage(m);
  }

  private heard(m: LocalMsg): void {
    if (this.closed || m.from === this.id) return;
    if (m.type === "host-here" && this.role === "replica" && !this.peer) {
      this.asked = m.from;
      this.post({ type: "join", from: this.id, to: m.from });
      return;
    }
    if (m.type === "seek") {
      // Answered at once: a host in a background tab announces once a
      // second at best, its timers throttled; messages are not.
      if (this.role === "host" && !this.peer) this.post({ type: "host-here", from: this.id });
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
    const to = this.peer ?? this.asked;
    if (tell && to) this.post({ type: "bye", from: this.id, to });
    this.closed = true;
    this.info.state = "closed";
    if (this.timer) clearInterval(this.timer);
    this.bc.close();
    this.onClose(reason);
  }
}
