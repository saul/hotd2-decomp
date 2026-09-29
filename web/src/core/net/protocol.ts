/**
 * The wire protocol between a host and a replica: message types, the two
 * channels they travel on, and the binary layouts of the three messages that
 * go every frame.
 *
 * `docs/NETPLAY.md` has the reasoning. The short form:
 *
 * * **`ctrl`** is reliable and ordered: the handshake, the load barrier,
 *   keyframes, the session state, desync reports. JSON, apart from keyframe
 *   chunks, because none of it is frequent and all of it is worth reading in
 *   a packet capture.
 * * **`tick`** is unordered with no retransmission: the host's state deltas,
 *   the replica's input, and the pings. Nothing on it is ever resent, because
 *   everything on it carries whatever the other end has not acknowledged yet.
 *
 * Bump {@link PROTOCOL} whenever a layout here changes. The handshake refuses
 * a peer on another version rather than misreading its bytes.
 */
import { ByteReader, ByteWriter } from "./bytes";

export const PROTOCOL = 4;

export type Channel = "ctrl" | "tick";

export enum Msg {
  /** host -> replica, `tick`: one tick's delta and events. */
  Tick = 1,
  /** replica -> host, `tick`: the gun, and what the replica has applied. */
  Input = 2,
  /** either way, `tick`: a timestamp to echo. */
  Ping = 3,
  Pong = 4,
  /** either way, `ctrl`: who I am and what I was built from. */
  Hello = 10,
  /** host -> replica: load this stage for this epoch. */
  Load = 11,
  /** replica -> host: the stage is loaded; send a keyframe. */
  Ready = 12,
  /** host -> replica: one chunk of a keyframe. */
  Keyframe = 13,
  /** host -> replica: whether the host's clock is running, and why not. */
  Session = 14,
  /** replica -> host: send me a keyframe. */
  Resync = 15,
  /** replica -> host: my state is not yours; send me a keyframe. */
  Desync = 16,
  /** replica -> host: what differed, found by comparing the keyframe that answered. */
  DesyncReport = 17,
  /** either way: I am leaving. */
  Bye = 18,
  /** either way, once a second: what I have seen of the link. */
  Stats = 19,
}

/** Which channel each message goes on. */
export function channelOf(m: Msg): Channel {
  return m === Msg.Tick || m === Msg.Input || m === Msg.Ping || m === Msg.Pong
    ? "tick" : "ctrl";
}

/** Keyframes are split to fit every browser's data channel message limit. */
export const KEYFRAME_CHUNK = 16 * 1024;

// -- ctrl: JSON -------------------------------------------------------------

export interface HelloMsg {
  protocol: number;
  role: "host" | "replica";
  /** `SNAPSHOT_VERSION`: the shape of the state being replicated. */
  snapshot: number;
  /** Identifies the page's code. A different build has a different state shape. */
  build: string;
  /**
   * The exporter this page builds bundles with (`BUILDER_HASH`). Informative
   * in the hello; the check that matters is per stage, in {@link LoadMsg},
   * because a page holds stages from two bundles at once.
   */
  bundle: string;
  /** `SCHEMA_HASH`: the bundle format this page reads. */
  schema: string;
}

export interface LoadMsg {
  epoch: number;
  stage: number;
  original: boolean;
  /**
   * The exporter that built the host's copy of this stage, when its bundle
   * says. A replica whose copy was built by another refuses: a different
   * exporter can mean different tables, and different tables are different
   * state.
   */
  builder?: string;
}

export interface ReadyMsg {
  epoch: number;
  /** Set when the replica cannot load it, with the reason. */
  error?: string;
}

/** Why the host's clock is not running, or null while it is. */
export type HoldReason =
  | "paused" | "loading" | "hidden" | "free-roam" | "game-over"
  | null;

export interface SessionMsg {
  epoch: number;
  /** Null while the host's clock runs. */
  hold: HoldReason;
  /** The route bar the host is choosing from, as a label. */
  branch: string | null;
}

export interface ResyncMsg {
  epoch: number;
  reason: string;
  tick: number;
}

export interface DesyncMsg {
  epoch: number;
  /** The tick it was found at. */
  tick: number;
  /** How it was found: a hash that differed, an op that would not apply, an audit. */
  reason: string;
}

export interface DesyncReportMsg {
  epoch: number;
  /** The keyframe's tick, which the replica's own state was compared at. */
  tick: number;
  /** The values that differed, as `path: host's vs replica's`; empty if none. */
  differ: string[];
  note: string;
}

/** What one end has seen of the link over the last second. */
export interface LinkStatsMsg {
  /** Packets on `tick` received, and missing by sequence, in the window. */
  received: number;
  lost: number;
  /** Bytes received in the window. */
  bytes: number;
}

export function encodeJson(m: Msg, body: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const out = new Uint8Array(json.length + 1);
  out[0] = m;
  out.set(json, 1);
  return out;
}

export function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as T;
}

// -- tick: binary -------------------------------------------------------------

/** The fixed head of a tick packet; the codec's delta follows it. */
export interface TickHead {
  epoch: number;
  /** Sequence on the `tick` channel, for loss counting. One per packet sent. */
  seq: number;
  tick: number;
  base: number;
  /** The highest press id the host has applied. */
  pressAck: number;
  /** The host's state hash at `tick`. Every tick carries it, and every tick is checked. */
  hash: number;
  /** `performance.now()` on the host when sent, for the jitter estimate. */
  sentAt: number;
}

