/**
 * The matchmaker (`matchmaker/` at the repository's root), over HTTP.
 *
 * `rooms.ts` is the protocol; `node.ts` binds it to Node's `http` for the dev
 * server and `npm run matchmaker`, and `worker.ts` to a Cloudflare Worker with
 * one Durable Object per room. The same suite runs against both: the Node
 * binding on a real server on a free port, and the Worker's `fetch` called
 * in-process with its namespace and each object's storage faked by maps. The
 * second proves the Worker's routing, its code draw and its storage; it
 * proves nothing about Cloudflare's runtime.
 *
 * Of each, it asserts:
 *
 * - create returns a six-character code from the unambiguous alphabet, a
 *   token, the STUN servers, and a TURN credential that is
 *   base64(HMAC-SHA1(secret, username)), its URL carrying the host the
 *   request came in on;
 * - a join of an unknown code is 404, a join 200 with credentials, a second
 *   join 409;
 * - the offer and the answer each go in with one side's token and come out
 *   with the other's -- null until posted -- and every wrong token is 403;
 * - a PUT without an SDP is 400;
 * - the host's DELETE ends the room, and player 2's is refused;
 * - CORS is open, preflight included.
 *
 * And alone: a room is gone after an hour; a Worker whose first drawn code is
 * live draws again; Cloudflare's credential answer is read in both of its
 * shapes, port 53 dropped, and a failure costs only the relay.
 *
 * Run with `node tools/run_test.mjs test/matchmaker.test.ts`. No bundle,
 * nothing beyond loopback; about a second.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Matchmaker, ROOM_TTL_MS, cloudflareIce, configFromEnv, type IceServer, type Room,
} from "../../matchmaker/rooms";
import { handle, nodeMatchmaker } from "../../matchmaker/node";
import worker, { MatchRoom, type DurableObjectState, type Env }
  from "../../matchmaker/worker";

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passes++;
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const BASE = "/net/matchmaker";
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const SECRET = "the-turn-secret";
const env = {
  HOTD2_TURN_URLS: "turn:{host}:3478?transport=udp",
  HOTD2_TURN_SECRET: SECRET,
  HOTD2_TURN_TTL: "600",
};

interface Reply { status: number; body: Record<string, unknown>; cors: boolean }
type Api = (method: string, path: string, body?: unknown) => Promise<Reply>;

async function reply(r: Response): Promise<Reply> {
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* */ }
  return { status: r.status, body, cors: r.headers.get("access-control-allow-origin") === "*" };
}

// -- the suite, against either binding ------------------------------------------

