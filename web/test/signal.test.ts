/**
 * The netplay rendezvous, over HTTP.
 *
 * `tools/signal/rooms.ts` is the protocol; `node.ts` binds it to Node's
 * `http` for the dev server and `npm run signal`, and `worker.ts` to a
 * Cloudflare Worker with one Durable Object per room. The same script runs
 * against both: the Node binding on a real server on a free port, read with
 * `fetch` and a stream reader the way a page reads it, and the Worker's
 * `fetch` called in-process with its namespace faked by a map. The second
 * proves the Worker's routing, its code draw and its streams; it proves
 * nothing about Cloudflare's runtime.
 *
 * Of each, it asserts:
 *
 * - create returns a six-character code from the unambiguous alphabet, a
 *   token, the STUN servers, and a TURN credential that is
 *   base64(HMAC-SHA1(secret, username)) with the username's expiry about now
 *   plus the TTL;
 * - a join of an unknown code is 404 and a second join 409;
 * - the host hears `{t:"peer", joined:true}` whether the replica joins while
 *   it listens or before it starts to (queued);
 * - `send` is relayed in order both ways;
 * - a replica that leaves is announced with `joined:false`, and its slot is
 *   free for a new join;
 * - a host that leaves sends `{t:"closed"}` to the replica and the room is
 *   gone;
 * - a stream that reconnects on the same token replaces the old one and gets
 *   what was said while it was away;
 * - a wrong token is 403.
 *
 * And of `Rooms` alone, with its clock injected: a room idle past `idleMs`
 * with nobody listening is swept, and one with a listener is not.
 *
 * Three of these found bugs when they were written -- the stream's refusal
 * arriving as an empty 200, the idle clock starting when a listener came
 * rather than when it went, and the host hearing a join twice -- and they are
 * plain checks now that those are fixed.
 *
 * Run with `node tools/run_test.mjs test/signal.test.ts`. No bundle, nothing
 * beyond loopback; about a second.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isDeepStrictEqual } from "node:util";
import {
  DEFAULT_STUN, Rooms, configFromEnv, type IceServer, type Signal,
} from "../tools/signal/rooms";
import { handle, nodeRooms } from "../tools/signal/node";
import worker, {
  SignalRoom, type DurableObjectId, type DurableObjectNamespace, type DurableObjectStub,
  type Env,
} from "../tools/signal/worker";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passes++; console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
}

const BASE = "/net/signal";
/** No 0/O, 1/I/L: the alphabet `rooms.ts` promises, restated as the spec. */
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const SECRET = "not-a-real-secret";
const TTL = 3600;
const TURN_URLS = ["turn:turn.test:3478?transport=udp", "turns:turn.test:443?transport=tcp"];
/** How long to wait for something that should come. */
const WAIT_MS = 2000;
/** How long to wait to be sure something does not. */
const QUIET_MS = 150;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const same = isDeepStrictEqual;
/** A `peer` signal saying player 2 is (or is not) in, and, when given, on which join. */
const isPeer = (v: unknown, j: boolean, n?: number): boolean => {
  const s = v as Signal | null;
  return !!s && s.t === "peer" && s.joined === j && (n === undefined || s.n === n);
};

// -- a client -------------------------------------------------------------------

interface Api {
  name: string;
  call(path: string, init?: RequestInit): Promise<Response>;
}

interface Posted {
  status: number;
  body: unknown;
  cors: boolean;
}

async function post(api: Api, path: string, body: unknown = {}): Promise<Posted> {
  const res = await api.call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, cors: res.headers.get("access-control-allow-origin") === "*" };
}

const open: Stream[] = [];

/** One event stream, parsed as `EventSource` would and read at the test's pace. */
class Stream {
  readonly events: unknown[] = [];
  comments = 0;
  ended = false;
  private taken = 0;
  private wake: (() => void) | null = null;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array> | null;

  constructor(readonly res: Response, private readonly ac: AbortController) {
    open.push(this);
    this.reader = res.ok && res.body ? res.body.getReader() : null;
    if (this.reader) void this.pump(this.reader);
    else this.ended = true;
  }

  static async open(api: Api, code: string, token: string): Promise<Stream> {
    const ac = new AbortController();
    const q = `?token=${encodeURIComponent(token)}`;
    return new Stream(await api.call(`${BASE}/rooms/${code}/events${q}`, { signal: ac.signal }), ac);
  }

