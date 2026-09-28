/**
 * The cat's sub-block, apart from the class module so `actor.ts` can name it
 * without importing the class -- the arrangement `class52/state.ts` has, and
 * for the reason `registry.ts` records: an ESM cycle that resolves a table to
 * `undefined` has cost this project three separate hours.
 *
 * `CatInit` (`FUN_00431250`) allocates it with `ActorAllocSub(0x24)` and hangs
 * it at `obj+0x1310`. Of its 0x24 bytes the class touches four s16s, and the
 * first of them is **two different things** by sub-type (`L3`): the animation
 * set for a cat that plays its list, the flight state for a trigger.
 */

/**
 * `sub+0x10` for a trigger — `CatBranchTriggerUpdate`'s (`FUN_00431430`)
 * three arms. `CatInit` writes 0.
 */
export enum CatTriggerState {
  /** Counting frames and waiting to be shot in block 8. */
  Waiting = 0,
  /** Shot: running on clip 0x2FD until it is past `x = -478`. */
  Fleeing = 1,
  /** Past it: clip 0x305, and nothing but the draw. */
  Stopped = 2,
}

/** `obj+0x1310` — the 0x24 bytes `ActorAllocSub` hands `CatInit`. */
export interface CatTail {
  /**
   * `sub+0x10` s16. Sub-types 0 and 1: the **animation set**, the row of
   * `g_cat_motions` it plays. Sub-type 2 and up: {@link CatTriggerState}.
   */
  set: number;            // +0x10
  /**
   * `sub+0x12` s16 — frames lived. `CatMotionListUpdate` despawns the cat
   * once it passes 1000; the trigger counts it only while waiting.
   */
  frames: number;         // +0x12
  /** `sub+0x1C` s16 — the entry of the row being played. */
  index: number;          // +0x1C
  /** `sub+0x1E` s16 — how many times that entry's clip has played through. */
  loops: number;          // +0x1E
}

/**
 * [port-only] `ActorAllocSub` returns memory the Init then fills; this is the
 * zero it starts from, written out. `CatInit` sets every field below.
 */
export function makeCatTail(): CatTail {
  return { set: 0, frames: 0, index: 0, loops: 0 };
}
