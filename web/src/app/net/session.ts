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
 * **One way in, and one way through.** "Host a two-player game" makes a room
 * at the rendezvous (`signal.ts`) and shows its code and a link; player 2
 * opens the link (`#join=CODE`) or types the code. WebRTC does the rest
 * (`rtc.ts`) -- between two machines, and between two tabs of one browser
 * alike, through the rendezvous's TURN relay where no direct path works.
 *
 * **A dropped connection is not the end of the session.** The host keeps its
 * room and goes back to waiting; player 2 rejoins by itself, a few times,
 * with the token it had -- and a reloaded tab rejoins from its link. The
 * game on the host plays on meanwhile, with player 2's gun put down.
 *
 * **The host's game waits for player 2.** From the moment it makes a room
 * until player 2's page answers -- and again after a drop, while player 2
 * finds their way back -- the host's clock is held
 * ({@link NetSession.waitingForPlayer2}); Leave plays on alone.
 *
 * `?netsim=lat:80,jit:20,loss:5` makes this end's outgoing link that much
 * worse; `?relay=1` forces WebRTC through TURN.
 */
import type { HoldReason } from "../../core/net/protocol";
import { NetHost, type HostSim } from "./host";
import type { Identity, NetPeer } from "./peer";
import { NetReplica, type ReplicaSim } from "./replica";
import { RtcTransport } from "./rtc";
import { SignalClient, signalBase } from "./signal";
import { pushLog, type NetStats } from "./stats";
import { SimLink, parseSim, type Transport, type TransportInfo } from "./transport";

export type NetRole = "solo" | "host" | "replica";

/** What the session needs of the player. */
export interface NetPlayerHooks {
  /** Who this page is, for the handshake; null before a bundle is loaded. */
  identity(): Identity | null;
  readonly hostSim: HostSim;
  readonly replicaSim: ReplicaSim;
  /** The role changed: the player makes its world fit it. */
  roleChanged(role: NetRole): void;
  /** The host lost player 2: their gun goes down until they are back. */
  peerGone(): void;
  /** Something the session wants on screen. */
  wake(): void;
}

export type LobbyPhase =
  | "idle" | "creating" | "waiting" | "joining" | "connecting" | "connected"
  | "reconnecting" | "closed" | "error";

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
/** Player 2's rejoin attempts after a drop, and the wait before each. */
const REJOIN_DELAYS_MS = [500, 1500, 3000, 6000, 10000];

export class NetSession {
  role: NetRole = "solo";
  host: NetHost | null = null;
  replica: NetReplica | null = null;
  lobby: LobbyState = { phase: "idle", code: null, link: null, error: null };
  private signal: SignalClient | null = null;
  private transport: Transport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly params: URLSearchParams;
  private rejoins = 0;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last peer's log, carried into the next so a drop does not erase the story. */
  private carriedLog: NetStats["log"] = [];
  /** The peer whose close has been dealt with. */
  private settled: NetPeer | null = null;

  constructor(private readonly hooks: NetPlayerHooks, search: string) {
    this.params = new URLSearchParams(search);
    if (typeof window !== "undefined") {
      // A closing tab leaves its room, so the other player hears it now
      // rather than when their link times out -- and a replica keeps its token
      // in case the leave never lands, so its reload can rejoin.
      window.addEventListener("pagehide", () => this.unload());
    }
  }

  /**
   * The URL asked for a session: `?net=host` makes a room at once (what the
   * harness uses, and a bookmark for somebody who always hosts), and
   * `#join=CODE` joins one.
   */
  autostart(hash: string): void {
    if (this.params.get("net") === "host") void this.hostOnline();
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

  /** A peer on `t` for the role, replacing any before it. */
  private attach(role: "host" | "replica", t: Transport): boolean {
    const me = this.hooks.identity();
    if (!me) {
      this.fail("no bundle is loaded yet");
      t.close("no bundle");
      return false;
    }
    this.transport = this.wrap(t);
    const peer: NetPeer = role === "host"
      ? (this.host = new NetHost(this.transport, me, this.hooks.hostSim))
      : (this.replica = new NetReplica(this.transport, me, this.hooks.replicaSim));
    peer.stats.log.push(...this.carriedLog);
    this.carriedLog = [];
    if (this.role !== role) {
      this.role = role;
      this.hooks.roleChanged(role);
    }
    if (!this.timer) {
      // The page's frame loop sleeps when there is nothing to draw; the
      // session still has pings to send and a link to watch.
      this.timer = setInterval(() => this.poll(performance.now()), POLL_MS);
    }
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
      this.lobby = { phase: "waiting", code: signal.code, link: link.href, error: null };
      this.attach("host", this.rtc(signal));
    } catch (e) {
      this.fail(`could not make a room: ${(e as Error).message}`);
    }
  }

  private rtc(signal: SignalClient): RtcTransport {
    return new RtcTransport(signal, { relayOnly: this.params.has("relay") });
  }