  get status(): number { return this.res.status; }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
          const lines = buf.slice(0, i).split("\n");
          buf = buf.slice(i + 2);
          const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart());
          if (data.length) this.events.push(JSON.parse(data.join("\n")));
          else this.comments++;
        }
        this.poke();
      }
    } catch { /* aborted by `close` */ }
    this.ended = true;
    this.poke();
  }

  private poke(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  async until(test: () => boolean, ms = WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (!test()) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await new Promise<void>((r) => {
        const t = setTimeout(() => { this.wake = null; r(); }, left);
        this.wake = () => { clearTimeout(t); r(); };
      });
    }
    return true;
  }

  /** The next event; null if none comes within `ms` or the stream ends first. */
  async next(ms = WAIT_MS): Promise<unknown> {
    await this.until(() => this.taken < this.events.length || this.ended, ms);
    return this.taken < this.events.length ? this.events[this.taken++] : null;
  }

  /** Whether the server ends the stream within `ms`. */
  end(ms = WAIT_MS): Promise<boolean> {
    return this.until(() => this.ended, ms);
  }

  close(): void {
    this.ac.abort();
    void this.reader?.cancel().catch(() => {});
  }
}

function checkTurn(label: string, ice: IceServer | undefined, code: string, t0: number): void {
  check(`${label}: the TURN urls are the configured ones`, same(ice?.urls, TURN_URLS),
        JSON.stringify(ice));
  const username = ice?.username ?? "";
  const [expiry, forCode] = username.split(":");
  check(`${label}: the TURN username is <expiry>:<code>`,
        forCode === code && /^\d+$/.test(expiry), username);
  const drift = Number(expiry) - (t0 + TTL);
  check(`${label}: ...and expires about now + TTL`, Math.abs(drift) <= 5, `${drift.toFixed(1)} s off`);
  const want = createHmac("sha1", SECRET).update(username).digest("base64");
  check(`${label}: the TURN credential is base64(HMAC-SHA1(secret, username))`,
        ice?.credential === want, `${ice?.credential} vs ${want}`);
}

// -- the protocol ---------------------------------------------------------------

interface Created { code: string; token: string; iceServers: IceServer[] }
interface Joined { token: string; iceServers: IceServer[] }

