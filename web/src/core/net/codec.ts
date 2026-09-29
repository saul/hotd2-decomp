/**
 * The state codec: what the host sends so a replica holds exactly the host's
 * state, and how the replica puts it back.
 *
 * `docs/PLAYER.md`, "Netplay", is the design; this is the mechanism. Three properties are
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
 * The hashes of a path's prefixes, as {@link TreeHasher} derives them. The
 * changes a tick makes share most of their paths -- the fields of one actor,
 * the elements of one array -- so each prefix's hash is kept, and only the
 * segments after the first that differs from the last path asked for are
 * hashed again.
 */
class PathHashes {
  private readonly segs: Seg[] = [];
  private readonly hs: number[] = [PATH_ROOT];

  /** The hash of the path `segs[0..n)`. */
  of(segs: readonly Seg[], n: number): number {
    const mine = this.segs, hs = this.hs;
    const m = Math.min(n, mine.length);
    let i = 0;
    while (i < m && mine[i] === segs[i]) i++;
    if (i < n) {
      for (let j = i; j < n; j++) {
        const g = segs[j];
        mine[j] = g;
        hs[j + 1] = typeof g === "string" ? pathKey(hs[j], g)
          : g >= 0 ? pathIndex(hs[j], g) : pathKeyed(hs[j], segAt(g));
      }
      // What followed the segment that changed was another path's.
      mine.length = n;
    }
    return hs[n];
  }
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
  /**
   * The shadow's hash, kept as the walk goes: every change subtracts what
   * the old value added to it and adds what the new one does. A walk of the
   * whole state to hash it was the largest part of a tick's cost -- ten
   * milliseconds of an iPad's -- and this costs what the change is.
   */
  private sum = 0;
  private readonly hasher = new TreeHasher();
  private readonly paths = new PathHashes();
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

  /** The shadow's {@link TreeHasher} hash, without walking it. */
  get hash(): number {
    return this.sum >>> 0;
  }

  /**
   * The shadow hashed the long way, against the kept hash. Returns false,
   * and takes the walked one, if the two had drifted apart -- which is a bug
   * here, and what a desync report asks the host to rule out.
   */
  checkHash(): boolean {
    if (!this.shadow) return true;
    const walked = this.hasher.subtree(this.shadow, PATH_ROOT);
    if (walked === this.sum) return true;
    this.sum = walked;
    return false;
  }

  /** `v`, standing at `segs[0..n)`, joins the state. */
  private enter(v: unknown, n: number): void {
    this.sum = (this.sum + this.hasher.subtree(v, this.paths.of(this.segs, n))) | 0;
  }

  /** `v`, standing at `segs[0..n)`, leaves it. */
  private leave(v: unknown, n: number): void {
    this.sum = (this.sum - this.hasher.subtree(v, this.paths.of(this.segs, n))) | 0;
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
      this.sum = this.hasher.subtree(this.shadow, PATH_ROOT);
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
        const c = this.copy(lv);
        shadow[k] = c;
        this.enter(c, d + 1);
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
        segs[d] = k;
        this.leave(shadow[k], d + 1);
        delete shadow[k];
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
        const ph = this.paths.of(this.segs, cd);
        this.sum = (this.sum - primLeaf(sv, ph) + primLeaf(lv, ph)) | 0;
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
    this.leave(sv, cd);
    const c = this.copy(lv);
    container[key] = c;
    this.enter(c, cd);
    this.mark(cd, Dirty.Value);
  }

