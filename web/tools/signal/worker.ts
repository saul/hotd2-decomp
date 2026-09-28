/**
 * The netplay rendezvous as a Cloudflare Worker: `rooms.ts`'s protocol under
 * the same `/net/signal` base, with one Durable Object per room code.
 *
 *     cd web/tools/signal && npx wrangler deploy
 *
 * A Worker keeps nothing between requests, and a Durable Object is the one
 * place Cloudflare lets two requests from two players meet. One object per
 * code means a join reaches its room with no lookup -- `idFromName` is a pure
 * function of the code -- and one room's traffic never waits on another's.
 *
 * Each object keeps a `Rooms` of its own holding its one room, so every rule
 * -- the tokens, the 404/409/403s, the queue, what a reconnect replays, when a
 * room is idle -- is `rooms.ts`'s and none of it is restated here. What this
 * file adds is HTTP over `Request` and `Response`, which object a request goes
 * to, and the event stream.
 *
 * **Rooms live in the object's memory, not its storage.** An object stays in
 * memory while a request is in flight, and an open event stream is one, so a
 * room lasts as long as somebody is listening to it. With nobody listening,
 * the object is evicted within a minute or two and the room goes with it --
 * well before `HOTD2_ROOM_IDLE_MS`, which therefore only matters here while
 * the object happens to stay up. A deploy restarts every object and so ends
 * every room. `HOTD2_MAX_ROOMS` is not enforced: each object holds one room,
 * and counting them all would take one more object every create has to wait
 * on.
 */
import {
  Rooms, SignalError, configFromEnv, drawCode, route, type Signal, type SignalConfig,
  type Sink,
} from "./rooms";

// -- the platform ---------------------------------------------------------------
//
// `@cloudflare/workers-types` is not a dependency, and the project's `tsc`
// checks `tools/` against the DOM library, which already has `Request`,
// `Response`, `TransformStream` and `crypto.subtle`. These are the few Durable
// Object shapes this file touches, declared as narrowly as it uses them, so
// the check still means something without a package for four interfaces. They
// are exported for the test, which fakes the namespace.

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface DurableObjectState {
  readonly id: DurableObjectId;
}

export interface Env {
  /** The namespace `wrangler.toml` binds to `SignalRoom`. */
  ROOMS: DurableObjectNamespace;
  /** The rest: the settings `configFromEnv` reads, from `vars` and secrets. */
  [name: string]: unknown;
}

// -- constants ------------------------------------------------------------------

const BASE = "/net/signal";
/**
 * The Worker's own request to an object to make its room. It is not under
 * `BASE`, and the Worker forwards only paths that are, so nothing from
 * outside can reach it.
 */
const CREATE = "/internal/create";
/** Comfortably inside the 100 seconds Cloudflare lets a response sit idle. */
const PING_MS = 15_000;
/** The same limit `node.ts` puts on a message. */
const BODY_MAX = 64 * 1024;
/** How many codes to draw before giving up, which only a full namespace makes happen. */
const CREATE_TRIES = 8;

// -- crypto ---------------------------------------------------------------------

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

const utf8 = new TextEncoder();

/** base64(HMAC-SHA1(secret, message)), the TURN REST password, by WebCrypto. */
async function hmacSha1(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(message)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin);
}

// -- HTTP -----------------------------------------------------------------------

/** Open, as in `node.ts`: a room is a code and two random tokens, nothing to guard. */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function failure(e: unknown, fallback: number): Response {
  const status = e instanceof SignalError ? e.status : fallback;
  return json(status, { error: e instanceof Error ? e.message : String(e) });
}

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("Content-Length") ?? 0) > BODY_MAX) {
    throw new SignalError(413, "message too large");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > BODY_MAX) throw new SignalError(413, "message too large");
  return new TextDecoder().decode(bytes);
}

/**
 * The env record as `configFromEnv` reads it. A `vars` entry written as a
 * TOML number arrives as a number and a binding as an object; the settings
 * are the strings and numbers, as strings.
 */
function settings(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}

// -- choosing a room's object ---------------------------------------------------

/**
 * `POST /rooms`. The code is drawn here, by `rooms.ts`'s own rule, and the
 * room is made by the object the code names, under that code.
 *
 * Two creates cannot share a room. An object runs one event at a time, and
 * `Rooms.create(code)` refuses a live code with a 409 and stores the new room
 * before its first `await`, so of two creates that drew the same code the
 * second is refused and this draws again. A code whose room has gone -- left,
 * swept, or evicted with its object -- is free to be drawn again; one whose
 * room is live never is.
 */
