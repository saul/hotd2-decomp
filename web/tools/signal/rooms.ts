/**
 * The netplay rendezvous: rooms of two, and a relay for what WebRTC needs to
 * say before it can say anything itself.
 *
 * Framework-free on purpose. The same class runs inside the Vite dev server
 * (`vite.config.ts`, so two tabs or a phone on the LAN need no cloud), in the
 * standalone Node server (`npm run signal`), and in the Cloudflare Worker
 * (`worker.ts`); each wraps it in its own HTTP. The protocol is HTTP and
 * server-sent events rather than a WebSocket, because every one of those
 * three can serve it with nothing added to `package.json` and it passes any
 * proxy in between:
 *
 * ```
 * POST {base}/rooms                        -> { code, token, iceServers }
 * POST {base}/rooms/{code}/join            -> { token, iceServers }  | 404 | 409
 *      body { token? }: a player 2 that lost its connection -- or reloaded
 *      without the leave getting through -- rejoins with the token it had
 * GET  {base}/rooms/{code}/events?token=   -> text/event-stream of Signal
 * POST {base}/rooms/{code}/send?token=     <- { data }   -> { ok, delivered }
 * POST {base}/rooms/{code}/leave?token=
 * ```
 *
 * Every join is numbered (`Signal.peer.n`), so the host can tell player 2
 * coming back -- a new connection to make -- from its own stream reconnecting
 * and hearing that player 2 is still there.
 *
 * A room holds nothing but two tokens and whatever one side has said that the
 * other has not yet read. It never sees game state: once the peers connect,
 * everything goes between them, through a TURN relay at worst, and even then
 * encrypted end to end.
 *
 * **TURN credentials are minted here**, per peer and short-lived, the way
 * coturn's `use-auth-secret` expects them: the username is
 * `<expiry>:<room>` and the password `base64(HMAC-SHA1(secret, username))`.
 * The secret never reaches a page. The same credentials open the relay the
 * dev server runs itself (`turn.ts`), whose URL is written `turn:{host}:port`
 * and gets the host the page reached the rendezvous at, so a phone on the
 * LAN is told the LAN address and a tab on this machine the loopback one.
 *
 * **Or they are fetched**, from Cloudflare's TURN service, when the Worker is
 * given a TURN key (`HOTD2_CF_TURN_KEY_ID`, `HOTD2_CF_TURN_TOKEN`): a relay
 * on Cloudflare's network with nothing to run.
 */

/** What a peer is told on its event stream. */
export type Signal =
  /** Whether player 2 is in the room, and which join of theirs this is. */
  | { t: "peer"; joined: boolean; n: number }
  | { t: "signal"; data: unknown }
  | { t: "closed"; reason: string };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SignalConfig {
  /** STUN servers, always handed out. */
  stun: string[];
  /**
   * A TURN server with a shared secret, if there is one. `{host}` in a URL
   * becomes the host the request came in on.
   */
  turn?: { urls: string[]; secret: string; ttlSeconds: number };
  /** Cloudflare's TURN service: a key, and the API token that mints its credentials. */
  cloudflareTurn?: { keyId: string; token: string; ttlSeconds: number };
  /** How many rooms may exist at once. */
  maxRooms: number;
  /** How long a room with nobody listening lives. */
  idleMs: number;
}

export const DEFAULT_STUN = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.l.google.com:19302",
];

/** Read the config from environment variables, as both servers do. */
export function configFromEnv(env: Record<string, string | undefined>): SignalConfig {
  const turnUrls = (env.HOTD2_TURN_URLS ?? "").split(",").map((s) => s.trim())
    .filter(Boolean);
  const secret = env.HOTD2_TURN_SECRET ?? "";
  return {
    stun: env.HOTD2_STUN
      ? env.HOTD2_STUN.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_STUN,
    turn: turnUrls.length && secret
      ? { urls: turnUrls, secret, ttlSeconds: Number(env.HOTD2_TURN_TTL ?? 6 * 3600) }
      : undefined,
    cloudflareTurn: env.HOTD2_CF_TURN_KEY_ID && env.HOTD2_CF_TURN_TOKEN
      ? { keyId: env.HOTD2_CF_TURN_KEY_ID, token: env.HOTD2_CF_TURN_TOKEN,
          ttlSeconds: Number(env.HOTD2_TURN_TTL ?? 6 * 3600) }
      : undefined,
    maxRooms: Number(env.HOTD2_MAX_ROOMS ?? 500),
    idleMs: Number(env.HOTD2_ROOM_IDLE_MS ?? 30 * 60 * 1000),
  };
}

