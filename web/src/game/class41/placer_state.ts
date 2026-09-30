/**
 * The tail a class-0x41 actor carries: which routine it runs.
 *
 * A class-0x41 spawn is a placer, `PropContainerPlacerUpdate`
 * (`FUN_00461CD0`), and dies on its first frame. One of its constructors,
 * `PlaceType61Figures` (`FUN_004641F0`), allocates **skinned actors** with no
 * class id of their own -- `ActorAlloc(Type61FigureUpdate, 0x13F4)` -- and
 * the port files them under this class, as it files the result card's
 * figures under class 0x61: the pool keys its handler on the class, and the
 * engine's object keys it on the routine pointer at `obj+0x00`, which is what
 * {@link PropContainerTail.routine} stands for.
 *
 * Side-effect free, so `actor.ts` can import it.
 */

/** `obj+0x00` for a class-0x41 actor. */
export enum PropContainerRoutine {
  /** `PropContainerPlacerUpdate` (`FUN_00461CD0`) -- the placer itself. */
  Placer = 0,
  /** `Type61FigureUpdate` (`FUN_004729E0`) -- one of constructor 61's nine. */
  Type61Figure = 1,
}

/** The tail every class-0x41 actor carries. */
export interface PropContainerTail {
  /** `obj+0x00`. See {@link PropContainerRoutine}. */
  routine: PropContainerRoutine;
}

/**
 * `[port-only]` A fresh tail: every class-0x41 spawn is a placer until a
 * constructor says otherwise.
 */
export function makePropContainerTail(): PropContainerTail {
  return { routine: PropContainerRoutine.Placer };
}