  private diffIndexed(live: unknown[], shadow: unknown[], d: number): void {
    const segs = this.segs;
    const n = live.length;
    const old = shadow.length;
    if (n !== old) {
      this.mark(d, Dirty.Len, n);
      // The length is a leaf, and so is every hole inside it: what is cut
      // off leaves the hash, and what grows arrives as holes until the loop
      // below fills it.
      const ph = this.paths.of(segs, d);
      let sum = (this.sum - arrayLeaf(ph, old) + arrayLeaf(ph, n)) | 0;
      for (let i = n; i < old; i++) {
        sum = (sum - (i in shadow ? this.hasher.subtree(shadow[i], pathIndex(ph, i))
          : holeLeaf(ph, i))) | 0;
      }
      for (let i = old; i < n; i++) sum = (sum + holeLeaf(ph, i)) | 0;
      this.sum = sum;
      if (n < old) shadow.length = n;
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
        this.leave(shadow[i], d + 1);
        this.sum = (this.sum + holeLeaf(this.paths.of(segs, d), i)) | 0;
        delete shadow[i];
        this.mark(d + 1, Dirty.Value);
        continue;
      }
      if (!had) {
        const c = this.copy(live[i]);
        shadow[i] = c;
        this.sum = (this.sum - holeLeaf(this.paths.of(segs, d), i)) | 0;
        this.enter(c, d + 1);
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
      // The hash: the length and every position's `at` are leaves; an
      // element no survivor came from leaves, and a new one arrives. A
      // survivor's leaves stand at its `at`, wherever it moved to.
      const ph = this.paths.of(this.segs, d);
      const was = info.ats;
      let sum = (this.sum - arrayLeaf(ph, was.length) + arrayLeaf(ph, n)) | 0;
      const kept = new Uint8Array(was.length);
      for (let i = 0; i < n; i++) {
        if (from[i] >= 0) kept[from[i]] = 1;
        sum = (sum + orderLeaf(ph, i, ats[i])) | 0;
      }
      for (let j = 0; j < was.length; j++) {
        sum = (sum - orderLeaf(ph, j, was[j])) | 0;
        if (!kept[j]) sum = (sum - this.hasher.subtree(shadow[j], pathKeyed(ph, was[j]))) | 0;
      }
      const next = new Array<unknown>(n);
      for (let i = 0; i < n; i++) {
        this.segs[d] = keyedSeg(ats[i]);
        if (from[i] >= 0) {
          next[i] = shadow[from[i]];
        } else {
          const c = this.copy(live[i]);
          next[i] = c;
          sum = (sum + this.hasher.subtree(c, pathKeyed(ph, ats[i]))) | 0;
        }
      }
      this.sum = sum;
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
 * How deep a section of the replica's kept hash is: a path this long --
 * `parts.game.g_frame` -- or, in a pool that deep, one element of it --
 * `parts.game.g_object_list[@6720]`. Fine enough that an audit of one is a
 * small piece of a tick; a shorter path is a section of its own leaves.
 */
const SECTION_DEPTH = 3;

/** The length of the section a path of length `n` lies in. */
function sectionLen(segs: readonly Seg[], n: number): number {
  if (n <= SECTION_DEPTH) return n;
  const g = segs[SECTION_DEPTH];
  return typeof g === "number" && g < 0 ? SECTION_DEPTH + 1 : SECTION_DEPTH;
}

/**
 * Whether the node `v` at depth `n` is split into sections: its own leaves
 * in its own, each child in another. Every container above the section
 * depth is; at it, only a pool, whose elements are sections one deeper.
 */
function splits(v: unknown, n: number): boolean {
  if (v === null || typeof v !== "object" || n > SECTION_DEPTH) return false;
  return n < SECTION_DEPTH || (Array.isArray(v) && poolAts(v) !== null);
}

/** One section: where it is, and its share of the hash. */
interface Section {
  segs: Seg[];
  sum: number;
}

/** Nothing at a path, to {@link StateMirror.audit}. */
const MISSING: unique symbol = Symbol("missing");

/**
 * The replica's side: the key strings it has been given, and each pool's
 * serials. It holds no state of its own -- it writes into the tree it is
 * handed, which for the player is `G` itself, so every object that did not
 * change keeps its identity and the render layers' references stay good.
 *
 * **It keeps that tree's hash as it writes**, the way the host keeps its
 * shadow's: an op subtracts the share of what it overwrites and adds the
 * share of what it writes, so checking a tick against the host's hash costs
 * what the tick changed. The shares are kept by section too, and that is
 * what lets {@link audit} look at the tree a slice at a time against what the
 * ops left there -- and find a write that did not come from the host, which
 * nothing that only keeps a hash can see.
 */
export class StateMirror {
  private keys: string[] = [];
  private readonly pools = new WeakMap<unknown[], Map<number, number>>();
  private readonly byAtCache = new Map<unknown[], Map<number, unknown>>();
  private readonly hasher = new TreeHasher();
  private readonly paths = new PathHashes();
  /** The tree the sums are of: the last one {@link rehash}ed. */
  private tracked: object | null = null;
  private sum = 0;
  private readonly sections = new Map<string, Section>();
  /** An op's path, copied, for the accounting to write past. */
  private readonly work: Seg[] = [];
  private keySegs: readonly Seg[] = [];
  private keyStr = "";
  // The audit: this cycle's sections, how far it has got, and which it found.
  private cycle: { segs: Seg[]; key: string }[] = [];
  private cyclePos = 0;
  private visited = new Set<string>();

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
    if (root !== this.tracked) this.rehash(root);
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
            this.rehash(root);
            break;
          }
          const parent = this.resolve(root, segs, segs.length - 1);
          const n = segs.length;
          const last = segs[n - 1];
          if (typeof last === "string") {
            if (kindOf(parent) !== 1) throw this.fail("set under a non-object", segs);
            if (v === HOLE) throw this.fail("a hole in an object", segs);
            const o = parent as Record<string, unknown>;
            const w = this.path(segs);
            const ph = this.paths.of(w, n);
            if (Object.hasOwn(o, last)) this.account(o[last], w, n, ph, -1);
            o[last] = v;
            this.account(v, w, n, ph, 1);
          } else if (last >= 0) {
            if (kindOf(parent) !== 2) throw this.fail("index into a non-array", segs);
            const arr = parent as unknown[];
            // Past the end grows the array, in holes, first.
            if (last >= arr.length) this.resize(arr, this.path(segs), n - 1, last + 1);
            const w = this.path(segs);
            const aph = this.paths.of(w, n - 1);
            const ph = this.paths.of(w, n);
            // A hole is a leaf of its array's; a value is a subtree of its own.
            if (last in arr) this.account(arr[last], w, n, ph, -1);
            else this.credit(w, n - 1, -holeLeaf(aph, last));
            if (v === HOLE) {
              delete arr[last];
              this.credit(w, n - 1, holeLeaf(aph, last));
            } else {
              arr[last] = v;
              this.account(v, w, n, ph, 1);
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
          const o = parent as Record<string, unknown>;
          if (Object.hasOwn(o, last)) {
            const w = this.path(segs);
            this.account(o[last], w, segs.length, this.paths.of(w, segs.length), -1);
          }
          delete o[last];
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
          const w = this.path(segs);
          if (arr.length > cut) this.resize(arr, w, segs.length, cut);
          this.resize(arr, w, segs.length, len);
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
          // The hash: a pool's own leaves are its length and each position's
          // `at`; an element that goes takes its share with it and one that
          // arrives brings its own, while one that stays keeps its share
          // wherever it moves, since it stands at its `at`. An array that was
          // not a pool is taken out whole and put back whole.
          const n = segs.length;
          const w = this.path(segs);
          const ph = this.paths.of(w, n);
          const was = arr.length === 0 || poolAts(arr) !== null ? new Set<unknown>(arr) : null;
          if (was) this.credit(w, n, -poolOwn(arr, ph));
          else this.account(arr, w, n, ph, -1);
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
                if (was) {
                  w[n] = keyedSeg(at);
                  this.account(o, w, n + 1, pathKeyed(ph, at), -1);
                }
                for (const k of Object.keys(o)) if (!Object.hasOwn(v, k)) delete o[k];
                Object.assign(o, v);
                if (was) this.account(o, w, n + 1, pathKeyed(ph, at), 1);
                w.length = n;
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
          if (was) {
            const stay = new Set<unknown>(next);
            for (const e of arr) {
              if (stay.has(e)) continue;
              const at = (e as { at: number }).at;
              w[n] = keyedSeg(at);
              this.account(e, w, n + 1, pathKeyed(ph, at), -1);
            }
            w.length = n;
          }
          arr.length = 0;
          for (let i = 0; i < count; i++) arr.push(next[i]);
          this.pools.set(arr, serials);
          this.byAtCache.delete(arr);
          if (count > 0 && poolAts(arr) === null) {
            throw this.fail("a pool with an `at` twice, or out of range", segs);
          }
          if (was) {
            for (const e of arr) {
              if (was.has(e)) continue;
              const at = (e as { at: number }).at;
              w[n] = keyedSeg(at);
              this.account(e, w, n + 1, pathKeyed(ph, at), 1);
            }
            w.length = n;
            this.credit(w, n, poolOwn(arr, ph));
          } else {
            this.account(arr, w, n, ph, 1);
          }
          break;
        }
        default:
          throw new WireError(`op ${code}`);
      }
    }
    return n;
  }

