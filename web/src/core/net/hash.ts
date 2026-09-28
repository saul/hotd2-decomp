/**
 * The state hash both ends compute, so a replica can prove it holds exactly
 * what the host held at the same tick.
 *
 * **Order-independent by construction.** Each leaf of the state tree hashes
 * its own path together with its own value, and the tree's hash is the sum of
 * its leaves'. Two objects with the same keys in a different insertion order
 * therefore hash the same -- which they must, because the replica builds its
 * objects in the order ops arrive, not the order the host's code happened to
 * assign fields in. What order *means* something is hashed explicitly: an
 * array's length, and a keyed pool's order of `at`s.
 *
 * Numbers hash their IEEE-754 bits, so `-0` and `0` differ, as they do in the
 * state. Strings hash their UTF-16 code units, cached, because a string is
 * immutable and a few of the state's strings are long.
 */

/** murmur3's mixing step: fold `k` into the running hash `h`. */
export function combine(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** murmur3's finaliser: every input bit reaches every output bit. */
export function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

/** Two 32-bit words of a double's bits, folded into `h`. */
export function combineNumber(h: number, v: number): number {
  F64[0] = v;
  return combine(combine(h, U32[0]), U32[1]);
}

const STRING_HASHES = new Map<string, number>();

/** FNV-1a over UTF-16 code units, cached. */
export function hashString(s: string): number {
  const hit = STRING_HASHES.get(s);
  if (hit !== undefined) return hit;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = fmix(h);
  // Bounded: the keys and names repeat, and a run that minted strings without
  // end should cost a rehash, not the page.
  if (STRING_HASHES.size > 50_000) STRING_HASHES.clear();
  STRING_HASHES.set(s, h);
  return h;
}

/** What a leaf is, so `null` and `0` and `"0"` do not collide. */
export enum LeafTag {
  Undefined = 1,
  Null = 2,
  False = 3,
  True = 4,
  Hole = 5,
  Number = 6,
  String = 7,
  Object = 8,
  Array = 9,
  /** One position of a keyed pool: which `at` stands there. */
  Order = 10,
}

/** Segment kinds, mixed into a path hash so `"3"`, `[3]` and `@3` differ. */
export enum SegTag {
  Key = 0x4b,
  Index = 0x49,
  Keyed = 0x40,
}

export function pathKey(h: number, key: string): number {
  return combine(combine(h, SegTag.Key), hashString(key));
}

export function pathIndex(h: number, i: number): number {
  return combine(combine(h, SegTag.Index), i);
}

export function pathKeyed(h: number, at: number): number {
  return combineNumber(combine(h, SegTag.Keyed), at);
}

/** The root of every path. */
export const PATH_ROOT = 0x2f2f2f2f;
