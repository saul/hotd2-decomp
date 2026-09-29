/**
 * A TURN relay: RFC 8656 over UDP, the part a browser uses, small enough to
 * read in one sitting. The dev server runs one beside its rendezvous, and so
 * can the standalone server (`serve.ts --turn`), so a session works where no
 * direct path does -- which on the machine this was written on is every
 * session between two tabs: Chrome hides each tab's address behind an mDNS
 * name the machine cannot resolve, and the router does not route its own
 * public address back in. A relay needs neither.
 *
 * What it does, and all it does:
 *
 * * **Binding** -- a STUN answer (`XOR-MAPPED-ADDRESS`), unauthenticated.
 * * **Allocate** -- a relay socket for one client address, behind the
 *   long-term credential mechanism: the first request is refused `401` with
 *   a realm and a nonce, the second carries `MESSAGE-INTEGRITY` keyed by
 *   `MD5(username:realm:password)`. The credentials are the ones
 *   `rooms.ts` already mints for coturn's `use-auth-secret`: the username is
 *   `<expiry>:<room>` and the password `base64(HMAC-SHA1(secret, username))`,
 *   so nothing but the shared secret connects the two.
 * * **Refresh**, **CreatePermission**, **ChannelBind**; **Send** and **Data**
 *   indications and **ChannelData** for the traffic itself. A peer's packet
 *   reaches the client only if the client has asked for a permission for
 *   that peer's address, as the RFC requires.
 *
 * Not here: TCP and TLS transports, IPv6 relays, `EVEN-PORT` and
 * reservations, bandwidth quotas. For a relay on the open internet serving
 * strangers, use coturn or a hosted TURN service (`README.md`); this is for a
 * development machine, a LAN, or a small server for people you know.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";

const MAGIC = 0x2112a442;
const FINGERPRINT_XOR = 0x5354554e;

export const Method = {
  Binding: 0x001, Allocate: 0x003, Refresh: 0x004, Send: 0x006, Data: 0x007,
  CreatePermission: 0x008, ChannelBind: 0x009,
} as const;
export const Cls = { Request: 0, Indication: 1, Success: 2, Error: 3 } as const;
export const Attr = {
  MappedAddress: 0x0001, Username: 0x0006, MessageIntegrity: 0x0008, ErrorCode: 0x0009,
  ChannelNumber: 0x000c, Lifetime: 0x000d, XorPeerAddress: 0x0012, Data: 0x0013,
  Realm: 0x0014, Nonce: 0x0015, XorRelayedAddress: 0x0016, RequestedTransport: 0x0019,
  XorMappedAddress: 0x0020, Software: 0x8022, Fingerprint: 0x8028,
} as const;

/** How long an allocation lives unless refreshed, and the most a client may ask for (s). */
const DEFAULT_LIFETIME = 600;
const MAX_LIFETIME = 3600;
/** A permission's life, and a channel's (s), per the RFC. */
const PERMISSION_LIFETIME = 300;
const CHANNEL_LIFETIME = 600;
/** How many relays one server hands out at once. */
const MAX_ALLOCATIONS = 200;

// -- the wire ---------------------------------------------------------------

/** The 14-bit message type: method bits with the two class bits threaded through. */
export function messageType(method: number, cls: number): number {
  return (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2)
    | ((cls & 1) << 4) | ((cls & 2) << 7);
}

function splitType(t: number): { method: number; cls: number } {
  return {
    method: (t & 0x000f) | ((t >> 1) & 0x0070) | ((t >> 2) & 0x0f80),
    cls: ((t >> 4) & 1) | ((t >> 7) & 2),
  };
}

export interface StunAttr {
  type: number;
  value: Buffer;
  /** Offset of the attribute's header in the message: what integrity is computed up to. */
  at: number;
}

export interface StunMessage {
  method: number;
  cls: number;
  tid: Buffer;
  attrs: StunAttr[];
  raw: Buffer;
}

