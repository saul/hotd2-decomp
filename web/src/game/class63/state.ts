/**
 * Class 0x63's one word, apart from the class module so `actor.ts` can name
 * it without importing the class -- the arrangement the other classes' tails
 * have (`registry.ts` says why).
 */

/**
 * Which routine the watcher's `obj+0x00` holds. `[port-only]` as a number:
 * the engine stores the routine's address, and a snapshot cannot hold a
 * function.
 */
export enum SkipWatchRoutine {
  /** `InitCutsceneSkipWatcher` (`FUN_00435F20`), the handler the pool stores. */
  Init = 0,
  /** `CheckCutsceneSkipRequest` (`FUN_00435F40`), installed by the Init. */
  Check = 1,
  /** `FinishCutsceneSkip` (`FUN_00435FA0`), installed by a taken request. */
  Finish = 2,
}

export interface SkipWatchTail {
  /** `obj+0x00`, as {@link SkipWatchRoutine}. */
  routine: SkipWatchRoutine;
}

/** `[port-only]` -- a watcher as the pool makes it, on its `Init`. */
export function makeSkipWatchTail(): SkipWatchTail {
  return { routine: SkipWatchRoutine.Init };
}