async function suite(api: Api): Promise<void> {
  const n = api.name;
  const rooms = `${BASE}/rooms`;
  const at = (code: string, verb: string, token: string) =>
    `${rooms}/${code}/${verb}?token=${encodeURIComponent(token)}`;
  const say = (code: string, token: string, data: unknown) => post(api, at(code, "send", token), { data });
  // A refused stream must be refused with its status, not an empty 200 that
  // `EventSource` would reconnect to for ever.
  const eventsStatus = (name: string, ok: boolean, detail: string) => check(name, ok, detail);

  console.log(`\n${n}`);

  const pre = await api.call(rooms, { method: "OPTIONS" });
  check(`${n}: a preflight is 204 with open CORS`,
        pre.status === 204 && pre.headers.get("access-control-allow-origin") === "*"
          && /content-type/i.test(pre.headers.get("access-control-allow-headers") ?? ""),
        `${pre.status}`);

  // -- create -------------------------------------------------------------------
  const t0 = Date.now() / 1000;
  const made = await post(api, rooms);
  const room = made.body as Created;
  check(`${n}: create is 200, with CORS`, made.status === 200 && made.cors, `${made.status}`);
  check(`${n}: create returns a six-character code from the unambiguous alphabet`,
        CODE.test(room.code), room.code);
  check(`${n}: ...and a 128-bit token`, /^[0-9a-f]{32}$/.test(room.token), room.token);
  check(`${n}: ...and the STUN servers first`, same(room.iceServers[0], { urls: DEFAULT_STUN }),
        JSON.stringify(room.iceServers[0]));
  checkTurn(`${n}: create`, room.iceServers[1], room.code, t0);
  const C = room.code, H = room.token;

  // -- join ---------------------------------------------------------------------
  // `0` is not in the alphabet, so this is a code nobody can have been given.
  check(`${n}: joining an unknown code is 404`, (await post(api, `${rooms}/000000/join`)).status === 404);

  const host = await Stream.open(api, C, H);
  check(`${n}: the host's stream is a 200 text/event-stream`,
        host.status === 200 && /^text\/event-stream/.test(host.res.headers.get("content-type") ?? ""),
        `${host.status} ${host.res.headers.get("content-type")}`);
  const j = await post(api, `${rooms}/${C.toLowerCase()}/join`);
  const rep = j.body as Joined;
  check(`${n}: join is 200 (and the code is case-insensitive)`, j.status === 200, `${j.status}`);
  check(`${n}: ...with a token of its own`, /^[0-9a-f]{32}$/.test(rep.token) && rep.token !== H);
  checkTurn(`${n}: join`, rep.iceServers[1], C, t0);
  check(`${n}: the host, listening, hears {peer, joined:true} when the replica joins`,
        isPeer(await host.next(), true));
  check(`${n}: a second join is 409`, (await post(api, `${rooms}/${C}/join`)).status === 409);

  // -- relay --------------------------------------------------------------------
  const replica = await Stream.open(api, C, rep.token);
  const offer = { kind: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=é漢字\r\n" };
  let sent = true;
  sent &&= (await say(C, H, offer)).status === 200;
  for (let i = 0; i < 5; i++) sent &&= (await say(C, H, { i })).status === 200;
  const toReplica = [];
  for (let i = 0; i < 6; i++) toReplica.push(await replica.next());
  check(`${n}: host -> replica: every send is 200 and arrives, in order, intact`,
        sent && same(toReplica, [offer, ...[0, 1, 2, 3, 4].map((i) => ({ i }))].map(
          (data) => ({ t: "signal", data }))),
        JSON.stringify(toReplica));
  sent = true;
  for (let i = 0; i < 5; i++) sent &&= (await say(C, rep.token, { r: i })).status === 200;
  const toHost = [];
  for (let i = 0; i < 5; i++) toHost.push(await host.next());
  check(`${n}: replica -> host: every send is 200 and arrives, in order`,
        sent && same(toHost, [0, 1, 2, 3, 4].map((r) => ({ t: "signal", data: { r } }))),
        JSON.stringify(toHost));
  const big = await say(C, H, "x".repeat(70 * 1024));
  check(`${n}: a message over 64 KiB is 413`, big.status === 413, `${big.status}`);

  // -- wrong tokens -------------------------------------------------------------
  const wrong = "0".repeat(32);
  check(`${n}: send with a wrong token is 403`, (await say(C, wrong, 1)).status === 403);
  check(`${n}: leave with a wrong token is 403`, (await post(api, at(C, "leave", wrong))).status === 403);
  const badEvents = await Stream.open(api, C, wrong);
  eventsStatus(`${n}: an event stream with a wrong token is 403`, badEvents.status === 403,
               `got ${badEvents.status}`);
  badEvents.close();
  const goneEvents = await Stream.open(api, "000000", wrong);
  eventsStatus(`${n}: an event stream for an unknown room is 404`, goneEvents.status === 404,
               `got ${goneEvents.status}`);
  goneEvents.close();

  // -- reconnects ---------------------------------------------------------------
  const replica2 = await Stream.open(api, C, rep.token);
  check(`${n}: a second stream on the same token ends the first`, await replica.end());
  await say(C, H, "after-replace");
  check(`${n}: ...and takes its place`, same(await replica2.next(), { t: "signal", data: "after-replace" }));
  replica2.close();
  await sleep(100); // for the server to see the drop
  await say(C, H, "while-away-1");
  await say(C, H, "while-away-2");
  const replica3 = await Stream.open(api, C, rep.token);
  const away = [await replica3.next(), await replica3.next()];
  check(`${n}: a stream that reconnects gets what was said while it was away, in order`,
        same(away, [{ t: "signal", data: "while-away-1" }, { t: "signal", data: "while-away-2" }]),
        JSON.stringify(away));
  host.close();
  const host2 = await Stream.open(api, C, H);
  check(`${n}: a host that reconnects is told the replica is there, on the same join`,
        isPeer(await host2.next(), true, 1));

  // -- a rejoin: player 2's connection died without a leave getting through --
  const rj = await post(api, `${rooms}/${C}/join`, { token: rep.token });
  check(`${n}: a join with the replica's own token is a rejoin: 200, the same token`,
        rj.status === 200 && (rj.body as Joined).token === rep.token,
        `${rj.status} ${JSON.stringify(rj.body)}`);
  check(`${n}: ...and the host hears player 2 back, on a new join number`,
        isPeer(await host2.next(), true, 2));
  check(`${n}: a join with some other token while the slot is held is 409`,
        (await post(api, `${rooms}/${C}/join`, { token: "not-theirs" })).status === 409);

  // -- the replica leaves -------------------------------------------------------
  const left = await post(api, at(C, "leave", rep.token));
  check(`${n}: the replica's leave is 200`, left.status === 200, `${left.status}`);
  check(`${n}: the host hears {peer, joined:false}`, isPeer(await host2.next(), false));
  check(`${n}: ...and the replica's own stream is ended`, await replica3.end());
  const nobody = await say(C, H, 1);
  check(`${n}: a send to nobody is dropped, and says so`, nobody.status === 200
        && (nobody.body as { delivered?: boolean }).delivered === false,
        `${nobody.status}`);
  check(`${n}: the old replica token is refused with 403`, (await say(C, rep.token, 1)).status === 403);
  const j2 = await post(api, `${rooms}/${C}/join`);
  check(`${n}: the slot is free: a new join is 200`, j2.status === 200, `${j2.status}`);
  check(`${n}: ...and the host hears it, as join 3`, isPeer(await host2.next(), true, 3));
  const rep2 = j2.body as Joined;

  // -- the host leaves ----------------------------------------------------------
  const replicaB = await Stream.open(api, C, rep2.token);
  check(`${n}: the host's leave is 200`, (await post(api, at(C, "leave", H))).status === 200);
  const closed = await replicaB.next() as Signal | null;
  check(`${n}: the replica hears {t:"closed"}`,
        closed?.t === "closed" && typeof closed.reason === "string", JSON.stringify(closed));
  check(`${n}: ...and its stream is ended`, await replicaB.end());
  check(`${n}: ...and so is the host's`, await host2.end());
  check(`${n}: the room is gone: join is 404`, (await post(api, `${rooms}/${C}/join`)).status === 404);
  check(`${n}: ...and send is 404`, (await say(C, rep2.token, 1)).status === 404);
  const afterEvents = await Stream.open(api, C, H);
  eventsStatus(`${n}: ...and an event stream is 404`, afterEvents.status === 404, `got ${afterEvents.status}`);
  afterEvents.close();

  // -- a join before the host listens -------------------------------------------
  const r2 = (await post(api, rooms)).body as Created;
  const early = await post(api, `${rooms}/${r2.code}/join`);
  const late = await Stream.open(api, r2.code, r2.token);
  check(`${n}: a host that starts listening after the replica joined hears {peer, joined:true}`,
        early.status === 200 && isPeer(await late.next(), true));
  const again = await late.next(QUIET_MS);
  check(`${n}: ...once`, again === null, `then ${JSON.stringify(again)} again`);
  await post(api, at(r2.code, "leave", r2.token));
}

// -- Rooms and its clock --------------------------------------------------------

async function sweeping(): Promise<void> {
  console.log("\nRooms.sweep, with a clock");
  let clock = 1_000_000;
  const cfg = { ...configFromEnv({}), idleMs: 1000 };
  const rooms = new Rooms(cfg, async () => "", (k) => new Uint8Array(randomBytes(k)), () => clock);

  const plain = await rooms.create();
  check("with no TURN configured, a room hands out STUN only",
        same(plain.iceServers, [{ urls: DEFAULT_STUN }]), JSON.stringify(plain.iceServers));
  clock += 900;
  rooms.sweep();
  check("a room idle for less than idleMs stays", rooms.size === 1);
  clock += 200;
  rooms.sweep();
  check("a room idle past idleMs with nobody listening is swept", rooms.size === 0);

  const b = await rooms.create();
  let pings = 0;
  const detach = rooms.attach(b.code, b.token, { write() {}, ping() { pings++; }, close() {} });
  clock += 5000;
  rooms.sweep();
  check("a room with a listener outlives idleMs, and its stream is pinged", rooms.size === 1 && pings === 1);
  detach();
  clock += 10;
  rooms.sweep();
  check("...and has idleMs from when the listener goes", rooms.size === 1,
        "swept at once");
  clock += 1100;
  rooms.sweep();
  check("...and is swept idleMs after that", rooms.size === 0);
}

// -- the Worker's namespace, faked ----------------------------------------------

class FakeNamespace implements DurableObjectNamespace {
  readonly objects = new Map<string, SignalRoom>();
  env: Env | null = null;
  idFromName(name: string): DurableObjectId {
    return { toString: () => name };
  }
  get(id: DurableObjectId): DurableObjectStub {
    const name = id.toString();
    const o = this.objects.get(name) ?? new SignalRoom({ id }, this.env!);
    this.objects.set(name, o);
    return { fetch: (req) => o.fetch(req) };
  }
}

async function workerOnly(api: Api, ns: FakeNamespace): Promise<void> {
  console.log(`\n${api.name}, its own`);
  const internal = await post(api, "/internal/create", { code: "AAAAAA", seed: [0, 0, 0, 0, 0, 0] });
  check("the Worker's own create request is not reachable from outside", internal.status === 404,
        `${internal.status}`);

  // Force the next two code draws to the same bytes: the second create must
  // be refused by the object that holds the first and draw again.
  const real = crypto.getRandomValues.bind(crypto);
  let forced = 2;
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    writable: true,
    value: (a: ArrayBufferView): ArrayBufferView => {
      if (a instanceof Uint8Array && a.length === 6 && forced > 0) {
        forced--;
        a.fill(7);
        return a;
      }
      return real(a);
    },
  });
  try {
    const first = (await post(api, `${BASE}/rooms`)).body as Created;
    const objects = ns.objects.size;
    const second = await post(api, `${BASE}/rooms`);
    const code2 = (second.body as Created).code;
    check("a create whose code is live draws another",
          second.status === 200 && forced === 0 && CODE.test(code2) && code2 !== first.code,
          `${first.code} then ${code2} (${second.status})`);
    check("...having asked the live room's object, and then a fresh one",
          ns.objects.size === objects + 1);
    const intact = await post(api, `${BASE}/rooms/${first.code}/send?token=${first.token}`, { data: 1 });
    // Its token still names its host -- a replaced room would answer 403 --
    // and it still has nobody to send to.
    check("...and the first room is untouched: its host is still its host",
          intact.status === 200 && (intact.body as { delivered?: boolean }).delivered === false,
          `${intact.status} ${JSON.stringify(intact.body)}`);
    await post(api, `${BASE}/rooms/${first.code}/leave?token=${first.token}`);
    await post(api, `${BASE}/rooms/${code2}/leave?token=${(second.body as Created).token}`);
  } finally {
    delete (crypto as unknown as Record<string, unknown>).getRandomValues;
  }
}