/** An open event stream to one peer. */
export interface Sink {
  write(s: Signal): void;
  /** Keep the stream alive through proxies that close idle ones. */
  ping(): void;
  close(): void;
}

/** base64(HMAC-SHA1(secret, message)): the TURN REST password. */
export type Hmac = (secret: string, message: string) => Promise<string>;

/** No 0/O, 1/I/L: a code read aloud or off a phone has to survive it. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** One room code, drawn from `random`. The Worker draws here too. */
export function drawCode(random: (n: number) => Uint8Array): string {
  let c = "";
  for (const b of random(CODE_LENGTH)) c += ALPHABET[b % ALPHABET.length];
  return c;
}
/** What one side may say before the other reads it. */
const QUEUE_MAX = 512;

export class SignalError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Side {
  token: string;
  sink: Sink | null;
  queue: Signal[];
}

interface Room {
  code: string;
  host: Side;
  replica: Side | null;
  touched: number;
  /** Joins so far, rejoins included. */
  joins: number;
}

export class Rooms {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly cfg: SignalConfig,
              private readonly hmac: Hmac,
              private readonly random: (n: number) => Uint8Array,
              private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.rooms.size;
  }

  private token(): string {
    return [...this.random(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private code(): string {
    for (let tries = 0; tries < 20; tries++) {
      const c = drawCode(this.random);
      if (!this.rooms.has(c)) return c;
    }
    throw new SignalError(503, "could not find a free room code");
  }

  private async iceServers(code: string, host?: string): Promise<IceServer[]> {
    const out: IceServer[] = [{ urls: this.cfg.stun }];
    const t = this.cfg.turn;
    if (t) {
      const expiry = Math.floor(this.now() / 1000) + t.ttlSeconds;
      const username = `${expiry}:${code}`;
      const urls = t.urls.map((u) => u.replace("{host}", turnHost(host)));
      out.push({ urls, username, credential: await this.hmac(t.secret, username) });
    }
    if (this.cfg.cloudflareTurn) out.push(...await cloudflareIce(this.cfg.cloudflareTurn));
    return out;
  }

  /**
   * Make a room: under a code of its own drawing, or -- for the Worker, which
   * picks the code to pick the Durable Object -- under `code`, refused with a
   * 409 if that one is live. The room exists before the first `await`, so no
   * other request can take the code in between.
   */
  async create(code?: string, host?: string):
      Promise<{ code: string; token: string; iceServers: IceServer[] }> {
    this.sweep();
    // A live code first: a Worker's object holds one room, so "full" would
    // otherwise answer before "taken", and only "taken" means draw again.
    if (code && this.rooms.has(code.toUpperCase())) {
      throw new SignalError(409, "the room code is in use");
    }
    if (this.rooms.size >= this.cfg.maxRooms) throw new SignalError(503, "too many rooms");
    const c = code?.toUpperCase() ?? this.code();
    const side: Side = { token: this.token(), sink: null, queue: [] };
    this.rooms.set(c, { code: c, host: side, replica: null, touched: this.now(), joins: 0 });
    return { code: c, token: side.token, iceServers: await this.iceServers(c, host) };
  }

  /**
   * Player 2 comes in -- or comes back, with the token it had, when its
   * connection died without a leave reaching here. A rejoin keeps the token
   * and drops whatever was queued for the connection that is gone.
   */
  async join(code: string, token?: string, host?: string):
      Promise<{ token: string; iceServers: IceServer[] }> {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new SignalError(404, "no such room");
    if (room.replica) {
      if (!token || token !== room.replica.token) {
        throw new SignalError(409, "the room already has a second player");
      }
      room.replica.queue.length = 0;
    } else {
      room.replica = { token: this.token(), sink: null, queue: [] };
    }
    room.touched = this.now();
    room.joins++;
    // Told now only if the host is listening. If not, `attach` tells it when
    // its stream opens -- once, rather than a queued copy and then its own.
    room.host.sink?.write({ t: "peer", joined: true, n: room.joins });
    return { token: room.replica.token, iceServers: await this.iceServers(room.code, host) };
  }

  private side(code: string, token: string): { room: Room; me: Side; other: Side | null } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new SignalError(404, "no such room");
    if (room.host.token === token) return { room, me: room.host, other: room.replica };
    if (room.replica?.token === token) return { room, me: room.replica, other: room.host };
    throw new SignalError(403, "not a member of this room");
  }

  /**
   * An event stream opened. Everything queued goes down it now; a stream that
   * reconnects replaces the old one, which is what `EventSource` does on its
   * own after a drop.
   */
  attach(code: string, token: string, sink: Sink): () => void {
    const { room, me, other } = this.side(code, token);
    me.sink?.close();
    me.sink = sink;
    room.touched = this.now();
    const queued = me.queue.splice(0);
    for (const s of queued) sink.write(s);
    // The host hears who is in the room on every (re)connect: `peer` is a
    // state, and the client treats it as one.
    if (me === room.host && other) sink.write({ t: "peer", joined: true, n: room.joins });
    return () => {
      if (me.sink === sink) me.sink = null;
      // The idle clock starts when the last listener goes, not when it came.
      room.touched = this.now();
    };
  }

  /**
   * Relay `data` to the other side. With nobody there it is dropped, and the
   * answer says so rather than failing: what a peer says after the other has
   * gone -- a last candidate, an ICE restart as the link drops -- is moot,
   * and an error status is a red line in every browser console.
   */
  send(code: string, token: string, data: unknown): boolean {
    const { room, other } = this.side(code, token);
    room.touched = this.now();
    if (!other) return false;
    this.deliver(other, { t: "signal", data });
    return true;
  }

  leave(code: string, token: string): void {
    const { room, me, other } = this.side(code, token);
    if (me === room.host) {
      if (other) this.deliver(other, { t: "closed", reason: "the host left" });
      other?.sink?.close();
      me.sink?.close();
      this.rooms.delete(room.code);
    } else {
      room.replica = null;
      me.sink?.close();
      this.deliver(room.host, { t: "peer", joined: false, n: room.joins });
    }
  }

  private deliver(to: Side, s: Signal): void {
    if (to.sink) {
      to.sink.write(s);
      return;
    }
    if (to.queue.length >= QUEUE_MAX) to.queue.shift();
    to.queue.push(s);
  }

  /** Keep streams open, and drop rooms nobody has touched in a while. */
  sweep(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      for (const side of [room.host, room.replica]) side?.sink?.ping();
      const listening = room.host.sink || room.replica?.sink;
      if (!listening && now - room.touched > this.cfg.idleMs) this.rooms.delete(room.code);
    }
  }
}