/** A STUN message, or null if `b` is not one. */
export function parseStun(b: Buffer): StunMessage | null {
  if (b.length < 20 || (b[0] & 0xc0) !== 0 || b.readUInt32BE(4) !== MAGIC) return null;
  const len = b.readUInt16BE(2);
  if (len % 4 !== 0 || 20 + len > b.length) return null;
  const attrs: StunAttr[] = [];
  for (let o = 20; o + 4 <= 20 + len;) {
    const type = b.readUInt16BE(o);
    const n = b.readUInt16BE(o + 2);
    if (o + 4 + n > 20 + len) return null;
    attrs.push({ type, value: b.subarray(o + 4, o + 4 + n), at: o });
    o += 4 + ((n + 3) & ~3);
  }
  const { method, cls } = splitType(b.readUInt16BE(0));
  return { method, cls, tid: Buffer.from(b.subarray(8, 20)), attrs, raw: b.subarray(0, 20 + len) };
}

export function attr(m: StunMessage, type: number): Buffer | undefined {
  return m.attrs.find((a) => a.type === type)?.value;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds one message; `finish` appends integrity and a fingerprint if asked. */
export class StunWriter {
  private readonly parts: Buffer[] = [];
  private len = 0;

  constructor(private readonly method: number, private readonly cls: number,
              private readonly tid: Buffer = randomBytes(12)) {}

  add(type: number, value: Buffer): this {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(type, 0);
    head.writeUInt16BE(value.length, 2);
    const pad = (4 - (value.length % 4)) % 4;
    this.parts.push(head, value, Buffer.alloc(pad));
    this.len += 4 + value.length + pad;
    return this;
  }

  private header(len: number): Buffer {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(messageType(this.method, this.cls), 0);
    h.writeUInt16BE(len, 2);
    h.writeUInt32BE(MAGIC, 4);
    this.tid.copy(h, 8);
    return h;
  }

  finish(key?: Buffer, fingerprint = false): Buffer {
    let body = Buffer.concat(this.parts);
    if (key) {
      // Keyed over everything before it, with the length already counting it.
      const mac = createHmac("sha1", key)
        .update(Buffer.concat([this.header(body.length + 24), body])).digest();
      const head = Buffer.alloc(4);
      head.writeUInt16BE(Attr.MessageIntegrity, 0);
      head.writeUInt16BE(20, 2);
      body = Buffer.concat([body, head, mac]);
    }
    if (fingerprint) {
      const crc = (crc32(Buffer.concat([this.header(body.length + 8), body])) ^ FINGERPRINT_XOR) >>> 0;
      const fp = Buffer.alloc(8);
      fp.writeUInt16BE(Attr.Fingerprint, 0);
      fp.writeUInt16BE(4, 2);
      fp.writeUInt32BE(crc, 4);
      body = Buffer.concat([body, fp]);
    }
    return Buffer.concat([this.header(body.length), body]);
  }
}

/** Whether `m` carries a `MESSAGE-INTEGRITY` that `key` made. */
export function integrityOk(m: StunMessage, key: Buffer): boolean {
  const mi = m.attrs.find((a) => a.type === Attr.MessageIntegrity);
  if (!mi || mi.value.length !== 20) return false;
  const signed = Buffer.from(m.raw.subarray(0, mi.at));
  signed.writeUInt16BE(mi.at - 20 + 24, 2);
  const mac = createHmac("sha1", key).update(signed).digest();
  return timingSafeEqual(mac, mi.value);
}

/** An IPv4 address and port, XORed with the magic cookie as the XOR-*-ADDRESS attributes carry them. */
export function xorAddress(address: string, port: number): Buffer {
  const b = Buffer.alloc(8);
  b[1] = 0x01;
  b.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const [a0, a1, a2, a3] = address.split(".").map(Number);
  const ip = ((a0 << 24) >>> 0) + (a1 << 16) + (a2 << 8) + a3;
  b.writeUInt32BE((ip ^ MAGIC) >>> 0, 4);
  return b;
}

/** The address in an XOR-*-ADDRESS attribute; `family` 6 for IPv6, which this relay does not carry. */
export function readXorAddress(v: Buffer): { family: 4 | 6; address: string; port: number } | null {
  if (v.length < 8) return null;
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (v[1] === 0x02) return { family: 6, address: "", port };
  if (v[1] !== 0x01) return null;
  const n = (v.readUInt32BE(4) ^ MAGIC) >>> 0;
  return { family: 4, address: `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`, port };
}

function errorCode(code: number, reason: string): Buffer {
  const r = Buffer.from(reason, "utf8");
  const b = Buffer.alloc(4 + r.length);
  b[2] = Math.floor(code / 100);
  b[3] = code % 100;
  r.copy(b, 4);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** The TURN REST password for `username`: what `rooms.ts` hands the page. */
export function restPassword(secret: string, username: string): string {
  return createHmac("sha1", secret).update(username).digest("base64");
}

/** The long-term credential key: `MD5(username:realm:password)`. */
export function longTermKey(username: string, realm: string, password: string): Buffer {
  return createHash("md5").update(`${username}:${realm}:${password}`).digest();
}

/** The first IPv4 address on a real interface: where a relay is reachable on the LAN. */
export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "127.0.0.1";
}

// -- the relay --------------------------------------------------------------

interface Allocation {
  client: { address: string; port: number };
  username: string;
  key: Buffer;
  relay: Socket;
  relayPort: number;
  expires: number;
  /** The Allocate that made it, so a retransmission gets the same answer. */
  tid: string;
  /** Peer IP -> when its permission lapses. */
  perms: Map<string, number>;
  /** Channel -> peer, and peer -> channel. */
  channels: Map<number, { address: string; port: number; expires: number }>;
  byPeer: Map<string, number>;
}

export interface TurnOptions {
  /** The shared secret `rooms.ts` mints credentials with. */
  secret: string;
  /** UDP port to listen on; 0 for any free one. */
  port?: number;
  /** The address relays are advertised at: one every peer can reach. Default: the LAN address. */
  relayIp?: string;
  realm?: string;
  log?: (line: string) => void;
  now?: () => number;
}

export interface TurnServer {
  readonly port: number;
  readonly relayIp: string;
  /** Live allocations, for a log line and the tests. */
  readonly allocations: number;
  close(): Promise<void>;
}

export async function startTurn(opts: TurnOptions): Promise<TurnServer> {
  const realm = opts.realm ?? "hotd2";
  const relayIp = opts.relayIp ?? lanAddress();
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const nonce = Buffer.from(randomBytes(16).toString("hex"));
  const allocs = new Map<string, Allocation>();
  const pending = new Set<string>();
  const main = createSocket("udp4");

  const send = (b: Buffer, to: { address: string; port: number }): void => {
    main.send(b, to.port, to.address);
  };

  const fail = (m: StunMessage, to: RemoteInfo, code: number, reason: string,
                key?: Buffer, challenge = false): void => {
    const w = new StunWriter(m.method, Cls.Error, m.tid)
      .add(Attr.ErrorCode, errorCode(code, reason));
    if (challenge) w.add(Attr.Realm, Buffer.from(realm)).add(Attr.Nonce, nonce);
    send(w.finish(key, !!attr(m, Attr.Fingerprint)), to);
  };

  /** The long-term key for a request, or null once it has been answered with the reason. */
  const authenticate = (m: StunMessage, from: RemoteInfo): { username: string; key: Buffer } | null => {
    const user = attr(m, Attr.Username);
    if (!user || !m.attrs.some((a) => a.type === Attr.MessageIntegrity)) {
      fail(m, from, 401, "Unauthorized", undefined, true);
      return null;
    }
    if (!attr(m, Attr.Nonce)?.equals(nonce)) {
      fail(m, from, 438, "Stale Nonce", undefined, true);
      return null;
    }
    const username = user.toString("utf8");
    const expiry = Number(username.split(":")[0]);
    if (!(expiry * 1000 > now())) {
      fail(m, from, 401, "Unauthorized: credential expired", undefined, true);
      return null;
    }
    const key = longTermKey(username, realm, restPassword(opts.secret, username));
    if (!integrityOk(m, key)) {
      fail(m, from, 401, "Unauthorized", undefined, true);
      return null;
    }
    return { username, key };
  };

  const free = (id: string, a: Allocation): void => {
    allocs.delete(id);
    try { a.relay.close(); } catch { /* already */ }
  };

  const allocate = async (m: StunMessage, from: RemoteInfo, id: string): Promise<void> => {
    const existing = allocs.get(id);
    if (existing) {
      // A retransmission of the request that made it gets the same answer.
      if (existing.tid === m.tid.toString("hex")) {
        send(allocated(m, existing), from);
      } else {
        fail(m, from, 437, "Allocation Mismatch", existing.key);
      }
      return;
    }
    if (pending.has(id)) return;
    const auth = authenticate(m, from);
    if (!auth) return;
    if (attr(m, Attr.RequestedTransport)?.[0] !== 17) {
      fail(m, from, 442, "Unsupported Transport Protocol", auth.key);
      return;
    }
    if (allocs.size >= MAX_ALLOCATIONS) {
      fail(m, from, 486, "Allocation Quota Reached", auth.key);
      return;
    }
    pending.add(id);
    const relay = createSocket("udp4");
    try {
      await new Promise<void>((resolve, reject) => {
        relay.once("error", reject);
        relay.bind(0, "0.0.0.0", () => { relay.off("error", reject); resolve(); });
      });
    } catch {
      pending.delete(id);
      fail(m, from, 508, "Insufficient Capacity", auth.key);
      return;
    }
    pending.delete(id);
    const asked = attr(m, Attr.Lifetime)?.readUInt32BE(0) ?? DEFAULT_LIFETIME;
    const a: Allocation = {
      client: { address: from.address, port: from.port },
      username: auth.username, key: auth.key, relay,
      relayPort: relay.address().port,
      expires: now() + Math.min(Math.max(asked, 1), MAX_LIFETIME) * 1000,
      tid: m.tid.toString("hex"),
      perms: new Map(), channels: new Map(), byPeer: new Map(),
    };
    relay.on("message", (data, peer) => fromPeer(a, data, peer));
    relay.on("error", () => free(id, a));
    allocs.set(id, a);
    log(`turn: relay ${relayIp}:${a.relayPort} for ${id} (${allocs.size} live)`);
    send(allocated(m, a), from);
  };

  const allocated = (m: StunMessage, a: Allocation): Buffer =>
    new StunWriter(Method.Allocate, Cls.Success, m.tid)
      .add(Attr.XorRelayedAddress, xorAddress(relayIp, a.relayPort))
      .add(Attr.Lifetime, u32(Math.max(0, Math.round((a.expires - now()) / 1000))))
      .add(Attr.XorMappedAddress, xorAddress(a.client.address, a.client.port))
      .finish(a.key, !!attr(m, Attr.Fingerprint));

  /** A packet a peer sent to a relay: to the client, if the client let that peer in. */
  const fromPeer = (a: Allocation, data: Buffer, peer: RemoteInfo): void => {
    const t = now();
    if (!((a.perms.get(peer.address) ?? 0) > t)) return;
    const ch = a.byPeer.get(`${peer.address}:${peer.port}`);
    const bound = ch === undefined ? undefined : a.channels.get(ch);
    if (ch !== undefined && bound && bound.expires > t) {
      const b = Buffer.alloc(4 + data.length);
      b.writeUInt16BE(ch, 0);
      b.writeUInt16BE(data.length, 2);
      data.copy(b, 4);
      send(b, a.client);
      return;
    }
    send(new StunWriter(Method.Data, Cls.Indication)
      .add(Attr.XorPeerAddress, xorAddress(peer.address, peer.port))
      .add(Attr.Data, data).finish(), a.client);
  };

  const onRequest = (m: StunMessage, from: RemoteInfo, id: string): void => {
    const a = allocs.get(id);
    if (!a) {
      fail(m, from, 437, "Allocation Mismatch");
      return;
    }
    const auth = authenticate(m, from);
    if (!auth) return;
    if (auth.username !== a.username) {
      fail(m, from, 441, "Wrong Credentials", auth.key);
      return;
    }
    const fp = !!attr(m, Attr.Fingerprint);
    const t = now();
    switch (m.method) {
      case Method.Refresh: {
        const asked = attr(m, Attr.Lifetime)?.readUInt32BE(0) ?? DEFAULT_LIFETIME;
        const life = Math.min(asked, MAX_LIFETIME);
        if (life === 0) free(id, a);
        else a.expires = t + life * 1000;
        send(new StunWriter(Method.Refresh, Cls.Success, m.tid)
          .add(Attr.Lifetime, u32(life)).finish(a.key, fp), from);
        return;
      }
      case Method.CreatePermission: {
        const peers = m.attrs.filter((x) => x.type === Attr.XorPeerAddress)
          .map((x) => readXorAddress(x.value));
        if (!peers.length || peers.some((p) => !p)) {
          fail(m, from, 400, "Bad Request", a.key);
          return;
        }
        if (peers.some((p) => p!.family !== 4)) {
          fail(m, from, 443, "Peer Address Family Mismatch", a.key);
          return;
        }
        for (const p of peers) a.perms.set(p!.address, t + PERMISSION_LIFETIME * 1000);
        send(new StunWriter(Method.CreatePermission, Cls.Success, m.tid).finish(a.key, fp), from);
        return;
      }
      case Method.ChannelBind: {
        const chv = attr(m, Attr.ChannelNumber);
        const pv = attr(m, Attr.XorPeerAddress);
        const peer = pv && readXorAddress(pv);
        const ch = chv?.readUInt16BE(0) ?? 0;
        if (!peer || ch < 0x4000 || ch > 0x7ffe) {
          fail(m, from, 400, "Bad Request", a.key);
          return;
        }
        if (peer.family !== 4) {
          fail(m, from, 443, "Peer Address Family Mismatch", a.key);
          return;
        }
        const pk = `${peer.address}:${peer.port}`;
        const had = a.channels.get(ch);
        if ((had && `${had.address}:${had.port}` !== pk)
            || (a.byPeer.has(pk) && a.byPeer.get(pk) !== ch)) {
          fail(m, from, 400, "Bad Request: channel or peer bound elsewhere", a.key);
          return;
        }
        a.channels.set(ch, { address: peer.address, port: peer.port,
                             expires: t + CHANNEL_LIFETIME * 1000 });
        a.byPeer.set(pk, ch);
        a.perms.set(peer.address, t + PERMISSION_LIFETIME * 1000);
        send(new StunWriter(Method.ChannelBind, Cls.Success, m.tid).finish(a.key, fp), from);
        return;
      }
      default:
        fail(m, from, 400, "Bad Request", a.key);
    }
  };

  main.on("message", (b: Buffer, from: RemoteInfo) => {
    const id = `${from.address}:${from.port}`;
    // ChannelData: the first two bits 01, a channel, a length, the bytes.
    if (b.length >= 4 && (b[0] & 0xc0) === 0x40) {
      const a = allocs.get(id);
      const c = a?.channels.get(b.readUInt16BE(0));
      const n = b.readUInt16BE(2);
      if (a && c && c.expires > now() && 4 + n <= b.length) {
        a.relay.send(b.subarray(4, 4 + n), c.port, c.address);
      }
      return;
    }
    const m = parseStun(b);
    if (!m) return;
    if (m.cls === Cls.Indication && m.method === Method.Send) {
      const a = allocs.get(id);
      const pv = attr(m, Attr.XorPeerAddress);
      const data = attr(m, Attr.Data);
      const peer = pv && readXorAddress(pv);
      if (a && peer && peer.family === 4 && data
          && (a.perms.get(peer.address) ?? 0) > now()) {
        a.relay.send(data, peer.port, peer.address);
      }
      return;
    }
    if (m.cls !== Cls.Request) return;
    if (m.method === Method.Binding) {
      send(new StunWriter(Method.Binding, Cls.Success, m.tid)
        .add(Attr.XorMappedAddress, xorAddress(from.address, from.port))
        .finish(undefined, !!attr(m, Attr.Fingerprint)), from);
      return;
    }
    if (m.method === Method.Allocate) {
      void allocate(m, from, id);
      return;
    }
    onRequest(m, from, id);
  });

  const sweep = setInterval(() => {
    const t = now();
    for (const [id, a] of allocs) {
      if (a.expires <= t) {
        free(id, a);
        continue;
      }
      for (const [ip, until] of a.perms) if (until <= t) a.perms.delete(ip);
      for (const [ch, c] of a.channels) {
        if (c.expires > t) continue;
        a.channels.delete(ch);
        a.byPeer.delete(`${c.address}:${c.port}`);
      }
    }
  }, 15_000);
  sweep.unref();

  await new Promise<void>((resolve, reject) => {
    main.once("error", reject);
    main.bind(opts.port ?? 3478, "0.0.0.0", () => { main.off("error", reject); resolve(); });
  });
  main.unref();
  const port = main.address().port;

  return {
    port,
    relayIp,
    get allocations() { return allocs.size; },
    close: async () => {
      clearInterval(sweep);
      for (const [id, a] of allocs) free(id, a);
      await new Promise<void>((resolve) => main.close(() => resolve()));
    },
  };
}
