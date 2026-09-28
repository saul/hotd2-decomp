/**
 * The words class 0x28 keeps on its object, apart from the class module so
 * `actor.ts` can name them without importing the class -- the arrangement
 * classes 0x26 and 0x33 have, and for the reason `registry.ts` records: an ESM
 * cycle that resolves a table to `undefined` has cost this project three
 * separate hours.
 *
 * `obj+0x1312` is the handler's own three-step cursor and is the head's
 * `Actor.sub`; `obj+0x11C` is the route index and is the head's `Actor.hp`,
 * which is `L3`: on this class it is never hit points.
 */
export interface PathRidingPropTail {
  /**
   * `obj+0x13F0` -- the draw slot. `PathRidingPropUpdate` (`FUN_00432610`)
   * writes the literal `0x33` there on the first frame (`MOV dword ptr
   * [ESI + 0x13f0], 0x33` at `0x0043265E`) and nothing else writes it.
   */
  drawSlot: number;          // +0x13F0
  /**
   * `obj+0x1320` -- **launched**. Zeroed on the first frame, raised on the
   * frame camera path `0x2F` reaches the route's freeze frame. While it is 0
   * the object holds the pose it was seated at and `PathRidingPropDraw`
   * (`FUN_00432840`) draws its two sprites; once it is 1 the pose follows
   * `g_cam_path_frame` and the sprites stop.
   */
  launched: number;          // +0x1320
  /**
   * `obj+0x00` -- whether the handler has installed
   * `PathRidingPropFixedPoseUpdate` (`FUN_00432810`) in its own place, which
   * it does only in `g_app_state` 10. The engine stores the routine's
   * address; a snapshot cannot hold one, so this holds that it happened.
   */
  fixedPose: boolean;        // +0x00
}

/** `[port-only]` -- a fresh tail; `ActorClearGameFields` zeroes the engine's. */
export function makePathRidingPropTail(): PathRidingPropTail {
  return { drawSlot: 0, launched: 0, fixedPose: false };
}
