/**
 * The state codec, fuzzed.
 *
 * `core/net/codec.ts` promises three things, and a unit test of each op would
 * prove only that the ops do what they were written to do. This asserts the
 * promises themselves, against trees that change the way the game's state
 * changes -- and in the ways it would take a malicious author to think of:
 *
 * - **A delta is absolute over its window.** A replica at any tick between
 *   the base the host chose and the tick the packet carries lands on the
 *   host's state at that tick, exactly. The host picks its base from acks
 *   that arrive late, packets are lost, reordered and duplicated, and the
 *   replica applies whatever it can.
 * - **Pools keep identity.** An element whose `(at, serial)` survived is the
 *   same object on the replica before and after, and a respawn at an old `at`
 *   is a different one.
 * - **Lossless.** `-0`, `undefined`, `null`, holes and trailing holes, long
 *   strings and non-ASCII ones, integers past 2^31 and past 2^51 come back
 *   bit for bit; the hash of the replica's tree equals the host's every time.
 * - **The kept hashes are the hashes.** Neither end walks its state to hash
 *   it: the host keeps its shadow's hash as it diffs and the replica its
 *   tree's as it applies. Both are checked against a walk on every tick, and
 *   the replica's audit -- a slice of its sections a tick -- never cries wolf
 *   over a tree only ops wrote, and names what was written behind its back.
 *
 * Every applied tick is checked against a clone of the host's state at that
 * tick. No bundle: this runs everywhere, in about a second.
 *
 * Run with `npm run test:net-codec`.
 */