async function suite(name: string, api: Api, host: string): Promise<void> {
  console.log(`\n${name}`);
  const made = await api("POST", `${BASE}/rooms`);
  const code = made.body.code as string;
  const H = made.body.token as string;
  check("create is 200 with a code from the unambiguous alphabet and a token",
        made.status === 200 && CODE.test(code) && typeof H === "string" && H.length >= 16,
        JSON.stringify(made.body));
  const ice = made.body.iceServers as IceServer[];
  const turn = ice?.find((s) => [s.urls].flat().some((u) => u.startsWith("turn:")));
  const expiry = Number(turn?.username?.split(":")[0]);
  check("...with STUN, and a TURN credential minted from the secret",
        ice?.some((s) => [s.urls].flat().some((u) => u.startsWith("stun:")))
        && turn?.username?.endsWith(`:${code}`) === true
        && turn?.credential === createHmac("sha1", SECRET).update(turn.username!).digest("base64")
        && Math.abs(expiry - (Date.now() / 1000 + 600)) < 30,
        JSON.stringify(turn));
  check("...its URL carrying the host the request came in on",
        [turn?.urls].flat()[0] === `turn:${host}:3478?transport=udp`, JSON.stringify(turn?.urls));
  check("responses carry open CORS", made.cors);

  const room = (verb = "", token = "") =>
    `${BASE}/rooms/${code}${verb ? `/${verb}` : ""}${token ? `?token=${token}` : ""}`;
  check("a join of an unknown code is 404",
        (await api("POST", `${BASE}/rooms/QQQQQ0/join`)).status === 404);
  const joined = await api("POST", room("join"));
  const G = joined.body.token as string;
  check("a join is 200, with a token of its own and credentials",
        joined.status === 200 && typeof G === "string" && G !== H
        && Array.isArray(joined.body.iceServers), JSON.stringify(joined.body));
  check("a second join is 409", (await api("POST", room("join"))).status === 409);

  const early = await api("GET", room("offer", G));
  check("player 2 asking before the offer is posted gets null",
        early.status === 200 && early.body.sdp === null, JSON.stringify(early.body));
  check("the offer is refused under player 2's token (403)",
        (await api("PUT", room("offer", G), { sdp: "v=0 offer" })).status === 403);
  check("...and under no token", (await api("PUT", room("offer"), { sdp: "v=0 offer" })).status === 403);
  check("a PUT with no SDP is 400", (await api("PUT", room("offer", H), {})).status === 400);
  check("the host's offer goes in", (await api("PUT", room("offer", H), { sdp: "v=0 offer" })).status === 200);
  const offer = await api("GET", room("offer", G));
  check("...and comes out to player 2", offer.body.sdp === "v=0 offer", JSON.stringify(offer.body));
  check("...and not to the host's token (403)", (await api("GET", room("offer", H))).status === 403);

  check("the host asking before the answer is posted gets null",
        (await api("GET", room("answer", H))).body.sdp === null);
  check("the answer is refused under the host's token (403)",
        (await api("PUT", room("answer", H), { sdp: "v=0 answer" })).status === 403);
  check("player 2's answer goes in",
        (await api("PUT", room("answer", G), { sdp: "v=0 answer" })).status === 200);
  const answer = await api("GET", room("answer", H));
  check("...and comes out to the host", answer.body.sdp === "v=0 answer", JSON.stringify(answer.body));

  check("player 2 cannot end the room (403)", (await api("DELETE", room("", G))).status === 403);
  check("the host can", (await api("DELETE", room("", H))).status === 200);
  check("...after which it is gone (404)", (await api("GET", room("offer", G))).status === 404);
  const pre = await api("OPTIONS", `${BASE}/rooms`);
  check("a preflight is 204 with CORS", pre.status === 204 && pre.cors, `${pre.status}`);
}

// -- the Node binding, on a real server ----------------------------------------

