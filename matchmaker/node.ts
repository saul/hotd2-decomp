/**
 * `rooms.ts` over Node's own `http`, with the rooms in a `Map`: the Vite dev
 * server's middleware and the standalone server both use this.
 *
 * CORS is open: a room is a code and two random tokens, nothing worth
 * guarding from a page on another origin, and the hosted player is served
 * from wherever its owner put it.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Matchmaker, SDP_MAX, SignalError, route, type Room, type SignalConfig }
  from "./rooms";

export function nodeMatchmaker(cfg: SignalConfig): Matchmaker {
  const rooms = new Map<string, Room>();
  return new Matchmaker(cfg, {
    store: {
      get: async (code) => rooms.get(code),
      put: async (room) => { rooms.set(room.code, room); },
      delete: async (code) => { rooms.delete(code); },
    },
    hmac: async (secret, message) => createHmac("sha1", secret).update(message).digest("base64"),
    random: (n) => new Uint8Array(randomBytes(n)),
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > SDP_MAX + 1024) throw new SignalError(413, "message too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

/** Handle a request under `base`, or return false to let the next handler have it. */
export function handle(mm: Matchmaker, base: string, req: IncomingMessage,
                       res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  const r = route(base, url.pathname);
  if (!r) return false;
  const method = req.method ?? "GET";
  if (method === "OPTIONS") {
    json(res, 204, undefined);
    return true;
  }
  // Where the page reached this server: a `{host}` TURN URL is written with it.
  const host = req.headers.host;
  void (async () => {
    try {
      if (!r.code && method === "POST") {
        json(res, 200, await mm.create(host));
      } else if (r.code) {
        const body = method === "PUT" ? await readJson(req) : null;
        json(res, 200, await mm.request(r.code, r.verb, method,
                                        url.searchParams.get("token") ?? "", body, host));
      } else {
        json(res, 404, { error: "unknown matchmaking request" });
      }
    } catch (e) {
      json(res, e instanceof SignalError ? e.status : 400, { error: (e as Error).message });
    }
  })();
  return true;
}