  // -- the kept hash ----------------------------------------------------

  /**
   * Hash `root` whole and keep the sums from here: after a keyframe is
   * installed. Returns the hash. {@link applyOps} does this itself for a
   * tree it has not seen.
   */
  rehash(root: Record<string, unknown>): number {
    this.tracked = root;
    this.sum = 0;
    this.sections.clear();
    this.cycle = [];
    this.cyclePos = 0;
    this.visited = new Set();
    const w = this.work;
    w.length = 0;
    this.account(root, w, 0, PATH_ROOT, 1);
    return this.sum >>> 0;
  }

  /** The {@link TreeHasher} hash of the tree the ops wrote, kept rather than walked. */
  get hash(): number {
    return this.sum >>> 0;
  }

  /** `segs`, copied where the accounting can write past its end. */
  private path(segs: readonly Seg[]): Seg[] {
    const w = this.work;
    w.length = 0;
    for (let i = 0; i < segs.length; i++) w.push(segs[i]);
    return w;
  }

  /** `share` joins the whole and the section `segs[0..n)` lies in. */
  private credit(segs: readonly Seg[], n: number, share: number): void {
    if (share === 0) return;
    this.sum = (this.sum + share) | 0;
    const k = sectionLen(segs, n);
    const key = this.sectionKey(segs, k);
    const s = this.sections.get(key);
    if (!s) {
      this.sections.set(key, { segs: segs.slice(0, k), sum: share | 0 });
    } else if ((s.sum = (s.sum + share) | 0) === 0) {
      // Gone. One that sums to nothing by chance is one the audit expects
      // nothing of, which is the same thing.
      this.sections.delete(key);
    }
  }

