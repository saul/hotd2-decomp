/**
 * The matchmaker: a room code, TURN credentials, and a mailbox for the two
 * messages WebRTC needs before it can connect -- the host's offer and player
 * 2's answer. Once both have been read, the two browsers talk to each other
 * (directly, or through the TURN relay) and never come back here.
 *
 * ```
 * POST   {base}/rooms                        -> { code, token, iceServers }   the host
 * PUT    {base}/rooms/{code}/offer?token=    <- { sdp }                       the host
 * POST   {base}/rooms/{code}/join            -> { token, iceServers }         player 2; 404, 409
 * GET    {base}/rooms/{code}/offer?token=    -> { sdp }  (null until posted)  player 2, until there is one
 * PUT    {base}/rooms/{code}/answer?token=   <- { sdp }                       player 2
 * GET    {base}/rooms/{code}/answer?token=   -> { sdp }  (null until posted)  the host, until there is one
 * DELETE {base}/rooms/{code}?token=                                           the host, leaving
 * ```
 *
 * Each SDP carries every candidate its browser gathered (no trickle), which is
 * what keeps this to one message each way. A room holds two tokens and those
 * two messages, and lives an hour. No game data passes through it.
 *
 * The same class runs in the Vite dev server and the standalone Node server
 * (`node.ts`, a `Map` of rooms) and in the Cloudflare Worker (`worker.ts`,
 * one Durable Object per room, so that the host's request and player 2's
 * meet in the same place wherever in the world each lands).
 *
 * **TURN credentials** are minted per room and short-lived, either
 *
 * * as coturn's `use-auth-secret` expects -- username `<expiry>:<room>`,
 *   password `base64(HMAC-SHA1(secret, username))` -- which is also what the
 *   relay the dev server runs (`turn.ts`) checks. Its URL is written
 *   `turn:{host}:port` and gets the host the page reached this server at; or
 * * from Cloudflare's TURN service, given a key (`HOTD2_CF_TURN_KEY_ID`,
 *   `HOTD2_CF_TURN_TOKEN`).
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SignalConfig {
  /** STUN servers, always handed out. */
  stun: string[];
  /** A TURN server sharing a secret with this one. `{host}` in a URL becomes the request's host. */
  turn?: { urls: string[]; secret: string; ttlSeconds: number };
  /** Cloudflare's TURN service: a key, and the API token that mints its credentials. */
  cloudflareTurn?: { keyId: string; token: string; ttlSeconds: number };
}

export const DEFAULT_STUN = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.l.google.com:19302",
];

/** How long a room lives: an hour is a long wait in a lobby. */
export const ROOM_TTL_MS = 60 * 60 * 1000;
/** The largest SDP accepted. One with every candidate is a few kilobytes. */
export const SDP_MAX = 32 * 1024;

/** Read the config from environment variables, as every binding does. */
export function configFromEnv(env: Record<string, string | undefined>): SignalConfig {
  const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const ttlSeconds = Number(env.HOTD2_TURN_TTL ?? 6 * 3600);
  const turnUrls = list(env.HOTD2_TURN_URLS);
  return {
    stun: env.HOTD2_STUN ? list(env.HOTD2_STUN) : DEFAULT_STUN,
    turn: turnUrls.length && env.HOTD2_TURN_SECRET
      ? { urls: turnUrls, secret: env.HOTD2_TURN_SECRET, ttlSeconds } : undefined,
    cloudflareTurn: env.HOTD2_CF_TURN_KEY_ID && env.HOTD2_CF_TURN_TOKEN
      ? { keyId: env.HOTD2_CF_TURN_KEY_ID, token: env.HOTD2_CF_TURN_TOKEN, ttlSeconds }
      : undefined,
  };
}

export interface Room {
  code: string;
  host: string;
  guest: string | null;
  offer: string | null;
  answer: string | null;
  created: number;
}

/** Where rooms are kept: a `Map` in Node, a Durable Object's storage on Cloudflare. */
export interface RoomStore {
  get(code: string): Promise<Room | undefined>;
  put(room: Room): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface Deps {
  store: RoomStore;
  /** base64(HMAC-SHA1(secret, message)): the TURN REST password. */
  hmac: (secret: string, message: string) => Promise<string>;
  random: (n: number) => Uint8Array;
  now?: () => number;
  fetch?: typeof fetch;
}

export class SignalError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** No 0/O, 1/I/L: a code read aloud or off a phone has to survive it. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function drawCode(random: (n: number) => Uint8Array): string {
  let c = "";
  for (const b of random(6)) c += ALPHABET[b % ALPHABET.length];
  return c;
}

/** Parse `{base}/rooms[/{code}[/{verb}]]`. Null if the path is not ours. */
export function route(base: string, pathname: string):
    { code: string | null; verb: string | null } | null {
  if (pathname !== `${base}/rooms` && !pathname.startsWith(`${base}/rooms/`)) return null;
  const rest = pathname.slice(`${base}/rooms`.length).split("/").filter(Boolean);
  if (rest.length > 2) return null;
  return { code: rest[0]?.toUpperCase() ?? null, verb: rest[1] ?? null };
}

export class Matchmaker {
  private readonly now: () => number;

