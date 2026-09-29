/**
 * The TURN relay (`tools/signal/turn.ts`), driven over real UDP on loopback
 * by a client written from the RFC rather than from the server.
 *
 * It asserts what a browser depends on:
 *
 * - a Binding request is answered with the address it came from;
 * - an Allocate without credentials is refused 401 with a realm and a nonce,
 *   and one with the credentials `rooms.ts` mints gets a relay, in a
 *   response whose MESSAGE-INTEGRITY checks under the same key; a
 *   retransmission gets the same relay, and a wrong password or an expired
 *   username is refused;
 * - nothing crosses a relay until **both** ends have a permission for the
 *   other, and then a Send indication arrives as a Data indication from the
 *   sender's relay address;
 * - a bound channel carries ChannelData both ways;
 * - a FINGERPRINT asked for is sent back and checks;
 * - a Refresh of lifetime 0 frees the relay.
 *
 * What only a browser can show -- that Chrome's TURN client accepts all of
 * this -- `tools/net_pair.mjs` shows, with `?relay=1`.
 *
 * Run with `node tools/run_test.mjs test/turn.test.ts`. No bundle, loopback
 * only, about a second.
 */
import { createSocket, type Socket } from "node:dgram";
import {
  Attr, Cls, Method, StunWriter, attr, crc32, integrityOk, longTermKey, parseStun,
  readXorAddress, restPassword, startTurn, xorAddress, type StunMessage,
} from "../tools/signal/turn";

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

/** A UDP socket that keeps what arrives and hands it out on request. */
class Client {
  private readonly inbox: Buffer[] = [];
  private wake: (() => void) | null = null;
  constructor(readonly sock: Socket, readonly port: number, private readonly server: number) {
    sock.on("message", (b) => {
      this.inbox.push(b);
      this.wake?.();
    });
  }

  static async open(server: number): Promise<Client> {
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.bind(0, "127.0.0.1", () => r()));
    return new Client(s, s.address().port, server);
  }

  send(b: Buffer): void {
    this.sock.send(b, this.server, "127.0.0.1");
  }

  /** The first packet `want` accepts, within `ms`, or null. */
  async next(want: (b: Buffer) => boolean, ms = 800): Promise<Buffer | null> {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex(want);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      const left = end - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.wake = () => { clearTimeout(t); r(); };
      });
      this.wake = null;
    }
  }

  /** Send a request and wait for the response with its transaction id. */
  async ask(method: number, add: (w: StunWriter) => void, key?: Buffer,
            fingerprint = false, tid = Buffer.from(Array.from({ length: 12 }, () => Math.random() * 256 | 0))):
      Promise<StunMessage | null> {
    const w = new StunWriter(method, Cls.Request, tid);
    add(w);
    this.send(w.finish(key, fingerprint));
    const b = await this.next((x) => {
      const m = parseStun(x);
      return !!m && m.tid.equals(tid);
    });
    return b && parseStun(b);
  }

  close(): void {
    this.sock.close();
  }
}

const code = (m: StunMessage | null): number => {
  const e = m && attr(m, Attr.ErrorCode);
  return e ? e[2] * 100 + e[3] : 0;
};
const transport = Buffer.from([17, 0, 0, 0]);

