/**
 * Class 0x2B's words, at the offsets the engine keeps them.
 *
 * `DynamicLightInit` (`FUN_00438060`) and its three routines keep nothing in
 * a sub-block: the stage word is `obj+0x1312` ({@link Actor.sub}) and the
 * rest are the object's own bytes. Data only, so the actor shape can name
 * it without importing the class.
 */

/**
 * `(s16)obj+0x11C`, `desc+0x22` -- the selector `DynamicLightInit` switches
 * on. Not hit points (L3).
 */
export enum DynamicLightSelector {
  /** `DynamicLightFlickerPoint` (`FUN_004380B0`), stage 2 blocks 11-12. */
  FlickerPoint = 0,
  /** `DynamicLightSpotDown` (`FUN_00438230`), stage 4 block 10. */
  SpotDown = 1,
  /** `DynamicLightSpotTilted` (`FUN_004383C0`), stage 5 block 0. */
  SpotTilted = 2,
}

/**
 * Which routine `obj+0x00` holds. `[port-only]` as an enum: the engine
 * stores a code address, and a snapshot cannot hold one. `Init` until the
 * Init has run a selector it knows; then that selector's routine.
 */
export enum DynamicLightRoutine {
  Init = -1,
  FlickerPoint = DynamicLightSelector.FlickerPoint,
  SpotDown = DynamicLightSelector.SpotDown,
  SpotTilted = DynamicLightSelector.SpotTilted,
}

export interface DynamicLightTail {
  routine: DynamicLightRoutine;
  /**
   * `obj+0x131B`, s8 -- the `g_entity_lights` entry the routine claimed with
   * `EntityLightAcquireSlot`, 0 if none was free.
   */
  slot: number;
  /** `obj+0x1320` -- selector 0's `rand() % 8`, the quadratic term's step. */
  att2Step: number;
  /** `obj+0x1324` -- selector 0's frames until the next draw. */
  countdown: number;
}

/** `[port-only]` -- the words before the Init writes any: `ActorClearGameFields`' zeroes. */
export function makeDynamicLightTail(): DynamicLightTail {
  return { routine: DynamicLightRoutine.Init, slot: 0, att2Step: 0,
           countdown: 0 };
}
