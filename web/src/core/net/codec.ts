/**
 * The state codec: what the host sends so a replica holds exactly the host's
 * state, and how the replica puts it back.
 *
 * `docs/NETPLAY.md` is the design; this is the mechanism. Three properties are
 * load-bearing, and each is what the fuzz test in `web/test/net_codec.test.ts`
 * asserts:
 *
 * **1. A delta is absolute and idempotent over its window.** A packet for tick
 * `t` against base `b` carries, for *every* path that changed at any tick in
 * `(b, t]`, that path's value **at `t`**. Applied to the replica's state at any
 * tick `c` in `[b, t]` it therefore produces the state at `t` exactly -- which
 * is what lets the host build a delta against whatever the replica last
 * acknowledged while the replica has already moved past it. A diff of
 * `state(b)` against `state(t)` would not have this property: a value that
 * changed after `b` and changed back by `t` would be missing from it, and a
 * replica at `c` would keep the intermediate value.
 *
 * **2. Pools are keyed by identity, not by index.** An array whose elements
 * are all plain objects with a distinct integer `at` -- the actor pool, the
 * script's spawn list -- is diffed as an ordered set of `(at, serial)`. The
 * sweep in `GameUpdate` *filters* `g_object_list`, so an index diff would
 * re-send every actor after the gap, and worse, patching in place would write
 * one actor's fields onto the object the character layer holds for another.
 * The serial is the host's: a new object at an old `at` is a new serial, so a
 * respawn is a replacement and never a patch.
 *
 * **3. Lossless.** Integers go as zigzag varints, everything else as f64,
 * `-0` included; `undefined`, `null` and an array hole are three different
 * tags. So the replica's state is bit-identical to the host's and
 * {@link TreeHasher} can prove it every tick.
 *
 * Nothing here knows what a game is. The state is a tree of plain objects,
 * arrays and primitives, which is exactly what `world.save()` promises.
 */
import { ByteReader, ByteWriter, MAX_ZIGZAG, WireError } from "./bytes";
import {
  LeafTag, PATH_ROOT, combine, combineNumber, fmix, hashString, pathIndex,
  pathKey, pathKeyed,
} from "./hash";

// -- paths ------------------------------------------------------------------

/**
 * One step of a path. A string is an object key, a number `>= 0` an array
 * index, and a number `< 0` an element of a pool, by its `at` zigzagged --
 * `at`s are negative too: the port numbers the actors it makes itself (a
 * horde placer's children, the bats' wings) below zero, where no spawn
 * address can be.
 */
export type Seg = string | number;

function zigzag(v: number): number {
  return v >= 0 ? v * 2 : -v * 2 - 1;
}

function unzigzag(z: number): number {
  return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
}

export function keyedSeg(at: number): number {
  return -zigzag(at) - 1;
}

export function segAt(seg: number): number {
  return unzigzag(-seg - 1);
}

/** Sorts below every character a key can contain, so an ancestor sorts first. */
const SEP = "\u0001";

export function pathString(segs: readonly Seg[], n = segs.length): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    const g = segs[i];
    if (i) s += SEP;
    s += typeof g === "string" ? g : g >= 0 ? `#${g}` : `@${segAt(g)}`;
  }
  return s;
}

/** A path as a person reads it: `parts.game.g_object_list[@6720].pos.x`. */
export function pathLabel(segs: readonly Seg[]): string {
  let s = "";
  for (const g of segs) {
    if (typeof g === "string") s += s ? `.${g}` : g;
    else if (g >= 0) s += `[${g}]`;
    else s += `[@${segAt(g)}]`;
  }
  return s;
}

/** {@link pathString}'s form back to {@link pathLabel}'s, for a report. */
export function labelOf(path: string): string {
  if (path === "") return "(root)";
  return pathLabel(path.split(SEP).map((p) =>
    p.startsWith("#") ? Number(p.slice(1))
      : p.startsWith("@") ? keyedSeg(Number(p.slice(1))) : p));
}

/**
 * The `at`s of a pool, or null if `arr` is not one: every element present, a
 * plain object, with a distinct integer `at` within `±2^31`. Empty is not a
 * pool by content -- an empty array keeps whatever it was.
 */
/** {@link poolAts}'s scratch: it runs for every array of objects, every tick. */
const POOL_SEEN = new Set<number>();

export function poolAts(arr: readonly unknown[]): number[] | null {
  const n = arr.length;
  if (n === 0) return null;
  const first = arr[0];
  // The cheap refusal first: nearly every array in the state is numbers.
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return null;
  }
  const ats = new Array<number>(n);
  const seen = POOL_SEEN;
  seen.clear();
  for (let i = 0; i < n; i++) {
    if (!(i in arr)) return null;
    const e = arr[i];
    if (e === null || typeof e !== "object" || Array.isArray(e)) return null;
    const at = (e as { at?: unknown }).at;
    if (typeof at !== "number" || !Number.isInteger(at)
        || at < -0x80000000 || at > 0x7fffffff || seen.has(at)) {
      return null;
    }
    seen.add(at);
    ats[i] = at;
  }
  return ats;
}

/** Thrown for state the codec cannot carry -- a `Map`, a class instance. */
export class NetStateError extends Error {}

/** Thrown when a delta cannot be applied to the state the replica holds. */
export class ApplyError extends Error {}