  /** `pathString(segs, k)`, kept while the ops stay in one section. */
  private sectionKey(segs: readonly Seg[], k: number): string {
    const c = this.keySegs;
    if (c.length === k) {
      let i = 0;
      while (i < k && c[i] === segs[i]) i++;
      if (i === k) return this.keyStr;
    }
    this.keySegs = segs.slice(0, k);
    return (this.keyStr = pathString(segs, k));
  }

  /**
   * `v`, standing at `segs[0..n)` whose hash is `ph`, joins the sums
   * (`sign` 1) or leaves them (-1), section by section. Writes `segs` past
   * `n`, and puts its length back.
   */
  private account(v: unknown, segs: Seg[], n: number, ph: number, sign: number): void {
    if (!splits(v, n)) {
      const h = this.hasher.subtree(v, ph);
      this.credit(segs, n, sign < 0 ? -h : h);
      return;
    }
    let own: number;
    if (Array.isArray(v)) {
      own = arrayLeaf(ph, v.length);
      const ats = poolAts(v);
      for (let i = 0; i < v.length; i++) {
        if (ats) {
          own = (own + orderLeaf(ph, i, ats[i])) | 0;
          segs[n] = keyedSeg(ats[i]);
          this.account(v[i], segs, n + 1, pathKeyed(ph, ats[i]), sign);
        } else if (!(i in v)) {
          own = (own + holeLeaf(ph, i)) | 0;
        } else {
          segs[n] = i;
          this.account(v[i], segs, n + 1, pathIndex(ph, i), sign);
        }
      }
    } else {
      own = objectLeaf(ph);
      const o = v as Record<string, unknown>;
      for (const k in o) {
        segs[n] = k;
        this.account(o[k], segs, n + 1, pathKey(ph, k), sign);
      }
    }
    segs.length = n;
    this.credit(segs, n, sign < 0 ? -own : own);
  }

