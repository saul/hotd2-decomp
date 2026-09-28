/**
 * Netplay, as the player sees it: which role this page is in, the lobby that
 * gets it there, and the one object the rest of `app/` talks to.
 *
 * The player hands it {@link NetPlayerHooks} -- the host's and the replica's
 * view of the game, and a wake -- and calls it at the frame's fixed points.
 * Everything below it (`host.ts`, `replica.ts`, the transports, the codec)
 * knows nothing of the player; everything above it (`ui/`) reads its
 * projection and sends commands. See `docs/NETPLAY.md`.
 *
 * Ways in:
 *
 * * **Online.** "Host a two-player game" makes a room at the rendezvous
 *   (`signal.ts`) and shows its code and a link; player 2 opens the link
 *   (`#join=CODE`) or types the code. WebRTC does the rest (`rtc.ts`).
 * * **Local.** `?net=local-host` in one tab and `?net=local-join` in another
 *   join over a `BroadcastChannel` (`local.ts`) -- for development, and for
 *   the headless harness.
 *
 * `?netsim=lat:80,jit:20,loss:5` makes this end's outgoing link that much
 * worse; `?relay=1` forces WebRTC through TURN.
 */
import type { HoldReason } from "../../core/net/protocol";
import { NetHost, type HostSim } from "./host";
import { LocalTransport } from "./local";
import type { Identity } from "./peer";
import { NetReplica, type ReplicaSim } from "./replica";
import { RtcTransport } from "./rtc";
import { SignalClient, signalBase } from "./signal";
import type { NetStats } from "./stats";
import { SimLink, parseSim, type Transport } from "./transport";

export type NetRole = "solo" | "host" | "replica";

/** What the session needs of the player. */
export interface NetPlayerHooks {
  /** Who this page is, for the handshake; null before a bundle is loaded. */
  identity(): Identity | null;
  readonly hostSim: HostSim;
  readonly replicaSim: ReplicaSim;
  /** The role changed: the player makes its world fit it. */
  roleChanged(role: NetRole): void;
  /** Something the session wants on screen. */
  wake(): void;
}

export type LobbyPhase =
  | "idle" | "creating" | "waiting" | "joining" | "connecting" | "connected"
  | "closed" | "error";

export interface LobbyState {
  phase: LobbyPhase;
  /** The room code, while there is a room. */
  code: string | null;
  /** The link that joins it. */
  link: string | null;
  error: string | null;
}

/** How often the session polls while the page's own loop sleeps. */
const POLL_MS = 100;

export class NetSession {
  role: NetRole = "solo";
  host: NetHost | null = null;
  replica: NetReplica | null = null;
  lobby: LobbyState = { phase: "idle", code: null, link: null, error: null };
  private signal: SignalClient | null = null;
  private transport: Transport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly params: URLSearchParams;

  constructor(private readonly hooks: NetPlayerHooks, search: string) {
    this.params = new URLSearchParams(search);
  }