import { ByteReader, ByteWriter } from "../src/core/net/bytes";
import {
  NetStateError, StateMirror, StateTracker, TreeHasher, diffTrees, poolAts,
} from "../src/core/net/codec";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
}
function report(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

/** mulberry32: small, seeded, and the same on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Obj = Record<string, unknown>;

/** The awkward values, all of which JSON would mangle. */
const SPECIALS: unknown[] = [
  -0, 0, undefined, null, true, false, 2 ** 31, -(2 ** 31) - 7, 2 ** 52 + 1,
  -(2 ** 53) + 1, 0.1, -1e-300, 1e300, "", "é漢字", "x".repeat(300),
  Number.MIN_VALUE, -Number.MAX_VALUE,
];

class Fuzz {
  private nextAt = 1000;
  constructor(readonly r: () => number) {}
  int(n: number): number { return Math.floor(this.r() * n); }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]; }
  chance(p: number): boolean { return this.r() < p; }

  prim(): unknown {
    switch (this.int(6)) {
      case 0: return this.int(1000) - 500;
      case 1: return (this.r() - 0.5) * 1000;
      case 2: return this.pick(SPECIALS);
      case 3: return `s${this.int(50)}`;
      case 4: return this.chance(0.5);
      default: return this.int(3) === 0 ? null : this.int(10);
    }
  }

  /** The port numbers the actors it makes itself below zero. */
  nextAtFor(): number {
    const at = this.nextAt++;
    return this.chance(0.3) ? -at : at;
  }

  actor(at = this.nextAtFor()): Obj {
    const a: Obj = {
      at, hp: this.int(100), pos: { x: this.r() * 10, y: -0, z: this.r() },
      removed: [], state: this.int(5), name: `z${at}`,
    };
    if (this.chance(0.3)) a.standThrow = undefined;
    if (this.chance(0.2)) a.parts = [this.actorish(), this.actorish()];
    return a;
  }

  /** A nested pool's element. */
  actorish(): Obj {
    return { at: this.nextAtFor(), v: this.prim() };
  }

  value(depth: number): unknown {
    if (depth > 3 || this.chance(0.5)) return this.prim();
    switch (this.int(4)) {
      case 0: {
        const o: Obj = {};
        for (let i = this.int(4); i > 0; i--) o[`k${this.int(8)}`] = this.value(depth + 1);
        return o;
      }
      case 1: {
        const a: unknown[] = [];
        for (let i = this.int(5); i > 0; i--) a.push(this.value(depth + 1));
        if (this.chance(0.2) && a.length) delete a[this.int(a.length)];
        return a;
      }
      case 2: {
        const a: unknown[] = [];
        for (let i = this.int(4); i > 0; i--) a.push(this.actor());
        return a;
      }
      default:
        return this.prim();
    }
  }

  state(): Obj {
    const pool: unknown[] = [];
    for (let i = 0; i < 6; i++) pool.push(this.actor());
    const g: Obj = {
      g_frame: 0, g_object_list: pool, g_rings: [1, 2, 3, 4], g_flags: [],
      g_matrix: new Array(16).fill(0).map(() => this.r()),
      g_sparse: [1, , 3] as unknown[],
    };
    for (let i = 0; i < 12; i++) g[`g_v${i}`] = this.value(0);
    return {
      frame: 0, rng: 12345,
      parts: { game: g, script: { block: 1, spawns: [this.actor(), this.actor()] } },
    };
  }

  /** Every container reachable, with how to reach it. */
  containers(root: unknown, out: unknown[] = []): unknown[] {
    if (root && typeof root === "object") {
      out.push(root);
      if (Array.isArray(root)) {
        for (let i = 0; i < root.length; i++) if (i in root) this.containers(root[i], out);
      } else {
        for (const k of Object.keys(root)) this.containers((root as Obj)[k], out);
      }
    }
    return out;
  }

  mutate(s: Obj): void {
    const g = (s.parts as Obj).game as Obj;
    s.frame = (s.frame as number) + 1;
    if (this.chance(0.8)) s.rng = this.int(2 ** 32);
    g.g_frame = this.chance(0.5) ? (g.g_frame as number) + 1 : g.g_frame;
    // The churn below may have turned the pool into anything, or holed it.
    if (!Array.isArray(g.g_object_list)) g.g_object_list = [];
    g.g_object_list = (g.g_object_list as unknown[]).filter(
      (a) => a && typeof a === "object" && !Array.isArray(a)
        && typeof (a as Obj).at === "number");
    const pool = g.g_object_list as Obj[];
    // Actors move.
    for (const a of pool) {
      const pos = a.pos as Obj | null;
      if (pos && typeof pos === "object" && this.chance(0.6)) {
        pos.x = (typeof pos.x === "number" ? pos.x : 0) + this.r();
      }
      if (this.chance(0.1)) a.hp = (a.hp as number) - 1;
      if (this.chance(0.05) && Array.isArray(a.removed)) {
        (a.removed as number[]).push(this.int(20));
      }
      if (this.chance(0.02)) a.state = this.prim();
      if (this.chance(0.02) && Array.isArray(a.parts)) (a.parts as unknown[]).reverse();
    }
    // The sweep filters; spawns push; a respawn reuses an `at` with a new object.
    if (this.chance(0.15) && pool.length) {
      const drop = pool[this.int(pool.length)].at;
      g.g_object_list = pool.filter((a) => a.at !== drop);
    }
    if (this.chance(0.15)) (g.g_object_list as Obj[]).push(this.actor());
    if (this.chance(0.05)) {
      const list = g.g_object_list as Obj[];
      if (list.length) {
        const i = this.int(list.length);
        list[i] = this.actor(list[i].at as number);
      }
    }
    if (this.chance(0.05)) {
      const list = g.g_object_list as Obj[];
      if (list.length > 1) {
        const i = this.int(list.length), j = this.int(list.length);
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    // A list rebuilt from fresh objects every tick, as `g_shot_test_list` and
    // the walker's `spawns` are.
    g.g_rebuilt = (g.g_object_list as Obj[]).filter(() => this.chance(0.9))
      .map((a) => ({ at: a.at, flags: this.int(4), x: (a.pos as Obj)?.x ?? 0 }));
    // A duplicate `at` makes the pool stop being one for a while.
    if (this.chance(0.02)) {
      const list = g.g_object_list as Obj[];
      if (list.length) list.push({ ...list[0], pos: { x: 1, y: 2, z: 3 } });
    }
    if (this.chance(0.03)) {
      const list = g.g_object_list as Obj[];
      const seen = new Set<unknown>();
      g.g_object_list = list.filter((a) => !seen.has(a.at) && seen.add(a.at));
    }
    // Arbitrary churn in the rest.
    const cs = this.containers(s).filter((c) => c !== s && c !== s.parts);
    for (let n = this.int(6); n > 0; n--) {
      const c = this.pick(cs);
      if (Array.isArray(c)) {
        const isPool = c.length && c.every((e) => e && typeof e === "object" && "at" in (e as Obj));
        switch (this.int(6)) {
          case 0: c.push(isPool ? this.actor() : this.value(2)); break;
          case 1: c.pop(); break;
          case 2: if (c.length && !isPool) c[this.int(c.length)] = this.value(2); break;
          case 3: if (c.length && !isPool) delete c[this.int(c.length)]; break;
          case 4: c.length += this.int(3); break;
          default: if (c.length) c.splice(this.int(c.length), 1);
        }
      } else {
        const o = c as Obj;
        const ks = Object.keys(o).filter((k) => k !== "at");
        switch (this.int(4)) {
          case 0: o[`k${this.int(8)}`] = this.value(2); break;
          case 1: if (ks.length) delete o[this.pick(ks)]; break;
          case 2: if (ks.length) o[this.pick(ks)] = this.prim(); break;
          default: if (ks.length) o[this.pick(ks)] = this.value(1);
        }
      }
    }
  }
}

interface Packet {
  tick: number;
  base: number;
  bytes: Uint8Array;
  keyframe: boolean;
  deliverAt: number;
}

const hasher = new TreeHasher();

function run(seed: number, ticks: number, opts: {
  loss: number; latency: number; jitter: number; dup: number; ackDelay: number;
}): { applied: number; keyframes: number; bytes: number } {
  const f = new Fuzz(rng(seed));
  const live = f.state();
  const tracker = new StateTracker();
  const mirror = new StateMirror();
  const history = new Map<number, Obj>();
  let replica: Obj | null = null;
  let at = -1;
  let hostAck = -1;
  const acks: { tick: number; arrive: number }[] = [];
  const inflight: Packet[] = [];
  let keyframes = 0, applied = 0, bytes = 0;
  let needKeyframe = true;
  // Identity: the host's pool objects each tick -- or null on a tick the
  // list was not a pool (a duplicate `at`, a hole) -- and the replica's at
  // the tick it last applied, by `at`.
  const hostPools = new Map<number, Map<number, object> | null>();
  let lastPool = new Map<number, object>();
  let lastAt = -1;
  const poolOf = (root: Obj): Map<number, object> => {
    const m = new Map<number, object>();
    const pool = ((root.parts as Obj).game as Obj).g_object_list;
    if (Array.isArray(pool)) {
      for (const a of pool) if (a && typeof a === "object") m.set((a as Obj).at as number, a);
    }
    return m;
  };

  for (let t = 1; t <= ticks; t++) {
    f.mutate(live);
    tracker.update(live, t);
    check(`seed ${seed} tick ${t}: the host's kept hash`,
          tracker.hash === hasher.hash(tracker.state), `${tracker.hash} kept, `
          + `${hasher.hash(tracker.state)} walked`);
    history.set(t, structuredClone(live));
    history.delete(t - 300);
    // The churn may have made the list anything, or deleted it.
    const list = ((live.parts as Obj).game as Obj).g_object_list;
    hostPools.set(t, Array.isArray(list) && (list.length === 0 || poolAts(list))
      ? poolOf(live) : null);
    hostPools.delete(t - 300);
    // Acks arrive late.
    for (let i = acks.length - 1; i >= 0; i--) {
      if (acks[i].arrive <= t) {
        hostAck = Math.max(hostAck, acks[i].tick);
        acks.splice(i, 1);
      }
    }
    const w = new ByteWriter();
    let keyframe = false;
    let base = hostAck;
    if (needKeyframe || base < 0 || !tracker.encodeDelta(base, w)) {
      w.reset();
      tracker.encodeKeyframe(w);
      keyframe = true;
      base = -1;
      needKeyframe = false;
      keyframes++;
      // A keyframe travels reliably: pretend the ack is on its way.
      hostAck = Math.max(hostAck, t);
    }
    const pkt: Packet = {
      tick: t, base, bytes: w.finish(), keyframe,
      deliverAt: t + opts.latency + f.int(opts.jitter + 1),
    };
    bytes += pkt.bytes.length;
    if (keyframe || !f.chance(opts.loss)) inflight.push(pkt);
    if (!keyframe && f.chance(opts.dup)) inflight.push({ ...pkt, deliverAt: pkt.deliverAt + 2 });

    // Deliver what has arrived, in arrival order, and apply what applies.
    inflight.sort((a, b) => a.deliverAt - b.deliverAt || a.tick - b.tick);
    while (inflight.length && inflight[0].deliverAt <= t) {
      const p = inflight.shift()!;
      const r = new ByteReader(p.bytes);
      if (p.keyframe) {
        if (p.tick <= at) continue;
        replica = mirror.readKeyframe(r);
        mirror.rehash(replica);
        at = p.tick;
      } else {
        if (!replica || p.base > at || p.tick <= at) continue;
        mirror.readDefs(r);
        mirror.applyOps(r, replica, new Set());
        at = p.tick;
      }
      applied++;
      const want = history.get(at)!;
      const d = diffTrees(want, replica, 5);
      check(`seed ${seed} tick ${at} (base ${p.base})`, d.length === 0, d.join("; "));
      check(`seed ${seed} tick ${at}: hash`, hasher.hash(replica) === hasher.hash(want));
      check(`seed ${seed} tick ${at}: the replica's kept hash`,
            mirror.hash === hasher.hash(replica),
            `${mirror.hash} kept, ${hasher.hash(replica)} walked`);
      // A slice a tick, as the page runs it; now and then the whole of it.
      const bad = mirror.audit(replica, applied % 16 === 0 ? Infinity : 40);
      check(`seed ${seed} tick ${at}: the audit finds nothing the ops did not write`,
            bad === null, bad ?? "");
      // Identity across the ticks this apply moved over, while the list
      // stayed a pool: an actor the host kept is the replica's same object,
      // and one the host replaced is replaced there too, never patched.
      // "Stayed a pool" over the delta's whole window, from its base: a list
      // that stopped being one was set whole, and every delta whose window
      // holds that tick sets it whole again, with new objects.
      const now = poolOf(replica);
      let pooled = !p.keyframe && lastAt >= 0;
      for (let q = Math.min(lastAt, p.base); pooled && q <= at; q++) {
        pooled = !!hostPools.get(q);
      }
      if (pooled) {
        const was = hostPools.get(lastAt)!, is = hostPools.get(at)!;
        for (const [k, obj] of now) {
          const prev = lastPool.get(k);
          if (!prev || !was.has(k) || !is.has(k)) continue;
          if (was.get(k) !== is.get(k)) {
            check(`seed ${seed} tick ${at}: @${k} was respawned on the host `
              + `after tick ${lastAt}`, obj !== prev, "the replica patched the old object");
          } else {
            check(`seed ${seed} tick ${at}: @${k} kept its object on the host `
              + `since tick ${lastAt}`, obj === prev, "the replica replaced it");
          }
        }
      }
      lastPool = now;
      lastAt = at;
      acks.push({ tick: at, arrive: t + opts.ackDelay + f.int(3) });
      if (d.length) needKeyframe = true;
    }
  }
  return { applied, keyframes, bytes };
}

// -- identity, directly --------------------------------------------------------

{
  const tracker = new StateTracker();
  const mirror = new StateMirror();
  const a = { at: 7, hp: 1 }, b = { at: -9, hp: 2 }, c = { at: 11, hp: 4 };
  const live: Obj = { parts: { game: { pool: [a, b, c], list: [{ at: 1 }, { at: 2 }] } } };
  const g = (live.parts as Obj).game as Obj;
  tracker.update(live, 1);
  let w = new ByteWriter();
  tracker.encodeKeyframe(w);
  const replica = mirror.readKeyframe(new ByteReader(w.finish()));
  const rp = () => ((replica.parts as Obj).game as Obj).pool as Obj[];
  const step = (t: number): number => {
    tracker.update(live, t);
    w = new ByteWriter();
    tracker.encodeDelta(t - 1, w);
    const bytes = w.finish();
    const r = new ByteReader(bytes);
    mirror.readDefs(r);
    mirror.applyOps(r, replica, new Set());
    return bytes.length;
  };
  const r9 = rp()[1], r11 = rp()[2];
  // The sweep: 7 goes; -9 and 11 stay and move up.
  g.pool = [b, c];
  b.hp = 3;
  step(2);
  report("a filtered pool keeps the survivors' objects, negative `at` and all",
         rp()[0] === r9 && rp()[1] === r11 && rp().length === 2,
         `${JSON.stringify(rp())}`);
  report("...and patches them in place", r9.hp === 3);
  // A respawn: a new object at -9 while 11 keeps its own. The replica's -9
  // must be a new object too.
  const b2 = { at: -9, hp: 50 };
  g.pool = [b2, c];
  step(3);
  report("a respawn at an old `at` is a new object, not a patch",
         rp()[0] !== r9 && rp()[0].hp === 50 && r9.hp === 3 && rp()[1] === r11);
  // The only survivor respawning: one element, and none kept its object,
  // which is what a one-element list rebuilt whole looks like too. The pool
  // has proved itself persistent, so it is a respawn.
  g.pool = [c];
  step(4);
  const r11b = rp()[0];
  const c2 = { at: 11, hp: 99 };
  g.pool = [c2];
  step(5);
  report("the only survivor respawning is a new object, not a patch",
         rp()[0] !== r11b && rp()[0].hp === 99 && r11b.hp === 4,
         `${JSON.stringify(rp())}`);
  // A list rebuilt whole from fresh objects, unchanged in value: nothing to send.
  g.list = [{ at: 1 }, { at: 2 }];
  const quiet = step(6);
  report("a list rebuilt from fresh objects with the same values sends no ops",
         quiet <= 3, `${quiet} bytes`);
}

// -- the audit: writes behind the codec's back -------------------------------------

{
  const f = new Fuzz(rng(4242));
  const live = f.state();
  const tracker = new StateTracker();
  const mirror = new StateMirror();
  tracker.update(live, 1);
  let w = new ByteWriter();
  tracker.encodeKeyframe(w);
  const replica = mirror.readKeyframe(new ByteReader(w.finish()));
  mirror.rehash(replica);
  // Ticks the ops build the sums through: actors move, arrive and go.
  const lg = (live.parts as Obj).game as Obj;
  for (let t = 2; t <= 40; t++) {
    for (const a of lg.g_object_list as Obj[]) (a.pos as Obj).x = (a.pos as Obj).x as number + 1;
    if (t % 5 === 0) (lg.g_object_list as Obj[]).push(f.actor());
    if (t % 7 === 0) lg.g_object_list = (lg.g_object_list as Obj[]).slice(1);
    lg.g_frame = t;
    tracker.update(live, t);
    w = new ByteWriter();
    tracker.encodeDelta(t - 1, w);
    const r = new ByteReader(w.finish());
    mirror.readDefs(r);
    mirror.applyOps(r, replica, new Set());
  }
  const g = () => (replica.parts as Obj).game as Obj;
  const pool = () => g().g_object_list as Obj[];
  // Each write is made, found, and undone by a rehash, which is what a
  // keyframe does.
  const cases: [string, () => void, RegExp][] = [
    ["a field of an actor", () => { pool()[0].hp = -12345; }, /g_object_list\[@-?\d+\]/],
    ["a global's element", () => { (g().g_rings as number[])[1] += 77; }, /^parts\.game\.g_rings$/],
    ["a global added", () => { g().g_new = 1; }, /^parts\.game\.g_new$/],
    ["a global deleted", () => { delete g().g_rings; }, /^parts\.game\.g_rings \(gone\)$/],
    ["an actor taken out", () => { pool().splice(1, 1); }, /g_object_list/],
    ["the frame", () => { replica.frame = -1; }, /^frame$/],
  ];
  for (const [what, write, where] of cases) {
    const before = mirror.hash;
    write();
    const found = mirror.audit(replica, Infinity) ?? mirror.audit(replica, Infinity);
    report(`the audit finds ${what} written behind the codec's back: ${found}`,
           found !== null && where.test(found), `found ${found}`);
    report(`...which the kept hash cannot see (${what})`, mirror.hash === before);
    mirror.rehash(replica);
    report(`...and after a rehash there is nothing to find (${what})`,
           mirror.audit(replica, Infinity) === null);
  }
}

// -- what the state may not hold -------------------------------------------------

{
  const tracker = new StateTracker();
  let threw = false;
  try {
    tracker.update({ parts: { game: { m: new Map() } } }, 1);
  } catch (e) {
    threw = e instanceof NetStateError && /Map/.test(String(e));
  }
  report("a Map in the state is refused by name", threw);
}

// -- the fuzz --------------------------------------------------------------------

const profiles = [
  { name: "clean", loss: 0, latency: 1, jitter: 0, dup: 0, ackDelay: 1 },
  { name: "lossy", loss: 0.2, latency: 3, jitter: 4, dup: 0.05, ackDelay: 4 },
  { name: "awful", loss: 0.5, latency: 6, jitter: 10, dup: 0.2, ackDelay: 12 },
  { name: "slow acks", loss: 0.05, latency: 2, jitter: 1, dup: 0, ackDelay: 60 },
];
for (const p of profiles) {
  let applied = 0, keyframes = 0, bytes = 0;
  const before = failures;
  for (let seed = 1; seed <= 40; seed++) {
    const r = run(seed * 7919 + p.name.length, 400, p);
    applied += r.applied;
    keyframes += r.keyframes;
    bytes += r.bytes;
  }
  report(`${p.name}: ${applied} ticks applied over 40 seeds, every one equal and `
         + `hash-equal (${keyframes} keyframes, ${(bytes / 1024).toFixed(0)} KiB)`,
         failures === before && applied > 1000);
}

console.log(`\nnet codec: ${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
