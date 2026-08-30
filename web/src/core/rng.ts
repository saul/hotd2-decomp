/**
 * The world's random source, with its state exposed.
 *
 * `mulberry32`, chosen for being one 32-bit word of state — which is the whole
 * point: a snapshot has to carry the generator, and a generator you cannot
 * read is a piece of the game that a save state silently drops. Two loads of
 * the same snapshot must draw the same attack.
 *
 * `Math.random()` is banned inside `game/` for that reason; `verify_port.py`
 * greps for it.
 */
export class Rng {
  /** The whole of it. Snapshotted and restored verbatim. */
  state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, n) — the game's `rand() % n`. */
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }
}
