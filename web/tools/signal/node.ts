/**
 * `rooms.ts` over Node's own `http`: the Vite dev server's middleware and the
 * standalone server both use this, so there is one HTTP binding for Node.
 *
 * CORS is open: the rendezvous holds no data worth protecting from a page on
 * another origin -- a room is only a code and two random tokens -- and the
 * hosted player is served from wherever its owner put it.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Rooms, SignalError, route, type Signal, type SignalConfig, type Sink }
  from "./rooms";

export function nodeRooms(cfg: SignalConfig): Rooms {
  return new Rooms(
    cfg,
    async (secret, message) => createHmac("sha1", secret).update(message).digest("base64"),
    (n) => new Uint8Array(randomBytes(n)),
  );
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new SignalError(413, "message too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Handle a request under `base`, or return false to let the next handler
 * have it.
 */
export function handle(rooms: Rooms, base: string, req: IncomingMessage,
                       res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  const r = route(base, url.pathname);
  if (!r) return false;
  if (req.method === "OPTIONS") {
    cors(res);
    res.statusCode = 204;
    res.end();
    return true;
  }
  const token = url.searchParams.get("token") ?? "";
  void (async () => {
    try {
      if (!r.code && req.method === "POST") {
        json(res, 200, await rooms.create());
      } else if (r.code && r.verb === "join" && req.method === "POST") {
        json(res, 200, await rooms.join(r.code));
      } else if (r.code && r.verb === "events" && req.method === "GET") {
        // Headers set, not sent: `attach` refuses a wrong token or a gone room
        // by throwing, and that has to reach the client as a 403 or a 404 --
        // which `EventSource` gives up on -- not as an empty 200 it would
        // reconnect to every few seconds for ever.
        cors(res);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Connection", "keep-alive");
        // nginx and friends buffer a response unless told otherwise.
        res.setHeader("X-Accel-Buffering", "no");
        const sink: Sink = {
          write: (s: Signal) => { res.write(`data: ${JSON.stringify(s)}\n\n`); },
          ping: () => { res.write(": ping\n\n"); },
          close: () => { res.end(); },
        };
        // Nothing is written until `attach` has accepted the token; its first
        // write -- the queue, the peer's presence, or the comment below --
        // is what sends the 200.
        const detach = rooms.attach(r.code, token, sink);
        res.write(": open\n\n");
        req.on("close", detach);
      } else if (r.code && r.verb === "send" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as { data: unknown };
        rooms.send(r.code, token, body.data);
        json(res, 200, { ok: true });
      } else if (r.code && r.verb === "leave" && req.method === "POST") {
        rooms.leave(r.code, token);
        json(res, 200, { ok: true });
      } else {
        json(res, 404, { error: "unknown signalling request" });
      }
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      const status = e instanceof SignalError ? e.status : 400;
      json(res, status, { error: (e as Error).message });
    }
  })();
  return true;
}