function isPlainObject(v: object): boolean {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function badPrimitive(v: unknown): boolean {
  const t = typeof v;
  return t === "function" || t === "symbol" || t === "bigint";
}

// -- values -----------------------------------------------------------------

export enum ValueTag {
  Undefined = 0,
  Null = 1,
  False = 2,
  True = 3,
  Hole = 4,
  Int = 5,
  F64 = 6,
  Str = 7,
  Obj = 8,
  Arr = 9,
  /** A pool: each element preceded by its serial. */
  Pool = 10,
}

export enum OpCode {
  /** The value at the path, whatever it is now. A hole in an array too. */
  Set = 0,
  /** The key is gone from its object. */
  Del = 1,
  /** An indexed array's shortest length in the window, then its new one. */
  Len = 2,
  /** A pool's new order: `(at, serial)` each, and the whole element if new. */
  Order = 3,
}

/** A hole, read back. Never stored. */
const HOLE: unique symbol = Symbol("hole");

/** 0 a primitive, 1 an object, 2 an array. */
function kindOf(v: unknown): 0 | 1 | 2 {
  if (v === null || typeof v !== "object") return 0;
  return Array.isArray(v) ? 2 : 1;
}

// -- keys -------------------------------------------------------------------

/**
 * The key strings, interned for one epoch of one connection.
 *
 * A key is sent as a string once and as an index afterwards. The string rides
 * in every packet whose base is older than the tick the key first appeared
 * in, so a packet the replica never saw cannot leave it holding an index it
 * cannot read: by the time it acknowledges a tick at or past that one, it
 * applied a packet that carried the string. Indices only grow, and so do the
 * ticks they were introduced at, which is what lets {@link defsAfter} find the
 * cut with a search.
 */
export class KeyTable {
  private readonly index = new Map<string, number>();
  readonly strings: string[] = [];
  private readonly intro: number[] = [];

  ref(k: string, tick: number): number {
    let i = this.index.get(k);
    if (i === undefined) {
      i = this.strings.length;
      this.index.set(k, i);
      this.strings.push(k);
      this.intro.push(tick);
    }
    return i;
  }

  /** The first index introduced after `base`. */
  defsAfter(base: number): number {
    let lo = 0, hi = this.intro.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.intro[mid] > base) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

// -- the host: a shadow, and what changed -----------------------------------

/** What kind of change a path saw. Several can land on one path in a window. */
export enum Dirty {
  /** The value at this path: set it, or delete the key. */
  Value = 1,
  /** An indexed array's length. */
  Len = 2,
  /** A pool's order or membership. */
  Order = 4,
}

interface DirtyEntry {
  segs: Seg[];
  kinds: number;
  /**
   * For `Len`: the shortest the array was, after a change, at any tick of the
   * window. An index at or past it may have been cut off and grown back as a
   * hole, which only a truncation to here and a regrowth can reproduce -- and
   * every index past it that *has* a value at the window's end was written
   * back after the cut, so it is `Value`-dirty and gets set again.
   */
  minLen: number;
}

/** The host's bookkeeping for one pool in the shadow. */
interface PoolInfo {
  ats: number[];
  serials: number[];
  /** Last tick's live objects, to tell a respawn from a pool rebuilt whole. */
  objs: object[];
  /** The tick each element (by serial) appeared at. */
  intro: number[];
  /**
   * What the last tick that could tell said: that this pool is rebuilt from
   * fresh objects (two or more `at`s survived and none kept its object), or
   * that its objects persist (one did). See {@link StateTracker.diffPool}.
   */
  rebuilt: boolean;
}

/** How many ticks of change lists the host keeps. */
export const HISTORY = 256;

/** What {@link StateTracker.encodeDelta} reports. */
export interface DeltaInfo {
  ops: number;
  /** Distinct paths the window touched, before any were folded together. */
  paths: number;
}

/** A caller's own values, written after the ops with the same keys. */
export type Extra = (w: ByteWriter, value: (v: unknown) => void) => void;

/**
 * The host's side: a shadow copy of the state as it was last diffed, and a
 * ring of what changed each tick.
 *
 * {@link update} walks the live state against the shadow once a tick, records
 * every path whose value, length or pool order moved, and brings the shadow up
 * to date **in place** -- so nothing is cloned per tick but what is new.
 * After it, the shadow is a deep copy of the live state, and everything this
 * encodes is read from the shadow, never from the live objects.
 */
export class StateTracker {
  private shadow: Record<string, unknown> | null = null;
  private readonly pools = new WeakMap<unknown[], PoolInfo>();
  private readonly lookups = new WeakMap<unknown[], Map<number, unknown>>();
  /**
   * How many keys each shadow object holds. The walk counts the live object's
   * keys as it goes; only when the two differ can a key have gone, and only
   * then is the shadow's every key looked up in the live one -- which was
   * half of every object's cost, every tick.
   */
  private readonly nkeys = new WeakMap<object, number>();
  private serial = 0;
  private tick = -1;
  private readonly segs: Seg[] = [];
  private cur = new Map<string, DirtyEntry>();
  private readonly ring = new Map<number, Map<string, DirtyEntry>>();
  private oldest = Infinity;
  readonly keys = new KeyTable();
  private readonly body = new ByteWriter(4096);
  private readonly eventsBody = new ByteWriter(256);
  /** Paths recorded by the last {@link update}. For the stats. */
  lastDirty = 0;

  /** The state as of the last update. Read-only to everyone else. */
  get state(): Readonly<Record<string, unknown>> | null {
    return this.shadow;
  }

  /** The tick the shadow is at, or -1 before the first update. */
  get at(): number {
    return this.tick;
  }

  /**
   * Whether a delta from `base` can be built: every tick of its window is in
   * the ring. `base` must be a tick the tracker has seen.
   */
  covers(base: number): boolean {
    if (!this.shadow || base >= this.tick) return false;
    if (base < this.oldest - 1) return false;
    for (let k = base + 1; k <= this.tick; k++) {
      if (!this.ring.has(k)) return false;
    }
    return true;
  }

  /**
   * Diff the live state against the shadow, as tick `t`.
   *
   * `t` must increase. A tick skipped is simply absent from the ring, and a
   * base whose window crosses it cannot be covered.
   */
  update(live: Record<string, unknown>, t: number): void {
    if (t <= this.tick) throw new Error(`tick ${t} after ${this.tick}`);
    this.tick = t;
    this.cur = new Map();
    this.segs.length = 0;
    if (!this.shadow) {
      this.shadow = this.copy(live) as Record<string, unknown>;
      // Everything is new: the root itself is the one dirty path.
      this.cur.set("", { segs: [], kinds: Dirty.Value, minLen: Infinity });
    } else {
      this.diffObject(live, this.shadow, 0);
    }
    this.ring.set(t, this.cur);
    this.lastDirty = this.cur.size;
    if (this.oldest === Infinity) this.oldest = t;
    while (this.ring.size > HISTORY) {
      this.ring.delete(this.oldest);
      do this.oldest++; while (!this.ring.has(this.oldest) && this.oldest < t);
    }
  }

  private mark(depth: number, kind: Dirty, len = Infinity): void {
    const key = pathString(this.segs, depth);
    const e = this.cur.get(key);
    if (e) {
      e.kinds |= kind;
      if (len < e.minLen) e.minLen = len;
    } else {
      this.cur.set(key, { segs: this.segs.slice(0, depth), kinds: kind, minLen: len });
    }
  }

  /** A deep copy for the shadow, with pools given serials as they are found. */
  private copy(v: unknown): unknown {
    if (v === null || typeof v !== "object") {
      if (badPrimitive(v)) {
        throw new NetStateError(`a ${typeof v} at ${pathLabel(this.segs)}`);
      }
      return v;
    }
    if (Array.isArray(v)) {
      const n = v.length;
      const out = new Array<unknown>(n);
      for (let i = 0; i < n; i++) if (i in v) out[i] = this.copy(v[i]);
      const ats = poolAts(v);
      if (ats) {
        this.pools.set(out, {
          ats,
          serials: ats.map(() => ++this.serial),
          objs: (v as object[]).slice(),
          intro: ats.map(() => this.tick),
          rebuilt: false,
        });
      }
      return out;
    }
    if (!isPlainObject(v)) {
      throw new NetStateError(`a ${v.constructor?.name ?? "non-plain object"}`
        + ` at ${pathLabel(this.segs)}`);
    }
    const out: Record<string, unknown> = {};
    const o = v as Record<string, unknown>;
    let n = 0;
    for (const k in o) {
      out[k] = this.copy(o[k]);
      n++;
    }
    this.nkeys.set(out, n);
    return out;
  }

  private diffObject(live: Record<string, unknown>,
                     shadow: Record<string, unknown>, d: number): void {
    const segs = this.segs;
    let n = 0, added = 0;
    for (const k in live) {
      n++;
      const lv = live[k];
      const sv = shadow[k];
      // The common case, first and cheapest: a primitive that has not moved.
      // `===` agrees with `Object.is` except on 0 and -0, which it calls equal,
      // and NaN, which it does not -- the second falls through to the walk,
      // which says NaN is NaN.
      // `undefined` may be a key the shadow does not have yet: the long way.
      if (lv === sv && lv !== undefined && (lv === null || typeof lv !== "object")
          && (lv !== 0 || 1 / (lv as number) === 1 / (sv as number))) continue;
      segs[d] = k;
      if (sv === undefined && !Object.hasOwn(shadow, k)) {
        shadow[k] = this.copy(lv);
        added++;
        this.mark(d + 1, Dirty.Value);
        continue;
      }
      this.diffChild(shadow, k, lv, sv, d + 1);
    }
    // Every live key is in the shadow now; the shadow holds more only if some
    // went from the live object since the last tick.
    const had = this.nkeys.get(shadow);
    if (had !== undefined && had + added === n) {
      if (added) this.nkeys.set(shadow, n);
      return;
    }
    for (const k in shadow) {
      if (!Object.hasOwn(live, k)) {
        delete shadow[k];
        segs[d] = k;
        this.mark(d + 1, Dirty.Value);
      }
    }
    this.nkeys.set(shadow, n);
  }

  /** `segs[cd - 1]` is `key`, and `container[key]` holds `sv`. */
  private diffChild(container: Record<string | number, unknown>,
                    key: string | number, lv: unknown, sv: unknown,
                    cd: number): void {
    const lk = kindOf(lv);
    const sk = kindOf(sv);
    if (lk === 0 && sk === 0) {
      if (!Object.is(lv, sv)) {
        if (badPrimitive(lv)) {
          throw new NetStateError(`a ${typeof lv} at ${pathLabel(this.segs.slice(0, cd))}`);
        }
        container[key] = lv;
        this.mark(cd, Dirty.Value);
      }
      return;
    }
    if (lk === 1 && sk === 1) {
      if (!isPlainObject(lv as object)) {
        throw new NetStateError(`a non-plain object at ${pathLabel(this.segs.slice(0, cd))}`);
      }
      this.diffObject(lv as Record<string, unknown>,
                      sv as Record<string, unknown>, cd);
      return;
    }
    if (lk === 2 && sk === 2) {
      const la = lv as unknown[];
      const sa = sv as unknown[];
      const info = this.pools.get(sa);
      const ats = poolAts(la);
      if (info) {
        if (ats || la.length === 0) {
          this.diffPool(la, sa, info, ats ?? [], cd);
          return;
        }
      } else if (!ats) {
        this.diffIndexed(la, sa, cd);
        return;
      } else if (sa.length === 0) {
        // An empty array becoming a pool: every element is new.
        const fresh: PoolInfo = { ats: [], serials: [], objs: [], intro: [],
                                  rebuilt: false };
        this.pools.set(sa, fresh);
        this.diffPool(la, sa, fresh, ats, cd);
        return;
      }
      // A pool that stopped being one, or the other way round, with elements
      // on both sides: the array is replaced whole.
    }
    container[key] = this.copy(lv);
    this.mark(cd, Dirty.Value);
  }

  private diffIndexed(live: unknown[], shadow: unknown[], d: number): void {
    const segs = this.segs;
    const n = live.length;
    if (n !== shadow.length) {
      this.mark(d, Dirty.Len, n);
      if (n < shadow.length) shadow.length = n;
    }
    for (let i = 0; i < n; i++) {
      const lv = live[i];
      const sv = shadow[i];
      // As in `diffObject`: an element that has not moved costs a comparison.
      // `undefined` may be a hole on either side, so it takes the long way.
      if (lv === sv && lv !== undefined && (lv === null || typeof lv !== "object")
          && (lv !== 0 || 1 / (lv as number) === 1 / (sv as number))) continue;
      const has = lv !== undefined || i in live;
      const had = sv !== undefined || i in shadow;
      if (!has && !had) continue;
      segs[d] = i;
      if (!has) {
        delete shadow[i];
        this.mark(d + 1, Dirty.Value);
        continue;
      }
      if (!had) {
        shadow[i] = this.copy(live[i]);
        this.mark(d + 1, Dirty.Value);
        continue;
      }
      this.diffChild(shadow as unknown as Record<number, unknown>, i, lv, sv, d + 1);
    }
    // Trailing holes: the loop above cannot lengthen the shadow on its own.
    if (shadow.length !== n) shadow.length = n;
  }

  /**
   * A pool, element by element: which `at`s stayed, which went, which came,
   * and whether any of them was replaced.
   *
   * **Identity is the `at`, and the object only where objects persist.** The
   * actor pool keeps its objects from tick to tick, so there an `at` that
   * persists with a different object is a respawn -- a new element, sent
   * whole, never a patch. But some pools are rebuilt every tick from fresh
   * objects -- `g_shot_test_list`, the walker's `spawns`, which `saveState`
   * copies -- and there a new object means nothing. The two are told apart by
   * the tick itself: a pool in which any surviving `at` kept its object
   * persists, and one in which two or more survived and none did was rebuilt.
   *
   * **One survivor proves nothing,** because the pool's only survivor
   * respawning looks exactly like a one-element pool being rebuilt. That tick
   * goes by what the pool last proved to be: the actor pool proves itself
   * persistent nearly every tick, and a rebuilt list as soon as it holds two.
   * What is left unprovable is two or more survivors of a persistent pool all
   * respawning in the one tick, which is patched in place: the values and the
   * hash stay right, and the character layer, which holds the objects, looks
   * for a life starting again in the values too (`render/characters.ts`).
   */
  private diffPool(live: unknown[], shadow: unknown[], info: PoolInfo,
                   ats: number[], d: number): void {
    const n = live.length;
    const serials = new Array<number>(n);
    const intro = new Array<number>(n);
    const from = new Array<number>(n);
    let byAt: Map<number, number> | null = null;
    let kept = 0, survivors = 0;
    for (let i = 0; i < n; i++) {
      const at = ats[i];
      let j = -1;
      if (info.ats[i] === at) {
        j = i;
      } else {
        if (!byAt) {
          byAt = new Map();
          for (let k = 0; k < info.ats.length; k++) byAt.set(info.ats[k], k);
        }
        j = byAt.get(at) ?? -1;
      }
      from[i] = j;
      if (j >= 0) {
        survivors++;
        if (info.objs[j] === live[i]) kept++;
      }
    }
    if (kept > 0) info.rebuilt = false;
    else if (survivors >= 2) info.rebuilt = true;
    // Objects persist here: an `at` that kept its place but not its object is
    // a new element.
    const persistent = !info.rebuilt;
    let changed = n !== info.ats.length;
    for (let i = 0; i < n; i++) {
      let j = from[i];
      if (j >= 0 && persistent && info.objs[j] !== live[i]) j = -1;
      if (j >= 0) {
        serials[i] = info.serials[j];
        intro[i] = info.intro[j];
      } else {
        serials[i] = ++this.serial;
        intro[i] = this.tick;
      }
      from[i] = j;
      if (!changed && info.serials[i] !== serials[i]) changed = true;
    }
    // The objects are the live ones either way: the next tick compares to these.
    info.objs = (live as object[]).slice();
    if (changed) {
      this.mark(d, Dirty.Order);
      const next = new Array<unknown>(n);
      for (let i = 0; i < n; i++) {
        this.segs[d] = keyedSeg(ats[i]);
        next[i] = from[i] >= 0 ? shadow[from[i]] : this.copy(live[i]);
      }
      // In place: the pool's bookkeeping is keyed on this array.
      this.lookups.delete(shadow);
      shadow.length = 0;
      for (let i = 0; i < n; i++) shadow.push(next[i]);
      info.ats = ats;
      info.serials = serials;
      info.intro = intro;
    }
    const segs = this.segs;
    for (let i = 0; i < n; i++) {
      // A new element was just copied: it cannot differ from itself.
      if (changed && from[i] < 0) continue;
      segs[d] = keyedSeg(ats[i]);
      this.diffChild(shadow as unknown as Record<number, unknown>, i,
                     live[i], shadow[i], d + 1);
    }
  }

  // -- encoding ---------------------------------------------------------

  /**
   * Write a delta from `base` to the current tick into `out`: the key strings
   * the replica may not have, then the ops, then whatever `extra` writes (the
   * events), which may use keys introduced here. Returns false, having
   * written nothing, when `base` is not {@link covers covered}: the caller
   * sends a keyframe instead.
   */
  encodeDelta(base: number, out: ByteWriter, extra?: Extra): DeltaInfo | false {
    if (!this.covers(base)) return false;
    const t = this.tick;
    // The window's changes, merged. Kinds accumulate; the value is read at `t`.
    const union = new Map<string, DirtyEntry>();
    for (let k = base + 1; k <= t; k++) {
      for (const [key, e] of this.ring.get(k)!) {
        const u = union.get(key);
        if (u) {
          u.kinds |= e.kinds;
          if (e.minLen < u.minLen) u.minLen = e.minLen;
        } else {
          union.set(key, { segs: e.segs, kinds: e.kinds, minLen: e.minLen });
        }
      }
    }
    // Sorted, so an ancestor comes before its descendants and they follow it
    // contiguously -- which is what lets one op settle all of theirs.
    const order = [...union.keys()].sort();
    const body = this.body;
    body.reset();
    let ops = 0;
    let prev: readonly Seg[] = [];
    // Paths whose whole subtree an earlier op already wrote. Smallest on top.
    const skips: string[] = [];
    const value = (v: unknown): void => this.writeValue(body, v);
    for (const key of order) {
      let skipped = false;
      while (skips.length) {
        const top = skips[skips.length - 1];
        if (key.startsWith(top + SEP)) { skipped = true; break; }
        if (key > top) { skips.pop(); continue; }
        break;
      }
      if (skipped) continue;
      const e = union.get(key)!;
      const segs = e.segs;
      if (e.kinds & Dirty.Value) {
        if (segs.length === 0) {
          // The whole root: only the first update ever records this.
          this.emitPath(body, prev, segs);
          body.u8(OpCode.Set);
          value(this.shadow);
        } else {
          const parent = this.resolve(segs, segs.length - 1);
          if (parent === undefined) continue;
          const last = segs[segs.length - 1];
          if (typeof last === "string") {
            if (kindOf(parent) !== 1) continue;
            const obj = parent as Record<string, unknown>;
            this.emitPath(body, prev, segs);
            if (Object.hasOwn(obj, last)) {
              body.u8(OpCode.Set);
              value(obj[last]);
            } else {
              body.u8(OpCode.Del);
            }
          } else if (last >= 0) {
            if (kindOf(parent) !== 2) continue;
            const arr = parent as unknown[];
            if (last >= arr.length) continue;
            this.emitPath(body, prev, segs);
            body.u8(OpCode.Set);
            if (last in arr) value(arr[last]);
            else body.u8(ValueTag.Hole);
          } else {
            // A pool element is never replaced by path: `Order` does that.
            continue;
          }
        }
        prev = segs;
        ops++;
        skips.push(key);
        continue;
      }
      const node = this.resolve(segs, segs.length);
      if (kindOf(node) !== 2) continue;
      const arr = node as unknown[];
      const info = this.pools.get(arr);
      if ((e.kinds & Dirty.Order) && info) {
        this.emitPath(body, prev, segs);
        body.u8(OpCode.Order);
        body.uvar(arr.length);
        const full: string[] = [];
        for (let i = 0; i < arr.length; i++) {
          body.svar(info.ats[i]);
          body.uvar(info.serials[i]);
          // New since the base: the replica may not have it, so it goes whole.
          // Anything older has been in the pool continuously since before the
          // base -- a removal and re-add is a new serial -- so the replica has
          // it, whichever tick of the window it is at.
          if (info.intro[i] > base) {
            body.u8(1);
            value(arr[i]);
            full.push(key + SEP + `@${info.ats[i]}`);
          } else {
            body.u8(0);
          }
        }
        prev = segs;
        ops++;
        // Every one of these sorts after `key` and before anything still on
        // the stack, so they go on top, smallest last.
        full.sort();
        for (let i = full.length - 1; i >= 0; i--) skips.push(full[i]);
        continue;
      }
      if ((e.kinds & Dirty.Len) && !info) {
        this.emitPath(body, prev, segs);
        body.u8(OpCode.Len);
        body.uvar(Math.min(e.minLen, arr.length));
        body.uvar(arr.length);
        prev = segs;
        ops++;
      }
    }
    const events = this.eventsBody;
    events.reset();
    extra?.(events, (v) => this.writeValue(events, v));
    // Every key this packet uses is interned by now: the ones the replica may
    // lack go first.
    this.writeDefs(out, this.keys.defsAfter(base));
    out.uvar(ops);
    out.bytes(body.finish());
    out.bytes(events.finish());
    return { ops, paths: union.size };
  }

  /** The whole state as one value, for a replica that has nothing. */
  encodeKeyframe(out: ByteWriter, extra?: Extra): void {
    if (!this.shadow) throw new Error("keyframe before the first update");
    const body = new ByteWriter(64 * 1024);
    this.writeValue(body, this.shadow);
    const events = new ByteWriter(256);
    extra?.(events, (v) => this.writeValue(events, v));
    this.writeDefs(out, 0);
    out.bytes(body.finish());
    out.bytes(events.finish());
  }

  private writeDefs(out: ByteWriter, from: number): void {
    const strings = this.keys.strings;
    out.uvar(strings.length - from);
    for (let i = from; i < strings.length; i++) {
      out.uvar(i);
      out.str(strings[i]);
    }
  }

  /** Walk `segs[0..n)` in the shadow. Undefined if any step is missing. */
  private resolve(segs: readonly Seg[], n: number): unknown {
    let node: unknown = this.shadow;
    for (let i = 0; i < n; i++) {
      const g = segs[i];
      const k = kindOf(node);
      if (typeof g === "string") {
        if (k !== 1 || !Object.hasOwn(node as object, g)) return undefined;
        node = (node as Record<string, unknown>)[g];
      } else if (g >= 0) {
        const arr = node as unknown[];
        if (k !== 2 || g >= arr.length || !(g in arr)) return undefined;
        node = arr[g];
      } else {
        if (k !== 2) return undefined;
        node = this.byAt(node as unknown[]).get(segAt(g));
        if (node === undefined) return undefined;
      }
    }
    return node;
  }

  /**
   * A pool's elements by `at`. Cached per shadow array; {@link diffPool} drops
   * the entry whenever it reorders one, which is the only way a shadow pool's
   * elements change.
   */
  private byAt(arr: unknown[]): Map<number, unknown> {
    let m = this.lookups.get(arr);
    if (m) return m;
    m = new Map();
    for (const e of arr) {
      if (e && typeof e === "object") m.set((e as { at: number }).at, e);
    }
    this.lookups.set(arr, m);
    return m;
  }

  private emitPath(w: ByteWriter, prev: readonly Seg[], segs: readonly Seg[]): void {
    let common = 0;
    const lim = Math.min(prev.length, segs.length);
    while (common < lim && prev[common] === segs[common]) common++;
    w.uvar(common);
    w.uvar(segs.length - common);
    for (let i = common; i < segs.length; i++) {
      const g = segs[i];
      if (typeof g === "string") w.uvar(this.keys.ref(g, this.tick) * 4);
      else if (g >= 0) w.uvar(g * 4 + 1);
      else w.uvar((-g - 1) * 4 + 2); // the zigzagged `at`, as the seg holds it
    }
  }

  /** One value, whole. Pools carry their serials so later `Order`s match. */
  writeValue(w: ByteWriter, v: unknown): void {
    if (v === undefined) return w.u8(ValueTag.Undefined);
    if (v === null) return w.u8(ValueTag.Null);
    switch (typeof v) {
      case "boolean":
        return w.u8(v ? ValueTag.True : ValueTag.False);
      case "number":
        if (Number.isInteger(v) && !Object.is(v, -0)
            && Math.abs(v) <= MAX_ZIGZAG) {
          w.u8(ValueTag.Int);
          return w.svar(v);
        }
        w.u8(ValueTag.F64);
        return w.f64(v);
      case "string":
        w.u8(ValueTag.Str);
        return w.str(v);
      case "object":
        break;
      default:
        throw new NetStateError(`cannot send a ${typeof v}`);
    }
    if (Array.isArray(v)) {
      const info = this.pools.get(v);
      if (info && info.ats.length === v.length) {
        w.u8(ValueTag.Pool);
        w.uvar(v.length);
        for (let i = 0; i < v.length; i++) {
          w.uvar(info.serials[i]);
          this.writeValue(w, v[i]);
        }
        return;
      }
      w.u8(ValueTag.Arr);
      w.uvar(v.length);
      for (let i = 0; i < v.length; i++) {
        if (i in v) this.writeValue(w, v[i]);
        else w.u8(ValueTag.Hole);
      }
      return;
    }
    const o = v as Record<string, unknown>;
    const ks = Object.keys(o);
    w.u8(ValueTag.Obj);
    w.uvar(ks.length);
    for (const k of ks) {
      w.uvar(this.keys.ref(k, this.tick));
      this.writeValue(w, o[k]);
    }
  }
}

// -- the replica ------------------------------------------------------------

/**
 * The replica's side: the key strings it has been given, and each pool's
 * serials. It holds no state of its own -- it writes into the tree it is
 * handed, which for the player is `G` itself, so every object that did not
 * change keeps its identity and the render layers' references stay good.
 */
export class StateMirror {
  private keys: string[] = [];
  private readonly pools = new WeakMap<unknown[], Map<number, number>>();
  private readonly byAtCache = new Map<unknown[], Map<number, unknown>>();

  /** Read the key strings a packet carries. */
  readDefs(r: ByteReader): void {
    const n = r.uvar();
    for (let i = 0; i < n; i++) {
      const idx = r.uvar();
      const s = r.str();
      if (idx > this.keys.length + 1_000_000) throw new WireError(`key index ${idx}`);
      this.keys[idx] = s;
    }
  }

  private key(i: number): string {
    const k = this.keys[i];
    if (k === undefined) throw new ApplyError(`key #${i} was never defined`);
    return k;
  }

  /** A keyframe: a new key table, and the whole state. The caller installs it. */
  readKeyframe(r: ByteReader): Record<string, unknown> {
    this.keys = [];
    this.readDefs(r);
    const root = this.readValue(r);
    if (kindOf(root) !== 1) throw new ApplyError("a keyframe that is not an object");
    return root as Record<string, unknown>;
  }

  /** Read one value, whole. */
  readValue(r: ByteReader): unknown {
    const tag = r.u8();
    switch (tag) {
      case ValueTag.Undefined: return undefined;
      case ValueTag.Null: return null;
      case ValueTag.False: return false;
      case ValueTag.True: return true;
      case ValueTag.Hole: return HOLE;
      case ValueTag.Int: return r.svar();
      case ValueTag.F64: return r.f64();
      case ValueTag.Str: return r.str();
      case ValueTag.Obj: {
        const n = r.uvar();
        const o: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const k = this.key(r.uvar());
          const v = this.readValue(r);
          if (v === HOLE) throw new ApplyError(`a hole as the value of ${k}`);
          o[k] = v;
        }
        return o;
      }
      case ValueTag.Arr: {
        const n = r.uvar();
        const a = new Array<unknown>(n);
        for (let i = 0; i < n; i++) {
          const v = this.readValue(r);
          if (v !== HOLE) a[i] = v;
        }
        return a;
      }
      case ValueTag.Pool: {
        const n = r.uvar();
        const a = new Array<unknown>(n);
        const serials = new Map<number, number>();
        for (let i = 0; i < n; i++) {
          const serial = r.uvar();
          const v = this.readValue(r);
          if (kindOf(v) !== 1) throw new ApplyError("a pool element that is not an object");
          a[i] = v;
          serials.set((v as { at: number }).at, serial);
        }
        this.pools.set(a, serials);
        return a;
      }
      default:
        throw new WireError(`value tag ${tag}`);
    }
  }

  /**
   * Apply one delta's ops to `root`, in place, and return how many there
   * were. `touched` collects the top-level parts written -- `frame`, `rng`,
   * `parts.game`, `parts.script` -- so the caller knows which systems to tell.
   *
   * Throws {@link ApplyError} if the state lacks what an op needs. For a
   * replica whose state really is the host's at some tick in the delta's
   * window that cannot happen, so a throw means it had already diverged, and
   * the caller asks for a keyframe.
   */
  applyOps(r: ByteReader, root: Record<string, unknown>,
           touched: Set<string>): number {
    this.byAtCache.clear();
    const n = r.uvar();
    const segs: Seg[] = [];
    for (let op = 0; op < n; op++) {
      const common = r.uvar();
      const extra = r.uvar();
      if (common > segs.length) throw new WireError("path prefix past the last path");
      segs.length = common;
      for (let i = 0; i < extra; i++) segs.push(this.readSeg(r));
      const code = r.u8();
      if (segs.length) {
        touched.add(segs[0] === "parts" && segs.length > 1
          ? `parts.${String(segs[1])}` : String(segs[0]));
      } else {
        touched.add("");
      }
      switch (code) {
        case OpCode.Set: {
          const v = this.readValue(r);
          if (segs.length === 0) {
            if (kindOf(v) !== 1) throw new ApplyError("a root that is not an object");
            for (const k of Object.keys(root)) delete root[k];
            Object.assign(root, v as object);
            break;
          }
          const parent = this.resolve(root, segs, segs.length - 1);
          const last = segs[segs.length - 1];
          if (typeof last === "string") {
            if (kindOf(parent) !== 1) throw this.fail("set under a non-object", segs);
            if (v === HOLE) throw this.fail("a hole in an object", segs);
            (parent as Record<string, unknown>)[last] = v;
          } else if (last >= 0) {
            if (kindOf(parent) !== 2) throw this.fail("index into a non-array", segs);
            const arr = parent as unknown[];
            if (v === HOLE) {
              if (last >= arr.length) arr.length = last + 1;
              delete arr[last];
            } else {
              arr[last] = v;
            }
            this.byAtCache.delete(arr);
          } else {
            throw this.fail("a pool element set by path", segs);
          }
          break;
        }
        case OpCode.Del: {
          const parent = this.resolve(root, segs, segs.length - 1);
          const last = segs[segs.length - 1];
          if (typeof last !== "string" || kindOf(parent) !== 1) {
            throw this.fail("delete of a non-key", segs);
          }
          delete (parent as Record<string, unknown>)[last];
          break;
        }
        case OpCode.Len: {
          const cut = r.uvar();
          const len = r.uvar();
          const arr = this.resolve(root, segs, segs.length) as unknown[];
          if (kindOf(arr) !== 2) throw this.fail("length of a non-array", segs);
          // Cut to the shortest the window saw, then grow: what was cut and
          // came back as a hole stays a hole, and what came back with a value
          // is set by its own op, which sorts after this one.
          if (arr.length > cut) arr.length = cut;
          arr.length = len;
          this.byAtCache.delete(arr);
          break;
        }
        case OpCode.Order: {
          const arr = this.resolve(root, segs, segs.length) as unknown[];
          if (kindOf(arr) !== 2) throw this.fail("order of a non-array", segs);
          const count = r.uvar();
          const had = this.pools.get(arr) ?? new Map<number, number>();
          const byAt = this.byAt(arr);
          const next = new Array<unknown>(count);
          const serials = new Map<number, number>();
          for (let i = 0; i < count; i++) {
            const at = r.svar();
            const serial = r.uvar();
            const full = r.u8();
            if (full) {
              const v = this.readValue(r) as Record<string, unknown>;
              if (kindOf(v) !== 1 || v.at !== at) {
                throw this.fail(`pool element @${at} is not itself`, segs);
              }
              // Whole because the base predates it, but this replica is past
              // the base and already has this life of it: the object it has
              // takes the value, so whatever holds the actor still does. An
              // actor is sent whole in every delta for as long as its spawn is
              // younger than the host's newest ack.
              const e = byAt.get(at);
              if (e !== undefined && had.get(at) === serial && kindOf(e) === 1) {
                const o = e as Record<string, unknown>;
                for (const k of Object.keys(o)) if (!Object.hasOwn(v, k)) delete o[k];
                Object.assign(o, v);
                next[i] = o;
              } else {
                next[i] = v;
              }
            } else {
              const e = byAt.get(at);
              if (e === undefined || had.get(at) !== serial) {
                throw this.fail(`pool element @${at}#${serial} is not here (have `
                  + `${e === undefined ? "none" : `#${had.get(at)}`})`, segs);
              }
              next[i] = e;
            }
            serials.set(at, serial);
          }
          arr.length = 0;
          for (let i = 0; i < count; i++) arr.push(next[i]);
          this.pools.set(arr, serials);
          this.byAtCache.delete(arr);
          break;
        }
        default:
          throw new WireError(`op ${code}`);
      }
    }
    return n;
  }

  private readSeg(r: ByteReader): Seg {
    const v = r.uvar();
    const kind = v % 4;
    const x = (v - kind) / 4;
    if (kind === 0) return this.key(x);
    if (kind === 1) return x;
    if (kind === 2) return -x - 1; // `x` is the zigzagged `at`
    throw new WireError(`segment kind ${kind}`);
  }

  private fail(what: string, segs: readonly Seg[]): ApplyError {
    return new ApplyError(`${what} at ${pathLabel(segs)}`);
  }

  private byAt(arr: unknown[]): Map<number, unknown> {
    let m = this.byAtCache.get(arr);
    if (m) return m;
    m = new Map();
    for (const e of arr) {
      if (e && typeof e === "object") m.set((e as { at: number }).at, e);
    }
    this.byAtCache.set(arr, m);
    return m;
  }

  private resolve(root: unknown, segs: readonly Seg[], n: number): unknown {
    let node = root;
    for (let i = 0; i < n; i++) {
      const g = segs[i];
      const k = kindOf(node);
      if (typeof g === "string") {
        if (k !== 1 || !Object.hasOwn(node as object, g)) {
          throw this.fail("missing key", segs.slice(0, i + 1));
        }
        node = (node as Record<string, unknown>)[g];
      } else if (g >= 0) {
        if (k !== 2 || !(g in (node as unknown[]))) {
          throw this.fail("missing index", segs.slice(0, i + 1));
        }
        node = (node as unknown[])[g];
      } else {
        if (k !== 2) throw this.fail("pool lookup in a non-array", segs.slice(0, i + 1));
        node = this.byAt(node as unknown[]).get(segAt(g));
        if (node === undefined) throw this.fail("missing pool element", segs.slice(0, i + 1));
      }
    }
    return node;
  }
}

// -- the hash ----------------------------------------------------------------

/** The depth at which a path becomes its own section: `parts.<id>.<key>`. */
const SECTION_DEPTH = 3;

/** Where a hash's sections go: each section's name and its own hash, once. */
export interface SectionSink {
  add(name: string, hash: number): void;
}

/** A plain `Map` as a sink, for the rare caller that wants one. */
export function sectionMap(map: Map<string, number>): SectionSink {
  return { add: (n, h) => { map.set(n, h); } };
}

/**
 * The state's hash, and optionally its sections'.
 *
 * Both ends run this one class over their own tree, so there is no second
 * copy of the leaf rules to drift. A section is a path one deep -- `frame`,
 * `rng` -- or three deep -- `parts.game.g_frame` -- or, under a pool that
 * deep, one element of it -- `parts.game.g_object_list[@6720]`. That is fine
 * enough to say which global or which actor a desync is in without shipping
 * the state to find out. A section's hash is its own leaves only; a section
 * inside it is its own entry.
 */
export class TreeHasher {
  private acc = 0;
  private readonly segs: Seg[] = [];
  private sections: SectionSink | null = null;
  /** The sum of the sections nested directly inside each open section. */
  private readonly nested: number[] = [];
  /**
   * Section names, built once: `parent -> key -> name`. The host hashes its
   * sections every tick, and building eight hundred path strings a tick to
   * name the same eight hundred sections was most of the garbage it made.
   */
  private readonly names = new Map<string, Map<string | number, string>>();

  hash(root: unknown, sections?: SectionSink): number {
    this.acc = 0;
    this.segs.length = 0;
    this.nested.length = 0;
    this.sections = sections ?? null;
    this.value(root, 0, PATH_ROOT);
    this.sections = null;
    return this.acc >>> 0;
  }

  private leaf(h: number): void {
    this.acc = (this.acc + fmix(h)) | 0;
  }

  /** `parent` + SEP + `key`, from the cache. */
  private child(parent: string, key: Seg): string {
    let m = this.names.get(parent);
    if (!m) this.names.set(parent, (m = new Map()));
    let s = m.get(key);
    if (s === undefined) {
      const part = typeof key === "string" ? key : key >= 0 ? `#${key}` : `@${segAt(key)}`;
      s = parent === "" ? part : parent + SEP + part;
      m.set(key, s);
    }
    return s;
  }

  /** The name of the section `segs[0..d)`. */
  private sectionName(d: number): string {
    let s = "";
    for (let i = 0; i < d; i++) s = this.child(s, this.segs[i]);
    return s;
  }

  private node(v: unknown, d: number, ph: number, inPool: boolean): void {
    if (!this.sections || !(d === 1 || d === SECTION_DEPTH
                            || (d === SECTION_DEPTH + 1 && inPool))) {
      this.value(v, d, ph);
      return;
    }
    const name = this.sectionName(d);
    const start = this.acc;
    this.nested.push(0);
    this.value(v, d, ph);
    const inner = this.nested.pop()!;
    const total = (this.acc - start) | 0;
    this.sections.add(name, ((total - inner) | 0) >>> 0);
    if (this.nested.length) {
      this.nested[this.nested.length - 1] =
        (this.nested[this.nested.length - 1] + total) | 0;
    }
  }

  private value(v: unknown, d: number, ph: number): void {
    if (v === undefined) return this.leaf(combine(ph, LeafTag.Undefined));
    if (v === null) return this.leaf(combine(ph, LeafTag.Null));
    switch (typeof v) {
      case "boolean":
        return this.leaf(combine(ph, v ? LeafTag.True : LeafTag.False));
      case "number":
        return this.leaf(combineNumber(combine(ph, LeafTag.Number), v));
      case "string":
        return this.leaf(combine(combine(ph, LeafTag.String), hashString(v)));
      case "object":
        break;
      default:
        throw new NetStateError(`cannot hash a ${typeof v}`);
    }
    const segs = this.segs;
    if (Array.isArray(v)) {
      this.leaf(combine(combine(ph, LeafTag.Array), v.length));
      const ats = poolAts(v);
      if (ats) {
        for (let i = 0; i < v.length; i++) {
          this.leaf(combineNumber(combine(combine(ph, LeafTag.Order), i), ats[i]));
          segs[d] = keyedSeg(ats[i]);
          this.node(v[i], d + 1, pathKeyed(ph, ats[i]), true);
        }
      } else {
        for (let i = 0; i < v.length; i++) {
          const ch = pathIndex(ph, i);
          if (!(i in v)) {
            this.leaf(combine(ch, LeafTag.Hole));
            continue;
          }
          segs[d] = i;
          this.node(v[i], d + 1, ch, false);
        }
      }
      segs.length = d;
      return;
    }
    this.leaf(combine(ph, LeafTag.Object));
    const o = v as Record<string, unknown>;
    for (const k in o) {
      segs[d] = k;
      this.node(o[k], d + 1, pathKey(ph, k), false);
    }
    segs.length = d;
  }
}

/** Two trees' differences, as readable lines. For the desync report and tests. */
export function diffTrees(a: unknown, b: unknown, limit = 20,
                          at: Seg[] = [], out: string[] = []): string[] {
  if (out.length >= limit) return out;
  const ka = kindOf(a), kb = kindOf(b);
  if (ka !== kb || (ka === 0 && !Object.is(a, b))) {
    out.push(`${pathLabel(at)}: ${describe(a)} vs ${describe(b)}`);
    return out;
  }
  if (ka === 0) return out;
  if (ka === 2) {
    const aa = a as unknown[], bb = b as unknown[];
    if (aa.length !== bb.length) {
      out.push(`${pathLabel(at)}: length ${aa.length} vs ${bb.length}`);
    }
    const n = Math.min(aa.length, bb.length);
    for (let i = 0; i < n && out.length < limit; i++) {
      if ((i in aa) !== (i in bb)) {
        out.push(`${pathLabel([...at, i])}: ${i in aa ? "value" : "hole"} vs `
          + `${i in bb ? "value" : "hole"}`);
        continue;
      }
      diffTrees(aa[i], bb[i], limit, [...at, i], out);
    }
    return out;
  }
  const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>;
  for (const k of Object.keys(oa)) {
    if (out.length >= limit) break;
    if (!Object.hasOwn(ob, k)) out.push(`${pathLabel([...at, k])}: only on the left`);
    else diffTrees(oa[k], ob[k], limit, [...at, k], out);
  }
  for (const k of Object.keys(ob)) {
    if (out.length >= limit) break;
    if (!Object.hasOwn(oa, k)) out.push(`${pathLabel([...at, k])}: only on the right`);
  }
  return out;
}

function describe(v: unknown): string {
  if (v === undefined) return "undefined";
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "string") {
    return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  }
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v && typeof v === "object") return "object";
  return String(v);
}