// -- run ------------------------------------------------------------------------

const turnEnv = {
  HOTD2_TURN_URLS: TURN_URLS.join(", "),
  HOTD2_TURN_SECRET: SECRET,
  HOTD2_TURN_TTL: String(TTL),
};

const nodeRoomSet = nodeRooms(configFromEnv(turnEnv));
const server = createServer((req, res) => {
  if (!handle(nodeRoomSet, BASE, req, res)) {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
const nodeApi: Api = {
  name: `node.ts on :${port}`,
  call: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
};

// A TOML number arrives in a Worker's env as a number: the TTL is one here.
const ns = new FakeNamespace();
const env: Env = { ...turnEnv, HOTD2_TURN_TTL: TTL, ROOMS: ns };
ns.env = env;
const workerApi: Api = {
  name: "worker.ts, in-process",
  call: (path, init) => worker.fetch(new Request(`https://signal.test${path}`, init), env),
};

try {
  await suite(nodeApi);
  // The ping is `Rooms.sweep`'s; that it reaches a stream as a comment is node.ts's.
  const pinged = (await post(nodeApi, `${BASE}/rooms`)).body as Created;
  const ps = await Stream.open(nodeApi, pinged.code, pinged.token);
  await ps.until(() => ps.comments >= 1);
  nodeRoomSet.sweep();
  check(`${nodeApi.name}: a sweep pings an open stream with an SSE comment`,
        await ps.until(() => ps.comments >= 2) && ps.events.length === 0);
  await suite(workerApi);
  await workerOnly(workerApi, ns);
  await sweeping();
} catch (e) {
  failures++;
  console.log(`  FAIL  the run threw -- ${(e as Error).stack ?? e}`);
} finally {
  for (const s of open) s.close();
  server.closeAllConnections();
  server.close();
}

console.log(`\nsignal: ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