async function createRoom(env: Env): Promise<Response> {
  for (let tries = 0; tries < CREATE_TRIES; tries++) {
    const code = drawCode(randomBytes);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch(new Request(`https://room${CREATE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }));
    if (res.status !== 409) return res;
    await res.body?.cancel();
  }
  return json(503, { error: "could not find a free room code" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const r = route(BASE, new URL(request.url).pathname);
    if (!r) return json(404, { error: "not found" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (r.code) return await env.ROOMS.get(env.ROOMS.idFromName(r.code)).fetch(request);
      if (request.method === "POST") return await createRoom(env);
      return json(404, { error: "unknown signalling request" });
    } catch (e) {
      return failure(e, 500);
    }
  },
};

// -- the room -------------------------------------------------------------------

/**
 * One room's object: addressed by the room's code, it holds a `Rooms` with
 * that one room in it and serves every request that names the code.
 */
export class SignalRoom {
  private readonly cfg: SignalConfig;
  private rooms: Rooms;
  private streams = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(_state: DurableObjectState, env: Env) {
    // One room per object, so `maxRooms` here is this object's limit and not
    // the deployment's. `Rooms.create` refusing a second room backs up the
    // check in `create`: a code drawn afresh would name some other object.
    this.cfg = { ...configFromEnv(settings(env)), maxRooms: 1 };
    this.rooms = new Rooms(this.cfg, hmacSha1, randomBytes);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === CREATE && request.method === "POST") {
        const { code } = JSON.parse(await readBody(request)) as { code: string };
        return json(200, await this.rooms.create(code));
      }
      const r = route(BASE, url.pathname);
      const token = url.searchParams.get("token") ?? "";
      const verb = r?.code ? r.verb : null;
      const code = r?.code ?? "";
      if (verb === "join" && request.method === "POST") {
        const raw = await readBody(request);
        const body = (raw ? JSON.parse(raw) : {}) as { token?: string };
        return json(200, await this.rooms.join(code, body.token));
      }
      if (verb === "events" && request.method === "GET") return this.events(code, token);
      if (verb === "send" && request.method === "POST") {
        const body = JSON.parse(await readBody(request)) as { data: unknown };
        this.rooms.send(code, token, body.data);
        return json(200, { ok: true });
      }
      if (verb === "leave" && request.method === "POST") {
        this.rooms.leave(code, token);
        return json(200, { ok: true });
      }
      return json(404, { error: "unknown signalling request" });
    } catch (e) {
      return failure(e, 400);
    }
  }

  /**
   * `GET /rooms/{code}/events`. The body is the readable side of a
   * `TransformStream`, and the room's `Sink` writes the other side. The
   * stream is attached before the response exists, so a wrong token or a
   * room that has gone is a 403 or 404, which `EventSource` gives up on,
   * rather than an empty 200 it would reconnect to every few seconds.
   *
   * A reader that goes away cancels the readable side, which errors the
   * writable side and settles `writer.closed`: that is the detach. A client
   * that vanishes without a word is found by the next ping's failed write.
   */
  private events(code: string, token: string): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let open = true;
    let detach: (() => void) | null = null;
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      open = false;
      if (detach) {
        detach();
        this.streamClosed();
      }
    };
    writer.closed.then(end, end);
    const put = (text: string): void => {
      // A write that fails is a reader that left; `closed` has already said so.
      if (open) writer.write(utf8.encode(text)).catch(() => {});
    };
    const sink: Sink = {
      write: (s: Signal) => put(`data: ${JSON.stringify(s)}\n\n`),
      ping: () => put(": ping\n\n"),
      close: () => {
        if (!open) return;
        open = false;
        writer.close().catch(() => {});
      },
    };
    put(": open\n\n");
    try {
      detach = this.rooms.attach(code, token, sink);
    } catch (e) {
      end();
      writer.abort().catch(() => {});
      throw e;
    }
    this.streamOpened();
    return new Response(readable, {
      headers: {
        ...CORS,
        "Content-Type": "text/event-stream",
        // `no-transform` keeps Cloudflare from compressing the stream, which
        // would hold events back until a compressor's block filled.
        "Cache-Control": "no-store, no-transform",
      },
    });
  }

  /**
   * The ping -- `Rooms.sweep`, which also drops an idle room -- runs on a
   * `setInterval` that exists only while a stream is open, not on an alarm.
   * Pings are for open streams, and an open stream is a request in flight,
   * which is what keeps the object in memory for the timer to fire; with no
   * stream open there is nothing to ping, and clearing the timer leaves the
   * object free to be evicted. An alarm's one advantage is that it survives
   * eviction, and that is no use here: it would wake an object whose room
   * went with its memory. It would also cost a storage write on every re-arm.
   */
  private streamOpened(): void {
    if (this.streams++ === 0) this.timer = setInterval(() => this.rooms.sweep(), PING_MS);
  }

  private streamClosed(): void {
    if (--this.streams === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
