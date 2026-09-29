/**
 * The matchmaker on Cloudflare: a Worker that routes each room to a Durable
 * Object of its own, and the object, which keeps that one room in its storage
 * and runs `rooms.ts` over it.
 *
 * The object is there because a Worker keeps nothing between requests, and
 * the host's request and player 2's may land in different cities: one object
 * per room code is the one place both reach. Every request is a short
 * request -- no stream stays open -- so an object is up only while it answers.
 *
 * Deploying, and the TURN key: `README.md`.
 */
import {
  Matchmaker, SDP_MAX, SignalError, configFromEnv, drawCode, route, type Room,
} from "./rooms";

// `@cloudflare/workers-types` is not a dependency; these are the few parts used.
export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
export interface DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
  };
}
export interface Env {
  ROOMS: DurableObjectNamespace;
  [name: string]: unknown;
}

const BASE = "/net/matchmaker";
/** The Worker's own request to an object to make its room; never routed from outside. */
const CREATE = "https://room.internal/create";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function failure(e: unknown): Response {
  return json(e instanceof SignalError ? e.status : 400,
              { error: e instanceof Error ? e.message : String(e) });
}

/** The settings as strings: `vars` may arrive as numbers, bindings as objects. */
function settings(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** base64(HMAC-SHA1(secret, message)), the coturn-style TURN password, by WebCrypto. */
async function hmacSha1(secret: string, message: string): Promise<string> {
  const utf8 = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(message)));
  return btoa(String.fromCharCode(...mac));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const r = route(BASE, url.pathname);
    if (!r) return json(404, { error: "not found" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const room = (code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
    if (r.code) return room(r.code).fetch(request);
    if (request.method !== "POST") return json(404, { error: "unknown matchmaking request" });
    // A new room: draw a code, and ask that code's object to make it -- again,
    // on the rare draw of a code that is live.
    for (let tries = 0; tries < 8; tries++) {
      const code = drawCode(randomBytes);
      const made = await room(code).fetch(new Request(CREATE, {
        method: "POST", body: JSON.stringify({ code, host: url.host }),
      }));
      if (made.status !== 409) return made;
    }
    return json(503, { error: "could not find a free room code" });
  },
};

/** One room, kept in the object's storage under a single key. */
export class MatchRoom {
  private readonly mm: Matchmaker;

  constructor(state: DurableObjectState, env: Env) {
    const storage = state.storage;
    this.mm = new Matchmaker(configFromEnv(settings(env)), {
      store: {
        get: async (code) => {
          const room = await storage.get<Room>("room");
          return room?.code === code ? room : undefined;
        },
        put: async (room) => { await storage.put("room", room); },
        delete: async () => { await storage.delete("room"); },
      },
      hmac: hmacSha1,
      random: randomBytes,
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const text = await request.text();
      if (text.length > SDP_MAX + 1024) throw new SignalError(413, "message too large");
      const body = text ? JSON.parse(text) as unknown : null;
      if (request.url === CREATE) {
        const { code, host } = body as { code: string; host: string };
        return json(200, await this.mm.create(host, code));
      }
      const url = new URL(request.url);
      const r = route(BASE, url.pathname)!;
      return json(200, await this.mm.request(r.code!, r.verb, request.method,
                                             url.searchParams.get("token") ?? "", body, url.host));
    } catch (e) {
      return failure(e);
    }
  }
}
