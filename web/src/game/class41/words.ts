/**
 * `[port-only]` One routine's view of {@link BreakableProp.words}.
 *
 * A generic routine keeps words of the 0x378-byte object that no shared
 * field carries, and what each word means is that routine's business (`L3`).
 * So each routine's file declares an interface of the words it keeps, keyed
 * by offset (`o200` for `obj+0x200`) and documented with what they are *to
 * it*, and reads them through this:
 *
 * ```ts
 * interface Type41Words { o200: number; o206: number }
 * const TYPE41_WORDS: Type41Words = { o200: 0, o206: 0 };
 * const w = PropWords(p, TYPE41_WORDS);
 * w.o200 += 0x30;
 * ```
 *
 * The second argument is the zero the engine's `ActorClearGameFields`
 * (`FUN_004A73D0`) leaves every one of these words at: a key the object has
 * never written is filled from it, so arithmetic on a fresh word is on 0 and
 * not on `undefined`. The object returned **is** `p.words`, so writes land on
 * the prop and go into the snapshot with it.
 */
import type { BreakableProp } from "./prop_state";

export function PropWords<T extends { [offset: string]: number }>(
    p: BreakableProp, zero: T): T {
  for (const k of Object.keys(zero)) {
    if (p.words[k] === undefined) p.words[k] = zero[k];
  }
  return p.words as T;
}