  /**
   * The URL asked for a session: `?net=host` makes a room at once (what the
   * harness uses, and a bookmark for somebody who always hosts),
   * `?net=local-host` / `?net=local-join` pair two tabs, `#join=CODE` joins.
   */
  autostart(hash: string): void {
    const net = this.params.get("net");
    if (net === "host") void this.hostOnline();
    else if (net === "local-host") this.hostLocal();
    else if (net === "local-join") this.joinLocal();
    const m = /(?:^#|&)join=([A-Za-z0-9]{4,12})/.exec(hash);
    if (m && this.role === "solo") void this.joinOnline(m[1]);
  }

  get active(): boolean {
    return this.role !== "solo";
  }

  private wrap(t: Transport): Transport {
    const sim = parseSim(this.params.get("netsim"));
    return sim ? new SimLink(t, sim) : t;
  }

  private begin(role: "host" | "replica", t: Transport): boolean {
    const me = this.hooks.identity();
    if (!me) {
      this.fail("no bundle is loaded yet");
      t.close("no bundle");
      return false;
    }
    this.transport = this.wrap(t);
    if (role === "host") {
      this.host = new NetHost(this.transport, me, this.hooks.hostSim);
    } else {
      this.replica = new NetReplica(this.transport, me, this.hooks.replicaSim);
    }
    this.role = role;
    this.hooks.roleChanged(role);
    // The page's frame loop sleeps when there is nothing to draw; the session
    // still has pings to send and a link to watch.
    this.timer = setInterval(() => this.poll(performance.now()), POLL_MS);
    this.hooks.wake();
    return true;
  }

  private fail(error: string): void {
    this.lobby = { ...this.lobby, phase: "error", error };
    this.hooks.wake();
  }

  /** Host over the internet: make a room, and wait for player 2. */
  async hostOnline(): Promise<void> {
    if (this.active) return;
    this.lobby = { phase: "creating", code: null, link: null, error: null };
    this.hooks.wake();
    try {
      const signal = await SignalClient.create(signalBase(location.search));
      this.signal = signal;
      const link = new URL(location.href);
      link.hash = `join=${signal.code}`;
      link.searchParams.delete("net");
      const rtc = new RtcTransport(signal, { relayOnly: this.params.has("relay") });
      this.lobby = { phase: "waiting", code: signal.code, link: link.href, error: null };
      this.begin("host", rtc);
    } catch (e) {
      this.fail(`could not make a room: ${(e as Error).message}`);
    }
  }

  /** Join over the internet, by the host's code. */
  async joinOnline(code: string): Promise<void> {
    if (this.active) return;
    this.lobby = { phase: "joining", code: code.toUpperCase(), link: null, error: null };
    this.hooks.wake();
    try {
      const signal = await SignalClient.join(signalBase(location.search), code);
      this.signal = signal;
      const rtc = new RtcTransport(signal, { relayOnly: this.params.has("relay") });
      this.lobby = { ...this.lobby, phase: "connecting" };
      this.begin("replica", rtc);
    } catch (e) {
      this.fail(`could not join ${code.toUpperCase()}: ${(e as Error).message}`);
    }
  }

  hostLocal(): void {
    if (this.active) return;
    this.lobby = { phase: "waiting", code: "local", link: null, error: null };
    this.begin("host", new LocalTransport("host", this.params.get("room") ?? "default"));
  }

  joinLocal(): void {
    if (this.active) return;
    this.lobby = { phase: "connecting", code: "local", link: null, error: null };
    this.begin("replica", new LocalTransport("replica", this.params.get("room") ?? "default"));
  }

  /** Leave, whichever role this is. The player goes back to playing alone. */
  leave(reason = "left"): void {
    if (!this.active) {
      this.lobby = { phase: "idle", code: null, link: null, error: null };
      return;
    }
    this.host?.close(reason);
    this.replica?.close(reason);
    this.transport?.close(reason);
    this.signal?.close();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host = this.replica = null;
    this.transport = null;
    this.signal = null;
    this.role = "solo";
    this.lobby = { phase: "idle", code: null, link: null, error: null };
    this.hooks.roleChanged("solo");
    this.hooks.wake();
  }

  /** Once a frame from the player, and on the session's own timer. */
  poll(now: number): void {
    const peer = this.host ?? this.replica;
    if (!peer) return;
    peer.poll(now);
    if (peer.isClosed) {
      if (this.lobby.phase !== "closed") {
        this.lobby = { ...this.lobby, phase: "closed",
                       error: peer.stats.problem ?? "the link closed" };
        this.hooks.wake();
      }
    } else if (this.transport?.info.state === "open") {
      if (this.lobby.phase !== "connected") {
        this.lobby = { ...this.lobby, phase: "connected", error: null };
        this.hooks.wake();
      }
    }
  }

  /** Why the host's clock is held, as the replica hears it. */
  get hostHold(): HoldReason {
    return this.replica ? this.replica.hold : null;
  }

  get stats(): NetStats | null {
    return (this.host ?? this.replica)?.stats ?? null;
  }
}
