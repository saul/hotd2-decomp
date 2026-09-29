/**
 * Netplay, as the player sees it: which role this page is in, the lobby that
 * gets it there, and the one object the rest of `app/` talks to.
 *
 * The player hands it {@link NetPlayerHooks} -- the host's and the replica's
 * view of the game, and a wake -- and calls it at the frame's fixed points.
 * Everything below it (`host.ts`, `replica.ts`, the transports, the codec)
 * knows nothing of the player; everything above it (`ui/`) reads its
 * projection and sends commands. See `docs/PLAYER.md`, "Netplay".
 *
 * "Host a two-player game" makes a room at the matchmaker (`matchmaker.ts`)
 * and shows its code and a link; player 2 opens the link (`#join=CODE`) or
 * types the code. WebRTC does the rest (`rtc.ts`), directly or through the
 * TURN relay the matchmaker handed out.
 *
 * **The host's game waits for player 2.** From the moment it makes a room
 * until player 2's page answers, the host's clock is held
 * ({@link NetSession.waitingForPlayer2}); Cancel plays on alone.
 *
 * **A session that drops is over.** The card says why, and each page goes back
 * to playing alone; hosting again makes a new room.
 *
 * `?netsim=lat:80,jit:20,loss:5` makes this end's outgoing link that much
 * worse; `?relay=1` forces WebRTC through TURN.
 */
import type { HoldReason } from "../../core/net/protocol";
import { NetHost, type HostSim } from "./host";
import { MatchClient, matchmakerBase } from "./matchmaker";
import type { Identity, NetPeer } from "./peer";
import { NetReplica, type ReplicaSim } from "./replica";
import { RtcTransport } from "./rtc";
import type { NetStats } from "./stats";
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
  /** The host lost player 2: their gun goes down. */
  peerGone(): void;
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
  private match: MatchClient | null = null;
  private transport: Transport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly params: URLSearchParams;
  /** The peer whose close has been dealt with. */
  private settled: NetPeer | null = null;
  private searchWakeAt = -Infinity;

  constructor(private readonly hooks: NetPlayerHooks, search: string) {
    this.params = new URLSearchParams(search);
    if (typeof window !== "undefined") {
      // A closing tab tells the other player now rather than when their link
      // times out, and a host's room goes with it.
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

  /** A peer for the role on a WebRTC link made through `match`. */
  private attach(role: "host" | "replica", match: MatchClient): void {
    const me = this.hooks.identity();
    if (!me) {
      match.close();
      this.fail("no bundle is loaded yet");
      return;
    }
    this.match = match;
    const rtc = new RtcTransport(match, { relayOnly: this.params.has("relay") });
    const sim = parseSim(this.params.get("netsim"));
    this.transport = sim ? new SimLink(rtc, sim) : rtc;
    if (role === "host") this.host = new NetHost(this.transport, me, this.hooks.hostSim);
    else this.replica = new NetReplica(this.transport, me, this.hooks.replicaSim);
    this.role = role;
    this.hooks.roleChanged(role);
    // The page's frame loop sleeps when there is nothing to draw; the session
    // still has pings to send and a link to watch.
    this.timer ??= setInterval(() => this.poll(performance.now()), POLL_MS);
    this.hooks.wake();
  }

  private fail(error: string): void {
    this.lobby = { ...this.lobby, phase: "error", error };
    this.hooks.wake();
  }

  /** Make a room, and wait for player 2. */
  async hostOnline(): Promise<void> {
    if (this.active) return;
    this.lobby = { phase: "creating", code: null, link: null, error: null };
    this.hooks.wake();
    try {
      const match = await MatchClient.create(matchmakerBase(location.search));
      // The host's own address, less what only the host means by it -- where
      // its script is, and `net=host` -- so the matchmaker and the rest of the
      // session's settings go with it.
      const link = new URL(location.href);
      link.hash = `join=${match.code}`;
      for (const k of ["net", "block", "step", "op", "slot", "frame"]) link.searchParams.delete(k);
      this.lobby = { phase: "waiting", code: match.code, link: link.href, error: null };
      this.attach("host", match);
    } catch (e) {
      this.fail(`could not make a room: ${(e as Error).message}`);
    }
  }

  /** Join the host's room, by its code. */
  async joinOnline(code: string): Promise<void> {
    if (this.active) return;
    const c = code.toUpperCase();
    this.lobby = { phase: "joining", code: c, link: null, error: null };
    this.hooks.wake();
    try {
      const match = await MatchClient.join(matchmakerBase(location.search), c);
      this.lobby = { ...this.lobby, phase: "connecting" };
      this.attach("replica", match);
    } catch (e) {
      this.fail(`could not join ${c}: ${(e as Error).message}`);
    }
  }

  /** Leave, whichever role this is. The player goes back to playing alone. */
  leave(reason = this.role === "host" ? "the host left" : "player 2 left"): void {
    this.host?.close(reason);
    this.replica?.close(reason);
    this.transport?.close(reason);
    this.match?.close();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host = this.replica = null;
    this.transport = null;
    this.match = null;
    // The link that joined this game joins nothing now; a reload should not try.
    if (typeof location !== "undefined" && /^#join=/.test(location.hash)) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    }
    const was = this.role;
    this.role = "solo";
    this.lobby = { phase: "idle", code: null, link: null, error: null };
    if (was !== "solo") this.hooks.roleChanged("solo");
    this.hooks.wake();
  }

  /** The tab is closing. */
  private unload(): void {
    this.host?.close("the host closed the page");
    this.replica?.close("player 2 closed the page");
    this.transport?.close("page closed");
    this.match?.close();
  }

  /**
   * The link is gone and nobody here chose to leave: the session is over.
   * The peer stays, closed, so the overlay still shows its figures and log.
   */
  private dropped(peer: NetPeer): void {
    const why = peer.stats.problem ?? "the link closed";
    this.match?.close();
    if (this.role === "host") this.hooks.peerGone();
    this.lobby = { ...this.lobby, phase: "closed", error: why };
    this.hooks.wake();
  }

  /** Once a frame from the player, and on the session's own timer. */
  poll(now: number): void {
    const peer = this.host ?? this.replica;
    if (!peer) return;
    peer.poll(now);
    if (peer.isClosed) {
      if (peer !== this.settled) {
        this.settled = peer;
        this.dropped(peer);
      }
    } else if (this.transport?.info.state === "open") {
      if (this.lobby.phase !== "connected") {
        this.lobby = { ...this.lobby, phase: "connected", error: null };
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

  /**
   * The host has nobody to play with yet: its room is made and player 2's
   * page has not answered. The player holds its clock meanwhile, as it does
   * while player 2 loads a stage; the lobby card says so.
   */
  get waitingForPlayer2(): boolean {
    return this.role === "host" && !this.host?.connected
      && this.lobby.phase !== "closed" && this.lobby.phase !== "error";
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