  /**
   * The indexed array at `segs[0..n)` to `len`: what is cut off leaves the
   * sums, and what grows arrives as holes. Puts `segs`' length back to `n`.
   */
  private resize(arr: unknown[], segs: Seg[], n: number, len: number): void {
    const old = arr.length;
    if (len === old) return;
    const ph = this.paths.of(segs, n);
    let own = (arrayLeaf(ph, len) - arrayLeaf(ph, old)) | 0;
    for (let i = len; i < old; i++) {
      if (i in arr) {
        segs[n] = i;
        this.account(arr[i], segs, n + 1, pathIndex(ph, i), -1);
      } else {
        own = (own - holeLeaf(ph, i)) | 0;
      }
    }
    for (let i = old; i < len; i++) own = (own + holeLeaf(ph, i)) | 0;
    segs.length = n;
    arr.length = len;
    this.credit(segs, n, own);
  }

  /** The leaves of `v`, at depth `n` and `ph`, that are its section's own. */
  private ownShare(v: unknown, n: number, ph: number): number {
    if (!splits(v, n)) return this.hasher.subtree(v, ph);
    if (!Array.isArray(v)) return objectLeaf(ph);
    if (poolAts(v)) return poolOwn(v, ph);
    let own = arrayLeaf(ph, v.length);
    for (let i = 0; i < v.length; i++) if (!(i in v)) own = (own + holeLeaf(ph, i)) | 0;
    return own;
  }

  /**
   * Look at the next few sections of `root` -- about `budget` leaves -- and
   * compare each with the share the ops left it. Returns the first that
   * differs, as a path, or null.
   *
   * Nothing but an op changes the tree with the sums knowing, so a section
   * that differs is one this page wrote: the replica's own systems, which
   * should only read the state, writing it. The kept hash cannot see that --
   * it is what the host sent, right as ever -- until the host happens to
   * change the same value. A cycle covers every section the tree has when it
   * starts, and ends by looking for any the sums have that the tree has lost.
   */
  audit(root: Record<string, unknown>, budget: number): string | null {
    if (root !== this.tracked) return null;
    const hasher = this.hasher;
    const end = hasher.leaves + budget;
    let started = false;
    // Every section counts one, so a run of small ones is bounded too.
    for (let spent = 0; hasher.leaves + spent < end; spent++) {
      if (this.cyclePos >= this.cycle.length) {
        if (started) break;
        started = true;
        const gone = this.cycle.length ? this.lost(root) : null;
        this.startCycle(root);
        if (gone) return gone;
        continue;
      }
      const { segs, key } = this.cycle[this.cyclePos++];
      const node = this.find(root, segs);
      // Gone since the cycle began. An op took its share with it; a write
      // that took it is what `lost` is for.
      if (node === MISSING) continue;
      this.visited.add(key);
      // Signed, as the sums are: a lone leaf's share is `fmix`'s unsigned word.
      const have = this.ownShare(node, segs.length, this.paths.of(segs, segs.length)) | 0;
      if (have !== (this.sections.get(key)?.sum ?? 0)) return pathLabel(segs) || "(root)";
    }
    return null;
  }