export function writeTickHead(w: ByteWriter, h: TickHead): void {
  w.u8(Msg.Tick);
  w.uvar(h.epoch);
  w.uvar(h.seq);
  w.uvar(h.tick);
  w.uvar(h.base + 1);
  w.uvar(h.pressAck + 1);
  w.u32(h.hash);
  w.f64(h.sentAt);
}

export function readTickHead(r: ByteReader): TickHead {
  r.u8();
  return {
    epoch: r.uvar(),
    seq: r.uvar(),
    tick: r.uvar(),
    base: r.uvar() - 1,
    pressAck: r.uvar() - 1,
    hash: r.u32(),
    sentAt: r.f64(),
  };
}

export enum PressKind {
  /** The trigger, on the screen: a shot along `ray`. */
  Pull = 1,
  /** The trigger, off the screen: a reload. */
  Offscreen = 2,
  /** START. */
  Start = 3,
}

export interface Press {
  id: number;
  kind: PressKind;
  /** The tick on the replica's screen when it was pressed. */
  view: number;
  /** The aim at the press, in the exe's pixels from the frame's centre, +y up. */
  x: number;
  y: number;
  /** For a pull: the segment the replica's own renderer built through its camera. */
  ray?: { origin: { x: number; y: number; z: number };
          dir: { x: number; y: number; z: number } };
}

export interface InputPacket {
  epoch: number;
  seq: number;
  /** The newest tick applied, or -1. */
  ack: number;
  /** The tick on screen now. */
  view: number;
  aim: { x: number; y: number; on: boolean };
  presses: Press[];
}

export function writeInput(w: ByteWriter, p: InputPacket): void {
  w.u8(Msg.Input);
  w.uvar(p.epoch);
  w.uvar(p.seq);
  w.uvar(p.ack + 1);
  w.uvar(p.view + 1);
  w.f64(p.aim.x);
  w.f64(p.aim.y);
  w.u8(p.aim.on ? 1 : 0);
  w.uvar(p.presses.length);
  for (const q of p.presses) {
    w.uvar(q.id);
    w.u8(q.kind);
    w.uvar(q.view + 1);
    w.f64(q.x);
    w.f64(q.y);
    w.u8(q.ray ? 1 : 0);
    if (q.ray) {
      w.f64(q.ray.origin.x); w.f64(q.ray.origin.y); w.f64(q.ray.origin.z);
      w.f64(q.ray.dir.x); w.f64(q.ray.dir.y); w.f64(q.ray.dir.z);
    }
  }
}

export function readInput(r: ByteReader): InputPacket {
  r.u8();
  const epoch = r.uvar();
  const seq = r.uvar();
  const ack = r.uvar() - 1;
  const view = r.uvar() - 1;
  const aim = { x: r.f64(), y: r.f64(), on: r.u8() === 1 };
  const n = r.uvar();
  if (n > 256) throw new Error(`${n} presses in one packet`);
  const presses: Press[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.uvar();
    const kind = r.u8() as PressKind;
    const pv = r.uvar() - 1;
    const x = r.f64();
    const y = r.f64();
    const q: Press = { id, kind, view: pv, x, y };
    if (r.u8()) {
      q.ray = {
        origin: { x: r.f64(), y: r.f64(), z: r.f64() },
        dir: { x: r.f64(), y: r.f64(), z: r.f64() },
      };
    }
    presses.push(q);
  }
  return { epoch, seq, ack, view, aim, presses };
}

export interface PingPacket {
  id: number;
  /** The sender's clock, echoed back unchanged in the pong. */
  sentAt: number;
}

export function writePing(w: ByteWriter, m: Msg.Ping | Msg.Pong, p: PingPacket): void {
  w.u8(m);
  w.uvar(p.id);
  w.f64(p.sentAt);
}

export function readPing(r: ByteReader): PingPacket {
  r.u8();
  return { id: r.uvar(), sentAt: r.f64() };
}

/** One chunk of a keyframe on `ctrl`. */
export interface KeyframeChunk {
  epoch: number;
  tick: number;
  /**
   * The stage the host's state is of -- the one it has loaded, which is not
   * always the one it announced: a load that fails leaves the last one.
   */
  stage: number;
  index: number;
  count: number;
  /** The host's state hash at `tick`, so the install can be checked. */
  hash: number;
  bytes: Uint8Array;
}

export function writeKeyframeChunk(w: ByteWriter, c: KeyframeChunk): void {
  w.u8(Msg.Keyframe);
  w.uvar(c.epoch);
  w.uvar(c.tick);
  w.uvar(c.stage);
  w.uvar(c.index);
  w.uvar(c.count);
  w.u32(c.hash);
  w.uvar(c.bytes.length);
  w.bytes(c.bytes);
}

export function readKeyframeChunk(r: ByteReader): KeyframeChunk {
  r.u8();
  const epoch = r.uvar();
  const tick = r.uvar();
  const stage = r.uvar();
  const index = r.uvar();
  const count = r.uvar();
  const hash = r.u32();
  const n = r.uvar();
  return { epoch, tick, stage, index, count, hash, bytes: r.bytes(n).slice() };
}