/**
 * The host a page should reach a `{host}` TURN URL at: the one it reached the
 * rendezvous at, with the loopback names made the IPv4 address the relay
 * listens on.
 */
export function turnHost(host: string | undefined): string {
  const h = (host ?? "").replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  return !h || h === "localhost" || h === "::1" ? "127.0.0.1" : h;
}

/**
 * Credentials from Cloudflare's TURN service. Its answer is a list of ICE
 * servers, or -- from the older endpoint -- one; either is taken. Port 53 is
 * dropped, as Cloudflare advises for browsers, which block it. A failure
 * costs the relay, not the room: the page still gets STUN.
 */
async function cloudflareIce(cf: { keyId: string; token: string; ttlSeconds: number }):
    Promise<IceServer[]> {
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cf.keyId)}`
        + "/credentials/generate-ice-servers",
      { method: "POST",
        headers: { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: cf.ttlSeconds }) });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const j = await r.json() as { iceServers?: IceServer | IceServer[] };
    const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    return list.filter((s) => s.username && s.credential).map((s) => ({
      ...s, urls: [s.urls].flat().filter((u) => !/:53(\?|$)/.test(u)),
    }));
  } catch (e) {
    console.warn(`netplay: Cloudflare TURN credentials failed: ${(e as Error).message}`);
    return [];
  }
}

/** Parse `{base}/rooms[/{code}[/{verb}]]`. Null if the path is not ours. */
export function route(base: string, pathname: string):
    { code: string | null; verb: string | null } | null {
  if (pathname !== `${base}/rooms` && !pathname.startsWith(`${base}/rooms/`)) return null;
  const rest = pathname.slice(`${base}/rooms`.length).split("/").filter(Boolean);
  if (rest.length > 2) return null;
  return { code: rest[0]?.toUpperCase() ?? null, verb: rest[1] ?? null };
}