const secret = "a-shared-secret";
const turn = await startTurn({ secret, port: 0, relayIp: "127.0.0.1" });
const clients: Client[] = [];
try {
  const username = `${Math.floor(Date.now() / 1000) + 600}:ROOM01`;
  const key = longTermKey(username, "hotd2", restPassword(secret, username));

  console.log("\nturn: STUN, and the credential challenge");
  const a = await Client.open(turn.port);
  clients.push(a);
  const bind = await a.ask(Method.Binding, () => {});
  const mapped = bind && readXorAddress(attr(bind, Attr.XorMappedAddress) ?? Buffer.alloc(0));
  check("a Binding request is answered with the address it came from",
        bind?.cls === Cls.Success && mapped?.address === "127.0.0.1" && mapped.port === a.port,
        JSON.stringify(mapped));

  const bare = await a.ask(Method.Allocate, (w) => w.add(Attr.RequestedTransport, transport));
  const realm = bare && attr(bare, Attr.Realm);
  const nonce = bare && attr(bare, Attr.Nonce);
  check("an Allocate without credentials is refused 401, with a realm and a nonce",
        code(bare) === 401 && realm?.toString() === "hotd2" && !!nonce?.length, `code ${code(bare)}`);

  const auth = (w: StunWriter, user = username) => w
    .add(Attr.Username, Buffer.from(user)).add(Attr.Realm, realm!).add(Attr.Nonce, nonce!);
  const tid = Buffer.alloc(12, 7);
  const ok = await a.ask(Method.Allocate, (w) => auth(w.add(Attr.RequestedTransport, transport)),
                         key, true, tid);
  const relayA = ok && readXorAddress(attr(ok, Attr.XorRelayedAddress) ?? Buffer.alloc(0));
  check("with the minted credentials it gets a relay", ok?.cls === Cls.Success
        && relayA?.address === "127.0.0.1" && relayA.port > 0, `code ${code(ok)}`);
  check("...in a response whose MESSAGE-INTEGRITY checks under the same key",
        !!ok && integrityOk(ok, key));
  const fp = ok && ok.attrs.find((x) => x.type === Attr.Fingerprint);
  const fpOk = !!ok && !!fp
    && ((crc32((() => {
      const b = Buffer.from(ok.raw.subarray(0, fp.at));
      b.writeUInt16BE(fp.at - 20 + 8, 2);
      return b;
    })()) ^ 0x5354554e) >>> 0) === fp.value.readUInt32BE(0);
  check("...and the FINGERPRINT it was asked for, which checks", fpOk);
  const again = await a.ask(Method.Allocate, (w) => auth(w.add(Attr.RequestedTransport, transport)),
                            key, true, tid);
  const relayAgain = again && readXorAddress(attr(again, Attr.XorRelayedAddress) ?? Buffer.alloc(0));
  check("a retransmission gets the same relay", relayAgain?.port === relayA?.port,
        `${relayAgain?.port} vs ${relayA?.port}`);

  const c = await Client.open(turn.port);
  clients.push(c);
  const wrong = longTermKey(username, "hotd2", "not-the-password");
  const bad = await c.ask(Method.Allocate, (w) => auth(w.add(Attr.RequestedTransport, transport)), wrong);
  check("a wrong password is refused 401", code(bad) === 401, `code ${code(bad)}`);
  const old = `${Math.floor(Date.now() / 1000) - 5}:ROOM01`;
  const oldKey = longTermKey(old, "hotd2", restPassword(secret, old));
  const stale = await c.ask(Method.Allocate,
                            (w) => auth(w.add(Attr.RequestedTransport, transport), old), oldKey);
  check("an expired username is refused 401", code(stale) === 401, `code ${code(stale)}`);

  console.log("\nturn: permissions, indications, channels");
  const b = await Client.open(turn.port);
  clients.push(b);
  const okB = await b.ask(Method.Allocate, (w) => auth(w.add(Attr.RequestedTransport, transport)), key);
  const relayB = okB && readXorAddress(attr(okB, Attr.XorRelayedAddress) ?? Buffer.alloc(0));
  check("a second client gets a relay of its own", !!relayB && relayB.port !== relayA?.port);

  const sendTo = (from: Client, to: { address: string; port: number }, text: string) =>
    from.send(new StunWriter(Method.Send, Cls.Indication)
      .add(Attr.XorPeerAddress, xorAddress(to.address, to.port))
      .add(Attr.Data, Buffer.from(text)).finish());
  const dataFrom = (want: string) => (x: Buffer) => {
    const m = parseStun(x);
    return !!m && m.method === Method.Data && attr(m, Attr.Data)?.toString() === want;
  };

  sendTo(a, relayB!, "too early");
  check("nothing crosses before either end has a permission",
        (await b.next(dataFrom("too early"), 300)) === null);
  const permit = (cl: Client, peer: { address: string; port: number }) =>
    cl.ask(Method.CreatePermission,
           (w) => auth(w.add(Attr.XorPeerAddress, xorAddress(peer.address, peer.port))), key);
  const pa = await permit(a, relayB!);
  check("CreatePermission succeeds", pa?.cls === Cls.Success && integrityOk(pa, key),
        `code ${code(pa)}`);
  // On loopback both relays share an address, so B's permission is the one
  // that is still missing.
  const pb = await permit(b, relayA!);
  check("...on both ends", pb?.cls === Cls.Success, `code ${code(pb)}`);
  sendTo(a, relayB!, "hello");
  const got = await b.next(dataFrom("hello"));
  const from = got && readXorAddress(attr(parseStun(got)!, Attr.XorPeerAddress)!);
  check("a Send indication arrives as a Data indication from the sender's relay",
        !!got && from?.port === relayA?.port, JSON.stringify(from));

  const bound = await b.ask(Method.ChannelBind, (w) => auth(w
    .add(Attr.ChannelNumber, Buffer.from([0x40, 0x01, 0, 0]))
    .add(Attr.XorPeerAddress, xorAddress(relayA!.address, relayA!.port))), key);
  check("ChannelBind succeeds", bound?.cls === Cls.Success, `code ${code(bound)}`);
  sendTo(a, relayB!, "again");
  const cd = await b.next((x) => x.length >= 4 && x.readUInt16BE(0) === 0x4001);
  check("a bound peer's packets arrive as ChannelData",
        !!cd && cd.readUInt16BE(2) === 5 && cd.subarray(4, 9).toString() === "again",
        cd?.toString("hex"));
  const back = Buffer.concat([Buffer.from([0x40, 0x01, 0, 4]), Buffer.from("back")]);
  b.send(back);
  check("...and ChannelData goes the other way", !!(await a.next(dataFrom("back"))));

  const live = turn.allocations;
  const freed = await b.ask(Method.Refresh, (w) => auth(w.add(Attr.Lifetime, Buffer.from([0, 0, 0, 0]))), key);
  check(`a Refresh of lifetime 0 frees the relay (${live} -> ${turn.allocations})`,
        freed?.cls === Cls.Success && turn.allocations === live - 1, `code ${code(freed)}`);
} catch (e) {
  failures++;
  console.log(`  FAIL  the run threw -- ${(e as Error).stack ?? e}`);
} finally {
  for (const c of clients) c.close();
  await turn.close();
}

console.log(`\nturn: ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