  /** Join over the internet, by the host's code. */
  async joinOnline(code: string): Promise<void> {
    if (this.active && this.lobby.phase !== "reconnecting") return;
    const c = code.toUpperCase();
    if (this.lobby.phase !== "reconnecting") {
      this.lobby = { phase: "joining", code: c, link: null, error: null };
    }
    this.hooks.wake();
    try {
      const signal = await SignalClient.join(signalBase(location.search), c);
      this.signal?.pause();
      this.signal = signal;
      this.showJoined(c);
      this.lobby = { ...this.lobby, phase: "connecting", code: c };
      this.attach("replica", this.rtc(signal));
    } catch (e) {
      const why = (e as Error).message;
      if (this.lobby.phase !== "reconnecting") {
        this.fail(`could not join ${c}: ${why}`);
      } else if ((e as { status?: number }).status === 404) {
        // The room is gone: the host left, however word of it was lost.
        this.lobby = { ...this.lobby, phase: "closed", error: `the host closed the room (${why})` };
        this.hooks.wake();
      } else {
        this.rejoinLater(why);
      }
    }
  }

  /**
   * The address says which game this tab is in, so a reload comes back to it
   * (`urlstate.ts` keeps the hash through every rewrite after).
   */
  private showJoined(code: string): void {
    if (location.hash !== `#join=${code}`) {
      history.replaceState(history.state, "",
                           `${location.pathname}${location.search}#join=${code}`);
    }
  }

  /** Leave, whichever role this is. The player goes back to playing alone. */
  leave(reason = this.role === "host" ? "the host left" : "player 2 left"): void {
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    if (!this.active) {
      this.lobby = { phase: "idle", code: null, link: null, error: null };
      this.hooks.wake();
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
    this.carriedLog = [];
    this.rejoins = 0;
    this.role = "solo";
    this.lobby = { phase: "idle", code: null, link: null, error: null };
    this.hooks.roleChanged("solo");
    this.hooks.wake();
  }

  /** The tab is closing. */
  private unload(): void {
    if (!this.active) return;
    this.host?.close("the host closed the page");
    this.replica?.close("player 2 closed the page");
    this.transport?.close("page closed");
    this.signal?.close({ keepToken: true });
  }

  /**
   * The peer's link is gone and nobody chose to leave. The host goes back to
   * waiting in the same room; player 2 tries to come back.
   */
  private dropped(peer: NetPeer): void {
    const why = peer.stats.problem ?? "the link closed";
    this.carriedLog = peer.stats.log.slice();
    pushLog(this.carriedLog, { at: performance.now(), tick: peer.stats.tick,
                               kind: "report", text: `link lost: ${why}` });
    if (this.role === "host") {
      this.hooks.peerGone();
      this.host = null;
      this.lobby = { ...this.lobby, phase: "waiting",
                     error: `player 2 dropped (${why}); the room is still open` };
      if (this.signal) this.attach("host", this.rtc(this.signal));
    } else {
      // A host that closed its room is not coming back.
      if (/host left|host closed/.test(why)) {
        this.lobby = { ...this.lobby, phase: "closed", error: why };
        this.hooks.wake();
        return;
      }
      this.replica = null;
      this.lobby = { ...this.lobby, phase: "reconnecting", error: why };
      this.rejoinLater(why);
    }
    this.hooks.wake();
  }

  private rejoinLater(why: string): void {
    if (this.rejoins >= REJOIN_DELAYS_MS.length) {
      this.lobby = { ...this.lobby, phase: "closed",
                     error: `could not reconnect: ${why}` };
      this.hooks.wake();
      return;
    }
    const delay = REJOIN_DELAYS_MS[this.rejoins++];
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      if (this.lobby.phase !== "reconnecting") return;
      if (this.lobby.code) void this.joinOnline(this.lobby.code);
    }, delay);
  }

  /** Once a frame from the player, and on the session's own timer. */
  poll(now: number): void {
    const peer = this.host ?? this.replica;
    if (!peer) return;
    peer.poll(now);
    if (peer.isClosed) {
      // Once: a replica whose host left stays, closed, for its log.
      if (peer !== this.settled) {
        this.settled = peer;
        this.dropped(peer);
      }
    } else if (this.transport?.info.state === "open") {
      if (this.lobby.phase !== "connected") {
        this.lobby = { ...this.lobby, phase: "connected", error: null };
        this.rejoins = 0;
        this.hooks.wake();
      }
    } else if (!Number.isNaN(this.transport?.info.path?.since ?? NaN)
               && now - this.searchWakeAt >= 1000) {
      // WebRTC is searching, and the lobby card counts what it has tried. The
      // page is held -- a host waiting, a replica with no stream -- so nothing
      // else would draw it again.
      this.searchWakeAt = now;
      this.hooks.wake();
    }
  }

  private searchWakeAt = -Infinity;

  /**
   * The host has nobody to play with: its room is made and player 2's page
   * has not answered yet, or has dropped and not come back. The player holds
   * its clock meanwhile, as it does while player 2 loads a stage; the lobby
   * card says so, and Leave plays on alone.
   */
  get waitingForPlayer2(): boolean {
    return this.role === "host" && !this.host?.connected;
  }

  /** The link as it stands, for the lobby's account of a slow connect. */
  get link(): TransportInfo | null {
    return this.transport?.info ?? null;
  }

  /** Why the host's clock is held, as the replica hears it. */
  get hostHold(): HoldReason {
    return this.replica ? this.replica.hold : null;
  }

  get stats(): NetStats | null {
    return (this.host ?? this.replica)?.stats ?? null;
  }
}