  constructor(private readonly cfg: SignalConfig, private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  private token(): string {
    return [...this.deps.random(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Make a room: under a code of its own drawing, or -- for the Worker, which
   * draws the code to choose the Durable Object -- under `code`, refused with
   * a 409 if that one is live.
   */
  async create(host?: string, code?: string):
      Promise<{ code: string; token: string; iceServers: IceServer[] }> {
    let c = code?.toUpperCase();
    if (c) {
      if (await this.live(c)) throw new SignalError(409, "the room code is in use");
    } else {
      for (let tries = 0; !c && tries < 20; tries++) {
        const d = drawCode(this.deps.random);
        if (!await this.live(d)) c = d;
      }
      if (!c) throw new SignalError(503, "could not find a free room code");
    }
    const room: Room = { code: c, host: this.token(), guest: null, offer: null, answer: null,
                         created: this.now() };
    await this.deps.store.put(room);
    return { code: c, token: room.host, iceServers: await this.iceServers(c, host) };
  }

  /** The room, if it exists and has not outlived {@link ROOM_TTL_MS}. */
  private async live(code: string): Promise<Room | undefined> {
    const room = await this.deps.store.get(code);
    if (room && this.now() - room.created > ROOM_TTL_MS) {
      await this.deps.store.delete(code);
      return undefined;
    }
    return room;
  }

  /** Everything under `/rooms/{code}`. Returns the JSON to answer with. */
  async request(code: string, verb: string | null, method: string, token: string,
                body: unknown, host?: string): Promise<unknown> {
    const room = await this.live(code);
    if (!room) throw new SignalError(404, "no such room");
    const as = (who: "host" | "guest"): void => {
      if (!token || token !== room[who]) {
        throw new SignalError(403, `not this room's ${who === "host" ? "host" : "player 2"}`);
      }
    };
    const sdp = (): string => {
      const s = (body as { sdp?: unknown } | null)?.sdp;
      if (typeof s !== "string" || !s || s.length > SDP_MAX) throw new SignalError(400, "no SDP");
      return s;
    };
    if (verb === "join" && method === "POST") {
      if (room.guest) throw new SignalError(409, "the room already has a second player");
      room.guest = this.token();
      await this.deps.store.put(room);
      return { token: room.guest, iceServers: await this.iceServers(room.code, host) };
    }
    if (verb === "offer" && method === "PUT") {
      as("host");
      room.offer = sdp();
      await this.deps.store.put(room);
      return { ok: true };
    }
    if (verb === "offer" && method === "GET") {
      as("guest");
      return { sdp: room.offer };
    }
    if (verb === "answer" && method === "PUT") {
      as("guest");
      room.answer = sdp();
      await this.deps.store.put(room);
      return { ok: true };
    }
    if (verb === "answer" && method === "GET") {
      as("host");
      return { sdp: room.answer };
    }
    if (!verb && method === "DELETE") {
      as("host");
      await this.deps.store.delete(room.code);
      return { ok: true };
    }
    throw new SignalError(404, "unknown matchmaking request");
  }

  private async iceServers(code: string, host?: string): Promise<IceServer[]> {
    const out: IceServer[] = [{ urls: this.cfg.stun }];
    const t = this.cfg.turn;
    if (t) {
      const username = `${Math.floor(this.now() / 1000) + t.ttlSeconds}:${code}`;
      out.push({ urls: t.urls.map((u) => u.replace("{host}", turnHost(host))), username,
                 credential: await this.deps.hmac(t.secret, username) });
    }
    if (this.cfg.cloudflareTurn) {
      out.push(...await cloudflareIce(this.cfg.cloudflareTurn, this.deps.fetch ?? fetch));
    }
    return out;
  }
}

/**
 * The host a page should reach a `{host}` TURN URL at: the one it reached the
 * matchmaker at, with the loopback names made the IPv4 address the relay
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
export async function cloudflareIce(cf: { keyId: string; token: string; ttlSeconds: number },
                                    fetchFn: typeof fetch): Promise<IceServer[]> {
  try {
    const r = await fetchFn(
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