const mm = nodeMatchmaker(configFromEnv(env));
const server = createServer((req, res) => {
  if (!handle(mm, BASE, req, res)) {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const port = (server.address() as AddressInfo).port;
const nodeApi: Api = async (method, path, body) => reply(await fetch(`http://127.0.0.1:${port}${path}`, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
}));

// -- the Worker, in-process -----------------------------------------------------

/** Durable Objects faked: one `MatchRoom` per name, each with a map for storage. */
function fakeNamespace(workerEnv: Record<string, unknown>) {
  const objects = new Map<string, MatchRoom>();
  const ns = {
    objects,
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      let o = objects.get(id as string);
      if (!o) {
        const kept = new Map<string, unknown>();
        const state: DurableObjectState = {
          storage: {
            get: async <T>(k: string) => kept.get(k) as T | undefined,
            put: async (k: string, v: unknown) => { kept.set(k, structuredClone(v)); },
            delete: async (k: string) => kept.delete(k),
          },
        };
        o = new MatchRoom(state, { ...workerEnv, ROOMS: ns } as Env);
        objects.set(id as string, o);
      }
      return o;
    },
  };
  return ns;
}
const ns = fakeNamespace(env);
const workerEnv = { ...env, ROOMS: ns } as unknown as Env;
const workerApi: Api = async (method, path, body) => reply(await worker.fetch(
  new Request(`https://hotd2.example.workers.dev${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  }), workerEnv));

try {
  await suite("the Node binding (dev server, npm run matchmaker)", nodeApi, "127.0.0.1");
  await suite("the Cloudflare Worker, in-process", workerApi, "hotd2.example.workers.dev");

  console.log("\nalone");
  let now = 1_000_000;
  const kept = new Map<string, Room>();
  const aged = new Matchmaker(configFromEnv({}), {
    store: {
      get: async (c) => kept.get(c), put: async (r) => { kept.set(r.code, r); },
      delete: async (c) => { kept.delete(c); },
    },
    hmac: async () => "", random: (n) => new Uint8Array(randomBytes(n)), now: () => now,
  });
  const old = await aged.create();
  now += ROOM_TTL_MS + 1;
  let gone = 0;
  try { await aged.request(old.code, "join", "POST", "", null); } catch (e) {
    gone = (e as { status?: number }).status ?? 0;
  }
  check("a room is gone after an hour (404)", gone === 404, `${gone}`);

  // The Worker draws a code that is live, and draws again.
  const first = await workerApi("POST", `${BASE}/rooms`);
  const objects = ns.objects.size;
  const real = crypto.getRandomValues.bind(crypto);
  let forced = 1;
  const liveBytes = new Uint8Array([...String(first.body.code)].map(
    (ch) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789".indexOf(ch)));
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    value: <T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint8Array && a.length === 6 && forced > 0) {
        forced--;
        a.set(liveBytes);
        return a;
      }
      return real(a as never) as T;
    },
  });
  try {
    const second = await workerApi("POST", `${BASE}/rooms`);
    check("a Worker whose first drawn code is live draws another",
          second.status === 200 && forced === 0 && second.body.code !== first.body.code
          && ns.objects.size === objects + 1,
          `${first.body.code} then ${second.body.code} (${second.status})`);
  } finally {
    delete (crypto as unknown as Record<string, unknown>).getRandomValues;
  }

  // Which matchmaker a page uses.
  const { DEFAULT_MATCHMAKER, matchmakerBase } = await import("../src/app/net/matchmaker");
  (globalThis as { location?: unknown }).location = { href: "http://127.0.0.1:5173/?stage=1" };
  check("a page uses the deployed matchmaker unless told otherwise",
        matchmakerBase("?stage=1") === DEFAULT_MATCHMAKER
        && DEFAULT_MATCHMAKER.startsWith("https://"), matchmakerBase("?stage=1"));
  check("...?matchmaker=local is the dev server's own, beside the page",
        matchmakerBase("?matchmaker=local") === "http://127.0.0.1:5173/net/matchmaker",
        matchmakerBase("?matchmaker=local"));
  check("...and ?matchmaker=<url> is that one, trailing slash or not",
        matchmakerBase("?matchmaker=https://m.example/net/matchmaker/")
          === "https://m.example/net/matchmaker");

  // Cloudflare's credential answer, in both of its shapes.
  const cf = { keyId: "key", token: "tok", ttlSeconds: 600 };
  const answering = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const list = await cloudflareIce(cf, answering({ iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp",
             "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" },
  ] }));
  check("Cloudflare's list of ICE servers is read: the credentialed entry, port 53 dropped",
        list.length === 1 && [list[0].urls].flat().length === 2
        && ![list[0].urls].flat().some((u) => u.includes(":53")) && list[0].credential === "c",
        JSON.stringify(list));
  const one = await cloudflareIce(cf, answering({ iceServers: {
    urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" } }));
  check("...and so is the older endpoint's single object", one.length === 1, JSON.stringify(one));
  const warn = console.warn;
  console.warn = () => {};
  const refused = await cloudflareIce(cf, answering({ error: "bad token" }, 401));
  console.warn = warn;
  check("a refusal costs the relay, not the room: no servers, no throw", refused.length === 0);
  let asked: { url: string; init?: RequestInit } | null = null;
  await cloudflareIce(cf, (async (url: string, init?: RequestInit) => {
    asked = { url, init };
    return new Response(JSON.stringify({ iceServers: [] }));
  }) as unknown as typeof fetch);
  const a = asked as { url: string; init?: RequestInit } | null;
  check("the request is Cloudflare's generate-ice-servers, with the token as bearer and the TTL",
        a?.url === "https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers"
        && (a.init?.headers as Record<string, string>)?.Authorization === "Bearer tok"
        && JSON.parse(String(a.init?.body)).ttl === 600, JSON.stringify(a));
} catch (e) {
  failures++;
  console.log(`  FAIL  the run threw -- ${(e as Error).stack ?? e}`);
} finally {
  server.closeAllConnections();
  server.close();
}

console.log(`\nmatchmaker: ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