  private startCycle(root: unknown): void {
    const out: { segs: Seg[]; key: string }[] = [];
    this.sectionsOf(root, [], 0, out);
    this.cycle = out;
    this.cyclePos = 0;
    this.visited = new Set();
  }

  /** Every section of `v` at `segs[0..n)`, into `out`. */
  private sectionsOf(v: unknown, segs: Seg[], n: number,
                     out: { segs: Seg[]; key: string }[]): void {
    out.push({ segs: segs.slice(0, n), key: pathString(segs, n) });
    if (!splits(v, n)) return;
    if (Array.isArray(v)) {
      const ats = poolAts(v);
      for (let i = 0; i < v.length; i++) {
        if (ats) segs[n] = keyedSeg(ats[i]);
        else if (i in v) segs[n] = i;
        else continue;
        this.sectionsOf(v[i], segs, n + 1, out);
      }
    } else {
      const o = v as Record<string, unknown>;
      for (const k in o) {
        segs[n] = k;
        this.sectionsOf(o[k], segs, n + 1, out);
      }
    }
    segs.length = n;
  }

  /** A section the sums hold that the cycle did not find, and the tree has not got. */
  private lost(root: unknown): string | null {
    for (const [key, s] of this.sections) {
      if (this.visited.has(key)) continue;
      // Not found by the cycle but here now: it arrived since the cycle began.
      if (this.find(root, s.segs) === MISSING) return `${pathLabel(s.segs)} (gone)`;
    }
    return null;
  }

  /**
   * The node at `segs`, or {@link MISSING}. Never throws, and caches nothing.
   * Addressed as the codec addresses it: a pool's elements by `at` and only
   * by `at`, an indexed array's by index -- so a section the cycle listed
   * while an array was one is gone once it is the other.
   */
  private find(root: unknown, segs: readonly Seg[]): unknown {
    let node = root;
    for (const g of segs) {
      if (node === null || typeof node !== "object") return MISSING;
      if (typeof g === "string") {
        if (Array.isArray(node) || !Object.hasOwn(node, g)) return MISSING;
        node = (node as Record<string, unknown>)[g];
      } else if (!Array.isArray(node) || (g < 0) !== (poolAts(node) !== null)) {
        return MISSING;
      } else if (g >= 0) {
        if (!(g in node)) return MISSING;
        node = node[g];
      } else {
        const at = segAt(g);
        let hit: unknown = MISSING;
        for (const e of node) {
          if (e !== null && typeof e === "object" && (e as { at?: unknown }).at === at) {
            hit = e;
            break;
          }
        }
        if (hit === MISSING) return MISSING;
        node = hit;
      }
    }
    return node;
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

/*
 * The leaves, once. The hash is the sum of `fmix` of every leaf, so a
 * leaf's share is added when it appears and subtracted when it goes -- which
 * is what lets both ends keep the hash as the state changes rather than walk
 * the state to take it. These are the one definition of each: the walk below
 * and the running sums in `StateTracker` and `StateMirror` all use them.
 */

/** A primitive's share, standing at the path whose hash is `ph`. */
function primLeaf(v: unknown, ph: number): number {
  if (v === undefined) return fmix(combine(ph, LeafTag.Undefined));
  if (v === null) return fmix(combine(ph, LeafTag.Null));
  switch (typeof v) {
    case "boolean":
      return fmix(combine(ph, v ? LeafTag.True : LeafTag.False));
    case "number":
      return fmix(combineNumber(combine(ph, LeafTag.Number), v));
    case "string":
      return fmix(combine(combine(ph, LeafTag.String), hashString(v)));
    default:
      throw new NetStateError(`cannot hash a ${typeof v}`);
  }
}

/** An array's length. */
function arrayLeaf(ph: number, n: number): number {
  return fmix(combine(combine(ph, LeafTag.Array), n));
}

/** The hole at index `i` of the indexed array at `ph`. */
function holeLeaf(ph: number, i: number): number {
  return fmix(combine(pathIndex(ph, i), LeafTag.Hole));
}

/** Which `at` stands at position `i` of the pool at `ph`. */
function orderLeaf(ph: number, i: number, at: number): number {
  return fmix(combineNumber(combine(combine(ph, LeafTag.Order), i), at));
}

/** That an object stands at `ph`. */
function objectLeaf(ph: number): number {
  return fmix(combine(ph, LeafTag.Object));
}

/** A pool's own leaves: its length, and which `at` stands where. */
function poolOwn(arr: readonly unknown[], ph: number): number {
  let own = arrayLeaf(ph, arr.length);
  for (let i = 0; i < arr.length; i++) {
    own = (own + orderLeaf(ph, i, (arr[i] as { at: number }).at)) | 0;
  }
  return own;
}

/**
 * The state's hash, by walking it.
 *
 * Both ends run this one class, so there is no second copy of the leaf rules
 * to drift. Neither walks the state with it every tick any more -- the host
 * keeps its hash as it diffs, the replica as it applies -- but a keyframe is
 * hashed whole, a subtree that arrives or goes is, and so are the checks that
 * the kept sums are right.
 */
export class TreeHasher {
  private acc = 0;
  /** Leaves hashed, ever: what the replica's audit measures its work in. */
  leaves = 0;

  hash(root: unknown): number {
    return this.subtree(root, PATH_ROOT) >>> 0;
  }

  /**
   * `v`'s share of the hash, standing at the path whose hash is `ph`: the sum
   * of its leaves. Signed, as the running sums add and subtract it.
   */
  subtree(v: unknown, ph: number): number {
    const outer = this.acc;
    this.acc = 0;
    this.value(v, ph);
    const h = this.acc;
    this.acc = outer;
    return h;
  }

  private leaf(share: number): void {
    this.acc = (this.acc + share) | 0;
    this.leaves++;
  }

  private value(v: unknown, ph: number): void {
    if (v === null || typeof v !== "object") return this.leaf(primLeaf(v, ph));
    if (Array.isArray(v)) {
      this.leaf(arrayLeaf(ph, v.length));
      const ats = poolAts(v);
      if (ats) {
        for (let i = 0; i < v.length; i++) {
          this.leaf(orderLeaf(ph, i, ats[i]));
          this.value(v[i], pathKeyed(ph, ats[i]));
        }
      } else {
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) this.leaf(holeLeaf(ph, i));
          else this.value(v[i], pathIndex(ph, i));
        }
      }
      return;
    }
    this.leaf(objectLeaf(ph));
    const o = v as Record<string, unknown>;
    for (const k in o) this.value(o[k], pathKey(ph, k));
  }
}

/**
 * Whether two trees hold the same values, by the codec's rules: `-0` is not
 * `0`, `NaN` is `NaN`, a hole is not `undefined`, and key order does not
 * matter. {@link diffTrees} says where they differ; this only says whether,
 * without building a path for every node, so it can run a few times a second.
 */
export function sameTree(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  const ka = kindOf(a);
  if (ka === 0 || ka !== kindOf(b)) return false;
  if (ka === 2) {
    const aa = a as unknown[], bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      const has = i in aa;
      if (has !== i in bb) return false;
      if (has && !sameTree(aa[i], bb[i])) return false;
    }
    return true;
  }
  const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>;
  let n = 0;
  for (const k in oa) {
    if (!Object.hasOwn(ob, k) || !sameTree(oa[k], ob[k])) return false;
    n++;
  }
  for (const _ in ob) n--;
  return n === 0;
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
